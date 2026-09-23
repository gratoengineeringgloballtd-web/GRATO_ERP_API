const Generator = require('../models/Generator');
const Tower = require('../models/Tower');
const Telemetry = require('../models/Telemetry');
const Alert = require('../models/Alert');

// @desc    Get all generators
// @route   GET /api/generators
// @access  Public
exports.getAllGenerators = async (req, res) => {
  try {
    const { status, tower, fuel_lt } = req.query;
    const filter = {};
    
    if (status) filter.status = status;
    if (tower) filter.tower_id = tower;
    if (fuel_lt) filter['current_stats.fuel'] = { $lt: Number(fuel_lt) };

    const generators = await Generator.find(filter)
      .populate('tower_id', 'name location.address')
      .sort({ 'current_stats.fuel': 1 })
      .lean();

    res.json(generators);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Get single generator
// @route   GET /api/generators/:id
// @access  Public
exports.getGenerator = async (req, res) => {
  try {
    const generator = await Generator.findById(req.params.id)
      .populate('tower_id', 'name location')
      .populate('maintenance_history')
      .lean();

    if (!generator) {
      return res.status(404).json({ error: 'Generator not found' });
    }

    // Get last 24 hours telemetry
    const telemetry = await Telemetry.find({
      'metadata.generator_id': req.params.id,
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
    .sort({ timestamp: 1 })
    .select('timestamp fuel_level power_output temperature status')
    .lean();

    res.json({ 
      ...generator, 
      telemetry: telemetry.slice(-100) // Limit to last 100 readings
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};


// @desc    Get all generators
// @route   GET /api/generators
// @access  Public
exports.getAllGenerators = async (req, res) => {
  try {
    const { status, tower, fuel_lt } = req.query;
    const filter = {};
    
    if (status) filter.status = status;
    if (tower) filter.tower_id = tower;
    if (fuel_lt) filter['current_stats.fuel'] = { $lt: Number(fuel_lt) };

    const generators = await Generator.find(filter)
      .populate('tower_id', 'name location.address')
      .sort({ 'current_stats.fuel': 1 })
      .lean();

    res.json(generators);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Create generator
// @route   POST /api/generators
// @access  Private/Admin
exports.createGenerator = async (req, res) => {
  try {
    // Verify tower exists
    const tower = await Tower.findById(req.body.tower_id);
    if (!tower) {
      return res.status(400).json({ error: 'Tower not found' });
    }

    const generator = new Generator(req.body);
    await generator.save();

    // Add to tower's generators array
    await Tower.findByIdAndUpdate(
      req.body.tower_id,
      { $addToSet: { generators: generator._id } }
    );

    res.status(201).json(generator);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Update generator
// @route   PUT /api/generators/:id
// @access  Private/Admin
exports.updateGenerator = async (req, res) => {
  try {
    const generator = await Generator.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!generator) {
      return res.status(404).json({ error: 'Generator not found' });
    }

    res.json(generator);
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Update generator status
// @route   PATCH /api/generators/:id/status
// @access  Private/Admin
exports.updateGeneratorStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['running', 'standby', 'fault', 'maintenance'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const generator = await Generator.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!generator) {
      return res.status(404).json({ error: 'Generator not found' });
    }

    // Resolve any active alerts if status is changed to running
    if (status === 'running') {
      await Alert.resolveAlerts(generator._id, req.user.id);
    }

    res.json(generator);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Delete generator
// @route   DELETE /api/generators/:id
// @access  Private/Admin
exports.deleteGenerator = async (req, res) => {
  try {
    const generator = await Generator.findById(req.params.id);

    if (!generator) {
      return res.status(404).json({ error: 'Generator not found' });
    }

    // Remove from tower's generators array
    await Tower.findByIdAndUpdate(
      generator.tower_id,
      { $pull: { generators: generator._id } }
    );

    await generator.remove();
    res.json({ message: 'Generator removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};