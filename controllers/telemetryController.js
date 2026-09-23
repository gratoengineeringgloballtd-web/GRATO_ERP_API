const Telemetry = require('../models/Telemetry');
const Generator = require('../models/Generator');
const Alert = require('../models/Alert');

// @desc    Submit telemetry data
// @route   POST /api/telemetry
// @access  Private (IoT Devices)
exports.submitTelemetry = async (req, res) => {
  try {
    const { generator_id, tower_id, status, runtime, shutdown_reason, ...data } = req.body;

    // Verify generator exists
    const generator = await Generator.findById(generator_id);
    if (!generator) {
      return res.status(400).json({ error: 'Generator not found' });
    }

    // Calculate runtime increment (if generator was running)
    const runtimeIncrement = status === 'running' ? 5 : 0; // Assuming data is sent every 5 seconds

     // Create telemetry record
     const telemetry = new Telemetry({
      metadata: { generator_id, tower_id },
      status,
      runtime: runtime || generator.current_stats.runtime + runtimeIncrement,
      shutdown_reason: status === 'shutdown' ? shutdown_reason || 'unknown' : null,
      ...data,
      timestamp: new Date()
    });

    await telemetry.save();

    // Update generator current stats
    generator.current_stats = {
      fuel: data.fuel_level,
      power: data.power_output,
      temp: data.temperature,
      runtime: telemetry.runtime
    };
    generator.status = status;
    await generator.save();

    // Create alerts if needed
    if (data.fuel_level < 20) {
      await createAlert(generator_id, tower_id, 'low_fuel', {
        fuel_level: data.fuel_level
      });
    }

    if (data.temperature > 85) {
      await createAlert(generator_id, tower_id, 'overheating', {
        temperature: data.temperature
      });
    }

    res.status(201).json(telemetry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Get generator telemetry
// @route   GET /api/telemetry/generator/:id
// @access  Public
exports.getGeneratorTelemetry = async (req, res) => {
  try {
    const { start, end, limit = 100 } = req.query;
    
    const filter = {
      'metadata.generator_id': req.params.id
    };

    if (start && end) {
      filter.timestamp = {
        $gte: new Date(start),
        $lte: new Date(end)
      };
    }

    const telemetry = await Telemetry.find(filter)
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .lean();

    res.json(telemetry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Get tower telemetry
// @route   GET /api/telemetry/tower/:id
// @access  Public
exports.getTowerTelemetry = async (req, res) => {
  try {
    const { period = '24h' } = req.query;
    let timeFilter;

    switch (period) {
      case '1h':
        timeFilter = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case '24h':
        timeFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        timeFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        timeFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const telemetry = await Telemetry.aggregate([
      {
        $match: {
          'metadata.tower_id': req.params.id,
          timestamp: { $gte: timeFilter }
        }
      },
      {
        $group: {
          _id: {
            generator_id: '$metadata.generator_id',
            hour: { $hour: '$timestamp' },
            day: { $dayOfMonth: '$timestamp' }
          },
          avg_fuel: { $avg: '$fuel_level' },
          avg_power: { $avg: '$power_output' },
          avg_temp: { $avg: '$temperature' }
        }
      },
      {
        $sort: { '_id.day': 1, '_id.hour': 1 }
      }
    ]);

    res.json(telemetry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Helper function to create alerts
async function createAlert(generatorId, towerId, type, data) {
  const existingAlert = await Alert.findOne({
    generator_id: generatorId,
    type,
    resolved: false
  });

  if (!existingAlert) {
    const alert = new Alert({
      generator_id: generatorId,
      tower_id: towerId,
      type,
      severity: type === 'low_fuel' ? 'warning' : 'critical',
      data
    });
    await alert.save();
  }
}