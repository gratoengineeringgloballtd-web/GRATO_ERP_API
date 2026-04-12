const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const behavioralEvaluationController = require('../controllers/behavioralEvaluationController');

// Get default criteria
router.get(
  '/default-criteria',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralEvaluationController.getDefaultCriteria
);

// Get employee's evaluations
router.get(
  '/my-evaluations',
  authMiddleware,
  behavioralEvaluationController.getEmployeeEvaluations
);

// Get evaluations (supervisors)
router.get(
  '/',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralEvaluationController.getEvaluations
);

// Get single evaluation
router.get(
  '/:id',
  authMiddleware,
  behavioralEvaluationController.getEvaluationById
);

// Create or update evaluation
router.post(
  '/',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralEvaluationController.createOrUpdateEvaluation
);

// Submit evaluation
router.post(
  '/:id/submit',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralEvaluationController.submitEvaluation
);

// Employee acknowledges evaluation
router.post(
  '/:id/acknowledge',
  authMiddleware,
  behavioralEvaluationController.acknowledgeEvaluation
);

// Delete evaluation
router.delete(
  '/:id',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  behavioralEvaluationController.deleteEvaluation
);

module.exports = router;