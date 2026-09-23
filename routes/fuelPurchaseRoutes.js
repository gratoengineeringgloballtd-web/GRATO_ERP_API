// routes/fuelPurchaseRoutes.js
//
// Mount this at /api/technician/fuel-purchases in server.js — see
// server-mount-snippet.md for the exact line and where to put it.

const express = require('express');
const router = express.Router();
const FuelPurchase = require('../models/FuelPurchase');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');

/**
 * POST /api/technician/fuel-purchases
 * Create a new bulk fuel purchase (photo + total quantity bought).
 */
router.post('/',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const {
        client_id,
        photo,
        total_quantity,
        price_per_liter,
        truck_plate_number,
        supplier,
        purchase_date,
        tom_card_number,
        cluster,
        station,
        arrival_time,
        departure_time,
      } = req.body;

      if (!total_quantity || isNaN(Number(total_quantity)) || Number(total_quantity) <= 0) {
        return res.status(400).json({
          success: false,
          error: 'total_quantity is required and must be greater than 0',
        });
      }

      // Idempotency guard — same pattern as /technician/refuel. If a queued
      // offline creation gets retried after already succeeding, return the
      // existing record instead of creating a duplicate purchase.
      if (client_id) {
        const existing = await FuelPurchase.findOne({ client_id });
        if (existing) {
          return res.status(200).json({ success: true, data: existing });
        }
      }

      const qty = Number(total_quantity);
      const ppl = price_per_liter ? Number(price_per_liter) : undefined;
      const purchase = new FuelPurchase({
        client_id,
        technician:         technicianId,
        purchase_date:      purchase_date ? new Date(purchase_date) : new Date(),
        photo,
        total_quantity:     qty,
        remaining_quantity: qty,
        price_per_liter:    ppl,
        total_cost:         ppl ? ppl * qty : undefined,
        total_cost_xaf:     ppl ? ppl * qty : undefined,
        truck_plate_number,
        supplier:           supplier || station,
        station,
        tom_card_number,
        cluster,
        arrival_time:       arrival_time   ? new Date(arrival_time)   : undefined,
        departure_time:     departure_time ? new Date(departure_time) : undefined,
        status: 'active',
      });

      await purchase.save();

      logger.info('Fuel purchase created', {
        purchaseId: purchase._id,
        technician: technicianId,
        quantity: qty,
      });

      res.status(201).json({ success: true, data: purchase });
    } catch (error) {
      logger.error('Create fuel purchase error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create fuel purchase',
      });
    }
  }
);

/**
 * GET /api/technician/fuel-purchases/active
 * List this technician's purchases that still have fuel remaining —
 * this is what the "select a purchase" screen shows.
 * ⚠️ MUST come before /:id
 */
router.get('/active',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const purchases = await FuelPurchase.find({
        technician: technicianId,
        status: 'active',
        remaining_quantity: { $gt: 0 },
      }).sort({ purchase_date: -1 });

      res.json({ success: true, data: purchases });
    } catch (error) {
      logger.error('List active fuel purchases error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list fuel purchases',
      });
    }
  }
);

/**
 * GET /api/technician/fuel-purchases/:id
 */
router.get('/:id',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const purchase = await FuelPurchase.findById(req.params.id);
      if (!purchase) {
        return res.status(404).json({ success: false, error: 'Fuel purchase not found' });
      }
      res.json({ success: true, data: purchase });
    } catch (error) {
      logger.error('Get fuel purchase error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch fuel purchase',
      });
    }
  }
);



/**
 * GET /api/technician/fuel-purchases/cards/:cycle_key
 * Tom Card list for the cycle — for the purchase form dropdown.
 */
router.get('/cards/:cycle_key',
  authenticateToken,
  requireRole(['technician', 'fuel', 'diesel_manager', 'admin']),
  async (req, res) => {
    try {
      // Preferred source: the dedicated cycle-opening Tom Card budget
      // upload (routes/tomCardCycleBudgetRoutes.js) — real per-cluster
      // budget/limit/implied-rate data from finance, uploaded once per
      // cycle specifically to power this picker.
      const { TomCardCycleBudget } = require('../models/TomCardCycleBudget');
      const cycleBudgetCards = await TomCardCycleBudget.find({ cycle_key: req.params.cycle_key })
        .select('cluster card_number vendor implied_xaf_per_liter')
        .sort({ cluster: 1 })
        .lean();

      if (cycleBudgetCards.length > 0) {
        const cards = cycleBudgetCards.map(c => ({
          cluster: c.cluster,
          card_number: c.card_number,
          fuel_vendor: c.vendor || 'TOTAL',
          xaf_per_liter: c.implied_xaf_per_liter || 828,
        }));
        return res.json({ success: true, data: cards, source: 'tomcard_cycle_budget' });
      }

      // Fallback: no dedicated cycle-budget upload exists yet for this
      // cycle — degrade to the old SiteBudget-embedded fields rather than
      // returning an empty list outright.
      const SiteBudget = require('../models/SiteBudget');
      const budgets = await SiteBudget.find({
        cycle_key: req.params.cycle_key,
        card_number: { $exists: true, $ne: null },
      }).select('cluster card_number fuel_vendor xaf_per_liter').lean();
      const seen = new Set();
      const cards = [];
      for (const b of budgets) {
        if (b.cluster && !seen.has(b.cluster)) {
          seen.add(b.cluster);
          cards.push({ cluster: b.cluster, card_number: b.card_number,
            fuel_vendor: b.fuel_vendor || 'TOTAL', xaf_per_liter: b.xaf_per_liter || 828 });
        }
      }
      cards.sort((a, b) => a.cluster.localeCompare(b.cluster));
      res.json({ success: true, data: cards, source: 'site_budget_fallback' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);
module.exports = router;

