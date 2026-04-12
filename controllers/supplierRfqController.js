const mongoose = require('mongoose');
const RFQ = require('../models/RFQ');
const Quote = require('../models/Quote');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');

// HELPER FUNCTION: Get all possible supplier IDs for a user
const getSupplierSearchIds = async (userId) => {
  const searchIds = [new mongoose.Types.ObjectId(userId)];
  
  // Get user details
  const user = await User.findById(userId).select('_id email fullName');
  if (!user) {
    return searchIds;
  }

  // Check if there's a corresponding Supplier collection entry
  try {
    const Supplier = require('../models/Supplier');
    const supplierRecords = await Supplier.find({
      $or: [
        { _id: userId },
        { email: user.email },
        { userId: userId }
      ]
    }).select('_id');
    
    supplierRecords.forEach(supplier => {
      const supplierId = new mongoose.Types.ObjectId(supplier._id);
      if (!searchIds.find(id => id.equals(supplierId))) {
        searchIds.push(supplierId);
      }
    });
  } catch (error) {
    console.log('No Supplier collection or error accessing it:', error.message);
  }

  return searchIds;
};

// Submit quote for RFQ - FIXED VERSION
exports.submitQuote = async (req, res) => {
  try {
    const { rfqId } = req.params;
    const supplierId = req.supplier.userId;
    const {
      items,
      totalAmount,
      validityPeriod = 30,
      deliveryTerms,
      paymentTerms,
      additionalNotes,
      warranty,
      deliveryTime
    } = req.body;

    console.log('=== SUBMIT QUOTE DEBUG ===');
    console.log('RFQ ID:', rfqId);
    console.log('Supplier ID from auth:', supplierId);

    // Get all possible supplier IDs
    const supplierSearchIds = await getSupplierSearchIds(supplierId);
    console.log('All supplier search IDs:', supplierSearchIds.map(id => id.toString()));

    // Get and validate RFQ
    const rfq = await RFQ.findById(rfqId)
      .populate('requisitionId')
      .populate('buyerId', 'fullName email');

    if (!rfq) {
      return res.status(404).json({
        success: false,
        message: 'RFQ not found'
      });
    }

    console.log('RFQ invited suppliers:', rfq.invitedSuppliers.map(inv => ({
      supplierId: inv.supplierId.toString(),
      responseStatus: inv.responseStatus
    })));

    // Check if ANY of the supplier IDs match the invitation
    const supplierInvitation = rfq.invitedSuppliers.find(inv => 
      supplierSearchIds.some(searchId => searchId.equals(inv.supplierId))
    );

    if (!supplierInvitation) {
      return res.status(403).json({
        success: false,
        message: 'You are not invited to quote on this RFQ',
        debug: {
          yourSupplierIds: supplierSearchIds.map(id => id.toString()),
          invitedSupplierIds: rfq.invitedSuppliers.map(inv => inv.supplierId.toString())
        }
      });
    }

    console.log('Found supplier invitation:', {
      supplierId: supplierInvitation.supplierId.toString(),
      responseStatus: supplierInvitation.responseStatus,
      invitedDate: supplierInvitation.invitedDate
    });

    // Check deadline
    if (new Date() > new Date(rfq.responseDeadline)) {
      return res.status(400).json({
        success: false,
        message: 'Quote submission deadline has passed'
      });
    }

    // Check for existing quote using any of the supplier IDs
    const existingQuote = await Quote.findOne({
      rfqId: rfq._id,
      supplierId: { $in: supplierSearchIds }
    });

    if (existingQuote) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a quote for this RFQ'
      });
    }

    // Get supplier details
    const supplier = await User.findById(supplierId)
      .select('fullName email phone supplierDetails');

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Parse items if it's a string (from FormData)
    let parsedItems;
    try {
      parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    } catch (parseError) {
      console.error('Items parse error:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid items format'
      });
    }

    // Validate items
    if (!parsedItems || parsedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Quote items are required'
      });
    }

    console.log('Parsed items:', parsedItems.length);

    // Validate that all RFQ items are quoted
    const rfqItemIds = rfq.items.map(item => item._id.toString());
    const quotedItemIds = parsedItems.map(item => (item.itemId || item.id || item._id).toString());

    const missingItems = rfqItemIds.filter(id => !quotedItemIds.includes(id));
    if (missingItems.length > 0) {
      console.log('Missing items:', missingItems);
      return res.status(400).json({
        success: false,
        message: 'Please provide quotes for all required items',
        missingItemIds: missingItems
      });
    }

    // Process uploaded files
    const attachments = [];
    if (req.files) {
      ['quoteDocuments', 'technicalSpecs', 'certificates'].forEach(fileType => {
        if (req.files[fileType]) {
          req.files[fileType].forEach(file => {
            attachments.push({
              name: file.originalname,
              url: file.path || file.location,
              publicId: file.filename || file.key,
              size: file.size,
              mimetype: file.mimetype,
              category: fileType === 'quoteDocuments' ? 'quote_document' : 
                       fileType === 'technicalSpecs' ? 'technical_specs' : 'certificate'
            });
          });
        }
      });
    }

    // Calculate validity date
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + parseInt(validityPeriod));

    // Calculate response time
    const responseTime = Math.round(
      (new Date() - new Date(supplierInvitation.invitedDate)) / (1000 * 60 * 60)
    );

    // Create quote - use the main supplier ID for consistency
    const quote = new Quote({
      requisitionId: rfq.requisitionId._id,
      rfqId: rfq._id,
      supplierId: new mongoose.Types.ObjectId(supplierId),
      buyerId: rfq.buyerId._id,
      totalAmount: parseFloat(totalAmount),
      validUntil,
      responseTime,

      // Supplier details
      supplierDetails: {
        name: supplier.supplierDetails?.companyName || supplier.fullName,
        email: supplier.email,
        phone: supplier.phone,
        contactPerson: supplier.fullName,
        address: supplier.supplierDetails?.address
      },

      // Quote items with detailed pricing
      items: parsedItems.map(item => {
        const rfqItem = rfq.items.find(ri => ri._id.toString() === (item.itemId || item.id || item._id).toString());
        return {
          description: rfqItem?.description || item.description,
          quantity: parseInt(rfqItem?.quantity || item.quantity),
          unitPrice: parseFloat(item.quotedPrice || item.unitPrice),
          totalPrice: parseFloat(item.totalPrice || (item.quotedPrice * (rfqItem?.quantity || item.quantity))),
          specifications: item.specifications || rfqItem?.specifications,
          partNumber: item.partNumber || '',
          warranty: item.warranty || '',
          leadTime: item.deliveryTime || item.leadTime || '',
          availability: item.availability || 'Available'
        };
      }),

      // Terms
      paymentTerms: paymentTerms || rfq.paymentTerms,
      deliveryTerms: deliveryTerms || 'Standard delivery',
      deliveryTime: deliveryTime ? {
        value: parseInt(deliveryTime.split(' ')[0]) || 7,
        unit: deliveryTime.includes('week') ? 'weeks' : 'days'
      } : { value: 7, unit: 'days' },
      warranty: warranty || '',

      // Files and notes
      attachments,
      supplierNotes: additionalNotes || '',

      // Status
      status: 'received'
    });

    await quote.save();
    console.log('Quote saved successfully:', quote._id);

    // Update supplier invitation status in RFQ
    supplierInvitation.responseStatus = 'responded';
    supplierInvitation.responseDate = new Date();

    // Update RFQ response summary
    const respondedCount = rfq.invitedSuppliers.filter(inv => inv.responseStatus === 'responded').length;
    rfq.responseSummary.totalResponded = respondedCount;

    // Update RFQ status if needed
    const allResponded = rfq.invitedSuppliers.every(inv => 
      ['responded', 'declined', 'no_response'].includes(inv.responseStatus)
    );

    if (allResponded) {
      rfq.status = 'responses_received';
    } else if (rfq.status === 'sent') {
      rfq.status = 'responses_pending';
    }

    await rfq.save();
    console.log('RFQ status updated:', rfq.status);

    // FIXED: Handle requisition status update safely
    try {
      const requisition = rfq.requisitionId;
      if (requisition) {
        console.log('Current requisition status:', requisition.status);
        
        // Instead of changing status, add a note about quote received
        if (!requisition.notes) requisition.notes = '';
        
        const quoteNote = `[${new Date().toISOString()}] Quote received from ${supplier.supplierDetails?.companyName || supplier.fullName} - Amount: ${totalAmount} XAF`;
        
        if (!requisition.notes.includes(quoteNote)) {
          requisition.notes = requisition.notes ? `${requisition.notes}\n${quoteNote}` : quoteNote;
        }
        
        // Optional: Update a custom field if it exists
        if (requisition.quotesReceived !== undefined) {
          requisition.quotesReceived = (requisition.quotesReceived || 0) + 1;
        }
        
        await requisition.save();
        console.log('Requisition updated with quote information');
      }
    } catch (reqError) {
      console.error('Failed to update requisition (non-critical):', reqError.message);
      // Don't fail the entire quote submission for requisition update issues
    }

    // Send notification to buyer (optional - wrapped in try-catch)
    try {
      await sendEmail({
        to: rfq.buyerId.email,
        subject: `New Quote Received - ${rfq.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
              <h2 style="color: #1890ff; margin-top: 0;">New Quote Received</h2>
              <p>Dear ${rfq.buyerId.fullName},</p>
              <p>A new quote has been submitted for your RFQ.</p>
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4>Quote Details</h4>
                <ul>
                  <li><strong>RFQ:</strong> ${rfq.title}</li>
                  <li><strong>Supplier:</strong> ${supplier.supplierDetails?.companyName || supplier.fullName}</li>
                  <li><strong>Quote Amount:</strong> XAF ${totalAmount.toLocaleString()}</li>
                  <li><strong>Response Time:</strong> ${responseTime} hours</li>
                  <li><strong>Valid Until:</strong> ${validUntil.toLocaleDateString('en-GB')}</li>
                  <li><strong>Attachments:</strong> ${attachments.length} file(s)</li>
                </ul>
              </div>
              <p>You can review and evaluate this quote in your buyer dashboard.</p>
            </div>
          </div>
        `
      });
      console.log('Buyer notification sent successfully');
    } catch (emailError) {
      console.error('Failed to send buyer notification (non-critical):', emailError.message);
    }

    // SUCCESS RESPONSE
    res.json({
      success: true,
      message: 'Quote submitted successfully',
      data: {
        quoteId: quote._id,
        quoteNumber: quote.quoteNumber,
        totalAmount: quote.totalAmount,
        submissionDate: quote.submissionDate,
        validUntil: quote.validUntil,
        status: quote.status,
        attachmentsCount: attachments.length,
        responseTime: responseTime
      }
    });

  } catch (error) {
    console.error('Submit quote error:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Quote validation failed',
        details: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to submit quote',
      error: error.message
    });
  }
};

// Get RFQ requests for supplier - FIXED VERSION
exports.getSupplierRfqRequests = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const supplierId = req.supplier.userId;

    console.log('=== SUPPLIER GET RFQ REQUESTS ===');
    console.log('Supplier ID:', supplierId);

    // Get all possible supplier IDs
    const supplierSearchIds = await getSupplierSearchIds(supplierId);
    console.log('Will search RFQs for supplier IDs:', supplierSearchIds.map(id => id.toString()));

    // Build query to find RFQs where any of the supplier IDs are invited
    let matchStage = {
      'invitedSuppliers.supplierId': { $in: supplierSearchIds }
    };

    // Add status filter
    if (status) {
      if (status === 'pending_quote') {
        matchStage = {
          ...matchStage,
          $expr: {
            $and: [
              {
                $anyElementTrue: {
                  $map: {
                    input: '$invitedSuppliers',
                    cond: {
                      $and: [
                        { $in: ['$$this.supplierId', supplierSearchIds] },
                        {
                          $or: [
                            { $eq: ['$$this.responseStatus', 'pending'] },
                            { $not: { $ifNull: ['$$this.responseStatus', false] } }
                          ]
                        }
                      ]
                    }
                  }
                }
              },
              { $in: ['$status', ['sent', 'responses_pending']] },
              { $gt: ['$responseDeadline', new Date()] }
            ]
          }
        };
      } else if (status === 'quote_submitted') {
        matchStage = {
          ...matchStage,
          $expr: {
            $anyElementTrue: {
              $map: {
                input: '$invitedSuppliers',
                cond: {
                  $and: [
                    { $in: ['$$this.supplierId', supplierSearchIds] },
                    { $eq: ['$$this.responseStatus', 'responded'] }
                  ]
                }
              }
            }
          }
        };
      } else if (status === 'expired') {
        matchStage = {
          ...matchStage,
          responseDeadline: { $lt: new Date() }
        };
      }
    } else {
      // Default: show all active RFQs
      matchStage.status = { $in: ['sent', 'responses_pending', 'responses_received'] };
    }

    // Add search functionality
    if (search) {
      matchStage.$or = [
        { title: { $regex: search, $options: 'i' } },
        { rfqNumber: { $regex: search, $options: 'i' } },
        { 'items.description': { $regex: search, $options: 'i' } }
      ];
    }

    console.log('Final match stage:', JSON.stringify(matchStage, null, 2));

    const rfqAggregation = [
      { $match: matchStage },
      {
        $addFields: {
          supplierInvitation: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$invitedSuppliers',
                  cond: { $in: ['$$this.supplierId', supplierSearchIds] }
                }
              },
              0
            ]
          }
        }
      },
      {
        $lookup: {
          from: 'purchaserequisitions',
          localField: 'requisitionId',
          foreignField: '_id',
          as: 'requisition',
          pipeline: [
            {
              $lookup: {
                from: 'users',
                localField: 'employee',
                foreignField: '_id',
                as: 'employee'
              }
            },
            { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } }
          ]
        }
      },
      { $unwind: { path: '$requisition', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'buyerId',
          foreignField: '_id',
          as: 'buyer'
        }
      },
      { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
      { $sort: { issueDate: -1 } },
      { $skip: (page - 1) * parseInt(limit) },
      { $limit: parseInt(limit) }
    ];

    const rfqs = await RFQ.aggregate(rfqAggregation);

    // Get total count
    const countAggregation = [
      { $match: matchStage },
      { $count: 'total' }
    ];

    const totalResult = await RFQ.aggregate(countAggregation);
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    console.log(`Found ${rfqs.length} RFQs (total: ${total})`);

    // Transform data for frontend
    const transformedRfqs = await Promise.all(rfqs.map(async (rfq) => {
      const supplierInvitation = rfq.supplierInvitation;

      // Check for existing quote using all supplier IDs
      const existingQuote = await Quote.findOne({
        rfqId: rfq._id,
        supplierId: { $in: supplierSearchIds }
      });

      // Calculate days left
      const deadline = new Date(rfq.responseDeadline);
      const now = new Date();
      const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));

      // Determine status
      let rfqStatus = 'pending_quote';
      if (existingQuote) {
        rfqStatus = 'quote_submitted';
        if (existingQuote.status === 'selected') {
          rfqStatus = 'quote_selected';
        } else if (existingQuote.status === 'rejected') {
          rfqStatus = 'quote_rejected';
        }
      } else if (daysLeft <= 0) {
        rfqStatus = 'expired';
      }

      // Determine priority
      let priority = 'low';
      if (daysLeft <= 1) priority = 'urgent';
      else if (daysLeft <= 2) priority = 'high';
      else if (daysLeft <= 5) priority = 'medium';

      return {
        id: rfq.rfqNumber || rfq._id.toString(),
        rfqId: rfq._id,
        requisitionId: rfq.requisition?._id,
        title: rfq.title,
        buyer: rfq.buyer?.fullName,
        buyerEmail: rfq.buyer?.email,
        buyerPhone: rfq.buyer?.phone,
        department: rfq.requisition?.employee?.department || rfq.requisition?.department || 'Unknown',
        requestDate: rfq.issueDate,
        quotationDeadline: rfq.responseDeadline,
        expectedDelivery: rfq.expectedDeliveryDate,
        status: rfqStatus,
        priority,
        paymentTerms: rfq.paymentTerms || '30 days',
        deliveryLocation: rfq.deliveryLocation,
        evaluationCriteria: rfq.evaluationCriteria || { quality: 40, cost: 35, delivery: 25 },
        items: rfq.items.map(item => ({
          id: item._id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          specifications: item.specifications,
          requiredDeliveryDate: item.requiredDeliveryDate
        })),
        notes: rfq.specialRequirements,
        attachments: rfq.attachments || [],
        supplierStatus: supplierInvitation?.responseStatus,
        invitedDate: supplierInvitation?.invitedDate,
        responseDate: supplierInvitation?.responseDate,
        submittedQuote: existingQuote ? {
          quoteId: existingQuote._id,
          quoteNumber: existingQuote.quoteNumber,
          totalAmount: existingQuote.totalAmount,
          submissionDate: existingQuote.submissionDate,
          status: existingQuote.status,
          validUntil: existingQuote.validUntil
        } : null,
        daysLeft,
        isExpired: daysLeft <= 0,
        isUrgent: daysLeft <= 2 && daysLeft > 0
      };
    }));

    res.json({
      success: true,
      data: transformedRfqs,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / parseInt(limit)),
        count: transformedRfqs.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get supplier RFQ requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch RFQ requests',
      error: error.message
    });
  }
};

// Get specific RFQ details for supplier - FIXED
exports.getSupplierRfqById = async (req, res) => {
  try {
    const { rfqId } = req.params;
    const supplierId = req.supplier.userId;

    console.log('=== GET SUPPLIER RFQ DETAILS ===');
    console.log('RFQ ID:', rfqId);
    console.log('Supplier ID:', supplierId);

    // Get all possible supplier IDs
    const supplierSearchIds = await getSupplierSearchIds(supplierId);

    const rfq = await RFQ.findById(rfqId)
      .populate({
        path: 'requisitionId',
        select: 'title department employee estimatedTotalCost urgency deliveryLocation',
        populate: {
          path: 'employee',
          select: 'fullName department email'
        }
      })
      .populate('buyerId', 'fullName email phone department');

    if (!rfq) {
      return res.status(404).json({
        success: false,
        message: 'RFQ not found'
      });
    }

    // FIXED: Verify supplier is invited using any of the supplier IDs
    const supplierInvitation = rfq.invitedSuppliers.find(inv => 
      supplierSearchIds.some(searchId => searchId.equals(inv.supplierId))
    );

    if (!supplierInvitation) {
      return res.status(403).json({
        success: false,
        message: 'You are not invited to quote on this RFQ'
      });
    }

    // Get existing quote if any
    const existingQuote = await Quote.findOne({
      rfqId: rfq._id,
      supplierId: { $in: supplierSearchIds }
    });

    // Calculate timeline
    const deadline = new Date(rfq.responseDeadline);
    const now = new Date();
    const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
    const hoursLeft = Math.ceil((deadline - now) / (1000 * 60 * 60));

    const rfqDetails = {
      id: rfq._id,
      rfqNumber: rfq.rfqNumber,
      requisitionId: rfq.requisitionId?._id,
      title: rfq.title,

      // Buyer information
      buyer: rfq.buyerId?.fullName,
      buyerEmail: rfq.buyerId?.email,
      buyerPhone: rfq.buyerId?.phone,
      department: rfq.requisitionId?.employee?.department || rfq.buyerId?.department,

      // Timeline
      issueDate: rfq.issueDate,
      quotationDeadline: rfq.responseDeadline,
      expectedDeliveryDate: rfq.expectedDeliveryDate,
      daysLeft,
      hoursLeft,
      isExpired: daysLeft <= 0,
      isUrgent: daysLeft <= 2 && daysLeft > 0,

      // Requirements
      paymentTerms: rfq.paymentTerms,
      deliveryLocation: rfq.deliveryLocation || rfq.requisitionId?.deliveryLocation,
      specialRequirements: rfq.specialRequirements,
      evaluationCriteria: rfq.evaluationCriteria,

      // Items to quote
      items: rfq.items.map(item => ({
        id: item._id,
        _id: item._id,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        specifications: item.specifications,
        requiredDeliveryDate: item.requiredDeliveryDate
      })),

      // Documents
      attachments: rfq.attachments || [],

      // Supplier status
      supplierInvitation: {
        invitedDate: supplierInvitation.invitedDate,
        responseStatus: supplierInvitation.responseStatus,
        responseDate: supplierInvitation.responseDate,
        remindersSent: supplierInvitation.remindersSent
      },

      // Existing quote info
      existingQuote: existingQuote ? {
        quoteId: existingQuote._id,
        quoteNumber: existingQuote.quoteNumber,
        totalAmount: existingQuote.totalAmount,
        submissionDate: existingQuote.submissionDate,
        status: existingQuote.status,
        validUntil: existingQuote.validUntil,
        items: existingQuote.items
      } : null,

      // Permissions
      canSubmitQuote: !existingQuote && daysLeft > 0,
      canEditQuote: existingQuote && existingQuote.status === 'received' && daysLeft > 0,

      // RFQ status
      rfqStatus: rfq.status,
      totalInvited: rfq.invitedSuppliers.length,
      totalResponded: rfq.responseSummary.totalResponded
    };

    res.json({
      success: true,
      data: rfqDetails
    });

  } catch (error) {
    console.error('Get RFQ details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch RFQ details',
      error: error.message
    });
  }
};

// Get supplier's submitted quotes - FIXED
exports.getSupplierQuotes = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const supplierId = req.supplier.userId;

    console.log('=== GET SUPPLIER QUOTES ===');
    console.log('Supplier ID:', supplierId);

    // Get all possible supplier IDs
    const supplierSearchIds = await getSupplierSearchIds(supplierId);

    let query = { supplierId: { $in: supplierSearchIds } };

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { quoteNumber: { $regex: search, $options: 'i' } },
        { 'supplierDetails.name': { $regex: search, $options: 'i' } }
      ];
    }

    const quotes = await Quote.find(query)
      .populate('rfqId', 'title rfqNumber responseDeadline')
      .populate('requisitionId', 'title department')
      .populate('buyerId', 'fullName email')
      .populate('evaluation.evaluatedBy', 'fullName')
      .sort({ submissionDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Quote.countDocuments(query);

    res.json({
      success: true,
      data: quotes,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: quotes.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get supplier quotes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quotes',
      error: error.message
    });
  }
};

// Get supplier dashboard data - FIXED
exports.getSupplierDashboard = async (req, res) => {
  try {
    const supplierId = req.supplier.userId;

    console.log('=== SUPPLIER DASHBOARD ===');
    console.log('Supplier ID:', supplierId);

    // Get all possible supplier IDs
    const supplierSearchIds = await getSupplierSearchIds(supplierId);

    // Get RFQ statistics
    const rfqStats = await RFQ.aggregate([
      {
        $match: {
          'invitedSuppliers.supplierId': { $in: supplierSearchIds }
        }
      },
      {
        $unwind: '$invitedSuppliers'
      },
      {
        $match: {
          'invitedSuppliers.supplierId': { $in: supplierSearchIds }
        }
      },
      {
        $group: {
          _id: null,
          totalInvitations: { $sum: 1 },
          responded: {
            $sum: {
              $cond: [{ $eq: ['$invitedSuppliers.responseStatus', 'responded'] }, 1, 0]
            }
          },
          pending: {
            $sum: {
              $cond: [{ $eq: ['$invitedSuppliers.responseStatus', 'pending'] }, 1, 0]
            }
          },
          avgResponseTime: {
            $avg: {
              $subtract: [
                '$invitedSuppliers.responseDate',
                '$invitedSuppliers.invitedDate'
              ]
            }
          }
        }
      }
    ]);

    // Get quote statistics
    const quoteStats = await Quote.aggregate([
      {
        $match: { supplierId: { $in: supplierSearchIds } }
      },
      {
        $group: {
          _id: null,
          totalQuotes: { $sum: 1 },
          totalValue: { $sum: '$totalAmount' },
          received: {
            $sum: { $cond: [{ $eq: ['$status', 'received'] }, 1, 0] }
          },
          evaluated: {
            $sum: { $cond: [{ $eq: ['$status', 'evaluated'] }, 1, 0] }
          },
          selected: {
            $sum: { $cond: [{ $eq: ['$status', 'selected'] }, 1, 0] }
          },
          rejected: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          },
          avgTotalScore: { $avg: '$evaluation.totalScore' }
        }
      }
    ]);

    // Get recent RFQs
    const recentRfqs = await RFQ.find({
      'invitedSuppliers.supplierId': { $in: supplierSearchIds }
    })
    .populate('buyerId', 'fullName department')
    .sort({ issueDate: -1 })
    .limit(5);

    // Get recent quotes
    const recentQuotes = await Quote.find({
      supplierId: { $in: supplierSearchIds }
    })
    .populate('rfqId', 'title')
    .populate('buyerId', 'fullName')
    .sort({ submissionDate: -1 })
    .limit(5);

    const rfqData = rfqStats[0] || {
      totalInvitations: 0,
      responded: 0,
      pending: 0,
      avgResponseTime: 0
    };

    const quoteData = quoteStats[0] || {
      totalQuotes: 0,
      totalValue: 0,
      received: 0,
      evaluated: 0,
      selected: 0,
      rejected: 0,
      avgTotalScore: 0
    };

    // Calculate success rate
    const successRate = quoteData.totalQuotes > 0 ? 
      (quoteData.selected / quoteData.totalQuotes) * 100 : 0;

    // Calculate response rate
    const responseRate = rfqData.totalInvitations > 0 ? 
      (rfqData.responded / rfqData.totalInvitations) * 100 : 0;

    // Convert response time from milliseconds to hours
    const avgResponseTimeHours = rfqData.avgResponseTime ? 
      Math.round(rfqData.avgResponseTime / (1000 * 60 * 60)) : 0;

    res.json({
      success: true,
      data: {
        statistics: {
          totalRfqInvitations: rfqData.totalInvitations,
          pendingQuotes: rfqData.pending,
          submittedQuotes: rfqData.responded,
          totalQuoteValue: quoteData.totalValue,
          selectedQuotes: quoteData.selected,
          successRate: Math.round(successRate),
          responseRate: Math.round(responseRate),
          avgResponseTime: avgResponseTimeHours,
          avgQuoteScore: Math.round(quoteData.avgTotalScore || 0)
        },
        breakdown: {
          rfqStatus: {
            pending: rfqData.pending,
            responded: rfqData.responded
          },
          quoteStatus: {
            received: quoteData.received,
            evaluated: quoteData.evaluated,
            selected: quoteData.selected,
            rejected: quoteData.rejected
          }
        },
        recentActivity: {
          rfqs: recentRfqs,
          quotes: recentQuotes
        }
      }
    });

  } catch (error) {
    console.error('Get supplier dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message
    });
  }
};

// All functions are now exported using exports.functionName above






