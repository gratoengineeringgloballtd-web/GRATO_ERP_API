'use strict';

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const XLSX     = require('xlsx');

// ── Use csvOrExcel multer — accepts both .csv and .xlsx ───────────────────────
const { csvOrExcel }        = require('../config/upload');
const { importFromCSV }     = require('../services/cmsImportService');
const cmsImportService      = require('../services/cmsImportService');
const { runForCycle }       = require('../services/reconciliationService');
const { fireSystemAlert }   = require('../services/alertService');
const CmsUpload             = require('../models/CmsUpload');
const CmsDailyRecord        = require('../models/CmsDailyRecord');
const DieselCycle           = require('../models/DieselCycle');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler          = require('../middlewares/asyncHandler');
const logger                = require('../utils/logger');

const ROLES = ['diesel_manager', 'data_collector', 'admin'];

/**
 * POST /api/diesel/cms/upload
 * Accepts CMS daily telemetry in CSV or XLSX format.
 *
 * Body (multipart/form-data):
 *   file       — CMS export file (.csv or .xlsx)
 *   cycle_key  — e.g. '2026-06' (OPTIONAL — see note below)
 *
 * BUG FIX: "cmsImportService.importFromCSV is not a function"
 *   This route used to call a function (`importFromCSV`) that didn't exist
 *   on cmsImportService — only `importCmsFile(filePath, userId)` existed,
 *   with a different signature (file path, not buffer) and no cycle_key
 *   param. cmsImportService.js now exports `importFromCSV(input, cycle_key,
 *   userId, filename)` which accepts the in-memory buffer/string this route
 *   already has, sharing all the parsing/dedup/streak logic with
 *   importCmsFile via a common core.
 *
 * BUG FIX (double CmsUpload write):
 *   importFromCSV/importCore already creates AND finalises its own
 *   CmsUpload document (it needs to before the dedup-by-data_date check
 *   makes sense). The previous version of this route created a SECOND
 *   CmsUpload doc after the import — which would throw on CmsUpload's
 *   unique `data_date` index the moment the import call above started
 *   succeeding. That second create() call has been removed; the route now
 *   just reads back the upload the service already created/finalised.
 *
 * NOTE on cycle_key: the actual cycle a row belongs to is always derived
 * server-side from the file's own "Day" column (see cmsImportService),
 * never from this form field — that prevents a wrong dropdown selection
 * from mis-filing a real day's data into the wrong cycle. The cycle_key
 * sent here is still required/validated as a basic sanity check on the
 * request, and is passed through to the importer, which will add a
 * warning (not an error) if it disagrees with the date-derived cycle.
 */
router.post('/upload',
  authenticateToken,
  requireRole(ROLES),
  csvOrExcel.single('file'),           // ← was: uploadCms.single('file') with CSV-only filter
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const cycle_key = req.body.cycle_key;
    if (!cycle_key || !/^\d{4}-\d{2}$/.test(cycle_key)) {
      return res.status(400).json({
        success: false,
        error: 'cycle_key is required and must be in YYYY-MM format',
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();

    try {
      let result;

      if (ext === '.xlsx' || ext === '.xls') {
        // ── XLSX branch ────────────────────────────────────────────────────
        // Check if this is actually a GRATO file uploaded to the wrong endpoint
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        if (wb.SheetNames.includes('Daily PM Rapport')) {
          // Operator uploaded GRATO file to CMS endpoint — tell them clearly
          return res.status(400).json({
            success: false,
            error: 'Wrong endpoint: this looks like a GRATO Daily Report file. ' +
                   'Please upload it via the GRATO Upload page (/api/diesel-recon/grato/upload).',
            hint: 'GRATO files contain the sheet "Daily PM Rapport". CMS files should be CSV exports from the CMS/ERS system.',
          });
        }

        // Otherwise treat as a CMS export in XLSX format
        // Convert first sheet to CSV-like rows and pass to importer
        const ws      = wb.Sheets[wb.SheetNames[0]];
        const csvText = XLSX.utils.sheet_to_csv(ws);
        result = await importFromCSV(
          Buffer.from(csvText),
          cycle_key,
          req.user.userId,
          req.file.originalname
        );
      } else {
        // ── CSV branch (original path) ─────────────────────────────────────
        result = await importFromCSV(
          req.file.buffer,
          cycle_key,
          req.user.userId,
          req.file.originalname
        );
      }

      // Trigger reconciliation async — don't block response
      // Use the cycle_key the importer actually filed data under (it may
      // differ from the form's cycle_key — see note above), so we don't
      // reconcile the wrong cycle.
      const effectiveCycleKey = result.cycle_key || cycle_key;
      setImmediate(() => runForCycle(effectiveCycleKey).catch(() => {}));
      // Fire fuel planning check after CMS data lands
      setImmediate(() => runPostUploadCheck(effectiveCycleKey));

      // NOTE: no CmsUpload.create() here — importFromCSV already created
      // and finalised the CmsUpload document (result.upload_id). Creating
      // a second one here would throw on the unique data_date index.

      return res.status(201).json({
        success: true,
        message: 'CMS file imported successfully',
        data: {
          cycle_key:     effectiveCycleKey,
          upload_id:     result.upload_id,
          rows_total:    result.total,
          rows_imported: result.imported,
          rows_skipped:  result.skipped,
          error_count:   result.errors?.length || 0,
          errors:        result.errors?.slice(0, 10),
          warnings:      result.warnings?.slice(0, 10),
        },
      });

    } catch (err) {
      await fireSystemAlert('IMPORT_ERROR', 'critical',
        `CMS Import Failed — ${req.file.originalname}`,
        err.message, { filename: req.file.originalname }, null).catch(() => {});
      logger.error('[CMS Upload] Error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Upload failed',
      });
    }
  }
);

// GET /api/diesel/cms/uploads — List all CMS uploads
router.get('/uploads',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 30, cycle_key } = req.query;
    const filter = cycle_key ? { cycle_key } : {};
    const [uploads, total] = await Promise.all([
      CmsUpload.find(filter)
        .sort({ data_date: -1 })
        .skip((page - 1) * limit)
        .limit(+limit)
        .populate('uploaded_by', 'fullName')
        .lean(),
      CmsUpload.countDocuments(filter),
    ]);
    res.json({ success: true, data: uploads, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) } });
  })
);

// GET /api/diesel/cms/uploads/:id — Single upload detail
router.get('/uploads/:id',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const upload = await CmsUpload.findById(req.params.id).populate('uploaded_by', 'fullName').lean();
    if (!upload) return res.status(404).json({ success: false, message: 'Upload not found' });
    res.json({ success: true, data: upload });
  })
);

// GET /api/diesel/cms/missing-days/:cycle_key — Days in cycle with no CMS data
router.get('/missing-days/:cycle_key',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const cycle = await DieselCycle.findOne({ cycle_key: req.params.cycle_key }).lean();
    if (!cycle) return res.status(404).json({ success: false, message: 'Cycle not found' });

    const uploads = await CmsUpload.find({ cycle_key: req.params.cycle_key, status: 'completed' })
      .select('data_date').lean();
    const uploadedDates = new Set(uploads.map(u => u.data_date.toISOString().split('T')[0]));

    const missing = [];
    const cur = new Date(cycle.start_date);
    const end = new Date(Math.min(cycle.end_date, Date.now()));
    while (cur <= end) {
      const key = cur.toISOString().split('T')[0];
      if (!uploadedDates.has(key)) missing.push(key);
      cur.setDate(cur.getDate() + 1);
    }

    res.json({ success: true, data: { cycle_key: req.params.cycle_key, missing_days: missing, missing_count: missing.length, uploaded_count: uploadedDates.size } });
  })
);

// GET /api/diesel/cms/daily/:site_id — CMS daily records for a site (with cycle filter)
router.get('/daily/:site_id',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const { cycle_key, limit = 60 } = req.query;
    const filter = { site_id: req.params.site_id };
    if (cycle_key) filter.cycle_key = cycle_key;
    const records = await CmsDailyRecord.find(filter).sort({ record_date: -1 }).limit(+limit).lean();
    res.json({ success: true, data: records });
  })
);

// POST /api/diesel/cms/reprocess/:upload_id — Re-run reconciliation after re-upload
router.post('/reprocess/:upload_id',
  authenticateToken, requireRole(['admin', 'diesel_manager']),
  asyncHandler(async (req, res) => {
    const upload = await CmsUpload.findById(req.params.upload_id).lean();
    if (!upload) return res.status(404).json({ success: false, message: 'Upload not found' });
    setImmediate(() => runForCycle(upload.cycle_key).catch(() => {}));
    res.json({ success: true, message: 'Reconciliation triggered', cycle_key: upload.cycle_key });
  })
);




// runPostUploadCheck: fires after every successful CMS upload
// Finds CRITICAL sites with no pending request and emails the team.
async function runPostUploadCheck(cycle_key) {
  if (!cycle_key) return;
  try {
    var planSvc   = require('../services/fuelPlanningService');
    var emailSvc  = require('../services/emailService');
    var plan      = await planSvc.planAllSites(cycle_key, { urgency_filter: ['critical'] });
    var urgent    = (plan.sites || []).filter(function(s) { return !s.pending_request && s.current_level_l !== null; });
    if (urgent.length === 0) return;
    logger.warn('[CmsUpload] Post-upload: ' + urgent.length + ' CRITICAL site(s) with no request (cycle=' + cycle_key + ')');
    var lines = urgent.slice(0, 20).map(function(s) {
      return '- ' + (s.site_name || s.site_id) + ' (' + (s.cluster || '?') + '): ' +
             s.current_level_l + 'L, ~' + (s.days_to_empty != null ? s.days_to_empty : '?') + ' days to empty';
    }).join('<br/>');
    await emailSvc.sendEmail({
      to:      ['minka.kevin@gratoglobal.com', 'pascal.rodrique@gratoglobal.com'],
      subject: 'CMS Upload Alert - ' + urgent.length + ' Critical Site(s) Need Refueling',
      html:    '<p>After today\'s CMS upload, <strong>' + urgent.length + '</strong> site(s) have critically low fuel with no pending request:</p>' +
               '<p style="background:#fff5f5;padding:12px;border-radius:6px;">' + lines + '</p>' +
               '<p>Use the Auto-Request Critical button in the Fuel Planning dashboard.</p>',
    });
    // Slack alert (non-blocking)
    var slackSvc = require('../services/slackService');
    slackSvc.sendSlackAlert({
      title:  urgent.length + ' Critical Sites — Fuel Refueling Required',
      text:   lines.replace(/<br\/>/g, '\n'),
      color:  'danger',
      fields: [
        { label: 'Cycle', value: cycle_key, short: true },
        { label: 'Critical sites', value: String(urgent.length), short: true },
        { label: 'Action', value: 'Open Fuel Planning > Auto-Request Critical', short: false },
      ],
    }).catch(function(){});
  } catch (err) {
    logger.error('[CmsUpload] runPostUploadCheck failed (non-fatal):', err.message);
  }
}
module.exports.runPostUploadCheck = runPostUploadCheck;


module.exports = router;

