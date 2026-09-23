const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const operationsAuditController = require('../controllers/operationsAuditController');

// Operations Sites (read-only list of all sites)
router.get('/sites', authenticateToken, requireRole(['operations', 'admin']), operationsAuditController.getSites);

// Audit checklist endpoints
router.get('/audits', authenticateToken, requireRole(['operations', 'admin', 'supervisor', 'analyst']), operationsAuditController.listAudits);
router.get('/audits/:id', authenticateToken, requireRole(['operations', 'admin', 'supervisor', 'analyst']), operationsAuditController.getAuditById);
router.post('/audits', authenticateToken, requireRole(['operations', 'admin']), operationsAuditController.createAudit);
router.put('/audits/:id', authenticateToken, requireRole(['operations', 'admin']), operationsAuditController.updateAudit);
router.patch('/audits/:id/status', authenticateToken, requireRole(['operations', 'admin']), operationsAuditController.updateAuditStatus);

module.exports = router;
