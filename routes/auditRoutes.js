/**
 * auditRoutes.js
 * PowerGen_API/routes/auditRoutes.js
 * MOUNT: app.use('/api/audit', require('./routes/auditRoutes'));
 */
'use strict';
const express  = require('express');
const router   = express.Router();
const AuditLog = require('../models/AuditLog');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

const AUDIT_ROLES = ['admin', 'finance', 'head_of_business', 'ceo'];

// GET /api/audit — paginated audit log
router.get('/', authenticateToken, requireRole(AUDIT_ROLES), async (req, res) => {
  try {
    const { entity_type, entity_id, actor_id, cycle_key, action, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (entity_type) filter.entity_type = entity_type;
    if (entity_id)   filter.entity_id   = entity_id;
    if (actor_id)    filter.actor_id    = actor_id;
    if (cycle_key)   filter.cycle_key   = cycle_key;
    if (action)      filter.action      = { $regex: action, $options: 'i' };

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ created_at: -1 }).skip((+page - 1) * +limit).limit(+limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ success: true, data: logs, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/audit/entity/:type/:id — full trail for one entity
router.get('/entity/:type/:id', authenticateToken, requireRole(AUDIT_ROLES), async (req, res) => {
  try {
    const logs = await AuditLog.find({ entity_type: req.params.type, entity_id: req.params.id }).sort({ created_at: 1 }).lean();
    res.json({ success: true, data: logs, count: logs.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
