const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');
const { getEffectiveCEOApprover } = require('../config/ceoApprovalConfig');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: roles that can access the head-approval endpoints
// Kelvin (supply_chain/admin) acts as HOB; CEO/Tom has read + final approval.
// ─────────────────────────────────────────────────────────────────────────────
const HEAD_APPROVAL_ROLES = ['admin', 'supply_chain', 'ceo'];

/**
 * Get requisitions pending head approval
 */
const getPendingHeadApprovals = async (req, res) => {
  try {
    const { status, tab, page = 1, limit = 20 } = req.query;

    console.log('=== GET PENDING HEAD APPROVALS ===');
    console.log('User:', req.user.userId);
    console.log('Filters:', { status, tab });

    const user = await User.findById(req.user.userId);

    if (!HEAD_APPROVAL_ROLES.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.'
      });
    }

    // ── CEO sees items at pending_ceo step; HOB sees pending_head_approval ──
    let query = {};

    if (user.role === 'ceo') {
      // CEO only sees what is pending their specific approval step
      switch (tab) {
        case 'pending':
          query.status = { $in: ['pending_ceo'] };
          break;
        case 'approved':
          query.status = 'approved';
          break;
        case 'rejected':
          query.status = 'rejected';
          break;
        case 'all':
        default:
          query.status = { $in: ['pending_ceo', 'approved', 'rejected'] };
      }
    } else {
      // Kelvin / admin sees the full head-approval queue
      switch (tab) {
        case 'pending':
          query.status = { $in: ['pending_head_approval', 'justification_pending_head'] };
          break;
        case 'approved':
          query.status = { $in: ['approved', 'justification_approved'] };
          query.$or = [
            { 'headApproval.decision': 'approved' },
            { 'justification.headReview.decision': 'approved' }
          ];
          break;
        case 'rejected':
          query.status = { $in: ['rejected', 'justification_rejected'] };
          query.$or = [
            { 'headApproval.decision': 'rejected' },
            { 'justification.headReview.decision': 'rejected' }
          ];
          break;
        case 'all':
        default:
          query.status = {
            $in: [
              'pending_head_approval',
              'pending_ceo',
              'justification_pending_head',
              'approved',
              'justification_approved',
              'rejected',
              'justification_rejected'
            ]
          };
      }
    }

    if (status && !tab) query.status = status;

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('headApproval.decidedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await PurchaseRequisition.countDocuments(query);

    const transformedRequisitions = requisitions.map(req => ({
      id: req._id,
      requisitionNumber: req.requisitionNumber,
      title: req.title,
      requester: req.employee?.fullName || 'Unknown',
      department: req.employee?.department || 'Unknown',
      category: req.itemCategory,
      budgetXAF: req.budgetXAF || req.financeVerification?.assignedBudget,
      urgency: req.urgency,
      status: req.status,
      paymentMethod: req.paymentMethod || 'bank',
      assignedBuyer: req.supplyChainReview?.assignedBuyer ? {
        id: req.supplyChainReview.assignedBuyer._id,
        name: req.supplyChainReview.assignedBuyer.fullName,
        email: req.supplyChainReview.assignedBuyer.email
      } : null,
      buyerAssignmentDate: req.supplyChainReview?.buyerAssignmentDate,
      sourcingType: req.supplyChainReview?.sourcingType,
      submittedDate: req.createdAt,
      expectedDeliveryDate: req.expectedDate,
      items: req.items,
      headApproval: req.headApproval,
      // Flag so frontend can show the correct action buttons
      awaitingCEO: req.status === 'pending_ceo'
    }));

    res.json({
      success: true,
      data: transformedRequisitions,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: transformedRequisitions.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get pending head approvals error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requisitions', error: error.message });
  }
};

/**
 * Get head approval statistics
 */
const getHeadApprovalStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!HEAD_APPROVAL_ROLES.includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const pending = await PurchaseRequisition.countDocuments({
      status: {
        $in: user.role === 'ceo'
          ? ['pending_ceo']
          : ['pending_head_approval', 'justification_pending_head']
      }
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const approvedToday = await PurchaseRequisition.countDocuments({
      $or: [
        { 'headApproval.decision': 'approved', 'headApproval.decisionDate': { $gte: startOfDay } },
        { 'justification.headReview.decision': 'approved', 'justification.headReview.reviewedDate': { $gte: startOfDay } }
      ]
    });

    const pendingRequisitions = await PurchaseRequisition.find({
      status: { $in: ['pending_head_approval', 'pending_ceo'] }
    });

    const totalPendingValue = pendingRequisitions.reduce(
      (sum, req) => sum + (req.budgetXAF || req.financeVerification?.assignedBudget || 0), 0
    );

    const pettyCashFormsGenerated = await PurchaseRequisition.countDocuments({
      'pettyCashForm.generated': true,
      'pettyCashForm.generatedDate': { $gte: startOfDay }
    });

    res.json({
      success: true,
      data: { pending, approvedToday, totalPendingValue, pettyCashFormsGenerated, generatedAt: new Date() }
    });

  } catch (error) {
    console.error('Get head approval stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics', error: error.message });
  }
};

/**
 * Get requisition details for head approval
 */
const getRequisitionDetails = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const user = await User.findById(req.user.userId);

    if (!HEAD_APPROVAL_ROLES.includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department phone')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('supplyChainReview.buyerAssignedBy', 'fullName email')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .populate('headApproval.decidedBy', 'fullName email')
      .populate('approvalChain.decidedBy', 'fullName email role');

    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    const details = {
      id: requisition._id,
      requisitionNumber: requisition.requisitionNumber,
      title: requisition.title,
      requester: requisition.employee?.fullName || 'Unknown',
      department: requisition.employee?.department || 'Unknown',
      category: requisition.itemCategory,
      budgetXAF: requisition.budgetXAF || requisition.financeVerification?.assignedBudget,
      urgency: requisition.urgency,
      status: requisition.status,
      paymentMethod: requisition.paymentMethod || 'bank',
      deliveryLocation: requisition.deliveryLocation,
      expectedDeliveryDate: requisition.expectedDate,
      justification: requisition.justificationOfPurchase,
      items: requisition.items.map(item => ({
        id: item._id,
        description: item.description,
        quantity: item.quantity,
        measuringUnit: item.measuringUnit,
        estimatedPrice: item.estimatedPrice,
        category: item.category,
        specifications: item.specifications
      })),
      assignedBuyer: requisition.supplyChainReview?.assignedBuyer ? {
        id: requisition.supplyChainReview.assignedBuyer._id,
        name: requisition.supplyChainReview.assignedBuyer.fullName,
        email: requisition.supplyChainReview.assignedBuyer.email
      } : null,
      buyerAssignmentDate: requisition.supplyChainReview?.buyerAssignmentDate,
      sourcingType: requisition.supplyChainReview?.sourcingType,
      approvalChain: requisition.approvalChain.map(step => ({
        level: step.level,
        approver: step.approver,
        status: step.status,
        comments: step.comments,
        actionDate: step.actionDate,
        actionTime: step.actionTime
      })),
      financeVerification: {
        budgetAvailable: requisition.financeVerification?.budgetAvailable,
        assignedBudget: requisition.financeVerification?.assignedBudget,
        budgetCode: requisition.financeVerification?.budgetCode,
        comments: requisition.financeVerification?.comments,
        verifiedBy: requisition.financeVerification?.verifiedBy?.fullName,
        verificationDate: requisition.financeVerification?.verificationDate
      },
      headApproval: requisition.headApproval,
      createdAt: requisition.createdAt
    };

    res.json({ success: true, data: details });

  } catch (error) {
    console.error('Get requisition details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requisition details', error: error.message });
  }
};

/**
 * Process head/CEO approval decision
 *
 * Flow summary:
 *   Kelvin (supply_chain / admin) approves:
 *     → if a pending_ceo step exists in the approvalChain → status = 'pending_ceo', notify CEO
 *     → otherwise → status = 'approved' (no CEO threshold hit)
 *
 *   Tom (ceo) approves the pending_ceo step → status = 'approved' (final)
 */
const processHeadApproval = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== PROCESS HEAD APPROVAL ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Decision:', decision);

    const user = await User.findById(req.user.userId);

    if (!HEAD_APPROVAL_ROLES.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Supply Chain Head, Admin, or CEO can approve.'
      });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email');

    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    // ── JUSTIFICATION FLOW (unchanged) ────────────────────────────────────
    if (requisition.status === 'justification_pending_head') {
      requisition.justification = requisition.justification || {};
      requisition.justification.headReview = {
        decision: decision === 'approved' ? 'approved' : 'rejected',
        comments,
        reviewedDate: new Date(),
        reviewedBy: req.user.userId
      };
      requisition.status = decision === 'approved' ? 'justification_approved' : 'justification_rejected';
      requisition.justification.status = requisition.status === 'justification_approved' ? 'approved' : 'rejected';
      await requisition.save();
      return res.json({ success: true, message: `Justification ${decision}`, data: requisition });
    }

    // ── CEO STEP: Tom approving his specific step ─────────────────────────
    if (requisition.status === 'pending_ceo') {
      if (user.role !== 'ceo' && user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Only the CEO can approve items at the CEO stage.'
        });
      }

      if (decision !== 'approved' && decision !== 'rejected') {
        return res.status(400).json({ success: false, message: 'Invalid decision.' });
      }

      // Update the CEO step in the approval chain
      const ceoStepIndex = requisition.approvalChain.findIndex(s =>
        (s.approver.role === 'CEO - Final Authority' || s.approver.role === 'Acting CEO (Delegate)') &&
        s.status === 'pending'
      );

      if (ceoStepIndex !== -1) {
        requisition.approvalChain[ceoStepIndex].status = decision === 'approved' ? 'approved' : 'rejected';
        requisition.approvalChain[ceoStepIndex].comments = comments;
        requisition.approvalChain[ceoStepIndex].actionDate = new Date();
        requisition.approvalChain[ceoStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
        requisition.approvalChain[ceoStepIndex].decidedBy = req.user.userId;
      }

      if (decision === 'approved') {
        requisition.status = 'approved';
        const paymentMethod = requisition.paymentMethod;

        if (paymentMethod === 'cash') {
          try {
            await requisition.generatePettyCashFormNumber();
            await requisition.save();
            if (requisition.supplyChainReview?.assignedBuyer) {
              await sendPettyCashFormNotificationToBuyer(requisition);
            }
            await sendPettyCashFormNotificationToEmployee(requisition);
          } catch (pettyCashError) {
            console.error('Petty cash form error (non-fatal):', pettyCashError);
            await requisition.save();
          }
        } else {
          await requisition.save();
        }

        // Notify employee
        await sendEmail({
          to: requisition.employee.email,
          subject: `🎉 Requisition Fully Approved — ${requisition.title}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#f6ffed;padding:20px;border-radius:8px;border-left:4px solid #52c41a;">
                <h2 style="color:#52c41a;margin-top:0;">✓ CEO Final Approval Received</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition has received all required approvals including CEO sign-off.</p>
                <ul>
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                  <li><strong>Payment:</strong> ${paymentMethod === 'cash' ? 'Petty Cash' : 'Bank Transfer'}</li>
                </ul>
              </div>
            </div>
          `
        }).catch(err => console.error('Failed to notify employee:', err));

        return res.json({
          success: true,
          message: 'Requisition fully approved by CEO',
          data: {
            requisitionId: requisition._id,
            requisitionNumber: requisition.requisitionNumber,
            status: requisition.status,
            decision: 'approved',
            pettyCashForm: requisition.pettyCashForm?.generated ? {
              formNumber: requisition.pettyCashForm.formNumber,
              generatedDate: requisition.pettyCashForm.generatedDate,
              status: requisition.pettyCashForm.status
            } : null,
            paymentMethod: requisition.paymentMethod
          }
        });

      } else {
        // CEO rejected
        requisition.status = 'rejected';
        await requisition.save();

        await sendEmail({
          to: requisition.employee.email,
          subject: `Requisition Rejected by CEO — ${requisition.title}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#fff2f0;padding:20px;border-radius:8px;border-left:4px solid #ff4d4f;">
                <h2 style="color:#ff4d4f;margin-top:0;">✗ Requisition Rejected at CEO Level</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition has been rejected at the final CEO approval stage.</p>
                ${comments ? `<p><strong>Reason:</strong> ${comments}</p>` : ''}
              </div>
            </div>
          `
        }).catch(err => console.error('Failed to notify employee:', err));

        return res.json({
          success: true,
          message: 'Requisition rejected by CEO',
          data: {
            requisitionId: requisition._id,
            status: 'rejected',
            decision: 'rejected'
          }
        });
      }
    }

    // ── KELVIN / ADMIN HOB APPROVAL (pending_head_approval) ───────────────
    if (requisition.status !== 'pending_head_approval') {
      return res.status(400).json({
        success: false,
        message: `Cannot process approval. Current status: ${requisition.status}`
      });
    }

    // Update headApproval record
    requisition.headApproval = {
      decision,
      comments,
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };

    // Update Kelvin's step in approval chain
    const hobStepIndex = requisition.approvalChain.findIndex(s =>
      (s.approver.role === 'Head of Business' ||
       s.approver.role === 'Head of Business Development & Supply Chain - Final Approval') &&
      s.status === 'pending'
    );
    if (hobStepIndex !== -1) {
      requisition.approvalChain[hobStepIndex].status = decision === 'approved' ? 'approved' : 'rejected';
      requisition.approvalChain[hobStepIndex].comments = comments;
      requisition.approvalChain[hobStepIndex].actionDate = new Date();
      requisition.approvalChain[hobStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[hobStepIndex].decidedBy = req.user.userId;
    }

    if (decision === 'approved') {
      // ── CHECK: Is there a pending CEO step? ─────────────────────────────
      const pendingCEOStep = requisition.approvalChain.find(s =>
        (s.approver.role === 'CEO - Final Authority' || s.approver.role === 'Acting CEO (Delegate)') &&
        s.status === 'pending'
      );

      if (pendingCEOStep) {
        // Route to CEO
        console.log(`✅ CEO step found — routing to CEO (${pendingCEOStep.approver.name})`);
        requisition.status = 'pending_ceo';
        pendingCEOStep.assignedDate = new Date();
        await requisition.save();

        // Notify CEO (or delegate)
        await sendEmail({
          to: pendingCEOStep.approver.email,
          subject: `🏛️ CEO Final Approval Required — ${requisition.title}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#fff7e6;padding:20px;border-radius:8px;border-left:4px solid #faad14;">
                <h2 style="color:#faad14;margin-top:0;">Final CEO Approval Required</h2>
                <p>Dear ${pendingCEOStep.approver.name},</p>
                <p>A purchase requisition has been approved by the Head of Business and now requires your final sign-off.</p>
                <div style="background:white;padding:15px;border-radius:8px;margin:15px 0;">
                  <ul>
                    <li><strong>Requisition:</strong> ${requisition.title}</li>
                    <li><strong>Requester:</strong> ${requisition.employee.fullName}</li>
                    <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                    <li><strong>Payment Method:</strong> ${requisition.paymentMethod === 'cash' ? 'Petty Cash' : 'Bank Transfer'}</li>
                    <li><strong>HOB Approved by:</strong> ${user.fullName} ✅</li>
                  </ul>
                </div>
                ${pendingCEOStep.approver.role === 'Acting CEO (Delegate)'
                  ? '<p><em>Note: You are acting as CEO delegate for this approval.</em></p>' : ''}
                <p style="text-align:center;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/head-approval"
                     style="background:#faad14;color:#fff;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;">
                    Review &amp; Approve
                  </a>
                </p>
              </div>
            </div>
          `
        }).catch(err => console.error('Failed to notify CEO:', err));

        // Notify employee of progress
        await sendEmail({
          to: requisition.employee.email,
          subject: `Requisition Approved by HOB — Awaiting CEO Sign-off`,
          html: `
            <p>Dear ${requisition.employee.fullName},</p>
            <p>Your requisition has been approved by the Head of Business and is now awaiting final CEO approval.</p>
          `
        }).catch(err => console.error('Failed to notify employee:', err));

        return res.json({
          success: true,
          message: 'Head of Business approved — awaiting CEO final sign-off',
          data: {
            requisitionId: requisition._id,
            requisitionNumber: requisition.requisitionNumber,
            status: 'pending_ceo',
            decision: 'approved',
            nextApprover: { name: pendingCEOStep.approver.name, role: pendingCEOStep.approver.role }
          }
        });

      } else {
        // No CEO step — Kelvin IS the final approver for this requisition
        console.log('✅ No CEO step — HOB is final approver. Approving now.');
        requisition.status = 'approved';
        const paymentMethod = requisition.paymentMethod;

        if (paymentMethod === 'cash') {
          try {
            await requisition.generatePettyCashFormNumber();
            await requisition.save();
            if (requisition.supplyChainReview?.assignedBuyer) {
              await sendPettyCashFormNotificationToBuyer(requisition);
            }
            await sendPettyCashFormNotificationToEmployee(requisition);
          } catch (pettyCashError) {
            console.error('Petty cash form error (non-fatal):', pettyCashError);
            await requisition.save();
          }
        } else {
          await requisition.save();
        }

        // Notify employee
        await sendEmail({
          to: requisition.employee.email,
          subject: `Requisition Approved — ${requisition.title}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#f6ffed;padding:20px;border-radius:8px;border-left:4px solid #52c41a;">
                <h2 style="color:#52c41a;margin-top:0;">✓ Requisition Approved</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition has been approved by ${user.fullName}.</p>
                <ul>
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                  <li><strong>Payment:</strong> ${paymentMethod === 'cash' ? 'Petty Cash' : 'Bank Transfer'}</li>
                </ul>
              </div>
            </div>
          `
        }).catch(err => console.error('Failed to notify employee:', err));

        return res.json({
          success: true,
          message: 'Requisition approved',
          data: {
            requisitionId: requisition._id,
            requisitionNumber: requisition.requisitionNumber,
            status: requisition.status,
            decision: 'approved',
            pettyCashForm: requisition.pettyCashForm?.generated ? {
              formNumber: requisition.pettyCashForm.formNumber,
              generatedDate: requisition.pettyCashForm.generatedDate
            } : null,
            paymentMethod: requisition.paymentMethod
          }
        });
      }

    } else {
      // REJECTED by Kelvin
      requisition.status = 'rejected';
      await requisition.save();

      await sendEmail({
        to: requisition.employee.email,
        subject: `Requisition Rejected — ${requisition.title}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#fff2f0;padding:20px;border-radius:8px;border-left:4px solid #ff4d4f;">
              <h2 style="color:#ff4d4f;margin-top:0;">✗ Requisition Rejected</h2>
              <p>Dear ${requisition.employee.fullName},</p>
              <p>Your purchase requisition has been rejected by ${user.fullName} (Head of Business).</p>
              ${comments ? `<p><strong>Reason:</strong> ${comments}</p>` : ''}
            </div>
          </div>
        `
      }).catch(err => console.error('Failed to notify employee:', err));

      return res.json({
        success: true,
        message: 'Requisition rejected',
        data: {
          requisitionId: requisition._id,
          requisitionNumber: requisition.requisitionNumber,
          status: 'rejected',
          decision: 'rejected'
        }
      });
    }

  } catch (error) {
    console.error('Error processing head approval:', error);
    res.status(500).json({ success: false, message: 'Failed to process head approval', error: error.message });
  }
};

/**
 * Send petty cash form notification to buyer
 */
const sendPettyCashFormNotificationToBuyer = async (requisition) => {
  const buyer = requisition.supplyChainReview.assignedBuyer;
  await sendEmail({
    to: buyer.email,
    subject: `Petty Cash Form Ready — ${requisition.title}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#fff7e6;padding:20px;border-radius:8px;border-left:4px solid #faad14;">
          <h2 style="color:#faad14;margin-top:0;">📄 Petty Cash Form Ready for Download</h2>
          <p>Dear ${buyer.fullName},</p>
          <ul>
            <li><strong>Form Number:</strong> ${requisition.pettyCashForm.formNumber}</li>
            <li><strong>Requisition:</strong> ${requisition.title}</li>
            <li><strong>Requester:</strong> ${requisition.employee.fullName}</li>
            <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
          </ul>
          <p style="text-align:center;">
            <a href="${process.env.FRONTEND_URL}/buyer/petty-cash"
               style="background:#faad14;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;">
              View Petty Cash Forms
            </a>
          </p>
        </div>
      </div>
    `
  });
  console.log('Petty cash form notification sent to buyer:', buyer.email);
};

/**
 * Send petty cash form notification to employee
 */
const sendPettyCashFormNotificationToEmployee = async (requisition) => {
  await sendEmail({
    to: requisition.employee.email,
    subject: `Petty Cash Form Generated — ${requisition.title}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#f6ffed;padding:20px;border-radius:8px;border-left:4px solid #52c41a;">
          <h2 style="color:#52c41a;margin-top:0;">✓ Requisition Approved — Petty Cash Form Generated</h2>
          <p>Dear ${requisition.employee.fullName},</p>
          <ul>
            <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
            <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
            <li><strong>Form Number:</strong> ${requisition.pettyCashForm.formNumber}</li>
          </ul>
        </div>
      </div>
    `
  });
  console.log('Petty cash form notification sent to employee:', requisition.employee.email);
};

module.exports = {
  getPendingHeadApprovals,
  getHeadApprovalStats,
  getRequisitionDetails,
  processHeadApproval,
  sendPettyCashFormNotificationToBuyer,
  sendPettyCashFormNotificationToEmployee
};










// const PurchaseRequisition = require('../models/PurchaseRequisition');
// const User = require('../models/User');
// const { sendEmail } = require('../services/emailService');

// /**
//  * Get requisitions pending head approval
//  */
// const getPendingHeadApprovals = async (req, res) => {
//   try {
//     const { status, tab, page = 1, limit = 20 } = req.query;
    
//     console.log('=== GET PENDING HEAD APPROVALS ===');
//     console.log('User:', req.user.userId);
//     console.log('Filters:', { status, tab });
    
//     const user = await User.findById(req.user.userId);
    
//     // Verify user is authorized (admin or supply_chain head)
//     if (!['admin', 'supply_chain'].includes(user.role)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Only admin or supply chain head can access this.'
//       });
//     }
    
//     // Build query based on tab
//     let query = {};
    
//     switch (tab) {
//       case 'pending':
//         query.status = { $in: ['pending_head_approval', 'justification_pending_head'] };
//         break;
//       case 'approved':
//         query.status = { $in: ['approved', 'justification_approved'] };
//         query.$or = [
//           { 'headApproval.decision': 'approved' },
//           { 'justification.headReview.decision': 'approved' }
//         ];
//         break;
//       case 'rejected':
//         query.status = { $in: ['rejected', 'justification_rejected'] };
//         query.$or = [
//           { 'headApproval.decision': 'rejected' },
//           { 'justification.headReview.decision': 'rejected' }
//         ];
//         break;
//       case 'all':
//         query.status = { 
//           $in: [
//             'pending_head_approval',
//             'justification_pending_head',
//             'approved',
//             'justification_approved',
//             'rejected',
//             'justification_rejected'
//           ] 
//         };
//         break;
//       default:
//         query.status = { $in: ['pending_head_approval', 'justification_pending_head'] };
//     }
    
//     // Apply additional status filter if provided
//     if (status && !tab) {
//       query.status = status;
//     }
    
//     console.log('Query:', JSON.stringify(query, null, 2));
    
//     const requisitions = await PurchaseRequisition.find(query)
//       .populate('employee', 'fullName email department')
//       .populate('supplyChainReview.assignedBuyer', 'fullName email')
//       .populate('headApproval.decidedBy', 'fullName email')
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit);
    
//     const total = await PurchaseRequisition.countDocuments(query);
    
//     console.log(`Found ${requisitions.length} requisitions`);
    
//     // Transform data for frontend
//     const transformedRequisitions = requisitions.map(req => ({
//       id: req._id,
//       requisitionNumber: req.requisitionNumber,
//       title: req.title,
//       requester: req.employee?.fullName || 'Unknown',
//       department: req.employee?.department || 'Unknown',
//       category: req.itemCategory,
//       budgetXAF: req.budgetXAF || req.financeVerification?.assignedBudget,
//       urgency: req.urgency,
//       status: req.status,
//       paymentMethod: req.paymentMethod || 'bank',
//       assignedBuyer: req.supplyChainReview?.assignedBuyer ? {
//         id: req.supplyChainReview.assignedBuyer._id,
//         name: req.supplyChainReview.assignedBuyer.fullName,
//         email: req.supplyChainReview.assignedBuyer.email
//       } : null,
//       buyerAssignmentDate: req.supplyChainReview?.buyerAssignmentDate,
//       sourcingType: req.supplyChainReview?.sourcingType,
//       submittedDate: req.createdAt,
//       expectedDeliveryDate: req.expectedDate,
//       items: req.items,
//       headApproval: req.headApproval
//     }));
    
//     res.json({
//       success: true,
//       data: transformedRequisitions,
//       pagination: {
//         current: parseInt(page),
//         total: Math.ceil(total / limit),
//         count: transformedRequisitions.length,
//         totalRecords: total
//       }
//     });
    
//   } catch (error) {
//     console.error('Get pending head approvals error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch requisitions',
//       error: error.message
//     });
//   }
// };

// /**
//  * Get head approval statistics
//  */
// const getHeadApprovalStats = async (req, res) => {
//   try {
//     console.log('=== GET HEAD APPROVAL STATS ===');
    
//     const user = await User.findById(req.user.userId);
    
//     // Verify authorization
//     if (!['admin', 'supply_chain'].includes(user.role)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied'
//       });
//     }
    
//     // Get pending count
//     const pending = await PurchaseRequisition.countDocuments({
//       status: { $in: ['pending_head_approval', 'justification_pending_head'] }
//     });
    
//     // Get approved today
//     const startOfDay = new Date();
//     startOfDay.setHours(0, 0, 0, 0);
    
//     const approvedToday = await PurchaseRequisition.countDocuments({
//       $or: [
//         {
//           'headApproval.decision': 'approved',
//           'headApproval.decisionDate': { $gte: startOfDay }
//         },
//         {
//           'justification.headReview.decision': 'approved',
//           'justification.headReview.reviewedDate': { $gte: startOfDay }
//         }
//       ]
//     });
    
//     // Get total pending value
//     const pendingRequisitions = await PurchaseRequisition.find({
//       status: 'pending_head_approval'
//     });
    
//     const totalPendingValue = pendingRequisitions.reduce((sum, req) => {
//       return sum + (req.budgetXAF || req.financeVerification?.assignedBudget || 0);
//     }, 0);
    
//     // Get petty cash forms generated today
//     const pettyCashFormsGenerated = await PurchaseRequisition.countDocuments({
//       'pettyCashForm.generated': true,
//       'pettyCashForm.generatedDate': { $gte: startOfDay }
//     });
    
//     const stats = {
//       pending,
//       approvedToday,
//       totalPendingValue,
//       pettyCashFormsGenerated,
//       generatedAt: new Date()
//     };
    
//     console.log('Head approval stats:', stats);
    
//     res.json({
//       success: true,
//       data: stats
//     });
    
//   } catch (error) {
//     console.error('Get head approval stats error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch statistics',
//       error: error.message
//     });
//   }
// };

// /**
//  * Get requisition details for head approval
//  */
// const getRequisitionDetails = async (req, res) => {
//   try {
//     const { requisitionId } = req.params;
    
//     console.log('=== GET REQUISITION DETAILS FOR HEAD APPROVAL ===');
//     console.log('Requisition ID:', requisitionId);
    
//     const user = await User.findById(req.user.userId);
    
//     // Verify authorization
//     if (!['admin', 'supply_chain'].includes(user.role)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied'
//       });
//     }
    
//     const requisition = await PurchaseRequisition.findById(requisitionId)
//       .populate('employee', 'fullName email department phone')
//       .populate('supplyChainReview.assignedBuyer', 'fullName email')
//       .populate('supplyChainReview.buyerAssignedBy', 'fullName email')
//       .populate('financeVerification.verifiedBy', 'fullName email')
//       .populate('headApproval.decidedBy', 'fullName email')
//       .populate('approvalChain.decidedBy', 'fullName email role');
    
//     if (!requisition) {
//       return res.status(404).json({
//         success: false,
//         message: 'Requisition not found'
//       });
//     }
    
//     // Transform data
//     const details = {
//       id: requisition._id,
//       requisitionNumber: requisition.requisitionNumber,
//       title: requisition.title,
//       requester: requisition.employee?.fullName || 'Unknown',
//       department: requisition.employee?.department || 'Unknown',
//       category: requisition.itemCategory,
//       budgetXAF: requisition.budgetXAF || requisition.financeVerification?.assignedBudget,
//       urgency: requisition.urgency,
//       status: requisition.status,
//       paymentMethod: requisition.paymentMethod || 'bank',
//       deliveryLocation: requisition.deliveryLocation,
//       expectedDeliveryDate: requisition.expectedDate,
//       justification: requisition.justificationOfPurchase,
//       items: requisition.items.map(item => ({
//         id: item._id,
//         description: item.description,
//         quantity: item.quantity,
//         measuringUnit: item.measuringUnit,
//         estimatedPrice: item.estimatedPrice,
//         category: item.category,
//         specifications: item.specifications
//       })),
//       assignedBuyer: requisition.supplyChainReview?.assignedBuyer ? {
//         id: requisition.supplyChainReview.assignedBuyer._id,
//         name: requisition.supplyChainReview.assignedBuyer.fullName,
//         email: requisition.supplyChainReview.assignedBuyer.email
//       } : null,
//       buyerAssignmentDate: requisition.supplyChainReview?.buyerAssignmentDate,
//       sourcingType: requisition.supplyChainReview?.sourcingType,
//       approvalChain: requisition.approvalChain.map(step => ({
//         level: step.level,
//         approver: step.approver,
//         status: step.status,
//         comments: step.comments,
//         actionDate: step.actionDate,
//         actionTime: step.actionTime
//       })),
//       financeVerification: {
//         budgetAvailable: requisition.financeVerification?.budgetAvailable,
//         assignedBudget: requisition.financeVerification?.assignedBudget,
//         budgetCode: requisition.financeVerification?.budgetCode,
//         comments: requisition.financeVerification?.comments,
//         verifiedBy: requisition.financeVerification?.verifiedBy?.fullName,
//         verificationDate: requisition.financeVerification?.verificationDate
//       },
//       headApproval: requisition.headApproval,
//       createdAt: requisition.createdAt
//     };
    
//     res.json({
//       success: true,
//       data: details
//     });
    
//   } catch (error) {
//     console.error('Get requisition details error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch requisition details',
//       error: error.message
//     });
//   }
// };

// /**
//  * Process head approval decision
//  * ENHANCED: Auto-generate petty cash form if payment method is cash
//  */
// const processHeadApproval = async (req, res) => {
//   try {
//     const { requisitionId } = req.params;
//     const { decision, comments } = req.body;
    
//     console.log('=== PROCESS HEAD APPROVAL ===');
//     console.log('Requisition ID:', requisitionId);
//     console.log('Decision:', decision);
    
//     const user = await User.findById(req.user.userId);
    
//     // Verify authorization
//     if (!['admin', 'supply_chain'].includes(user.role)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Only admin or supply chain head can approve.'
//       });
//     }
    
//     const requisition = await PurchaseRequisition.findById(requisitionId)
//       .populate('employee', 'fullName email department')
//       .populate('supplyChainReview.assignedBuyer', 'fullName email');
    
//     if (!requisition) {
//       return res.status(404).json({
//         success: false,
//         message: 'Requisition not found'
//       });
//     }

//     // ✅ Justification approval flow (Head)
//     if (requisition.status === 'justification_pending_head') {
//       requisition.justification = requisition.justification || {};
//       requisition.justification.headReview = {
//         decision: decision === 'approved' ? 'approved' : 'rejected',
//         comments,
//         reviewedDate: new Date(),
//         reviewedBy: req.user.userId
//       };

//       if (decision === 'approved') {
//         requisition.status = 'justification_approved';
//         requisition.justification.status = 'approved';
//       } else {
//         requisition.status = 'justification_rejected';
//         requisition.justification.status = 'rejected';
//       }

//       await requisition.save();

//       return res.json({
//         success: true,
//         message: `Justification ${decision}`,
//         data: requisition
//       });
//     }
    
//     // Verify status
//     if (requisition.status !== 'pending_head_approval') {
//       return res.status(400).json({
//         success: false,
//         message: `Cannot process approval. Current status: ${requisition.status}`
//       });
//     }
    
//     // Update head approval
//     requisition.headApproval = {
//       decision: decision,
//       comments: comments,
//       decisionDate: new Date(),
//       decidedBy: req.user.userId
//     };
    
//     if (decision === 'approved') {
//       requisition.status = 'approved';
      
//       // NEW: Auto-generate petty cash form if payment method is cash
//       const paymentMethod = requisition.paymentMethod;
      
//       if (paymentMethod === 'cash') {
//         console.log('Payment method is cash - generating petty cash form');
        
//         try {
//           // Generate petty cash form number
//           await requisition.generatePettyCashFormNumber();
          
//           console.log('Petty cash form generated:', requisition.pettyCashForm.formNumber);
          
//           // Save requisition with petty cash form
//           await requisition.save();
          
//           // Send notification to buyer about petty cash form
//           if (requisition.supplyChainReview.assignedBuyer) {
//             await sendPettyCashFormNotificationToBuyer(requisition);
//           }
          
//           // Send notification to employee
//           await sendPettyCashFormNotificationToEmployee(requisition);
          
//         } catch (pettyCashError) {
//           console.error('Error generating petty cash form:', pettyCashError);
//           // Continue with approval even if petty cash generation fails
//           // The form can be regenerated later if needed
//         }
//       } else {
//         console.log('Payment method is bank - no petty cash form needed');
//         await requisition.save();
//       }
      
//       // Send approval notification
//       try {
//         await sendEmail({
//           to: requisition.employee.email,
//           subject: `Requisition Approved - ${requisition.title}`,
//           html: `
//             <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//               <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
//                 <h2 style="color: #52c41a; margin-top: 0;">✓ Requisition Approved</h2>
//                 <p>Dear ${requisition.employee.fullName},</p>
//                 <p>Your purchase requisition has been approved by ${user.fullName} (Head of Business Dev & Supply Chain).</p>
                
//                 <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
//                   <h4>Requisition Details</h4>
//                   <ul>
//                     <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
//                     <li><strong>Title:</strong> ${requisition.title}</li>
//                     <li><strong>Budget:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
//                     <li><strong>Payment Method:</strong> ${paymentMethod === 'cash' ? 'Petty Cash' : 'Bank Transfer'}</li>
//                     <li><strong>Approval Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
//                   </ul>
//                 </div>
                
//                 ${paymentMethod === 'cash' ? `
//                 <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
//                   <h4>Petty Cash Form Generated</h4>
//                   <p><strong>Form Number:</strong> ${requisition.pettyCashForm?.formNumber}</p>
//                   <p>A petty cash form has been automatically generated for this requisition. Your assigned buyer will handle the petty cash disbursement process.</p>
//                 </div>
//                 ` : `
//                 <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
//                   <h4>Bank Transfer Payment</h4>
//                   <p>This requisition will be processed through the standard procurement process with bank transfer payment.</p>
//                   <p>Your assigned buyer will begin the sourcing process and send RFQs to qualified suppliers.</p>
//                 </div>
//                 `}
                
//                 <p><strong>Next Steps:</strong></p>
//                 <ul>
//                   ${paymentMethod === 'cash' ? 
//                     '<li>Your assigned buyer will download the petty cash form</li><li>The procurement process will continue as scheduled</li><li>You will be notified of any updates</li>' :
//                     '<li>Your assigned buyer will create and send RFQs to suppliers</li><li>Suppliers will submit their quotations</li><li>The buyer will evaluate quotes and select the best option</li><li>You will be notified when procurement is complete</li>'
//                   }
//                 </ul>
                
//                 <p>You can track your requisition status in your employee dashboard.</p>
//                 <p>Best regards,<br>Procurement Team</p>
//               </div>
//             </div>
//           `
//         });
        
//         console.log('Approval email sent to employee');
//       } catch (emailError) {
//         console.error('Failed to send approval email:', emailError);
//         // Don't fail the approval if email fails
//       }
      
//     } else if (decision === 'rejected') {
//       requisition.status = 'rejected';
//       await requisition.save();
      
//       // Send rejection notification
//       try {
//         await sendEmail({
//           to: requisition.employee.email,
//           subject: `Requisition Rejected - ${requisition.title}`,
//           html: `
//             <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//               <div style="background-color: #fff2f0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff4d4f;">
//                 <h2 style="color: #ff4d4f; margin-top: 0;">✗ Requisition Rejected</h2>
//                 <p>Dear ${requisition.employee.fullName},</p>
//                 <p>Your purchase requisition has been rejected by ${user.fullName} (Head of Business Dev & Supply Chain).</p>
                
//                 <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
//                   <h4>Requisition Details</h4>
//                   <ul>
//                     <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
//                     <li><strong>Title:</strong> ${requisition.title}</li>
//                     <li><strong>Rejection Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
//                   </ul>
//                 </div>
                
//                 ${comments ? `
//                 <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
//                   <h4>Rejection Reason</h4>
//                   <p>${comments}</p>
//                 </div>
//                 ` : ''}
                
//                 <p>If you believe this rejection was made in error or have additional information, please contact your supervisor or the Supply Chain team.</p>
//                 <p>Best regards,<br>Procurement Team</p>
//               </div>
//             </div>
//           `
//         });
        
//         console.log('Rejection email sent to employee');
//       } catch (emailError) {
//         console.error('Failed to send rejection email:', emailError);
//         // Don't fail the rejection if email fails
//       }
//     }
    
//     res.json({
//       success: true,
//       message: `Requisition ${decision}`,
//       data: {
//         requisitionId: requisition._id,
//         requisitionNumber: requisition.requisitionNumber,
//         status: requisition.status,
//         decision: decision,
//         pettyCashForm: requisition.pettyCashForm?.generated ? {
//           formNumber: requisition.pettyCashForm.formNumber,
//           generatedDate: requisition.pettyCashForm.generatedDate,
//           status: requisition.pettyCashForm.status
//         } : null,
//         paymentMethod: requisition.paymentMethod
//       }
//     });
    
//   } catch (error) {
//     console.error('Error processing head approval:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process head approval',
//       error: error.message
//     });
//   }
// };

// /**
//  * Send petty cash form notification to buyer
//  */
// const sendPettyCashFormNotificationToBuyer = async (requisition) => {
//   try {
//     const buyer = requisition.supplyChainReview.assignedBuyer;
    
//     await sendEmail({
//       to: buyer.email,
//       subject: `Petty Cash Form Ready - ${requisition.title}`,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <div style="background-color: #fff7e6; padding: 20px; border-radius: 8px; border-left: 4px solid #faad14;">
//             <h2 style="color: #faad14; margin-top: 0;">📄 Petty Cash Form Ready for Download</h2>
//             <p>Dear ${buyer.fullName},</p>
//             <p>A petty cash form has been generated for your assigned requisition.</p>
            
//             <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
//               <h4>Form Details</h4>
//               <ul>
//                 <li><strong>Form Number:</strong> ${requisition.pettyCashForm.formNumber}</li>
//                 <li><strong>Requisition:</strong> ${requisition.title}</li>
//                 <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
//                 <li><strong>Requester:</strong> ${requisition.employee.fullName}</li>
//                 <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
//                 <li><strong>Generated:</strong> ${new Date().toLocaleString('en-GB')}</li>
//               </ul>
//             </div>
            
//             <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
//               <h4 style="color: #1890ff; margin-top: 0;">Action Required</h4>
//               <p>Please log in to your buyer dashboard to:</p>
//               <ul>
//                 <li>Download the petty cash form PDF</li>
//                 <li>Review all requisition details</li>
//                 <li>Track the form status</li>
//               </ul>
//             </div>
            
//             <div style="margin: 20px 0; text-align: center;">
//               <a href="${process.env.FRONTEND_URL}/buyer/petty-cash" 
//                  style="background-color: #faad14; color: white; padding: 12px 24px; 
//                         text-decoration: none; border-radius: 4px; display: inline-block;">
//                 View Petty Cash Forms
//               </a>
//             </div>
            
//             <p style="color: #666; font-size: 12px; margin-top: 20px;">
//               Note: You can download this form multiple times if needed. All downloads are tracked for audit purposes.
//             </p>
//           </div>
//         </div>
//       `
//     });
    
//     console.log('Petty cash form notification sent to buyer:', buyer.email);
//   } catch (error) {
//     console.error('Error sending buyer notification:', error);
//     throw error;
//   }
// };

// /**
//  * Send petty cash form notification to employee
//  */
// const sendPettyCashFormNotificationToEmployee = async (requisition) => {
//   try {
//     await sendEmail({
//       to: requisition.employee.email,
//       subject: `Petty Cash Form Generated - ${requisition.title}`,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
//             <h2 style="color: #52c41a; margin-top: 0;">✓ Requisition Approved - Petty Cash Form Generated</h2>
//             <p>Dear ${requisition.employee.fullName},</p>
//             <p>Your purchase requisition has been approved and a petty cash form has been generated.</p>
            
//             <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
//               <h4>Requisition Details</h4>
//               <ul>
//                 <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
//                 <li><strong>Title:</strong> ${requisition.title}</li>
//                 <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
//                 <li><strong>Payment Method:</strong> Petty Cash</li>
//               </ul>
//             </div>
            
//             <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
//               <h4>Petty Cash Form</h4>
//               <p><strong>Form Number:</strong> ${requisition.pettyCashForm.formNumber}</p>
//               <p>The assigned buyer will handle the petty cash disbursement process.</p>
//             </div>
            
//             <p><strong>Next Steps:</strong></p>
//             <ul>
//               <li>Your assigned buyer will download the petty cash form</li>
//               <li>The procurement process will continue as scheduled</li>
//               <li>You will be notified of any updates</li>
//             </ul>
            
//             <p>You can track your requisition status in your employee dashboard.</p>
            
//             <p>Best regards,<br>Procurement Team</p>
//           </div>
//         </div>
//       `
//     });
    
//     console.log('Petty cash form notification sent to employee:', requisition.employee.email);
//   } catch (error) {
//     console.error('Error sending employee notification:', error);
//     throw error;
//   }
// };

// module.exports = {
//   getPendingHeadApprovals,
//   getHeadApprovalStats,
//   getRequisitionDetails,
//   processHeadApproval,
//   sendPettyCashFormNotificationToBuyer,
//   sendPettyCashFormNotificationToEmployee
// };