/**
 * reportRoutes.js
 */
const express = require('express');
const r1      = express.Router();
const { generateCycleReport, generateTomCardReport, generateSiteReport, streamToResponse } = require('../services/reportService');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');
const ROLES = ['diesel_manager', 'data_collector', 'admin'];

r1.get('/cycle/:cycle_key/excel', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const wb = await generateCycleReport(req.params.cycle_key);
  await streamToResponse(wb, res, `Cycle_Report_${req.params.cycle_key}.xlsx`);
}));

r1.get('/site/:site_id/:cycle_key/excel', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const wb = await generateSiteReport(req.params.site_id, req.params.cycle_key);
  await streamToResponse(wb, res, `Site_${req.params.site_id}_${req.params.cycle_key}.xlsx`);
}));

r1.get('/tomcard/:cycle_key/excel', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const wb = await generateTomCardReport(req.params.cycle_key);
  await streamToResponse(wb, res, `TomCard_${req.params.cycle_key}.xlsx`);
}));

module.exports = { reportRoutes: r1 };



// ─────────────────────────────────────────────────────────────────────────────

/**
 * generatorLedgerRoutes.js
 */
const r2 = express.Router();
const GeneratorAssignmentLedger = require('../models/GeneratorAssignmentLedger');
const { assignGenerator, swapGenerator, getSiteHistory } = require('../services/generatorSwapService');

r2.get('/', authenticateToken, requireRole(['diesel_manager', 'supervisor', 'admin']), asyncHandler(async (req, res) => {
  const { site_id, is_active } = req.query;
  const filter = {};
  if (site_id)   filter.site_id  = site_id;
  if (is_active) filter.is_active = is_active === 'true';
  const entries = await GeneratorAssignmentLedger.find(filter)
    .sort({ assigned_at: -1 }).limit(200)
    .populate('recorded_by', 'fullName').populate('removed_by', 'fullName').lean();
  res.json({ success: true, data: entries });
}));

r2.get('/site/:site_id', authenticateToken, asyncHandler(async (req, res) => {
  const history = await getSiteHistory(req.params.site_id);
  res.json({ success: true, data: history });
}));

r2.post('/assign', authenticateToken, requireRole(['supervisor', 'admin']), asyncHandler(async (req, res) => {
  const entry = await assignGenerator({ ...req.body, recorded_by: req.user._id || req.user.userId });
  res.status(201).json({ success: true, message: 'Generator assigned', data: entry });
}));

r2.post('/swap', authenticateToken, requireRole(['supervisor', 'admin']), asyncHandler(async (req, res) => {
  const result = await swapGenerator({ ...req.body, recorded_by: req.user._id || req.user.userId });
  res.status(201).json({ success: true, message: 'Generator swap recorded', data: result });
}));

module.exports.generatorLedgerRoutes = r2;



// ─────────────────────────────────────────────────────────────────────────────

/**
 * siteBudgetRoutes.js
 */
const r3    = express.Router();
const SiteBudget = require('../models/SiteBudget');

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

module.exports.siteBudgetRoutes = r3;



// ─────────────────────────────────────────────────────────────────────────────

/**
 * fieldVisitRoutes.js
 */
const r4 = express.Router();
const FieldVisitRecord = require('../models/FieldVisitRecord');

r4.get('/cycle/:cycle_key', authenticateToken, asyncHandler(async (req, res) => {
  const { cluster, faulty_meter, page = 1, limit = 100 } = req.query;
  const filter = { cycle_key: req.params.cycle_key };
  if (cluster)             filter.cluster = cluster;
  if (faulty_meter === 'true') filter.meter_is_faulty = true;
  const [visits, total] = await Promise.all([
    FieldVisitRecord.find(filter).sort({ site_id: 1, current_visit_date: -1 }).skip((page - 1) * limit).limit(+limit).lean(),
    FieldVisitRecord.countDocuments(filter),
  ]);
  res.json({ success: true, data: visits, pagination: { page: +page, limit: +limit, total } });
}));

r4.get('/site/:site_id', authenticateToken, asyncHandler(async (req, res) => {
  const { cycle_key } = req.query;
  const filter = { site_id: req.params.site_id };
  if (cycle_key) filter.cycle_key = cycle_key;
  const visits = await FieldVisitRecord.find(filter).sort({ current_visit_date: -1 }).limit(50).lean();
  res.json({ success: true, data: visits });
}));

r4.patch('/:id/override', authenticateToken, requireRole(['admin']), asyncHandler(async (req, res) => {
  const updated = await FieldVisitRecord.findByIdAndUpdate(req.params.id,
    { $set: { ...req.body, reconciliation_status: 'overridden' } }, { new: true });
  if (!updated) return res.status(404).json({ success: false, message: 'Visit record not found' });
  res.json({ success: true, data: updated });
}));

module.exports.fieldVisitRoutes = r4;


// ─────────────────────────────────────────────────────────────────────────────

/**
 * dieselCycleRoutes.js
 */
const r5 = express.Router();
const DieselCycle = require('../models/DieselCycle');

r5.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const cycles = await DieselCycle.find().sort({ start_date: -1 }).lean();
  res.json({ success: true, data: cycles });
}));

r5.get('/current', authenticateToken, asyncHandler(async (req, res) => {
  const cycle = await DieselCycle.getOrCreateCurrent();
  res.json({ success: true, data: cycle });
}));

r5.post('/', authenticateToken, requireRole(['admin']), asyncHandler(async (req, res) => {
  const { cycle_key, label, start_date, end_date } = req.body;
  const days = Math.round((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1;
  const cycle = await DieselCycle.create({ cycle_key, label, start_date, end_date, days_in_cycle: days });
  res.status(201).json({ success: true, data: cycle });
}));

r5.patch('/:cycle_key/close', authenticateToken, requireRole(['admin']), asyncHandler(async (req, res) => {
  const updated = await DieselCycle.findOneAndUpdate(
    { cycle_key: req.params.cycle_key },
    { $set: { status: 'closed', closed_by: req.user._id || req.user.userId, closed_at: new Date(), notes: req.body.notes || '' } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ success: false, message: 'Cycle not found' });
  res.json({ success: true, data: updated });
}));

module.exports.dieselCycleRoutes = r5;



// ─────────────────────────────────────────────────────────────────────────────

/**
 * notificationRoutes.js — in-app notification feed
 */
const r6 = express.Router();

r6.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.userId;
  const { page = 1, limit = 30 } = req.query;
  const [alerts, unread] = await Promise.all([
    require('../models/DieselAlert').find({ status: { $in: ['open', 'acknowledged'] } })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(+limit).lean(),
    require('../models/DieselAlert').getUnreadCount(userId),
  ]);
  res.json({ success: true, data: alerts, unread_count: unread, pagination: { page: +page, limit: +limit } });
}));

r6.delete('/:id', authenticateToken, requireRole(['admin']), asyncHandler(async (req, res) => {
  await require('../models/DieselAlert').findByIdAndUpdate(req.params.id, { $set: { status: 'dismissed' } });
  res.json({ success: true, message: 'Alert dismissed' });
}));

module.exports.notificationRoutes = r6;









