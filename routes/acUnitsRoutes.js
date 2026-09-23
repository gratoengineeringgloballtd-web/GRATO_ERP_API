const express = require('express');
const { body, validationResult } = require('express-validator');
const ACUnit = require('../models/ACUnit');
const Tower = require('../models/Tower');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

// Get all AC units
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
        { model: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } },
        { serial_number: { $regex: search, $options: 'i' } }
      ];
    }

    const acUnits = await ACUnit.find(filter)
      .populate('tower_id', 'name location')
      .populate('assigned_technician', 'fullName technicianId')
      .sort({ model: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ACUnit.countDocuments(filter);

    res.json({
      success: true,
      data: acUnits,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        count: acUnits.length
      }
    });

  } catch (error) {
    logger.error('Get AC units error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching AC units'
    });
  }
});

// Get single AC unit
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const acUnit = await ACUnit.findById(req.params.id)
      .populate('tower_id', 'name location contact_info')
      .populate('assigned_technician', 'fullName technicianId phone email')
      .populate({
        path: 'maintenance_history',
        options: { limit: 10, sort: { createdAt: -1 } }
      });

    if (!acUnit) {
      return res.status(404).json({
        success: false,
        error: 'AC unit not found'
      });
    }

    res.json({
      success: true,
      data: acUnit
    });

  } catch (error) {
    logger.error('Get AC unit error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching AC unit'
    });
  }
});

// Create new AC unit
router.post('/', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('_id').matches(/^AC[A-Z]{3}\d{3}$/).withMessage('Invalid AC unit ID format. Use AC_ABC_001'),
  body('model').trim().isLength({ min: 1, max: 100 }).withMessage('Model is required'),
  body('manufacturer').trim().isLength({ min: 1, max: 100 }).withMessage('Manufacturer is required'),
  body('serial_number').trim().isLength({ min: 1, max: 100 }).withMessage('Serial number is required'),
  body('type').isIn(['split', 'window', 'central', 'portable', 'cassette']).withMessage('Invalid AC unit type'),
  body('tower_id').isString().withMessage('Tower ID is required'),
  body('specifications.cooling_capacity').isNumeric().isFloat({ min: 0 }),
  body('specifications.power_consumption').isNumeric().isFloat({ min: 0 })
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

    const acUnitData = {
      ...req.body,
      created_by: req.user.userId
    };

    const acUnit = new ACUnit(acUnitData);
    await acUnit.save();

    // Update tower
    await Tower.findByIdAndUpdate(req.body.tower_id, {
      $addToSet: { ac_units: acUnit._id }
    });

    logger.info('AC unit created', {
      acUnitId: acUnit._id,
      createdBy: req.user.userId
    });

    res.status(201).json({
      success: true,
      data: acUnit,
      message: 'AC unit created successfully'
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'AC unit ID or serial number already exists'
      });
    }

    logger.error('Create AC unit error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error creating AC unit'
    });
  }
});

// Update AC unit
router.patch('/:id', authenticateToken, requireRole(['admin', 'supervisor', 'technician']), async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      last_updated_by: req.user.userId
    };

    const acUnit = await ACUnit.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!acUnit) {
      return res.status(404).json({
        success: false,
        error: 'AC unit not found'
      });
    }

    logger.info('AC unit updated', {
      acUnitId: acUnit._id,
      updatedBy: req.user.userId
    });

    res.json({
      success: true,
      data: acUnit,
      message: 'AC unit updated successfully'
    });

  } catch (error) {
    logger.error('Update AC unit error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating AC unit'
    });
  }
});

// Update AC unit status
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

    const acUnit = await ACUnit.findByIdAndUpdate(
      req.params.id,
      { 
        $set: { 
          status: req.body.status,
          last_updated_by: req.user.userId
        }
      },
      { new: true, runValidators: true }
    );

    if (!acUnit) {
      return res.status(404).json({
        success: false,
        error: 'AC unit not found'
      });
    }

    logger.info('AC unit status updated', {
      acUnitId: acUnit._id,
      newStatus: req.body.status,
      updatedBy: req.user.userId
    });

    res.json({
      success: true,
      data: acUnit,
      message: 'AC unit status updated successfully'
    });

  } catch (error) {
    logger.error('Update AC unit status error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating AC unit status'
    });
  }
});

// Delete AC unit
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const acUnit = await ACUnit.findById(req.params.id);
    if (!acUnit) {
      return res.status(404).json({
        success: false,
        error: 'AC unit not found'
      });
    }

    // Remove from tower
    if (acUnit.tower_id) {
      await Tower.findByIdAndUpdate(acUnit.tower_id, {
        $pull: { ac_units: acUnit._id }
      });
    }

    await ACUnit.findByIdAndDelete(req.params.id);

    logger.info('AC unit deleted', {
      acUnitId: req.params.id,
      deletedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'AC unit deleted successfully'
    });

  } catch (error) {
    logger.error('Delete AC unit error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error deleting AC unit'
    });
  }
});

// Get AC units needing maintenance
router.get('/maintenance/needed', authenticateToken, async (req, res) => {
  try {
    const acUnits = await ACUnit.findMaintenanceNeeded()
      .populate('tower_id', 'name location');

    res.json({
      success: true,
      data: acUnits,
      count: acUnits.length
    });

  } catch (error) {
    logger.error('Get AC units needing maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching AC units needing maintenance'
    });
  }
});

module.exports = router;