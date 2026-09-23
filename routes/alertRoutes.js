/**
 * alertRoutes.js
 */
const express = require('express');
const router  = express.Router();
const DieselAlert  = require('../models/DieselAlert');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

const ROLES = ['diesel_manager', 'data_collector', 'admin', 'supervisor'];

router.get('/', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const { type, severity, cycle_key, cluster, status = 'open', page = 1, limit = 50 } = req.query;
  const filter = {};
  if (status)    filter.status     = status === 'all' ? { $exists: true } : { $in: status.split(',') };
  if (type)      filter.alert_type = type;
  if (severity)  filter.severity   = severity;
  if (cycle_key) filter.cycle_key  = cycle_key;
  if (cluster)   filter.cluster    = cluster;

  const [alerts, total] = await Promise.all([
    DieselAlert.find(filter).sort({ severity: 1, createdAt: -1 }).skip((page - 1) * limit).limit(+limit).lean(),
    DieselAlert.countDocuments(filter),
  ]);
  res.json({ success: true, data: alerts, pagination: { page: +page, limit: +limit, total } });
}));

router.get('/unread-count', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.userId;
  const count  = await DieselAlert.getUnreadCount(userId);
  res.json({ success: true, data: { count } });
}));

router.patch('/:id/acknowledge', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const userId  = req.user._id || req.user.userId;
  const updated = await DieselAlert.findByIdAndUpdate(req.params.id,
    { $set: { status: 'acknowledged', acknowledged_by: userId, acknowledged_at: new Date() } },
    { new: true });
  if (!updated) return res.status(404).json({ success: false, message: 'Alert not found' });
  res.json({ success: true, data: updated });
}));

router.patch('/:id/resolve', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const userId  = req.user._id || req.user.userId;
  const updated = await DieselAlert.findByIdAndUpdate(req.params.id,
    { $set: { status: 'resolved', resolved_by: userId, resolved_at: new Date(), resolution_note: req.body.resolution_note || '' } },
    { new: true });
  if (!updated) return res.status(404).json({ success: false, message: 'Alert not found' });
  res.json({ success: true, data: updated });
}));

router.patch('/read-all', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.userId;
  await DieselAlert.updateMany({ read_by: { $ne: userId } }, { $addToSet: { read_by: userId } });
  res.json({ success: true, message: 'All alerts marked as read' });
}));

router.patch('/:id/read', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.userId;
  await DieselAlert.findByIdAndUpdate(req.params.id, { $addToSet: { read_by: userId } });
  res.json({ success: true });
}));

module.exports = router;