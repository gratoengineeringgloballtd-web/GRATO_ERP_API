const express = require('express');
const router = express.Router();
const migrationController = require('../controllers/migrationController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// All migration endpoints require admin access
router.use(authMiddleware);
router.use(requireRoles('admin'));

router.post('/available-stock', migrationController.migrateAvailableStock);
router.post('/inbound', migrationController.migrateInbound);
router.post('/outbound', migrationController.migrateOutbound);
router.post('/suppliers', migrationController.migrateSuppliers);

// Validation endpoint
router.post('/validate', migrationController.validateMigrationData);

// Reconciliation endpoint
router.get('/reconcile', migrationController.reconcileStock);

module.exports = router;