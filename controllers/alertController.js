const Alert = require('../models/Alert');
const Generator = require('../models/Generator');

// @desc    Get all alerts
// @route   GET /api/alerts
// @access  Public
exports.getAllAlerts = async (req, res) => {
  try {
    const { resolved, type, tower, generator } = req.query;
    const filter = {};
    
    if (resolved) filter.resolved = resolved === 'true';
    if (type) filter.type = type;
    if (tower) filter.tower_id = tower;
    if (generator) filter.generator_id = generator;

    const alerts = await Alert.find(filter)
      .populate('generator_id', 'model')
      .populate('tower_id', 'name')
      .sort({ timestamp: -1 })
      .lean();

    res.json(alerts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Resolve alert
// @route   PATCH /api/alerts/:id/resolve
// @access  Private/Admin
exports.resolveAlert = async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { 
        resolved: true,
        resolved_at: new Date(),
        resolved_by: req.user.id 
      },
      { new: true }
    );

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json(alert);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Get unresolved alerts count
// @route   GET /api/alerts/count
// @access  Public
exports.getAlertCounts = async (req, res) => {
  try {
    const counts = await Alert.aggregate([
      {
        $match: { resolved: false }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = counts.reduce((sum, item) => sum + item.count, 0);

    res.json({
      total,
      by_type: counts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};