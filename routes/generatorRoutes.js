const express = require('express');
const { body, validationResult } = require('express-validator');
const Generator = require('../models/Generator');
const Tower = require('../models/Tower');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

// Get all generators
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      status, 
      tower_id, 
      model, 
      manufacturer,
      fuel_type,
      maintenance_due,
      assigned,
      search,
      page = 1, 
      limit = 50,
      sort = '-createdAt'
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (status) filter.status = status;
    if (tower_id) filter.tower_id = tower_id;
    if (model) filter.model = { $regex: model, $options: 'i' };
    if (manufacturer) filter.manufacturer = { $regex: manufacturer, $options: 'i' };
    if (fuel_type) filter['specifications.fuel_type'] = fuel_type;
    
    if (assigned === 'true') {
      filter.tower_id = { $ne: null };
    } else if (assigned === 'false') {
      filter.tower_id = null;
    }

    if (maintenance_due === 'true') {
      filter.next_maintenance = { $lte: new Date() };
    }

    if (search) {
      filter.$or = [
        { _id: { $regex: search, $options: 'i' } },
        { model: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } },
        { serial_number: { $regex: search, $options: 'i' } }
      ];
    }

    const generators = await Generator.find(filter)
      .populate('tower_id', 'name location status')
      .populate('assigned_technician', 'fullName technicianId')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Generator.countDocuments(filter);

    res.json({
      success: true,
      data: generators,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        count: generators.length
      }
    });

  } catch (error) {
    logger.error('Get generators error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching generators'
    });
  }
});

// Get single generator by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const generator = await Generator.findById(req.params.id)
      .populate('tower_id', 'name location contact_info')
      .populate('assigned_technician', 'fullName technicianId phone email')
      .populate({
        path: 'maintenance_history',
        options: { limit: 10, sort: { createdAt: -1 } },
        populate: {
          path: 'technician',
          select: 'fullName technicianId'
        }
      });

    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    res.json({
      success: true,
      data: generator
    });

  } catch (error) {
    logger.error('Get generator error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching generator'
    });
  }
});

// Create new generator
router.post('/', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('_id').matches(/^GEN[A-Z]{3}\d{3}$/).withMessage('Invalid generator ID format. Use GEN_ABC_001'),
  body('model').trim().isLength({ min: 1, max: 100 }).withMessage('Model is required and must be less than 100 characters'),
  body('manufacturer').trim().isLength({ min: 1, max: 100 }).withMessage('Manufacturer is required'),
  body('serial_number').trim().isLength({ min: 1, max: 100 }).withMessage('Serial number is required'),
  body('specifications.fuel_type').isIn(['diesel', 'gasoline', 'natural_gas', 'hybrid']).withMessage('Invalid fuel type'),
  body('specifications.fuel_capacity').isNumeric().isFloat({ min: 0 }).withMessage('Fuel capacity must be a positive number'),
  body('specifications.power_rating').isNumeric().isFloat({ min: 0 }).withMessage('Power rating must be a positive number'),
  body('tower_id').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    // Check if tower exists if provided
    if (req.body.tower_id) {
      const tower = await Tower.findById(req.body.tower_id);
      if (!tower) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tower ID'
        });
      }

      // Check if tower already has maximum generators
      const existingGenerators = await Generator.countDocuments({ tower_id: req.body.tower_id });
      if (existingGenerators >= 2) {
        return res.status(400).json({
          success: false,
          error: 'Tower already has maximum number of generators (2)'
        });
      }
    }

    const generatorData = {
      ...req.body,
      created_by: req.user.userId,
      installation_date: req.body.installation_date || new Date()
    };

    const generator = new Generator(generatorData);
    await generator.save();

    // Update tower if assigned
    if (req.body.tower_id) {
      await Tower.findByIdAndUpdate(req.body.tower_id, {
        $addToSet: { assigned_generators: { generator_id: generator._id, assignment_type: 'primary' } }
      });
    }

    logger.info('Generator created', { 
      generatorId: generator._id, 
      createdBy: req.user.userId 
    });

    res.status(201).json({
      success: true,
      data: generator,
      message: 'Generator created successfully'
    });

  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        error: `${field} already exists`
      });
    }

    logger.error('Create generator error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error creating generator'
    });
  }
});

// Update generator
router.put('/:id', authenticateToken, requireRole(['admin', 'supervisor', 'technician']), [
  body('model').optional().trim().isLength({ min: 1, max: 100 }),
  body('manufacturer').optional().trim().isLength({ min: 1, max: 100 }),
  body('serial_number').optional().trim().isLength({ min: 1, max: 100 }),
  body('specifications.fuel_type').optional().isIn(['diesel', 'gasoline', 'natural_gas', 'hybrid']),
  body('specifications.fuel_capacity').optional().isNumeric().isFloat({ min: 0 }),
  body('specifications.power_rating').optional().isNumeric().isFloat({ min: 0 }),
  body('current_stats.fuel').optional().isNumeric().isFloat({ min: 0, max: 100 }),
  body('current_stats.power').optional().isNumeric().isFloat({ min: 0 }),
  body('current_stats.temperature').optional().isNumeric(),
  body('current_stats.runtime').optional().isNumeric().isFloat({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    // Restrict certain fields based on user role
    const updateData = { ...req.body };
    if (req.user.role === 'technician') {
      // Technicians can only update operational stats and maintenance info
      const allowedFields = ['current_stats', 'notes', 'last_maintenance', 'next_maintenance'];
      const filteredUpdate = {};
      
      allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          filteredUpdate[field] = updateData[field];
        }
      });
      
      Object.assign(updateData, filteredUpdate);
    }

    updateData.last_updated_by = req.user.userId;

    const generator = await Generator.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('tower_id', 'name location');

    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    logger.info('Generator updated', { 
      generatorId: generator._id, 
      updatedBy: req.user.userId 
    });

    res.json({
      success: true,
      data: generator,
      message: 'Generator updated successfully'
    });

  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        error: `${field} already exists`
      });
    }

    logger.error('Update generator error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating generator'
    });
  }
});

// Update generator status
router.patch('/:id/status', authenticateToken, requireRole(['admin', 'supervisor', 'technician']), [
  body('status').isIn(['running', 'standby', 'maintenance', 'fault', 'out_of_service']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const generator = await Generator.findByIdAndUpdate(
      req.params.id,
      { 
        $set: { 
          status: req.body.status,
          last_updated_by: req.user.userId
        }
      },
      { new: true, runValidators: true }
    );

    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    logger.info('Generator status updated', { 
      generatorId: generator._id, 
      newStatus: req.body.status,
      updatedBy: req.user.userId 
    });

    // Emit real-time update via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('generator-status-update', {
        generatorId: generator._id,
        status: req.body.status,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      data: generator,
      message: 'Generator status updated successfully'
    });

  } catch (error) {
    logger.error('Update generator status error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating generator status'
    });
  }
});

// Assign generator to tower
router.post('/:id/assign', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('tower_id').isString().withMessage('Tower ID is required'),
  body('assignment_type').optional().isIn(['primary', 'backup']).withMessage('Invalid assignment type')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { tower_id, assignment_type = 'primary' } = req.body;

    // Verify tower exists
    const tower = await Tower.findById(tower_id);
    if (!tower) {
      return res.status(404).json({
        success: false,
        error: 'Tower not found'
      });
    }

    // Check tower generator capacity
    const assignedGenerators = await Generator.countDocuments({ tower_id });
    if (assignedGenerators >= 2) {
      return res.status(400).json({
        success: false,
        error: 'Tower already has maximum generators (2)'
      });
    }

    // Find and update generator
    const generator = await Generator.findById(req.params.id);
    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    if (generator.tower_id) {
      return res.status(400).json({
        success: false,
        error: 'Generator is already assigned to a tower'
      });
    }

    // Assign generator to tower
    await generator.assignToTower(tower_id, req.user.userId, 'Manual assignment');
    
    // Update tower assignment
    await tower.assignGenerator(generator._id, assignment_type);

    logger.info('Generator assigned to tower', { 
      generatorId: generator._id, 
      towerId: tower_id,
      assignedBy: req.user.userId 
    });

    res.json({
      success: true,
      message: 'Generator assigned successfully',
      data: {
        generatorId: generator._id,
        towerId: tower_id,
        assignmentType: assignment_type
      }
    });

  } catch (error) {
    logger.error('Assign generator error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error assigning generator'
    });
  }
});

// Unassign generator from tower
router.post('/:id/unassign', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
  try {
    const generator = await Generator.findById(req.params.id);
    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    if (!generator.tower_id) {
      return res.status(400).json({
        success: false,
        error: 'Generator is not assigned to any tower'
      });
    }

    const towerId = generator.tower_id;

    // Unassign from generator side
    await generator.unassignFromTower(req.user.userId, 'Manual unassignment');

    // Update tower
    const tower = await Tower.findById(towerId);
    if (tower) {
      await tower.removeGenerator(generator._id);
    }

    logger.info('Generator unassigned from tower', { 
      generatorId: generator._id, 
      towerId: towerId,
      unassignedBy: req.user.userId 
    });

    res.json({
      success: true,
      message: 'Generator unassigned successfully'
    });

  } catch (error) {
    logger.error('Unassign generator error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error unassigning generator'
    });
  }
});

// Get generator telemetry/stats
router.get('/:id/telemetry', authenticateToken, async (req, res) => {
  try {
    const { period = '24h' } = req.query;
    
    const generator = await Generator.findById(req.params.id);
    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    // Calculate time range
    let startDate = new Date();
    switch (period) {
      case '1h':
        startDate.setHours(startDate.getHours() - 1);
        break;
      case '24h':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 1);
    }

    // For now, return current stats - in production, this would query telemetry collection
    const telemetryData = {
      generatorId: generator._id,
      currentStats: generator.current_stats,
      performance: generator.performance_metrics,
      alerts: generator.isCritical() ? ['Critical condition detected'] : [],
      period: period,
      timestamp: new Date()
    };

    res.json({
      success: true,
      data: telemetryData
    });

  } catch (error) {
    logger.error('Get generator telemetry error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching telemetry'
    });
  }
});

// Delete generator
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const generator = await Generator.findById(req.params.id);
    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    // Unassign from tower if assigned
    if (generator.tower_id) {
      const tower = await Tower.findById(generator.tower_id);
      if (tower) {
        await tower.removeGenerator(generator._id);
      }
    }

    await Generator.findByIdAndDelete(req.params.id);

    logger.info('Generator deleted', { 
      generatorId: req.params.id, 
      deletedBy: req.user.userId 
    });

    res.json({
      success: true,
      message: 'Generator deleted successfully'
    });

  } catch (error) {
    logger.error('Delete generator error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error deleting generator'
    });
  }
});

// Get generators needing maintenance
router.get('/maintenance/needed', authenticateToken, async (req, res) => {
  try {
    const generators = await Generator.findMaintenanceNeeded()
      .populate('tower_id', 'name location')
      .populate('assigned_technician', 'fullName technicianId');

    res.json({
      success: true,
      data: generators,
      count: generators.length
    });

  } catch (error) {
    logger.error('Get generators needing maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching maintenance needed generators'
    });
  }
});

// Get available generators (unassigned)
router.get('/available', authenticateToken, async (req, res) => {
  try {
    const generators = await Generator.findAvailable()
      .sort({ model: 1 });

    res.json({
      success: true,
      data: generators,
      count: generators.length
    });

  } catch (error) {
    logger.error('Get available generators error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching available generators'
    });
  }
});

module.exports = router;

