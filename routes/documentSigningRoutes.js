// ═══════════════════════════════════════════════════════════════════════════
// FILE: routes/documentSigningRoutes.js
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authMiddleware } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/documentSigningController');

// Dedicated multer instance for this feature — memory storage so
// pdfSigningService can read bytes directly without touching disk twice.
// (Mirrors the memoryStorage pattern in your second uploadMiddleware.js.)
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — generous for contracts/reports
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are accepted'), false);
    }
    cb(null, true);
  }
});

// ════════════════════════════════════════════════════════════════════════
// AUTHENTICATED ROUTES (employee/admin app)
// ════════════════════════════════════════════════════════════════════════

// Upload + draft lifecycle
router.post('/documents', authMiddleware, pdfUpload.single('file'), ctrl.uploadDocument);
router.put('/documents/:documentId/fields', authMiddleware, ctrl.saveFields);
router.put('/documents/:documentId/chain', authMiddleware, ctrl.configureChain);
router.post('/documents/:documentId/submit', authMiddleware, ctrl.submitDocument);
router.post('/documents/:documentId/resubmit', authMiddleware, ctrl.resubmitDocument);
router.post('/documents/:documentId/cancel', authMiddleware, ctrl.cancelDocument);

// Listing / detail
router.get('/documents', authMiddleware, ctrl.getMyDocuments);
router.get('/documents/:documentId/my-signing-link', authMiddleware, ctrl.getMySigningLink);
router.get('/documents/:documentId', authMiddleware, ctrl.getDocumentDetails);
router.get('/documents/:documentId/download', authMiddleware, ctrl.downloadFinalDocument);

// Chain preview helper (for the placement UI to pre-fill hierarchical default)
router.get('/chain-preview', authMiddleware, ctrl.getHierarchicalChainPreview);

// Admin / IT / CEO overrides
router.post('/documents/:documentId/force-advance', authMiddleware, ctrl.forceAdvance);
router.post('/documents/:documentId/reassign', authMiddleware, ctrl.reassignSigner);

// ════════════════════════════════════════════════════════════════════════
// PUBLIC NO-LOGIN ROUTES (token-based, reached via email link)
// Deliberately NOT behind authMiddleware — identity is proven by the
// per-signer token instead, matching the external-quote/:token pattern
// already used elsewhere in this app.
// ════════════════════════════════════════════════════════════════════════

router.get('/public/sign/:documentId/:token', ctrl.getSigningSession);
router.post('/public/sign/:documentId/:token', ctrl.signDocument);
router.post('/public/sign/:documentId/:token/reject', ctrl.rejectDocument);

module.exports = router;










// // ═══════════════════════════════════════════════════════════════════════════
// // FILE: routes/documentSigningRoutes.js
// // ═══════════════════════════════════════════════════════════════════════════

// const express = require('express');
// const router = express.Router();
// const multer = require('multer');
// const { authMiddleware } = require('../middlewares/authMiddleware');
// const ctrl = require('../controllers/documentSigningController');

// // Dedicated multer instance for this feature — memory storage so
// // pdfSigningService can read bytes directly without touching disk twice.
// // (Mirrors the memoryStorage pattern in your second uploadMiddleware.js.)
// const pdfUpload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — generous for contracts/reports
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype !== 'application/pdf') {
//       return cb(new Error('Only PDF files are accepted'), false);
//     }
//     cb(null, true);
//   }
// });

// // ════════════════════════════════════════════════════════════════════════
// // AUTHENTICATED ROUTES (employee/admin app)
// // ════════════════════════════════════════════════════════════════════════

// // Upload + draft lifecycle
// router.post('/documents', authMiddleware, pdfUpload.single('file'), ctrl.uploadDocument);
// router.put('/documents/:documentId/fields', authMiddleware, ctrl.saveFields);
// router.put('/documents/:documentId/chain', authMiddleware, ctrl.configureChain);
// router.post('/documents/:documentId/submit', authMiddleware, ctrl.submitDocument);
// router.post('/documents/:documentId/resubmit', authMiddleware, ctrl.resubmitDocument);
// router.post('/documents/:documentId/cancel', authMiddleware, ctrl.cancelDocument);

// // Listing / detail
// router.get('/documents', authMiddleware, ctrl.getMyDocuments);
// router.get('/documents/:documentId', authMiddleware, ctrl.getDocumentDetails);
// router.get('/documents/:documentId/download', authMiddleware, ctrl.downloadFinalDocument);

// // Chain preview helper (for the placement UI to pre-fill hierarchical default)
// router.get('/chain-preview', authMiddleware, ctrl.getHierarchicalChainPreview);

// // Admin / IT / CEO overrides
// router.post('/documents/:documentId/force-advance', authMiddleware, ctrl.forceAdvance);
// router.post('/documents/:documentId/reassign', authMiddleware, ctrl.reassignSigner);

// // ════════════════════════════════════════════════════════════════════════
// // PUBLIC NO-LOGIN ROUTES (token-based, reached via email link)
// // Deliberately NOT behind authMiddleware — identity is proven by the
// // per-signer token instead, matching the external-quote/:token pattern
// // already used elsewhere in this app.
// // ════════════════════════════════════════════════════════════════════════

// router.get('/public/sign/:documentId/:token', ctrl.getSigningSession);
// router.post('/public/sign/:documentId/:token', ctrl.signDocument);
// router.post('/public/sign/:documentId/:token/reject', ctrl.rejectDocument);

// module.exports = router;