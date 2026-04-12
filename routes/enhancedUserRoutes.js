const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const enhancedUserController = require('../controllers/enhancedUserController');

/**
 * @route   GET /api/enhanced-users/positions/available
 * @desc    Get all available positions from department structure
 * @access  Admin, Supply Chain
 */
router.get(
  '/positions/available',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  enhancedUserController.getAvailablePositions
);

/**
 * @route   GET /api/enhanced-users/positions/supervisors
 * @desc    Get potential supervisors for a specific position (for dynamic assignments)
 * @access  Admin, Supply Chain
 * @query   department, position
 */
router.get(
  '/positions/supervisors',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  enhancedUserController.getPotentialSupervisorsForPosition
);

/**
 * @route   POST /api/enhanced-users/users/create-with-hierarchy
 * @desc    Create user with automatic hierarchy setup
 * @access  Admin, Supply Chain
 */
router.post(
  '/users/create-with-hierarchy',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  enhancedUserController.createUserWithHierarchy
);

/**
 * @route   GET /api/enhanced-users/users/direct-reports
 * @desc    Get current user's direct reports (for evaluations)
 * @access  Authenticated users with directReports
 */
router.get(
  '/users/direct-reports',
  authMiddleware,
  enhancedUserController.getDirectReports
);

/**
 * @route   GET /api/enhanced-users/users/my-approval-chain
 * @desc    Get current user's approval chain
 * @access  Authenticated users
 */
router.get(
  '/users/my-approval-chain',
  authMiddleware,
  enhancedUserController.getMyApprovalChain
);

/**
 * @route   GET /api/enhanced-users/users/:userId/approval-chain
 * @desc    Get approval chain for specific user (admin only)
 * @access  Admin, Supply Chain
 */
router.get(
  '/users/:userId/approval-chain',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  enhancedUserController.getUserApprovalChain
);

module.exports = router;