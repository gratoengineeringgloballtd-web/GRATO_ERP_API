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