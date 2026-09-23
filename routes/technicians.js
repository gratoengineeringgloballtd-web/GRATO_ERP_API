const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Maintenance = require('../models/Maintenance');
const Site = require('../models/Site');
const User = require('../models/User');
const DailyAttendance = require('../models/DailyAttendance');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const technicianController = require('../controllers/technicianController');
const logger = require('../utils/logger');
const SiteVisit = require('../models/SiteVisit');
const fieldVisitService = require('../services/fieldVisitService');

// ========================================
// SPECIFIC ROUTES - MUST COME FIRST
// ========================================

/**
 * Get available technicians
 * GET /api/technician/available
 * ⚠️ MUST come before /:id
 */
router.get('/available',
  authenticateToken,
  requireRole(['admin', 'supervisor']),
  technicianController.getAvailableTechnicians
);

/**
 * Get technician's own dashboard
 * GET /api/technician/dashboard/me
 * ⚠️ MUST come before /:id
 */
router.get('/dashboard/me',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  technicianController.getTechnicianDashboard
);

/**
 * Get technician dashboard
 * GET /api/technician/dashboard
 * ⚠️ MUST come before /:id
 */
router.get('/dashboard',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;

      // Calculate Action Counts from assigned tasks
      const activeTasks = await Maintenance.find({
        technician: technicianId,
        status: { $in: ['scheduled', 'approved', 'in_progress'] }
      }).select('visit_type');

      const actionCounts = {
        preventive: 0,
        refueling: 0,
        corrective: 0
      };

      activeTasks.forEach(task => {
        const type = task.visit_type || '';
        if (type.includes('PM')) actionCounts.preventive++;
        if (type.includes('RF')) actionCounts.refueling++;
        if (type.includes('END') || type.includes('CM')) actionCounts.corrective++;
      });

      const [
        drafts,
        pendingApproval,
        approved,
        completedThisMonth,
        assignedSites
      ] = await Promise.all([
        Maintenance.countDocuments({
          technician: technicianId,
          status: 'draft'
        }),
        Maintenance.countDocuments({
          technician: technicianId,
          status: 'pending_approval'
        }),
        Maintenance.countDocuments({
          technician: technicianId,
          status: 'approved'
        }),
        Maintenance.countDocuments({
          technician: technicianId,
          status: 'completed',
          completed_at: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }),
        Site.countDocuments({
          Technician_Name: (await User.findById(technicianId)).fullName
        })
      ]);

      res.json({
        success: true,
        data: {
          drafts,
          pending_approval: pendingApproval,
          approved_tasks: approved,
          completed_this_month: completedThisMonth,
          assigned_sites: assignedSites,
          actionCounts
        }
      });

    } catch (error) {
      logger.error('Technician dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard data'
      });
    }
  }
);

/**
 * Get technician's own tasks
 * GET /api/technician/tasks/me
 * ⚠️ MUST come before /:id
 *
 * NOTE: "Tasks" are Maintenance records assigned to the technician.
 * These are the same entities that become "visits" when completed.
 */
router.get('/tasks/me',
  authenticateToken,
  requireRole(['technician']),
  technicianController.getTechnicianTasks
);


// ========================================
// MAINTENANCE WORKFLOW ROUTES
// Keyed by maintenanceId (workflowId === maintenance._id)
// Must come before /maintenance/:id routes
// ========================================

/**
 * Start or resume a maintenance workflow
 * POST /api/technician/maintenance-workflow/start
 */
router.post('/maintenance-workflow/start',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { maintenance_id, technician_id } = req.body;

      if (!maintenance_id) {
        return res.status(400).json({ success: false, error: 'maintenance_id is required' });
      }

      const maintenance = await Maintenance.findById(maintenance_id);
      if (!maintenance) {
        return res.status(404).json({ success: false, error: 'Maintenance record not found' });
      }

      // Verify ownership
      if (maintenance.technician.toString() !== req.user.userId.toString()) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      // If already has an active workflow, return it (idempotent)
      if (maintenance.workflow_status && maintenance.workflow_status !== 'checked_out') {
        return res.json({
          success: true,
          data: {
            _id: maintenance._id,
            workflow_status: maintenance.workflow_status,
            workflow_history: maintenance.workflow_history
          }
        });
      }

      // Flip maintenance status to in_progress if still scheduled/approved
      if (['scheduled', 'approved', 'pending'].includes(maintenance.status)) {
        maintenance.status = 'in_progress';
        if (!maintenance.started_at) {
          maintenance.started_at = new Date();
        }
      }

      maintenance.workflow_status = 'initiated';
      if (!maintenance.workflow_history) maintenance.workflow_history = [];
      maintenance.workflow_history.push({
        status: 'initiated',
        timestamp: new Date(),
        meta: { technicianId: req.user.userId, startedAt: new Date().toISOString() }
      });
      maintenance.workflow_last_updated = new Date();
      maintenance.markModified('workflow_history');

      await maintenance.save();

      logger.info('Maintenance workflow started', {
        maintenanceId: maintenance_id,
        technician: req.user.userId
      });

      res.json({
        success: true,
        data: {
          _id: maintenance._id,
          workflow_status: maintenance.workflow_status,
          workflow_history: maintenance.workflow_history
        }
      });

    } catch (error) {
      logger.error('Maintenance workflow start error:', error);
      res.status(500).json({ success: false, error: 'Failed to start workflow', message: error.message });
    }
  }
);

/**
 * Get active (non-completed) workflow for a maintenance task
 * GET /api/technician/maintenance-workflow/active/:maintenanceId
 * ⚠️ MUST come before /maintenance-workflow/:workflowId
 */
router.get('/maintenance-workflow/active/:maintenanceId',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { maintenanceId } = req.params;

      const maintenance = await Maintenance.findById(maintenanceId)
        .select('_id workflow_status workflow_history workflow_last_updated status technician');

      if (!maintenance) {
        // Return null data (not 404) — caller treats null as "no active workflow"
        return res.json({ success: true, data: null });
      }

      // Verify ownership
      if (maintenance.technician.toString() !== req.user.userId.toString()) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      // No active workflow yet, or already fully checked out
      if (!maintenance.workflow_status || maintenance.workflow_status === 'checked_out') {
        return res.json({ success: true, data: null });
      }

      res.json({
        success: true,
        data: {
          _id: maintenance._id,
          workflow_status: maintenance.workflow_status,
          workflow_history: maintenance.workflow_history,
          workflow_last_updated: maintenance.workflow_last_updated
        }
      });

    } catch (error) {
      logger.error('Get active maintenance workflow error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch workflow', message: error.message });
    }
  }
);

/**
 * Get workflow by workflowId (which is the maintenance _id)
 * GET /api/technician/maintenance-workflow/:workflowId
 */
router.get('/maintenance-workflow/:workflowId',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { workflowId } = req.params;

      const maintenance = await Maintenance.findById(workflowId)
        .select('_id workflow_status workflow_history workflow_last_updated status technician site_id site_name');

      if (!maintenance) {
        return res.status(404).json({ success: false, error: 'Workflow not found' });
      }

      // Verify ownership
      if (maintenance.technician.toString() !== req.user.userId.toString()) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      res.json({ success: true, data: maintenance });

    } catch (error) {
      logger.error('Get maintenance workflow error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch workflow', message: error.message });
    }
  }
);

/**
 * Patch a status step on the workflow
 * PATCH /api/technician/maintenance-workflow/:workflowId/status
 */
router.patch('/maintenance-workflow/:workflowId/status',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { workflowId } = req.params;
      const { status, meta } = req.body;

      const VALID_STATUSES = ['activated', 'checked_in', 'form_opened', 'form_submitted', 'checked_out'];

      if (!status || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
        });
      }

      const maintenance = await Maintenance.findById(workflowId);
      if (!maintenance) {
        return res.status(404).json({ success: false, error: 'Workflow not found' });
      }

      // Verify ownership
      if (maintenance.technician.toString() !== req.user.userId.toString()) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      // Idempotent: if this status is already in history, skip duplicate push
      const alreadyPatched = (maintenance.workflow_history || []).some(h => h.status === status);
      if (!alreadyPatched) {
        if (!maintenance.workflow_history) maintenance.workflow_history = [];
        maintenance.workflow_history.push({
          status,
          timestamp: new Date(),
          meta: meta || {}
        });
        maintenance.markModified('workflow_history');
      }

      maintenance.workflow_status = status;
      maintenance.workflow_last_updated = new Date();

      // Side effects on certain statuses
      if (status === 'form_submitted') {
        // Move to pending_approval when form is submitted
        if (maintenance.status === 'in_progress') {
          maintenance.status = 'pending_approval';
          maintenance.submitted_at = new Date();
        }
      }

      await maintenance.save();

      logger.info('Maintenance workflow status patched', {
        maintenanceId: workflowId,
        status,
        technician: req.user.userId
      });

      res.json({
        success: true,
        data: {
          _id: maintenance._id,
          workflow_status: maintenance.workflow_status,
          workflow_history: maintenance.workflow_history,
          workflow_last_updated: maintenance.workflow_last_updated
        }
      });

    } catch (error) {
      logger.error('Patch maintenance workflow status error:', error);
      res.status(500).json({ success: false, error: 'Failed to update workflow status', message: error.message });
    }
  }
);

/**
 * PATCH alias for submitting maintenance for approval
 * PATCH /api/technician/maintenance/:id/submit
 * (mirrors existing POST /maintenance/:id/submit — keeps frontend as-is)
 * ⚠️ MUST come before /maintenance/:id
 */
router.patch('/maintenance/:id/submit',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { workflowId, work_performed, issues_found } = req.body;
      const technicianId = req.user.userId;

      const maintenance = await Maintenance.findById(id);
      if (!maintenance) {
        return res.status(404).json({ success: false, error: 'Maintenance record not found' });
      }

      if (req.user.role === 'ac') {
        const required = Array.isArray(maintenance.required_actions) ? maintenance.required_actions : [];
        const disallowed = required.filter(a => !['shelter', 'cleaning'].includes(String(a).toLowerCase()));
        if (disallowed.length > 0) {
          return res.status(403).json({
            success: false,
            error: 'AC technicians can only submit shelter and site cleaning checks'
          });
        }
      }

      if (maintenance.technician.toString() !== technicianId.toString()) {
        return res.status(403).json({ success: false, error: 'You can only submit your own tasks' });
      }

      // Allow submission from in_progress or if workflow is pushing form_submitted
      if (!['in_progress', 'pending_approval'].includes(maintenance.status)) {
        return res.status(400).json({
          success: false,
          error: 'Can only submit in-progress maintenance'
        });
      }

      if (work_performed) maintenance.work_performed = work_performed;
      if (issues_found) maintenance.issues_found = issues_found;

      maintenance.status = 'pending_approval';
      maintenance.submitted_at = new Date();

      await maintenance.save();

      logger.info('Maintenance submitted (PATCH alias)', {
        maintenance_id: maintenance.maintenance_id,
        technician: technicianId
      });

      res.json({
        success: true,
        message: 'Maintenance submitted for approval',
        data: {
          maintenance_id: maintenance.maintenance_id,
          status: maintenance.status,
          submitted_at: maintenance.submitted_at
        }
      });

    } catch (error) {
      logger.error('PATCH submit maintenance error:', error);
      res.status(500).json({ success: false, error: 'Failed to submit maintenance', message: error.message });
    }
  }
);

/**
 * Get all maintenance tasks for technician
 * GET /api/technician/maintenance/tasks
 * ⚠️ MUST come before /maintenance/:id
 *
 * Returns Maintenance records (unified task/visit entities)
 * filtered by the authenticated technician
 */
router.get('/maintenance/tasks',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const { status, page = 1, limit = 50 } = req.query;

      // Get all maintenance records for this technician
      const maintenance = await Maintenance.find({ technician: technicianId })
        .populate('supervisor', 'fullName email phone')
        .sort({ visit_date: -1 })
        .lean();

      console.log(`\n=== GET TECHNICIAN TASKS ===`);
      console.log(`Technician: ${technicianId}`);
      console.log(`Found ${maintenance.length} maintenance records`);

      // Extract individual equipment checks as separate items
      const equipmentCheckItems = [];
      
      const isAcTechnician = req.user.role === 'ac';

      for (const record of maintenance) {
        
        console.log(`\nRecord: ${record._id}`);
        
        const checkTypes = [
          { key: 'cleaning_checks', type: 'cleaning', title: 'Site Cleaning', icon: 'brush' },
          { key: 'grid_checks', type: 'grid', title: 'Grid Power', icon: 'flash' },
          { key: 'generator_checks', type: 'generator', title: 'Generator Check', icon: 'settings' },
          { key: 'shelter_checks', type: 'shelter', title: 'Shelter Inspection', icon: 'home' },
          { key: 'fuel_tank_checks', type: 'fuel_tank', title: 'Fuel Tank', icon: 'water' },
          { key: 'power_cabinet_checks', type: 'power_cabinet', title: 'Power Cabinet', icon: 'cube' }
        ];
        const allowedCheckTypes = isAcTechnician
          ? checkTypes.filter(ct => ['shelter', 'cleaning'].includes(ct.type))
          : checkTypes;

        // 1. Process EXISTING checks that have data
        if (record.equipment_checks) {
            console.log('Equipment checks found:', JSON.stringify(record.equipment_checks, null, 2));

            for (const checkType of allowedCheckTypes) {
              const checkData = record.equipment_checks[checkType.key];
              if (!checkData) continue;
              
              // Determine which status field to check
              const statusField = ['generator_checks', 'power_cabinet_checks'].includes(checkType.key) ? 'status' : 'check_status';
              const checkStatus = checkData[statusField] || 'draft';
              
              console.log(`  Check: ${checkType.type}`);
              console.log(`  Status field: ${statusField}`);
              console.log(`  Status: ${checkStatus}`);
              
              // Check if this check has actual data (not just empty Mongoose object)
              let hasData = false;
              if (Array.isArray(checkData)) {
                hasData = checkData.length > 0;
              } else if (typeof checkData === 'object') {
                // Check for specific fields based on type (support both camelCase and snake_case)
                if (checkType.type === 'cleaning') {
                  hasData = checkData.isClean !== undefined || checkData.is_clean !== undefined || 
                            checkData.spillage !== undefined || checkData.securityLight !== undefined || 
                            checkData.security_light !== undefined;
                } else if (checkType.type === 'grid') {
                  hasData = checkData.gridStatus !== undefined || checkData.status !== undefined || 
                            checkData.breakerStatus !== undefined || checkData.breaker_status !== undefined;
                } else if (checkType.type === 'shelter') {
                  hasData = checkData.shelterStatus !== undefined || checkData.status !== undefined || 
                            checkData.doorStatus !== undefined || checkData.door_status !== undefined;
                } else if (checkType.type === 'fuel_tank') {
                  hasData = checkData.tankStatus !== undefined || checkData.status !== undefined || 
                            checkData.waterInTank !== undefined || checkData.water_in_tank !== undefined;
                } else {
                  hasData = Object.keys(checkData).some(k => !['_id', 'checked_at', 'checked_by', 'status', 'check_status', 'submitted_at'].includes(k) && checkData[k] !== undefined);
                }
              }
              
              console.log(`  Has data: ${hasData}`);
              
              // Trust the status! If it's pending_approval, the technician explicitly submitted it.
              // We shouldn't second-guess them with the hasData check.
              if (!hasData && checkStatus !== 'pending_approval') {
                console.log(`  ⏭️ Skipping - no actual data and not submitted`);
                continue;
              }
              
              console.log(`  ✅ Adding to list`);
              
              const site = await Site.findOne({ IHS_ID_SITE: record.site_id })
                .select('Site_Name Region GRATO_Cluster Latitude Longitude')
                .lean();
              
              equipmentCheckItems.push({
                _id: `${record._id}_${checkType.type}`,
                maintenance_id: record._id,
                check_type: checkType.type,
                check_title: checkType.title,
                check_icon: checkType.icon,
                site_id: record.site_id,
                site_name: site?.Site_Name || record.site_id,
                site_details: site,
                visit_date: record.visit_date,
                status: checkStatus,
                checked_at: checkData.checked_at,
                submitted_at: checkData.submitted_at,
                check_data: checkData,
                supervisor: record.supervisor
              });
            }
        } // End existing checks processing

        // 2. Process REQUIRED/PLANNED checks that are NOT started/empty
        // "It is these that are supposed to be pulled"
        if (record.required_actions && Array.isArray(record.required_actions)) {
            const site = await Site.findOne({ IHS_ID_SITE: record.site_id })
                .select('Site_Name Region GRATO_Cluster Latitude Longitude')
                .lean();

            for (const requiredAction of record.required_actions) {
                 const type = requiredAction.toLowerCase();
                 // Find matching checkType definition
                 let typeDef = allowedCheckTypes.find(ct => ct.type === type);
                 if (!typeDef) {
                   if (isAcTechnician) {
                     continue;
                   }
                   // Fallback for custom names logic matching required_actions
                   typeDef = { 
                     type: type, 
                     title: type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                     icon: 'clipboard'
                   };
                 }

                 // Check if already added in step 1
                 const alreadyAdded = equipmentCheckItems.some(
                     item => item.maintenance_id.toString() === record._id.toString() && item.check_type === typeDef.type
                 );

                 if (!alreadyAdded) {
                     // Add as "pending" or "scheduled" (mobile app might expect 'draft' or 'scheduled')
                     // Let's call it 'scheduled' if the whole task is scheduled, or 'draft' if work started on others
                     const displayStatus = ['scheduled', 'approved'].includes(record.status) ? 'scheduled' : 'draft';

                     equipmentCheckItems.push({
                        _id: `${record._id}_${typeDef.type}_planned`,
                        maintenance_id: record._id,
                        check_type: typeDef.type,
                        check_title: typeDef.title,
                        check_icon: typeDef.icon,
                        site_id: record.site_id,
                        site_name: site?.Site_Name || record.site_id,
                        site_details: site,
                        visit_date: record.visit_date,
                        status: displayStatus,
                        // No checked_at/submitted_at yet
                        check_data: {}, 
                        supervisor: record.supervisor
                     });
                 }
            }
        }

      } // End maintenance loop
      
      console.log(`\nTotal equipment checks found: ${equipmentCheckItems.length}`);
      console.log(`Statuses:`, equipmentCheckItems.map(i => `${i.check_type}:${i.status}`).join(', '));
      
      // Filter by status if provided
      let filteredItems = equipmentCheckItems;
      if (isAcTechnician) {
        filteredItems = filteredItems.filter(item => ['shelter', 'cleaning'].includes(item.check_type));
      }
      if (status) {
        filteredItems = equipmentCheckItems.filter(item => item.status === status);
      } else {
        // Default: show scheduled, draft, pending_approval, and approved checks (exclude only completed/rejected)
        filteredItems = equipmentCheckItems.filter(item => 
          ['scheduled', 'draft', 'pending_approval', 'approved'].includes(item.status)
        );
      }
      
      // Sort by visit_date (most recent first), then by submitted_at
      filteredItems.sort((a, b) => {
        const dateA = new Date(a.visit_date);
        const dateB = new Date(b.visit_date);
        const visitDiff = dateB - dateA;
        
        // If same visit date, sort by submitted_at/checked_at
        if (visitDiff === 0) {
          const subDateA = new Date(a.submitted_at || a.checked_at || 0);
          const subDateB = new Date(b.submitted_at || b.checked_at || 0);
          return subDateB - subDateA;
        }
        
        return visitDiff;
      });
      
      // Pagination
      const skip = (page - 1) * limit;
      const paginatedItems = filteredItems.slice(skip, skip + parseInt(limit));
      const total = filteredItems.length;

      res.json({
        success: true,
        data: paginatedItems,
        pagination: {
          current: parseInt(page),
          pageSize: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      logger.error('Get technician tasks error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch tasks'
      });
    }
  }
);

/**
 * Get assigned maintenance tasks
 * GET /api/technician/maintenance/assigned
 * ⚠️ MUST come before /maintenance/:id
 */
router.get('/maintenance/assigned',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const { status, page = 1, limit = 20 } = req.query;

      const query = { technician: technicianId };

      if (status) {
        // Handle comma-separated status values
        if (typeof status === 'string' && status.includes(',')) {
          query.status = { $in: status.split(',').map(s => s.trim()) };
        } else {
          query.status = status;
        }
      } else {
        // By default, show scheduled and in_progress
        query.status = { $in: ['scheduled', 'in_progress'] };
      }

      const skip = (page - 1) * limit;

      const maintenance = await Maintenance.find(query)
        .populate({
          path: 'supervisor',
          select: 'fullName email phone'
        })
        .populate({
          path: 'parts_used.part_id',
          select: 'name part_number category stock'
        })
        .sort({ visit_date: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      // Enrich with site information
      const enrichedMaintenance = await Promise.all(
        maintenance.map(async (item) => {
          // Support both old 'tower' field and new 'site_id' field
          const siteId = item.site_id || item.tower;
          
          const site = await Site.findOne({ IHS_ID_SITE: siteId })
            .select('Site_Name Region IHS_ID_SITE location GRATO_Cluster Sites_Priority')
            .lean();

          return {
            ...item,
            site_details: site ? {
              Site_Name: site.Site_Name,
              Region: site.Region,
              IHS_ID_SITE: site.IHS_ID_SITE,
              location: site.location,
              cluster: site.GRATO_Cluster,
              priority: site.Sites_Priority
            } : null,
            // Keep legacy tower field for backward compatibility
            tower: item.tower || siteId
          };
        })
      );

      const total = await Maintenance.countDocuments(query);

      res.status(200).json({
        success: true,
        count: enrichedMaintenance.length,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        data: enrichedMaintenance
      });
    } catch (error) {
      console.error('Error fetching assigned maintenance:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch assigned maintenance',
        message: error.message
      });
    }
  }
);

/**
 * Submit maintenance visit for approval
 * POST /api/technician/maintenance/submit
 * ⚠️ MUST come before /maintenance/:id
 */
router.post('/maintenance/submit',
  authenticateToken,
  requireRole(['technician']),
  technicianController.submitVisit
);

/**
 * Save maintenance visit as draft
 * POST /api/technician/maintenance/draft
 * ⚠️ MUST come before /maintenance/:id
 */
router.post('/maintenance/draft',
  authenticateToken,
  requireRole(['technician']),
  technicianController.saveDraft
);

/**
 * Get assigned sites for technician
 * GET /api/technician/sites
 * ⚠️ MUST come before /:id - CRITICAL ROUTE
 * Returns only sites that have been scheduled to this technician by supervisor
 */
router.get('/sites',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const Maintenance = require('../models/Maintenance');

      // 1. Get Technician Details
      const technician = await User.findById(technicianId);
      if (!technician) {
        return res.status(404).json({ success: false, error: 'Technician not found' });
      }

      // 2. Get ALL assigned sites
      // This ensures technicians can see sites even if no maintenance is scheduled (e.g. for emergency checks)
      const assignedSites = await Site.find({
        $or: [
            { Technician_Name: technician.fullName },
            { technician_id: technicianId } 
        ]
      })
      .select('IHS_ID_SITE Site_Name Region GRATO_Cluster Actual_Date_Visit Type_of_Visit Latitude Longitude Current_Generators Technician_Name')
      .sort({ Site_Name: 1 })
      .lean();

      // 3. Get all relevant maintenance tasks
      const maintenanceTasks = await Maintenance.find({
        technician: technicianId,
        status: { $in: ['approved', 'scheduled', 'in_progress', 'pending', 'pending_approval', 'completed'] }
      })
        .select('site_id visit_date visit_type priority required_actions equipment_checks status')
        .sort({ visit_date: 1 })
        .lean();

      // 4. Merge Data & Handle Delegated Sites
      // Start with assigned sites
      const sitesMap = new Map();
      assignedSites.forEach(s => sitesMap.set(s.IHS_ID_SITE, { ...s, next_maintenance: null }));

      // Add sites from maintenance tasks that might not be permanently assigned
      const delegatedSiteIds = maintenanceTasks
        .map(t => t.site_id)
        .filter(id => !sitesMap.has(id));

      if (delegatedSiteIds.length > 0) {
        const delegatedSites = await Site.find({ IHS_ID_SITE: { $in: delegatedSiteIds } })
            .select('IHS_ID_SITE Site_Name Region GRATO_Cluster Actual_Date_Visit Type_of_Visit Latitude Longitude Current_Generators Technician_Name')
            .lean();
        delegatedSites.forEach(s => sitesMap.set(s.IHS_ID_SITE, { ...s, next_maintenance: null }));
      }

      // Attach maintenance info
      const enrichedSites = Array.from(sitesMap.values()).map(site => {
         const siteTasks = maintenanceTasks.filter(task => task.site_id === site.IHS_ID_SITE);
         let nextMaintenance = null;
         
         if (siteTasks.length > 0) {
             // Prefer active/scheduled, else take first
             nextMaintenance = siteTasks.find(t => ['in_progress', 'scheduled'].includes(t.status)) || siteTasks[0];
         }

         if (nextMaintenance) {
            return {
                ...site,
                next_maintenance: {
                    maintenance_id: nextMaintenance._id,
                    date: nextMaintenance.visit_date,
                    type: nextMaintenance.visit_type,
                    priority: nextMaintenance.priority,
                    status: nextMaintenance.status,
                    remaining_actions: nextMaintenance.required_actions?.length || 0
                }
            };
         }
         return site;
      });

      res.json({
        success: true,
        data: enrichedSites,
        count: enrichedSites.length
      });

    } catch (error) {
      logger.error('Technician sites error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch sites'
      });
    }
  }
);

/**
 * Get visit history for technician
 * GET /api/technician/visit-history
 * ⚠️ MUST come before /:id
 */
router.get('/visit-history',
  authenticateToken,
  requireRole(['technician', 'admin', 'supervisor']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const { page = 1, limit = 20, start_date, end_date } = req.query;

      // Get technician name
      const technician = await User.findById(technicianId).select('fullName');

      // Build query
      const query = {
        'visit_history.technician_id': technicianId
      };

      if (start_date || end_date) {
        query['visit_history.Actual_Date_Visit'] = {};
        if (start_date) query['visit_history.Actual_Date_Visit'].$gte = new Date(start_date);
        if (end_date) query['visit_history.Actual_Date_Visit'].$lte = new Date(end_date);
      }

      // Find sites with visits
      const sites = await Site.find(query)
        .select('IHS_ID_SITE Site_Name Region visit_history')
        .lean();

      // Extract visits for this technician
      let allVisits = [];
      sites.forEach(site => {
        site.visit_history?.forEach(visit => {
          if (visit.technician_id?.toString() === technicianId.toString()) {
            allVisits.push({
              ...visit,
              site_id: site.IHS_ID_SITE,
              Site_Name: site.Site_Name,
              Region: site.Region
            });
          }
        });
      });

      // Sort by date (newest first)
      allVisits.sort((a, b) =>
        new Date(b.Actual_Date_Visit) - new Date(a.Actual_Date_Visit)
      );

      // Pagination
      const total = allVisits.length;
      const startIdx = (page - 1) * limit;
      const paginatedVisits = allVisits.slice(startIdx, startIdx + parseInt(limit));

      res.json({
        success: true,
        data: paginatedVisits,
        pagination: {
          current: parseInt(page),
          pageSize: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      logger.error('Get visit history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch visit history'
      });
    }
  }
);

/**
 * Get technician notifications
 * GET /api/technician/notifications
 * ⚠️ MUST come before /:id
 */
router.get('/notifications',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const Notification = require('../models/Notifications');
      const notifications = await Notification.find({
        recipient: req.user._id
      })
        .sort({ createdAt: -1 })
        .limit(50);

      res.json({
        success: true,
        data: notifications
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch notifications'
      });
    }
  }
);

/**
 * Mark notification as read
 * PATCH /api/technician/notifications/:id/read
 * ⚠️ MUST come before /:id
 */
router.patch('/notifications/:id/read',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const Notification = require('../models/Notifications');
      const notification = await Notification.findOneAndUpdate(
        { _id: req.params.id, recipient: req.user._id },
        { read: true, readAt: new Date() },
        { new: true }
      );

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      res.json({
        success: true,
        data: notification
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update notification'
      });
    }
  }
);

/**
 * Get current active visit
 * GET /api/technician/visit/current
 * ⚠️ MUST come before /:id
 */
router.get('/visit/current',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      
      const activeVisit = await SiteVisit.findOne({
        technician: technicianId,
        status: 'active'
      }).sort({ check_in_time: -1 });

      res.json({
        success: true,
        data: activeVisit
      });
    } catch (error) {
      logger.error('Get current visit error:', error);
      res.status(500).json({ success: false, error: 'Failed' });
    }
  }
);

/**
 * Daily Check In
 * POST /api/technician/daily-check-in
 * ⚠️ MUST come before /:id
 */
router.post('/daily-check-in',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const { location } = req.body;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const existing = await DailyAttendance.findOne({
        technician: technicianId,
        date: today
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Already checked in for today',
          data: existing
        });
      }

      const attendance = new DailyAttendance({
        technician: technicianId,
        date: today,
        checkInTime: new Date(),
        location: location,
        status: 'checked-in'
      });

      await attendance.save();

      res.json({
        success: true,
        message: 'Checked in successfully',
        data: attendance
      });
    } catch (error) {
      logger.error('Daily check-in error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Get Daily Check In Status
 * GET /api/technician/daily-status
 * ⚠️ MUST come before /:id
 */
router.get('/daily-status',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const attendance = await DailyAttendance.findOne({
        technician: technicianId,
        date: today
      });

      res.json({
        success: true,
        checkedIn: !!attendance,
        data: attendance
      });
    } catch (error) {
      logger.error('Daily status error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Check In
 * POST /api/technician/visit/check-in
 * ⚠️ MUST come before /:id
 */
router.post('/visit/check-in',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const { site_id, site_name, location, maintenance_id, maintenanceId } = req.body;
      const maintenanceRef = maintenance_id || maintenanceId;

      // Check if already checked in
      const existing = await SiteVisit.findOne({
        technician: technicianId,
        status: 'active'
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'You are already checked in at ' + existing.site_name
        });
      }

      let maintenanceDoc = null;
      if (maintenanceRef && mongoose.Types.ObjectId.isValid(maintenanceRef)) {
        maintenanceDoc = await Maintenance.findById(maintenanceRef);
      }

      const visit = new SiteVisit({
        technician: technicianId,
        site_id,
        site_name,
        check_in_time: new Date(),
        check_in_location: location,
        status: 'active',
        maintenance_id: maintenanceDoc ? maintenanceDoc._id : undefined
      });

      await visit.save();

      if (maintenanceDoc) {
        maintenanceDoc.site_entries = maintenanceDoc.site_entries || [];
        maintenanceDoc.site_entries.push({
          technician: technicianId,
          site_id,
          entry_time: visit.check_in_time,
          entry_location: location
        });
        maintenanceDoc.markModified('site_entries');
        await maintenanceDoc.save();
      }

      res.json({
        success: true,
        message: 'Checked in successfully',
        data: visit
      });
    } catch (error) {
      logger.error('Check-in error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Check Out
 * POST /api/technician/visit/check-out
 * ⚠️ MUST come before /:id
 */
router.post('/visit/check-out',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const { location, notes } = req.body;

      const visit = await SiteVisit.findOne({
        technician: technicianId,
        status: 'active'
      });

      if (!visit) {
        return res.status(400).json({
          success: false,
          error: 'No active visit found'
        });
      }

      const now = new Date();
      const duration = Math.round((now - visit.check_in_time) / (1000 * 60)); // minutes

      visit.check_out_time = now;
      visit.check_out_location = location;
      visit.duration_minutes = duration;
      visit.status = 'completed';
      visit.notes = notes;
      
      visit.markModified('status');
      visit.status = 'completed';

      await visit.save();

      if (visit.maintenance_id && mongoose.Types.ObjectId.isValid(visit.maintenance_id)) {
        const maintenanceDoc = await Maintenance.findById(visit.maintenance_id);
        if (maintenanceDoc && Array.isArray(maintenanceDoc.site_entries)) {
          for (let i = maintenanceDoc.site_entries.length - 1; i >= 0; i -= 1) {
            const entry = maintenanceDoc.site_entries[i];
            const sameTech = entry.technician && entry.technician.toString() === technicianId.toString();
            const sameSite = entry.site_id === visit.site_id;
            if (!entry.exit_time && sameTech && sameSite) {
              entry.exit_time = now;
              entry.exit_location = location;
              if (notes) {
                entry.notes = notes;
              }
              break;
            }
          }
          maintenanceDoc.markModified('site_entries');
          await maintenanceDoc.save();
        }
      }

      res.json({
        success: true,
        message: 'Checked out successfully',
        data: visit
      });
    } catch (error) {
      logger.error('Check-out error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);




router.get('/refuel/sites',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const technician = await User.findById(technicianId);
      if (!technician) {
        return res.status(404).json({ success: false, error: 'Technician not found' });
      }

      // ── Step 1: ALL assigned sites — same query /technician/sites uses ───────
      const assignedSites = await Site.find({
        $or: [
          { Technician_Name: technician.fullName },
          { technician_id: technicianId },
        ],
      })
        .select('IHS_ID_SITE Site_Name Previous_Fuel_Quantity Fuel_Quantity_Found Fuel_Quantity_Added Tank_Capacity_1 Actual_Date_Visit Fuel_Level_Source Fuel_Level_Updated_At')
        .lean();

      // ── Step 2: RF-type tasks for this technician — attach where they match ──
      const refuelTasks = await Maintenance.find({
        technician: technicianId,
        visit_type: { $regex: /RF/i },
        status: { $in: ['approved', 'scheduled', 'in_progress'] },
      }).select('site_id visit_date priority status');

      const taskBySiteId = new Map(refuelTasks.map((t) => [String(t.site_id), t]));

      // ── Step 3: also pick up any RF-scheduled site not already in assignedSites ──
      // (mirrors the "delegated sites" handling in /technician/sites — keeps this
      // endpoint's prior behavior of surfacing RF tasks even for sites not
      // permanently assigned to this technician)
      const assignedIds = new Set(assignedSites.map((s) => s.IHS_ID_SITE));
      const delegatedSiteIds = refuelTasks
        .map((t) => t.site_id)
        .filter((id) => id && !assignedIds.has(id));

      let delegatedSites = [];
      if (delegatedSiteIds.length > 0) {
        delegatedSites = await Site.find({ IHS_ID_SITE: { $in: delegatedSiteIds } })
          .select('IHS_ID_SITE Site_Name Previous_Fuel_Quantity Fuel_Quantity_Added Fuel_Quantity_Found Tank_Capacity_1 Actual_Date_Visit Fuel_Level_Source Fuel_Level_Updated_At')
          .lean();
      }

      const allSites = [...assignedSites, ...delegatedSites];

      // ── Step 4: build response rows — enrich each site with fuel/workflow data ──
      const FuelConsumption = require('../models/FuelConsumption');

      const enrichedSites = await Promise.all(allSites.map(async (site) => {
        const task = taskBySiteId.get(String(site.IHS_ID_SITE));

        const currentLevel = site.Fuel_Quantity_Found || site.Previous_Fuel_Quantity || 0;
        // NOTE: schema field is Tank_Capacity_1 (not Tank_Capacity) — using the
        // wrong name here silently returned undefined and fell back to a flat
        // 5000L for every site regardless of actual tank size. Fixed to read
        // the real field, with 5000L kept only as a last-resort default when
        // a site genuinely has no tank capacity on file.
        const capacity = site.Tank_Capacity_1 || 5000;
        const percentage = capacity > 0 ? Math.round((currentLevel / capacity) * 100) : 0;
        // Distinguishes "tank is genuinely at 0%" from "we have no reading
        // for this site at all" — Fuel_Level_Source is only ever set once a
        // real field-visit or tank-telemetry reading has actually happened
        // (see models/Site.js). Without this, both cases render identically
        // as "0%" in the mobile UI, which can misleadingly read as an
        // urgent empty-tank alert when it's really just missing data.
        const hasFuelData = !!site.Fuel_Level_Source;

        const latestRecord = await FuelConsumption.findOne({ site_id: String(site._id) })
          .sort({ record_date: -1 })
          .select('workflow_status refuel_submitted');

        let lastRefuelDate = site.Actual_Date_Visit;
        if (!lastRefuelDate || isNaN(new Date(lastRefuelDate).getTime()) || String(lastRefuelDate).startsWith('+0459')) {
          lastRefuelDate = null;
        }

        return {
          _id: site._id,
          name: site.Site_Name,
          site_id: site.IHS_ID_SITE,
          currentFuelLevel: currentLevel,
          tankCapacity: capacity,
          percentage,
          hasFuelData,
          fuelLevelSource: site.Fuel_Level_Source || null,
          fuelLevelUpdatedAt: site.Fuel_Level_Updated_At || null,
          lastRefuelDate,
          scheduledDate: task?.visit_date || null,
          maintenanceId: task?._id || null,
          priority: task?.priority || null,
          visit_type: task ? 'RF' : null,
          status: task?.status || null,
          workflow_status: latestRecord ? latestRecord.workflow_status : undefined,
          refuel_submitted: latestRecord ? latestRecord.refuel_submitted : undefined,
        };
      }));

      // Filter out completed or refuel_submitted sites (same as before)
      const filteredSites = enrichedSites.filter((site) => {
        return site.workflow_status !== 'completed' && site.refuel_submitted !== true;
      });

      // Priority sort: scheduled sites with a priority first, unscheduled last
      const priorityOrder = { critical: 1, high: 2, medium: 3, low: 4 };
      const sortedSites = filteredSites.sort((a, b) => {
        const pa = (a.priority || '').toLowerCase();
        const pb = (b.priority || '').toLowerCase();
        return (priorityOrder[pa] || 99) - (priorityOrder[pb] || 99);
      });

      const cardSites = sortedSites.map((site) => ({
        _id: site._id,
        name: site.name,
        site_id: site.site_id,
        priority: site.priority || null,
        currentFuelLevel: site.currentFuelLevel,
        tankCapacity: site.tankCapacity,
        percentage: site.percentage,
        lastRefuelDate: site.lastRefuelDate,
        scheduledDate: site.scheduledDate,
        maintenanceId: site.maintenanceId,
        maintenance_status: site.status || null,
        workflow_status: site.workflow_status,
        refuel_submitted: site.refuel_submitted,
      }));

      res.json({
        success: true,
        data: cardSites,
      });

    } catch (error) {
      logger.error('Get refuel sites error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch refueling sites',
      });
    }
  }
);





/**
 * Mark maintenance as started
 * POST /api/technician/maintenance/:id/start
 * ⚠️ MUST come before /maintenance/:id
 */
router.post('/maintenance/:id/start',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const technicianId = req.user.userId;

      const maintenance = await Maintenance.findById(id);
      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Verify ownership
      if (maintenance.technician.toString() !== technicianId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only start your own tasks'
        });
      }

      // Must be approved or scheduled
      if (!['approved', 'scheduled'].includes(maintenance.status)) {
        return res.status(400).json({
          success: false,
          message: 'Can only start approved or scheduled maintenance'
        });
      }

      const oldStatus = maintenance.status;
      maintenance.status = 'in_progress';
      maintenance.logEdit(
        technicianId,
        { status: { old: oldStatus, new: 'in_progress' } },
        'Started work'
      );

      await maintenance.save();

      logger.info('Maintenance started', {
        maintenance_id: maintenance.maintenance_id,
        technician: technicianId
      });

      res.json({
        success: true,
        message: 'Maintenance started',
        data: {
          maintenance_id: maintenance.maintenance_id,
          status: maintenance.status
        }
      });

    } catch (error) {
      logger.error('Start maintenance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start maintenance'
      });
    }
  }
);

/**
 * Mark maintenance as completed
 * POST /api/technician/maintenance/:id/complete
 * ⚠️ MUST come before /maintenance/:id
 */
router.post('/maintenance/:id/complete',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { completion_notes } = req.body;
      const technicianId = req.user.userId;

      const maintenance = await Maintenance.findById(id);
      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Verify ownership
      if (maintenance.technician.toString() !== technicianId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only complete your own tasks'
        });
      }

      // Must be approved or in_progress
      if (!['approved', 'in_progress'].includes(maintenance.status)) {
        return res.status(400).json({
          success: false,
          message: 'Can only complete approved or in-progress maintenance'
        });
      }

      await maintenance.markComplete(completion_notes);

      logger.info('Maintenance completed', {
        maintenance_id: maintenance.maintenance_id,
        technician: technicianId,
        duration: maintenance.actual_duration
      });

      res.json({
        success: true,
        message: 'Maintenance marked as completed',
        data: {
          maintenance_id: maintenance.maintenance_id,
          status: maintenance.status,
          completed_at: maintenance.completed_at,
          actual_duration: maintenance.actual_duration
        }
      });

    } catch (error) {
      logger.error('Complete maintenance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to complete maintenance'
      });
    }
  }
);

/**
 * Submit maintenance for approval (after all checks completed)
 * POST /api/technician/maintenance/:id/submit
 * ⚠️ MUST come before /maintenance/:id
 */
router.post('/maintenance/:id/submit',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { work_performed, issues_found } = req.body;
      const technicianId = req.user.userId;

      const maintenance = await Maintenance.findById(id);
      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      if (req.user.role === 'ac') {
        const required = Array.isArray(maintenance.required_actions)
          ? maintenance.required_actions
          : [];
        const disallowed = required.filter(action => !['shelter', 'cleaning'].includes(String(action).toLowerCase()));
        if (disallowed.length > 0) {
          return res.status(403).json({
            success: false,
            message: 'AC technicians can only submit maintenance for shelter and site cleaning'
          });
        }
      }

      // Verify ownership
      if (maintenance.technician.toString() !== technicianId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only submit your own tasks'
        });
      }

      // Must be in_progress
      if (maintenance.status !== 'in_progress') {
        return res.status(400).json({
          success: false,
          message: 'Can only submit in-progress maintenance'
        });
      }

      // Update work performed and issues
      if (work_performed) maintenance.work_performed = work_performed;
      if (issues_found) maintenance.issues_found = issues_found;

      // Submit for approval
      maintenance.status = 'pending_approval';
      maintenance.submitted_at = new Date();
      await maintenance.save();

      setImmediate(async () => {
        try {
          await fieldVisitService.createFromEquipmentChecks(id, {
            submitted_by: req.user._id || req.user.userId,
          });
        } catch (fvErr) {
          logger.error(`[TechnicianRoute] FieldVisitRecord on submit failed for ${id}: ${fvErr.message}`);
        }
      });

      logger.info('Maintenance submitted for approval', {
        maintenance_id: maintenance.maintenance_id,
        technician: technicianId,
        status: maintenance.status
      });

      res.json({
        success: true,
        message: 'Maintenance submitted for approval',
        data: {
          maintenance_id: maintenance.maintenance_id,
          status: maintenance.status,
          submitted_at: maintenance.submitted_at
        }
      });

    } catch (error) {
      logger.error('Submit maintenance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to submit maintenance',
        message: error.message
      });
    }
  }
);

/**
 * Update equipment check for a maintenance task
 * PATCH /api/technician/maintenance/:id/equipment/:type
 * ⚠️ MUST come before /maintenance/:id
 */
router.patch('/maintenance/:id/equipment/:type',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const { id, type } = req.params;
      const equipmentData = req.body;
      const technicianId = req.user.userId;

      if (req.user.role === 'ac' && !['shelter', 'cleaning'].includes(type)) {
        return res.status(403).json({
          success: false,
          message: 'AC technicians can only submit shelter and site cleaning checks'
        });
      }

      const maintenance = await Maintenance.findById(id);
      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Verify ownership
      if (maintenance.technician.toString() !== technicianId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only update your own tasks'
        });
      }

      // Initialize equipment_checks if not exists
      if (!maintenance.equipment_checks) {
        maintenance.equipment_checks = {};
      }

      // Note: Arrays (generator_checks, power_cabinet_checks) use 'status'
      // Objects (grid, shelter, cleaning, fuel_tank) use 'check_status' to avoid conflict with equipment status field
      const statusField = ['generator', 'power_cabinet'].includes(type) ? 'status' : 'check_status';
      
      // Use correct check key (e.g., "grid_checks" not "grid")
      const checkKey = type + '_checks';
      
      console.log('\n🔧 EQUIPMENT CHECK UPDATE DEBUG:');
      console.log('  Type:', type);
      console.log('  Check Key:', checkKey);
      console.log('  Status Field:', statusField);
      console.log('  Equipment Data:', JSON.stringify(equipmentData, null, 2));
      
      let mappedData = { ...equipmentData };

      // Map frontend camelCase to backend snake_case based on type
      if (type === 'generator') {
        const d = equipmentData;
        mappedData = {
          equipment_id:
            d.equipment_id ??
            d.equipmentId ??
            d.generator_id ??
            d.generatorId ??
            'GEN-001',
          battery_status: d.batteryStatus ?? d.battery_status,
          battery_status_comment: d.batteryStatusComment ?? d.battery_status_comment,
          fan_belt_status: d.fanBeltStatus ?? d.fan_belt_status,
          fan_belt_status_comment: d.fanBeltStatusComment ?? d.fan_belt_status_comment,
          radiator_status: d.radiatorStatus ?? d.radiator_status,
          radiator_status_comment: d.radiatorStatusComment ?? d.radiator_status_comment,
          coolant_status: d.coolantStatus ?? d.coolant_status,
          coolant_status_comment: d.coolantStatusComment ?? d.coolant_status_comment,
          running_hours: d.runningHours ?? d.running_hours,
          running_hours_comment: d.runningHoursComment ?? d.running_hours_comment,
          fuel_filter_changed: d.fuelFilterChanged ?? d.fuel_filter_changed,
          fuel_filter_changed_comment: d.fuelFilterChangedComment ?? d.fuel_filter_changed_comment,
          oil_filter_changed: d.oilFilterChanged ?? d.oil_filter_changed,
          oil_filter_changed_comment: d.oilFilterChangedComment ?? d.oil_filter_changed_comment,
          air_filter_changed: d.airFilterChanged ?? d.air_filter_changed,
          air_filter_changed_comment: d.airFilterChangedComment ?? d.air_filter_changed_comment,
          oil_level_max: d.oilLevelMax ?? d.oil_level_max,
          oil_level_max_comment: d.oilLevelMaxComment ?? d.oil_level_max_comment,
          oil_quality_checked: d.oilQualityChecked ?? d.oil_quality_checked,
          oil_quality_checked_comment: d.oilQualityCheckedComment ?? d.oil_quality_checked_comment,
          fuel_leakage_checked: d.fuelLeakageChecked ?? d.fuel_leakage_checked,
          fuel_leakage_checked_comment: d.fuelLeakageCheckedComment ?? d.fuel_leakage_checked_comment,
          alarms_status_checked: d.alarmsStatusChecked ?? d.alarms_status_checked,
          alarms_status_checked_comment: d.alarmsStatusCheckedComment ?? d.alarms_status_checked_comment,
          electrical_readings: {
            i1: d.i1, i2: d.i2, i3: d.i3,
            v1: d.v1, v2: d.v2, v3: d.v3,
            photos: d.photos && Array.isArray(d.photos) ? d.photos.map(p => p.uri || p) : []
          },
          comments: d.comments
        };
      } else if (type === 'power_cabinet') {
        // Power cabinet uses a mixed schema — save as-is
      } else if (type === 'fuel_tank') {
        mappedData = {
          ...mappedData,
          separating_filter: equipmentData.separatingFilter,
          separating_filter_comment: equipmentData.separatingFilterComment,
          water_in_tank: equipmentData.waterInTank,
          water_in_tank_comment: equipmentData.waterInTankComment,
          fuel_line: equipmentData.fuelLine,
          fuel_line_comment: equipmentData.fuelLineComment,
          is_waterproof: equipmentData.isWaterproof,
          is_waterproof_comment: equipmentData.isWaterproofComment,
          status: equipmentData.tankStatus ?? equipmentData.status,
          status_comment: equipmentData.tankStatusComment
        };
      } else if (type === 'shelter') {
        mappedData = {
          ...mappedData,
          door_status: equipmentData.doorStatus,
          door_status_comment: equipmentData.doorStatusComment,
          status: equipmentData.shelterStatus ?? equipmentData.status,
          status_comment: equipmentData.shelterStatusComment,
          controller_status: equipmentData.controllerStatus,
          controller_status_comment: equipmentData.controllerStatusComment,
          ac_type: equipmentData.acType,
          internal_filter_cleaned: equipmentData.internalFilterCleaned,
          internal_filter_cleaned_comment: equipmentData.internalFilterCleanedComment,
          outdoor_compressor_cleaned: equipmentData.outdoorCompressorCleaned,
          outdoor_compressor_cleaned_comment: equipmentData.outdoorCompressorCleanedComment,
          high_low_pressure_measured: equipmentData.highLowPressureMeasured,
          high_low_pressure_measured_comment: equipmentData.highLowPressureMeasuredComment,
          temperature_recorded: equipmentData.temperatureRecorded,
          temperature_recorded_comment: equipmentData.temperatureRecordedComment,
          amps_measured: equipmentData.ampsMeasured,
          amps_measured_comment: equipmentData.ampsMeasuredComment,
          condenser_evaporator_cleaned: equipmentData.condenserEvaporatorCleaned,
          condenser_evaporator_cleaned_comment: equipmentData.condenserEvaporatorCleanedComment,
          outdoor_fan_checked: equipmentData.outdoorFanChecked,
          outdoor_fan_checked_comment: equipmentData.outdoorFanCheckedComment
        };
      } else if (type === 'grid') {
        mappedData = {
          ...mappedData,
          breaker_status: equipmentData.breakerStatus,
          breaker_status_comment: equipmentData.breakerStatusComment,
          status: equipmentData.gridStatus ?? equipmentData.status,
          status_comment: equipmentData.gridStatusComment,
          grid_index: equipmentData.gridIndex,
          grid_index_comment: equipmentData.gridIndexComment,
          grid_connected_operational: equipmentData.gridConnectedOperational,
          grid_connected_operational_comment: equipmentData.gridConnectedOperationalComment,
          grid_stable: equipmentData.gridStable,
          grid_stable_comment: equipmentData.gridStableComment,
          meter_photos: equipmentData.photos && Array.isArray(equipmentData.photos) ? equipmentData.photos.map(p => p.uri || p) : []
        };
      } else if (type === 'cleaning') {
        mappedData = {
          ...mappedData,
          is_clean: equipmentData.isClean,
          is_clean_comment: equipmentData.isCleanComment,
          security_light: equipmentData.securityLight,
          security_light_comment: equipmentData.securityLightComment,
          guard_present: equipmentData.guardPresent,
          guard_present_comment: equipmentData.guardPresentComment,
          security_box: equipmentData.securityBox,
          security_box_comment: equipmentData.securityBoxComment,
          inside_clean: equipmentData.insideClean,
          inside_clean_comment: equipmentData.insideCleanComment,
          outside_perimeter_clean: equipmentData.outsidePerimeterClean,
          outside_perimeter_clean_comment: equipmentData.outsidePerimeterCleanComment,
          shelter_cleaned: equipmentData.shelterCleaned,
          shelter_cleaned_comment: equipmentData.shelterCleanedComment,
          outdoor_equipment_cleaned: equipmentData.outdoorEquipmentCleaned,
          outdoor_equipment_cleaned_comment: equipmentData.outdoorEquipmentCleanedComment,
          air_blower_used: equipmentData.airBlowerUsed,
          air_blower_used_comment: equipmentData.airBlowerUsedComment,
          comments: equipmentData.comments,
          spillage_comment: equipmentData.spillageComment,
          spillage: equipmentData.spillage,
          photos: equipmentData.photos && Array.isArray(equipmentData.photos)
            ? equipmentData.photos.map(p => p.uri || p)
            : []
        };
      }

      console.log('  Mapped Data:', JSON.stringify(mappedData, null, 2));

      const updatedCheck = {
        ...mappedData,
        checked_at: new Date(),
        checked_by: technicianId,
        [statusField]: 'pending_approval', 
        submitted_at: new Date()
      };
      
      console.log('  Updated Check Object:', JSON.stringify(updatedCheck, null, 2));
      
      maintenance.equipment_checks[checkKey] = updatedCheck;
      
      console.log('  After Assignment - equipment_checks:', JSON.stringify(maintenance.equipment_checks, null, 2));

      // Mark as modified
      maintenance.markModified('equipment_checks');
      
      // Auto-update overall status to in_progress if scheduled
      if (maintenance.status === 'scheduled' || maintenance.status === 'approved') {
        maintenance.status = 'in_progress';
        if (!maintenance.started_at) {
          maintenance.started_at = new Date();
        }
      }

      await maintenance.save();

      if (['generator', 'fuel_tank'].includes(type)) {
        setImmediate(async () => {
          try {
            await fieldVisitService.createFromEquipmentChecks(id, {
              submitted_by: req.user._id || req.user.userId,
            });
          } catch (fvErr) {
            logger.error(`[TechnicianRoute] FieldVisitRecord failed for ${id}: ${fvErr.message}`);
          }
        });
      }

      logger.info('Equipment check updated', {
        maintenance_id: maintenance.maintenance_id,
        equipment_type: type,
        technician: technicianId
      });

      res.json({
        success: true,
        message: `${type} check updated successfully`,
        data: {
          equipment_checks: maintenance.equipment_checks,
          status: maintenance.status
        }
      });

    } catch (error) {
      logger.error('Update equipment check error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update equipment check',
        message: error.message
      });
    }
  }
);

/**
 * Get single maintenance task details
 * GET /api/technician/maintenance/:id
 * ⚠️ Must come after all /maintenance/[literal] and /maintenance/:id/[action] routes
 */
router.get('/maintenance/:id',
  authenticateToken,
  requireRole(['technician', 'supervisor', 'admin']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const userRole = req.user.role;

      const maintenance = await Maintenance.findById(id)
        .populate('technician', 'fullName email phone')
        .populate('supervisor', 'fullName email phone')
        .populate('parts_used.part_id', 'name part_number category stock')
        .populate('reviewed_by', 'fullName role')
        .populate('edit_history.edited_by', 'fullName role');

      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Access control
      const canAccess =
        userRole === 'admin' ||
        maintenance.technician._id.toString() === userId.toString() ||
        maintenance.supervisor._id.toString() === userId.toString();

      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Get associated site details
      const site = await Site.findOne({ IHS_ID_SITE: maintenance.site_id })
        .select('Site_Name Region IHS_ID_SITE Latitude Longitude GRATO_Cluster');

      res.json({
        success: true,
        data: {
          ...maintenance.toObject(),
          site_details: site
        }
      });

    } catch (error) {
      logger.error('Get maintenance details error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch maintenance details'
      });
    }
  }
);


router.post('/refuel',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      const FuelConsumption = require('../models/FuelConsumption');
      const FuelPurchase = require('../models/FuelPurchase');

      // ── Helpers ──────────────────────────────────────────────────────────────
      const toNum = (v) => {
        if (v === undefined || v === null || v === '') return undefined;
        const n = typeof v === 'number' ? v : parseFloat(v);
        return isNaN(n) ? undefined : n;
      };

      const toStr = (v) => {
        if (v === undefined || v === null) return undefined;
        const s = String(v).trim();
        return s === '' ? undefined : s;
      };

      const compact = (obj) =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

      // ── Destructure body ─────────────────────────────────────────────────────
      const {
        site_id,
        site_name,
        maintenanceId,
        generator_id,
        opening_level,
        closing_level,
        fuel_added = 0,
        delivery_complete,      // ← explicit technician signal: is this delivery finishing the request, or is more still owed?
        fuel_price,
        tank_capacity,
        tank_id,               // ← NEW: technician-corrected tank ID, if edited
        tank_type,              // ← NEW: technician-corrected tank type, if edited
        tank_info_override,     // ← NEW: { original, updated, edited_by, edited_at } — only present if the technician actually changed something on the form
        opening_hours,
        closing_hours,
        runtime_hours,
        comments,
        photos,
        measurement_photos, 
        guard_photos,         
        fse_name,
        planifier,
        guard_name,
        guard_number,
        tank_length_cm,
        tank_height_cm,
        tank_width_cm,
        tank_observations,
        fuel_sensor_status,
        dip_stick_before_cm,
        dip_stick_after_cm,
        truck_flow_meter_before_l,
        truck_flow_meter_after_l,
        truck_plate_number,
        departure_time_min,
        arrival_time_station,
        arrival_time_site,
        transfer_time_min,
        quantity_transfer_l,
        date_of_refuel,
        visit_date,              // ← NEW: technician-entered visit date (YYYY-MM-DD)
        visit_time,              // ← NEW: technician-entered visit time (HH:mm)
        submitted_at,            // ← NEW: true device timestamp captured at submit,
                                 //   survives unchanged through the offline queue —
                                 //   distinct from when this request actually reaches
                                 //   the server, which may be much later
        request_urgency,
        fuel_requested,
        request_reason,
        client_id,   // ← stable id generated client-side per submission
        fuel_purchase_id,          // ← NEW: real _id of the FuelPurchase this draws from
        fuel_purchase_client_id,   // ← NEW: fallback when the purchase was created offline
                                   //   and its server _id wasn't known yet at submit time
      } = req.body;

      // ── Validation ───────────────────────────────────────────────────────────
      // Map dip_stick readings to opening/closing level if the direct fields are absent
      // (mobile app sends dip_stick_before_cm / dip_stick_after_cm as the primary measurement)
      let _resolvedOpeningLevel = opening_level;
      let _resolvedClosingLevel = closing_level;
      const dip_before = req.body.dip_stick_before_cm;
      const dip_after  = req.body.dip_stick_after_cm;
      if (_resolvedOpeningLevel === undefined && dip_before != null) {
        _resolvedOpeningLevel = parseFloat(dip_before);
      }
      if (_resolvedClosingLevel === undefined && dip_after != null) {
        _resolvedClosingLevel = parseFloat(dip_after);
      }
      // Allow missing tank_capacity — use a safe default so the submission doesn't fail
      const _resolvedTankCapacity = tank_capacity || req.body.tank_capacity_l || 5000;

      if (!site_id || _resolvedOpeningLevel === undefined || _resolvedClosingLevel === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: site_id, opening_level (or dip_stick_before_cm), closing_level (or dip_stick_after_cm)'
        });
      }

      // ── NEW: Idempotency guard ────────────────────────────────────────────────
      // If a queued offline submission gets retried after already succeeding
      // (e.g. the success response was lost when connectivity dropped), this
      // stops it from creating a second FuelConsumption record.
      if (client_id) {
        const existingByClientId = await FuelConsumption.findOne({ client_id });
        if (existingByClientId) {
          logger.info('Duplicate refuel submission ignored (client_id match)', {
            client_id,
            record_id: existingByClientId._id,
          });
          return res.status(200).json({
            success: true,
            message: 'Refueling record already recorded',
            data: existingByClientId,
          });
        }
      }

      // ── Parse core numeric values ─────────────────────────────────────────────
      const _openingLevel   = toNum(opening_level);
      const _closingLevel   = toNum(closing_level);
      const _fuelAdded      = toNum(fuel_added) ?? 0;
      const _tankCapacity   = toNum(tank_capacity);

      // fuel_consumed = what was burned = opening + added - closing
      const fuel_consumed = Math.max(0,
        parseFloat(((_openingLevel + _fuelAdded) - _closingLevel).toFixed(2))
      );

      // ── Runtime calculation ───────────────────────────────────────────────────
      const _openingHours = toNum(opening_hours);
      const _closingHours = toNum(closing_hours);
      let calculated_runtime = toNum(runtime_hours);

      if (calculated_runtime === undefined && _openingHours !== undefined && _closingHours !== undefined) {
        calculated_runtime = parseFloat((_closingHours - _openingHours).toFixed(2));
        if (calculated_runtime < 0) calculated_runtime = undefined;
      }

      const consumption_rate =
        calculated_runtime && calculated_runtime > 0
          ? parseFloat((fuel_consumed / calculated_runtime).toFixed(4))
          : 0;

      // ── Build sub-documents ────────────────────────────────────────────────────
      const fuelDataDoc = compact({
        opening_level:      _openingLevel,
        closing_level:      _closingLevel,
        fuel_added:         _fuelAdded,
        fuel_consumed,
        tank_capacity:      _tankCapacity,
        fuel_type:          'diesel',
        tank_length_cm:     toNum(tank_length_cm),
        tank_height_cm:     toNum(tank_height_cm),
        tank_width_cm:      toNum(tank_width_cm),
        tank_observations:  toStr(tank_observations),
        fuel_sensor_status: toStr(fuel_sensor_status),
        dip_stick_before_cm: toNum(dip_stick_before_cm),
        dip_stick_after_cm:  toNum(dip_stick_after_cm),
      });

      const runtimeDataDoc = compact({
        opening_hours:            _openingHours,
        closing_hours:            _closingHours,
        runtime_hours:            calculated_runtime,
        truck_flow_meter_before_l: toNum(truck_flow_meter_before_l),
        truck_flow_meter_after_l:  toNum(truck_flow_meter_after_l),
        truck_plate_number:        toStr(truck_plate_number),
        departure_time_min:        toNum(departure_time_min),
        arrival_time_station:      toStr(arrival_time_station),
        arrival_time_site:         toStr(arrival_time_site),
        transfer_time_min:         toNum(transfer_time_min),
        quantity_transfer_l:       toNum(quantity_transfer_l),
      });

      const hasRuntimeData = Object.keys(runtimeDataDoc).length > 0;

      const requestInfoDoc = compact({
        fuel_requested:   toNum(fuel_requested),
        request_reason:   toStr(request_reason),
        request_urgency:  toStr(request_urgency) || 'medium',
        requested_by:     technicianId,
        requested_at:     new Date(),
      });

      // ── NEW: Resolve the fuel purchase this submission draws from ────────────
      // Prefer the real _id (set once the purchase has synced); fall back to
      // client_id for a purchase that was created offline in the same batch
      // and hasn't been assigned a server _id from this device's point of view
      // yet — the sync queue processes creates before the submissions that
      // reference them, so by the time this request runs the purchase should
      // already exist under either lookup.
      let fuelPurchase = null;
      if (fuel_purchase_id) {
        fuelPurchase = await FuelPurchase.findById(fuel_purchase_id).catch(() => null);
      }
      if (!fuelPurchase && fuel_purchase_client_id) {
        fuelPurchase = await FuelPurchase.findOne({ client_id: fuel_purchase_client_id }).catch(() => null);
      }

      // ── Create FuelConsumption record ─────────────────────────────────────────
      const newRecord = new FuelConsumption({
        client_id,   // ← stored so future retries can be matched
        fuel_purchase: fuelPurchase ? fuelPurchase._id : undefined,
        site_id,
        site_name:   toStr(site_name),
        generator_id: toStr(generator_id),
        // record_date is the VISIT date/time (date_of_refuel is built
        // client-side from the technician-entered visit_date + visit_time —
        // may be a prior day if they're submitting after the fact).
        record_date:  date_of_refuel ? new Date(date_of_refuel) : new Date(),
        visit_date:   toStr(visit_date),
        visit_time:   toStr(visit_time),
        // submitted_at is the TRUE device timestamp captured the moment the
        // technician pressed submit — set client-side before any network
        // attempt, so it's accurate even when this request only reaches the
        // server hours/days later via the offline sync queue. Falls back to
        // server time only for older app builds that don't send it yet.
        submitted_at: submitted_at ? new Date(submitted_at) : new Date(),
        period:       'daily',
        fuel_data:    fuelDataDoc,
        ...(hasRuntimeData && { runtime_data: runtimeDataDoc }),
        // Tank ID/type as confirmed (or corrected) by the technician on the
        // form, plus the full before/after record if they changed it.
        tank_id:   toStr(tank_id),
        tank_type: toStr(tank_type),
        tank_info_override: tank_info_override
          ? { ...tank_info_override, edited_by: technicianId }
          : undefined,
        metrics: compact({
          consumption_rate,
          cost_estimate: (() => {
          const price = toNum(fuel_price) || (fuelPurchase ? (fuelPurchase.price_per_liter || 828) : 828);
          return parseFloat((fuel_consumed * price).toFixed(2));
        })(),
        total_cost_xaf: (() => {
          const price = toNum(fuel_price) || (fuelPurchase ? (fuelPurchase.price_per_liter || 828) : 828);
          return parseFloat((_fuelAdded * price).toFixed(2));
        })(),
          efficiency_rating: 'good',
          anomaly_detected: false,
        }),
        request_info:    requestInfoDoc,
        approval_status: 'pending',
        delivery_info:   { delivered: false },
        comments:        toStr(comments),
        photos:          photos || [],
        measurement_photos: measurement_photos || [],   
        guard_photos:        guard_photos || [],
        recorded_by:     technicianId,
        source:          'site_visit',
        fse_name:    toStr(fse_name),
        planifier:   toStr(planifier),
        guard_name:  toStr(guard_name),
        guard_number: toStr(guard_number),
      });

      await newRecord.save();

      // ── Update FuelConsumption record workflow fields ─────────────────────────
      newRecord.workflow_status = 'completed';
      newRecord.refuel_submitted = true;
      if (!Array.isArray(newRecord.workflow_history)) newRecord.workflow_history = [];

      // Build a rich timeline from all available timestamps
      const wfSteps = [];
      // Purchase / arrival at station
      const rt2 = newRecord.runtime_data || {};
      if (rt2.arrival_time_station) {
        wfSteps.push({ status:'arrived_at_station', timestamp: new Date(rt2.arrival_time_station), meta:{ note:'Technician arrived at fuel station' } });
      }
      if (rt2.departure_time_min) {
        wfSteps.push({ status:'departed_station',   timestamp: new Date(newRecord.record_date - rt2.departure_time_min*60000), meta:{ note:'Truck loaded, departed station', transfer_time_min: rt2.departure_time_min } });
      }
      if (rt2.arrival_time_site) {
        wfSteps.push({ status:'arrived_at_site',    timestamp: new Date(rt2.arrival_time_site), meta:{ note:'Arrived on site' } });
      }
      // Form submission timestamp
      wfSteps.push({ status:'completed', timestamp: newRecord.submitted_at || new Date(), meta:{ action:'refuel_form_submitted', changed_by: technicianId } });
      newRecord.workflow_history = wfSteps;
      newRecord.workflow_last_updated = new Date();
      await newRecord.save();

      // ── Link FuelConsumption back to the FuelRequest ──────────────────────────
      // Find the open FuelRequest for this site and stamp it with the consumption
      // record ID so the frontend can fetch and display all refueling data.
      try {
        const FuelRequest = require('../models/FuelRequest');
        const fuelReq = await FuelRequest.findOne({
          site_id,
          // Include 'partially_refueled' so a follow-up delivery finds and
          // updates the SAME still-open request, instead of failing to
          // match anything and leaving the remainder untracked.
          status: { $in: ['scheduled', 'purchase_made', 'approved', 'partially_refueled'] },
        }).sort({ createdAt: -1 });
        if (fuelReq) {
          fuelReq.fuel_consumption_id  = newRecord._id;
          if (fuelPurchase) fuelReq.fuel_purchase_id = fuelPurchase._id;

          const approvedL     = fuelReq.liters_approved || fuelReq.liters_requested || 0;
          const previousTotal = fuelReq.liters_actually_added || 0;
          const totalAddedL   = previousTotal + _fuelAdded;
          // Backward-compatible default: no explicit signal from an older
          // mobile client = treat as final, matching original behavior.
          const isFinal       = delivery_complete !== false;
          const requestDone   = isFinal || totalAddedL >= approvedL;

          fuelReq.liters_actually_added = totalAddedL; // cumulative, not overwritten
          fuelReq.deliveries = fuelReq.deliveries || [];
          fuelReq.deliveries.push({
            liters_added:        _fuelAdded,
            delivered_at:        new Date(),
            fuel_consumption_id: newRecord._id,
            fuel_purchase_id:    fuelPurchase ? fuelPurchase._id : undefined,
            delivered_by:        technicianId,
            was_final_delivery:  isFinal,
          });
          fuelReq.status = requestDone ? 'refueled' : 'partially_refueled';

          // Update SiteBudget — only release the FULL remaining commitment
          // once the request is genuinely done. A partial delivery only
          // moves what was actually delivered this trip from committed to
          // used; the rest stays reserved for the follow-up trip instead
          // of being silently freed for some other request to consume.
          try {
            const SiteBudget = require('../models/SiteBudget');
            const sb = await SiteBudget.findOne({ site_id, cycle_key: fuelReq.cycle_key });
            if (sb) {
              const balanceReturned = requestDone ? Math.max(0, approvedL - totalAddedL) : 0;
              sb.liters_committed = Math.max(0, (sb.liters_committed || 0) - _fuelAdded - balanceReturned);
              sb.liters_used      = (sb.liters_used || 0) + _fuelAdded;
              if (requestDone && balanceReturned > 0) {
                sb.liters_balance_returned    = (sb.liters_balance_returned || 0) + balanceReturned;
                fuelReq.liters_balance_returned = balanceReturned;
                fuelReq.balance_return_reason   = 'Tank capacity reached — unused approved litres returned to budget';
              } else if (!requestDone) {
                logger.info(`[Refuel] PARTIAL delivery for ${site_id}: ${_fuelAdded}L this trip (${totalAddedL}/${approvedL}L total), ${(approvedL - totalAddedL).toFixed(1)}L still owed and remains reserved in the site budget.`);
              }
              await sb.save();
            }
          } catch (sbErr) { logger.warn('[Refuel] SiteBudget update failed:', sbErr.message); }
          await fuelReq.save();
          logger.info('[Refuel] Linked FuelConsumption ' + newRecord._id + ' to FuelRequest ' + fuelReq._id + ' — status=' + fuelReq.status);
        } else {
          logger.info('[Refuel] No open FuelRequest found for site ' + site_id + ' — consumption recorded standalone');
        }
      } catch (linkErr) {
        logger.warn('[Refuel] FuelRequest linkage failed (non-fatal):', linkErr.message);
      }

      // ── NEW: Draw down the linked fuel purchase ───────────────────────────────
      if (fuelPurchase) {
        if (_fuelAdded > fuelPurchase.remaining_quantity) {
          logger.warn('Refuel amount exceeds remaining purchase balance — allowing overdraw', {
            purchaseId: fuelPurchase._id,
            remaining: fuelPurchase.remaining_quantity,
            requested: _fuelAdded,
          });
        }
        fuelPurchase.allocations.push({
          site_id,
          fuel_consumption_id: newRecord._id,
          quantity: _fuelAdded,
          allocated_at: new Date(),
        });
        fuelPurchase.applyAllocation(_fuelAdded);
        await fuelPurchase.save();
        logger.info('Fuel purchase drawn down', {
          purchaseId: fuelPurchase._id,
          drawn: _fuelAdded,
          remaining: fuelPurchase.remaining_quantity,
        });
      }

      // ── Update Site's workflow status and refuel_submitted ────────────────────
      if (site_id) {
        const workflowUpdate = {
          Previous_Fuel_Quantity:  _openingLevel,
          Fuel_Quantity_Found:     _closingLevel,
          Fuel_Quantity_Added:     _fuelAdded,
          Fuel_Quantity_Consumed:  fuel_consumed,
          workflow_status: 'completed',
          refuel_submitted: true,
          $push: {
            workflow_history: {
              status: 'completed',
              changed_by: technicianId,
              changed_at: new Date(),
              action: 'refuel_submitted',
              record_id: newRecord._id
            }
          }
        };
        await Site.findOneAndUpdate(
          { IHS_ID_SITE: site_id },
          workflowUpdate,
          { new: true }
        ).catch(err => logger.error('Failed to update site workflow status', err));
      }

      // ── If linked to a Maintenance record, update equipment_checks ────────────
      if (maintenanceId) {
        const maintenance = await Maintenance.findById(maintenanceId);
        if (maintenance) {
          if (!maintenance.equipment_checks) {
            maintenance.equipment_checks = {};
          }

          maintenance.equipment_checks.fuel_tank_checks = compact({
            status:       true,
            fuel_level:   _closingLevel,
            fuel_added:   _fuelAdded,
            check_status: 'pending_approval',
            checked_at:   date_of_refuel ? new Date(date_of_refuel) : new Date(),
            checked_by:   technicianId,
            comments:     toStr(comments),
            fse_name:     toStr(fse_name),
            planifier:    toStr(planifier),
            guard_name:   toStr(guard_name),
            guard_number: toStr(guard_number),
            tank_length_cm:     toNum(tank_length_cm),
            tank_height_cm:     toNum(tank_height_cm),
            tank_width_cm:      toNum(tank_width_cm),
            tank_observations:  toStr(tank_observations),
            fuel_sensor_status: toStr(fuel_sensor_status),
            dip_stick_before_cm: toNum(dip_stick_before_cm),
            dip_stick_after_cm:  toNum(dip_stick_after_cm),
            truck_flow_meter_before_l: toNum(truck_flow_meter_before_l),
            truck_flow_meter_after_l:  toNum(truck_flow_meter_after_l),
            truck_plate_number:        toStr(truck_plate_number),
            departure_time_min:   toNum(departure_time_min),
            arrival_time_station: toStr(arrival_time_station),
            arrival_time_site:    toStr(arrival_time_site),
            transfer_time_min:    toNum(transfer_time_min),
            quantity_transfer_l:  toNum(quantity_transfer_l),
          });

          maintenance.markModified('equipment_checks');
          await maintenance.save();
          logger.info('Maintenance fuel_tank_checks updated', { maintenanceId });
        }
      }

      logger.info('Refueling record created', {
        site_id,
        fuel_consumed,
        fuel_added: _fuelAdded,
        technician: technicianId,
        record_id: newRecord._id,
      });

      res.status(201).json({
        success: true,
        message: 'Refueling record created successfully',
        data: newRecord,
      });

    } catch (error) {
      logger.error('Create refuel record error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create refueling record'
      });
    }
  }
);






/**
 * Install part record for technician
 * POST /api/technician/install-part
 * ⚠️ MUST come before /:id
 */
router.post('/install-part',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;
      
      const {
        requestId,
        site_name,
        part_name,
        install_date,
        new_serial,
        old_serial,
        removal_date,
        old_condition,
        test_performed,
        test_result,
        notes,
        is_replacement,
        photos
      } = req.body;

      logger.info('Part installed by technician', {
        technician: technicianId,
        part: part_name,
        site: site_name,
        new_serial
      });

      res.status(200).json({
        success: true,
        message: 'Part installation recorded successfully',
        data: {
          installed_at: new Date(),
          technician: technicianId
        }
      });

    } catch (error) {
      logger.error('Part installation error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to record part installation'
      });
    }
  }
);

// ========================================
// ADMIN/SUPERVISOR ROUTES
// ========================================

/**
 * Get all technicians
 * GET /api/technician/
 */
router.get('/',
  authenticateToken,
  requireRole(['admin', 'supervisor']),
  technicianController.getAllTechnicians
);

/**
 * Create new technician
 * POST /api/technician/
 */
router.post('/',
  authenticateToken,
  requireRole(['admin', 'supervisor']),
  technicianController.createTechnician
);

// ========================================
// GENERIC ID ROUTES - MUST COME LAST
// ========================================

// All static/literal routes must be defined above this block!

/**
 * Get technician by ID
 * GET /api/technician/:id
 * ⚠️ THIS MUST COME AFTER ALL SPECIFIC ROUTES
 */
router.get('/:id',
  authenticateToken,
  requireRole(['admin', 'supervisor', 'technician']),
  technicianController.getTechnicianById
);

/**
 * Update technician
 * PUT /api/technician/:id
 */
router.put('/:id',
  authenticateToken,
  requireRole(['admin', 'supervisor']),
  technicianController.updateTechnician
);

/**
 * Activate technician
 * PATCH /api/technician/:id/activate
 */
router.patch('/:id/activate',
  authenticateToken,
  requireRole(['admin']),
  technicianController.activateTechnician
);

/**
 * Deactivate technician
 * PATCH /api/technician/:id/deactivate
 */
router.patch('/:id/deactivate',
  authenticateToken,
  requireRole(['admin']),
  technicianController.deactivateTechnician
);

/**
 * Delete technician
 * DELETE /api/technician/:id
 */
router.delete('/:id',
  authenticateToken,
  requireRole(['admin']),
  technicianController.deleteTechnician
);

/**
 * Assign clusters to technician
 * POST /api/technician/:id/assign-clusters
 */
router.post('/:id/assign-clusters',
  authenticateToken,
  requireRole(['admin', 'supervisor']),
  technicianController.assignClusters
);

/**
 * Assign towers to technician
 * POST /api/technician/:id/assign-towers
 */
router.post('/:id/assign-towers',
  authenticateToken,
  requireRole(['admin', 'supervisor']),
  technicianController.assignTowers
);

// ── GET /api/technician/fuel-consumption-records ─────────────────────────────
// Returns FuelConsumption records for the current cycle, enriched with
// site_name from the linked FuelRequest where available.
// Used by FuelRequestsPage Consumption tab to show actual refueling data.
router.get('/fuel-consumption-records',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor', 'finance', 'head_of_business', 'ceo', 'technician', 'fuel']),
  async (req, res) => {
    try {
      const FuelConsumption = require('../models/FuelConsumption');
      const limit     = Math.min(parseInt(req.query.limit) || 200, 500);
      const cycle_key = req.query.cycle_key;
      const site_id   = req.query.site_id;

      const filter = {};
      if (cycle_key) filter.cycle_key = cycle_key;
      if (site_id)   filter.site_id   = site_id;

      // Non-managers only see their own records
      if (['technician', 'fuel'].includes(req.user.role)) {
        filter.recorded_by = req.user.userId;
      }

      const records = await FuelConsumption.find(filter)
        .sort({ record_date: -1 })
        .limit(limit)
        .lean();

      return res.json({ success: true, data: records, count: records.length });
    } catch (err) {
      logger.error('[Technician] fuel-consumption-records error:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);


module.exports = router;