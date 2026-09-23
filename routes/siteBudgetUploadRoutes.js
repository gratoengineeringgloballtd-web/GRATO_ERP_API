/**
 * siteBudgetUploadRoutes.js
 * PowerGen_API/routes/siteBudgetUploadRoutes.js
 *
 * Handles upload of the GRATO Estimated Budget file (Book11).
 * Replaces or supplements the existing siteBudgetRoutes.js upload endpoint.
 *
 * MOUNT IN app.js:
 *   app.use('/api/site-budget-upload', require('./routes/siteBudgetUploadRoutes'));
 *
 * ENDPOINTS:
 *   POST /api/site-budget-upload
 *     multipart/form-data: file + cycle_key
 *     → Parses Excel, upserts SiteBudget records
 *   GET  /api/site-budget-upload/preview
 *     ?cycle_key=2026-08 — returns summary without writing
 */

'use strict';

const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { importSiteBudgetFile } = require('../services/siteBudgetImportService');
const SiteBudget = require('../models/SiteBudget');
const SiteBudgetUpload = require('../models/SiteBudgetUpload');
const logger   = require('../utils/logger');

// ── Multer: memory storage (no disk temp files) ───────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xls|xlsm)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx / .xls / .xlsm files are accepted'));
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function deriveCycleKey(filename) {
  // Try to extract from filename e.g. "Budget_August_2026" → "2026-08"
  const months = {
    jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
    jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  };
  const lower = filename.toLowerCase();
  for (const [name, num] of Object.entries(months)) {
    const m = lower.match(new RegExp(`${name}[a-z]*[_\\s-]+(20\\d{2})`));
    if (m) return `${m[1]}-${num}`;
    const m2 = lower.match(new RegExp(`(20\\d{2})[_\\s-]+${name}[a-z]*`));
    if (m2) return `${m2[1]}-${num}`;
  }
  // Fallback: use current cycle
  return require('../models/DieselCycle').schema.statics.getCycleKeyForDate
    ? null  // will compute from DieselCycle static
    : null;
}

// ── POST / — Upload and import ────────────────────────────────────────────────
router.post('/',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'finance', 'head_of_business']),
  upload.single('file'),
  async (req, res) => {
    const start = Date.now();
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }

      // Determine cycle_key: from body > from filename > error
      let cycle_key = req.body.cycle_key?.trim();
      if (!cycle_key) {
        cycle_key = deriveCycleKey(req.file.originalname);
      }
      if (!cycle_key) {
        return res.status(400).json({
          success: false,
          error: 'cycle_key is required. Pass it in the form body, or name the file e.g. "Budget_August_2026.xlsx".',
        });
      }

      // Validate cycle_key format
      if (!/^\d{4}-\d{2}$/.test(cycle_key)) {
        return res.status(400).json({
          success: false,
          error: `Invalid cycle_key "${cycle_key}". Expected format: YYYY-MM (e.g. 2026-08)`,
        });
      }

      logger.info(`[SiteBudgetUpload] ${req.user.email} uploading "${req.file.originalname}" for cycle ${cycle_key}`);

      const result = await importSiteBudgetFile(
        req.file.buffer,
        cycle_key,
        req.user.userId || req.user.email,
        req.file.originalname,
      );
      const elapsed_ms = Date.now() - start;

      logger.info(`[SiteBudgetUpload] Complete — ${result.imported} new, ${result.updated} updated, ${result.errors.length} errors, ${elapsed_ms}ms`);

      // Persist an upload-history record — the model (models/SiteBudgetUpload.js)
      // existed but nothing ever wrote to it, so the upload-history table on
      // SiteBudgetUploadPage.tsx has always been permanently empty.
      let uploadRecord = null;
      try {
        const status = result.errors.length === 0 ? 'success'
                      : (result.imported + result.updated) > 0 ? 'partial'
                      : 'failed';
        uploadRecord = await SiteBudgetUpload.create({
          cycle_key,
          filename:     req.file.originalname,
          uploaded_by:  req.user.userId,
          rows_total:    result.total,
          rows_imported: result.imported,
          rows_updated:  result.updated,
          rows_skipped:  result.skipped,
          error_count:   result.errors.length,
          errors:        result.errors.map(e => typeof e === 'string' ? e : `${e.site || '?'}: ${e.error || JSON.stringify(e)}`),
          warnings:      result.warnings || [],
          month_labels_detected: result.month_labels_detected,
          status,
        });
      } catch (trackErr) {
        // Tracking-record failure must never fail the upload itself — the
        // SiteBudget data was already saved successfully above.
        logger.error('[SiteBudgetUpload] Failed to save upload history record (non-fatal):', trackErr.message);
      }

      const error_count = result.errors.length;
      return res.status(error_count > 0 && result.imported + result.updated === 0 ? 422 : 200).json({
        success:  error_count === 0 || result.imported + result.updated > 0,
        data:     { ...result, error_count, elapsed_ms, upload_id: uploadRecord?._id },
        message:  `Cycle ${cycle_key}: ${result.imported} new + ${result.updated} updated sites in ${elapsed_ms}ms`,
      });

    } catch (err) {
      logger.error('[SiteBudgetUpload] Error:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── GET /preview — Dry-run: parse file, return summary without writing ─────────
router.post('/preview',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'finance', 'head_of_business']),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'No file' });
      const cycle_key = req.body.cycle_key?.trim() || deriveCycleKey(req.file.originalname);
      if (!cycle_key) return res.status(400).json({ success: false, error: 'cycle_key required' });

      // Parse without saving
      const xlsx = require('xlsx');
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
      const dataRows = rawRows.slice(2).filter(r => r && r[0] && String(r[0]).startsWith('IHS'));

      const clusters = {};
      let total_l = 0;
      for (const row of dataRows) {
        const cluster = String(row[3] || 'Unknown');
        const budget  = parseFloat(row[28]) || parseFloat(row[20]) || 0;
        const xaf     = parseFloat(row[27]) || 828;
        clusters[cluster] = clusters[cluster] || { sites: 0, budget_liters: 0, budget_xaf: 0 };
        clusters[cluster].sites++;
        clusters[cluster].budget_liters += budget;
        clusters[cluster].budget_xaf    += Math.round(budget * xaf);
        total_l += budget;
      }

      return res.json({
        success: true,
        data: {
          cycle_key,
          filename:     req.file.originalname,
          total_sites:  dataRows.length,
          total_budget_liters: Math.round(total_l),
          by_cluster:   clusters,
        },
        message: `Preview only — nothing was saved. ${dataRows.length} sites found.`,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── GET /status/:cycle_key — Check import status for a cycle ─────────────────
router.get('/status/:cycle_key',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'finance', 'head_of_business', 'supervisor']),
  async (req, res) => {
    try {
      const { cycle_key } = req.params;
      const count = await SiteBudget.countDocuments({ cycle_key });
      const budgets = await SiteBudget.find({ cycle_key })
        .select('cluster budget_liters budget_xaf xaf_per_liter liters_used is_fueling_site fuel_vendor card_number')
        .lean();

      const by_cluster = {};
      let total_budget_liters = 0;
      let total_liters_used   = 0;

      for (const b of budgets) {
        const c = b.cluster || 'Unknown';
        if (!by_cluster[c]) by_cluster[c] = { sites: 0, budget_liters: 0, budget_xaf: 0, liters_used: 0 };
        by_cluster[c].sites++;
        by_cluster[c].budget_liters += b.budget_liters || 0;
        by_cluster[c].budget_xaf    += b.budget_xaf    || 0;
        by_cluster[c].liters_used   += b.liters_used   || 0;
        total_budget_liters += b.budget_liters || 0;
        total_liters_used   += b.liters_used   || 0;
      }

      return res.json({
        success: true,
        data: {
          cycle_key,
          total_sites:          count,
          total_budget_liters:  Math.round(total_budget_liters),
          total_liters_used:    Math.round(total_liters_used),
          total_liters_remaining: Math.round(total_budget_liters - total_liters_used),
          utilisation_pct:      total_budget_liters > 0
            ? Math.round((total_liters_used / total_budget_liters) * 100) : 0,
          by_cluster,
        },
      });
    } catch (err) {
      logger.error('[SiteBudgetUpload] GET /status error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── GET /uploads — Upload history ─────────────────────────────────────────────
// Previously MISSING entirely: SiteBudgetUploadPage.tsx's "upload history"
// table calls this via siteBudgetApi.uploads() -> GET /api/site-budget/uploads.
// With no matching route here, that request fell through to the OTHER
// router also mounted at /api/site-budget (routes/siteBudgetRoutes.js),
// where it silently matched the GET /:cycle_key wildcard with cycle_key
// bound to the literal string "uploads" — returning an empty/wrong result
// instead of a 404, so the bug was invisible. Adding the real route here
// (mounted first) fixes it for good, since asyncHandler + this exact
// literal path now wins before Express ever reaches the second router.
router.get('/uploads',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'finance', 'head_of_business', 'supervisor']),
  async (req, res) => {
    try {
      const { page = 1, limit = 30, cycle_key } = req.query;
      const filter = cycle_key ? { cycle_key } : {};
      const [uploads, total] = await Promise.all([
        SiteBudgetUpload.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(+limit)
          .populate('uploaded_by', 'fullName')
          .lean(),
        SiteBudgetUpload.countDocuments(filter),
      ]);
      return res.json({
        success: true,
        data: uploads,
        pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) },
      });
    } catch (err) {
      logger.error('[SiteBudgetUpload] GET /uploads error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;
