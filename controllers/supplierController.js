const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');

// Register new supplier
exports.registerSupplier = async (req, res) => {
  try {
    console.log('=== SUPPLIER REGISTRATION ===');
    const {
      email,
      password,
      fullName,
      companyName,
      contactName,
      phoneNumber,
      address,
      businessRegistrationNumber,
      taxIdNumber,
      supplierType,
      bankDetails,
      businessInfo,
      contractInfo
    } = req.body;

    // Validate required fields
    if (!email || !password || !fullName || !companyName || !contactName || !phoneNumber || !supplierType) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    // Check if supplier already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Create supplier user
    const supplierData = {
      email,
      password,
      fullName,
      role: 'supplier',
      isActive: false, // Inactive until approved
      supplierDetails: {
        companyName,
        contactName,
        phoneNumber,
        address,
        businessRegistrationNumber,
        taxIdNumber,
        supplierType,
        bankDetails,
        businessInfo,
        contractInfo
      },
      supplierStatus: {
        accountStatus: 'pending',
        isVerified: false,
        emailVerified: false,
        verificationToken
      }
    };

    const supplier = await User.create(supplierData);
    console.log('Supplier created:', supplier.email);

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
            
            <p>Thank you for registering as a supplier with Grato Engineering. Your account has been created and is pending approval.</p>
            
            <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3>Registration Details:</h3>
              <ul>
                <li><strong>Company:</strong> ${companyName}</li>
                <li><strong>Supplier Type:</strong> ${supplierType}</li>
                <li><strong>Contact:</strong> ${contactName}</li>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>Status:</strong> Pending Verification & Approval</li>
              </ul>
            </div>
            
            <p><strong>Please verify your email address by clicking the link below:</strong></p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" 
                 style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Verify Email Address
              </a>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Next Steps:</strong></p>
              <ol>
                <li>Click the verification link above to verify your email</li>
                <li>Our team will review your application</li>
                <li>You'll receive an email notification once approved</li>
                <li>Start submitting invoices through our portal</li>
              </ol>
            </div>
            
            <p>If you have any questions, please contact our supply chain team.</p>
            <p>Best regards,<br>Grato Engineering Team</p>
          </div>
        </div>
      `
    });

    // Notify admin/finance of new supplier registration
    const adminUsers = await User.find({ 
      role: { $in: ['admin', 'finance'] } 
    }).select('email fullName');

    if (adminUsers.length > 0) {
      await sendEmail({
        to: adminUsers.map(u => u.email),
        subject: `New Supplier Registration - ${companyName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px;">
              <h3>New Supplier Registration</h3>
              <p>A new supplier has registered and requires approval.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px;">
                <ul>
                  <li><strong>Company:</strong> ${companyName}</li>
                  <li><strong>Contact:</strong> ${contactName}</li>
                  <li><strong>Email:</strong> ${email}</li>
                  <li><strong>Type:</strong> ${supplierType}</li>
                  <li><strong>Phone:</strong> ${phoneNumber}</li>
                  <li><strong>Business Reg:</strong> ${businessRegistrationNumber || 'Not provided'}</li>
                </ul>
              </div>
              
              <p>Please review and approve/reject this supplier registration.</p>
            </div>
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
        status: 'pending_verification'
      }
    });

  } catch (error) {
    console.error('Supplier registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};

// Verify supplier email
exports.verifySupplierEmail = async (req, res) => {
  try {
    const { token } = req.params;
    
    const supplier = await User.findOne({
      'supplierStatus.verificationToken': token,
      role: 'supplier'
    });

    if (!supplier) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    supplier.supplierStatus.emailVerified = true;
    supplier.supplierStatus.verificationToken = undefined;
    await supplier.save();

    res.json({
      success: true,
      message: 'Email verified successfully. Your account is now pending admin approval.'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Email verification failed'
    });
  }
};

// Supplier login
exports.loginSupplier = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find supplier
    const supplier = await User.findOne({ 
      email, 
      role: 'supplier' 
    });

    if (!supplier) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Verify password
    const isValidPassword = await supplier.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check email verification
    if (!supplier.supplierStatus.emailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email address before logging in.'
      });
    }

    // Check account status
    if (supplier.supplierStatus.accountStatus !== 'approved') {
      return res.status(403).json({
        success: false,
        message: `Your supplier account is ${supplier.supplierStatus.accountStatus}. Please contact administrator.`
      });
    }

    if (!supplier.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active. Please contact administrator.'
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { 
        userId: supplier._id,
        role: supplier.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Update last login
    supplier.lastLogin = new Date();
    await supplier.save();

    res.json({
      success: true,
      token,
      supplier: {
        id: supplier._id,
        email: supplier.email,
        fullName: supplier.fullName,
        companyName: supplier.supplierDetails.companyName,
        supplierType: supplier.supplierDetails.supplierType,
        role: supplier.role,
        accountStatus: supplier.supplierStatus.accountStatus
      }
    });

  } catch (error) {
    console.error('Supplier login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};

// Get supplier profile
exports.getSupplierProfile = async (req, res) => {
  try {
    const supplier = await User.findById(req.supplier.userId)
      .select('-password')
      .populate('supplierStatus.approvedBy', 'fullName email');

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    res.json({
      success: true,
      data: supplier
    });

  } catch (error) {
    console.error('Error fetching supplier profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
};

// Update supplier profile
exports.updateSupplierProfile = async (req, res) => {
  try {
    const updateData = { ...req.body };
    
    // Don't allow updating sensitive fields
    delete updateData.role;
    delete updateData.supplierStatus;
    delete updateData.password;

    const supplier = await User.findByIdAndUpdate(
      req.supplier.userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile updated successfully',
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

// Get all suppliers (admin/finance only)
exports.getAllSuppliers = async (req, res) => {
  try {
    const { status, type, page = 1, limit = 100 } = req.query;
    
    const filter = { role: 'supplier' };
    
    // Filter by status if provided
    if (status) {
      filter['supplierStatus.accountStatus'] = status;
    }
    
    // Filter by type if provided
    if (type) {
      filter['supplierDetails.supplierType'] = type;
    }
    
    // Ensure limit is a number and not exceeding a reasonable max
    const parsedLimit = Math.min(parseInt(limit) || 100, 500);
    const parsedPage = Math.max(parseInt(page) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;
    
    console.log('📋 Fetching suppliers with filter:', filter, 'limit:', parsedLimit);
    
    const suppliers = await User.find(filter)
      .select('-password')
      .populate('supplierStatus.approvedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit);
    
    const total = await User.countDocuments(filter);
    
    console.log(`✅ Found ${suppliers.length} suppliers out of ${total} total`);
    
    res.json({
      success: true,
      data: suppliers,
      pagination: {
        current: parsedPage,
        pageSize: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });

  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suppliers',
      error: error.message
    });
  }
};

// Update supplier status (approve/reject)
exports.updateSupplierStatus = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { status, comments } = req.body;

    if (!['approved', 'rejected', 'suspended', 'pending'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be approved, rejected, suspended, or pending.'
      });
    }

    const supplier = await User.findOne({
      _id: supplierId,
      role: 'supplier'
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    supplier.supplierStatus.accountStatus = status;
    supplier.isActive = status === 'approved';
    
    if (status === 'approved') {
      supplier.supplierStatus.approvalDate = new Date();
      supplier.supplierStatus.approvedBy = req.user.userId;
    }

    await supplier.save();

    // Send notification email
    const statusMessages = {
      approved: 'approved and activated',
      rejected: 'rejected',
      suspended: 'suspended'
    };

    await sendEmail({
      to: supplier.email,
      subject: `Supplier Account ${status.toUpperCase()} - Grato Engineering`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${status === 'approved' ? '#d4edda' : '#f8d7da'}; padding: 20px; border-radius: 8px;">
            <h2>Supplier Account Status Update</h2>
            <p>Dear ${supplier.supplierDetails.contactName},</p>
            
            <p>Your supplier account for <strong>${supplier.supplierDetails.companyName}</strong> has been <strong>${statusMessages[status]}</strong>.</p>
            
            ${status === 'approved' ? `
            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Congratulations!</strong> You can now:</p>
              <ul>
                <li>Access the supplier portal</li>
                <li>Submit invoices for approval</li>
                <li>Track invoice status</li>
                <li>Update your company profile</li>
              </ul>
              <p>Login at: <a href="${process.env.CLIENT_URL}/supplier/login">Supplier Portal</a></p>
            </div>
            ` : `
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Reason:</strong> ${comments || 'No specific reason provided'}</p>
              ${status === 'rejected' ? '<p>If you believe this is an error, please contact our supply chain team.</p>' : ''}
            </div>
            `}
            
            <p>Best regards,<br>Grato Engineering Team</p>
          </div>
        </div>
      `
    });

    res.json({
      success: true,
      message: `Supplier ${status} successfully`,
      data: supplier
    });

  } catch (error) {
    console.error('Error updating supplier status:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to update supplier status',
      error: error.message
    });
  }
};


/**
 * Approve supplier at specific approval level
 */
// exports.approveSupplierAtLevel = async (req, res) => {
//   try {
//     const { supplierId } = req.params;
//     const { comments, signature } = req.body;
//     const approverUser = req.user;

//     console.log('=== SUPPLIER APPROVAL REQUEST ===');
//     console.log('Supplier ID:', supplierId);
//     console.log('Approver:', approverUser.email);

//     // Find supplier
//     const supplier = await User.findOne({
//       _id: supplierId,
//       role: 'supplier'
//     });

//     if (!supplier) {
//       return res.status(404).json({
//         success: false,
//         message: 'Supplier not found'
//       });
//     }

//     // Validate approval permissions
//     const { validateSupplierApproval } = require('../config/supplierApprovalChain');
//     const validation = validateSupplierApproval(approverUser, supplier);

//     if (!validation.canApprove) {
//       return res.status(403).json({
//         success: false,
//         message: validation.reason
//       });
//     }

//     // Find current approval step
//     const currentStep = supplier.approvalChain.find(
//       step => step.level === supplier.currentApprovalLevel && step.status === 'pending'
//     );

//     if (!currentStep) {
//       return res.status(400).json({
//         success: false,
//         message: 'No pending approval step found'
//       });
//     }

//     // Update approval step
//     currentStep.status = 'approved';
//     currentStep.decision = 'approved';
//     currentStep.comments = comments || '';
//     currentStep.actionDate = new Date();
//     currentStep.actionTime = new Date().toLocaleTimeString('en-US', { 
//       hour: '2-digit', 
//       minute: '2-digit' 
//     });

//     if (signature) {
//       currentStep.signature = {
//         url: signature.url,
//         signedAt: new Date(),
//         signedBy: approverUser.fullName
//       };
//     }

//     // Check if all approvals are complete
//     const allApproved = supplier.approvalChain.every(
//       step => step.status === 'approved'
//     );

//     console.log('Current level:', supplier.currentApprovalLevel);
//     console.log('All approved:', allApproved);

//     if (allApproved) {
//       // FINAL APPROVAL - Activate supplier account
//       supplier.supplierStatus.accountStatus = 'approved';
//       supplier.supplierStatus.isVerified = true;
//       supplier.supplierStatus.emailVerified = true;
//       supplier.supplierStatus.approvalDate = new Date();
//       supplier.isActive = true;
      
//       await supplier.save();
      
//       // Generate temporary password for new suppliers
//       const tempPassword = crypto.randomBytes(8).toString('hex');
      
//       // Update supplier password with temp password
//       supplier.password = tempPassword;
//       await supplier.save();
      
//       // Send comprehensive welcome email
//       await sendEmail({
//         to: supplier.email,
//         subject: 'Welcome to GRATO HUB - Account Approved',
//         html: `
//           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//             <div style="background-color: #1890ff; color: white; padding: 20px; text-align: center;">
//               <h1 style="margin: 0;">Welcome to GRATO HUB!</h1>
//             </div>
            
//             <div style="padding: 30px; background-color: #f8f9fa;">
//               <p>Dear Partner,</p>
              
//               <p>We're pleased to inform you that your onboarding on our platform has been successfully completed.</p>
              
//               <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
//                 <h3 style="color: #1890ff; margin-top: 0;">With immediate effect:</h3>
//                 <ol style="line-height: 1.8;">
//                   <li>You will receive <strong>Request For Quotes (RFQ)</strong> through the system and upload your quotes through unique purchase links which will be sent per purchase.</li>
//                   <li>You will submit all your invoices exclusively through <strong>GRATO HUB</strong>. Please note that invoices sent outside the platform (by email or other manual methods) will no longer be accepted.</li>
//                 </ol>
//                 <p style="margin-top: 15px; padding: 10px; background-color: #fff3cd; border-left: 4px solid #ffc107;">
//                   <strong>Note:</strong> Please review invoice acceptance criteria in the attached document.
//                 </p>
//               </div>
              
//               <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0;">
//                 <h3 style="color: #155724; margin-top: 0;">YOUR INITIAL LOGIN DETAILS:</h3>
//                 <ul style="list-style: none; padding: 0;">
//                   <li style="margin: 10px 0;"><strong>Platform link:</strong> <a href="${process.env.CLIENT_URL}/supplier/login">${process.env.CLIENT_URL}/supplier/login</a></li>
//                   <li style="margin: 10px 0;"><strong>Username:</strong> ${supplier.email}</li>
//                   <li style="margin: 10px 0;"><strong>Temporary password:</strong> <code style="background-color: #f8f9fa; padding: 5px 10px; border-radius: 3px;">${tempPassword}</code></li>
//                 </ul>
//                 <p style="color: #721c24; background-color: #f8d7da; padding: 10px; border-radius: 5px; margin-top: 15px;">
//                   <strong>⚠️ Important:</strong> For security reasons, we recommend that you log in as soon as possible and change your password.
//                 </p>
//               </div>
              
//               <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
//                 <h3 style="color: #1890ff; margin-top: 0;">What GRATO HUB Allows You To Do:</h3>
//                 <ul style="line-height: 1.8;">
//                   <li>Submit invoices electronically</li>
//                   <li>Track invoice status in real-time</li>
//                   <li>View and respond to RFQs</li>
//                   <li>Manage your company profile</li>
//                   <li>Access transparent procurement process</li>
//                 </ul>
//               </div>
              
//               <p>If you have any questions or need support, please don't hesitate to contact us.</p>
              
//               <p>We look forward to working with you through GRATO HUB.</p>
              
//               <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
//                 <p><strong>Kind regards,</strong><br>
//                 <span style="color: #1890ff; font-weight: bold;">GRATO IT Team</span></p>
//               </div>
//             </div>
//           </div>
//         `,
//         attachments: [
//           // Add invoice criteria document if you have one
//           // {
//           //   filename: 'Invoice_Acceptance_Criteria.pdf',
//           //   path: './documents/Invoice_Acceptance_Criteria.pdf'
//           // }
//         ]
//       });
      
//       console.log('✅ Supplier fully approved and welcome email sent');
      
//       return res.json({
//         success: true,
//         message: 'Supplier fully approved and activated',
//         data: {
//           supplier: {
//             id: supplier._id,
//             companyName: supplier.supplierDetails.companyName,
//             accountStatus: supplier.supplierStatus.accountStatus,
//             isActive: supplier.isActive
//           },
//           approvalComplete: true,
//           tempPasswordSent: true
//         }
//       });
      
//     } else {
//       // Move to next approval level
//       const { getNextSupplierStatus } = require('../config/supplierApprovalChain');
//       supplier.currentApprovalLevel += 1;
//       supplier.supplierStatus.accountStatus = getNextSupplierStatus(
//         supplier.currentApprovalLevel,
//         supplier.approvalChain.length
//       );
      
//       await supplier.save();

//       // Notify next approver
//       const nextStep = supplier.approvalChain.find(
//         step => step.level === supplier.currentApprovalLevel
//       );

//       if (nextStep) {
//         await sendEmail({
//           to: nextStep.approver.email,
//           subject: `Supplier Approval Required - ${supplier.supplierDetails.companyName}`,
//           html: `
//             <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//               <h2 style="color: #1890ff;">Supplier Approval Required</h2>
//               <p>Dear ${nextStep.approver.name},</p>
//               <p>A supplier registration requires your approval as ${nextStep.approver.role}.</p>
              
//               <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
//                 <p><strong>Company:</strong> ${supplier.supplierDetails.companyName}</p>
//                 <p><strong>Type:</strong> ${supplier.supplierDetails.supplierType}</p>
//                 <p><strong>Contact:</strong> ${supplier.supplierDetails.contactName}</p>
//                 <p><strong>Email:</strong> ${supplier.email}</p>
//                 <p><strong>Previous Approvals:</strong> ${supplier.currentApprovalLevel - 1} of ${supplier.approvalChain.length}</p>
//               </div>
              
//               <p style="text-align: center;">
//                 <a href="${process.env.CLIENT_URL}/admin/suppliers/${supplier._id}/approve" 
//                    style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
//                   Review Supplier
//                 </a>
//               </p>
//             </div>
//           `
//         });
//       }

//       console.log(`✅ Approval level ${currentStep.level} completed`);
//       console.log(`➡️ Moving to level ${supplier.currentApprovalLevel}`);

//       return res.json({
//         success: true,
//         message: `Approval level ${currentStep.level} completed. Moved to level ${supplier.currentApprovalLevel}`,
//         data: {
//           supplier: {
//             id: supplier._id,
//             companyName: supplier.supplierDetails.companyName,
//             currentLevel: supplier.currentApprovalLevel,
//             accountStatus: supplier.supplierStatus.accountStatus
//           },
//           nextApprover: nextStep ? {
//             name: nextStep.approver.name,
//             role: nextStep.approver.role
//           } : null
//         }
//       });
//     }

//   } catch (error) {
//     console.error('❌ Supplier approval error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to approve supplier',
//       error: error.message
//     });
//   }
// };
