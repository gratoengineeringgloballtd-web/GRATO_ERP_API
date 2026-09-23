/**
 * siteBudgetRoutes.js — standalone, self-contained
 */
'use strict';
const express        = require('express');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler   = require('express-async-handler');
const SiteBudget     = require('../models/SiteBudget');
const r3             = express.Router();
 
// ── Aggregate totals per cluster for a cycle ─────────────────────────────────
// GET /api/site-budget/:cycle_key/aggregate
// Returns { totals: { total_budget_liters, total_liters_used, ... }, by_cluster: [...] }
// Used by: TomCardPage, DieselDashboardPage, ReportsPage
r3.get('/:cycle_key/aggregate', authenticateToken, asyncHandler(async (req, res) => {
  const { cycle_key } = req.params;
  const { cluster }   = req.query;
  const match = { cycle_key };
  if (cluster) match.cluster = cluster;

  const agg = await SiteBudget.aggregate([
    { $match: match },
    { $group: {
      _id:                '$cluster',
      sites:              { $sum: 1 },
      budget_liters:      { $sum: { $ifNull: ['$budget_liters', 0] } },
      budget_xaf:         { $sum: { $ifNull: ['$budget_xaf', 0] } },
      liters_used:        { $sum: { $ifNull: ['$liters_used', 0] } },
      liters_committed:   { $sum: { $ifNull: ['$liters_committed', 0] } },
      deficit_liters:     { $sum: { $ifNull: ['$deficit_liters', 0] } },
    }},
    { $addFields: {
      liters_remaining:   { $max: [{ $subtract: ['$budget_liters', '$liters_used'] }, 0] },
      utilisation_pct:    { $cond: [{ $gt: ['$budget_liters', 0] },
                            { $round: [{ $multiply: [{ $divide: ['$liters_used', '$budget_liters'] }, 100] }, 1] }, 0] },
    }},
    { $sort: { _id: 1 } },
  ]);

  const totals = agg.reduce((acc, c) => {
    acc.total_budget_liters  += c.budget_liters   || 0;
    acc.total_budget_xaf     += c.budget_xaf      || 0;
    acc.total_liters_used    += c.liters_used     || 0;
    acc.total_liters_remaining += c.liters_remaining || 0;
    acc.total_deficit_liters += c.deficit_liters  || 0;
    acc.total_sites          += c.sites           || 0;
    return acc;
  }, { total_budget_liters:0, total_budget_xaf:0, total_liters_used:0, total_liters_remaining:0, total_deficit_liters:0, total_sites:0 });

  totals.overall_utilisation_pct = totals.total_budget_liters > 0
    ? Math.round((totals.total_liters_used / totals.total_budget_liters) * 100) : 0;

  res.json({ success: true, data: { cycle_key, totals, by_cluster: agg } });
}));


// ── Per-site utilisation summary ──────────────────────────────────────────────
// GET /api/site-budget/:cycle_key/utilisation
// Returns array of sites with alert_level (exhausted/critical/high/ok)
// Used by: ScheduledPage budget banner, FuelPlanningService
r3.get('/:cycle_key/utilisation', authenticateToken, asyncHandler(async (req, res) => {
  const { cycle_key } = req.params;
  const { cluster }   = req.query;
  const match = { cycle_key };
  if (cluster) match.cluster = cluster;

  const budgets = await SiteBudget.find(match).lean();
  const result  = budgets.map(b => {
    const remaining = Math.max(0, (b.budget_liters || 0) - (b.liters_used || 0));
    const pct       = b.budget_liters > 0 ? Math.round((b.liters_used || 0) / b.budget_liters * 100) : 0;
    const alert_level = remaining <= 0 ? 'exhausted'
                      : pct >= 90      ? 'critical'
                      : pct >= 75      ? 'high'
                      : 'ok';
    return {
      site_id:          b.site_id,
      site_name:        b.site_name || b.site_id,
      cluster:          b.cluster,
      budget_liters:    b.budget_liters || 0,
      liters_used:      b.liters_used   || 0,
      liters_remaining: remaining,
      utilisation_pct:  pct,
      in_deficit:       b.in_deficit || false,
      deficit_liters:   b.deficit_liters || 0,
      alert_level,
    };
  });

  res.json({ success: true, data: result, count: result.length });
}));


r3.get('/:cycle_key', authenticateToken, asyncHandler(async (req, res) => {
  const { cluster } = req.query;
  const filter = { cycle_key: req.params.cycle_key };
  if (cluster) filter.cluster = cluster;
  const budgets = await SiteBudget.find(filter).sort({ cluster: 1, site_id: 1 }).lean();
  res.json({ success: true, data: budgets, count: budgets.length });
}));
 
r3.get('/:cycle_key/:site_id', authenticateToken, asyncHandler(async (req, res) => {
  const budget = await SiteBudget.findOne({ cycle_key: req.params.cycle_key, site_id: req.params.site_id }).lean();
  if (!budget) return res.status(404).json({ success: false, message: 'Budget not found' });
  res.json({ success: true, data: budget });
}));
 
r3.patch('/:cycle_key/:site_id', authenticateToken, requireRole(['admin']), asyncHandler(async (req, res) => {
  const updated = await SiteBudget.findOneAndUpdate(
    { cycle_key: req.params.cycle_key, site_id: req.params.site_id },
    { $set: { ...req.body, imported_by: req.user._id || req.user.userId } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ success: false, message: 'Budget not found' });
  res.json({ success: true, data: updated });
}));
 

module.exports = r3;