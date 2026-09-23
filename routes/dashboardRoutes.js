const express = require('express');
const router  = express.Router();
const CycleReconciliation = require('../models/CycleReconciliation');
const CmsDailyRecord      = require('../models/CmsDailyRecord');
const DieselAlert         = require('../models/DieselAlert');
const DieselCycle         = require('../models/DieselCycle');
const SiteBudget          = require('../models/SiteBudget');
const FuelRequest         = require('../models/FuelRequest');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

const ROLES = ['diesel_manager', 'data_collector', 'admin', 'supervisor', 'finance', 'head_of_business', 'ceo', 'analyst', 'operations'];

// GET /api/diesel/dashboard/kpis/:cycle_key
//
// ⚠️ DUPLICATE-LOGIC WARNING (found via a real production bug — see
// routes/dashboard.js's matching handler for the full story): this exact
// route also exists in routes/dashboard.js, which is the file actually
// mounted at /api/dashboard — the path the frontend's dieselApi.ts client
// calls. THIS copy is only reachable via /api/diesel-recon/dashboard and
// /api/recon-dashboard, which nothing in the current frontend calls. The
// two copies already silently diverged once (this one had the
// FuelRequest aggregation; routes/dashboard.js's copy didn't, so the
// "Fuel Requests" dashboard panel showed 0/0/0/0 despite real data
// existing). If you change the logic here, change it in
// routes/dashboard.js too, or better: consolidate into one file.
router.get('/kpis/:cycle_key', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const ck = req.params.cycle_key;
  const [agg, alertSummary, cycle, budgetAgg, fuelReqAgg] = await Promise.all([
    CycleReconciliation.aggregate([
      { $match: { cycle_key: ck } },
      { $group: {
        _id: null,
        total_sites:           { $sum: 1 },
        total_budget_liters:   { $sum: '$budget_liters' },
        total_contractual:     { $sum: '$contractual_consumption' },
        total_cms_consumed:    { $sum: '$cms_consumption' },
        total_field_added:     { $sum: '$field_fuel_added' },
        total_final_rh:        { $sum: '$final_rh' },
        total_field_rh:        { $sum: '$field_rh' },
        total_tomcard:         { $sum: { $ifNull: ['$tomcard_purchased', 0] } },
        total_theft:           { $sum: '$theft_liters' },
        sites_over_ccph:       { $sum: { $cond: ['$alerts.consumption_over_ccph', 1, 0] } },
        sites_low_fuel:        { $sum: { $cond: ['$alerts.low_fuel', 1, 0] } },
        sites_zero_grid:       { $sum: { $cond: ['$alerts.zero_grid_24h', 1, 0] } },
        sites_missing_grato:   { $sum: { $cond: ['$alerts.missing_grato', 1, 0] } },
        sites_missing_cms:     { $sum: { $cond: ['$alerts.missing_cms', 1, 0] } },
        sites_theft_suspected: { $sum: { $cond: ['$alerts.theft_suspected', 1, 0] } },
        total_alerts:          { $sum: '$alert_count' },
        avg_cons_var_pct:      { $avg: { $ifNull: ['$cons_variance_pct', 0] } },
      }},
    ]),
    DieselAlert.aggregate([
      { $match: { cycle_key: ck, status: { $in: ['open', 'acknowledged'] } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    DieselCycle.findOne({ cycle_key: ck }).lean(),
    // SiteBudget: authoritative budget data (from Book11 upload)
    SiteBudget.aggregate([
      { $match: { cycle_key: ck } },
      { $group: {
        _id: '$cluster',
        sites:                    { $sum: 1 },
        budget_liters:            { $sum: '$budget_liters' },
        budget_xaf:               { $sum: '$budget_xaf' },
        liters_used:              { $sum: '$liters_used' },
        budget_liters_approved_ihs: { $sum: '$budget_liters_approved_ihs' },
      }},
    ]),
    // FuelRequest: approval chain stats
    FuelRequest.aggregate([
      { $match: { cycle_key: ck } },
      { $group: {
        _id: null,
        total_requests:  { $sum: 1 },
        pending:         { $sum: { $cond: [{ $regexMatch: { input: '$status', regex: /^pending_/ } }, 1, 0] } },
        approved:        { $sum: { $cond: [{ $in: ['$status', ['approved','scheduled','purchase_made','partially_refueled','refueled','completed']] }, 1, 0] } },
        disbursed:       { $sum: { $cond: [{ $ne: ['$disbursed_at', null] }, 1, 0] } },
        denied:          { $sum: { $cond: [{ $eq: ['$status', 'denied'] }, 1, 0] } },
        total_liters_approved:  { $sum: { $ifNull: ['$liters_approved', '$liters_requested'] } },
        total_xaf_approved:     { $sum: { $multiply: [{ $ifNull: ['$liters_approved', '$liters_requested'] }, 828] } },
        total_xaf_disbursed:    { $sum: { $ifNull: ['$disbursement.actual_xaf', 0] } },
      }},
    ]),
  ]);

  const kpis  = agg[0] || {};
  const alertsBySeverity = {};
  for (const a of alertSummary) alertsBySeverity[a._id] = a.count;

  // SiteBudget totals (authoritative — from Book11 import)
  const sbTotals = budgetAgg.reduce((acc, c) => {
    acc.budget_liters            += c.budget_liters || 0;
    acc.budget_xaf               += c.budget_xaf    || 0;
    acc.liters_used              += c.liters_used    || 0;
    acc.budget_liters_approved_ihs += c.budget_liters_approved_ihs || 0;
    return acc;
  }, { budget_liters: 0, budget_xaf: 0, liters_used: 0, budget_liters_approved_ihs: 0 });

  // Use SiteBudget as truth for budget_liters if reconciliation hasn't run yet
  const effective_budget_liters = sbTotals.budget_liters || kpis.total_budget_liters || 0;
  const fuelReq = fuelReqAgg[0] || {};

  res.json({
    success: true,
    data: {
      cycle,
      kpis: {
        ...kpis,
        // Authoritative budget from SiteBudget (Book11 import)
        total_budget_liters:        effective_budget_liters,
        total_budget_xaf:           sbTotals.budget_xaf,
        total_liters_used_requests: sbTotals.liters_used,
        budget_liters_approved_ihs: sbTotals.budget_liters_approved_ihs,
        // Utilisation: CMS consumed vs budget
        budget_utilisation_pct: effective_budget_liters > 0
          ? ((kpis.total_cms_consumed / effective_budget_liters) * 100).toFixed(1)
          : null,
        // Committed via approval chain vs budget
        fuel_request_committed_pct: effective_budget_liters > 0 && fuelReq.total_liters_approved
          ? ((fuelReq.total_liters_approved / effective_budget_liters) * 100).toFixed(1)
          : null,
        contractual_vs_cms_var: kpis.total_cms_consumed - kpis.total_contractual,
        // Fuel Request approval chain stats
        fuel_requests: {
          total:              fuelReq.total_requests   || 0,
          pending:            fuelReq.pending          || 0,
          approved:           fuelReq.approved         || 0,
          disbursed:          fuelReq.disbursed        || 0,
          denied:             fuelReq.denied           || 0,
          total_liters_approved: fuelReq.total_liters_approved || 0,
          total_xaf_approved:    fuelReq.total_xaf_approved    || 0,
          total_xaf_disbursed:   fuelReq.total_xaf_disbursed   || 0,
        },
        // Budget by cluster (from SiteBudget)
        budget_by_cluster: budgetAgg,
      },
      alerts_by_severity: alertsBySeverity,
      open_alerts_total: Object.values(alertsBySeverity).reduce((a, b) => a + b, 0),
    },
  });
}));

// GET /api/diesel/dashboard/cluster-heatmap/:cycle_key
router.get('/cluster-heatmap/:cycle_key', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const clusters = await CycleReconciliation.getClusterSummary(req.params.cycle_key);
  res.json({ success: true, data: clusters });
}));

// GET /api/diesel/dashboard/daily-trend/:cycle_key
router.get('/daily-trend/:cycle_key', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const cycle = await DieselCycle.findOne({ cycle_key: req.params.cycle_key }).lean();
  if (!cycle) return res.status(404).json({ success: false, message: 'Cycle not found' });

  const trend = await CmsDailyRecord.aggregate([
    { $match: { cycle_key: req.params.cycle_key } },
    { $group: {
      _id:           '$record_date',
      total_gen_rh:  { $sum: '$gen_rh' },
      total_consumed: { $sum: '$fuel_consumption_without_drop' },
      total_refuel:  { $sum: '$refuel_l' },
      total_grid_h:  { $sum: '$grid_availability_hr' },
      sites_count:   { $sum: 1 },
      zero_grid_sites: { $sum: { $cond: ['$zero_grid_flag', 1, 0] } },
    }},
    { $sort: { _id: 1 } },
    { $project: {
      date:          '$_id',
      total_gen_rh:  1, total_consumed: 1, total_refuel: 1,
      total_grid_h:  1, sites_count: 1, zero_grid_sites: 1,
    }},
  ]);

  res.json({ success: true, data: trend });
}));

// GET /api/diesel/dashboard/low-fuel — Sites with low fuel right now
router.get('/low-fuel', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const { threshold_l = 500 } = req.query;
  const latest = await CmsDailyRecord.aggregate([
    { $sort: { record_date: -1 } },
    { $group: { _id: '$site_id', latest: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$latest' } },
    { $match: { fuel_level_l: { $lt: +threshold_l, $gt: 0 } } },
    { $sort: { fuel_level_l: 1 } },
    { $limit: 50 },
  ]);
  res.json({ success: true, data: latest, count: latest.length });
}));

// GET /api/diesel/dashboard/zero-grid — Sites with consecutive zero grid hours
router.get('/zero-grid', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const sites = await CmsDailyRecord.getZeroGridAlerts();
  res.json({ success: true, data: sites, count: sites.length });
}));

// GET /api/diesel/dashboard/cycles — List all cycles for selector
router.get('/cycles', authenticateToken, asyncHandler(async (req, res) => {
  const cycles = await DieselCycle.find().sort({ start_date: -1 }).limit(24).lean();
  res.json({ success: true, data: cycles });
}));

module.exports = router;

