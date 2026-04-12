const Maintenance = require('../models/Maintenance');
const Generator = require('../models/Generator');

// @desc    Get all maintenance records
// @route   GET /api/maintenance
// @access  Public
exports.getAllMaintenance = async (req, res) => {
  try {
    const { generator, tower, completed } = req.query;
    const filter = {};
    
    if (generator) filter.generator_id = generator;
    if (tower) filter.tower_id = tower;
    if (completed) filter.completed = completed === 'true';

    const maintenance = await Maintenance.find(filter)
      .populate('generator_id', 'model')
      .populate('tower_id', 'name')
      .sort({ date: -1 })
      .lean();

    res.json(maintenance);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Get generator maintenance history
// @route   GET /api/maintenance/generator/:id
// @access  Public
exports.getGeneratorMaintenance = async (req, res) => {
  try {
    const maintenance = await Maintenance.find({ generator_id: req.params.id })
      .sort({ date: -1 })
      .lean();

    res.json(maintenance);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Create maintenance record
// @route   POST /api/maintenance
// @access  Private/Admin
exports.createMaintenance = async (req, res) => {
  try {
    // Verify generator exists
    const generator = await Generator.findById(req.body.generator_id);
    if (!generator) {
      return res.status(400).json({ error: 'Generator not found' });
    }

    const maintenance = new Maintenance({
      ...req.body,
      date: req.body.date || new Date()
    });

    await maintenance.save();

    // Update generator's last maintenance if completed
    if (maintenance.completed) {
      generator.last_maintenance = maintenance.date;
      generator.maintenance_history.push(maintenance._id);
      await generator.save();
    }

    res.status(201).json(maintenance);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Update maintenance record
// @route   PUT /api/maintenance/:id
// @access  Private/Admin
exports.updateMaintenance = async (req, res) => {
  try {
    const maintenance = await Maintenance.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!maintenance) {
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    // Update generator's last maintenance if completed
    if (maintenance.completed) {
      await Generator.findByIdAndUpdate(
        maintenance.generator_id,
        { 
          last_maintenance: maintenance.date,
          $addToSet: { maintenance_history: maintenance._id }
        }
      );
    }

    res.json(maintenance);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};