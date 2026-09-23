'use strict';

const express = require('express');
const router = express.Router();

const { excelOnly } = require('../config/upload');
const { importTomCardCycleBudgetFile } = require('../services/tomCardCycleBudgetImportService');
const { TomCardCycleBudget, TomCardCycleBudgetUpload } = require('../models/TomCardCycleBudget');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');
const logger = require('../utils/logger');

const ROLES = ['diesel_manager', 'finance', 'admin'];

/**
 * POST /api/diesel/tomcard-cycle-budget/upload
 * The cycle-opening Tom Card budget/limit aggregate (xlsx). Uploaded once
 * at the start of each cycle. See models/TomCardCycleBudget.js.
 *
 * Body (multipart/form-data):
 *   file       — the .xlsx file
 *   cycle_key  — e.g. '2026-08' (REQUIRED — the file has no per-row date)
 */
router.post('/upload',
  authenticateToken,
  requireRole(ROLES),
  excelOnly.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const { cycle_key } = req.body;
    if (!cycle_key || !/^\d{4}-\d{2}$/.test(cycle_key)) {
      return res.status(400).json({ success: false, error: 'cycle_key is required and must be YYYY-MM' });
    }

    logger.info(`[TomCardCycleBudget] ${req.user.email} uploading "${req.file.originalname}" for cycle ${cycle_key}`);

    const result = await importTomCardCycleBudgetFile(
      req.file.buffer,
      cycle_key,
      req.user.userId,
      req.file.originalname,
    );

    logger.info(`[TomCardCycleBudget] Complete — ${result.rows_imported} card(s) loaded, ${result.cards_reissued} reissued, ${result.elapsed_ms}ms`);

    const message = result.cards_reissued > 0
      ? `${cycle_key}: ${result.rows_imported} card(s) loaded — ${result.cards_reissued} card number(s) changed this cycle.`
      : `${cycle_key}: ${result.rows_imported} card(s) loaded.`;

    return res.status(200).json({ success: true, data: result, message });
  })
);

/**
 * GET /api/diesel/tomcard-cycle-budget/uploads
 * Upload history.
 */
router.get('/uploads',
  authenticateToken,
  requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 30 } = req.query;
    const [uploads, total] = await Promise.all([
      TomCardCycleBudgetUpload.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(+limit)
        .populate('uploaded_by', 'fullName')
        .lean(),
      TomCardCycleBudgetUpload.countDocuments({}),
    ]);
    return res.json({
      success: true,
      data: uploads,
      pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) },
    });
  })
);

/**
 * GET /api/diesel/tomcard-cycle-budget/:cycle_key
 * Full list of card budgets for a cycle — powers the web upload page's
 * results table.
 */
router.get('/:cycle_key',
  authenticateToken,
  requireRole([...ROLES, 'supervisor']),
  asyncHandler(async (req, res) => {
    const cards = await TomCardCycleBudget.find({ cycle_key: req.params.cycle_key })
      .sort({ cluster: 1 })
      .lean();
    return res.json({ success: true, data: cards });
  })
);

/**
 * GET /api/diesel/tomcard-cycle-budget/:cycle_key/for-purchase-form
 * Clean, minimal shape for the mobile fuel-purchase card picker —
 * matches the TomCard interface new-fuel-purchase.tsx already expects
 * ({ cluster, card_number, fuel_vendor, xaf_per_liter }), sourced from
 * the real cycle-opening budget file instead of whatever (usually empty)
 * card_number/fuel_vendor fields happened to be on SiteBudget.
 */
router.get('/:cycle_key/for-purchase-form',
  authenticateToken,
  requireRole(['technician', 'fuel', 'diesel_manager', 'admin']),
  asyncHandler(async (req, res) => {
    const cards = await TomCardCycleBudget.find({ cycle_key: req.params.cycle_key })
      .select('cluster card_number vendor implied_xaf_per_liter budget_liters budget_xaf card_limit_xaf was_reissued')
      .sort({ cluster: 1 })
      .lean();

    const shaped = cards.map(c => ({
      cluster: c.cluster,
      card_number: c.card_number,
      fuel_vendor: c.vendor || 'TOTAL',
      xaf_per_liter: c.implied_xaf_per_liter || 828,
      budget_liters: c.budget_liters,
      budget_xaf: c.budget_xaf,
      card_limit_xaf: c.card_limit_xaf,
      was_reissued: c.was_reissued,
    }));

    return res.json({ success: true, data: shaped });
  })
);

module.exports = router;
