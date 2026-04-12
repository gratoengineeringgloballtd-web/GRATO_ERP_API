// routes/enhancedBehavioralEvaluationRoutes.js

const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const behavioralController = require('../controllers/enhancedBehavioralEvaluationController');

/**
 * @route   GET /api/behavioral-evaluations/default-criteria
 * @desc    Get default evaluation criteria
 * @access  Supervisors, Admin, Supply Chain
 */
router.get(
  '/default-criteria',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralController.getDefaultCriteria
);

/**
 * @route   GET /api/behavioral-evaluations/my-evaluations
 * @desc    Get employee's own evaluations
 * @access  All authenticated users
 * @query   quarter (optional)
 */
router.get(
  '/my-evaluations',
  authMiddleware,
  behavioralController.getEmployeeEvaluations
);

/**
 * @route   GET /api/behavioral-evaluations
 * @desc    Get evaluations (supervisors see only their evaluations)
 * @access  Supervisors, Admin, Supply Chain
 * @query   quarter, status, employeeId (optional filters)
 */
router.get(
  '/',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralController.getEvaluations
);

/**
 * @route   GET /api/behavioral-evaluations/:id
 * @desc    Get single evaluation by ID
 * @access  Employee (own), Evaluator, Admin
 */
router.get(
  '/:id',
  authMiddleware,
  behavioralController.getEvaluationById
);

/**
 * @route   POST /api/behavioral-evaluations
 * @desc    Create or update behavioral evaluation
 * @access  Supervisors, Admin, Supply Chain
 * @body    { employeeId, quarter, criteria, overallComments }
 */
router.post(
  '/',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralController.createOrUpdateEvaluation
);

/**
 * @route   POST /api/behavioral-evaluations/:id/submit
 * @desc    Submit evaluation (locks it and notifies employee)
 * @access  Evaluator only
 */
router.post(
  '/:id/submit',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralController.submitEvaluation
);

/**
 * @route   POST /api/behavioral-evaluations/:id/acknowledge
 * @desc    Employee acknowledges evaluation
 * @access  Employee (subject of evaluation)
 */
router.post(
  '/:id/acknowledge',
  authMiddleware,
  behavioralController.acknowledgeEvaluation
);

/**
 * @route   DELETE /api/behavioral-evaluations/:id
 * @desc    Delete evaluation (draft only)
 * @access  Evaluator only
 */
router.delete(
  '/:id',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralController.deleteEvaluation
);

module.exports = router;