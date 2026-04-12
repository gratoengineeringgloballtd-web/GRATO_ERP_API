const Vendor = require('../models/Vendor');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');
const fs = require('fs');
const path = require('path');

// Create new vendor
const createVendor = async (req, res) => {
  try {
    console.log('=== CREATE VENDOR STARTED ===');
    
    const {
      name,
      category,
      contactPerson,
      email,
      phone,
      address,
      website,
      specializations,
      businessType,
      registrationNumber,
      taxId,
      yearEstablished,
      employeeCount,
      paymentTerms,
      creditLimit,
      preferredPaymentMethod,
      businessDescription
    } = req.body;

    // Check if vendor with same name or email already exists
    const existingVendor = await Vendor.findOne({
      $or: [
        { name: { $regex: new RegExp(`^${name}$`, 'i') } },
        { 'contactInfo.email': email.toLowerCase() }
      ]
    });

    if (existingVendor) {
      return res.status(400).json({
        success: false,
        message: 'Vendor with this name or email already exists'
      });
    }

    // Parse specializations if it's a string
    let parsedSpecializations;
    try {
      parsedSpecializations = typeof specializations === 'string' ? JSON.parse(specializations) : specializations;
    } catch (error) {
      parsedSpecializations = [];
    }

    // Process attachments (documents)
    let documents = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const fileName = `${Date.now()}-${file.originalname}`;
          const uploadDir = path.join(__dirname, '../uploads/vendors');
          const filePath = path.join(uploadDir, fileName);
          
          await fs.promises.mkdir(uploadDir, { recursive: true });
          
          if (file.path) {
            await fs.promises.rename(file.path, filePath);
          }
          
          documents.push({
            name: file.originalname,
            type: 'other',
            url: `/uploads/vendors/${fileName}`,
            publicId: fileName,
            uploadDate: new Date(),
            status: 'valid'
          });
        } catch (fileError) {
          console.error('Error processing file:', file.originalname, fileError);
        }
      }
    }

    const vendor = new Vendor({
      name,
      category,
      contactInfo: {
        contactPerson,
        email: email.toLowerCase(),
        phone,
        address,
        website
      },
      businessInfo: {
        registrationNumber,
        taxId,
        businessType,
        yearEstablished: yearEstablished ? parseInt(yearEstablished) : undefined,
        employeeCount: employeeCount ? parseInt(employeeCount) : undefined,
        businessDescription
      },
      contractInfo: {
        paymentTerms,
        creditLimit: creditLimit ? parseFloat(creditLimit) : undefined,
        preferredPaymentMethod
      },
      specializations: parsedSpecializations || [],
      documents,
      createdBy: req.user.userId,
      lastUpdatedBy: req.user.userId
    });

    await vendor.save();

    // Send notification to supply chain team
    const supplyChainTeam = await User.find({ 
      $or: [
        { role: 'supply_chain' },
        { department: 'Business Development & Supply Chain' },
        { role: 'admin' }
      ]
    }).select('email fullName');

    if (supplyChainTeam.length > 0) {
      const notification = sendEmail({
        to: supplyChainTeam.map(u => u.email),
        subject: `New Vendor Registration - ${vendor.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #1890ff; margin: 0;">New Vendor Registration</h2>
              <p style="color: #666; margin: 5px 0 0 0;">A new vendor has been registered and requires review.</p>
            </div>

            <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
              <h3 style="color: #333; margin-top: 0;">Vendor Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Vendor ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendor.vendorId}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Name:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendor.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Category:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendor.category}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Contact Person:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendor.contactInfo.contactPerson}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Email:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendor.contactInfo.email}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #faad14; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">PENDING APPROVAL</span></td>
                </tr>
              </table>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/supply-chain/vendors" 
                 style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Review Vendor
              </a>
            </div>

            <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
              <p style="margin: 0;">Best regards,<br>Vendor Management System</p>
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to send vendor registration notification:', error);
      });
    }

    console.log('=== VENDOR CREATED SUCCESSFULLY ===');
    res.status(201).json({
      success: true,
      message: 'Vendor created successfully and pending approval',
      data: vendor
    });

  } catch (error) {
    console.error('Create vendor error:', error);
    
    // Clean up uploaded files if vendor creation failed
    if (req.files && req.files.length > 0) {
      await Promise.allSettled(
        req.files.map(file => {
          if (file.path) {
            return fs.promises.unlink(file.path).catch(e => console.error('File cleanup failed:', e));
          }
        })
      );
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create vendor',
      error: error.message
    });
  }
};

// Get all vendors with filters and pagination
const getAllVendors = async (req, res) => {
  try {
    const { 
      status, 
      category, 
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1, 
      limit = 20 
    } = req.query;
    
    let filter = {};
    
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { 'contactInfo.contactPerson': { $regex: search, $options: 'i' } },
        { vendorId: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const vendors = await Vendor.find(filter)
      .populate('createdBy', 'fullName')
      .populate('lastUpdatedBy', 'fullName')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Vendor.countDocuments(filter);

    res.json({
      success: true,
      data: vendors,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: vendors.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get all vendors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendors',
      error: error.message
    });
  }
};

// Get single vendor details
const getVendorDetails = async (req, res) => {
  try {
    const { vendorId } = req.params;
    
    const vendor = await Vendor.findById(vendorId)
      .populate('createdBy', 'fullName email')
      .populate('lastUpdatedBy', 'fullName email')
      .populate('notes.addedBy', 'fullName email');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    res.json({
      success: true,
      data: vendor
    });

  } catch (error) {
    console.error('Get vendor details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor details',
      error: error.message
    });
  }
};

// Update vendor
const updateVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const updateData = req.body;
    
    console.log('=== UPDATE VENDOR ===');
    console.log('Vendor ID:', vendorId);

    const user = await User.findById(req.user.userId);
    
    // Check permissions
    const canUpdate = 
      user.role === 'admin' || 
      user.role === 'supply_chain' ||
      user.department === 'Business Development & Supply Chain';

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Update vendor fields
    Object.keys(updateData).forEach(key => {
      if (key === 'contactInfo') {
        vendor.contactInfo = { ...vendor.contactInfo, ...updateData.contactInfo };
      } else if (key === 'businessInfo') {
        vendor.businessInfo = { ...vendor.businessInfo, ...updateData.businessInfo };
      } else if (key === 'contractInfo') {
        vendor.contractInfo = { ...vendor.contractInfo, ...updateData.contractInfo };
      } else if (key === 'performanceMetrics') {
        vendor.performanceMetrics = { ...vendor.performanceMetrics, ...updateData.performanceMetrics };
      } else if (key !== 'vendorId' && key !== 'createdBy') {
        vendor[key] = updateData[key];
      }
    });

    vendor.lastUpdatedBy = req.user.userId;
    await vendor.save();

    await vendor.populate([
      { path: 'createdBy', select: 'fullName' },
      { path: 'lastUpdatedBy', select: 'fullName' }
    ]);

    res.json({
      success: true,
      message: 'Vendor updated successfully',
      data: vendor
    });

  } catch (error) {
    console.error('Update vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vendor',
      error: error.message
    });
  }
};

// Update vendor status
const updateVendorStatus = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { status, reason } = req.body;
    
    const user = await User.findById(req.user.userId);
    
    // Check permissions
    const canUpdate = 
      user.role === 'admin' || 
      user.role === 'supply_chain';

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    const oldStatus = vendor.status;
    vendor.status = status;
    vendor.lastUpdatedBy = req.user.userId;

    // Add note about status change
    vendor.notes.push({
      note: `Status changed from ${oldStatus} to ${status}. ${reason ? `Reason: ${reason}` : ''}`,
      addedBy: req.user.userId,
      category: 'general'
    });

    await vendor.save();

    // Send notification to vendor if status changed to active or suspended
    if (status === 'active' || status === 'suspended') {
      const notification = sendEmail({
        to: vendor.contactInfo.email,
        subject: `Vendor Status Update - ${vendor.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: ${status === 'active' ? '#f6ffed' : '#fff2f0'}; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: ${status === 'active' ? '#52c41a' : '#ff4d4f'}; margin: 0;">Vendor Status Update</h2>
              <p style="color: #666; margin: 5px 0 0 0;">Your vendor status has been updated</p>
            </div>

            <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
              <h3 style="color: #333; margin-top: 0;">Status Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Vendor:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendor.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Vendor ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendor.vendorId}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>New Status:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><span style="color: ${status === 'active' ? '#52c41a' : '#ff4d4f'}; font-weight: bold;">${status.toUpperCase()}</span></td>
                </tr>
                ${reason ? `
                <tr>
                  <td style="padding: 8px 0;"><strong>Reason:</strong></td>
                  <td style="padding: 8px 0;">${reason}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            ${status === 'active' ? 
              '<div style="background-color: #f6ffed; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #52c41a;"><p style="color: #52c41a; margin: 0;">You can now participate in our procurement processes.</p></div>' : 
              '<div style="background-color: #fff2f0; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ff4d4f;"><p style="color: #ff4d4f; margin: 0;">Please contact our procurement team if you have any questions.</p></div>'
            }

            <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
              <p style="margin: 0;">Best regards,<br>Procurement Team</p>
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to send vendor notification:', error);
      });
    }

    res.json({
      success: true,
      message: `Vendor status updated to ${status}`,
      data: vendor
    });

  } catch (error) {
    console.error('Update vendor status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vendor status',
      error: error.message
    });
  }
};

// Add vendor note
const addVendorNote = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { note, category = 'general' } = req.body;
    
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    vendor.notes.push({
      note,
      addedBy: req.user.userId,
      category
    });

    vendor.lastUpdatedBy = req.user.userId;
    await vendor.save();

    // Populate the new note
    await vendor.populate('notes.addedBy', 'fullName email');

    res.json({
      success: true,
      message: 'Note added successfully',
      data: vendor.notes[vendor.notes.length - 1]
    });

  } catch (error) {
    console.error('Add vendor note error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add note',
      error: error.message
    });
  }
};


// Get vendor analytics
const getVendorAnalytics = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    // Check permissions
    const canView = 
      user.role === 'admin' || 
      user.role === 'supply_chain' ||
      user.department === 'Business Development & Supply Chain';

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const [
      totalVendors,
      activeVendors,
      categoryBreakdown,
      performanceAnalytics,
      riskAnalytics,
      recentRegistrations
    ] = await Promise.all([
      Vendor.countDocuments(),
      Vendor.countDocuments({ status: 'active' }),
      
      // Category breakdown
      Vendor.aggregate([
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            activeCount: {
              $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
            },
            avgRating: { $avg: '$performanceMetrics.rating' },
            totalSpend: { $sum: '$orderStats.totalSpend' }
          }
        },
        { $sort: { count: -1 } }
      ]),
      
      // Performance analytics
      Vendor.aggregate([
        { $match: { status: 'active' } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$performanceMetrics.rating' },
            avgReliability: { $avg: '$performanceMetrics.reliability' },
            avgDeliveryTime: { $avg: '$performanceMetrics.averageDeliveryTime' },
            avgOnTimeRate: { $avg: '$performanceMetrics.onTimeDeliveryRate' },
            totalSpend: { $sum: '$orderStats.totalSpend' },
            totalOrders: { $sum: '$orderStats.totalOrders' }
          }
        }
      ]),
      
      // Risk level distribution
      Vendor.aggregate([
        {
          $group: {
            _id: '$riskLevel',
            count: { $sum: 1 }
          }
        }
      ]),

      // Recent registrations (last 30 days)
      Vendor.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      })
    ]);

    const analytics = {
      summary: {
        total: totalVendors,
        active: activeVendors,
        inactiveRate: totalVendors > 0 ? Math.round(((totalVendors - activeVendors) / totalVendors) * 100) : 0,
        recentRegistrations
      },
      categories: categoryBreakdown,
      performance: performanceAnalytics[0] || {
        avgRating: 0,
        avgReliability: 0,
        avgDeliveryTime: 0,
        avgOnTimeRate: 0,
        totalSpend: 0,
        totalOrders: 0
      },
      riskDistribution: riskAnalytics
    };

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('Get vendor analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor analytics',
      error: error.message
    });
  }
};

// Record vendor performance for an order
const recordVendorPerformance = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { 
      deliveryTime, 
      qualityRating, 
      onTime, 
      orderValue,
      orderId,
      issues = []
    } = req.body;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Update performance metrics
    vendor.updatePerformanceMetrics({
      deliveryTime: parseInt(deliveryTime),
      qualityRating: parseFloat(qualityRating),
      onTime: onTime === true || onTime === 'true',
      orderValue: parseFloat(orderValue)
    });

    // Add note about performance update
    vendor.notes.push({
      note: `Performance recorded for order ${orderId}: Delivery time: ${deliveryTime} days, Quality: ${qualityRating}/5, On-time: ${onTime ? 'Yes' : 'No'}${issues.length > 0 ? `, Issues: ${issues.join(', ')}` : ''}`,
      addedBy: req.user.userId,
      category: 'performance'
    });

    await vendor.save();

    res.json({
      success: true,
      message: 'Vendor performance recorded successfully',
      data: vendor
    });

  } catch (error) {
    console.error('Record vendor performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record vendor performance',
      error: error.message
    });
  }
};

// Get vendors by category
const getVendorsByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const { activeOnly = 'true' } = req.query;
    
    let filter = { category };
    if (activeOnly === 'true') {
      filter.status = 'active';
    }

    const vendors = await Vendor.find(filter)
      .select('vendorId name contactInfo performanceMetrics orderStats contractInfo')
      .sort({ 'performanceMetrics.rating': -1 });

    res.json({
      success: true,
      data: vendors,
      count: vendors.length
    });

  } catch (error) {
    console.error('Get vendors by category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendors by category',
      error: error.message
    });
  }
};

// Get top performing vendors
const getTopPerformingVendors = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const topVendors = await Vendor.find({ status: 'active' })
      .sort({ 
        'performanceMetrics.rating': -1,
        'performanceMetrics.reliability': -1,
        'orderStats.totalSpend': -1
      })
      .limit(parseInt(limit))
      .select('vendorId name category performanceMetrics orderStats contactInfo contractInfo');

    res.json({
      success: true,
      data: topVendors
    });

  } catch (error) {
    console.error('Get top performing vendors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top performing vendors',
      error: error.message
    });
  }
};

// Search vendors
const searchVendors = async (req, res) => {
  try {
    const { 
      query, 
      category, 
      minRating = 0,
      maxDeliveryTime,
      activeOnly = 'true'
    } = req.query;
    
    let filter = {};
    
    if (query) {
      filter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { 'contactInfo.contactPerson': { $regex: query, $options: 'i' } },
        { specializations: { $regex: query, $options: 'i' } },
        { vendorId: { $regex: query, $options: 'i' } }
      ];
    }
    
    if (category) filter.category = category;
    if (activeOnly === 'true') filter.status = 'active';
    if (minRating > 0) filter['performanceMetrics.rating'] = { $gte: parseFloat(minRating) };
    if (maxDeliveryTime) filter['performanceMetrics.averageDeliveryTime'] = { $lte: parseInt(maxDeliveryTime) };

    const vendors = await Vendor.find(filter)
      .sort({ 'performanceMetrics.rating': -1 })
      .limit(50);

    res.json({
      success: true,
      data: vendors,
      count: vendors.length
    });

  } catch (error) {
    console.error('Search vendors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search vendors',
      error: error.message
    });
  }
};

// Generate vendor report
const generateVendorReport = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { period = 'quarterly' } = req.query;
    
    const vendor = await Vendor.findById(vendorId)
      .populate('createdBy', 'fullName')
      .populate('notes.addedBy', 'fullName');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Calculate performance trends
    const performanceData = vendor.performanceHistory.slice(-4); // Last 4 periods
    
    const report = {
      vendor: {
        id: vendor.vendorId,
        name: vendor.name,
        category: vendor.category,
        status: vendor.status
      },
      contactInfo: vendor.contactInfo,
      performance: {
        current: vendor.performanceMetrics,
        trends: performanceData,
        riskLevel: vendor.riskLevel
      },
      orders: vendor.orderStats,
      compliance: {
        documentsCount: vendor.documents.length,
        expiredDocuments: vendor.documents.filter(doc => doc.status === 'expired').length,
        certificationsCount: vendor.certifications.length
      },
      recentNotes: vendor.notes.slice(-10) // Last 10 notes
    };

    res.json({
      success: true,
      data: report,
      generatedAt: new Date()
    });

  } catch (error) {
    console.error('Generate vendor report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate vendor report',
      error: error.message
    });
  }
};

// Delete vendor (admin only)
const deleteVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const user = await User.findById(req.user.userId);

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can delete vendors'
      });
    }

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Check if vendor has active contracts
    if (vendor.contractInfo.activeContracts > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete vendor with active contracts'
      });
    }

    // Clean up documents
    if (vendor.documents && vendor.documents.length > 0) {
      await Promise.allSettled(
        vendor.documents.map(doc => {
          if (doc.publicId) {
            const filePath = path.join(__dirname, '../uploads/vendors', doc.publicId);
            return fs.promises.unlink(filePath).catch(e => console.error('File cleanup failed:', e));
          }
        })
      );
    }

    await Vendor.findByIdAndDelete(vendorId);

    res.json({
      success: true,
      message: 'Vendor deleted successfully'
    });

  } catch (error) {
    console.error('Delete vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete vendor',
      error: error.message
    });
  }
};

// Bulk update vendor statuses
const bulkUpdateVendorStatus = async (req, res) => {
  try {
    const { vendorIds, status, reason } = req.body;
    const user = await User.findById(req.user.userId);

    if (user.role !== 'admin' && user.role !== 'supply_chain') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updateResult = await Vendor.updateMany(
      { _id: { $in: vendorIds } },
      { 
        status, 
        lastUpdatedBy: req.user.userId,
        $push: {
          notes: {
            note: `Status bulk updated to ${status}. ${reason ? `Reason: ${reason}` : ''}`,
            addedBy: req.user.userId,
            category: 'general'
          }
        }
      }
    );

    res.json({
      success: true,
      message: `${updateResult.modifiedCount} vendors updated successfully`,
      data: { modifiedCount: updateResult.modifiedCount }
    });

  } catch (error) {
    console.error('Bulk update vendor status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vendor statuses',
      error: error.message
    });
  }
};

// Get vendor dashboard statistics for supply chain
const getVendorDashboardStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    const canView = 
      user.role === 'admin' || 
      user.role === 'supply_chain' ||
      user.department === 'Business Development & Supply Chain';

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const [
      totalVendors,
      activeVendors,
      pendingApproval,
      highPerformers,
      lowPerformers,
      topCategories,
      recentActivity
    ] = await Promise.all([
      Vendor.countDocuments(),
      Vendor.countDocuments({ status: 'active' }),
      Vendor.countDocuments({ status: 'pending_approval' }),
      
      // High performers (rating >= 4.0)
      Vendor.countDocuments({ 
        status: 'active',
        'performanceMetrics.rating': { $gte: 4.0 }
      }),
      
      // Low performers (rating < 3.0)
      Vendor.countDocuments({ 
        status: 'active',
        'performanceMetrics.rating': { $lt: 3.0 }
      }),

      // Top categories by vendor count
      Vendor.aggregate([
        { $match: { status: 'active' } },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            avgRating: { $avg: '$performanceMetrics.rating' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]),

      // Recent vendor activity (last 7 days)
      Vendor.find({
        updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      })
      .select('name status updatedAt')
      .sort({ updatedAt: -1 })
      .limit(10)
    ]);

    const stats = {
      summary: {
        totalVendors,
        activeVendors,
        pendingApproval,
        inactiveVendors: totalVendors - activeVendors,
        activeRate: totalVendors > 0 ? Math.round((activeVendors / totalVendors) * 100) : 0
      },
      performance: {
        highPerformers,
        lowPerformers,
        performanceRate: activeVendors > 0 ? Math.round((highPerformers / activeVendors) * 100) : 0
      },
      categories: topCategories,
      recentActivity
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get vendor dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor dashboard statistics',
      error: error.message
    });
  }
};

module.exports = {
  createVendor,
  getAllVendors,
  getVendorDetails,
  updateVendor,
  updateVendorStatus,
  addVendorNote,
  getVendorAnalytics,
  recordVendorPerformance,
  getVendorsByCategory,
  getTopPerformingVendors,
  searchVendors,
  generateVendorReport,
  deleteVendor,
  bulkUpdateVendorStatus,
  getVendorDashboardStats
};

