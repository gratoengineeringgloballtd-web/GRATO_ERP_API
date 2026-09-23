const express = require('express');
const router = express.Router();
const { SerialPort } = require('serialport');
const Telemetry = require('../models/Telemetry');
const SerialData = require('../models/SerialData');
const Generator = require('../models/Generator');
const Tower = require('../models/Tower');

// @desc    Get telemetry data for a generator
// @route   GET /api/telemetry/generator/:id
// @access  Public
router.get('/generator/:id', async (req, res) => {
  try {
    const { start, end, limit } = req.query;
    
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
      .limit(parseInt(limit) || 100)
      .lean();
      
    res.json(telemetry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// @desc    Get telemetry data for a tower
// @route   GET /api/telemetry/tower/:id
// @access  Public
router.get('/tower/:id', async (req, res) => {
  try {
    const { start, end } = req.query;
    
    const filter = {
      'metadata.tower_id': req.params.id
    };
    
    if (start && end) {
      filter.timestamp = {
        $gte: new Date(start),
        $lte: new Date(end)
      };
    }
    
    const telemetry = await Telemetry.find(filter)
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
      
    res.json(telemetry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// @desc    Get telemetry statistics
// @route   GET /api/telemetry/stats
// @access  Public
router.get('/stats', async (req, res) => {
  try {
    const { generatorId, towerId, type } = req.query;
    
    const filter = {};
    if (generatorId) filter['metadata.generator_id'] = generatorId;
    if (towerId) filter['metadata.tower_id'] = towerId;
    if (type) filter.event_type = type;
    
    const stats = await Telemetry.aggregate([
      { $match: filter },
      { $sort: { timestamp: -1 } },
      { $limit: 1000 },
      {
        $group: {
          _id: null,
          avgFuel: { $avg: "$fuel_level" },
          avgPower: { $avg: "$power_output" },
          avgTemp: { $avg: "$temperature" },
          maxTemp: { $max: "$temperature" },
          minFuel: { $min: "$fuel_level" },
          eventCounts: {
            $push: {
              type: "$event_type",
              timestamp: "$timestamp"
            }
          }
        }
      }
    ]);
    
    res.json(stats[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug Endpoints
router.get('/debug/serial-logs', (req, res) => {
  const service = req.app.locals.serialService;
  res.json(service ? service.getStatus() : { error: 'Serial service not initialized' });
});

// Add this enhanced debug endpoint
router.get('/debug/raw-data', async (req, res) => {
  try {
    const service = req.app.locals.serialService;
    const rawData = service ? service.rawDataBuffer : [];
    const dbRawData = await SerialData.find({}).sort({ timestamp: -1 }).limit(10).lean();
    const telemetry = await Telemetry.find({}).sort({ timestamp: -1 }).limit(10).lean();
    
    res.json({
      bufferData: rawData, // In-memory buffer
      dbRawData,           // From database
      telemetry,
      counts: {
        rawData: await SerialData.countDocuments(),
        telemetry: await Telemetry.countDocuments()
      },
      serialStatus: service ? service.getStatus() : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/debug/serial', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    const service = req.app.locals.serialService;
    res.json({
      availablePorts: ports,
      currentPort: process.env.SERIAL_PORT,
      isConnected: service?.port?.isOpen || false
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug Endpoints
router.get('/debug/serial-status', (req, res) => {
  const service = req.app.locals.serialService;
  res.json(service ? service.getStatus() : { error: 'Serial service not initialized' });
});

router.get('/debug/raw-data', async (req, res) => {
  try {
    const telemetry = await Telemetry.find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .lean();
    
    res.json({
      telemetry,
      count: await Telemetry.countDocuments()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug/telemetry', async (req, res) => {
  try {
    const allTelemetry = await Telemetry.find({}).sort({ timestamp: -1 }).limit(10);
    res.json(allTelemetry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/verify', async (req, res) => {
  try {
    const generator = await Generator.findById(req.params.id).lean();
    if (!generator) {
      return res.status(404).json({ error: 'Generator not found' });
    }
    
    const telemetryCount = await Telemetry.countDocuments({
      'metadata.generator_id': req.params.id
    });
    
    res.json({
      generatorExists: true,
      telemetryRecords: telemetryCount,
      generatorStatus: generator.status,
      currentFuel: generator.current_stats.fuel
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug/latest', async (req, res) => {
  try {
    const latest = await Telemetry.findOne().sort({ timestamp: -1 });
    res.json(latest || { message: 'No telemetry found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug/generator-check/:id', async (req, res) => {
  try {
    const generator = await Generator.findById(req.params.id);
    res.json({
      exists: !!generator,
      generator,
      tower: generator ? await Tower.findById(generator.tower_id) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug/send-test', async (req, res) => {
  try {
    const service = req.app.locals.serialService;
    if (!service?.port?.isOpen) {
      return res.status(400).json({ error: 'Serial port not connected' });
    }
    
    await service.sendToPort('TEST');
    res.json({ message: 'Test command sent to Proteus' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


