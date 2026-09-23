const express = require('express');
const { body, validationResult } = require('express-validator');
const Tower = require('../models/Tower');
const Cluster = require('../models/Cluster');
const Generator = require('../models/Generator');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

// Get all towers
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      status,
      cluster_id,
      supervisor,
      region,
      type,
      search,
      maintenance_due,
      page = 1,
      limit = 50,
      sort = 'name'
    } = req.query;

    // Build filter
    const filter = {};
    
    if (status) filter.status = status;
    if (cluster_id) filter.cluster_id = cluster_id;
    if (supervisor) filter.supervisor = supervisor;
    if (type) filter['specifications.type'] = type;
    
    if (maintenance_due === 'true') {
      filter['maintenance_schedule.next_inspection'] = { $lte: new Date() };
    }

    if (search) {
      filter.$or = [
        { _id: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { 'location.city': { $regex: search, $options: 'i' } },
        { 'location.address': { $regex: search, $options: 'i' } }
      ];
    }

    if (region) {
      filter['location.city'] = { $regex: region, $options: 'i' };
    }

    // Role-based filtering
    if (req.user.role === 'supervisor') {
      const user = await User.findById(req.user.userId);
      if (user.supervisedClusters.length > 0) {
        filter.cluster_id = { $in: user.supervisedClusters };
      }
    } else if (req.user.role === 'technician') {
      const user = await User.findById(req.user.userId);
      if (user.assignedClusters.length > 0) {
        filter.cluster_id = { $in: user.assignedClusters };
      }
    }

    const towers = await Tower.find(filter)
      .populate('cluster_id', 'name code region')
      .populate('supervisor', 'fullName supervisorId phone')
      .populate('primary_generator', 'model status current_stats')
      .populate('backup_generator', 'model status current_stats')
      .populate('assigned_technicians.technician_id', 'fullName technicianId')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Tower.countDocuments(filter);

    res.json({
      success: true,
      data: towers,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        count: towers.length
      }
    });

  } catch (error) {
    logger.error('Get towers error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching towers'
    });
  }
});

// Get single tower
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const tower = await Tower.findById(req.params.id)
      .populate('cluster_id', 'name code region coverage_area')
      .populate('supervisor', 'fullName supervisorId phone email')
      .populate('backup_supervisor', 'fullName supervisorId phone email')
      .populate('assigned_technicians.technician_id', 'fullName technicianId specializations phone email')
      .populate('primary_generator', 'model serial_number status current_stats specifications')
      .populate('backup_generator', 'model serial_number status current_stats specifications')
      .populate('ac_units', 'model status current_stats')
      .populate('power_systems', 'name type status current_stats')
      .populate({
        path: 'maintenance_schedule.maintenance_history',
        options: { limit: 5, sort: { createdAt: -1 } },
        populate: {
          path: 'technician',
          select: 'fullName technicianId'
        }
      });

    if (!tower) {
      return res.status(404).json({
        success: false,
        error: 'Tower not found'
      });
    }

    res.json({
      success: true,
      data: tower
    });

  } catch (error) {
    logger.error('Get tower error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching tower'
    });
  }
});

// Create new tower
router.post('/', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('_id').matches(/^TOWER[A-Z]{3}\d{3}$/).withMessage('Invalid tower ID format. Use TOWER_ABC_001'),
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required and must be less than 100 characters'),
  body('location.address').trim().notEmpty().withMessage('Address is required'),
  body('location.city').trim().notEmpty().withMessage('City is required'),
  body('location.state').trim().notEmpty().withMessage('State is required'),
  body('location.coordinates.latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  body('location.coordinates.longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  body('specifications.height').isNumeric().isFloat({ min: 0 }).withMessage('Height must be a positive number'),
  body('specifications.type').isIn(['monopole', 'lattice', 'guyed', 'stealth', 'rooftop']).withMessage('Invalid tower type'),
  body('specifications.max_load_capacity').isNumeric().isFloat({ min: 0 }).withMessage('Max load capacity must be a positive number'),
  body('power_requirements.total_load').isNumeric().isFloat({ min: 0 }).withMessage('Total load must be a positive number'),
  body('power_requirements.critical_load').isNumeric().isFloat({ min: 0 }).withMessage('Critical load must be a positive number'),
  body('cluster_id').isMongoId().withMessage('Valid cluster ID is required'),
  body('supervisor').isMongoId().withMessage('Valid supervisor ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    // Validate cluster exists
    const cluster = await Cluster.findById(req.body.cluster_id);
    if (!cluster) {
      return res.status(400).json({
        success: false,
        error: 'Cluster not found'
      });
    }

    // Validate supervisor exists and has correct role
    const supervisor = await User.findById(req.body.supervisor);
    if (!supervisor || supervisor.role !== 'supervisor') {
      return res.status(400).json({
        success: false,
        error: 'Invalid supervisor'
      });
    }

    const towerData = {
      ...req.body,
      created_by: req.user.userId,
      maintenance_schedule: {
        next_inspection: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
        inspection_interval: 90
      }
    };

    const tower = new Tower(towerData);
    await tower.save();

    // Update cluster stats
    await cluster.updateStats();

    logger.info('Tower created', {
      towerId: tower._id,
      name: tower.name,
      createdBy: req.user.userId
    });

    res.status(201).json({
      success: true,
      data: tower,
      message: 'Tower created successfully'
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Tower ID already exists'
      });
    }

    logger.error('Create tower error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error creating tower'
    });
  }
});

// Update tower
router.put('/:id', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('location.coordinates.latitude').optional().isFloat({ min: -90, max: 90 }),
  body('location.coordinates.longitude').optional().isFloat({ min: -180, max: 180 }),
  body('specifications.height').optional().isNumeric().isFloat({ min: 0 }),
  body('specifications.type').optional().isIn(['monopole', 'lattice', 'guyed', 'stealth', 'rooftop']),
  body('power_requirements.total_load').optional().isNumeric().isFloat({ min: 0 }),
  body('power_requirements.critical_load').optional().isNumeric().isFloat({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const updateData = {
      ...req.body,
      last_updated_by: req.user.userId
    };

    const tower = await Tower.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('cluster_id', 'name code')
      .populate('supervisor', 'fullName supervisorId');

    if (!tower) {
      return res.status(404).json({
        success: false,
        error: 'Tower not found'
      });
    }

    logger.info('Tower updated', {
      towerId: tower._id,
      name: tower.name,
      updatedBy: req.user.userId
    });

    res.json({
      success: true,
      data: tower,
      message: 'Tower updated successfully'
    });

  } catch (error) {
    logger.error('Update tower error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating tower'
    });
  }
});

// Assign generator to tower
router.post('/:id/generators', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('generator_id').isString().withMessage('Generator ID is required'),
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

    const { generator_id, assignment_type = 'primary' } = req.body;

    const tower = await Tower.findById(req.params.id);
    if (!tower) {
      return res.status(404).json({
        success: false,
        error: 'Tower not found'
      });
    }

    // Verify generator exists and is available
    const generator = await Generator.findById(generator_id);
    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    if (generator.tower_id) {
      return res.status(400).json({
        success: false,
        error: 'Generator is already assigned to another tower'
      });
    }

    // Assign generator
    await tower.assignGenerator(generator_id, assignment_type);
    await generator.assignToTower(tower._id, req.user.userId, 'Tower assignment');

    logger.info('Generator assigned to tower', {
      towerId: tower._id,
      generatorId: generator_id,
      assignmentType: assignment_type,
      assignedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Generator assigned successfully',
      data: {
        towerId: tower._id,
        generatorId: generator_id,
        assignmentType: assignment_type
      }
    });

  } catch (error) {
    logger.error('Assign generator to tower error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error assigning generator'
    });
  }
});

// Remove generator from tower
router.delete('/:id/generators/:generatorId', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
  try {
    const { id: towerId, generatorId } = req.params;

    const tower = await Tower.findById(towerId);
    if (!tower) {
      return res.status(404).json({
        success: false,
        error: 'Tower not found'
      });
    }

    const generator = await Generator.findById(generatorId);
    if (!generator) {
      return res.status(404).json({
        success: false,
        error: 'Generator not found'
      });
    }

    // Remove assignment
    await tower.removeGenerator(generatorId);
    await generator.unassignFromTower(req.user.userId, 'Tower unassignment');

    logger.info('Generator removed from tower', {
      towerId: towerId,
      generatorId: generatorId,
      removedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Generator removed successfully'
    });

  } catch (error) {
    logger.error('Remove generator from tower error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error removing generator'
    });
  }
});

// Get towers needing maintenance
router.get('/maintenance/needed', authenticateToken, async (req, res) => {
  try {
    const towers = await Tower.findMaintenanceNeeded()
      .populate('cluster_id', 'name code')
      .populate('supervisor', 'fullName supervisorId phone')
      .populate('primary_generator', 'status current_stats')
      .populate('backup_generator', 'status current_stats');

    res.json({
      success: true,
      data: towers,
      count: towers.length
    });

  } catch (error) {
    logger.error('Get towers needing maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching towers needing maintenance'
    });
  }
});

// Get towers by cluster
router.get('/cluster/:clusterId', authenticateToken, async (req, res) => {
  try {
    const { clusterId } = req.params;

    const towers = await Tower.findByCluster(clusterId)
      .populate('supervisor', 'fullName supervisorId')
      .populate('primary_generator', 'status current_stats')
      .populate('backup_generator', 'status current_stats');

    res.json({
      success: true,
      data: towers,
      count: towers.length
    });

  } catch (error) {
    logger.error('Get towers by cluster error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching towers by cluster'
    });
  }
});

// Get nearby towers
router.get('/nearby/:lat/:lng', authenticateToken, async (req, res) => {
  try {
    const { lat, lng } = req.params;
    const { maxDistance = 10000 } = req.query; // 10km default

    const coordinates = {
      latitude: parseFloat(lat),
      longitude: parseFloat(lng)
    };

    const towers = await Tower.findNearLocation(coordinates, maxDistance)
      .populate('cluster_id', 'name code')
      .populate('supervisor', 'fullName supervisorId')
      .select('name location specifications operational_stats status');

    res.json({
      success: true,
      data: towers,
      count: towers.length
    });

  } catch (error) {
    logger.error('Get nearby towers error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching nearby towers'
    });
  }
});

// Add tenant to tower
router.post('/:id/tenants', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('name').trim().notEmpty().withMessage('Tenant name is required'),
  body('type').isIn(['telecom', 'broadcasting', 'government', 'private']).withMessage('Invalid tenant type'),
  body('power_consumption').optional().isNumeric().withMessage('Power consumption must be a number'),
  body('contact_info.name').optional().trim(),
  body('contact_info.phone').optional().trim(),
  body('contact_info.email').optional().isEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const tower = await Tower.findById(req.params.id);
    if (!tower) {
      return res.status(404).json({
        success: false,
        error: 'Tower not found'
      });
    }

    await tower.addTenant(req.body);

    logger.info('Tenant added to tower', {
      towerId: tower._id,
      tenantName: req.body.name,
      addedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Tenant added successfully',
      data: tower.tenants[tower.tenants.length - 1]
    });

  } catch (error) {
    logger.error('Add tenant to tower error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error adding tenant'
    });
  }
});

// Delete tower
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const tower = await Tower.findById(req.params.id);
    if (!tower) {
      return res.status(404).json({
        success: false,
        error: 'Tower not found'
      });
    }

    // Check if tower has assigned generators
    if (tower.assigned_generators.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete tower with assigned generators. Please remove all generators first.'
      });
    }

    await Tower.findByIdAndDelete(req.params.id);

    // Update cluster stats
    const cluster = await Cluster.findById(tower.cluster_id);
    if (cluster) {
      await cluster.updateStats();
    }

    logger.info('Tower deleted', {
      towerId: req.params.id,
      name: tower.name,
      deletedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Tower deleted successfully'
    });

  } catch (error) {
    logger.error('Delete tower error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error deleting tower'
    });
  }
});

module.exports = router;