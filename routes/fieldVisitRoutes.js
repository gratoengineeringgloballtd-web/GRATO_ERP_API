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