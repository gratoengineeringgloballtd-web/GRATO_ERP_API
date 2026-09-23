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