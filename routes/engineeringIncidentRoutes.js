'use strict';
// routes/engineeringIncidentRoutes.js
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const upload  = require('../middlewares/uploadMiddleware');

const {
  createReport,
  getReports,
  getReportById,
  processApproval,
  generateShareLink,
  getPublicReport,
  exportPDF,
  exportExcel,
  getDashboardStats,
  deleteReport
} = require('../controllers/engineeringIncidentController');

// ── Public (no auth) ─────────────────────────────────────────────────────────
// Must be declared BEFORE authMiddleware
router.get('/public/:token', getPublicReport);

// ── Authenticated routes ──────────────────────────────────────────────────────
router.use(authMiddleware);

// Dashboard stats
router.get('/dashboard-stats', getDashboardStats);

// Bulk export (Excel)
router.get('/export/excel', exportExcel);

// ── All /:id/sub-routes BEFORE the plain /:id catch-all ──────────────────────

// Attachment download

router.get('/:id/attachments/:index', async (req, res) => {
  try {
    const EngineeringIncidentReport = require('../models/EngineeringIncidentReport');

    const report = await EngineeringIncidentReport
      .findOne({ _id: req.params.id, isDeleted: false });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    const index = parseInt(req.params.index, 10);
    const att   = report.attachments[index];
    if (!att) return res.status(404).json({ success: false, message: 'Attachment not found' });

    if (att.url.startsWith('http')) {
      // Cloudinary — redirect directly to the signed URL
      // The URL is already public/authenticated via Cloudinary
      return res.redirect(att.url);
    }

    // Legacy local file fallback
    const path = require('path');
    const fs   = require('fs');
    const filePath = path.join(__dirname, '..', att.url);

    if (!fs.existsSync(filePath))
      return res.status(404).json({ success: false, message: 'File not found on disk' });

    const ext          = path.extname(att.name);
    const baseName     = path.basename(att.name, ext);
    const safeFileName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_') + ext;
    const encodedName  = encodeURIComponent(att.name).replace(/'/g, '%27');

    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Type', att.mimetype || 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Attachment download error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// Approval action (Pascal / Didier / Bechem)
router.post('/:id/approve', processApproval);

// Share link
router.post('/:id/share-link', generateShareLink);

// PDF export for single report
router.get('/:id/export/pdf', exportPDF);

// ── Collection routes ─────────────────────────────────────────────────────────
router.get('/',  getReports);
router.post('/', upload.array('attachments', 10), createReport);

// ── Plain /:id routes LAST (catch-all param — must be after all sub-routes) ───
router.get('/:id',    getReportById);
router.delete('/:id', deleteReport);

module.exports = router;