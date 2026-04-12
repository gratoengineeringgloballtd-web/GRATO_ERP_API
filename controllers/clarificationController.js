/**
 * Controller for handling clarification requests in purchase requisitions
 * Allows approvers to send requisitions back to previous approvers for more information
 * without fully rejecting and starting over
 */

const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');

/**
 * Request clarification from a previous approver
 * POST /api/purchase-requisitions/:requisitionId/request-clarification
 */
const requestClarification = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { targetApproverEmail, message } = req.body;
    const userId = req.user.userId;

    console.log('=== REQUEST CLARIFICATION ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Requester:', userId);
    console.log('Target:', targetApproverEmail);

    // Validation
    if (!targetApproverEmail || !message) {
      return res.status(400).json({
        success: false,
        message: 'Target approver and clarification message are required'
      });
    }

    // Find requisition
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Find current user in approval chain
    const currentUser = await User.findById(userId);
    const currentApproverIndex = requisition.approvalChain.findIndex(
      step => step.approver.email.toLowerCase() === currentUser.email.toLowerCase()
    );

    if (currentApproverIndex === -1) {
      return res.status(403).json({
        success: false,
        message: 'You are not an approver in this requisition workflow'
      });
    }

    const currentApprover = requisition.approvalChain[currentApproverIndex];

    // Check if current approver is the active one (their turn to approve)
    const pendingApproverIndex = requisition.approvalChain.findIndex(
      step => step.status === 'pending'
    );

    if (pendingApproverIndex !== currentApproverIndex) {
      return res.status(403).json({
        success: false,
        message: 'It is not your turn to review this requisition'
      });
    }

    // Find target approver in chain (must have already approved)
    const targetApproverIndex = requisition.approvalChain.findIndex(
      step => step.approver.email.toLowerCase() === targetApproverEmail.toLowerCase()
    );

    if (targetApproverIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'Target approver not found in this requisition workflow'
      });
    }

    const targetApprover = requisition.approvalChain[targetApproverIndex];

    // Target must have already approved (can't send to pending or rejected approvers)
    if (targetApprover.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'You can only request clarification from approvers who have already approved this requisition'
      });
    }

    // Target must be before current approver in chain
    if (targetApproverIndex >= currentApproverIndex) {
      return res.status(400).json({
        success: false,
        message: 'You can only request clarification from previous approvers in the workflow'
      });
    }

    // Find the target user to get their user ID
    const targetUser = await User.findOne({ email: targetApproverEmail });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Target approver user not found'
      });
    }

    // Update target approver's status to needs_clarification
    requisition.approvalChain[targetApproverIndex].status = 'needs_clarification';
    requisition.approvalChain[targetApproverIndex].clarificationRequest = {
      requestedBy: userId,
      requesterName: currentUser.fullName,
      requesterRole: currentApprover.approver.role,
      message: message,
      requestedAt: new Date()
    };

    // Add to clarification requests history
    requisition.clarificationRequests.push({
      requestedBy: userId,
      requesterName: currentUser.fullName,
      requesterRole: currentApprover.approver.role,
      requesterLevel: currentApprover.level,
      requestedTo: targetUser._id,
      recipientName: targetApprover.approver.name,
      recipientRole: targetApprover.approver.role,
      recipientLevel: targetApprover.level,
      message: message,
      requestedAt: new Date(),
      status: 'pending'
    });

    // Update requisition status
    const previousStatus = requisition.status;
    requisition.status = 'pending_clarification';

    await requisition.save();

    console.log('✅ Clarification requested successfully');
    console.log(`   From: ${currentUser.fullName} (Level ${currentApprover.level})`);
    console.log(`   To: ${targetApprover.approver.name} (Level ${targetApprover.level})`);

    // Send email notification to target approver
    try {
      await sendEmail({
        to: targetApprover.approver.email,
        subject: `Clarification Requested - ${requisition.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #fff7e6; padding: 20px; border-radius: 8px; border-left: 4px solid #faad14;">
              <h2 style="color: #faad14; margin-top: 0;">ℹ️ Clarification Requested</h2>
              <p>Dear ${targetApprover.approver.name},</p>
              <p><strong>${currentUser.fullName}</strong> (${currentApprover.approver.role}) has requested clarification on a purchase requisition that you previously approved.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4>Requisition Details</h4>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Requester:</strong> ${requisition.employee.fullName}</li>
                  <li><strong>Department:</strong> ${requisition.department}</li>
                  <li><strong>Budget:</strong> XAF ${requisition.budgetXAF?.toLocaleString() || 'N/A'}</li>
                </ul>
              </div>

              <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4 style="color: #1890ff; margin-top: 0;">Clarification Needed</h4>
                <p style="font-style: italic; white-space: pre-wrap;">${message}</p>
              </div>

              <div style="background-color: #f6ffed; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <p style="margin: 0;"><strong>Action Required:</strong> Please review the requisition and provide the requested clarification. Your response will help ${currentUser.fullName} make an informed decision.</p>
              </div>

              <p style="margin-top: 20px;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}/purchase-requisitions" 
                   style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
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

      console.log('✅ Clarification email sent');
    } catch (emailError) {
      console.error('Failed to send clarification email:', emailError);
      // Don't fail the request if email fails
    }

    // Send notification to requester
    try {
      await sendEmail({
        to: requisition.employee.email,
        subject: `Clarification Requested - ${requisition.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
              <h2 style="color: #1890ff; margin-top: 0;">ℹ️ Clarification Requested</h2>
              <p>Dear ${requisition.employee.fullName},</p>
              <p>Your purchase requisition is currently on hold while <strong>${targetApprover.approver.name}</strong> provides additional clarification requested by <strong>${currentUser.fullName}</strong>.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4>Requisition Details</h4>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Status:</strong> Pending Clarification</li>
                </ul>
              </div>

              <p>You will be notified once the clarification is provided and the review continues.</p>

              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                This is an automated notification from the ERP System.
              </p>
            </div>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Failed to send notification to requester:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Clarification requested successfully',
      data: {
        requisitionId: requisition._id,
        status: requisition.status,
        clarificationSentTo: targetApprover.approver.name
      }
    });

  } catch (error) {
    console.error('Request clarification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to request clarification',
      error: error.message
    });
  }
};

/**
 * Provide clarification response
 * POST /api/purchase-requisitions/:requisitionId/provide-clarification
 */
const provideClarification = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { response } = req.body;
    const userId = req.user.userId;

    console.log('=== PROVIDE CLARIFICATION ===');
    console.log('Requisition ID:', requisitionId);
    console.log('User:', userId);

    if (!response) {
      return res.status(400).json({
        success: false,
        message: 'Clarification response is required'
      });
    }

    // Find requisition
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    if (requisition.status !== 'pending_clarification') {
      return res.status(400).json({
        success: false,
        message: 'This requisition is not pending clarification'
      });
    }

    // Find current user in approval chain
    const currentUser = await User.findById(userId);
    const approverIndex = requisition.approvalChain.findIndex(
      step => step.approver.email.toLowerCase() === currentUser.email.toLowerCase() &&
              step.status === 'needs_clarification'
    );

    if (approverIndex === -1) {
      return res.status(403).json({
        success: false,
        message: 'No clarification request found for you on this requisition'
      });
    }

    const approver = requisition.approvalChain[approverIndex];

    // Update approval chain step
    approver.status = 'clarification_provided';
    approver.clarificationResponse = {
      message: response,
      respondedAt: new Date()
    };

    // Update clarification requests history
    const clarificationRequest = requisition.clarificationRequests
      .reverse() // Get most recent first
      .find(cr => 
        cr.requestedTo.toString() === userId &&
        cr.status === 'pending'
      );

    if (clarificationRequest) {
      clarificationRequest.response = response;
      clarificationRequest.respondedAt = new Date();
      clarificationRequest.status = 'responded';
    }

    // Find who requested the clarification (next pending approver)
    const requesterIndex = requisition.approvalChain.findIndex(
      step => step.status === 'pending'
    );

    if (requesterIndex === -1) {
      return res.status(500).json({
        success: false,
        message: 'Could not find the approver who requested clarification'
      });
    }

    const requester = requisition.approvalChain[requesterIndex];

    // Change status back to the original pending state
    // Determine the correct status based on requester's role
    const statusMap = {
      'Supervisor': 'pending_supervisor',
      'Finance': 'pending_finance_verification',
      'Supply Chain': 'pending_supply_chain_review',
      'Department Head': 'pending_head_approval'
    };
    
    requisition.status = statusMap[requester.approver.role] || 'pending_supervisor';

    await requisition.save();

    console.log('✅ Clarification provided successfully');
    console.log(`   By: ${currentUser.fullName} (Level ${approver.level})`);
    console.log(`   To: ${requester.approver.name} (Level ${requester.level})`);

    // Send email to requester
    try {
      await sendEmail({
        to: requester.approver.email,
        subject: `Clarification Provided - ${requisition.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
              <h2 style="color: #52c41a; margin-top: 0;">✅ Clarification Provided</h2>
              <p>Dear ${requester.approver.name},</p>
              <p><strong>${currentUser.fullName}</strong> has provided the clarification you requested.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4>Requisition Details</h4>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Requester:</strong> ${requisition.employee.fullName}</li>
                  <li><strong>Budget:</strong> XAF ${requisition.budgetXAF?.toLocaleString() || 'N/A'}</li>
                </ul>
              </div>

              <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4 style="color: #1890ff; margin-top: 0;">Your Question</h4>
                <p style="font-style: italic; white-space: pre-wrap;">${approver.clarificationRequest.message}</p>
              </div>

              <div style="background-color: #f6ffed; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4 style="color: #52c41a; margin-top: 0;">Response</h4>
                <p style="white-space: pre-wrap;">${response}</p>
              </div>

              <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <p style="margin: 0;"><strong>Action Required:</strong> Please review the clarification and continue with your approval decision.</p>
              </div>

              <p style="margin-top: 20px;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}/purchase-requisitions" 
                   style="background-color: #52c41a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                  Review Requisition
                </a>
              </p>

              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                This is an automated notification from the ERP System.
              </p>
            </div>
          </div>
        `
      });

      console.log('✅ Response email sent to requester');
    } catch (emailError) {
      console.error('Failed to send response email:', emailError);
    }

    // Notify the original requester
    try {
      await sendEmail({
        to: requisition.employee.email,
        subject: `Review Continuing - ${requisition.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
              <h2 style="color: #1890ff; margin-top: 0;">📝 Clarification Provided</h2>
              <p>Dear ${requisition.employee.fullName},</p>
              <p>The requested clarification has been provided, and your requisition review is continuing.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Status:</strong> Under Review</li>
                </ul>
              </div>

              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                This is an automated notification from the ERP System.
              </p>
            </div>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Failed to send notification to original requester:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Clarification provided successfully',
      data: {
        requisitionId: requisition._id,
        status: requisition.status
      }
    });

  } catch (error) {
    console.error('Provide clarification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to provide clarification',
      error: error.message
    });
  }
};

/**
 * Get clarification history for a requisition
 * GET /api/purchase-requisitions/:requisitionId/clarification-history
 */
const getClarificationHistory = async (req, res) => {
  try {
    const { requisitionId } = req.params;

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('clarificationRequests.requestedBy', 'fullName email')
      .populate('clarificationRequests.requestedTo', 'fullName email')
      .select('clarificationRequests');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        clarificationRequests: requisition.clarificationRequests
      }
    });

  } catch (error) {
    console.error('Get clarification history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clarification history',
      error: error.message
    });
  }
};

module.exports = {
  requestClarification,
  provideClarification,
  getClarificationHistory
};
