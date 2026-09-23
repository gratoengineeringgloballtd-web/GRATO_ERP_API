const Generator = require('../models/Generator');
const Alert = require('../models/Alert');

class SimulationStatsController {
  async getStats(req, res) {
    try {
      // Get stats from your simulation data source
      const totalGenerators = await Generator.countDocuments({ isSimulated: true });
      const activeGenerators = await Generator.countDocuments({ 
        isSimulated: true,
        status: 'running'
      });
      
      const activeAlerts = await Alert.countDocuments({
        resolved: false,
        'metadata.isSimulated': true
      });
      
      const maintenanceDue = await Maintenance.countDocuments({
        completed: false,
        'generator_id.isSimulated': true,
        date: { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } // Due in next 7 days
      });
      
      // Get status distribution
      const statusDistribution = await Generator.aggregate([
        { $match: { isSimulated: true } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      
      // Get fuel levels
      const fuelLevels = await Generator.find(
        { isSimulated: true },
        { _id: 1, model: 1, 'current_stats.fuel': 1 }
      ).sort({ 'current_stats.fuel': 1 });
      
      res.json({
        total_generators: totalGenerators,
        active_generators: activeGenerators,
        active_alerts: activeAlerts,
        maintenance_due: maintenanceDue,
        status_distribution: statusDistribution,
        fuel_levels: fuelLevels
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new SimulationStatsController();