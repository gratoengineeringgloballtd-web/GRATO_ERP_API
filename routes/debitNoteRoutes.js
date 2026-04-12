// routes/debitNoteRoutes.js

const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const debitNoteController = require('../controllers/debitNoteController');

const buyerSupplyChainAuth = requireRoles('buyer', 'supply_chain', 'admin');

// CRUD operations
router.post('/',
  authMiddleware,
  buyerSupplyChainAuth,
  debitNoteController.createDebitNote
);

router.get('/',
  authMiddleware,
  debitNoteController.getDebitNotes
);

router.get('/:debitNoteId',
  authMiddleware,
  debitNoteController.getDebitNoteDetails
);

// Approval
router.post('/:debitNoteId/approve',
  authMiddleware,
  debitNoteController.processDebitNoteApproval
);

// PDF operations
router.get('/:debitNoteId/download-pdf',
  authMiddleware,
  debitNoteController.downloadDebitNotePDF
);

// Supplier acknowledgment
router.post('/:debitNoteId/acknowledge',
  authMiddleware,
  debitNoteController.supplierAcknowledgeDebitNote
);

module.exports = router;