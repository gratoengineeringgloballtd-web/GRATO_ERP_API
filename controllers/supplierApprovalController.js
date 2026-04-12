const User = require('../models/User');
const { 
  getSupplierApprovalChain, 
  validateSupplierApproval, 
  getNextSupplierStatus 
} = require('../config/supplierApprovalChain');
const { sendEmail } = require('../services/emailService');

/**
 * Process supplier approval/rejection
 * Handles the 3-level approval workflow
 */
// const processSupplierApproval = async (req, res) => {
//   try {
//     console.log('=== PROCESS SUPPLIER APPROVAL ===');
//     const { supplierId } = req.params;
//     const { decision, comments } = req.body;

//     if (!['approved', 'rejected'].includes(decision)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid decision. Must be "approved" or "rejected"'
//       });
//     }

//     // Find supplier
//     let supplier = await User.findById(supplierId);
    
//     if (!supplier || supplier.role !== 'supplier') {
//       return res.status(404).json({
//         success: false,
//         message: 'Supplier not found'
//       });
//     }

//     // Get user information
//     const user = await User.findById(req.user.userId);

//     // Validate approval permission
//     const validation = validateSupplierApproval(user, supplier);
//     if (!validation.canApprove) {
//       return res.status(403).json({
//         success: false,
//         message: validation.reason
//       });
//     }

//     // Find current approval step
//     const currentStep = supplier.approvalChain.find(step => step.status === 'pending');
//     if (!currentStep) {
//       return res.status(400).json({
//         success: false,
//         message: 'No pending approval step found'
//       });
//     }

//     // Update current step
//     currentStep.status = decision === 'approved' ? 'approved' : 'rejected';
//     currentStep.decision = decision;
//     currentStep.comments = comments;
//     currentStep.actionDate = new Date();
//     currentStep.actionTime = new Date().toLocaleTimeString('en-US', { 
//       hour: '2-digit', 
//       minute: '2-digit',
//       hour12: true 
//     });

//     // Attach signature if user has one
//     if (user.signature && user.signature.url) {
//       currentStep.signature = {
//         url: user.signature.url,
//         signedAt: new Date(),
//         signedBy: user.fullName
//       };
//     }

//     if (decision === 'rejected') {
//       // Handle rejection
//       supplier.supplierStatus.accountStatus = 'rejected';
//       supplier.supplierStatus.rejectionReason = comments;
//       supplier.supplierStatus.rejectedBy = req.user.userId;
//       supplier.supplierStatus.rejectionDate = new Date();
//       supplier.isActive = false;

//       await supplier.save();

//       // Notify supplier of rejection
//       await sendSupplierRejectionEmail(
//         supplier.email,
//         supplier.supplierDetails.contactName,
//         supplier,
//         user.fullName,
//         comments
//       );

//       return res.json({
//         success: true,
//         message: 'Supplier rejected',
//         data: supplier
//       });
//     }

//     // Handle approval
//     const nextStepIndex = supplier.approvalChain.findIndex(
//       step => step.level === currentStep.level + 1
//     );

//     if (nextStepIndex !== -1) {
//       // Move to next approval level
//       const nextStep = supplier.approvalChain[nextStepIndex];
//       supplier.supplierStatus.accountStatus = getNextSupplierStatus(
//         currentStep.level, 
//         supplier.approvalChain.length
//       );

//       await supplier.save();

//       // Notify next approver
//       await sendSupplierApprovalEmail(
//         nextStep.approver.email,
//         nextStep.approver.name,
//         supplier,
//         user.fullName,
//         currentStep.level
//       );

//       return res.json({
//         success: true,
//         message: `Supplier approved. Moved to next approval level (${nextStep.approver.role})`,
//         data: supplier
//       });
//     } else {
//       // Final approval - activate supplier
//       supplier.supplierStatus.accountStatus = 'approved';
//       supplier.supplierStatus.approvalDate = new Date();
//       supplier.supplierStatus.approvedBy = req.user.userId;
//       supplier.isActive = true;

//       await supplier.save();

//       // Notify supplier of activation
//       await sendSupplierActivationEmail(
//         supplier.email,
//         supplier.supplierDetails.contactName,
//         supplier,
//         user.fullName
//       );

//       return res.json({
//         success: true,
//         message: 'Supplier fully approved and activated',
//         data: supplier
//       });
//     }

//   } catch (error) {
//     console.error('Process supplier approval error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process approval',
//       error: error.message
//     });
//   }
// };



// const processSupplierApproval = async (req, res) => {
//   try {
//     console.log('=== PROCESS SUPPLIER APPROVAL ===');
//     const { supplierId } = req.params;
//     const { decision, comments } = req.body;

//     if (!['approved', 'rejected'].includes(decision)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid decision. Must be "approved" or "rejected"'
//       });
//     }

//     const supplier = await User.findById(supplierId);
    
//     if (!supplier || supplier.role !== 'supplier') {
//       return res.status(404).json({
//         success: false,
//         message: 'Supplier not found'
//       });
//     }

//     const user = await User.findById(req.user.userId);

//     // Validate approval permission
//     const validation = validateSupplierApproval(user, supplier);
//     if (!validation.canApprove) {
//       return res.status(403).json({
//         success: false,
//         message: validation.reason
//       });
//     }

//     // Find current approval step
//     const currentStep = supplier.approvalChain.find(step => step.status === 'pending');
//     if (!currentStep) {
//       return res.status(400).json({
//         success: false,
//         message: 'No pending approval step found'
//       });
//     }

//     console.log(`Processing ${decision} at level ${currentStep.level}`);

//     // Update current step
//     currentStep.status = decision === 'approved' ? 'approved' : 'rejected';
//     currentStep.decision = decision;
//     currentStep.comments = comments;
//     currentStep.actionDate = new Date();
//     currentStep.actionTime = new Date().toLocaleTimeString('en-US', { 
//       hour: '2-digit', 
//       minute: '2-digit',
//       hour12: true 
//     });

//     if (user.signature && user.signature.url) {
//       currentStep.signature = {
//         url: user.signature.url,
//         signedAt: new Date(),
//         signedBy: user.fullName
//       };
//     }

//     if (decision === 'rejected') {
//       supplier.supplierStatus.accountStatus = 'rejected';
//       supplier.supplierStatus.rejectionReason = comments;
//       supplier.supplierStatus.rejectedBy = req.user.userId;
//       supplier.supplierStatus.rejectionDate = new Date();
//       supplier.isActive = false;

//       await supplier.save();

//       await sendSupplierRejectionEmail(
//         supplier.email,
//         supplier.supplierDetails.contactName,
//         supplier,
//         user.fullName,
//         comments
//       );

//       return res.json({
//         success: true,
//         message: 'Supplier rejected',
//         data: supplier
//       });
//     }

//     // Handle approval - move to next level
//     const nextStepIndex = supplier.approvalChain.findIndex(
//       step => step.level === currentStep.level + 1
//     );

//     if (nextStepIndex !== -1) {
//       const nextStep = supplier.approvalChain[nextStepIndex];
//       supplier.supplierStatus.accountStatus = getNextSupplierStatus(
//         currentStep.level, 
//         supplier.approvalChain.length
//       );
//       supplier.currentApprovalLevel = currentStep.level + 1;

//       await supplier.save();

//       console.log(`✅ Moved to level ${nextStep.level}: ${nextStep.approver.role}`);

//       await sendSupplierApprovalEmail(
//         nextStep.approver.email,
//         nextStep.approver.name,
//         supplier,
//         user.fullName,
//         currentStep.level
//       );

//       return res.json({
//         success: true,
//         message: `Supplier approved. Moved to next approval level (${nextStep.approver.role})`,
//         data: supplier
//       });
//     } else {
//       // Final approval
//       supplier.supplierStatus.accountStatus = 'approved';
//       supplier.supplierStatus.approvalDate = new Date();
//       supplier.supplierStatus.approvedBy = req.user.userId;
//       supplier.isActive = true;

//       await supplier.save();

//       console.log('✅ Supplier fully approved and activated');

//       await sendSupplierActivationEmail(
//         supplier.email,
//         supplier.supplierDetails.contactName,
//         supplier,
//         user.fullName
//       );

//       return res.json({
//         success: true,
//         message: 'Supplier fully approved and activated',
//         data: supplier
//       });
//     }

//   } catch (error) {
//     console.error('❌ Process supplier approval error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process approval',
//       error: error.message
//     });
//   }
// };



/**
 * Process supplier approval/rejection
 */
const processSupplierApproval = async (req, res) => {
  try {
    console.log('=== PROCESS SUPPLIER APPROVAL ===');
    const { supplierId } = req.params;
    const { decision, comments } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be "approved" or "rejected"'
      });
    }

    // Find supplier
    let supplier = await User.findById(supplierId);
    
    if (!supplier || supplier.role !== 'supplier') {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Get user information
    const user = await User.findById(req.user.userId);

    // Validate approval permission
    const validation = validateSupplierApproval(user, supplier);
    if (!validation.canApprove) {
      return res.status(403).json({
        success: false,
        message: validation.reason
      });
    }

    // Find current approval step
    const currentStep = supplier.approvalChain.find(step => step.status === 'pending');
    if (!currentStep) {
      return res.status(400).json({
        success: false,
        message: 'No pending approval step found'
      });
    }

    // Update current step
    currentStep.status = decision === 'approved' ? 'approved' : 'rejected';
    currentStep.decision = decision;
    currentStep.comments = comments;
    currentStep.actionDate = new Date();
    currentStep.actionTime = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });

    // Attach signature if user has one
    if (user.signature && user.signature.url) {
      currentStep.signature = {
        url: user.signature.url,
        signedAt: new Date(),
        signedBy: user.fullName
      };
    }

    if (decision === 'rejected') {
      // Handle rejection
      supplier.supplierStatus.accountStatus = 'rejected';
      supplier.supplierStatus.rejectionReason = comments;
      supplier.supplierStatus.rejectedBy = req.user.userId;
      supplier.supplierStatus.rejectionDate = new Date();
      supplier.isActive = false;

      await supplier.save();

      // Notify supplier of rejection
      await sendSupplierRejectionEmail(
        supplier.email,
        supplier.supplierDetails.contactName,
        supplier,
        user.fullName,
        comments
      );

      return res.json({
        success: true,
        message: 'Supplier rejected',
        data: supplier
      });
    }

    // Handle approval - move to next level
    supplier.currentApprovalLevel = currentStep.level + 1;
    
    const nextStepIndex = supplier.approvalChain.findIndex(
      step => step.level === currentStep.level + 1
    );

    if (nextStepIndex !== -1) {
      // Move to next approval level
      const nextStep = supplier.approvalChain[nextStepIndex];
      supplier.supplierStatus.accountStatus = getNextSupplierStatus(
        currentStep.level, 
        supplier.approvalChain.length
      );

      await supplier.save();

      // Notify next approver
      await sendSupplierApprovalEmail(
        nextStep.approver.email,
        nextStep.approver.name,
        supplier,
        user.fullName,
        currentStep.level
      );

      return res.json({
        success: true,
        message: `Supplier approved. Moved to next approval level (${nextStep.approver.role})`,
        data: supplier
      });
    } else {
      // Final approval - activate supplier
      supplier.supplierStatus.accountStatus = 'approved';
      supplier.supplierStatus.approvalDate = new Date();
      supplier.supplierStatus.approvedBy = req.user.userId;
      supplier.supplierStatus.isVerified = true; // ✅ SET VERIFIED
      supplier.supplierStatus.emailVerified = true; // ✅ SET EMAIL VERIFIED
      supplier.isActive = true;

      await supplier.save();

      // Notify supplier of activation
      await sendSupplierActivationEmail(
        supplier.email,
        supplier.supplierDetails.contactName,
        supplier,
        user.fullName
      );

      return res.json({
        success: true,
        message: 'Supplier fully approved and activated',
        data: supplier
      });
    }

  } catch (error) {
    console.error('Process supplier approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process approval',
      error: error.message
    });
  }
};


/**
 * Get suppliers pending approval for current user
 */
// const getPendingApprovalsForUser = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     const pendingSuppliers = await User.find({
//       role: 'supplier',
//       'approvalChain.approver.email': user.email,
//       'approvalChain.status': 'pending',
//       'supplierStatus.accountStatus': { $nin: ['approved', 'rejected'] }
//     }).sort({ createdAt: -1 });

//     // Filter to only show suppliers where current step is for this user
//     const userPendingSuppliers = pendingSuppliers.filter(supplier => {
//       const currentStep = supplier.approvalChain.find(step => step.status === 'pending');
//       return currentStep && currentStep.approver.email === user.email;
//     });

//     res.json({
//       success: true,
//       data: userPendingSuppliers,
//       count: userPendingSuppliers.length
//     });

//   } catch (error) {
//     console.error('Get pending approvals error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch pending approvals',
//       error: error.message
//     });
//   }
// };


const getPendingApprovalsForUser = async (req, res) => {
  try {
    console.log('=== GET PENDING APPROVALS FOR USER ===');
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('User:', user.email, 'Role:', user.role);

    // Find suppliers where:
    // 1. Role is supplier
    // 2. Account status is NOT approved or rejected
    // 3. Has approval chain
    // 4. Current pending step matches this user's email
    const allPendingSuppliers = await User.find({
      role: 'supplier',
      'supplierStatus.accountStatus': { 
        $in: ['pending', 'pending_supply_chain', 'pending_head_of_business', 'pending_finance'] 
      },
      approvalChain: { $exists: true, $ne: [] }
    }).sort({ createdAt: -1 });

    console.log(`Found ${allPendingSuppliers.length} pending suppliers`);

    // Filter to only show suppliers where current user is the pending approver
    const userPendingSuppliers = allPendingSuppliers.filter(supplier => {
      // Find the first pending step in the approval chain
      const currentStep = supplier.approvalChain.find(step => step.status === 'pending');
      
      if (!currentStep) {
        console.log(`Supplier ${supplier.supplierDetails?.companyName} has no pending step`);
        return false;
      }

      const isMatch = currentStep.approver.email === user.email;
      
      if (isMatch) {
        console.log(`✅ Match: ${supplier.supplierDetails?.companyName} - Level ${currentStep.level} - ${currentStep.approver.role}`);
      }
      
      return isMatch;
    });

    console.log(`Filtered to ${userPendingSuppliers.length} suppliers for this user`);

    res.json({
      success: true,
      data: userPendingSuppliers,
      count: userPendingSuppliers.length
    });

  } catch (error) {
    console.error('❌ Get pending approvals error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending approvals',
      error: error.message
    });
  }
};


/**
 * Get single supplier with approval details
 */
const getSupplierWithApprovalDetails = async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    const supplier = await User.findById(supplierId)
      .select('-password')
      .populate('supplierStatus.approvedBy', 'fullName email')
      .populate('supplierStatus.rejectedBy', 'fullName email');

    if (!supplier || supplier.role !== 'supplier') {
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
    console.error('Get supplier error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier',
      error: error.message
    });
  }
};

// // Email notification functions
// async function sendSupplierApprovalEmail(approverEmail, approverName, supplier, requestorName, previousLevel = 0) {
//   try {
//     const subject = `Supplier Approval Required: ${supplier.supplierDetails.companyName}`;
//     const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
//     const approvalLink = `${clientUrl}/admin/suppliers/${supplier._id}/approve`;

//     const html = `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//         <h2 style="color: #1890ff;">Supplier Approval Required</h2>
//         <p>Dear ${approverName},</p>
//         <p>A new supplier requires your approval:</p>
        
//         <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
//           <p><strong>Company Name:</strong> ${supplier.supplierDetails.companyName}</p>
//           <p><strong>Contact Person:</strong> ${supplier.supplierDetails.contactName}</p>
//           <p><strong>Email:</strong> ${supplier.email}</p>
//           <p><strong>Supplier Type:</strong> ${supplier.supplierDetails.supplierType}</p>
//           <p><strong>Business Type:</strong> ${supplier.supplierDetails.businessType || 'N/A'}</p>
//           <p><strong>Registration Number:</strong> ${supplier.supplierDetails.businessRegistrationNumber || 'N/A'}</p>
//         </div>

//         ${previousLevel > 0 ? `<p><strong>Previous Approver:</strong> ${requestorName}</p>` : ''}

//         <p style="text-align: center;">
//           <a href="${approvalLink}" style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
//             Review Supplier
//           </a>
//         </p>
//       </div>
//     `;

//     await sendEmail({
//       to: approverEmail,
//       subject,
//       html
//     });
//   } catch (error) {
//     console.error('Failed to send supplier approval email:', error);
//   }
// }

// async function sendSupplierRejectionEmail(userEmail, userName, supplier, rejectedBy, reason) {
//   try {
//     const subject = `Supplier Application Rejected: ${supplier.supplierDetails.companyName}`;
    
//     const html = `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//         <h2 style="color: #ff4d4f;">Supplier Application Rejected</h2>
//         <p>Dear ${userName},</p>
//         <p>Your supplier application has been rejected:</p>
        
//         <div style="background-color: #fff2f0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ff4d4f;">
//           <p><strong>Company:</strong> ${supplier.supplierDetails.companyName}</p>
//           <p><strong>Rejected by:</strong> ${rejectedBy}</p>
//           <p><strong>Reason:</strong> ${reason}</p>
//         </div>

//         <p>If you believe this is an error or have additional information, please contact our supply chain team.</p>
//       </div>
//     `;

//     await sendEmail({
//       to: userEmail,
//       subject,
//       html
//     });
//   } catch (error) {
//     console.error('Failed to send supplier rejection email:', error);
//   }
// }

// async function sendSupplierActivationEmail(userEmail, userName, supplier, approvedBy) {
//   try {
//     const subject = `Supplier Account Activated: ${supplier.supplierDetails.companyName}`;
//     const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    
//     const html = `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//         <h2 style="color: #52c41a;">Supplier Account Activated</h2>
//         <p>Dear ${userName},</p>
//         <p>Your supplier account has been fully approved and activated:</p>
        
//         <div style="background-color: #f6ffed; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #52c41a;">
//           <p><strong>Company:</strong> ${supplier.supplierDetails.companyName}</p>
//           <p><strong>Supplier Type:</strong> ${supplier.supplierDetails.supplierType}</p>
//           <p><strong>Final Approved by:</strong> ${approvedBy}</p>
//         </div>

//         <p>You can now access the supplier portal and:</p>
//         <ul>
//           <li>Submit invoices</li>
//           <li>Respond to RFQs</li>
//           <li>View contracts</li>
//           <li>Track payments</li>
//         </ul>

//         <p style="text-align: center;">
//           <a href="${clientUrl}/supplier/login" style="background-color: #52c41a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
//             Access Supplier Portal
//           </a>
//         </p>
//       </div>
//     `;

//     await sendEmail({
//       to: userEmail,
//       subject,
//       html
//     });
//   } catch (error) {
//     console.error('Failed to send supplier activation email:', error);
//   }
// }



// Email functions
async function sendSupplierApprovalEmail(approverEmail, approverName, supplier, requestorName, previousLevel = 0) {
  try {
    const subject = `Supplier Approval Required: ${supplier.supplierDetails.companyName}`;
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const approvalLink = `${clientUrl}/admin/suppliers/approvals`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1890ff;">Supplier Approval Required</h2>
        <p>Dear ${approverName},</p>
        <p>A supplier requires your approval:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Company Name:</strong> ${supplier.supplierDetails.companyName}</p>
          <p><strong>Contact Person:</strong> ${supplier.supplierDetails.contactName}</p>
          <p><strong>Email:</strong> ${supplier.email}</p>
          <p><strong>Supplier Type:</strong> ${supplier.supplierDetails.supplierType}</p>
        </div>

        ${previousLevel > 0 ? `<p><strong>Previous Approver:</strong> ${requestorName}</p>` : ''}

        <p style="text-align: center;">
          <a href="${approvalLink}" style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Review Supplier
          </a>
        </p>
      </div>
    `;

    await sendEmail({ to: approverEmail, subject, html });
  } catch (error) {
    console.error('Failed to send approval email:', error);
  }
}

async function sendSupplierRejectionEmail(userEmail, userName, supplier, rejectedBy, reason) {
  try {
    const subject = `Supplier Application Rejected: ${supplier.supplierDetails.companyName}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ff4d4f;">Supplier Application Rejected</h2>
        <p>Dear ${userName},</p>
        <p>Your supplier application has been rejected:</p>
        
        <div style="background-color: #fff2f0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ff4d4f;">
          <p><strong>Company:</strong> ${supplier.supplierDetails.companyName}</p>
          <p><strong>Rejected by:</strong> ${rejectedBy}</p>
          <p><strong>Reason:</strong> ${reason}</p>
        </div>

        <p>If you believe this is an error, please contact our supply chain team.</p>
      </div>
    `;

    await sendEmail({ to: userEmail, subject, html });
  } catch (error) {
    console.error('Failed to send rejection email:', error);
  }
}

async function sendSupplierActivationEmail(userEmail, userName, supplier, approvedBy) {
  try {
    const subject = `Supplier Account Activated: ${supplier.supplierDetails.companyName}`;
    const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #52c41a;">✅ Supplier Account Activated</h2>
        <p>Dear ${userName},</p>
        <p>Congratulations! Your supplier account has been fully approved and activated:</p>
        
        <div style="background-color: #f6ffed; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #52c41a;">
          <p><strong>Company:</strong> ${supplier.supplierDetails.companyName}</p>
          <p><strong>Supplier Type:</strong> ${supplier.supplierDetails.supplierType}</p>
          <p><strong>Final Approved by:</strong> ${approvedBy}</p>
          <p><strong>Approval Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #1890ff;">
          <h3 style="margin-top: 0;">Login Credentials</h3>
          <p><strong>Email:</strong> ${userEmail}</p>
          <p><strong>Temporary Password:</strong> ChangeMe123!</p>
          <p style="color: #d46b08; font-size: 12px;">⚠️ Please change your password after first login</p>
        </div>

        <div style="background-color: #fff; padding: 15px; border: 1px solid #d9d9d9; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">What You Can Do Now:</h3>
          <ul style="padding-left: 20px;">
            <li>✓ Submit invoices for payment processing</li>
            <li>✓ Respond to RFQ requests</li>
            <li>✓ View and manage contracts</li>
            <li>✓ Track payment status</li>
            <li>✓ Update company profile</li>
          </ul>
        </div>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${clientUrl}/supplier/login" style="background-color: #52c41a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
            Access Supplier Portal →
          </a>
        </p>

        <div style="background-color: #fffbe6; padding: 10px; border-radius: 5px; margin: 20px 0; font-size: 12px;">
          <p style="margin: 5px 0;"><strong>Need Help?</strong></p>
          <p style="margin: 5px 0;">Contact our Supply Chain Team if you have any questions.</p>
        </div>

        <p style="color: #595959; font-size: 12px; border-top: 1px solid #d9d9d9; padding-top: 15px; margin-top: 30px;">
          Best regards,<br>
          <strong>Grato Engineering Supply Chain Team</strong>
        </p>
      </div>
    `;

    await sendEmail({
      to: userEmail,
      subject,
      html
    });
  } catch (error) {
    console.error('Failed to send supplier activation email:', error);
  }
}


/**
 * Get comprehensive supplier approval dashboard
 * Includes statistics, pending approvals, recent activity
 */
const getSupplierApprovalDashboard = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get all suppliers
    const allSuppliers = await User.find({ role: 'supplier' })
      .select('-password')
      .populate('supplierStatus.approvedBy', 'fullName email')
      .populate('supplierStatus.rejectedBy', 'fullName email')
      .sort({ createdAt: -1 });

    // Calculate statistics
    const { getSupplierApprovalStats } = require('../config/supplierApprovalChain');
    const stats = getSupplierApprovalStats(allSuppliers);

    // Get suppliers pending for current user
    const pendingForUser = allSuppliers.filter(supplier => {
      const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
      return currentStep && currentStep.approver.email === user.email;
    });

    // Get recently approved suppliers
    const recentlyApproved = allSuppliers
      .filter(s => s.supplierStatus.accountStatus === 'approved')
      .sort((a, b) => new Date(b.supplierStatus.approvalDate) - new Date(a.supplierStatus.approvalDate))
      .slice(0, 10);

    // Get recently rejected suppliers
    const recentlyRejected = allSuppliers
      .filter(s => s.supplierStatus.accountStatus === 'rejected')
      .sort((a, b) => new Date(b.supplierStatus.rejectionDate) - new Date(a.supplierStatus.rejectionDate))
      .slice(0, 5);

    // Get approval velocity (approvals per week)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const weeklyApprovals = allSuppliers.filter(s => 
      s.supplierStatus.accountStatus === 'approved' && 
      new Date(s.supplierStatus.approvalDate) >= oneWeekAgo
    ).length;

    // Get suppliers by type
    const suppliersByType = {};
    allSuppliers.forEach(supplier => {
      const type = supplier.supplierDetails.supplierType;
      if (!suppliersByType[type]) {
        suppliersByType[type] = {
          total: 0,
          approved: 0,
          pending: 0,
          rejected: 0
        };
      }
      suppliersByType[type].total++;
      
      const status = supplier.supplierStatus.accountStatus;
      if (status === 'approved') suppliersByType[type].approved++;
      else if (status === 'rejected') suppliersByType[type].rejected++;
      else suppliersByType[type].pending++;
    });

    // Calculate average approval time
    const approvedWithTime = allSuppliers
      .filter(s => s.supplierStatus.accountStatus === 'approved' && s.supplierStatus.approvalDate)
      .map(s => ({
        supplier: s,
        approvalTime: (new Date(s.supplierStatus.approvalDate) - new Date(s.createdAt)) / (1000 * 60 * 60 * 24) // days
      }));

    const avgApprovalTime = approvedWithTime.length > 0
      ? approvedWithTime.reduce((sum, item) => sum + item.approvalTime, 0) / approvedWithTime.length
      : 0;

    res.json({
      success: true,
      data: {
        statistics: {
          ...stats,
          weeklyApprovals,
          averageApprovalTimeDays: Math.round(avgApprovalTime * 10) / 10
        },
        userPending: {
          count: pendingForUser.length,
          suppliers: pendingForUser.slice(0, 10)
        },
        recentActivity: {
          approved: recentlyApproved,
          rejected: recentlyRejected
        },
        suppliersByType,
        userInfo: {
          canApprove: user.role === 'admin' || user.role === 'supply_chain' || user.role === 'finance',
          approvalLevel: require('../config/supplierApprovalChain').getUserSupplierApprovalLevel(user.role, user.email)
        }
      }
    });

  } catch (error) {
    console.error('Get supplier approval dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard',
      error: error.message
    });
  }
};

/**
 * Get supplier approval timeline/history
 * Shows complete approval journey for a supplier
 */
const getSupplierApprovalTimeline = async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    const supplier = await User.findById(supplierId)
      .select('-password')
      .populate('supplierStatus.approvedBy', 'fullName email')
      .populate('supplierStatus.rejectedBy', 'fullName email');

    if (!supplier || supplier.role !== 'supplier') {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Build timeline
    const timeline = [];

    // Registration event
    timeline.push({
      event: 'registered',
      title: 'Supplier Registered',
      description: `${supplier.supplierDetails.companyName} registered as ${supplier.supplierDetails.supplierType} supplier`,
      timestamp: supplier.createdAt,
      icon: 'user-plus',
      color: 'blue'
    });

    // Email verification
    if (supplier.supplierStatus.emailVerified) {
      timeline.push({
        event: 'email_verified',
        title: 'Email Verified',
        description: 'Email address verified successfully',
        timestamp: supplier.createdAt, // Could add separate field for this
        icon: 'mail-check',
        color: 'green'
      });
    }

    // Approval chain events
    supplier.approvalChain?.forEach(step => {
      if (step.status === 'approved') {
        timeline.push({
          event: 'approval_step',
          level: step.level,
          title: `Approved by ${step.approver.role}`,
          description: `${step.approver.name} approved`,
          comments: step.comments,
          timestamp: step.actionDate,
          actionTime: step.actionTime,
          icon: 'check-circle',
          color: 'green',
          approver: {
            name: step.approver.name,
            email: step.approver.email,
            role: step.approver.role
          },
          signature: step.signature
        });
      } else if (step.status === 'rejected') {
        timeline.push({
          event: 'rejection',
          level: step.level,
          title: `Rejected by ${step.approver.role}`,
          description: `${step.approver.name} rejected the application`,
          comments: step.comments,
          timestamp: step.actionDate,
          actionTime: step.actionTime,
          icon: 'x-circle',
          color: 'red',
          approver: {
            name: step.approver.name,
            email: step.approver.email,
            role: step.approver.role
          }
        });
      } else if (step.status === 'pending') {
        timeline.push({
          event: 'pending_approval',
          level: step.level,
          title: `Awaiting ${step.approver.role} Approval`,
          description: `Pending review by ${step.approver.name}`,
          timestamp: step.assignedDate,
          icon: 'clock',
          color: 'orange',
          approver: {
            name: step.approver.name,
            email: step.approver.email,
            role: step.approver.role
          },
          isPending: true
        });
      }
    });

    // Final activation
    if (supplier.supplierStatus.accountStatus === 'approved') {
      timeline.push({
        event: 'activated',
        title: 'Supplier Account Activated',
        description: 'Supplier account fully approved and activated',
        timestamp: supplier.supplierStatus.approvalDate,
        icon: 'check-circle-2',
        color: 'green'
      });
    }

    // Sort timeline by timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({
      success: true,
      data: {
        supplier: {
          id: supplier._id,
          companyName: supplier.supplierDetails.companyName,
          contactName: supplier.supplierDetails.contactName,
          email: supplier.email,
          supplierType: supplier.supplierDetails.supplierType,
          currentStatus: supplier.supplierStatus.accountStatus,
          approvalProgress: supplier.approvalProgress
        },
        timeline,
        currentStep: supplier.getCurrentApprovalStep(),
        approvalChainSummary: {
          totalLevels: supplier.approvalChain?.length || 0,
          completedLevels: supplier.approvalChain?.filter(s => s.status === 'approved').length || 0,
          currentLevel: supplier.currentApprovalLevel,
          progress: supplier.approvalProgress
        }
      }
    });

  } catch (error) {
    console.error('Get supplier approval timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch timeline',
      error: error.message
    });
  }
};

/**
 * Bulk approve/reject suppliers
 * Admin function to process multiple suppliers at once
 */
const bulkProcessSupplierApprovals = async (req, res) => {
  try {
    const { supplierIds, decision, comments } = req.body;

    if (!supplierIds || !Array.isArray(supplierIds) || supplierIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Supplier IDs array is required'
      });
    }

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Decision must be approved or rejected'
      });
    }

    const user = await User.findById(req.user.userId);
    const results = {
      successful: [],
      failed: []
    };

    for (const supplierId of supplierIds) {
      try {
        const supplier = await User.findById(supplierId);
        
        if (!supplier || supplier.role !== 'supplier') {
          results.failed.push({
            supplierId,
            error: 'Supplier not found'
          });
          continue;
        }

        // Validate approval permission
        const { validateSupplierApproval } = require('../config/supplierApprovalChain');
        const validation = validateSupplierApproval(user, supplier);
        
        if (!validation.canApprove) {
          results.failed.push({
            supplierId,
            companyName: supplier.supplierDetails.companyName,
            error: validation.reason
          });
          continue;
        }

        // Process approval (reuse logic from processSupplierApproval)
        const currentStep = supplier.approvalChain.find(step => step.status === 'pending');
        if (!currentStep) {
          results.failed.push({
            supplierId,
            companyName: supplier.supplierDetails.companyName,
            error: 'No pending approval step'
          });
          continue;
        }

        currentStep.status = decision === 'approved' ? 'approved' : 'rejected';
        currentStep.decision = decision;
        currentStep.comments = comments;
        currentStep.actionDate = new Date();
        currentStep.actionTime = new Date().toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: true 
        });

        if (user.signature && user.signature.url) {
          currentStep.signature = {
            url: user.signature.url,
            signedAt: new Date(),
            signedBy: user.fullName
          };
        }

        if (decision === 'rejected') {
          supplier.supplierStatus.accountStatus = 'rejected';
          supplier.supplierStatus.rejectionReason = comments;
          supplier.supplierStatus.rejectedBy = req.user.userId;
          supplier.supplierStatus.rejectionDate = new Date();
          supplier.isActive = false;
        } else {
          const { getNextSupplierStatus } = require('../config/supplierApprovalChain');
          const nextStepIndex = supplier.approvalChain.findIndex(
            step => step.level === currentStep.level + 1
          );

          if (nextStepIndex === -1) {
            // Final approval
            supplier.supplierStatus.accountStatus = 'approved';
            supplier.supplierStatus.approvalDate = new Date();
            supplier.supplierStatus.approvedBy = req.user.userId;
            supplier.isActive = true;
          } else {
            supplier.supplierStatus.accountStatus = getNextSupplierStatus(
              currentStep.level,
              supplier.approvalChain.length
            );
          }
        }

        await supplier.save();

        results.successful.push({
          supplierId: supplier._id,
          companyName: supplier.supplierDetails.companyName,
          decision,
          newStatus: supplier.supplierStatus.accountStatus
        });

      } catch (error) {
        results.failed.push({
          supplierId,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.successful.length} suppliers successfully, ${results.failed.length} failed`,
      data: results
    });

  } catch (error) {
    console.error('Bulk process supplier approvals error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk approvals',
      error: error.message
    });
  }
};


/**
 * Get supplier approval statistics
 * Returns counts by approval status for dashboard metrics
 */
const getSupplierApprovalStats = async (req, res) => {
  try {
    console.log('=== GET SUPPLIER APPROVAL STATISTICS ===');
    
    const User = require('../models/User');
    const { getSupplierApprovalStats: calculateStats } = require('../config/supplierApprovalChain');
    
    // Get all suppliers
    const suppliers = await User.find({ role: 'supplier' });
    
    // Calculate statistics
    const stats = calculateStats(suppliers);
    
    console.log('Approval statistics:', stats);
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('Get supplier approval statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approval statistics',
      error: error.message
    });
  }
};

module.exports = {
  processSupplierApproval,
  getPendingApprovalsForUser,
  getSupplierWithApprovalDetails,

  getSupplierApprovalDashboard,
  getSupplierApprovalTimeline,
  bulkProcessSupplierApprovals,
  getSupplierApprovalStats
};