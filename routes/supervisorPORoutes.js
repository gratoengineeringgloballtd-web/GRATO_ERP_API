// routes/supervisorPORoutes.js

const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const supervisorPOController = require('../controllers/supervisorPOController');

// All routes require supervisor or higher roles
router.use(authMiddleware);
router.use(requireRoles('supervisor', 'admin', 'manager', 'finance', 'hr', 'technical', 'hse', 'supply_chain'));

// Get pending PO approvals
router.get('/pending', supervisorPOController.getSupervisorPendingPOs);

// Download PO for signing
router.get('/:poId/download-for-signing', supervisorPOController.downloadPOForSigning);

// Process approval with signed document
router.post(
  '/:poId/approve',
  supervisorPOController.processPOApproval
);

module.exports = router;