const express = require('express');
const router  = express.Router();
const CycleReconciliation  = require('../models/CycleReconciliation');
const DieselCycle          = require('../models/DieselCycle');
const { runForCycle }      = require('../services/reconciliationService');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

const ROLES = ['diesel_manager', 'data_collector', 'admin', 'supervisor'];

// ── IMPORTANT: static paths MUST be declared before dynamic /:cycle_key ──────
// Express matches routes in registration order. If /:cycle_key comes first,
// it swallows paths like /cluster/..., /run/..., /alerts/... as cycle_key values.

// GET /api/diesel-recon/reconciliation/cluster/:cycle_key
router.get('/cluster/:cycle_key',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const summary = await CycleReconciliation.getClusterSummary(req.params.cycle_key);
    res.json({ success: true, data: summary });
  })
);

// GET /api/diesel-recon/reconciliation/alerts/summary/:cycle_key
router.get('/alerts/summary/:cycle_key',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const summary = await CycleReconciliation.getAlertSummary(req.params.cycle_key);
    res.json({ success: true, data: summary[0] || {} });
  })
);

// POST /api/diesel-recon/reconciliation/run/:cycle_key — Manual trigger
router.post('/run/:cycle_key',
  authenticateToken, requireRole(['admin', 'diesel_manager']),
  asyncHandler(async (req, res) => {
    const { site_id } = req.body;
    const start = Date.now();
    const result = await runForCycle(req.params.cycle_key, site_id || null);
    res.json({ success: true, message: 'Reconciliation completed', data: result, ms: Date.now() - start });
  })
);

// GET /api/diesel-recon/reconciliation/current — convenience: resolve current cycle then redirect
router.get('/current',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const cycle = await DieselCycle.getOrCreateCurrent();
    // Return the cycle_key so the frontend can use it to call /:cycle_key
    res.json({ success: true, data: { cycle_key: cycle.cycle_key, cycle } });
  })
);

// GET /api/diesel-recon/reconciliation/:cycle_key — All sites for a cycle
// Guard: cycle_key must look like YYYY-MM, not an empty string or a static keyword
router.get('/:cycle_key',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const { cycle_key } = req.params;

    // Reject empty, too-short, or obviously wrong cycle_key values
    if (!cycle_key || cycle_key.length < 6 || !/^\d{4}-\d{2}$/.test(cycle_key)) {
      return res.status(400).json({
        success: false,
        message: `Invalid cycle_key "${cycle_key}". Expected format: YYYY-MM (e.g. "2026-06")`,
        hint: 'Call GET /api/diesel-recon/cycles/current first to get the current cycle key.',
      });
    }

    const {
      cluster, alert_type, cons_status,
      page = 1, limit = 100,
      sort = 'alert_count', order = 'desc',
    } = req.query;

    const filter = { cycle_key };
    if (cluster)     filter.cluster     = cluster;
    if (cons_status) filter.cons_status = cons_status;
    if (alert_type)  filter[`alerts.${alert_type}`] = true;

    const sortObj = { [sort]: order === 'desc' ? -1 : 1 };

    const [data, total, agg] = await Promise.all([
      CycleReconciliation.find(filter)
        .sort(sortObj)
        .skip((page - 1) * limit)
        .limit(+limit)
        .populate('reviewed_by', 'fullName email')
        .lean(),
      CycleReconciliation.countDocuments(filter),
      CycleReconciliation.aggregate([
        { $match: { cycle_key } },
        { $group: {
          _id: null,
          total_sites:         { $sum: 1 },
          total_budget:        { $sum: '$budget_liters' },
          total_contractual:   { $sum: '$contractual_consumption' },
          total_cms_consumed:  { $sum: '$cms_consumption' },
          total_field_added:   { $sum: '$field_fuel_added' },
          total_field_rh:      { $sum: '$final_rh' },
          total_alerts:        { $sum: '$alert_count' },
          sites_over_ccph:     { $sum: { $cond: ['$alerts.consumption_over_ccph', 1, 0] } },
          sites_low_fuel:      { $sum: { $cond: ['$alerts.low_fuel', 1, 0] } },
          sites_theft:         { $sum: { $cond: ['$alerts.theft_suspected', 1, 0] } },
          sites_missing_grato: { $sum: { $cond: ['$alerts.missing_grato', 1, 0] } },
          sites_missing_cms:   { $sum: { $cond: ['$alerts.missing_cms', 1, 0] } },
          sites_zero_grid:     { $sum: { $cond: ['$alerts.zero_grid_24h', 1, 0] } },
        }},
      ]),
    ]);

    res.json({
      success: true,
      data,
      summary: agg[0] || {},
      pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) },
    });
  })
);

// GET /api/diesel-recon/reconciliation/:cycle_key/site/:site_id — Single site
router.get('/:cycle_key/site/:site_id',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const recon = await CycleReconciliation.findOne({
      cycle_key: req.params.cycle_key,
      site_id:   req.params.site_id,
    }).populate('reviewed_by', 'fullName email').lean();
    if (!recon) {
      return res.status(404).json({
        success: false,
        message: `No reconciliation data for site ${req.params.site_id} in cycle ${req.params.cycle_key}`,
      });
    }
    res.json({ success: true, data: recon });
  })
);

// PATCH /api/diesel-recon/reconciliation/:cycle_key/site/:site_id/override
router.patch('/:cycle_key/site/:site_id/override',
  authenticateToken, requireRole(['admin']),
  asyncHandler(async (req, res) => {
    const { override_notes } = req.body;
    const updated = await CycleReconciliation.findOneAndUpdate(
      { cycle_key: req.params.cycle_key, site_id: req.params.site_id },
      { $set: {
        override_notes,
        is_manually_reviewed: true,
        reviewed_by: req.user._id || req.user.userId,
        reviewed_at: new Date(),
      }},
      { new: true }
    ).populate('reviewed_by', 'fullName email');
    if (!updated) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, message: 'Override saved', data: updated });
  })
);

module.exports = router;

