const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const controller = require('../controllers/technicianSiteAuditController');

// List audits
router.get('/site-audits', authenticateToken, requireRole(['technician', 'admin', 'supervisor']), controller.listAudits);
// Get audit by ID
router.get('/site-audits/:id', authenticateToken, requireRole(['technician', 'admin', 'supervisor']), controller.getAuditById);
// Create audit
router.post('/site-audit', authenticateToken, requireRole(['technician', 'admin']), controller.createAudit);
// Update audit
router.put('/site-audits/:id', authenticateToken, requireRole(['technician', 'admin']), controller.updateAudit);
// Update audit status
router.patch('/site-audits/:id/status', authenticateToken, requireRole(['technician', 'admin']), controller.updateAuditStatus);

module.exports = router;
