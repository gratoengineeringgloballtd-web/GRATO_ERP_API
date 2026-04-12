const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');

const NON_CANCELLABLE_STATUSES = [
  'draft',
  'partially_disbursed',
  'fully_disbursed',
  'cancelled',
  'pending_cancellation',
  'rejected',
  'supply_chain_rejected',
  'completed',
  'justification_pending_supervisor',
  'justification_pending_finance',
  'justification_pending_supply_chain',
  'justification_pending_head',
  'justification_rejected',
  'justification_approved'
];

/**
 * POST /:requisitionId/request-cancellation
 * Only the original requester can initiate
 */
const requestCancellation = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a cancellation reason (minimum 10 characters)'
      });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    // Only the original requester can cancel
    if (requisition.employee._id.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the original requester can cancel this PR'
      });
    }

    if (NON_CANCELLABLE_STATUSES.includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: `This PR cannot be cancelled at its current stage: ${requisition.status.replace(/_/g, ' ')}`
      });
    }

    if (!requisition.approvalChain || requisition.approvalChain.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No approval chain found for this requisition'
      });
    }

    const previousStatus = requisition.status;

    // Build a fresh cancellation approval chain from the original chain
    const cancellationApprovalChain = requisition.approvalChain.map(step => ({
      level: step.level,
      approver: {
        name: step.approver.name,
        email: step.approver.email,
        role: step.approver.role,
        department: step.approver.department
      },
      status: 'pending',
      comments: '',
      actionDate: null,
      decidedBy: null
    }));

    requisition.cancellationRequest = {
      requestedBy: req.user.userId,
      reason: reason.trim(),
      requestedAt: new Date(),
      previousStatus,
      approvalChain: cancellationApprovalChain,
      finalDecision: 'pending',
      finalizedAt: null
    };

    requisition.status = 'pending_cancellation';
    await requisition.save();

    // Notify level 1 approver
    const firstApprover = cancellationApprovalChain[0];
    if (firstApprover) {
      await sendEmail({
        to: firstApprover.approver.email,
        subject: `PR Cancellation Request — ${requisition.requisitionNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #fff2f0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff4d4f;">
              <h2 style="color: #cf1322; margin-top: 0;">⚠️ PR Cancellation Request</h2>
              <p>Dear ${firstApprover.approver.name},</p>
              <p><strong>${requisition.employee.fullName}</strong> has requested to cancel a purchase requisition and needs your approval.</p>
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <ul>
                  <li><strong>Requisition:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Department:</strong> ${requisition.employee.department}</li>
                  <li><strong>Budget:</strong> XAF ${(requisition.budgetXAF || 0).toLocaleString()}</li>
                  <li><strong>Status at request:</strong> ${previousStatus.replace(/_/g, ' ').toUpperCase()}</li>
                </ul>
              </div>
              <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px;">
                <strong>Reason for Cancellation:</strong>
                <p style="margin: 8px 0 0 0; font-style: italic;">"${reason}"</p>
              </div>
              <p style="margin-top: 16px;">Please log in to approve or reject this cancellation request.</p>
            </div>
          </div>
        `
      }).catch(err => console.error('Failed to notify first approver:', err));
    }

    res.json({
      success: true,
      message: 'Cancellation request submitted. Awaiting approval chain.',
      data: {
        status: requisition.status,
        cancellationRequest: requisition.cancellationRequest
      }
    });

  } catch (error) {
    console.error('Request cancellation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit cancellation request',
      error: error.message
    });
  }
};

/**
 * POST /:requisitionId/process-cancellation
 * Any approver in the cancellation chain processes their level
 */
const processCancellationApproval = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be approved or rejected' });
    }

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    if (requisition.status !== 'pending_cancellation') {
      return res.status(400).json({
        success: false,
        message: 'This requisition is not awaiting cancellation approval'
      });
    }

    if (!requisition.cancellationRequest) {
      return res.status(400).json({ success: false, message: 'No cancellation request found' });
    }

    // Find this user's step — must be pending and all prior steps must be approved
    const chain = requisition.cancellationRequest.approvalChain;
    const stepIndex = chain.findIndex(
      step => step.approver.email.toLowerCase() === user.email.toLowerCase() && step.status === 'pending'
    );

    if (stepIndex === -1) {
      return res.status(403).json({
        success: false,
        message: 'You are not an authorized approver for this cancellation, or you have already acted on it'
      });
    }

    // All prior levels must be approved before this level can act
    const priorLevelsApproved = chain.slice(0, stepIndex).every(s => s.status === 'approved');
    if (!priorLevelsApproved) {
      return res.status(400).json({
        success: false,
        message: 'Prior approval levels have not yet been completed'
      });
    }

    // Record this decision
    requisition.cancellationRequest.approvalChain[stepIndex].status = decision;
    requisition.cancellationRequest.approvalChain[stepIndex].comments = comments || '';
    requisition.cancellationRequest.approvalChain[stepIndex].actionDate = new Date();
    requisition.cancellationRequest.approvalChain[stepIndex].decidedBy = req.user.userId;

    if (decision === 'rejected') {
      // Cancellation is rejected — restore the PR to its previous active status
      requisition.cancellationRequest.finalDecision = 'rejected';
      requisition.cancellationRequest.finalizedAt = new Date();
      requisition.status = requisition.cancellationRequest.previousStatus;

      await requisition.save();

      await sendEmail({
        to: requisition.employee.email,
        subject: `Cancellation Request Rejected — ${requisition.requisitionNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
              <h2 style="color: #721c24; margin-top: 0;">❌ Cancellation Request Rejected</h2>
              <p>Dear ${requisition.employee.fullName},</p>
              <p>Your request to cancel <strong>${requisition.title} (${requisition.requisitionNumber})</strong> has been rejected by <strong>${user.fullName}</strong>.</p>
              ${comments ? `
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <strong>Reason for Rejection:</strong>
                <p style="font-style: italic; margin: 8px 0 0 0;">"${comments}"</p>
              </div>` : ''}
              <p>Your PR has been restored to its active state and the procurement process continues.</p>
            </div>
          </div>
        `
      }).catch(err => console.error('Failed to notify employee of rejection:', err));

      return res.json({
        success: true,
        message: 'Cancellation rejected. PR restored to its previous status.',
        data: { status: requisition.status }
      });
    }

    // decision === 'approved' — check if all levels are now approved
    const allApproved = requisition.cancellationRequest.approvalChain.every(s => s.status === 'approved');

    if (allApproved) {
      // Final approval reached — cancel the PR
      requisition.cancellationRequest.finalDecision = 'approved';
      requisition.cancellationRequest.finalizedAt = new Date();
      requisition.status = 'cancelled';

      // Budget note: budget.used is only incremented on disbursement (processDisbursement).
      // Since cancellation is blocked after disbursement, totalDisbursed should be 0 here.
      // No budget release action required.
      console.log(`✅ PR ${requisition.requisitionNumber} cancelled. Budget code: ${requisition.budgetCode} — no disbursement had occurred.`);

      await requisition.save();

      await sendEmail({
        to: requisition.employee.email,
        subject: `PR Successfully Cancelled — ${requisition.requisitionNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
              <h2 style="color: #135200; margin-top: 0;">✅ PR Successfully Cancelled</h2>
              <p>Dear ${requisition.employee.fullName},</p>
              <p>Your purchase requisition has been fully approved for cancellation by all required approvers.</p>
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <ul>
                  <li><strong>Requisition:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Cancelled on:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
                </ul>
              </div>
              <p>You may now submit a revised purchase requisition with the updated requirements.</p>
            </div>
          </div>
        `
      }).catch(err => console.error('Failed to notify employee of cancellation:', err));

      return res.json({
        success: true,
        message: 'All approvals received. PR has been cancelled.',
        data: { status: 'cancelled' }
      });

    } else {
      // More levels to go — save and notify next approver
      await requisition.save();

      const nextStep = chain.find((s, idx) => idx > stepIndex && s.status === 'pending');
      if (nextStep) {
        await sendEmail({
          to: nextStep.approver.email,
          subject: `PR Cancellation — Your Approval Required — ${requisition.requisitionNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #fff2f0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff4d4f;">
                <h2 style="color: #cf1322; margin-top: 0;">⚠️ PR Cancellation Needs Your Approval</h2>
                <p>Dear ${nextStep.approver.name},</p>
                <p>A purchase requisition cancellation has been approved at the previous level and now requires your approval.</p>
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <ul>
                    <li><strong>Requisition:</strong> ${requisition.requisitionNumber}</li>
                    <li><strong>Title:</strong> ${requisition.title}</li>
                    <li><strong>Requested by:</strong> ${requisition.employee.fullName}</li>
                    <li><strong>Approved so far:</strong> ${stepIndex + 1} of ${chain.length} levels</li>
                  </ul>
                </div>
                <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px;">
                  <strong>Cancellation Reason:</strong>
                  <p style="font-style: italic; margin: 8px 0 0 0;">"${requisition.cancellationRequest.reason}"</p>
                </div>
                <p style="margin-top: 16px;">Please log in to review and process this request.</p>
              </div>
            </div>
          `
        }).catch(err => console.error('Failed to notify next approver:', err));
      }

      return res.json({
        success: true,
        message: `Approved at level ${stepIndex + 1}. Forwarded to next approver.`,
        data: { status: requisition.status }
      });
    }

  } catch (error) {
    console.error('Process cancellation approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process cancellation approval',
      error: error.message
    });
  }
};

/**
 * GET /cancellation-requests
 * Returns requisitions where the current user is the next pending approver in cancellation chain
 */
const getCancellationRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    const requisitions = await PurchaseRequisition.find({
      status: 'pending_cancellation',
      'cancellationRequest.approvalChain': {
        $elemMatch: {
          'approver.email': user.email.toLowerCase(),
          'status': 'pending'
        }
      }
    })
      .populate('employee', 'fullName email department')
      .sort({ 'cancellationRequest.requestedAt': -1 });

    // Filter to only those where all prior levels are approved (sequential)
    const actionable = requisitions.filter(req => {
      const chain = req.cancellationRequest?.approvalChain || [];
      const myIndex = chain.findIndex(
        s => s.approver.email.toLowerCase() === user.email.toLowerCase() && s.status === 'pending'
      );
      if (myIndex === -1) return false;
      return chain.slice(0, myIndex).every(s => s.status === 'approved');
    });

    res.json({
      success: true,
      data: actionable,
      count: actionable.length
    });

  } catch (error) {
    console.error('Get cancellation requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cancellation requests',
      error: error.message
    });
  }
};

module.exports = {
  requestCancellation,
  processCancellationApproval,
  getCancellationRequests
};