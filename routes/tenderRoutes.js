// routes/tenderRoutes.js
// Register in app.js:  app.use('/api/tenders', require('./routes/tenderRoutes'));

const express = require('express');
const router  = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/tenderController');

router.use(authMiddleware);

// ── Read ─────────────────────────────────────────────────────────────────────
router.get('/',                          ctrl.getTenders);
router.get('/rfqs-available',            ctrl.getAvailableRFQsForTender);
router.get('/pending-my-approval',       ctrl.getTendersPendingMyApproval);
router.get('/:tenderId',                 ctrl.getTenderById);

// ── PDF ──────────────────────────────────────────────────────────────────────
router.get('/:tenderId/pdf',             ctrl.generateTenderPDF);

// ── Create ───────────────────────────────────────────────────────────────────
router.post('/from-rfq/:rfqId',          ctrl.createTenderFromRFQ);
router.post('/manual',                   ctrl.createTenderManually);

// ── Update ───────────────────────────────────────────────────────────────────
router.put('/:tenderId',                 ctrl.updateTender);
router.patch('/:tenderId/status',        ctrl.updateTenderStatus);   // draft→pending, admin shortcuts

// ── Approval (individual approver action) ────────────────────────────────────
router.post('/:tenderId/approve',        ctrl.processTenderApproval); // body: { decision, comments }

// ── Delete (draft only) ──────────────────────────────────────────────────────
router.delete('/:tenderId',              ctrl.deleteTender);

module.exports = router;