/**
 * gratoUploadRoutes.js
 * diesel-system/routes/gratoUploadRoutes.js
 *
 * Wires the fixed importGratoExcel + serialiseErrors together.
 * Also includes the stats endpoint.
 *
 * BUG 9 FIX: this route used to require '../services/gratoImportService_fix',
 * a different file from the one that actually contains the BUG 1-8/10
 * patches (gratoImportService.js). That meant none of those fixes were
 * actually in effect on the live route — it was running whatever (likely
 * stale/unpatched) code lived under the _fix filename. Changed the require
 * below to point at the real, maintained service file.
 */
'use strict';

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { importGratoExcel, serialiseErrors } = require('../services/gratoImportService');
const GratoUpload = require('../models/GratoUpload');
const logger      = require('../utils/logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx / .xls / .csv files accepted'), ok);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/diesel-recon/grato/upload
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload',
  authenticateToken,
  requireRole(['admin', 'diesel_manager', 'data_collector', 'supervisor']),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const cycle_key   = req.body.cycle_key || null;
    const upload_type = req.body.upload_type || 'auto';

    try {
      const result = await importGratoExcel(
        req.file.buffer,
        cycle_key,
        req.user.userId
      );

      // ── FIX 4: serialise errors before saving to DB ──────────────────────
      await GratoUpload.create({
        cycle_key:        cycle_key || 'auto',
        filename:         req.file.originalname,
        uploaded_by:      req.user.userId,
        upload_type:      'grato_daily_report',
        rows_total:       result.total,
        rows_imported:    result.imported,
        rows_skipped:     result.skipped,
        technician_links: result.technician_links,
        generator_swaps:  result.generator_swaps,
        error_count:      result.errors.length,
        errors:           serialiseErrors(result.errors),  // ← always stringify
        status:           result.errors.length > 0
                            ? (result.imported > 0 ? 'partial' : 'failed')
                            : 'success',
      });

      return res.json({
        success: true,
        data: {
          upload_type:        'grato_daily_report',
          rows_total:         result.total,
          rows_imported:      result.imported,
          rows_skipped:       result.skipped,
          technician_links:   result.technician_links,
          generator_swaps:    result.generator_swaps,
          error_count:        result.errors.length,
          // Return first 10 errors as readable strings for the UI
          errors:             serialiseErrors(result.errors).slice(0, 10),
        },
      });

    } catch (err) {
      logger.error('[GRATO Upload] Fatal error:', err.message);
      return res.status(500).json({
        success: false,
        error:   err.message || 'Upload failed',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diesel-recon/grato/uploads   — list past uploads
// ─────────────────────────────────────────────────────────────────────────────
router.get('/uploads',
  authenticateToken,
  async (req, res) => {
    try {
      const { cycle_key, limit = 20 } = req.query;
      const query = cycle_key ? { cycle_key } : {};
      const uploads = await GratoUpload.find(query)
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
// GET /api/diesel-recon/grato/missing/:cycle_key
//
// BUG 10 FIX: this query compares Maintenance.distinct('site_id', ...)
// against Site.IHS_ID_SITE. Both sides are now unsuffixed (GRATO's
// parseRow normalises site_id the same way CMS does), so the comparison
// is apples-to-apples again. No code change needed here beyond the
// service-layer fix — documenting why this now works.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/missing/:cycle_key',
  authenticateToken,
  async (req, res) => {
    try {
      const { cycle_key } = req.params;
      const Site        = require('../models/Site');
      const Maintenance = require('../models/Maintenance');

      const [year, month] = cycle_key.split('-').map(Number);
      const cycleStart = new Date(year, month - 2, 26);
      const cycleEnd   = new Date(year, month - 1, 25, 23, 59, 59);

      // Sites that had at least one GRATO visit this cycle
      const visitedSiteIds = await Maintenance.distinct('site_id', {
        visit_date: { $gte: cycleStart, $lte: cycleEnd },
        source:     'data_collector_excel',
      });

      // All fueling sites (Grid Gen / Hybrid Gen / Gen Only)
      const allSites = await Site.find({
        Sites_Power_Topology: { $not: /Grid Only/i },
      }).select('IHS_ID_SITE Site_Name GRATO_Cluster Actual_Date_Visit').lean();

      const missing = allSites
        .filter(s => !visitedSiteIds.includes(s.IHS_ID_SITE))
        .map(s => ({
          site_id:    s.IHS_ID_SITE,
          site_name:  s.Site_Name,
          cluster:    s.GRATO_Cluster,
          last_visit: s.Actual_Date_Visit,
        }));

      return res.json({ success: true, data: missing, count: missing.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diesel-recon/grato/stats/:cycle_key
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/:cycle_key',
  authenticateToken,
  async (req, res) => {
    try {
      const { cycle_key } = req.params;
      const Maintenance   = require('../models/Maintenance');

      const [year, month] = cycle_key.split('-').map(Number);
      const cycleStart = new Date(year, month - 2, 26);
      const cycleEnd   = new Date(year, month - 1, 25, 23, 59, 59);

      const base = {
        visit_date: { $gte: cycleStart, $lte: cycleEnd },
        source:     'data_collector_excel',
      };

      const [byTech, byCluster, byDay, bySite, cphComp] = await Promise.all([
        // By technician
        Maintenance.aggregate([
          { $match: base },
          { $group: {
            _id:                '$technician_name',
            visits:             { $sum: 1 },
            sites:              { $addToSet: '$site_id' },
            pm_visits:          { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$visit_type',''] }, regex: /PM/ } }, 1, 0] } },
            rf_visits:          { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$visit_type',''] }, regex: /RF/ } }, 1, 0] } },
            end_visits:         { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$visit_type',''] }, regex: /END/ } }, 1, 0] } },
            total_fuel_added:   { $sum: '$fuel_data.qte_ajoutee' },
            total_fuel_consumed:{ $sum: '$fuel_data.qte_consommee' },
            total_run_hours:    { $sum: '$combined_stats.total_run_hour' },
          }},
          { $project: {
            technician_name: '$_id', visits: 1,
            pm_visits: 1, rf_visits: 1, end_visits: 1,
            site_count: { $size: '$sites' },
            total_fuel_added: 1, total_fuel_consumed: 1, total_run_hours: 1,
          }},
          { $sort: { visits: -1 } },
        ]),

        // By cluster
        Maintenance.aggregate([
          { $match: base },
          { $group: {
            _id:                '$site_metadata.cluster',
            visits:             { $sum: 1 },
            sites:              { $addToSet: '$site_id' },
            total_fuel_added:   { $sum: '$fuel_data.qte_ajoutee' },
            total_fuel_consumed:{ $sum: '$fuel_data.qte_consommee' },
            total_run_hours:    { $sum: '$combined_stats.total_run_hour' },
            avg_cph:            { $avg: '$combined_stats.cph_actual' },
          }},
          { $project: {
            cluster: '$_id', visits: 1,
            total_fuel_added: 1, total_fuel_consumed: 1,
            total_run_hours: 1, avg_cph: 1,
            site_count: { $size: '$sites' },
          }},
          { $sort: { visits: -1 } },
        ]),

        // By day
        Maintenance.aggregate([
          { $match: base },
          { $group: {
            _id:           { $dateToString: { format: '%Y-%m-%d', date: '$visit_date' } },
            visits:        { $sum: 1 },
            sites:         { $addToSet: '$site_id' },
            fuel_added:    { $sum: '$fuel_data.qte_ajoutee' },
            fuel_consumed: { $sum: '$fuel_data.qte_consommee' },
          }},
          { $sort: { _id: 1 } },
        ]),

        // By site (last visit info)
        Maintenance.aggregate([
          { $match: base },
          { $sort: { visit_date: -1 } },
          { $group: {
            _id:                 '$site_id',
            last_visit:          { $first: '$visit_date' },
            last_technician:     { $first: '$technician_name' },
            last_visit_type:     { $first: '$visit_type' },
            visit_count:         { $sum: 1 },
            total_fuel_added:    { $sum: '$fuel_data.qte_ajoutee' },
            total_fuel_consumed: { $sum: '$fuel_data.qte_consommee' },
            total_run_hours:     { $sum: '$combined_stats.total_run_hour' },
            last_cph:            { $first: '$combined_stats.cph_actual' },
            last_gen_serial:     { $first: { $arrayElemAt: ['$generators_checked.serial_number', 0] } },
            last_gen_brand:      { $first: { $arrayElemAt: ['$generators_checked.brand', 0] } },
            has_dg_issues:       { $sum: { $cond: [{ $and: [{ $ifNull: ['$issues_found.DG_Issues', false] }, { $ne: ['$issues_found.DG_Issues', ''] }] }, 1, 0] } },
          }},
          { $sort: { last_visit: -1 } },
        ]),

        // CPH comparison (actual vs contractual)
        Maintenance.aggregate([
          { $match: { ...base, 'combined_stats.cph_actual': { $ne: null, $gt: 0 } } },
          { $group: {
            _id:      '$site_id',
            avg_cph:  { $avg: '$combined_stats.cph_actual' },
            avg_cph_contractual: { $avg: '$combined_stats.cph_contractual' },
            min_cph:  { $min: '$combined_stats.cph_actual' },
            max_cph:  { $max: '$combined_stats.cph_actual' },
            readings: { $sum: 1 },
          }},
          { $sort: { avg_cph: -1 } },
          { $limit: 100 },
        ]),
      ]);

      const totals = byDay.reduce((acc, d) => {
        acc.total_visits      += d.visits;
        acc.total_fuel_added  += d.fuel_added    || 0;
        acc.total_fuel_consumed += d.fuel_consumed || 0;
        return acc;
      }, { total_visits: 0, total_fuel_added: 0, total_fuel_consumed: 0 });

      return res.json({
        success: true,
        data: {
          cycle_key,
          cycle_window:   { start: cycleStart, end: cycleEnd },
          by_technician:  byTech,
          by_cluster:     byCluster,
          by_day:         byDay,
          by_site:        bySite,
          cph_comparison: cphComp,
          totals,
        },
      });

    } catch (err) {
      logger.error('[GRATO Stats]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diesel-recon/grato/visits/cycle/:cycle_key
// ─────────────────────────────────────────────────────────────────────────────
router.get('/visits/cycle/:cycle_key',
  authenticateToken,
  async (req, res) => {
    try {
      const { cycle_key } = req.params;
      const { cluster, technician, site_id, limit = 200 } = req.query;
      const Maintenance = require('../models/Maintenance');

      const [year, month] = cycle_key.split('-').map(Number);
      const cycleStart = new Date(year, month - 2, 26);
      const cycleEnd   = new Date(year, month - 1, 25, 23, 59, 59);

      const query = {
        visit_date: { $gte: cycleStart, $lte: cycleEnd },
        source:     'data_collector_excel',
      };
      if (cluster)    query['site_metadata.cluster'] = cluster;
      if (technician) query.technician_name           = { $regex: technician, $options: 'i' };
      if (site_id)    query.site_id                   = site_id;

      const visits = await Maintenance.find(query)
        .sort({ visit_date: -1 })
        .limit(parseInt(limit))
        .select('site_id site_name technician_name visit_type visit_date ' +
                'fuel_data combined_stats pm_checks issues_found generators_checked ' +
                'site_metadata electrical_data')
        .lean();

      return res.json({ success: true, data: visits, count: visits.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;

