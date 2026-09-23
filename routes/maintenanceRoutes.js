const express = require('express');
const { body, validationResult } = require('express-validator');
const Maintenance = require('../models/Maintenance');
const Generator = require('../models/Generator');
const ACUnit = require('../models/ACUnit');
const PowerSystem = require('../models/PowerSystem');
const Tower = require('../models/Tower');
const User = require('../models/User');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');
const maintenanceController = require('../controllers/maintenanceController');
const upload = require('../middlewares/uploadMiddleware');

const router = express.Router();

// Upload maintenance schedule
router.post(
  '/upload-schedule',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  upload.single('file'),
  maintenanceController.uploadMaintenanceSchedule
);

// Batch schedule from JSON data
router.post(
  '/batch-schedule',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  maintenanceController.batchScheduleMaintenance
);

// Get all maintenance records
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      status,
      maintenanceType,
      technician,
      tower,
      equipment,
      startDate,
      endDate,
      priority,
      page = 1,
      limit = 20,
      sort = '-visit_date'
    } = req.query;

    // Build filter
    const filter = {};
    
    if (status) filter.status = status;
    if (maintenanceType) filter.maintenanceType = maintenanceType;
    if (technician) filter.technician = technician;
    if (tower) filter.tower = tower;
    if (equipment) filter.equipment = equipment;
    if (priority) filter.priority = priority;

    // Date range filter
    if (startDate || endDate) {
      filter.visit_date = {};
      if (startDate) filter.visit_date.$gte = new Date(startDate);
      if (endDate) filter.visit_date.$lte = new Date(endDate);
    }

    // Role-based filtering
    if (req.user.role === 'technician') {
      filter.technician = req.user.userId;
    } else if (req.user.role === 'supervisor') {
      filter.supervisor = req.user.userId;
    }

    const maintenance = await Maintenance.find(filter)
      .populate('technician', 'fullName technicianId phone')
      .populate('supervisor', 'fullName supervisorId')
      .populate('created_by', 'fullName')
      .populate('parts_used.part_id', 'name part_number')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Maintenance.countDocuments(filter);

    res.json({
      success: true,
      data: maintenance,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        count: maintenance.length
      }
    });

  } catch (error) {
    logger.error('Get maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching maintenance records'
    });
  }
});

// Get single maintenance record
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const maintenance = await Maintenance.findById(req.params.id)
      .populate('technician', 'fullName technicianId phone email')
      .populate('supervisor', 'fullName supervisorId phone email')
      .populate('created_by', 'fullName role')
      .populate('reviewed_by', 'fullName role')
      .populate('parts_used.part_id', 'name part_number category inventory');

    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    res.json({
      success: true,
      data: maintenance
    });

  } catch (error) {
    logger.error('Get maintenance record error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching maintenance record'
    });
  }
});

// Create maintenance record
router.post('/', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('maintenanceType').isIn(['generator', 'ac', 'power_system', 'site_cleaning']).withMessage('Invalid maintenance type'),
  body('equipment').optional().isString().withMessage('Equipment ID must be a string'),
  body('cleaningArea').optional().isIn(['general', 'compound', 'equipment_room', 'tower_base']),
  body('tower').isString().withMessage('Tower ID is required'),
  body('type').isIn(['routine', 'repair', 'inspection', 'emergency']).withMessage('Invalid maintenance type'),
  body('visit_date').isISO8601().withMessage('Valid visit date is required'),
  body('technician').isMongoId().withMessage('Valid technician ID is required'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('estimatedDuration').optional().isNumeric().withMessage('Duration must be a number'),
  body('notes').optional().isString()
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
    const tower = await Tower.findById(req.body.tower);
    if (!tower) {
      return res.status(400).json({
        success: false,
        error: 'Tower not found'
      });
    }

    // Validate technician exists and is active
    const technician = await User.findById(req.body.technician);
    if (!technician || technician.role !== 'technician' || !technician.isActive) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or inactive technician'
      });
    }

    // Validate equipment exists if provided
    if (req.body.equipment) {
      let equipmentModel;
      switch (req.body.maintenanceType) {
        case 'generator':
          equipmentModel = Generator;
          break;
        case 'ac':
          equipmentModel = ACUnit;
          break;
        case 'power_system':
          equipmentModel = PowerSystem;
          break;
      }

      if (equipmentModel) {
        const equipment = await equipmentModel.findById(req.body.equipment);
        if (!equipment) {
          return res.status(400).json({
            success: false,
            error: 'Equipment not found'
          });
        }
        req.body.equipmentName = equipment.model || equipment.name;
      }
    }

    const maintenanceData = {
      ...req.body,
      supervisor: req.user.userId,
      createdBy: req.user.userId,
      technicianName: technician.fullName
    };

    const maintenance = new Maintenance(maintenanceData);
    await maintenance.save();

    // Add to technician's current tasks
    await User.findByIdAndUpdate(
      req.body.technician,
      { $addToSet: { currentTasks: maintenance._id } }
    );

    logger.info('Maintenance record created', {
      maintenanceId: maintenance._id,
      createdBy: req.user.userId,
      assignedTo: req.body.technician
    });

    res.status(201).json({
      success: true,
      data: maintenance,
      message: 'Maintenance scheduled successfully'
    });

  } catch (error) {
    logger.error('Create maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error creating maintenance record'
    });
  }
});

// Update maintenance record
router.put('/:id', authenticateToken, [
  body('status').optional().isIn(['pending', 'scheduled', 'in_progress', 'completed', 'cancelled', 'approved', 'rejected']),
  body('visit_date').optional().isISO8601(),
  body('workPerformed').optional().isString(),
  body('issuesFound').optional().isArray(),
  body('recommendations').optional().isString(),
  body('nextMaintenanceDate').optional().isISO8601(),
  body('cost.labor').optional().isNumeric(),
  body('cost.parts').optional().isNumeric(),
  body('cost.transport').optional().isNumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const maintenance = await Maintenance.findById(req.params.id);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    // Check permissions
    const canEdit = req.user.role === 'admin' || 
                   maintenance.supervisor.toString() === req.user.userId ||
                   (maintenance.technician.toString() === req.user.userId && req.user.role === 'technician');

    if (!canEdit) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    // Restrict technician updates
    if (req.user.role === 'technician') {
      const allowedFields = ['status', 'workPerformed', 'issuesFound', 'recommendations', 'partsReplaced', 'afterPhotos', 'endTime'];
      const updateData = {};
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      });
      Object.assign(req.body, updateData);
    }

    const updatedMaintenance = await Maintenance.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )
    .populate('technician', 'fullName technicianId')
    .populate('supervisor', 'fullName supervisorId');

    logger.info('Maintenance record updated', {
      maintenanceId: req.params.id,
      updatedBy: req.user.userId,
      newStatus: req.body.status
    });

    res.json({
      success: true,
      data: updatedMaintenance,
      message: 'Maintenance record updated successfully'
    });

  } catch (error) {
    logger.error('Update maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating maintenance record'
    });
  }
});

// Update maintenance status
router.patch('/:id/status', authenticateToken, [
  body('status').isIn(['pending', 'scheduled', 'in_progress', 'completed', 'cancelled', 'approved', 'rejected']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const maintenance = await Maintenance.findById(req.params.id);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    // Check permissions
    const canUpdateStatus = req.user.role === 'admin' || 
                           maintenance.supervisor.toString() === req.user.userId ||
                           maintenance.technician.toString() === req.user.userId;

    if (!canUpdateStatus) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    const updatedMaintenance = await Maintenance.findByIdAndUpdate(
      req.params.id,
      { 
        $set: { 
          status: req.body.status,
          ...(req.body.status === 'approved' && { reviewed_by: req.user.userId, reviewed_at: new Date() }),
          ...(req.body.status === 'in_progress' && { startTime: new Date() }),
          ...(req.body.status === 'completed' && { completed_at: new Date() })
        }
      },
      { new: true, runValidators: true }
    )
    .populate('technician', 'fullName technicianId')
    .populate('supervisor', 'fullName supervisorId');

    logger.info('Maintenance status updated', {
      maintenanceId: req.params.id,
      newStatus: req.body.status,
      updatedBy: req.user.userId
    });

    res.json({
      success: true,
      data: updatedMaintenance,
      message: 'Maintenance status updated successfully'
    });

  } catch (error) {
    logger.error('Update maintenance status error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating maintenance status'
    });
  }
});

// Get maintenance history for equipment
router.get('/equipment/:equipmentId/history', authenticateToken, async (req, res) => {
  try {
    const { equipmentId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const maintenance = await Maintenance.find({ equipment: equipmentId })
      .populate('technician', 'fullName technicianId')
      .populate('supervisor', 'fullName supervisorId')
      .sort({ completed_at: -1, visit_date: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Maintenance.countDocuments({ equipment: equipmentId });

    res.json({
      success: true,
      data: maintenance,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    logger.error('Get equipment maintenance history error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching maintenance history'
    });
  }
});

// Get maintenance dashboard stats
router.get('/stats/dashboard', authenticateToken, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const filter = {};
    
    // Role-based filtering
    if (req.user.role === 'technician') {
      filter.technician = req.user.userId;
    } else if (req.user.role === 'supervisor') {
      filter.supervisor = req.user.userId;
    }

    const [
      totalMaintenance,
      pendingMaintenance,
      inProgressMaintenance,
      completedMaintenance,
      overdueMaintenance,
      maintenanceByType,
      maintenanceByPriority,
      avgCompletionTime
    ] = await Promise.all([
      Maintenance.countDocuments(filter),
      Maintenance.countDocuments({ ...filter, status: 'pending' }),
      Maintenance.countDocuments({ ...filter, status: 'in_progress' }),
      Maintenance.countDocuments({ 
        ...filter, 
        status: 'completed',
        completed_at: { $gte: startDate }
      }),
      Maintenance.countDocuments({ 
        ...filter, 
        scheduledDate: { $lt: new Date() },
        status: { $in: ['pending', 'scheduled'] }
      }),
      Maintenance.aggregate([
        { $match: filter },
        { $group: { _id: '$maintenanceType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Maintenance.aggregate([
        { $match: filter },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Maintenance.aggregate([
        { 
          $match: { 
            ...filter, 
            status: 'completed', 
            actualDuration: { $exists: true, $gt: 0 }
          }
        },
        { $group: { _id: null, avgDuration: { $avg: '$actualDuration' } } }
      ])
    ]);

    res.json({
      success: true,
      stats: {
        totalMaintenance,
        pendingMaintenance,
        inProgressMaintenance,
        completedMaintenance,
        overdueMaintenance,
        maintenanceByType,
        maintenanceByPriority,
        avgCompletionTime: avgCompletionTime[0]?.avgDuration || 0,
        period
      }
    });

  } catch (error) {
    logger.error('Get maintenance dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching maintenance statistics'
    });
  }
});

// Delete maintenance record
router.delete('/:id', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
  try {
    const maintenance = await Maintenance.findById(req.params.id);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    // Check if can delete (only pending or scheduled maintenance)
    if (!['pending', 'scheduled'].includes(maintenance.status)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete maintenance that is in progress or completed'
      });
    }

    await Maintenance.findByIdAndDelete(req.params.id);

    // Remove from technician's current tasks
    await User.findByIdAndUpdate(
      maintenance.technician,
      { $pull: { currentTasks: req.params.id } }
    );

    logger.info('Maintenance record deleted', {
      maintenanceId: req.params.id,
      deletedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Maintenance record deleted successfully'
    });

  } catch (error) {
    logger.error('Delete maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error deleting maintenance record'
    });
  }
});

// ============================================
// EQUIPMENT CHECK ENDPOINTS (Mobile App)
// ============================================

// Update equipment check data
router.patch('/:id/equipment/:equipmentType', authenticateToken, requireRole(['technician', 'admin', 'supervisor']), async (req, res) => {
  try {
    const { id, equipmentType } = req.params;
    const checkData = req.body;

    const maintenance = await Maintenance.findById(id);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    // Verify technician owns this task
    if (req.user.role === 'technician' && maintenance.technician.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this maintenance record'
      });
    }

    // Initialize equipment_checks if not exists
    if (!maintenance.equipment_checks) {
      maintenance.equipment_checks = {};
    }

    // Common tracking data for all check types
    const trackingData = {
      checked_at: new Date(),
      checked_by: req.user.userId,
      submitted_at: new Date(),
    };

    // Update specific equipment check
    switch (equipmentType) {
      case 'generator':
        if (!maintenance.equipment_checks.generator_checks) {
          maintenance.equipment_checks.generator_checks = [];
        }
        
        // If checkData is an array, replace it (cleaning up structure if needed)
        // If checkData is single item, update/push
        // Existing logic assumed checkData has equipment_id
        
        if (Array.isArray(checkData)) {
             // If passing full array, apply tracking to each
             maintenance.equipment_checks.generator_checks = checkData.map(item => ({
                 ...item,
                 ...trackingData,
                 status: 'pending_approval'
             }));
        } else {
            // Logic for single item update
            const genIndex = maintenance.equipment_checks.generator_checks.findIndex(
              g => g.equipment_id === checkData.equipment_id
            );
            
            const enrichedData = {
                ...checkData,
                ...trackingData,
                status: 'pending_approval'
            };
            
            if (genIndex >= 0) {
              maintenance.equipment_checks.generator_checks[genIndex] = {
                ...maintenance.equipment_checks.generator_checks[genIndex],
                ...enrichedData
              };
            } else {
              maintenance.equipment_checks.generator_checks.push(enrichedData);
            }
        }
        break;

      case 'power_cabinet':
        // Schema is Array. 
        // If checkData is Array, map it. If Object (single update?), handle it.
        // For safety, if it's array, apply headers.
        if (Array.isArray(checkData)) {
            maintenance.equipment_checks.power_cabinet_checks = checkData.map(item => ({
                ...item,
                ...trackingData,
                status: 'pending_approval'
            }));
        } else {
            // Assume it replaces the array or is a single object meant to be in array
             maintenance.equipment_checks.power_cabinet_checks = [{
                 ...checkData,
                 ...trackingData,
                 status: 'pending_approval'
             }];
        }
        break;

      case 'grid':
        maintenance.equipment_checks.grid_checks = {
            ...checkData,
            ...trackingData,
            check_status: 'pending_approval'
        };
        break;

      case 'shelter':
        maintenance.equipment_checks.shelter_checks = {
            ...checkData,
            ...trackingData,
            check_status: 'pending_approval'
        };
        break;

      case 'fuel_tank':
        maintenance.equipment_checks.fuel_tank_checks = {
            ...checkData,
            ...trackingData,
            check_status: 'pending_approval'
        };
        break;

      case 'cleaning':
        maintenance.equipment_checks.cleaning_checks = {
            ...checkData,
            ...trackingData,
            check_status: 'pending_approval'
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid equipment type'
        });
    }

    // Update status to in_progress if still pending
    if (maintenance.status === 'pending' || maintenance.status === 'scheduled') {
      maintenance.status = 'in_progress';
    }

    // Mark as modified
    maintenance.markModified('equipment_checks');
    await maintenance.save();

    logger.info('Equipment check updated', {
      maintenanceId: id,
      equipmentType,
      updatedBy: req.user.userId
    });

    res.json({
      success: true,
      message: `${equipmentType} check updated successfully`,
      data: maintenance.equipment_checks
    });

  } catch (error) {
    logger.error('Update equipment check error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating equipment check'
    });
  }
});

// Save maintenance draft
router.patch('/:id/draft', authenticateToken, requireRole(['technician']), async (req, res) => {
  try {
    const maintenance = await Maintenance.findById(req.params.id);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    // Verify technician owns this task
    if (maintenance.technician.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this maintenance record'
      });
    }

    // Update any provided fields
    Object.keys(req.body).forEach(key => {
      if (key !== '_id' && key !== 'maintenance_id') {
        maintenance[key] = req.body[key];
      }
    });

    // Mark as modified for nested objects
    if (req.body.equipment_checks) {
      maintenance.markModified('equipment_checks');
    }

    await maintenance.save();

    logger.info('Maintenance draft saved', {
      maintenanceId: req.params.id,
      technician: req.user.userId
    });

    res.json({
      success: true,
      message: 'Draft saved successfully',
      data: maintenance
    });

  } catch (error) {
    logger.error('Save maintenance draft error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error saving draft'
    });
  }
});

// Complete maintenance visit
router.post('/:id/complete', authenticateToken, requireRole(['technician', 'admin']), async (req, res) => {
  try {
    const maintenance = await Maintenance.findById(req.params.id);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    // Verify technician owns this task
    if (req.user.role === 'technician' && maintenance.technician.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to complete this maintenance record'
      });
    }

    // Update status and completion details
    maintenance.status = 'completed';
    maintenance.completed_at = new Date();
    maintenance.completion_details = req.body.completion_details || {};
    
    // Calculate actual duration if start time exists
    if (maintenance.started_at) {
      const duration = (maintenance.completed_at - maintenance.started_at) / (1000 * 60 * 60); // hours
      maintenance.actualDuration = duration;
    }

    // Update any final data
    if (req.body.work_performed) {
      maintenance.work_performed = req.body.work_performed;
    }

    await maintenance.save();

    // Remove from technician's current tasks
    await User.findByIdAndUpdate(
      maintenance.technician,
      { $pull: { currentTasks: req.params.id } }
    );

    logger.info('Maintenance completed', {
      maintenanceId: req.params.id,
      technician: req.user.userId,
      completedAt: maintenance.completed_at
    });

    res.json({
      success: true,
      message: 'Maintenance completed successfully',
      data: maintenance
    });

  } catch (error) {
    logger.error('Complete maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error completing maintenance'
    });
  }
});

module.exports = router;
