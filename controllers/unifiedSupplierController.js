const User = require('../models/User');
const Contract = require('../models/Contract');
const SupplierInvoice = require('../models/SupplierInvoice');
const SupplierPerformance = require('../models/SupplierPerformance');
const { sendEmail } = require('../services/emailService');
const crypto = require('crypto');

/**
 * UNIFIED REGISTRATION + ONBOARDING
 * Combines registration and onboarding into single process
 */
exports.registerAndOnboardSupplier = async (req, res) => {
  try {
    console.log('=== UNIFIED SUPPLIER REGISTRATION & ONBOARDING WITH APPROVAL ===');
    
    const {
      // Basic account info
      email,
      password,
      fullName,
      
      // Company info
      companyName,
      contactName,
      phoneNumber,
      alternatePhone,
      website,
      address,
      
      // Business info
      supplierType,
      businessType,
      businessRegistrationNumber,
      taxIdNumber,
      establishedYear,
      employeeCount,
      servicesOffered,
      businessDescription,
      
      // Financial
      bankDetails,
      paymentTerms
    } = req.body;

    // Validate required fields
    if (!email || !password || !fullName || !companyName || !contactName || !phoneNumber || !supplierType) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    // Check if supplier already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists'
      });
    }

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Process uploaded documents if any
    const documents = {};
    if (req.files) {
      const processFile = (file) => ({
        name: file.originalname,
        url: file.path,
        publicId: file.filename,
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date()
      });

      if (req.files.businessRegistrationCertificate) {
        documents.businessRegistrationCertificate = processFile(req.files.businessRegistrationCertificate[0]);
      }
      if (req.files.taxClearanceCertificate) {
        documents.taxClearanceCertificate = processFile(req.files.taxClearanceCertificate[0]);
      }
      if (req.files.bankStatement) {
        documents.bankStatement = processFile(req.files.bankStatement[0]);
      }
      if (req.files.insuranceCertificate) {
        documents.insuranceCertificate = processFile(req.files.insuranceCertificate[0]);
      }
      if (req.files.additionalDocuments) {
        documents.additionalDocuments = req.files.additionalDocuments.map(processFile);
      }
    }

    // Create unified supplier account
    const supplier = await User.create({
      email: email.toLowerCase(),
      password,
      fullName,
      role: 'supplier',
      isActive: false, 
      
      supplierDetails: {
        companyName,
        contactName,
        phoneNumber,
        alternatePhone,
        website,
        address,
        supplierType,
        businessType,
        businessRegistrationNumber,
        taxIdNumber,
        establishedYear,
        employeeCount,
        servicesOffered: servicesOffered || [],
        businessDescription,
        bankDetails,
        paymentTerms: paymentTerms || '30 days NET',
        documents
      },
      
      supplierStatus: {
        accountStatus: 'pending',
        emailVerified: false,
        isVerified: false,
        verificationToken
      }
    });

    // Initialize approval chain
    supplier.initializeSupplierApprovalChain();
    await supplier.save();

    console.log('Supplier account created with approval chain:', supplier.email);
    console.log('Approval chain levels:', supplier.approvalChain.map(s => 
      `L${s.level}: ${s.approver.name} (${s.approver.role})`
    ).join(' → '));

    // Send verification email
    const verificationUrl = `${process.env.CLIENT_URL}/suppliers/verify-email/${verificationToken}`;
    
    await sendEmail({
      to: email,
      subject: 'Verify Your Supplier Account - Grato Engineering',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
            <h2 style="color: #28a745;">Welcome to Grato Engineering Supplier Portal</h2>
            <p>Dear ${contactName},</p>
            
            <p>Thank you for registering ${companyName} as a supplier with Grato Engineering.</p>
            
            <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3>Registration Summary:</h3>
              <ul>
                <li><strong>Company:</strong> ${companyName}</li>
                <li><strong>Supplier Type:</strong> ${supplierType}</li>
                <li><strong>Contact:</strong> ${contactName}</li>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>Status:</strong> Pending Verification & Approval</li>
              </ul>
            </div>
            
            <p><strong>Please verify your email address:</strong></p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" 
                 style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Verify Email Address
              </a>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px;">
              <p><strong>Approval Process:</strong></p>
              <ol>
                <li>Verify your email address</li>
                <li>Supply Chain Coordinator review</li>
                <li>Head of Business approval</li>
                <li>Finance final approval</li>
                <li>Account activation</li>
              </ol>
            </div>
          </div>
        </div>
      `
    });

    // Notify first approver (Supply Chain Coordinator)
    if (supplier.approvalChain.length > 0) {
      const firstApprover = supplier.approvalChain[0].approver;
      await sendEmail({
        to: firstApprover.email,
        subject: `New Supplier Registration - ${companyName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1890ff;">New Supplier Registration Requires Your Review</h2>
            <p>Dear ${firstApprover.name},</p>
            <p>A new supplier has registered and requires your review as Supply Chain Coordinator.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Company:</strong> ${companyName}</p>
              <p><strong>Type:</strong> ${supplierType}</p>
              <p><strong>Contact:</strong> ${contactName}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Documents:</strong> ${Object.keys(documents).length} uploaded</p>
            </div>
            
            <p style="text-align: center;">
              <a href="${process.env.CLIENT_URL}/admin/suppliers/${supplier._id}/approve" 
                 style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Review Supplier Application
              </a>
            </p>
          </div>
        `
      });
    }

    res.status(201).json({
      success: true,
      message: 'Supplier registration successful. Please check your email to verify your account.',
      data: {
        id: supplier._id,
        email: supplier.email,
        companyName: supplier.supplierDetails.companyName,
        status: 'pending_verification',
        approvalChain: supplier.approvalChain.map(step => ({
          level: step.level,
          approver: step.approver.name,
          role: step.approver.role,
          status: step.status
        }))
      }
    });

  } catch (error) {
    console.error('Unified registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};


/**
 * GET COMPLETE SUPPLIER PROFILE
 * Returns unified view of supplier with all related data
 */
exports.getCompleteSupplierProfile = async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    const supplier = await User.findById(supplierId)
      .select('-password')
      .populate('supplierStatus.approvedBy', 'fullName email');
    
    if (!supplier || supplier.role !== 'supplier') {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    // Get all related data
    const [contracts, invoices, performance, summary] = await Promise.all([
      Contract.find({ supplier: supplierId })
        .populate('management.contractManager', 'fullName email')
        .sort({ createdAt: -1 }),
      SupplierInvoice.find({ supplier: supplierId })
        .populate('linkedContract', 'contractNumber title')
        .sort({ uploadedDate: -1 })
        .limit(50),
      SupplierPerformance.find({ supplier: supplierId })
        .sort({ evaluationDate: -1 })
        .limit(10),
      supplier.getSupplierSummary()
    ]);
    
    res.json({
      success: true,
      data: {
        profile: supplier,
        contracts: {
          list: contracts,
          summary: summary.contracts
        },
        invoices: {
          list: invoices,
          summary: summary.invoices
        },
        performance: {
          evaluations: performance,
          summary: summary.performance
        },
        overallSummary: summary
      }
    });
    
  } catch (error) {
    console.error('Error fetching complete supplier profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier profile'
    });
  }
};

/**
 * BULK IMPORT SUPPLIERS
 * Admin can import multiple suppliers from CSV/Excel
 */
exports.bulkImportSuppliers = async (req, res) => {
  try {
    console.log('=== BULK SUPPLIER IMPORT ===');
    const { suppliers } = req.body; // Array of supplier objects
    
    if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Suppliers array is required'
      });
    }
    
    const results = {
      successful: [],
      failed: []
    };
    
    for (const supplierData of suppliers) {
      try {
        // Check if supplier exists
        const existingSupplier = await User.findOne({ 
          email: supplierData.email.toLowerCase() 
        });
        
        if (existingSupplier) {
          results.failed.push({
          email: supplierData.email,
            error: 'Email already exists'
          });
          continue;
        }
        
        // Generate temporary password if not provided
        const tempPassword = supplierData.password || crypto.randomBytes(8).toString('hex');
        
        // Create supplier
        const supplier = await User.create({
          email: supplierData.email.toLowerCase(),
          password: tempPassword,
          fullName: supplierData.fullName || supplierData.contactName,
          role: 'supplier',
          isActive: true, // Auto-approve bulk imports
          
          supplierDetails: {
            companyName: supplierData.companyName,
            contactName: supplierData.contactName,
            phoneNumber: supplierData.phoneNumber,
            alternatePhone: supplierData.alternatePhone,
            website: supplierData.website,
            address: supplierData.address || {},
            supplierType: supplierData.supplierType || 'General',
            businessType: supplierData.businessType,
            businessRegistrationNumber: supplierData.businessRegistrationNumber,
            taxIdNumber: supplierData.taxIdNumber,
            establishedYear: supplierData.establishedYear,
            employeeCount: supplierData.employeeCount,
            servicesOffered: supplierData.servicesOffered || [],
            businessDescription: supplierData.businessDescription,
            bankDetails: supplierData.bankDetails || {},
            paymentTerms: supplierData.paymentTerms || '30 days NET'
          },
          
          supplierStatus: {
            accountStatus: 'approved',
            emailVerified: true,
            isVerified: true,
            approvalDate: new Date(),
            approvedBy: req.user.userId
          }
        });
        
        results.successful.push({
          email: supplier.email,
          companyName: supplier.supplierDetails.companyName,
          id: supplier._id,
          tempPassword: tempPassword
        });
        
        // Send welcome email
        await sendEmail({
          to: supplier.email,
          subject: 'Welcome to Grato Engineering Supplier Portal',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2>Welcome to Grato Engineering</h2>
              <p>Dear ${supplier.supplierDetails.contactName},</p>
              <p>Your supplier account has been created and approved.</p>
              
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
                <h3>Login Credentials:</h3>
                <ul>
                  <li><strong>Email:</strong> ${supplier.email}</li>
                  <li><strong>Temporary Password:</strong> ${tempPassword}</li>
                  <li><strong>Portal URL:</strong> ${process.env.CLIENT_URL}/supplier/login</li>
                </ul>
                <p style="color: #dc3545;"><strong>Important:</strong> Please change your password after first login.</p>
              </div>
            </div>
          `
        }).catch(err => console.error('Failed to send welcome email:', err));
        
      } catch (error) {
        results.failed.push({
          email: supplierData.email,
          companyName: supplierData.companyName,
          error: error.message
        });
      }
    }
    
    console.log(`Bulk import completed: ${results.successful.length} successful, ${results.failed.length} failed`);
    
    res.json({
      success: true,
      message: `Bulk import completed: ${results.successful.length} successful, ${results.failed.length} failed`,
      data: results
    });
    
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({
      success: false,
      message: 'Bulk import failed',
      error: error.message
    });
  }
};

/**
 * UPDATE SUPPLIER PROFILE (Admin or Supplier)
 */
exports.updateSupplierProfile = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const updateData = req.body;
    
    const supplier = await User.findById(supplierId);
    if (!supplier || supplier.role !== 'supplier') {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    // Check permissions
    const isAdmin = ['admin', 'finance', 'supply_chain'].includes(req.user.role);
    const isOwner = req.supplier && req.supplier.userId === supplierId;
    
    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }
    
    // If supplier is updating their own profile, restrict certain fields
    if (!isAdmin) {
      delete updateData.supplierStatus;
      delete updateData.role;
      delete updateData.isActive;
    }
    
    // Update supplier details
    if (updateData.supplierDetails) {
      Object.keys(updateData.supplierDetails).forEach(key => {
        if (supplier.supplierDetails[key] !== undefined) {
          supplier.supplierDetails[key] = updateData.supplierDetails[key];
        }
      });
    }
    
    // Update other allowed fields
    const allowedFields = ['fullName', 'phone'];
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        supplier[field] = updateData[field];
      }
    });
    
    // Admin-only updates
    if (isAdmin) {
      if (updateData.supplierStatus) {
        Object.keys(updateData.supplierStatus).forEach(key => {
          supplier.supplierStatus[key] = updateData.supplierStatus[key];
        });
      }
      if (updateData.isActive !== undefined) {
        supplier.isActive = updateData.isActive;
      }
    }
    
    await supplier.save();
    
    res.json({
      success: true,
      message: 'Supplier profile updated successfully',
      data: supplier
    });
    
  } catch (error) {
    console.error('Error updating supplier profile:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
};

/**
 * APPROVE/REJECT SUPPLIER
 */
exports.approveOrRejectSupplier = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { action, comments } = req.body; // action: 'approve' or 'reject'
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be approve or reject'
      });
    }
    
    const supplier = await User.findById(supplierId);
    if (!supplier || supplier.role !== 'supplier') {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    if (action === 'approve') {
      supplier.supplierStatus.accountStatus = 'approved';
      supplier.supplierStatus.approvalDate = new Date();
      supplier.supplierStatus.approvedBy = req.user.userId;
      supplier.isActive = true;
      
      // Send approval email
      await sendEmail({
        to: supplier.email,
        subject: 'Supplier Account Approved - Grato Engineering',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #d4edda; padding: 20px; border-radius: 8px;">
              <h2>Account Approved!</h2>
              <p>Dear ${supplier.supplierDetails.contactName},</p>
              <p>Your supplier account for <strong>${supplier.supplierDetails.companyName}</strong> has been approved.</p>
              
              <div style="background-color: #d1ecf1; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3>You can now:</h3>
                <ul>
                  <li>Submit invoices</li>
                  <li>View and respond to RFQs</li>
                  <li>Track contract status</li>
                  <li>Update your profile</li>
                </ul>
              </div>
              
              <p>Login at: <a href="${process.env.CLIENT_URL}/supplier/login">Supplier Portal</a></p>
            </div>
          </div>
        `
      });
      
    } else {
      supplier.supplierStatus.accountStatus = 'rejected';
      supplier.supplierStatus.rejectionReason = comments;
      supplier.isActive = false;
      
      // Send rejection email
      await sendEmail({
        to: supplier.email,
        subject: 'Supplier Account Status - Grato Engineering',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px;">
              <h2>Account Application Update</h2>
              <p>Dear ${supplier.supplierDetails.contactName},</p>
              <p>Thank you for your interest in becoming a supplier for Grato Engineering.</p>
              <p>Unfortunately, we are unable to approve your application at this time.</p>
              ${comments ? `<p><strong>Reason:</strong> ${comments}</p>` : ''}
              <p>If you believe this is an error or would like more information, please contact our supply chain team.</p>
            </div>
          </div>
        `
      });
    }
    
    await supplier.save();
    
    res.json({
      success: true,
      message: `Supplier ${action}d successfully`,
      data: supplier
    });
    
  } catch (error) {
    console.error('Error approving/rejecting supplier:', error);
    res.status(400).json({
      success: false,
      message: `Failed to ${req.body.action} supplier`,
      error: error.message
    });
  }
};

/**
 * GET SUPPLIER DASHBOARD DATA
 * For supplier's own dashboard
 */
exports.getSupplierDashboard = async (req, res) => {
  try {
    const supplierId = req.supplier.userId;
    
    const supplier = await User.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    // Get summary data
    const summary = await supplier.getSupplierSummary();
    
    // Get recent activity
    const [recentContracts, recentInvoices, recentPerformance] = await Promise.all([
      Contract.find({ supplier: supplierId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('contractNumber title status dates financials'),
      SupplierInvoice.find({ supplier: supplierId })
        .sort({ uploadedDate: -1 })
        .limit(10)
        .select('invoiceNumber poNumber invoiceAmount approvalStatus uploadedDate'),
      SupplierPerformance.findOne({ supplier: supplierId })
        .sort({ evaluationDate: -1 })
        .select('overallScore evaluationDate recommendation')
    ]);
    
    // Get active contracts expiring soon
    const expiringContracts = await Contract.find({
      supplier: supplierId,
      status: { $in: ['active', 'expiring_soon'] },
      'dates.endDate': {
        $gte: new Date(),
        $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Next 30 days
      }
    }).select('contractNumber title dates');
    
    res.json({
      success: true,
      data: {
        supplier: {
          id: supplier._id,
          companyName: supplier.supplierDetails.companyName,
          accountStatus: supplier.supplierStatus.accountStatus,
          emailVerified: supplier.supplierStatus.emailVerified
        },
        summary,
        recentActivity: {
          contracts: recentContracts,
          invoices: recentInvoices,
          latestPerformance: recentPerformance
        },
        alerts: {
          expiringContracts: expiringContracts.length,
          contracts: expiringContracts
        }
      }
    });
    
  } catch (error) {
    console.error('Error fetching supplier dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
};
