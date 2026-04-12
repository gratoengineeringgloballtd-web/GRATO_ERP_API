const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const { upload } = require('../middlewares/uploadMiddleware');
const salaryPaymentController = require('../controllers/salaryPaymentController');

// Protect all routes - Finance only
router.use(authMiddleware);
router.use(requireRoles('finance', 'admin'));

router.post(
  '/',
  upload.array('supportingDocuments', 10),
  salaryPaymentController.createSalaryPayment
);

router.get('/', salaryPaymentController.getAllSalaryPayments);
router.get('/dashboard-stats', salaryPaymentController.getDashboardStats);
router.get('/:id', salaryPaymentController.getSalaryPaymentById);
router.get('/:id/documents/:documentIndex/download', salaryPaymentController.downloadDocument);

module.exports = router;