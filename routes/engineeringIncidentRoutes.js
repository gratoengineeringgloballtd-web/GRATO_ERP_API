'use strict';
// routes/engineeringIncidentRoutes.js
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const upload  = require('../middlewares/uploadMiddleware');

const {
  createReport,
  updateReport,
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
router.get('/public/:token', getPublicReport);

// ── Authenticated routes ──────────────────────────────────────────────────────
router.use(authMiddleware);

// Dashboard stats
router.get('/dashboard-stats', getDashboardStats);

// Bulk export
router.get('/export/excel', exportExcel);

// ── Sub-resource routes (must be before plain /:id) ──────────────────────────

// Attachment download
router.get('/:id/attachments/:index', async (req, res) => {
  try {
    const EngineeringIncidentReport = require('../models/EngineeringIncidentReport');
    const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    const index = parseInt(req.params.index, 10);
    const att   = report.attachments[index];
    if (!att) return res.status(404).json({ success: false, message: 'Attachment not found' });

    if (att.url.startsWith('http')) return res.redirect(att.url);

    const pathMod = require('path');
    const fsMod   = require('fs');
    const filePath = pathMod.join(__dirname, '..', att.url);
    if (!fsMod.existsSync(filePath))
      return res.status(404).json({ success: false, message: 'File not found on disk' });

    const ext         = pathMod.extname(att.name);
    const baseName    = pathMod.basename(att.name, ext);
    const safeFileName= baseName.replace(/[^a-zA-Z0-9._-]/g, '_') + ext;
    const encodedName = encodeURIComponent(att.name).replace(/'/g, '%27');

    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Type', att.mimetype || 'application/octet-stream');
    res.setHeader('Content-Length', fsMod.statSync(filePath).size);
    fsMod.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Attachment download error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Approval — accepts file uploads (approver may attach additional evidence)
// and optional field edits in the same request body
router.post('/:id/approve', upload.array('attachments', 10), processApproval);

// Edit report (approver at active level, owner while pending_review, or admin)
router.put('/:id', upload.array('attachments', 10), updateReport);

// Share link
router.post('/:id/share-link', generateShareLink);

// PDF export
router.get('/:id/export/pdf', exportPDF);

// ── Collection routes ─────────────────────────────────────────────────────────
router.get('/',  getReports);
router.post('/', upload.array('attachments', 10), createReport);

// ── Plain /:id routes LAST ────────────────────────────────────────────────────
router.get('/:id',    getReportById);
router.delete('/:id', deleteReport);

module.exports = router;




