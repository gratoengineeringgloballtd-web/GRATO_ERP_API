/**
 * validationUploadRoutes.js
 * diesel-system/routes/validationUploadRoutes.js
 *
 * Endpoints for the GRATO Validation Template upload (Main + Validation
 * sheets — see validationImportService.js for the full parsing/import
 * logic and the reasoning behind every sanitisation decision).
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { importValidationFile, serialiseErrors } = require('../services/validationImportService');
const ValidationUpload  = require('../models/ValidationUpload');
const ValidationRecord  = require('../models/ValidationRecord');
const logger             = require('../utils/logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx / .xls files accepted'), ok);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/diesel-recon/validation/upload
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload',
  authenticateToken,
  requireRole(['admin', 'diesel_manager', 'data_collector', 'supervisor']),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    try {
      // Create the upload record FIRST (without final counts) so we have an
      // _id to attach to every ValidationRecord for audit, then patch it
      // with the real summary once the import finishes. This mirrors the
      // ordering used by cmsImportService.js for the same reason.
      const uploadDoc = await ValidationUpload.create({
        filename:    req.file.originalname,
        uploaded_by: req.user.userId,
        status:      'success', // provisional; corrected below
      });

      const result = await importValidationFile(req.file.buffer, req.user.userId, uploadDoc._id);

      const errorCount = result.errors.length;
      const status = errorCount > 0
        ? ((result.main_rows_imported > 0 || result.validation_rows_imported > 0) ? 'partial' : 'failed')
        : 'success';

      await ValidationUpload.findByIdAndUpdate(uploadDoc._id, {
        main_rows_total:        result.main_rows_total,
        main_rows_imported:     result.main_rows_imported,
        main_rows_skipped:      result.main_rows_skipped,
        main_technician_links:  result.main_technician_links,
        main_generator_swaps:   result.main_generator_swaps,
        validation_rows_total:    result.validation_rows_total,
        validation_rows_imported: result.validation_rows_imported,
        validation_rows_skipped:  result.validation_rows_skipped,
        validation_cycles_touched: result.validation_cycles_touched,
        site_budgets_updated:      result.site_budgets_updated,
        error_count: errorCount,
        errors:      serialiseErrors(result.errors),
        status,
      });

      return res.json({
        success: true,
        data: {
          upload_id: uploadDoc._id,
          main: {
            rows_total:       result.main_rows_total,
            rows_imported:    result.main_rows_imported,
            rows_skipped:     result.main_rows_skipped,
            technician_links: result.main_technician_links,
            generator_swaps:  result.main_generator_swaps,
          },
          validation: {
            rows_total:       result.validation_rows_total,
            rows_imported:    result.validation_rows_imported,
            rows_skipped:     result.validation_rows_skipped,
            cycles_touched:   result.validation_cycles_touched,
            site_budgets_updated: result.site_budgets_updated,
          },
          error_count: errorCount,
          errors:      serialiseErrors(result.errors).slice(0, 10),
        },
      });

    } catch (err) {
      logger.error('[Validation Upload] Fatal error:', err.message);
      return res.status(500).json({
        success: false,
        error:   err.message || 'Upload failed',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diesel-recon/validation/uploads — list past uploads
// ─────────────────────────────────────────────────────────────────────────────
router.get('/uploads',
  authenticateToken,
  async (req, res) => {
    try {
      const { limit = 20 } = req.query;
      const uploads = await ValidationUpload.find({})
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .populate('uploaded_by', 'fullName')
        .lean();
      return res.json({ success: true, data: uploads });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diesel-recon/validation/records/:cycle_key — full per-site detail
// ─────────────────────────────────────────────────────────────────────────────
router.get('/records/:cycle_key',
  authenticateToken,
  async (req, res) => {
    try {
      const records = await ValidationRecord.getForCycle(req.params.cycle_key);
      return res.json({ success: true, data: records, count: records.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diesel-recon/validation/stats/:cycle_key — cycle totals + DG-check
// mismatches (sites where SBC-recorded KVA disagreed with the validated value)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/:cycle_key',
  authenticateToken,
  async (req, res) => {
    try {
      const { cycle_key } = req.params;
      const totals  = await ValidationRecord.getCycleTotals(cycle_key);
      const records = await ValidationRecord.getForCycle(cycle_key);

      const dgMismatches = records
        .filter(r => r.dg_check === false)
        .map(r => ({
          site_id: r.site_id, site_name: r.site_name,
          sbc_dg_kva: r.sbc_dg_kva, final_dg_kva: r.final_dg_kva,
          dg_comment: r.dg_comment,
        }));

      const cmsMismatches = records
        .filter(r => r.cms_vs_field != null && Math.abs(r.cms_vs_field) > 0)
        .sort((a, b) => Math.abs(b.cms_vs_field) - Math.abs(a.cms_vs_field))
        .slice(0, 50)
        .map(r => ({
          site_id: r.site_id, site_name: r.site_name,
          cms_rh: r.cms_rh, final_rh: r.final_rh,
          cms_vs_field: r.cms_vs_field, cms_vs_field_comment: r.cms_vs_field_comment,
        }));

      return res.json({
        success: true,
        data: {
          cycle_key,
          totals,
          dg_check_mismatches: dgMismatches,
          cms_vs_field_top:    cmsMismatches,
          by_cluster: Object.values(records.reduce((acc, r) => {
            const key = r.cluster || 'Unknown';
            if (!acc[key]) acc[key] = {
              cluster: key, sites: 0, total_final_rh: 0,
              total_final_cons: 0, total_management_amount: 0,
            };
            acc[key].sites++;
            acc[key].total_final_rh += r.final_rh || 0;
            acc[key].total_final_cons += r.final_cons || 0;
            acc[key].total_management_amount += r.management_amount || 0;
            return acc;
          }, {})),
        },
      });
    } catch (err) {
      logger.error('[Validation Stats]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;