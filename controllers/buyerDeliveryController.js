const DeliveryTracking = require('../models/DeliveryTracking');
const PurchaseOrder = require('../models/PurchaseOrder');
const Supplier = require('../models/Supplier');
const { sendEmail } = require('../services/emailService');

// Get deliveries for buyer
const getDeliveries = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;

    let query = { buyerId: req.user.userId };

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { trackingNumber: { $regex: search, $options: 'i' } },
        { currentLocation: { $regex: search, $options: 'i' } }
      ];
    }

    const deliveries = await DeliveryTracking.find(query)
      .populate({
        path: 'purchaseOrderId',
        select: 'poNumber totalAmount items',
        populate: {
          path: 'requisitionId',
          select: 'title department employee'
        }
      })
      .populate('supplierId', 'name email phone')
      .sort({ dispatchDate: -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await DeliveryTracking.countDocuments(query);

    res.json({
      success: true,
      data: deliveries,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: deliveries.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get deliveries error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch deliveries',
      error: error.message
    });
  }
};

// Get delivery tracking details
const getDeliveryDetails = async (req, res) => {
  try {
    const { deliveryId } = req.params;

    const delivery = await DeliveryTracking.findById(deliveryId)
      .populate({
        path: 'purchaseOrderId',
        populate: [
          {
            path: 'requisitionId',
            select: 'title department employee',
            populate: {
              path: 'employee',
              select: 'fullName email'
            }
          }
        ]
      })
      .populate('supplierId', 'name email phone address');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery tracking not found'
      });
    }

    res.json({
      success: true,
      data: delivery
    });

  } catch (error) {
    console.error('Get delivery details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery details',
      error: error.message
    });
  }
};

// Update delivery tracking
const updateDeliveryTracking = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { status, location, description, updatedBy } = req.body;

    const delivery = await DeliveryTracking.findById(deliveryId)
      .populate('supplierId', 'name email');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery tracking not found'
      });
    }

    // Add tracking update
    await delivery.addUpdate(
      status,
      description || `Status updated to ${status}`,
      location,
      updatedBy || 'Buyer'
    );

    res.json({
      success: true,
      message: 'Delivery tracking updated successfully',
      data: delivery
    });

  } catch (error) {
    console.error('Update delivery tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update delivery tracking',
      error: error.message
    });
  }
};

// Confirm delivery
const confirmDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const {
      receivedBy,
      condition,
      notes,
      photos,
      rating
    } = req.body;

    const delivery = await DeliveryTracking.findById(deliveryId)
      .populate({
        path: 'purchaseOrderId',
        populate: [
          { path: 'supplierId', select: 'name email' },
          {
            path: 'requisitionId',
            select: 'title employee',
            populate: {
              path: 'employee',
              select: 'fullName email'
            }
          }
        ]
      });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery tracking not found'
      });
    }

    // Confirm delivery
    await delivery.confirmDelivery({
      receivedBy,
      condition,
      notes,
      photos: photos || []
    });

    // Update purchase order status
    const purchaseOrder = await PurchaseOrder.findById(delivery.purchaseOrderId._id);
    if (purchaseOrder) {
      purchaseOrder.updateStatus('delivered', req.user.userId);
      purchaseOrder.actualDeliveryDate = new Date();
      
      // Calculate delivery performance
      purchaseOrder.calculateDeliveryPerformance();
      
      // Add delivery rating
      if (rating) {
        purchaseOrder.performanceMetrics = purchaseOrder.performanceMetrics || {};
        purchaseOrder.performanceMetrics.supplierRating = rating;
      }
      
      await purchaseOrder.save();
    }

    // Update supplier performance
    const supplier = await Supplier.findById(delivery.supplierId);
    if (supplier && purchaseOrder) {
      await supplier.updatePerformance({
        status: 'completed',
        orderDate: purchaseOrder.creationDate,
        deliveryDate: delivery.actualDeliveryDate,
        expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
        value: purchaseOrder.totalAmount
      });
    }

    // Send delivery confirmation emails
    const notifications = [];

    // Notify employee
    if (delivery.purchaseOrderId.requisitionId?.employee?.email) {
      notifications.push(
        sendDeliveryConfirmationEmail(
          delivery.purchaseOrderId.requisitionId.employee.email,
          delivery,
          'employee'
        ).catch(error => ({ error, type: 'employee' }))
      );
    }

    // Notify supplier
    if (delivery.purchaseOrderId.supplierId?.email) {
      notifications.push(
        sendDeliveryConfirmationEmail(
          delivery.purchaseOrderId.supplierId.email,
          delivery,
          'supplier'
        ).catch(error => ({ error, type: 'supplier' }))
      );
    }

    const notificationResults = await Promise.allSettled(notifications);

    res.json({
      success: true,
      message: 'Delivery confirmed successfully',
      data: delivery,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm delivery',
      error: error.message
    });
  }
};

// Report delivery issue
const reportDeliveryIssue = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const {
      type,
      description,
      priority = 'medium'
    } = req.body;

    const delivery = await DeliveryTracking.findById(deliveryId)
      .populate('supplierId', 'name email')
      .populate({
        path: 'purchaseOrderId',
        select: 'poNumber',
        populate: {
          path: 'requisitionId',
          select: 'title'
        }
      });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery tracking not found'
      });
    }

    // Report issue
    await delivery.reportIssue({
      type,
      description,
      priority,
      reportedBy: req.user.userId
    });

    // Send issue notification to supplier
    const emailResult = await sendDeliveryIssueEmail(
      delivery.supplierId.email,
      delivery,
      { type, description, priority }
    ).catch(error => {
      console.error('Failed to send issue notification:', error);
      return { error };
    });

    res.json({
      success: true,
      message: 'Delivery issue reported successfully',
      data: delivery,
      emailResult
    });

  } catch (error) {
    console.error('Report delivery issue error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to report delivery issue',
      error: error.message
    });
  }
};

// Get delivery statistics for dashboard
const getDeliveryStatistics = async (req, res) => {
  try {
    const { period = '30' } = req.query; // days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    const stats = await DeliveryTracking.aggregate([
      {
        $match: {
          buyerId: require('mongoose').Types.ObjectId(req.user.userId),
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: {
              $cond: [
                { $in: ['$status', ['pending_dispatch', 'dispatched']] },
                1, 0
              ]
            }
          },
          inTransit: {
            $sum: {
              $cond: [
                { $in: ['$status', ['in_transit', 'at_facility', 'out_for_delivery']] },
                1, 0
              ]
            }
          },
          delivered: {
            $sum: {
              $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0]
            }
          },
          issues: {
            $sum: { $size: '$issues' }
          }
        }
      }
    ]);

    // Get overdue deliveries
    const overdueDeliveries = await DeliveryTracking.countDocuments({
      buyerId: req.user.userId,
      estimatedDeliveryDate: { $lt: new Date() },
      status: { $nin: ['delivered', 'cancelled'] }
    });

    res.json({
      success: true,
      data: {
        summary: stats[0] || {
          total: 0,
          pending: 0,
          inTransit: 0,
          delivered: 0,
          issues: 0
        },
        overdue: overdueDeliveries
      }
    });

  } catch (error) {
    console.error('Get delivery statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery statistics',
      error: error.message
    });
  }
};

// Helper function to send delivery confirmation email
const sendDeliveryConfirmationEmail = async (email, delivery, recipientType) => {
  const isEmployee = recipientType === 'employee';
  const subject = `Delivery Confirmed - ${delivery.trackingNumber}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
        <h2 style="color: #2e7d32; margin: 0;">Delivery Confirmed</h2>
        <p style="color: #666; margin: 5px 0 0 0;">
          ${isEmployee ? 'Your items have been delivered' : 'Delivery confirmation received'}
        </p>
      </div>
      
      <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <h3 style="color: #333; margin-top: 0;">Delivery Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Tracking Number:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${delivery.trackingNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Delivered On:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${new Date(delivery.actualDeliveryDate).toLocaleDateString()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Received By:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${delivery.deliveryConfirmation.receivedBy}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Condition:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${delivery.deliveryConfirmation.condition}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0;"><strong>Delivery Address:</strong></td>
            <td style="padding: 8px 0;">${delivery.deliveryAddress}</td>
          </tr>
        </table>
      </div>

      ${delivery.deliveryConfirmation.notes ? `
      <div style="background-color: #f8f9fa; border-left: 4px solid #6c757d; padding: 15px; margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #495057;">Delivery Notes</h4>
        <p style="margin: 0; color: #495057;">${delivery.deliveryConfirmation.notes}</p>
      </div>
      ` : ''}

      <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
        <p style="margin: 0;">
          ${isEmployee ? 
            'Thank you for confirming the delivery. If you have any issues, please contact the procurement team.' :
            'Thank you for the successful delivery. Payment will be processed according to the agreed terms.'
          }
        </p>
      </div>
    </div>
  `;

  return await sendEmail({
    to: email,
    subject,
    html
  });
};

// Helper function to send delivery issue email
const sendDeliveryIssueEmail = async (supplierEmail, delivery, issue) => {
  const subject = `Delivery Issue Reported - ${delivery.trackingNumber}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
        <h2 style="color: #856404; margin: 0;">Delivery Issue Reported</h2>
        <p style="color: #666; margin: 5px 0 0 0;">An issue has been reported with a delivery</p>
      </div>
      
      <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <h3 style="color: #333; margin-top: 0;">Issue Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Tracking Number:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${delivery.trackingNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Issue Type:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${issue.type}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Priority:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${issue.priority.toUpperCase()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>PO Number:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${delivery.purchaseOrderId.poNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0;"><strong>Reported Date:</strong></td>
            <td style="padding: 8px 0;">${new Date().toLocaleDateString()}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #721c24;">Issue Description</h4>
        <p style="margin: 0; color: #721c24;">${issue.description}</p>
      </div>

      <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
        <p style="margin: 0;">Please investigate this issue and provide a resolution plan as soon as possible.</p>
        <p style="margin: 10px 0 0 0;">Contact our procurement team for any clarifications needed.</p>
      </div>
    </div>
  `;

  return await sendEmail({
    to: supplierEmail,
    subject,
    html
  });
};

module.exports = {
  getDeliveries,
  getDeliveryDetails,
  updateDeliveryTracking,
  confirmDelivery,
  reportDeliveryIssue,
  getDeliveryStatistics
};






