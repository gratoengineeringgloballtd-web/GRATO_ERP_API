/**
 * Controller for handling purchase requisition resubmissions
 */

const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const BudgetCode = require('../models/BudgetCode');
const { getApprovalChainForRequisition } = require('../config/requisitionApprovalChain');
const { sendEmail } = require('../services/emailService');

/**
 * Resubmit a rejected purchase requisition
 * POST /api/purchase-requisitions/:requisitionId/resubmit
 */
const resubmitRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { 
      title,
      itemCategory,
      budgetXAF,
      budgetCode,
      urgency,
      deliveryLocation,
      expectedDate,
      justificationOfPurchase,
      justificationOfPreferredSupplier,
      items,
      resubmissionNotes,
      removedAttachments // Array of attachment IDs to remove
    } = req.body;

    console.log('=== RESUBMIT PURCHASE REQUISITION ===');
    console.log('Requisition ID:', requisitionId);
    console.log('User:', req.user.userId);
    console.log('New attachments:', req.files?.length || 0);
    console.log('Removed attachments:', removedAttachments?.length || 0);

    // Find the requisition
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('budgetCode', 'code name budget used');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Verify user is the owner
    if (requisition.employee._id.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the requisition owner can resubmit'
      });
    }

    // Verify requisition is rejected
    if (!['rejected', 'supply_chain_rejected'].includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only rejected requisitions can be resubmitted',
        currentStatus: requisition.status
      });
    }

    // Validate budget code if changed
    let newBudgetCode = requisition.budgetCode;
    if (budgetCode && budgetCode !== requisition.budgetCode._id.toString()) {
      newBudgetCode = await BudgetCode.findById(budgetCode);
      
      if (!newBudgetCode) {
        return res.status(404).json({
          success: false,
          message: 'Budget code not found'
        });
      }

      if (!newBudgetCode.active || newBudgetCode.status !== 'active') {
        return res.status(400).json({
          success: false,
          message: 'Selected budget code is not active'
        });
      }

      // Check budget availability
      const estimatedCost = budgetXAF ? parseFloat(budgetXAF) : requisition.budgetXAF;
      const availableBudget = newBudgetCode.budget - newBudgetCode.used;

      if (estimatedCost > availableBudget) {
        return res.status(400).json({
          success: false,
          message: `Insufficient budget. Available: XAF ${availableBudget.toLocaleString()}, Required: XAF ${estimatedCost.toLocaleString()}`
        });
      }
    } else {
      newBudgetCode = requisition.budgetCode;
    }

    // Store rejection details in history before resubmitting
    const rejectionEntry = {
      rejectedBy: requisition.approvalChain.find(step => step.status === 'rejected')?.decidedBy || null,
      rejectorName: requisition.approvalChain.find(step => step.status === 'rejected')?.approver.name || 'Unknown',
      rejectorRole: requisition.approvalChain.find(step => step.status === 'rejected')?.approver.role || 'Unknown',
      rejectionDate: requisition.approvalChain.find(step => step.status === 'rejected')?.actionDate || new Date(),
      rejectionReason: requisition.approvalChain.find(step => step.status === 'rejected')?.comments || 'No reason provided',
      approvalLevel: requisition.approvalChain.find(step => step.status === 'rejected')?.level || 'Unknown',
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
      resubmitted: true,
      resubmittedDate: new Date(),
      resubmissionNotes: resubmissionNotes || ''
    };

    // Update rejection history
    if (!requisition.rejectionHistory) {
      requisition.rejectionHistory = [];
    }
    requisition.rejectionHistory.push(rejectionEntry);

    // Update requisition fields
    if (title) requisition.title = title;
    if (itemCategory) requisition.itemCategory = itemCategory;
    if (budgetXAF) requisition.budgetXAF = parseFloat(budgetXAF);
    if (urgency) requisition.urgency = urgency;
    if (deliveryLocation) requisition.deliveryLocation = deliveryLocation;
    if (expectedDate) requisition.expectedDate = new Date(expectedDate);
    if (justificationOfPurchase) requisition.justificationOfPurchase = justificationOfPurchase;
    if (justificationOfPreferredSupplier) requisition.justificationOfPreferredSupplier = justificationOfPreferredSupplier;
    
    // ✅ NEW: Handle items update
    if (items && Array.isArray(items) && items.length > 0) {
      // Validate items
      const validItems = items.filter(item => item && item.itemId);
      if (validItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one valid item is required'
        });
      }
      
      // Transform items to match database structure
      requisition.items = validItems.map(item => ({
        itemId: item.itemId,
        code: item.code,
        description: item.description,
        customDescription: item.customDescription || '',
        category: item.category,
        subcategory: item.subcategory,
        quantity: parseInt(item.quantity) || 1,
        measuringUnit: item.measuringUnit,
        estimatedPrice: parseFloat(item.estimatedPrice) || 0,
        customUnitPrice: typeof item.customUnitPrice === 'number' ? item.customUnitPrice : 0,
        projectName: item.projectName || ''
      }));
      
      console.log('Items updated:', requisition.items.length);
    }

    // Handle attachment changes
    // 1. Remove attachments marked for deletion
    if (removedAttachments && Array.isArray(removedAttachments) && removedAttachments.length > 0) {
      const removedIds = typeof removedAttachments === 'string' ? JSON.parse(removedAttachments) : removedAttachments;
      requisition.attachments = requisition.attachments.filter(
        attachment => !removedIds.includes(attachment._id.toString())
      );
      console.log(`Removed ${removedIds.length} attachments`);
    }

    // 2. Add new uploaded attachments
    if (req.files && req.files.length > 0) {
      const newAttachments = req.files.map(file => ({
        name: file.originalname,
        url: file.path,
        publicId: file.filename,
        uploadedAt: new Date()
      }));
      requisition.attachments.push(...newAttachments);
      console.log(`Added ${newAttachments.length} new attachments`);
    }

    // Update budget code if changed
    if (budgetCode && budgetCode !== requisition.budgetCode._id.toString()) {
      requisition.budgetCode = newBudgetCode._id;
      requisition.budgetCodeInfo = {
        code: newBudgetCode.code,
        name: newBudgetCode.name,
        department: newBudgetCode.department,
        budgetType: newBudgetCode.budgetType,
        availableAtSubmission: newBudgetCode.budget - newBudgetCode.used,
        submittedAmount: requisition.budgetXAF
      };
      console.log('Budget code changed to:', newBudgetCode.code);
    }

    // Reset approval chain with fresh approvers
    const employee = await User.findById(req.user.userId);
    const newApprovalChain = getApprovalChainForRequisition(employee.email);
    
    requisition.approvalChain = newApprovalChain.map(step => ({
      level: step.level,
      approver: {
        name: step.approver.name,
        email: step.approver.email,
        role: step.approver.role,
        department: step.approver.department
      },
      status: step.status || 'pending',
      assignedDate: new Date()
    }));

    // Reset status and decisions
    requisition.status = 'pending_supervisor';
    requisition.financeVerification = undefined;
    requisition.supplyChainReview = undefined;
    requisition.headApproval = undefined;

    // Update resubmission tracking
    requisition.isResubmission = true;
    requisition.resubmissionCount = (requisition.resubmissionCount || 0) + 1;
    requisition.lastResubmittedDate = new Date();

    await requisition.save();

    console.log('✅ Requisition resubmitted successfully');
    console.log(`   Resubmission Count: ${requisition.resubmissionCount}`);
    console.log(`   New Status: ${requisition.status}`);

    // Send notifications to first approver
    const firstApprover = requisition.approvalChain[0];
    if (firstApprover) {
      try {
        await sendEmail({
          to: firstApprover.approver.email,
          subject: `Resubmitted Purchase Requisition - ${requisition.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #fff7e6; padding: 20px; border-radius: 8px; border-left: 4px solid #faad14;">
                <h2 style="color: #faad14; margin-top: 0;">🔄 Purchase Requisition Resubmitted</h2>
                <p>Dear ${firstApprover.approver.name},</p>
                <p>A previously rejected purchase requisition has been revised and resubmitted for your review.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Requisition Details</h4>
                  <ul style="list-style: none; padding: 0;">
                    <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                    <li><strong>Title:</strong> ${requisition.title}</li>
                    <li><strong>Requester:</strong> ${employee.fullName}</li>
                    <li><strong>Department:</strong> ${employee.department}</li>
                    <li><strong>Budget:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                    <li><strong>Urgency:</strong> ${requisition.urgency}</li>
                    <li><strong>Resubmission Count:</strong> ${requisition.resubmissionCount}</li>
                  </ul>
                </div>

                ${resubmissionNotes ? `
                <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4 style="color: #1890ff; margin-top: 0;">Resubmission Notes</h4>
                  <p style="font-style: italic;">${resubmissionNotes}</p>
                </div>
                ` : ''}

                <div style="background-color: #fff1f0; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4 style="color: #f5222d; margin-top: 0;">Previous Rejection</h4>
                  <p><strong>Rejected by:</strong> ${rejectionEntry.rejectorName} (${rejectionEntry.rejectorRole})</p>
                  <p><strong>Reason:</strong> ${rejectionEntry.rejectionReason}</p>
                  <p><strong>Date:</strong> ${new Date(rejectionEntry.rejectionDate).toLocaleString('en-GB')}</p>
                </div>

                <div style="margin: 20px 0; text-align: center;">
                  <a href="${process.env.FRONTEND_URL}/supervisor/requisitions" 
                     style="background-color: #faad14; color: white; padding: 12px 24px; 
                            text-decoration: none; border-radius: 4px; display: inline-block;">
                    Review Requisition
                  </a>
                </div>

                <p style="color: #666; font-size: 12px; margin-top: 20px;">
                  This is a resubmission after revision. Please review the updated details carefully.
                </p>
              </div>
            </div>
          `
        });
        console.log('✓ Notification sent to first approver:', firstApprover.approver.email);
      } catch (emailError) {
        console.error('Failed to send notification:', emailError);
      }
    }

    res.json({
      success: true,
      message: 'Purchase requisition resubmitted successfully',
      data: requisition,
      metadata: {
        resubmissionCount: requisition.resubmissionCount,
        previousRejection: {
          rejectedBy: rejectionEntry.rejectorName,
          reason: rejectionEntry.rejectionReason,
          date: rejectionEntry.rejectionDate
        }
      }
    });

  } catch (error) {
    console.error('Resubmit requisition error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resubmit requisition',
      error: error.message
    });
  }
};

/**
 * Get rejection history for a requisition
 * GET /api/purchase-requisitions/:requisitionId/rejection-history
 */
const getRejectionHistory = async (req, res) => {
  try {
    const { requisitionId } = req.params;

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('rejectionHistory.rejectedBy', 'fullName email')
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Verify user has access
    const user = await User.findById(req.user.userId);
    const hasAccess = 
      requisition.employee._id.equals(req.user.userId) ||
      user.role === 'admin' ||
      user.role === 'finance' ||
      user.role === 'supply_chain';

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: {
        requisitionNumber: requisition.requisitionNumber,
        title: requisition.title,
        currentStatus: requisition.status,
        isResubmission: requisition.isResubmission,
        resubmissionCount: requisition.resubmissionCount,
        rejectionHistory: requisition.rejectionHistory || []
      }
    });

  } catch (error) {
    console.error('Get rejection history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rejection history',
      error: error.message
    });
  }
};

module.exports = {
  resubmitRequisition,
  getRejectionHistory
};
