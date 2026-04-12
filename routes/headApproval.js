const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const headApprovalController = require('../controllers/headApprovalController');

/**
 * @route   GET /api/head-approval/requisitions
 * @desc    Get requisitions pending head approval
 * @access  Private (Admin, Supply Chain Head)
 */
router.get(
  '/requisitions',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  headApprovalController.getPendingHeadApprovals
);

/**
 * @route   GET /api/head-approval/stats
 * @desc    Get head approval statistics
 * @access  Private (Admin, Supply Chain Head)
 */
router.get(
  '/stats',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  headApprovalController.getHeadApprovalStats
);

/**
 * @route   GET /api/head-approval/requisitions/:requisitionId
 * @desc    Get requisition details for head approval
 * @access  Private (Admin, Supply Chain Head)
 */
router.get(
  '/requisitions/:requisitionId',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  headApprovalController.getRequisitionDetails
);

/**
 * @route   POST /api/head-approval/requisitions/:requisitionId/approve
 * @desc    Process head approval decision (approve/reject)
 * @access  Private (Admin, Supply Chain Head)
 */
router.post(
  '/requisitions/:requisitionId/approve',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  headApprovalController.processHeadApproval
);

module.exports = router;