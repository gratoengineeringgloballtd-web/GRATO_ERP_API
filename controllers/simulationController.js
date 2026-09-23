const Generator = require('../models/Generator');
const Telemetry = require('../models/Telemetry');
const { v4: uuidv4 } = require('uuid');

// In-memory simulation state (for demo purposes)
const simulations = new Map();

class SimulationController {
  // Start simulation for a generator
  async startSimulation(req, res) {
    const { generatorId } = req.params;
    
    try {
      const generator = await Generator.findById(generatorId);
      if (!generator) {
        return res.status(404).json({ error: 'Generator not found' });
      }

      // Create new simulation instance
      const simulationId = uuidv4();
      simulations.set(simulationId, {
        generatorId,
        speed: 1,
        status: 'running',
        lastUpdate: Date.now()
      });

      // Initialize with some fake data
      const initialTelemetry = this.generateTelemetry(generatorId);
      
      res.json({
        simulationId,
        generatorId,
        initialTelemetry
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Get simulated telemetry data
  async getSimulatedTelemetry(req, res) {
    const { generatorId } = req.params;
    
    try {
      // In a real implementation, this would fetch from your simulation
      const telemetry = this.generateTelemetry(generatorId, 100); // Last 100 points
      
      res.json(telemetry);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Update simulation parameters
  async updateSimulationParams(req, res) {
    const { generatorId } = req.params;
    const { speed, fuelConsumptionRate } = req.body;

    try {
      // Find and update simulation
      for (const [id, sim] of simulations) {
        if (sim.generatorId === generatorId) {
          sim.speed = speed || sim.speed;
          sim.fuelConsumptionRate = fuelConsumptionRate || sim.fuelConsumptionRate;
          return res.json(sim);
        }
      }

      res.status(404).json({ error: 'Simulation not found' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Helper to generate fake telemetry data
  generateTelemetry(generatorId, count = 1) {
    const telemetry = [];
    const now = Date.now();
    
    for (let i = 0; i < count; i++) {
      const timestamp = new Date(now - (count - i) * 60000);
      telemetry.push({
        metadata: {
          generator_id: generatorId,
          tower_id: 'TOWER_SIM_001' // Simulated tower
        },
        timestamp,
        fuel_level: Math.max(0, 100 - i * 0.5),
        power_output: 5 + Math.sin(i/10) * 3,
        temperature: 60 + Math.random() * 20,
        vibration: 30 + Math.random() * 40,
        status: i % 10 === 0 ? 'standby' : 'running',
        event_type: this.determineEventType(i)
      });
    }
    
    return count === 1 ? telemetry[0] : telemetry;
  }

  determineEventType(index) {
    if (index % 50 === 0) return 'low_fuel';
    if (index % 30 === 0) return 'overheating';
    if (index % 40 === 0) return 'mechanical_issue';
    return 'normal';
  }
}

module.exports = new SimulationController();