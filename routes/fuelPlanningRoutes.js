/**
 * fuelPlanningRoutes.js
 * PowerGen_API/routes/fuelPlanningRoutes.js
 *
 * MOUNT IN app.js:
 *   app.use('/api/fuel-planning', require('./routes/fuelPlanningRoutes'));
 *
 * ENDPOINTS:
 *   GET  /api/fuel-planning/predict/:cycle_key
 *        All-sites prediction for a cycle. Query: urgency=critical,high
 *   GET  /api/fuel-planning/predict/:cycle_key/site/:site_id
 *        Single-site deep prediction + optional Gemini narrative (?gemini=1)
 *   GET  /api/fuel-planning/schedule/:cycle_key
 *        Ranked refueling schedule — which sites to visit first and when
 *   POST /api/fuel-planning/auto-request/:cycle_key
 *        Auto-create FuelRequests for all CRITICAL sites that don't have one
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { predictSiteFuel, planAllSites, geminiNarrative, getCycleKey } = require('../services/fuelPlanningService');
const FuelRequest = require('../models/FuelRequest');
const SiteBudget  = require('../models/SiteBudget');
const logger      = require('../utils/logger');

const PLAN_ROLES = ['diesel_manager', 'admin', 'finance', 'head_of_business', 'ceo', 'supervisor'];

// ─────────────────────────────────────────────────────────────────────────────
// GET /predict/:cycle_key — all-sites prediction
// Query params:
//   urgency   = comma-separated filter e.g. "critical,high"
//   limit     = max results (default 200)
//   cluster   = filter by cluster name
// ─────────────────────────────────────────────────────────────────────────────
router.get('/predict/:cycle_key', authenticateToken, requireRole(PLAN_ROLES), async (req, res) => {
  try {
    const { cycle_key } = req.params;
    const urgencyFilter = req.query.urgency ? req.query.urgency.split(',') : null;
    const limit         = parseInt(req.query.limit) || 200;
    const cluster       = req.query.cluster || null;

    const plan = await planAllSites(cycle_key, { urgency_filter: urgencyFilter, limit });

    // Filter by cluster if requested
    if (cluster) plan.sites = plan.sites.filter(s => s.cluster === cluster);

    logger.info(`[FuelPlanning] /predict/${cycle_key} → ${plan.sites.length} sites, critical=${plan.total_critical}`);
    return res.json({ success: true, data: plan });
  } catch (err) {
    logger.error('[FuelPlanning] /predict error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /predict/:cycle_key/site/:site_id — single site deep dive + Gemini
// ─────────────────────────────────────────────────────────────────────────────
router.get('/predict/:cycle_key/site/:site_id', authenticateToken, requireRole(PLAN_ROLES), async (req, res) => {
  try {
    const { cycle_key, site_id } = req.params;
    const useGemini = req.query.gemini === '1' || req.query.gemini === 'true';

    let prediction = await predictSiteFuel(site_id, cycle_key);

    if (useGemini) {
      prediction = await geminiNarrative(prediction);
    }

    return res.json({ success: true, data: prediction });
  } catch (err) {
    logger.error('[FuelPlanning] /predict site error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /schedule/:cycle_key — ranked refueling work-order list
// Returns sites sorted by urgency with a suggested visit date for each
// ─────────────────────────────────────────────────────────────────────────────
router.get('/schedule/:cycle_key', authenticateToken, requireRole(PLAN_ROLES), async (req, res) => {
  try {
    const { cycle_key } = req.params;
    const plan = await planAllSites(cycle_key, { urgency_filter: ['critical', 'high', 'medium'] });

    const schedule = plan.sites.map((site, idx) => ({
      rank:              idx + 1,
      site_id:           site.site_id,
      site_name:         site.site_name,
      cluster:           site.cluster,
      region:            site.region,
      urgency:           site.urgency,
      current_level_l:   site.current_level_l,
      fuel_pct:          site.fuel_pct,
      days_to_empty:     site.days_to_empty,
      suggested_refuel_date: site.suggested_refuel_date,
      estimated_empty_date:  site.estimated_empty_date,
      consumption_per_day_l: site.consumption_per_day_l,
      rate_source:           site.rate_source,
      liters_remaining_budget: site.liters_remaining,
      has_pending_request: !!site.pending_request,
      pending_request:     site.pending_request,
      action_required:   !site.pending_request
        ? site.urgency === 'critical' ? 'RAISE_URGENT_REQUEST' : 'SCHEDULE_REFUELING'
        : site.pending_request.status === 'scheduled' ? 'ASSIGN_REFUELER' : 'AWAIT_APPROVAL',
    }));

    return res.json({
      success: true,
      data: {
        cycle_key,
        generated_at:   new Date(),
        total_sites:    schedule.length,
        critical_count: plan.total_critical,
        high_count:     plan.total_high,
        medium_count:   plan.total_medium,
        schedule,
      },
    });
  } catch (err) {
    logger.error('[FuelPlanning] /schedule error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auto-request/:cycle_key — create FuelRequests for CRITICAL sites
// Only creates requests where none already exists for this cycle
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auto-request/:cycle_key',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { cycle_key } = req.params;
      const plan = await planAllSites(cycle_key, { urgency_filter: ['critical'] });

      const results = { created: [], skipped: [], errors: [] };

      for (const site of plan.sites) {
        try {
          // Skip if already has a pending/approved request this cycle
          if (site.pending_request) {
            results.skipped.push({ site_id: site.site_id, reason: 'already has request' });
            continue;
          }

          // Calculate how many litres needed to fill to 80% of tank
          const fillTarget   = Math.round((site.tank_capacity_l || 5000) * 0.80);
          const litersNeeded = Math.max(50, fillTarget - (site.current_level_l || 0));

          // Check budget
          const sb = await SiteBudget.findOne({ site_id: site.site_id, cycle_key }).lean();
          if (sb && sb.liters_remaining < 50) {
            results.skipped.push({ site_id: site.site_id, reason: 'insufficient budget' });
            continue;
          }

          const fr = await FuelRequest.create({
            site_id:         site.site_id,
            site_name:       site.site_name,
            cluster:         site.cluster,
            region:          site.region,
            cycle_key,
            liters_requested:litersNeeded,
            xaf_requested:   Math.round(litersNeeded * (sb?.xaf_per_liter || 828)),
            urgency:         'critical',
            request_reason:  `Auto-generated: site at ${site.current_level_l ?? '?'}L (${site.fuel_pct ?? '?'}% full). ` +
                             `Predicted empty in ${site.days_to_empty ?? '?'} days. ` +
                             `Consumption: ${site.consumption_per_day_l ?? '?'} L/day.`,
            current_fuel_level: site.current_level_l,
            tank_capacity:   site.tank_capacity_l,
            auto_generated:  true,
            requested_by_name: req.user.email,
            // FIX: the top-level FuelRequest.status enum uses
            // 'pending_diesel_coordinator' etc, NOT 'pending_l1' (that
            // string only exists in the PER-STEP approvalChain[].status
            // enum). Setting status: 'pending_l1' here threw a Mongoose
            // ValidationError on every single call, so this auto-request
            // feature was failing 100% of the time before this fix.
            status:          'pending_diesel_coordinator',
            // FIX: getFuelRequestApprovalChain(liters) expects a raw number
            // and does `liters >= CEO_LITERS_THRESHOLD`. Passing an object
            // ({ liters_requested: litersNeeded }) coerced to NaN, so
            // needsCEO was always false — every auto-generated request
            // (typically "critical" refuels filling to 80% of tank, often
            // well over the 100L CEO threshold) silently skipped CEO
            // approval regardless of size. Now passes the raw number.
            approvalChain:   require('../config/fuelRequestApprovalChain')
              .getFuelRequestApprovalChain(litersNeeded),
          });

          results.created.push({
            site_id:         site.site_id,
            site_name:       site.site_name,
            fuel_request_id: fr._id,
            liters_requested:litersNeeded,
          });

        } catch (siteErr) {
          logger.error(`[FuelPlanning] auto-request error for ${site.site_id}:`, siteErr.message);
          results.errors.push({ site_id: site.site_id, error: siteErr.message });
        }
      }

      logger.info(`[FuelPlanning] auto-request: ${results.created.length} created, ${results.skipped.length} skipped`);
      return res.json({
        success:  true,
        message:  `Auto-requests: ${results.created.length} created, ${results.skipped.length} skipped, ${results.errors.length} errors`,
        data:     results,
      });
    } catch (err) {
      logger.error('[FuelPlanning] /auto-request error:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /summary/:cycle_key — executive summary stats for dashboards
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary/:cycle_key', authenticateToken, requireRole(PLAN_ROLES), async (req, res) => {
  try {
    const { cycle_key } = req.params;
    const plan = await planAllSites(cycle_key);

    const byClusters = {};
    for (const s of plan.sites) {
      const c = s.cluster || 'Unknown';
      if (!byClusters[c]) byClusters[c] = { critical:0, high:0, medium:0, ok:0, unknown:0 };
      byClusters[c][s.urgency] = (byClusters[c][s.urgency] || 0) + 1;
    }

    return res.json({
      success: true,
      data: {
        cycle_key,
        generated_at:   new Date(),
        total_sites:    plan.total,
        critical:       plan.total_critical,
        high:           plan.total_high,
        medium:         plan.total_medium,
        ok:             plan.total_ok,
        by_cluster:     byClusters,
        sites_without_data: plan.sites.filter(s => s.rate_source === 'none').length,
        sites_using_cms:    plan.sites.filter(s => s.rate_source === 'cms_ccph').length,
        sites_using_field:  plan.sites.filter(s => s.rate_source === 'field_data').length,
        sites_using_budget: plan.sites.filter(s => s.rate_source.startsWith('budget')).length,
      },
    });
  } catch (err) {
    logger.error('[FuelPlanning] /summary error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
