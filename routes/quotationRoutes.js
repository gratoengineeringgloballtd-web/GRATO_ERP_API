// routes/quotationRoutes.js

const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const quotationController = require('../controllers/quotationController');

// PDF operations
router.get('/:quoteId/download-pdf',
  authMiddleware,
  quotationController.downloadQuotationPDF
);

router.get('/:quoteId/preview-pdf',
  authMiddleware,
  quotationController.previewQuotationPDF
);

router.post('/:quoteId/email-pdf',
  authMiddleware,
  quotationController.emailQuotationPDF
);

module.exports = router;