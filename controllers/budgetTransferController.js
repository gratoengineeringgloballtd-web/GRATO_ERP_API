const BudgetTransfer = require('../models/BudgetTransfer');
const BudgetCode = require('../models/BudgetCode');
const User = require('../models/User');

/**
 * Request a new budget transfer
 */
const requestBudgetTransfer = async (req, res) => {
  try {
    const { fromBudgetCode, toBudgetCode, amount, reason } = req.body;

    if (!fromBudgetCode || !toBudgetCode || !amount || !reason) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: fromBudgetCode, toBudgetCode, amount, reason'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Transfer amount must be greater than zero'
      });
    }

    const transfer = await BudgetTransfer.requestTransfer(
      fromBudgetCode,
      toBudgetCode,
      parseFloat(amount),
      reason,
      req.user.userId
    );

    res.status(201).json({
      success: true,
      message: 'Budget transfer requested successfully',
      data: transfer
    });
  } catch (error) {
    console.error('Request budget transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to request budget transfer',
      error: error.message
    });
  }
};

/**
 * Get all budget transfers (with filters)
 */
const getBudgetTransfers = async (req, res) => {
  try {
    const { status, fromCode, toCode, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status) filter.status = status;

    let query = BudgetTransfer.find(filter)
      .populate('fromBudgetCode', 'code name department budget used remaining')
      .populate('toBudgetCode', 'code name department budget used remaining')
      .populate('requestedBy', 'fullName email department')
      .populate('approvedBy', 'fullName email')
      .populate('rejectedBy', 'fullName email')
      .sort({ createdAt: -1 });

    // Filter by budget codes if provided
    if (fromCode || toCode) {
      const budgetCodes = await BudgetCode.find({
        $or: [
          fromCode ? { code: fromCode.toUpperCase() } : {},
          toCode ? { code: toCode.toUpperCase() } : {}
        ]
      });

      const codeIds = budgetCodes.map(c => c._id);
      
      if (fromCode && toCode) {
        query = query.where('fromBudgetCode').in(codeIds).where('toBudgetCode').in(codeIds);
      } else if (fromCode) {
        query = query.where('fromBudgetCode').in(codeIds);
      } else if (toCode) {
        query = query.where('toBudgetCode').in(codeIds);
      }
    }

    const transfers = await query
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await BudgetTransfer.countDocuments(filter);

    res.json({
      success: true,
      data: transfers,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: transfers.length,
        totalRecords: total
      }
    });
  } catch (error) {
    console.error('Get budget transfers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget transfers',
      error: error.message
    });
  }
};

/**
 * Get single budget transfer by ID
 */
const getBudgetTransfer = async (req, res) => {
  try {
    const { transferId } = req.params;

    const transfer = await BudgetTransfer.findById(transferId)
      .populate('fromBudgetCode', 'code name department budget used remaining')
      .populate('toBudgetCode', 'code name department budget used remaining')
      .populate('requestedBy', 'fullName email department')
      .populate('approvedBy', 'fullName email')
      .populate('rejectedBy', 'fullName email');

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Budget transfer not found'
      });
    }

    res.json({
      success: true,
      data: transfer
    });
  } catch (error) {
    console.error('Get budget transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget transfer',
      error: error.message
    });
  }
};

/**
 * Get pending transfers for current user
 */
const getPendingTransfers = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const transfers = await BudgetTransfer.getPendingForUser(user.email);

    // Filter to only show transfers where current step is for this user
    const userPendingTransfers = transfers.filter(transfer => {
      const currentStep = transfer.approvalChain.find(step => step.status === 'pending');
      return currentStep && currentStep.approver.email === user.email;
    });

    res.json({
      success: true,
      data: userPendingTransfers,
      count: userPendingTransfers.length
    });
  } catch (error) {
    console.error('Get pending transfers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending transfers',
      error: error.message
    });
  }
};

/**
 * Approve budget transfer
 */
const approveBudgetTransfer = async (req, res) => {
  try {
    const { transferId } = req.params;
    const { comments } = req.body;

    const transfer = await BudgetTransfer.findById(transferId)
      .populate('fromBudgetCode', 'code name')
      .populate('toBudgetCode', 'code name');

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Budget transfer not found'
      });
    }

    await transfer.approveTransfer(req.user.userId, comments);

    res.json({
      success: true,
      message: transfer.status === 'approved'
        ? 'Budget transfer approved and executed successfully'
        : 'Budget transfer approved. Moved to next level.',
      data: transfer
    });
  } catch (error) {
    console.error('Approve budget transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to approve budget transfer',
      error: error.message
    });
  }
};

/**
 * Reject budget transfer
 */
const rejectBudgetTransfer = async (req, res) => {
  try {
    const { transferId } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const transfer = await BudgetTransfer.findById(transferId);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Budget transfer not found'
      });
    }

    await transfer.rejectTransfer(req.user.userId, rejectionReason);

    res.json({
      success: true,
      message: 'Budget transfer rejected',
      data: transfer
    });
  } catch (error) {
    console.error('Reject budget transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reject budget transfer',
      error: error.message
    });
  }
};

/**
 * Cancel budget transfer (by requester)
 */
const cancelBudgetTransfer = async (req, res) => {
  try {
    const { transferId } = req.params;

    const transfer = await BudgetTransfer.findById(transferId);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Budget transfer not found'
      });
    }

    // Only requester can cancel
    if (transfer.requestedBy.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the requester can cancel this transfer'
      });
    }

    if (transfer.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel transfer with status: ${transfer.status}`
      });
    }

    transfer.status = 'cancelled';
    await transfer.save();

    res.json({
      success: true,
      message: 'Budget transfer cancelled successfully',
      data: transfer
    });
  } catch (error) {
    console.error('Cancel budget transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel budget transfer',
      error: error.message
    });
  }
};

/**
 * Get transfer statistics
 */
const getTransferStatistics = async (req, res) => {
  try {
    const { fiscalYear } = req.query;

    const filter = {};
    if (fiscalYear) {
      const year = parseInt(fiscalYear);
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31, 23, 59, 59);
      filter.createdAt = { $gte: startDate, $lte: endDate };
    }

    const stats = await BudgetTransfer.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    const summary = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
      totalPendingAmount: 0,
      totalApprovedAmount: 0,
      totalRejectedAmount: 0
    };

    stats.forEach(stat => {
      summary[stat._id] = stat.count;
      summary[`total${stat._id.charAt(0).toUpperCase() + stat._id.slice(1)}Amount`] = stat.totalAmount;
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get transfer statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfer statistics',
      error: error.message
    });
  }
};

module.exports = {
  requestBudgetTransfer,
  getBudgetTransfers,
  getBudgetTransfer,
  getPendingTransfers,
  approveBudgetTransfer,
  rejectBudgetTransfer,
  cancelBudgetTransfer,
  getTransferStatistics
};