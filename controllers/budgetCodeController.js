const BudgetCode = require('../models/BudgetCode');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const CashRequest = require('../models/CashRequest');
const SalaryPayment = require('../models/SalaryPayment');
const User = require('../models/User');
const { getBudgetCodeApprovalChain, validateBudgetCodeApproval, getNextBudgetCodeStatus } = require('../config/budgetCodeApprovalChain');
const { sendEmail } = require('../services/emailService');

// Helper function to calculate actual budget usage from all sources
const calculateBudgetUsage = async (budgetCodeId) => {
  try {
    let totalUsed = 0;

    // 1. Calculate usage from Purchase Requisitions (only count those approved by head or beyond)
    const requisitionStatuses = [
      'approved',
      'assigned_to_buyer',
      'converted_to_po',
      'partially_delivered',
      'fully_delivered',
      'fully_disbursed',
      'sourcing',
      'justified',
      'justification_pending_supervisor',
      'justification_pending_finance',
      'justification_pending_supply_chain',
      'justification_pending_head',
      'justification_approved'
    ];

    const purchaseRequisitions = await PurchaseRequisition.find({
      budgetCode: budgetCodeId,
      status: { $in: requisitionStatuses }
    }).select('budgetXAF');

    const requisitionTotal = purchaseRequisitions.reduce((sum, req) => sum + (req.budgetXAF || 0), 0);
    totalUsed += requisitionTotal;

    // 2. Calculate usage from Cash Requests (only approved and disbursed)
    const cashRequestStatuses = [
      'approved',
      'fully_disbursed',
      'completed'
    ];

    const cashRequests = await CashRequest.find({
      'budgetAllocation.budgetCodeId': budgetCodeId,
      status: { $in: cashRequestStatuses }
    }).select('amountRequested');

    const cashRequestTotal = cashRequests.reduce((sum, req) => sum + (req.amountRequested || 0), 0);
    totalUsed += cashRequestTotal;

    // 3. Calculate usage from Salary Payments
    const salaryPayments = await SalaryPayment.find({
      'departmentPayments.budgetCode': budgetCodeId,
      status: 'processed'
    }).select('departmentPayments');

    salaryPayments.forEach(payment => {
      payment.departmentPayments.forEach(dept => {
        if (dept.budgetCode && dept.budgetCode.toString() === budgetCodeId.toString()) {
          totalUsed += dept.amount || 0;
        }
      });
    });

    return Math.round(totalUsed * 100) / 100; // Round to 2 decimal places
  } catch (error) {
    console.error('Error calculating budget usage:', error);
    return 0;
  }
};

// Create new budget code with approval workflow
const createBudgetCode = async (req, res) => {
  try {
    console.log('=== CREATE BUDGET CODE WITH APPROVAL WORKFLOW ===');
    console.log('Request data:', req.body);
    console.log('User:', req.user);

    const {
      code,
      name,
      description,
      budget,
      department,
      budgetType,
      budgetPeriod,
      budgetOwner,
      startDate,
      endDate
    } = req.body;

    // Validate required fields
    if (!code || !name || !budget || !department || !budgetType || !budgetPeriod || !budgetOwner) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: code, name, budget, department, budgetType, budgetPeriod, budgetOwner'
      });
    }

    // Check if budget code already exists
    const existingCode = await BudgetCode.findOne({ code: code.toUpperCase() });
    if (existingCode) {
      return res.status(400).json({
        success: false,
        message: 'Budget code already exists'
      });
    }

    // Validate budget amount
    if (budget <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Budget amount must be greater than zero'
      });
    }

    // Get creator information
    const creator = await User.findById(req.user.userId);
    if (!creator) {
      return res.status(404).json({
        success: false,
        message: 'Creator not found'
      });
    }

    // Generate approval chain
    const approvalChain = getBudgetCodeApprovalChain(creator.fullName, department, budgetType);

    // Determine initial status
    let initialStatus = 'pending';
    if (approvalChain.length > 0) {
      initialStatus = 'pending_departmental_head';
    }

    // Create budget code
    const budgetCode = new BudgetCode({
      code: code.toUpperCase(),
      name,
      description,
      budget: parseFloat(budget),
      department,
      budgetType,
      budgetPeriod,
      budgetOwner,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : undefined,
      active: false, // Budget code starts as inactive until approved
      status: initialStatus,
      approvalChain,
      createdBy: req.user.userId
    });

    await budgetCode.save();

    console.log('Budget code created successfully:', budgetCode._id);

    // Send notification to first approver
    if (approvalChain.length > 0) {
      const firstApprover = approvalChain[0].approver;
      await sendBudgetCodeApprovalEmail(
        firstApprover.email,
        firstApprover.name,
        budgetCode,
        creator.fullName
      );
    }

    res.status(201).json({
      success: true,
      message: 'Budget code created successfully and sent for approval',
      data: budgetCode
    });

  } catch (error) {
    console.error('Create budget code error:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: `Validation error: ${validationErrors.join(', ')}`
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Budget code already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create budget code',
      error: error.message
    });
  }
};

// Process budget code approval/rejection
const processBudgetCodeApproval = async (req, res) => {
  try {
    console.log('=== PROCESS BUDGET CODE APPROVAL ===');
    const { codeId } = req.params;
    const { decision, comments } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be "approved" or "rejected"'
      });
    }

    // Find budget code
    let budgetCode = await BudgetCode.findById(codeId)
      .populate('createdBy', 'fullName email')
      .populate('budgetOwner', 'fullName email');
    
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() })
        .populate('createdBy', 'fullName email')
        .populate('budgetOwner', 'fullName email');
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    // Get user information
    const user = await User.findById(req.user.userId);

    // Validate approval permission
    const validation = validateBudgetCodeApproval(user, budgetCode);
    if (!validation.canApprove) {
      return res.status(403).json({
        success: false,
        message: validation.reason
      });
    }

    // Find current approval step
    const currentStep = budgetCode.approvalChain.find(step => step.status === 'pending');
    if (!currentStep) {
      return res.status(400).json({
        success: false,
        message: 'No pending approval step found'
      });
    }

    // Update current step
    currentStep.status = decision;
    currentStep.actionDate = new Date();
    currentStep.actionTime = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    currentStep.comments = comments;

    if (decision === 'rejected') {
      // Handle rejection
      budgetCode.status = 'rejected';
      budgetCode.active = false;
      budgetCode.rejectionReason = comments;
      budgetCode.rejectedBy = req.user.userId;
      budgetCode.rejectionDate = new Date();

      await budgetCode.save();

      // Notify creator of rejection
      await sendBudgetCodeRejectionEmail(
        budgetCode.createdBy.email,
        budgetCode.createdBy.fullName,
        budgetCode,
        user.fullName,
        comments
      );

      return res.json({
        success: true,
        message: 'Budget code rejected',
        data: budgetCode
      });
    }

    // Handle approval
    const nextStepIndex = budgetCode.approvalChain.findIndex(
      step => step.level === currentStep.level + 1
    );

    if (nextStepIndex !== -1) {
      // Move to next approval level
      const nextStep = budgetCode.approvalChain[nextStepIndex];
      budgetCode.status = getNextBudgetCodeStatus(currentStep.level, budgetCode.approvalChain.length);

      await budgetCode.save();

      // Notify next approver
      await sendBudgetCodeApprovalEmail(
        nextStep.approver.email,
        nextStep.approver.name,
        budgetCode,
        user.fullName,
        currentStep.level
      );

      return res.json({
        success: true,
        message: `Budget code approved. Moved to next approval level (${nextStep.approver.role})`,
        data: budgetCode
      });
    } else {
      // Final approval - activate budget code
      budgetCode.status = 'active';
      budgetCode.active = true;
      budgetCode.approvedBy = req.user.userId;

      await budgetCode.save();

      // Notify creator and budget owner of activation
      await sendBudgetCodeActivationEmail(
        budgetCode.createdBy.email,
        budgetCode.createdBy.fullName,
        budgetCode,
        user.fullName
      );

      if (budgetCode.budgetOwner && budgetCode.budgetOwner._id.toString() !== budgetCode.createdBy._id.toString()) {
        await sendBudgetCodeActivationEmail(
          budgetCode.budgetOwner.email,
          budgetCode.budgetOwner.fullName,
          budgetCode,
          user.fullName
        );
      }

      return res.json({
        success: true,
        message: 'Budget code fully approved and activated',
        data: budgetCode
      });
    }

  } catch (error) {
    console.error('Process budget code approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process approval',
      error: error.message
    });
  }
};

// Get budget codes with approval status filtering
const getBudgetCodes = async (req, res) => {
  try {
    const { 
      active, 
      department, 
      budgetType, 
      status,
      utilizationThreshold,
      page = 1, 
      limit = 50 
    } = req.query;

    let filter = {};
    
    if (active !== undefined) filter.active = active === 'true';
    if (department) filter.department = department;
    if (budgetType) filter.budgetType = budgetType;
    if (status) filter.status = status;

    const budgetCodes = await BudgetCode.find(filter)
      .populate('createdBy', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .populate('budgetOwner', 'fullName email department')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Calculate actual usage for each budget code
    const budgetCodesWithUsage = await Promise.all(
      budgetCodes.map(async (code) => {
        const actualUsed = await calculateBudgetUsage(code._id);
        const codeObj = code.toObject();
        codeObj.used = actualUsed;
        codeObj.remaining = code.budget - actualUsed;
        codeObj.utilizationPercentage = code.budget > 0 ? Math.round((actualUsed / code.budget) * 100) : 0;
        return codeObj;
      })
    );

    let filteredCodes = budgetCodesWithUsage;
    if (utilizationThreshold) {
      const threshold = parseFloat(utilizationThreshold);
      filteredCodes = budgetCodesWithUsage.filter(code => code.utilizationPercentage >= threshold);
    }

    const total = await BudgetCode.countDocuments(filter);

    res.json({
      success: true,
      data: filteredCodes,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: filteredCodes.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get budget codes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget codes',
      error: error.message
    });
  }
};

// Get budget codes pending approval for current user
const getPendingApprovalsForUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const pendingCodes = await BudgetCode.find({
      'approvalChain.approver.email': user.email,
      'approvalChain.status': 'pending',
      status: { $nin: ['active', 'rejected'] }
    })
    .populate('createdBy', 'fullName email')
    .populate('budgetOwner', 'fullName email department')
    .sort({ createdAt: -1 });

    // Filter to only show codes where current step is for this user
    const userPendingCodes = pendingCodes.filter(code => {
      const currentStep = code.approvalChain.find(step => step.status === 'pending');
      return currentStep && currentStep.approver.email === user.email;
    });

    res.json({
      success: true,
      data: userPendingCodes,
      count: userPendingCodes.length
    });

  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending approvals',
      error: error.message
    });
  }
};

// Get single budget code by ID or code
const getBudgetCode = async (req, res) => {
  try {
    const { codeId } = req.params;
    
    let budgetCode = await BudgetCode.findById(codeId)
      .populate('createdBy', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .populate('budgetOwner', 'fullName email department')
      .populate('allocations.requisitionId', 'title requisitionNumber employee');

    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() })
        .populate('createdBy', 'fullName email')
        .populate('approvedBy', 'fullName email')
        .populate('budgetOwner', 'fullName email department')
        .populate('allocations.requisitionId', 'title requisitionNumber employee');
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    // Calculate actual usage
    const actualUsed = await calculateBudgetUsage(budgetCode._id);
    const budgetCodeObj = budgetCode.toObject();
    budgetCodeObj.used = actualUsed;
    budgetCodeObj.remaining = budgetCode.budget - actualUsed;
    budgetCodeObj.utilizationPercentage = budgetCode.budget > 0 ? Math.round((actualUsed / budgetCode.budget) * 100) : 0;

    res.json({
      success: true,
      data: budgetCodeObj
    });

  } catch (error) {
    console.error('Get budget code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget code',
      error: error.message
    });
  }
};

// Update budget code
const updateBudgetCode = async (req, res) => {
  try {
    const { codeId } = req.params;
    const updateData = req.body;

    let budgetCode = await BudgetCode.findById(codeId);
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() });
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    // Check permissions
    const user = await User.findById(req.user.userId);
    const canUpdate = 
      user.role === 'admin' || 
      user.role === 'finance' ||
      user.email === 'ranibellmambo@gratoengineering.com';

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Handle budget amount changes
    if (updateData.budget && updateData.budget !== budgetCode.budget) {
      const newBudget = parseFloat(updateData.budget);
      const reason = updateData.budgetChangeReason || 'Budget adjustment';
      
      if (newBudget < budgetCode.used) {
        return res.status(400).json({
          success: false,
          message: `New budget amount cannot be less than already used amount (XAF ${budgetCode.used.toLocaleString()})`
        });
      }

      await budgetCode.updateBudget(newBudget, reason, req.user.userId);
    }

    // Update other fields
    const allowedFields = [
      'name', 'description', 'department', 'budgetType', 
      'budgetPeriod', 'budgetOwner', 'active', 'startDate', 'endDate'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        if (field === 'startDate' || field === 'endDate') {
          budgetCode[field] = updateData[field] ? new Date(updateData[field]) : null;
        } else {
          budgetCode[field] = updateData[field];
        }
      }
    });

    budgetCode.lastModifiedBy = req.user.userId;
    await budgetCode.save();

    res.json({
      success: true,
      message: 'Budget code updated successfully',
      data: budgetCode
    });

  } catch (error) {
    console.error('Update budget code error:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: `Validation error: ${validationErrors.join(', ')}`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update budget code',
      error: error.message
    });
  }
};

// Delete budget code
const deleteBudgetCode = async (req, res) => {
  try {
    const { codeId } = req.params;

    let budgetCode = await BudgetCode.findById(codeId);
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() });
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    // Check if budget code is in use
    const activeAllocations = budgetCode.allocations.filter(alloc => alloc.status === 'allocated');
    if (activeAllocations.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete budget code with active allocations'
      });
    }

    const requisitionsUsingCode = await PurchaseRequisition.countDocuments({
      'financeVerification.budgetCode': budgetCode.code
    });

    if (requisitionsUsingCode > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete budget code that is referenced by purchase requisitions'
      });
    }

    await BudgetCode.findByIdAndDelete(budgetCode._id);

    res.json({
      success: true,
      message: 'Budget code deleted successfully'
    });

  } catch (error) {
    console.error('Delete budget code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete budget code',
      error: error.message
    });
  }
};

// Email notification functions
async function sendBudgetCodeApprovalEmail(approverEmail, approverName, budgetCode, requestorName, previousLevel = 0) {
  try {
    const subject = `Budget Code Approval Required: ${budgetCode.code}`;
    const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const approvalLink = `${clientUrl}/finance/budget-codes/${budgetCode._id}/approve`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1890ff;">Budget Code Approval Required</h2>
        <p>Dear ${approverName},</p>
        <p>A new budget code requires your approval:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Budget Code:</strong> ${budgetCode.code}</p>
          <p><strong>Name:</strong> ${budgetCode.name}</p>
          <p><strong>Department:</strong> ${budgetCode.department}</p>
          <p><strong>Budget Amount:</strong> XAF ${budgetCode.budget.toLocaleString()}</p>
          <p><strong>Budget Type:</strong> ${budgetCode.budgetType}</p>
          <p><strong>Created by:</strong> ${requestorName}</p>
        </div>

        <p style="text-align: center;">
          <a href="${approvalLink}" style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Review Budget Code
          </a>
        </p>
      </div>
    `;

    await sendEmail({
      to: approverEmail,
      subject,
      html
    });
  } catch (error) {
    console.error('Failed to send budget code approval email:', error);
  }
}

async function sendBudgetCodeRejectionEmail(userEmail, userName, budgetCode, rejectedBy, reason) {
  try {
    const subject = `Budget Code Rejected: ${budgetCode.code}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ff4d4f;">Budget Code Rejected</h2>
        <p>Dear ${userName},</p>
        <p>Your budget code has been rejected:</p>
        
        <div style="background-color: #fff2f0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ff4d4f;">
          <p><strong>Budget Code:</strong> ${budgetCode.code}</p>
          <p><strong>Name:</strong> ${budgetCode.name}</p>
          <p><strong>Rejected by:</strong> ${rejectedBy}</p>
          <p><strong>Reason:</strong> ${reason}</p>
        </div>

        <p>You may create a new budget code with the necessary adjustments.</p>
      </div>
    `;

    await sendEmail({
      to: userEmail,
      subject,
      html
    });
  } catch (error) {
    console.error('Failed to send budget code rejection email:', error);
  }
}

async function sendBudgetCodeActivationEmail(userEmail, userName, budgetCode, approvedBy) {
  try {
    const subject = `Budget Code Activated: ${budgetCode.code}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #52c41a;">Budget Code Activated</h2>
        <p>Dear ${userName},</p>
        <p>Your budget code has been fully approved and activated:</p>
        
        <div style="background-color: #f6ffed; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #52c41a;">
          <p><strong>Budget Code:</strong> ${budgetCode.code}</p>
          <p><strong>Name:</strong> ${budgetCode.name}</p>
          <p><strong>Budget Amount:</strong> XAF ${budgetCode.budget.toLocaleString()}</p>
          <p><strong>Department:</strong> ${budgetCode.department}</p>
          <p><strong>Final Approved by:</strong> ${approvedBy}</p>
        </div>

        <p>The budget code is now active and can be used for purchase requisitions.</p>
      </div>
    `;

    await sendEmail({
      to: userEmail,
      subject,
      html
    });
  } catch (error) {
    console.error('Failed to send budget code activation email:', error);
  }
}

// Additional utility functions
const getBudgetCodeUtilization = async (req, res) => {
  try {
    const { codeId } = req.params;
    const { period = 'monthly', startDate, endDate } = req.query;

    let budgetCode = await BudgetCode.findById(codeId)
      .populate('allocations.requisitionId', 'title requisitionNumber employee createdAt');
    
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() })
        .populate('allocations.requisitionId', 'title requisitionNumber employee createdAt');
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    // Calculate actual usage
    const actualUsed = await calculateBudgetUsage(budgetCode._id);
    const utilizationPercentage = budgetCode.budget > 0 ? Math.round((actualUsed / budgetCode.budget) * 100) : 0;

    let allocations = budgetCode.allocations;
    if (startDate || endDate) {
      allocations = allocations.filter(alloc => {
        const allocDate = alloc.allocationDate;
        if (startDate && allocDate < new Date(startDate)) return false;
        if (endDate && allocDate > new Date(endDate)) return false;
        return true;
      });
    }

    const totalAllocated = allocations.reduce((sum, alloc) => sum + alloc.allocatedAmount, 0);
    const totalSpent = allocations.reduce((sum, alloc) => sum + (alloc.actualSpent || 0), 0);
    
    const utilizationData = {
      budgetCode: {
        code: budgetCode.code,
        name: budgetCode.name,
        totalBudget: budgetCode.budget,
        totalUsed: actualUsed,
        utilizationPercentage: utilizationPercentage,
        status: budgetCode.status
      },
      summary: {
        totalAllocated,
        totalSpent,
        pendingAllocations: allocations.filter(a => a.status === 'allocated').length,
        completedAllocations: allocations.filter(a => a.status === 'spent').length,
        averageAllocation: allocations.length > 0 ? totalAllocated / allocations.length : 0
      },
      recentAllocations: allocations
        .sort((a, b) => new Date(b.allocationDate) - new Date(a.allocationDate))
        .slice(0, 10)
    };

    res.json({
      success: true,
      data: utilizationData,
      period
    });

  } catch (error) {
    console.error('Get budget code utilization error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget code utilization',
      error: error.message
    });
  }
};

const allocateBudgetToRequisition = async (req, res) => {
  try {
    const { codeId } = req.params;
    const { requisitionId, amount } = req.body;

    let budgetCode = await BudgetCode.findById(codeId);
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() });
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    if (!budgetCode.active) {
      return res.status(400).json({
        success: false,
        message: 'Budget code is not active'
      });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId);
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Purchase requisition not found'
      });
    }

    const existingAllocation = budgetCode.allocations.find(
      alloc => alloc.requisitionId.equals(requisitionId)
    );

    if (existingAllocation) {
      return res.status(400).json({
        success: false,
        message: 'Budget already allocated to this requisition'
      });
    }

    await budgetCode.allocateBudget(requisitionId, parseFloat(amount));

    if (!requisition.financeVerification) {
      requisition.financeVerification = {};
    }
    requisition.financeVerification.budgetCode = budgetCode.code;
    requisition.financeVerification.assignedBudget = parseFloat(amount);
    await requisition.save();

    res.json({
      success: true,
      message: 'Budget allocated successfully',
      data: {
        budgetCode: budgetCode.code,
        allocatedAmount: amount,
        remainingBudget: budgetCode.remaining
      }
    });

  } catch (error) {
    console.error('Allocate budget error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to allocate budget',
      error: error.message
    });
  }
};


const getBudgetDashboard = async (req, res) => {
  try {
    const { department, budgetType, fiscalYear } = req.query;

    const filters = { active: true };
    if (department) filters.department = department;
    if (budgetType) filters.budgetType = budgetType;
    if (fiscalYear) filters.fiscalYear = parseInt(fiscalYear);

    // Get budget codes with filters
    const budgetCodes = await BudgetCode.find(filters)
      .populate('budgetOwner', 'fullName email department')
      .populate('createdBy', 'fullName email');

    // Calculate actual usage for each budget code dynamically
    const codesWithActualUsage = await Promise.all(
      budgetCodes.map(async (code) => {
        const actualUsed = await calculateBudgetUsage(code._id);
        return {
          ...code.toObject(),
          used: actualUsed,
          remaining: code.budget - actualUsed,
          utilizationPercentage: code.budget > 0 ? Math.round((actualUsed / code.budget) * 10000) / 100 : 0
        };
      })
    );

    // Sort by utilization percentage descending
    codesWithActualUsage.sort((a, b) => b.utilizationPercentage - a.utilizationPercentage);

    // Calculate summary
    const summary = {
      totalBudget: 0,
      totalUsed: 0,
      totalRemaining: 0,
      totalCodes: codesWithActualUsage.length,
      activeReservations: 0,
      criticalCodes: 0,
      warningCodes: 0,
      healthyCodes: 0,
      overallUtilization: 0
    };

    codesWithActualUsage.forEach(code => {
      summary.totalBudget += code.budget;
      summary.totalUsed += code.used;
      summary.totalRemaining += code.remaining;

      const utilization = code.utilizationPercentage;
      if (utilization >= 90) summary.criticalCodes++;
      else if (utilization >= 75) summary.warningCodes++;
      else summary.healthyCodes++;

      summary.activeReservations += code.allocations?.filter(
        a => a.status === 'allocated'
      ).length || 0;
    });

    if (summary.totalBudget > 0) {
      summary.overallUtilization = Math.round(
        (summary.totalUsed / summary.totalBudget) * 10000
      ) / 100;
    }

    // Generate alerts
    const alerts = [];
    codesWithActualUsage.forEach(code => {
      const utilization = code.utilizationPercentage;

      if (utilization >= 90) {
        alerts.push({
          type: 'critical',
          budgetCode: code.code,
          name: code.name,
          message: `${code.name} is ${utilization}% utilized. Immediate action required.`,
          utilization,
          remaining: code.remaining,
          owner: code.budgetOwner
        });
      } else if (utilization >= 75) {
        alerts.push({
          type: 'warning',
          budgetCode: code.code,
          name: code.name,
          message: `${code.name} is ${utilization}% utilized. Monitor closely.`,
          utilization,
          remaining: code.remaining,
          owner: code.budgetOwner
        });
      }

      // Check for stale reservations
      const staleReservations = code.allocations?.filter(alloc => {
        if (alloc.status !== 'allocated') return false;
        const daysSince = (Date.now() - alloc.allocatedDate) / (1000 * 60 * 60 * 24);
        return daysSince > 30;
      }) || [];

      if (staleReservations.length > 0) {
        alerts.push({
          type: 'info',
          budgetCode: code.code,
          name: code.name,
          message: `${staleReservations.length} stale reservation(s) detected (>30 days).`,
          action: 'Review and release if no longer needed',
          staleCount: staleReservations.length,
          owner: code.budgetOwner
        });
      }
    });

    res.json({
      success: true,
      data: {
        summary,
        budgetCodes: codesWithActualUsage,
        alerts
      }
    });
  } catch (error) {
    console.error('Get budget dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget dashboard',
      error: error.message
    });
  }
};

// ============================================
// BUDGET REPORTS & ANALYTICS
// ============================================

const getBudgetUtilizationReport = async (req, res) => {
  try {
    const { department, budgetType, fiscalYear } = req.query;

    const filters = {};
    if (department) filters.department = department;
    if (budgetType) filters.budgetType = budgetType;
    if (fiscalYear) filters.fiscalYear = parseInt(fiscalYear);

    const report = await BudgetCode.getUtilizationReport(filters);

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Get utilization report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate utilization report',
      error: error.message
    });
  }
};

const getBudgetForecast = async (req, res) => {
  try {
    const { codeId } = req.params;

    let budgetCode = await BudgetCode.findById(codeId);
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() });
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    const forecast = budgetCode.getForecast();

    res.json({
      success: true,
      data: {
        budgetCode: {
          code: budgetCode.code,
          name: budgetCode.name,
          budget: budgetCode.budget,
          used: budgetCode.used,
          remaining: budgetCode.remaining,
          utilizationPercentage: budgetCode.utilizationPercentage
        },
        forecast
      }
    });
  } catch (error) {
    console.error('Get budget forecast error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate budget forecast',
      error: error.message
    });
  }
};

// ============================================
// BUDGET REVISIONS
// ============================================

const requestBudgetRevision = async (req, res) => {
  try {
    const { codeId } = req.params;
    const { newBudget, reason } = req.body;

    if (!newBudget || !reason) {
      return res.status(400).json({
        success: false,
        message: 'New budget amount and reason are required'
      });
    }

    let budgetCode = await BudgetCode.findById(codeId);
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() });
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    const revision = await budgetCode.requestBudgetRevision(
      parseFloat(newBudget),
      reason,
      req.user.userId
    );

    res.status(201).json({
      success: true,
      message: 'Budget revision requested successfully',
      data: {
        budgetCode,
        revision
      }
    });
  } catch (error) {
    console.error('Request budget revision error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to request budget revision',
      error: error.message
    });
  }
};

const getBudgetRevisions = async (req, res) => {
  try {
    const { codeId } = req.params;
    const { status } = req.query;

    let budgetCode = await BudgetCode.findById(codeId)
      .populate('budgetRevisions.requestedBy', 'fullName email department')
      .populate('budgetRevisions.approvedBy', 'fullName email')
      .populate('budgetRevisions.rejectedBy', 'fullName email');

    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() })
        .populate('budgetRevisions.requestedBy', 'fullName email department')
        .populate('budgetRevisions.approvedBy', 'fullName email')
        .populate('budgetRevisions.rejectedBy', 'fullName email');
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    let revisions = budgetCode.budgetRevisions;

    if (status) {
      revisions = revisions.filter(r => r.status === status);
    }

    res.json({
      success: true,
      data: {
        budgetCode: {
          _id: budgetCode._id,
          code: budgetCode.code,
          name: budgetCode.name,
          budget: budgetCode.budget
        },
        revisions
      }
    });
  } catch (error) {
    console.error('Get budget revisions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget revisions',
      error: error.message
    });
  }
};

const approveBudgetRevision = async (req, res) => {
  try {
    const { codeId, revisionId } = req.params;
    const { comments } = req.body;

    let budgetCode = await BudgetCode.findById(codeId);
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() });
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    const revision = await budgetCode.approveBudgetRevision(
      revisionId,
      req.user.userId,
      comments
    );

    res.json({
      success: true,
      message: revision.status === 'approved' 
        ? 'Budget revision approved and applied'
        : 'Budget revision approved. Moved to next level.',
      data: {
        budgetCode,
        revision
      }
    });
  } catch (error) {
    console.error('Approve budget revision error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to approve budget revision',
      error: error.message
    });
  }
};

const rejectBudgetRevision = async (req, res) => {
  try {
    const { codeId, revisionId } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    let budgetCode = await BudgetCode.findById(codeId);
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() });
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    const revision = await budgetCode.rejectBudgetRevision(
      revisionId,
      req.user.userId,
      rejectionReason
    );

    res.json({
      success: true,
      message: 'Budget revision rejected',
      data: {
        budgetCode,
        revision
      }
    });
  } catch (error) {
    console.error('Reject budget revision error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reject budget revision',
      error: error.message
    });
  }
};

const getPendingRevisions = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const budgetCodes = await BudgetCode.find({
      'budgetRevisions.approvalChain.approver.email': user.email,
      'budgetRevisions.approvalChain.status': 'pending',
      'budgetRevisions.status': 'pending'
    })
      .populate('budgetOwner', 'fullName email department')
      .populate('budgetRevisions.requestedBy', 'fullName email department');

    const pendingRevisions = [];

    budgetCodes.forEach(budgetCode => {
      budgetCode.budgetRevisions.forEach(revision => {
        if (revision.status === 'pending') {
          const currentStep = revision.approvalChain.find(
            step => step.status === 'pending' && step.approver.email === user.email
          );

          if (currentStep) {
            pendingRevisions.push({
              budgetCode: {
                _id: budgetCode._id,
                code: budgetCode.code,
                name: budgetCode.name,
                currentBudget: budgetCode.budget
              },
              revision: revision,
              currentApprovalLevel: currentStep.level
            });
          }
        }
      });
    });

    res.json({
      success: true,
      data: pendingRevisions,
      count: pendingRevisions.length
    });
  } catch (error) {
    console.error('Get pending revisions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending revisions',
      error: error.message
    });
  }
};

// Get detailed usage tracking for a budget code
const getBudgetCodeUsageTracking = async (req, res) => {
  try {
    const { codeId } = req.params;
    const { startDate, endDate, limit = 50 } = req.query;

    let budgetCode = await BudgetCode.findById(codeId);
    if (!budgetCode) {
      budgetCode = await BudgetCode.findOne({ code: codeId.toUpperCase() });
    }

    if (!budgetCode) {
      return res.status(404).json({
        success: false,
        message: 'Budget code not found'
      });
    }

    // Calculate actual usage
    const actualUsed = await calculateBudgetUsage(budgetCode._id);

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    // 1. Get Purchase Requisitions (only count those approved by head or beyond)
    const requisitionStatuses = [
      'approved',
      'assigned_to_buyer',
      'converted_to_po',
      'partially_delivered',
      'fully_delivered',
      'fully_disbursed',
      'sourcing',
      'justified',
      'justification_pending_supervisor',
      'justification_pending_finance',
      'justification_pending_supply_chain',
      'justification_pending_head',
      'justification_approved'
    ];

    const requisitionQuery = {
      budgetCode: budgetCode._id,
      status: { $in: requisitionStatuses }
    };
    if (Object.keys(dateFilter).length > 0) {
      requisitionQuery.createdAt = dateFilter;
    }

    const purchaseRequisitions = await PurchaseRequisition.find(requisitionQuery)
      .populate('employee', 'fullName email department')
      .select('requisitionNumber title budgetXAF status createdAt employee')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    const requisitionTotal = purchaseRequisitions.reduce((sum, req) => sum + (req.budgetXAF || 0), 0);

    // 2. Get Cash Requests (only approved and disbursed)
    const cashRequestStatuses = [
      'approved',
      'fully_disbursed',
      'completed'
    ];

    const cashRequestQuery = {
      'budgetAllocation.budgetCodeId': budgetCode._id,
      status: { $in: cashRequestStatuses }
    };
    if (Object.keys(dateFilter).length > 0) {
      cashRequestQuery.createdAt = dateFilter;
    }

    const cashRequests = await CashRequest.find(cashRequestQuery)
      .populate('employee', 'fullName email department')
      .select('requestType amountRequested status createdAt employee totalDisbursed')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    const cashRequestTotal = cashRequests.reduce((sum, req) => sum + (req.amountRequested || 0), 0);

    // 3. Get Salary Payments
    const salaryQuery = {
      'departmentPayments.budgetCode': budgetCode._id,
      status: 'processed'
    };
    if (Object.keys(dateFilter).length > 0) {
      salaryQuery.createdAt = dateFilter;
    }

    const salaryPayments = await SalaryPayment.find(salaryQuery)
      .populate('submittedBy', 'fullName email')
      .select('paymentPeriod departmentPayments totalAmount status createdAt submittedBy')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    let salaryTotal = 0;
    const salaryDetails = [];
    salaryPayments.forEach(payment => {
      payment.departmentPayments.forEach(dept => {
        if (dept.budgetCode && dept.budgetCode.toString() === budgetCode._id.toString()) {
          salaryTotal += dept.amount || 0;
          salaryDetails.push({
            _id: payment._id,
            department: dept.department,
            amount: dept.amount,
            notes: dept.notes,
            paymentPeriod: payment.paymentPeriod,
            submittedBy: payment.submittedBy,
            createdAt: payment.createdAt
          });
        }
      });
    });

    // Calculate usage by month (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyUsage = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() - i);
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

      const reqInMonth = await PurchaseRequisition.find({
        budgetCode: budgetCode._id,
        status: { $in: requisitionStatuses },
        createdAt: { $gte: monthStart, $lte: monthEnd }
      }).select('budgetXAF');

      const cashInMonth = await CashRequest.find({
        'budgetAllocation.budgetCodeId': budgetCode._id,
        status: { $in: cashRequestStatuses },
        createdAt: { $gte: monthStart, $lte: monthEnd }
      }).select('amountRequested');

      const salaryInMonth = await SalaryPayment.find({
        'departmentPayments.budgetCode': budgetCode._id,
        status: 'processed',
        createdAt: { $gte: monthStart, $lte: monthEnd }
      }).select('departmentPayments');

      let salaryMonthTotal = 0;
      salaryInMonth.forEach(payment => {
        payment.departmentPayments.forEach(dept => {
          if (dept.budgetCode && dept.budgetCode.toString() === budgetCode._id.toString()) {
            salaryMonthTotal += dept.amount || 0;
          }
        });
      });

      const reqTotal = reqInMonth.reduce((sum, r) => sum + (r.budgetXAF || 0), 0);
      const cashTotal = cashInMonth.reduce((sum, c) => sum + (c.amountRequested || 0), 0);

      monthlyUsage.push({
        month: monthDate.toLocaleString('default', { month: 'short', year: 'numeric' }),
        purchaseRequisitions: reqTotal,
        cashRequests: cashTotal,
        salaryPayments: salaryMonthTotal,
        total: reqTotal + cashTotal + salaryMonthTotal
      });
    }

    // Usage by department
    const departmentUsage = {};
    
    // From Purchase Requisitions
    const allRequisitions = await PurchaseRequisition.find({
      budgetCode: budgetCode._id,
      status: { $in: requisitionStatuses }
    }).populate('employee', 'department').select('totalCost employee');

    allRequisitions.forEach(req => {
      const dept = req.employee?.department || 'Unknown';
      if (!departmentUsage[dept]) {
        departmentUsage[dept] = { purchaseRequisitions: 0, cashRequests: 0, salaryPayments: 0, total: 0 };
      }
      departmentUsage[dept].purchaseRequisitions += req.totalCost || 0;
      departmentUsage[dept].total += req.totalCost || 0;
    });

    // From Cash Requests
    const allCashRequests = await CashRequest.find({
      'budgetAllocation.budgetCodeId': budgetCode._id,
      status: { $in: cashRequestStatuses }
    }).populate('employee', 'department').select('amountRequested employee');

    allCashRequests.forEach(req => {
      const dept = req.employee?.department || 'Unknown';
      if (!departmentUsage[dept]) {
        departmentUsage[dept] = { purchaseRequisitions: 0, cashRequests: 0, salaryPayments: 0, total: 0 };
      }
      departmentUsage[dept].cashRequests += req.amountRequested || 0;
      departmentUsage[dept].total += req.amountRequested || 0;
    });

    // From Salary Payments
    const allSalaryPayments = await SalaryPayment.find({
      'departmentPayments.budgetCode': budgetCode._id,
      status: 'processed'
    }).select('departmentPayments');

    allSalaryPayments.forEach(payment => {
      payment.departmentPayments.forEach(dept => {
        if (dept.budgetCode && dept.budgetCode.toString() === budgetCode._id.toString()) {
          const deptName = dept.department || 'Unknown';
          if (!departmentUsage[deptName]) {
            departmentUsage[deptName] = { purchaseRequisitions: 0, cashRequests: 0, salaryPayments: 0, total: 0 };
          }
          departmentUsage[deptName].salaryPayments += dept.amount || 0;
          departmentUsage[deptName].total += dept.amount || 0;
        }
      });
    });

    // Convert to array
    const departmentBreakdown = Object.keys(departmentUsage).map(dept => ({
      department: dept,
      ...departmentUsage[dept]
    })).sort((a, b) => b.total - a.total);

    // Response
    res.json({
      success: true,
      data: {
        budgetCode: {
          _id: budgetCode._id,
          code: budgetCode.code,
          name: budgetCode.name,
          department: budgetCode.department,
          budget: budgetCode.budget,
          used: actualUsed,
          remaining: budgetCode.budget - actualUsed,
          utilizationPercentage: budgetCode.budget > 0 ? Math.round((actualUsed / budgetCode.budget) * 10000) / 100 : 0
        },
        summary: {
          totalBudget: budgetCode.budget,
          usedAmount: actualUsed,
          remainingBudget: budgetCode.budget - actualUsed,
          utilizationPercentage: budgetCode.budget > 0 ? Math.round((actualUsed / budgetCode.budget) * 10000) / 100 : 0,
          bySource: {
            purchaseRequisitions: {
              count: purchaseRequisitions.length,
              total: requisitionTotal
            },
            cashRequests: {
              count: cashRequests.length,
              total: cashRequestTotal
            },
            salaryPayments: {
              count: salaryDetails.length,
              total: salaryTotal
            }
          }
        },
        recentTransactions: {
          purchaseRequisitions: purchaseRequisitions.map(req => ({
            _id: req._id,
            requisitionNumber: req.requisitionNumber,
            title: req.title,
            amount: req.budgetXAF,
            status: req.status,
            employee: req.employee,
            date: req.createdAt,
            type: 'Purchase Requisition'
          })),
          cashRequests: cashRequests.map(req => ({
            _id: req._id,
            requestType: req.requestType,
            amount: req.amountRequested,
            disbursed: req.totalDisbursed,
            status: req.status,
            employee: req.employee,
            date: req.createdAt,
            type: 'Cash Request'
          })),
          salaryPayments: salaryDetails.map(sal => ({
            _id: sal._id,
            department: sal.department,
            amount: sal.amount,
            notes: sal.notes,
            paymentPeriod: sal.paymentPeriod,
            submittedBy: sal.submittedBy,
            date: sal.createdAt,
            type: 'Salary Payment'
          }))
        },
        trends: {
          monthlyUsage,
          departmentBreakdown
        }
      }
    });

  } catch (error) {
    console.error('Get budget code usage tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch usage tracking',
      error: error.message
    });
  }
};

// ============================================
// DEPARTMENT HEAD BUDGET DASHBOARD
// ============================================

/**
 * Get department-specific budget dashboard for department heads
 * Shows all budget codes for their department with real-time utilization
 */
const getDepartmentBudgetDashboard = async (req, res) => {
  try {
    const userDepartment = req.user.department;
    
    if (!userDepartment) {
      return res.status(400).json({
        success: false,
        message: 'User department not found'
      });
    }

    console.log(`Fetching budget dashboard for department: ${userDepartment}`);

    // Get all active budget codes for this department
    const budgetCodes = await BudgetCode.find({ 
      department: userDepartment,
      active: true 
    })
      .populate('budgetOwner', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .sort({ code: 1 });

    // Calculate actual usage for each budget code dynamically
    const codesWithActualUsage = await Promise.all(
      budgetCodes.map(async (code) => {
        const actualUsed = await calculateBudgetUsage(code._id);
        return {
          ...code.toObject(),
          used: actualUsed,
          remaining: code.budget - actualUsed,
          utilizationPercentage: code.budget > 0 ? Math.round((actualUsed / code.budget) * 10000) / 100 : 0
        };
      })
    );

    // Sort by utilization percentage descending
    codesWithActualUsage.sort((a, b) => b.utilizationPercentage - a.utilizationPercentage);

    // Calculate department summary
    const summary = {
      department: userDepartment,
      totalBudget: 0,
      totalUsed: 0,
      totalRemaining: 0,
      totalCodes: codesWithActualUsage.length,
      criticalCodes: 0,
      warningCodes: 0,
      healthyCodes: 0,
      overallUtilization: 0,
      byBudgetType: {
        OPEX: { budget: 0, used: 0, count: 0 },
        CAPEX: { budget: 0, used: 0, count: 0 },
        PROJECT: { budget: 0, used: 0, count: 0 },
        OPERATIONAL: { budget: 0, used: 0, count: 0 }
      }
    };

    codesWithActualUsage.forEach(code => {
      summary.totalBudget += code.budget;
      summary.totalUsed += code.used;
      summary.totalRemaining += code.remaining;

      const utilization = code.utilizationPercentage;
      if (utilization >= 90) summary.criticalCodes++;
      else if (utilization >= 75) summary.warningCodes++;
      else summary.healthyCodes++;

      // Budget type breakdown
      if (code.budgetType && summary.byBudgetType[code.budgetType]) {
        summary.byBudgetType[code.budgetType].budget += code.budget;
        summary.byBudgetType[code.budgetType].used += code.used;
        summary.byBudgetType[code.budgetType].count += 1;
      }
    });

    if (summary.totalBudget > 0) {
      summary.overallUtilization = Math.round(
        (summary.totalUsed / summary.totalBudget) * 10000
      ) / 100;
    }

    // Add utilization percentage to each budget type
    Object.keys(summary.byBudgetType).forEach(type => {
      const typeData = summary.byBudgetType[type];
      if (typeData.budget > 0) {
        typeData.utilizationPercentage = Math.round((typeData.used / typeData.budget) * 10000) / 100;
      } else {
        typeData.utilizationPercentage = 0;
      }
    });

    // Generate alerts
    const alerts = [];
    codesWithActualUsage.forEach(code => {
      const utilization = code.utilizationPercentage;

      if (utilization >= 90) {
        alerts.push({
          type: 'critical',
          budgetCode: code.code,
          name: code.name,
          message: `${code.name} is ${utilization}% utilized. Immediate action required.`,
          utilization,
          remaining: code.remaining,
          budget: code.budget,
          used: code.used
        });
      } else if (utilization >= 75) {
        alerts.push({
          type: 'warning',
          budgetCode: code.code,
          name: code.name,
          message: `${code.name} is ${utilization}% utilized. Monitor closely.`,
          utilization,
          remaining: code.remaining,
          budget: code.budget,
          used: code.used
        });
      }

      // Check if budget is near expiry (within 30 days)
      if (code.endDate) {
        const daysUntilExpiry = Math.ceil((new Date(code.endDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry > 0 && daysUntilExpiry <= 30 && code.remaining > 0) {
          alerts.push({
            type: 'info',
            budgetCode: code.code,
            name: code.name,
            message: `Budget expires in ${daysUntilExpiry} days with XAF ${code.remaining.toLocaleString()} remaining.`,
            action: 'Consider reallocating or extending budget period',
            daysUntilExpiry,
            remaining: code.remaining
          });
        }
      }
    });

    res.json({
      success: true,
      data: {
        summary,
        budgetCodes: codesWithActualUsage,
        alerts,
        department: userDepartment
      }
    });

  } catch (error) {
    console.error('Get department budget dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch department budget dashboard',
      error: error.message
    });
  }
};


module.exports = {
  createBudgetCode,
  processBudgetCodeApproval,
  getBudgetCodes,
  getPendingApprovalsForUser,
  getBudgetCode,
  updateBudgetCode,
  deleteBudgetCode,
  getBudgetCodeUtilization,
  allocateBudgetToRequisition,
  getBudgetDashboard,
  getBudgetUtilizationReport,
  getBudgetForecast,
  requestBudgetRevision,
  getBudgetRevisions,
  approveBudgetRevision,
  rejectBudgetRevision,
  getPendingRevisions,
  getBudgetCodeUsageTracking,
  getDepartmentBudgetDashboard
};



