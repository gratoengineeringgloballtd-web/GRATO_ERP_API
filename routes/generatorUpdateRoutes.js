const express = require('express');
const { body, validationResult } = require('express-validator');
const GeneratorUpdate = require('../models/GeneratorUpdate');
const Generator = require('../models/Generator');
const Tower = require('../models/Tower');
const Site = require('../models/Site');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { sendEmail } = require('../services/emailService')
const logger = require('../utils/logger');

const router = express.Router();

// Get latest approved generator update for a specific site
router.get('/site/:ihsIdSite/latest', authenticateToken, async (req, res) => {
  try {
    const { ihsIdSite } = req.params;
    
    console.log('Getting latest generator update for site:', ihsIdSite);

    // Get the latest approved generator update for this site
    const latestUpdate = await GeneratorUpdate.findOne({
      site_id: ihsIdSite,
      status: 'approved',
      updateType: { $in: ['new_generator', 'status_update'] }
    })
      .sort({ reviewed_at: -1 })
      .populate('submitted_by', 'fullName role');

    if (!latestUpdate) {
      console.log('No approved generator update found for site:', ihsIdSite);
      return res.status(404).json({
        success: false,
        error: 'No approved generator updates found for this site'
      });
    }

    console.log('Found generator update:', latestUpdate._id);

    // Prepare response data
    const responseData = {
      update_type: latestUpdate.updateType,
      new_generator_id: latestUpdate.new_generator_id || latestUpdate.existing_generator_id,
      manufacturer: latestUpdate.model?.split(' ')[0] || 'Unknown',
      model: latestUpdate.model,
      serial_number: latestUpdate.serial_number || latestUpdate.existing_generator_id,
      power_rating: latestUpdate.power_rating,
      fuel_capacity: latestUpdate.fuel_capacity,
      fuel_type: latestUpdate.fuel_type,
      maintenance_interval: latestUpdate.maintenance_interval || null,
      current_stats: {
        fuel: latestUpdate.fuel_level,
        power: latestUpdate.power_output,
        runtime: latestUpdate.runtime,
        temperature: latestUpdate.temperature
      },
      last_running_hours: latestUpdate.runtime || 0,
      status: latestUpdate.generator_status,
      last_updated: latestUpdate.reviewed_at || latestUpdate.submitted_at
    };

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    logger.error('Get latest generator update for site error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching generator data',
      message: error.message
    });
  }
});


// Get pending generator updates (for approval)
router.get('/pending', authenticateToken, async (req, res) => {
  try {
    const query = { status: 'approved' };

    // If supervisor, only show updates from their technicians
    if (req.user.role === 'supervisor') {
      const User = require('../models/User');
      const supervisor = await User.findById(req.user.userId).select('supervisedTechnicians');
      
      if (supervisor && supervisor.supervisedTechnicians && supervisor.supervisedTechnicians.length > 0) {
        query.submitted_by = { $in: supervisor.supervisedTechnicians };
      } else {
        // No supervised technicians, return empty array
        return res.json({
          success: true,
          data: [],
          count: 0
        });
      }
    }

    const updates = await GeneratorUpdate.find(query)
      .populate('tower_id', 'name location')
      .populate('existing_generator_id', 'model serial_number')
      .populate('submitted_by', 'fullName role email')
      .sort({ submitted_at: -1 });

    res.json({
      success: true,
      data: updates,
      count: updates.length
    });

  } catch (error) {
    logger.error('Get pending generator updates error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching generator updates'
    });
  }
});


// Get supervisor dashboard stats
router.get('/dashboard',
  authenticateToken,
  requireRole('supervisor', 'admin'),
  async (req, res) => {
    try {
      const supervisorId = req.user.userId;
      const User = require('../models/User');
      const GeneratorUpdate = require('../models/GeneratorUpdate');
      const Maintenance = require('../models/Maintenance');

      // Get supervised technicians
      const supervisor = await User.findById(supervisorId).select('supervisedTechnicians');
      const supervisedTechIds = supervisor?.supervisedTechnicians || [];

      // Get stats
      const [
        assignedTechnicians,
        pendingApprovals,
        pendingGeneratorUpdates,
        sitesVisitedThisWeek
      ] = await Promise.all([
        User.countDocuments({
          _id: { $in: supervisedTechIds },
          isActive: true
        }),
        Maintenance.countDocuments({
          supervisor: supervisorId,
          status: 'pending'
        }),
        GeneratorUpdate.countDocuments({
          submitted_by: { $in: supervisedTechIds },
          status: 'pending'
        }),
        // Count site visits from this week
        require('../models/Site').countDocuments({
          'visit_history.technician_id': { $in: supervisedTechIds },
          'visit_history.Actual_Date_Visit': {
            $gte: new Date(new Date().setDate(new Date().getDate() - 7))
          }
        })
      ]);

      res.json({
        success: true,
        data: {
          assignedTechnicians,
          pendingApprovals,
          pendingGeneratorUpdates,
          siteVisitsThisWeek: sitesVisitedThisWeek
        }
      });

    } catch (error) {
      logger.error('Get supervisor dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Server error fetching dashboard stats'
      });
    }
  }
);


// Get recent generator updates (for admin dashboard)
router.get('/recent', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const updates = await GeneratorUpdate.find()
      .populate('tower_id', 'name location')
      .populate('existing_generator_id', 'model serial_number')
      .populate('submitted_by', 'fullName role')
      .populate('reviewed_by', 'fullName role')
      .sort({ submitted_at: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: updates,
      count: updates.length
    });

  } catch (error) {
    logger.error('Get recent generator updates error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching recent updates'
    });
  }
});

// Submit new generator update - AUTO-APPROVE VERSION WITH EMAIL NOTIFICATION
router.post('/', 
  authenticateToken, 
  requireRole('technician', 'supervisor'), 
  [
    body('updateType')
      .isIn(['status_update', 'new_generator', 'maintenance_update'])
      .withMessage('Invalid update type'),
    body('site_id')
      .isString()
      .withMessage('Site ID is required'),  
    body('update_reason')
      .isString()
      .isLength({ min: 10, max: 500 })
      .withMessage('Update reason is required (10-500 characters)'),
    body('generator_status')
      .isIn(['running', 'standby', 'maintenance', 'fault', 'out_of_service'])
      .withMessage('Invalid generator status'),
    body('fuel_level')
      .optional()
      .isInt({ min: 0, max: 100 })
      .withMessage('Fuel level must be between 0-100'),
    body('power_output')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Power output must be non-negative'),
    body('existing_generator_id')
      .optional()
      .isString(),
    body('new_generator_id')
      .optional()
      .matches(/^GEN_?[A-Z]{3}_?\d{3,4}$/)
      .withMessage('Invalid generator ID format. Use GEN_ABC_001 or GENABC001'),
    body('model')
      .optional()
      .isString(),
    body('serial_number')
      .optional()
      .isString(),
    body('fuel_capacity')
      .optional()
      .isInt({ min: 0 }),
    body('power_rating')
      .optional()
      .isInt({ min: 0 }),
    body('fuel_type')
      .optional()
      .isIn(['diesel', 'gasoline', 'natural_gas', 'hybrid'])
  ], 
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      // Normalize generator ID (remove underscores if present)
      if (req.body.new_generator_id) {
        req.body.new_generator_id = req.body.new_generator_id.replace(/_/g, '');
      }

      // Find site
      const site = await Site.findOne({ IHS_ID_SITE: req.body.site_id });
      if (!site) {
        return res.status(400).json({
          success: false,
          error: 'Site not found'
        });
      }

      // Get tower_id from site
      let tower_id = site.tower_reference;

      if (!tower_id) {
        const siteIdParts = req.body.site_id.replace(/^IHS_?/, '').replace(/_/g, '');
        const letters = siteIdParts.match(/[A-Z]+/)?.[0] || 'UNK';
        const numbers = siteIdParts.match(/\d+/)?.[0] || '000';
        const letterPart = letters.substring(0, 3).padEnd(3, 'X');
        const numberPart = numbers.padStart(3, '0').slice(-3);
        tower_id = `TOWER${letterPart}${numberPart}`;

        const towerExists = await Tower.findById(tower_id);
        if (!towerExists) {
          return res.status(400).json({
            success: false,
            error: `Tower ${tower_id} not found for site ${req.body.site_id}. Please contact admin.`
          });
        }
      }

      // Validate existing generator if provided
      if (req.body.existing_generator_id) {
        const existingGen = await Generator.findById(req.body.existing_generator_id);
        if (!existingGen) {
          return res.status(400).json({
            success: false,
            error: 'Existing generator not found'
          });
        }
      }

      // Get technician details for email
      const User = require('../models/User');
      const technician = await User.findById(req.user._id).select('fullName email');

      // Create update record with approved status
      const updateData = {
        ...req.body,
        tower_id: tower_id,
        site_id: req.body.site_id,
        submitted_by: req.user._id,
        status: 'approved',
        reviewed_by: req.user._id,
        reviewed_at: new Date()
      };

      const generatorUpdate = new GeneratorUpdate(updateData);
      await generatorUpdate.save();

      // IMMEDIATELY CREATE/UPDATE GENERATOR
      if (updateData.updateType === 'new_generator') {
        const generatorId = updateData.new_generator_id;

        // Check if generator already exists
        const existingGen = await Generator.findById(generatorId);

        const generatorData = {
          model: updateData.model,
          serial_number: updateData.serial_number,
          manufacturer: updateData.model?.split(' ')[0] || 'Unknown',
          specifications: {
            fuel_type: updateData.fuel_type,
            fuel_capacity: updateData.fuel_capacity,
            power_rating: updateData.power_rating,
            voltage_output: 220,
            frequency: 50
          },
          current_stats: {
            fuel: updateData.fuel_level || 100,
            power: updateData.power_output || 0,
            temperature: updateData.temperature || 25,
            runtime: updateData.runtime || 0
          },
          status: updateData.generator_status,
          tower_id: updateData.tower_id,
          installation_date: updateData.installation_date || new Date(),
          maintenance_interval: updateData.maintenance_interval || 250,
          last_updated: new Date(),
          last_updated_by: req.user._id
        };

        if (existingGen) {
          await Generator.findByIdAndUpdate(generatorId, generatorData, { new: true });
          logger.info('Generator updated', { generatorId });
        } else {
          const newGenerator = new Generator({
            _id: generatorId,
            ...generatorData,
            created_by: req.user._id
          });

          await newGenerator.save();
          logger.info('New generator created', { generatorId, model: newGenerator.model });
        }

        // Update tower assignment
        const tower = await Tower.findById(updateData.tower_id);
        if (tower) {
          try {
            await tower.assignGenerator(generatorId, 'primary');
            logger.info('Generator assigned to tower', { generatorId, towerId: tower._id });
          } catch (err) {
            logger.warn('Tower assignment warning:', err.message);
          }
        }

        // Update site reference
        await Site.findOneAndUpdate(
          { IHS_ID_SITE: updateData.site_id },
          { 
            $addToSet: { Current_Generators: generatorId },
            Primary_Generator: generatorId
          }
        );

      } else if (updateData.updateType === 'status_update') {
        // Update existing generator stats
        await Generator.findByIdAndUpdate(updateData.existing_generator_id, {
          status: updateData.generator_status,
          'current_stats.fuel': updateData.fuel_level,
          'current_stats.power': updateData.power_output,
          'current_stats.temperature': updateData.temperature,
          'current_stats.runtime': updateData.runtime,
          last_updated_by: req.user._id,
          last_updated: new Date()
        });

        logger.info('Generator status updated', {
          generatorId: updateData.existing_generator_id,
          newStatus: updateData.generator_status
        });
      }

      // SEND EMAIL NOTIFICATION TO SUPERVISOR
      try {
        // Find technician's supervisor
        const supervisors = await User.find({
          role: 'supervisor',
          isActive: true,
          supervisedTechnicians: req.user._id
        }).select('fullName email');

        if (supervisors && supervisors.length > 0) {
          const generatorDetails = {
            model: updateData.model || (await Generator.findById(updateData.existing_generator_id))?.model,
            serial_number: updateData.serial_number,
            status: updateData.generator_status,
            fuel_level: updateData.fuel_level,
            power_output: updateData.power_output,
            runtime: updateData.runtime
          };

          // Send email to each supervisor
          for (const supervisor of supervisors) {
            await sendEmail({
              to:      supervisor.email,
              subject: `🔧 Generator Update — ${site.Site_Name || site.IHS_ID_SITE} (${updateData.updateType})`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                  <h2 style="margin:0 0 12px">🔧 Generator Update Submitted</h2>
                  <p>Dear ${supervisor.fullName},</p>
                  <p><strong>${technician.fullName}</strong> submitted a generator update
                     (<strong>${updateData.updateType}</strong>) for site
                     <strong>${site.Site_Name || site.IHS_ID_SITE}</strong> (${site.IHS_ID_SITE}).</p>
                  <table style="width:100%;border-collapse:collapse;margin:16px 0">
                    <tr><td style="padding:6px;font-weight:600;color:#555">Model</td><td style="padding:6px">${generatorDetails.model || '—'}</td></tr>
                    <tr><td style="padding:6px;font-weight:600;color:#555">Serial Number</td><td style="padding:6px">${generatorDetails.serial_number || '—'}</td></tr>
                    <tr><td style="padding:6px;font-weight:600;color:#555">Status</td><td style="padding:6px">${generatorDetails.status || '—'}</td></tr>
                    <tr><td style="padding:6px;font-weight:600;color:#555">Fuel Level</td><td style="padding:6px">${generatorDetails.fuel_level ?? '—'}</td></tr>
                    <tr><td style="padding:6px;font-weight:600;color:#555">Power Output</td><td style="padding:6px">${generatorDetails.power_output ?? '—'}</td></tr>
                    <tr><td style="padding:6px;font-weight:600;color:#555">Runtime</td><td style="padding:6px">${generatorDetails.runtime ?? '—'}</td></tr>
                    ${updateData.update_reason ? `<tr><td style="padding:6px;font-weight:600;color:#555">Reason</td><td style="padding:6px">${updateData.update_reason}</td></tr>` : ''}
                  </table>
                  <p style="color:#888;font-size:11px">Update ID: ${generatorUpdate._id}</p>
                </div>
              `,
            });

            logger.info('Supervisor notified of generator update', {
              supervisorEmail: supervisor.email,
              updateId: generatorUpdate._id
            });
          }
        } else {
          logger.warn('No supervisor found for technician', {
            technicianId: req.user._id
          });
        }
      } catch (emailError) {
        logger.error('Failed to send supervisor notification email:', emailError);
        // Don't fail the request if email fails
      }

      logger.info('Generator update auto-approved and applied', {
        updateId: generatorUpdate._id,
        updateType: req.body.updateType,
        siteId: req.body.site_id,
        towerId: tower_id
      });

      res.status(201).json({
        success: true,
        data: generatorUpdate,
        message: 'Generator update submitted and automatically applied',
        autoApproved: true
      });

    } catch (error) {
      logger.error('Submit generator update error:', error);
      res.status(500).json({
        success: false,
        error: 'Server error submitting generator update',
        message: error.message
      });
    }
  }
);

// Approve generator update (manual approval route)
router.put('/:id/approve', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const update = await GeneratorUpdate.findById(req.params.id);
    if (!update) {
      return res.status(404).json({
        success: false,
        error: 'Generator update not found'
      });
    }

    if (update.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Update has already been processed'
      });
    }

    // Apply the update based on type
    if (update.updateType === 'new_generator') {
      const generatorId = update.new_generator_id;
      
      // Check if generator already exists
      const existingGen = await Generator.findById(generatorId);
      
      const generatorData = {
        model: update.model,
        serial_number: update.serial_number,
        manufacturer: update.model?.split(' ')[0] || 'Unknown',
        specifications: {
          fuel_type: update.fuel_type,
          fuel_capacity: update.fuel_capacity,
          power_rating: update.power_rating,
          voltage_output: 220,
          frequency: 50
        },
        current_stats: {
          fuel: update.fuel_level || 100,
          power: update.power_output || 0,
          temperature: update.temperature || 25,
          runtime: update.runtime || 0
        },
        status: update.generator_status,
        tower_id: update.tower_id,
        installation_date: update.installation_date || new Date(),
        maintenance_interval: update.maintenance_interval || 250,
        last_updated: new Date()
      };

      if (existingGen) {
        await Generator.findByIdAndUpdate(generatorId, generatorData);
        logger.info('Generator updated on approval', { generatorId });
      } else {
        const newGenerator = new Generator({
          _id: generatorId,
          ...generatorData,
          created_by: update.submitted_by
        });
        await newGenerator.save();
        logger.info('New generator created on approval', { generatorId });
      }

      // Update tower assignment
      const tower = await Tower.findById(update.tower_id);
      if (tower) {
        try {
          await tower.assignGenerator(generatorId, 'primary');
        } catch (err) {
          logger.warn('Tower assignment warning:', err.message);
        }
      }

      // Update site reference
      await Site.findOneAndUpdate(
        { IHS_ID_SITE: update.site_id },
        { 
          $addToSet: { Current_Generators: generatorId },
          Primary_Generator: generatorId
        }
      );

    } else if (update.updateType === 'status_update') {
      // Update existing generator
      await Generator.findByIdAndUpdate(update.existing_generator_id, {
        status: update.generator_status,
        'current_stats.fuel': update.fuel_level,
        'current_stats.power': update.power_output,
        'current_stats.temperature': update.temperature,
        'current_stats.runtime': update.runtime,
        last_updated_by: update.submitted_by
      });
    }

    // Mark update as approved
    update.status = 'approved';
    update.reviewed_by = req.user._id;
    update.reviewed_at = new Date();
    update.review_comments = req.body.comments;
    await update.save();

    logger.info('Generator update approved', {
      updateId: update._id,
      approvedBy: req.user._id
    });

    res.json({
      success: true,
      data: update,
      message: 'Generator update approved and applied'
    });

  } catch (error) {
    logger.error('Approve generator update error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error approving generator update',
      message: error.message
    });
  }
});

// Reject generator update
router.put('/:id/reject', 
  authenticateToken, 
  requireRole('admin', 'supervisor'), 
  [
    body('comments')
      .isString()
      .isLength({ min: 10 })
      .withMessage('Rejection reason is required (minimum 10 characters)')
  ], 
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const update = await GeneratorUpdate.findById(req.params.id);
      if (!update) {
        return res.status(404).json({
          success: false,
          error: 'Generator update not found'
        });
      }

      if (update.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: 'Update has already been processed'
        });
      }

      update.status = 'rejected';
      update.reviewed_by = req.user._id;
      update.reviewed_at = new Date();
      update.review_comments = req.body.comments;
      await update.save();

      logger.info('Generator update rejected', {
        updateId: update._id,
        rejectedBy: req.user._id
      });

      res.json({
        success: true,
        data: update,
        message: 'Generator update rejected'
      });

    } catch (error) {
      logger.error('Reject generator update error:', error);
      res.status(500).json({
        success: false,
        error: 'Server error rejecting generator update'
      });
    }
  }
);

// Get all generator updates with filters
router.get('/', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;

    const updates = await GeneratorUpdate.find({ status })
      .populate('tower_id', 'name location')
      .populate('existing_generator_id', 'model serial_number')
      .populate('submitted_by', 'fullName role')
      .populate('reviewed_by', 'fullName role')
      .sort({ submitted_at: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await GeneratorUpdate.countDocuments({ status });

    res.json({
      success: true,
      data: updates,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        count: updates.length
      }
    });

  } catch (error) {
    logger.error('Get generator updates error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching generator updates'
    });
  }
});

// Get single generator update
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const update = await GeneratorUpdate.findById(req.params.id)
      .populate('tower_id', 'name location contact_info')
      .populate('existing_generator_id', 'model serial_number status')
      .populate('submitted_by', 'fullName role phone email')
      .populate('reviewed_by', 'fullName role');

    if (!update) {
      return res.status(404).json({
        success: false,
        error: 'Generator update not found'
      });
    }

    res.json({
      success: true,
      data: update
    });

  } catch (error) {
    logger.error('Get generator update error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching generator update'
    });
  }
});

module.exports = router;


