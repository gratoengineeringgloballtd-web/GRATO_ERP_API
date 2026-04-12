const Generator = require('../models/Generator');
const Tower = require('../models/Tower');
const Alert = require('../models/Alert');

// @desc    Get system statistics
// @route   GET /api/stats
// @access  Public
exports.getSystemStats = async (req, res) => {
  try {
    const [towerCount, generatorCount, activeGenerators, alerts] = await Promise.all([
      Tower.countDocuments(),
      Generator.countDocuments(),
      Generator.countDocuments({ status: 'running' }),
      Alert.countDocuments({ resolved: false })
    ]);

    // Get fuel efficiency (mock calculation)
    const generators = await Generator.find().select('current_stats.fuel').lean();
    const avgFuelEfficiency = generators.reduce((sum, gen) => sum + gen.current_stats.fuel, 0) / 
                            (generators.length || 1);

    res.json({
      towers: towerCount,
      generators: generatorCount,
      active_generators: activeGenerators,
      alerts: alerts,
      avg_fuel_efficiency: avgFuelEfficiency.toFixed(1),
      maintenance_due: Math.floor(generatorCount * 0.2) 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// @desc    Get tower statistics
// @route   GET /api/stats/towers
// @access  Public
exports.getTowerStats = async (req, res) => {
  try {
    const stats = await Tower.aggregate([
      {
        $lookup: {
          from: 'generators',
          localField: 'generators',
          foreignField: '_id',
          as: 'generator_details'
        }
      },
      {
        $project: {
          name: 1,
          status: 1,
          location: 1,
          generator_count: { $size: '$generator_details' },
          active_generators: {
            $size: {
              $filter: {
                input: '$generator_details',
                as: 'gen',
                cond: { $eq: ['$$gen.status', 'running'] }
              }
            }
          },
          avg_fuel: { $avg: '$generator_details.current_stats.fuel' }
        }
      },
      {
        $sort: { active_generators: -1 }
      }
    ]);

    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};