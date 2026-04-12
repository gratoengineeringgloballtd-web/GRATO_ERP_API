const express = require('express');
const router = express.Router();
const supplierPerformanceController = require('../controllers/supplierPerformanceController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// Evaluations
router.post('/evaluate',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  supplierPerformanceController.createEvaluation
);

router.get('/evaluations',
  authMiddleware,
  supplierPerformanceController.getEvaluations
);

router.get('/supplier/:supplierId',
  authMiddleware,
  supplierPerformanceController.getSupplierPerformance
);

router.put('/evaluation/:evaluationId',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  supplierPerformanceController.updateEvaluation
);

router.post('/evaluation/:evaluationId/submit',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  supplierPerformanceController.submitEvaluation
);

router.post('/evaluation/:evaluationId/review',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  supplierPerformanceController.reviewEvaluation
);

// Incidents
router.post('/evaluation/:evaluationId/incident',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  supplierPerformanceController.addIncident
);

router.patch('/evaluation/:evaluationId/incident/:incidentId/resolve',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  supplierPerformanceController.resolveIncident
);

// Rankings
router.get('/rankings',
  authMiddleware,
  supplierPerformanceController.getSupplierRankings
);

// Auto-calculate metrics
router.post('/calculate-metrics',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  supplierPerformanceController.calculateMetricsFromTransactions
);

module.exports = router;