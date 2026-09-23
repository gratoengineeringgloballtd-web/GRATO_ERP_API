const express = require('express');
const { body, validationResult } = require('express-validator');
const PowerSystem = require('../models/PowerSystem');
const Tower = require('../models/Tower');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

// Get all power systems
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, tower_id, type, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (tower_id) filter.tower_id = tower_id;
    if (type) filter.type = type;

    if (search) {
      filter.$or = [
        { _id: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { model: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } },
        { serial_number: { $regex: search, $options: 'i' } }
      ];
    }

    const powerSystems = await PowerSystem.find(filter)
      .populate('tower_id', 'name location')
      .populate('assigned_technician', 'fullName technicianId')
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await PowerSystem.countDocuments(filter);

    res.json({
      success: true,
      data: powerSystems,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        count: powerSystems.length
      }
    });

  } catch (error) {
    logger.error('Get power systems error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching power systems'
    });
  }
});

// Get single power system
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const powerSystem = await PowerSystem.findById(req.params.id)
      .populate('tower_id', 'name location contact_info')
      .populate('assigned_technician', 'fullName technicianId phone email')
      .populate({
        path: 'maintenance_history',
        options: { limit: 10, sort: { createdAt: -1 } }
      });

    if (!powerSystem) {
      return res.status(404).json({
        success: false,
        error: 'Power system not found'
      });
    }

    res.json({
      success: true,
      data: powerSystem
    });

  } catch (error) {
    logger.error('Get power system error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching power system'
    });
  }
});

// Create new power system
router.post('/', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('_id').matches(/^PS[A-Z]{3}\d{3}$/).withMessage('Invalid power system ID format. Use PS_ABC_001'),
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required'),
  body('type').isIn(['ups', 'inverter', 'battery_bank', 'rectifier', 'distribution_panel', 'transfer_switch']).withMessage('Invalid power system type'),
  body('model').trim().isLength({ min: 1, max: 100 }).withMessage('Model is required'),
  body('manufacturer').trim().isLength({ min: 1, max: 100 }).withMessage('Manufacturer is required'),
  body('serial_number').trim().isLength({ min: 1, max: 100 }).withMessage('Serial number is required'),
  body('tower_id').isString().withMessage('Tower ID is required'),
  body('specifications.rated_power').isNumeric().isFloat({ min: 0 }),
  body('specifications.input_voltage').isNumeric().isFloat({ min: 0 }),
  body('specifications.output_voltage').isNumeric().isFloat({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    // Validate tower exists
    const tower = await Tower.findById(req.body.tower_id);
    if (!tower) {
      return res.status(400).json({
        success: false,
        error: 'Tower not found'
      });
    }

    const powerSystemData = {
      ...req.body,
      created_by: req.user.userId
    };

    const powerSystem = new PowerSystem(powerSystemData);
    await powerSystem.save();

    // Update tower
    await Tower.findByIdAndUpdate(req.body.tower_id, {
      $addToSet: { power_systems: powerSystem._id }
    });

    logger.info('Power system created', {
      powerSystemId: powerSystem._id,
      createdBy: req.user.userId
    });

    res.status(201).json({
      success: true,
      data: powerSystem,
      message: 'Power system created successfully'
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Power system ID or serial number already exists'
      });
    }

    logger.error('Create power system error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error creating power system'
    });
  }
});

// Update power system
router.patch('/:id', authenticateToken, requireRole(['admin', 'supervisor', 'technician']), async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      last_updated_by: req.user.userId
    };

    const powerSystem = await PowerSystem.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!powerSystem) {
      return res.status(404).json({
        success: false,
        error: 'Power system not found'
      });
    }

    logger.info('Power system updated', {
      powerSystemId: powerSystem._id,
      updatedBy: req.user.userId
    });

    res.json({
      success: true,
      data: powerSystem,
      message: 'Power system updated successfully'
    });

  } catch (error) {
    logger.error('Update power system error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating power system'
    });
  }
});

// Update power system status
router.patch('/:id/status', authenticateToken, requireRole(['admin', 'supervisor', 'technician']), [
  body('status').isIn(['online', 'offline', 'maintenance', 'fault', 'bypass']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const powerSystem = await PowerSystem.findByIdAndUpdate(
      req.params.id,
      { 
        $set: { 
          status: req.body.status,
          last_updated_by: req.user.userId
        }
      },
      { new: true, runValidators: true }
    );

    if (!powerSystem) {
      return res.status(404).json({
        success: false,
        error: 'Power system not found'
      });
    }

    logger.info('Power system status updated', {
      powerSystemId: powerSystem._id,
      newStatus: req.body.status,
      updatedBy: req.user.userId
    });

    res.json({
      success: true,
      data: powerSystem,
      message: 'Power system status updated successfully'
    });

  } catch (error) {
    logger.error('Update power system status error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating power system status'
    });
  }
});

// Delete power system
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const powerSystem = await PowerSystem.findById(req.params.id);
    if (!powerSystem) {
      return res.status(404).json({
        success: false,
        error: 'Power system not found'
      });
    }

    // Remove from tower
    if (powerSystem.tower_id) {
      await Tower.findByIdAndUpdate(powerSystem.tower_id, {
        $pull: { power_systems: powerSystem._id }
      });
    }

    await PowerSystem.findByIdAndDelete(req.params.id);

    logger.info('Power system deleted', {
      powerSystemId: req.params.id,
      deletedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Power system deleted successfully'
    });

  } catch (error) {
    logger.error('Delete power system error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error deleting power system'
    });
  }
});

// Get power systems needing maintenance
router.get('/maintenance/needed', authenticateToken, async (req, res) => {
  try {
    const powerSystems = await PowerSystem.findMaintenanceNeeded()
      .populate('tower_id', 'name location');

    res.json({
      success: true,
      data: powerSystems,
      count: powerSystems.length
    });

  } catch (error) {
    logger.error('Get power systems needing maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching power systems needing maintenance'
    });
  }
});

module.exports = router;