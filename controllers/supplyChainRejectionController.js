/**
 * Controller for Supply Chain to reject requisitions
 */

const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');

/**
 * Reject requisition from Supply Chain
 * POST /api/purchase-requisitions/:requisitionId/supply-chain-reject
 */
const rejectSupplyChainRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { rejectionReason } = req.body;

    console.log('=== SUPPLY CHAIN REJECTION ===');
    console.log('Requisition ID:', requisitionId);
    console.log('User:', req.user.userId);

    // Validation
    if (!rejectionReason || rejectionReason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a detailed rejection reason (minimum 10 characters)'
      });
    }

    const user = await User.findById(req.user.userId);
    
    // Verify user is Supply Chain or Admin
    const canReject = 
      user.role === 'admin' ||
      user.role === 'supply_chain' ||
      user.email === 'lukong.lambert@gratoglobal.com';
    
    if (!canReject) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Supply Chain Coordinator can reject requisitions.'
      });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Must be at supply chain review stage
    if (requisition.status !== 'pending_supply_chain_review') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject at this stage. Current status: ${requisition.status}`
      });
    }

    // Store rejection in history
    const rejectionEntry = {
      rejectedBy: req.user.userId,
      rejectorName: user.fullName,
      rejectorRole: 'Supply Chain',
      rejectionDate: new Date(),
      rejectionReason: rejectionReason.trim(),
      approvalLevel: 'Supply Chain Review',
      previousStatus: requisition.status,
      approvalChainSnapshot: requisition.approvalChain.map(step => ({
        level: step.level,
        approver: {
          name: step.approver.name,
          email: step.approver.email,
          role: step.approver.role
        },
        status: step.status,
        comments: step.comments,
        actionDate: step.actionDate
      })),
      resubmitted: false
    };

    requisition.rejectionHistory.push(rejectionEntry);

    // Update approval chain
    const supplyChainStepIndex = requisition.approvalChain.findIndex(
      step => step.approver.email.toLowerCase() === user.email.toLowerCase() && 
              step.status === 'pending'
    );

    if (supplyChainStepIndex !== -1) {
      requisition.approvalChain[supplyChainStepIndex].status = 'rejected';
      requisition.approvalChain[supplyChainStepIndex].comments = rejectionReason.trim();
      requisition.approvalChain[supplyChainStepIndex].actionDate = new Date();
      requisition.approvalChain[supplyChainStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[supplyChainStepIndex].decidedBy = req.user.userId;
    }

    // Update supply chain review
    requisition.supplyChainReview = {
      ...requisition.supplyChainReview,
      decision: 'reject',
      comments: rejectionReason.trim(),
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };

    // Update status
    requisition.status = 'supply_chain_rejected';

    await requisition.save();

    console.log('✅ Requisition rejected by Supply Chain');
    console.log(`   Rejected by: ${user.fullName}`);
    console.log(`   Reason: ${rejectionReason.substring(0, 50)}...`);

    // Send email notification to employee
    try {
      await sendEmail({
        to: requisition.employee.email,
        subject: `Purchase Requisition Rejected by Supply Chain - ${requisition.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #fff2f0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff4d4f;">
              <h2 style="color: #ff4d4f; margin-top: 0;">✗ Purchase Requisition Rejected</h2>
              <p>Dear ${requisition.employee.fullName},</p>
              <p>Unfortunately, your purchase requisition has been rejected by the Supply Chain team.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4>Requisition Details</h4>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Budget:</strong> XAF ${requisition.budgetXAF?.toLocaleString() || 'N/A'}</li>
                  <li><strong>Rejected by:</strong> ${user.fullName} (Supply Chain)</li>
                  <li><strong>Rejection Date:</strong> ${new Date().toLocaleString('en-GB')}</li>
                </ul>
              </div>

              <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4 style="color: #fa8c16; margin-top: 0;">Reason for Rejection</h4>
                <p style="white-space: pre-wrap;">${rejectionReason.trim()}</p>
              </div>

              <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4 style="color: #1890ff; margin-top: 0;">What You Can Do</h4>
                <p>You can resubmit this requisition with the necessary corrections:</p>
                <ol>
                  <li>Review the rejection reason carefully</li>
                  <li>Make the necessary changes or provide additional information</li>
                  <li>Click the "Resubmit" button on your rejected requisition</li>
                  <li>Update the details and provide resubmission notes</li>
                </ol>
                <p>If you have questions about this rejection, please contact the Supply Chain team.</p>
              </div>

              <p style="margin-top: 20px;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}/employee/requisitions" 
                   style="background-color: #ff4d4f; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                  View Requisition
                </a>
              </p>

              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                This is an automated notification from the ERP System. Please do not reply to this email.
              </p>
            </div>
          </div>
        `
      });

      console.log('✅ Rejection email sent to employee');
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Don't fail the rejection if email fails
    }

    res.status(200).json({
      success: true,
      message: 'Requisition rejected successfully',
      data: {
        requisitionId: requisition._id,
        status: requisition.status,
        rejectedBy: user.fullName
      }
    });

  } catch (error) {
    console.error('Supply chain rejection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject requisition',
      error: error.message
    });
  }
};

module.exports = {
  rejectSupplyChainRequisition
};
