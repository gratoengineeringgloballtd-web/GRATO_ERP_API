const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const controller = require('../controllers/clusterController');

// ── Stats (must come BEFORE /:id to avoid route collision) ───────────────────
router.get('/stats/summary', authenticateToken, controller.getClusterStats);

// ── Cluster CRUD ──────────────────────────────────────────────────────────────
router.get('/',    authenticateToken, controller.getAllClusters);
router.post('/',   authenticateToken, requireRole(['admin']), controller.createCluster);
router.get('/:id', authenticateToken, controller.getCluster);
router.put('/:id', authenticateToken, requireRole(['admin']), controller.updateCluster);
router.delete('/:id', authenticateToken, requireRole(['admin']), controller.deleteCluster);

// ── Technician assignment ─────────────────────────────────────────────────────
router.post(  '/:id/technicians',               authenticateToken, requireRole(['admin']), controller.assignTechnicianToCluster);
router.delete('/:id/technicians/:technicianId', authenticateToken, requireRole(['admin']), controller.removeTechnicianFromCluster);

// ── Tower stubs ───────────────────────────────────────────────────────────────
router.post(  '/:id/towers',          authenticateToken, requireRole(['admin']), controller.addTowerToCluster);
router.delete('/:id/towers/:towerId', authenticateToken, requireRole(['admin']), controller.removeTowerFromCluster);

module.exports = router;

