const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const {
  requestBudgetTransfer,
  getBudgetTransfers,
  getBudgetTransfer,
  getPendingTransfers,
  approveBudgetTransfer,
  rejectBudgetTransfer,
  cancelBudgetTransfer,
  getTransferStatistics
} = require('../controllers/budgetTransferController');

/**
 * @route   POST /api/budget-transfers
 * @desc    Request a new budget transfer
 * @access  Private (Finance, Admin)
 */
router.post(
  '/',
  authMiddleware,
  requireRoles('finance', 'admin'),
  requestBudgetTransfer
);

/**
 * @route   GET /api/budget-transfers
 * @desc    Get all budget transfers (with filters)
 * @access  Private (Finance, Admin)
 */
router.get(
  '/',
  authMiddleware,
  requireRoles('finance', 'admin'),
  getBudgetTransfers
);

/**
 * @route   GET /api/budget-transfers/pending
 * @desc    Get pending transfers for current user
 * @access  Private (Admin, Finance, Supervisors)
 */
router.get(
  '/pending',
  authMiddleware,
  requireRoles('admin', 'finance', 'supervisor'),
  getPendingTransfers
);

/**
 * @route   GET /api/budget-transfers/statistics
 * @desc    Get transfer statistics
 * @access  Private (Finance, Admin)
 */
router.get(
  '/statistics',
  authMiddleware,
  requireRoles('finance', 'admin'),
  getTransferStatistics
);

/**
 * @route   GET /api/budget-transfers/:transferId
 * @desc    Get single budget transfer by ID
 * @access  Private (Finance, Admin)
 */
router.get(
  '/:transferId',
  authMiddleware,
  requireRoles('finance', 'admin', 'supervisor'),
  getBudgetTransfer
);

/**
 * @route   POST /api/budget-transfers/:transferId/approve
 * @desc    Approve budget transfer
 * @access  Private (Admin, Finance, Department Heads)
 */
router.post(
  '/:transferId/approve',
  authMiddleware,
  requireRoles('admin', 'finance', 'supervisor'),
  approveBudgetTransfer
);

/**
 * @route   POST /api/budget-transfers/:transferId/reject
 * @desc    Reject budget transfer
 * @access  Private (Admin, Finance, Department Heads)
 */
router.post(
  '/:transferId/reject',
  authMiddleware,
  requireRoles('admin', 'finance', 'supervisor'),
  rejectBudgetTransfer
);

/**
 * @route   POST /api/budget-transfers/:transferId/cancel
 * @desc    Cancel budget transfer (by requester)
 * @access  Private (Finance, Admin)
 */
router.post(
  '/:transferId/cancel',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cancelBudgetTransfer
);

module.exports = router;