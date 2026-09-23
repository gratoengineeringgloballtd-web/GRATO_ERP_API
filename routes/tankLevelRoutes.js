'use strict';

const express = require('express');
const router = express.Router();

const { csvOnly } = require('../config/upload');
const { importTankLevelFile } = require('../services/tankLevelImportService');
const TankLevelReading = require('../models/TankLevelReading');
const TankLevelUpload = require('../models/TankLevelUpload');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');
const logger = require('../utils/logger');

const ROLES = ['diesel_manager', 'data_collector', 'admin'];

/**
 * POST /api/diesel/tank-level/upload
 * Daily tank-level export (RegionName, SiteName, Component, Location,
 * Value, Column1, Device, ...). See models/TankLevelReading.js for the
 * full column-shape explanation.
 *
 * Body (multipart/form-data):
 *   file          — the daily CSV export
 *   reading_date  — YYYY-MM-DD this file represents (REQUIRED — the file
 *                    carries per-row timestamps but no single "as-of" date
 *                    header, same reasoning as the Site Budget upload)
 */
router.post('/upload',
  authenticateToken,
  requireRole(ROLES),
  csvOnly.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const { reading_date } = req.body;
    if (!reading_date || !/^\d{4}-\d{2}-\d{2}$/.test(reading_date)) {
      return res.status(400).json({ success: false, error: 'reading_date is required and must be YYYY-MM-DD' });
    }

    logger.info(`[TankLevel] ${req.user.email} uploading "${req.file.originalname}" for ${reading_date}`);

    const result = await importTankLevelFile(
      req.file.buffer,
      reading_date,
      req.user.userId,
      req.file.originalname,
    );

    logger.info(`[TankLevel] Complete — ${result.sites_ok} ok, ${result.sites_sensor_error} sensor errors, ${result.sites_skipped} skipped, ${result.sites_refreshed} sites' current level refreshed, ${result.elapsed_ms}ms`);

    return res.status(200).json({
      success: true,
      data: result,
      message: `${reading_date}: ${result.sites_ok} site(s) updated, ${result.sites_sensor_error} sensor error(s), ${result.sites_skipped} skipped.`,
    });
  })
);

/**
 * GET /api/diesel/tank-level/uploads
 * Upload history.
 */
router.get('/uploads',
  authenticateToken,
  requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 30 } = req.query;
    const [uploads, total] = await Promise.all([
      TankLevelUpload.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(+limit)
        .populate('uploaded_by', 'fullName')
        .lean(),
      TankLevelUpload.countDocuments({}),
    ]);
    return res.json({
      success: true,
      data: uploads,
      pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) },
    });
  })
);

/**
 * GET /api/diesel/tank-level/readings?reading_date=YYYY-MM-DD&cluster=...
 * Site-level readings for a given day (defaults to the most recent day on
 * file if reading_date is omitted) — powers the upload page's results
 * table and any dashboard widget wanting today's tank levels.
 */
router.get('/readings',
  authenticateToken,
  requireRole([...ROLES, 'supervisor', 'technician']),
  asyncHandler(async (req, res) => {
    let { reading_date, cluster, status } = req.query;

    if (!reading_date) {
      const latest = await TankLevelReading.findOne({}).sort({ reading_date: -1 }).select('reading_date').lean();
      reading_date = latest?.reading_date || null;
    }
    if (!reading_date) {
      return res.json({ success: true, data: [], reading_date: null });
    }

    const filter = { reading_date };
    if (cluster) filter.cluster = cluster;
    if (status) filter.status = status;

    const readings = await TankLevelReading.find(filter).sort({ site_id: 1 }).lean();
    return res.json({ success: true, data: readings, reading_date });
  })
);

/**
 * GET /api/diesel/tank-level/site/:site_id/latest
 * Most recent reading for one site, any date — used by drill-down views.
 */
router.get('/site/:site_id/latest',
  authenticateToken,
  requireRole([...ROLES, 'supervisor', 'technician']),
  asyncHandler(async (req, res) => {
    const reading = await TankLevelReading.latestForSite(req.params.site_id);
    if (!reading) return res.status(404).json({ success: false, error: 'No reading found for this site' });
    return res.json({ success: true, data: reading });
  })
);

module.exports = router;
