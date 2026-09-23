const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const User = require('../models/User');
const Cluster = require('../models/Cluster');
const Tower = require('../models/Tower');
const Generator = require('../models/Generator');
const Maintenance = require('../models/Maintenance');
const ACUnit = require('../models/ACUnit');
const PowerSystem = require('../models/PowerSystem');
const Site = require('../models/Site');
const PartRequest = require('../models/PartRequest');
const Part = require('../models/Part');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');

// ============================================
// DASHBOARD STATS (IMPROVED)
// ============================================
router.get('/dashboard', authenticateToken, requireRole(['supervisor', 'admin', ]), async (req, res) => {
  try {
    const supervisorId = req.user._id;

    console.log('Dashboard - Supervisor ID:', supervisorId);

    // Get supervisor with populated clusters
    const supervisor = await User.findById(supervisorId)
      .select('fullName email assignedTechnicians supervised_clusters')
      .populate('supervised_clusters', 'name code region')
      .lean();

    if (!supervisor) {
      return res.status(404).json({
        success: false,
        error: 'Supervisor not found'
      });
    }

    const clusterIds = supervisor.supervised_clusters?.map(c => c._id) || [];

    // 1. Get technicians first
    const technicians = await User.find({
      role: 'technician',
      $or: [
        { assignedClusters: { $in: clusterIds } },
        { supervisor: supervisorId },
        { _id: { $in: supervisor.assignedTechnicians || [] } }
      ]
    }).select('fullName email phone specializations assignedClusters assignedTowers assigned_sites').lean();

    const technicianIds = technicians.map(t => t._id);
    const technicianNames = technicians.map(t => t.fullName);
    const technicianAssignedSites = technicians.flatMap(t => t.assigned_sites || []);

    // 2. Get everything else
    const techIdsArr = Array.from(technicianIds);
    const [clusters, sites, maintenanceStats, avgApproval] = await Promise.all([
      Cluster.find({ supervisor: supervisorId })
        .populate('assigned_technicians.technician', 'fullName email')
        .lean(),

      Site.find({
        $or: [
          ...(clusterIds.length > 0 ? [
            { 'GRATO_Cluster': { $in: clusterIds.map(id => id.toString()) } },
            { cluster: { $in: clusterIds } }
          ] : []),
          { IHS_ID_SITE: { $in: technicianAssignedSites } },
          { Technician_Name: { $in: technicianNames } }
        ]
      }).lean(),

      // Get maintenance/visit stats
      Maintenance.aggregate([
        {
          $match: {
            supervisor: new mongoose.Types.ObjectId(supervisorId),
            $or: [
              { status: { $in: ['pending_approval', 'approved', 'rejected', 'completed'] } },
              { is_draft: false }
            ]
          }
        },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),

      // Avg approval time
      Maintenance.aggregate([
        {
          $match: {
            supervisor: new mongoose.Types.ObjectId(supervisorId),
            status: { $in: ['approved', 'rejected'] },
            reviewed_at: { $exists: true },
            submitted_at: { $exists: true }
          }
        },
        {
          $project: {
            approval_time: { $subtract: ['$reviewed_at', '$submitted_at'] }
          }
        },
        { $group: { _id: null, avg_time: { $avg: '$approval_time' } } }
      ])
    ]);

    // Map stats to status keys
    const statsMap = maintenanceStats.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    const avgApprovalHours = avgApproval[0]?.avg_time
      ? Math.round(avgApproval[0].avg_time / (1000 * 60 * 60) * 10) / 10
      : 0;

    // Get generators from sites
    const generatorIds = sites
      .flatMap(site => site.Current_Generators || [])
      .filter(id => id);

    const generatorCount = new Set(generatorIds.map(id => id.toString())).size;

    // Aggregate technician stats
    const techniciansCount = new Set(
      technicians.map(t => t._id.toString())
    ).size;

    // Infrastructure Stats Calculation
    let totalRectifiers = 0;
    let totalBatteries = 0;
    let solarSitesCount = 0;
    let externalTankCount = 0;
    
    sites.forEach(site => {
        // Count Rectifiers
        if (site.Rectifiers && Array.isArray(site.Rectifiers)) {
            site.Rectifiers.forEach(r => {
                totalRectifiers += (r.number_of_rectifiers || 0);
            });
        }
        
        // Count Batteries
        if (site.Batteries && Array.isArray(site.Batteries)) {
             site.Batteries.forEach(b => {
                 totalBatteries += (b.number_of_batteries || 0);
             });
        }

        // Check for Solar checks or issues indicating Solar presence
        const solarIssue = site.Issues_Found?.Issue_of_Solar;
        if (solarIssue && (solarIssue.toLowerCase().includes('solar') || solarIssue.toLowerCase().includes('yes'))) {
            solarSitesCount++;
        }

        // Tank Types
        if (site.Type_de_Tank === 'EXT' || site.Type_de_Tank === 'surface') {
            externalTankCount++;
        }
    });

    // Count active site visits this month
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const siteVisitsThisMonth = sites.filter(site => {
      const lastVisit = site.Actual_Date_Visit ? new Date(site.Actual_Date_Visit) : null;
      return lastVisit && lastVisit >= monthAgo;
    }).length;

    res.status(200).json({
      success: true,
      data: {
        supervisor: {
          id: supervisor._id,
          fullName: supervisor.fullName,
          email: supervisor.email
        },
        // Direct stats for StatCards
        pending: statsMap['pending_approval'] || 0,
        approved: statsMap['approved'] || 0,
        rejected: statsMap['rejected'] || 0,
        completed: statsMap['completed'] || 0,
        avg_approval_time_hours: avgApprovalHours,

        stats: {
          totalClusters: clusters.length,
          totalSites: sites.length,
          totalTechnicians: techniciansCount,
          totalGenerators: generatorCount,
          siteVisitsThisMonth,
          pendingMaintenance: statsMap['pending_approval'] || 0,
          completedMaintenance: statsMap['completed'] || 0,
          
          // Added Infrastructure Stats
          totalRectifiers: totalRectifiers,
          totalBatteries: totalBatteries,
          solarSites: solarSitesCount,
          externalTanks: externalTankCount
        },
        clusters: clusters.map(c => ({
          _id: c._id,
          name: c.name,
          code: c.code,
          region: c.region,
          assignedTechnicians: c.assigned_technicians?.length || 0
        })),
        recentSites: sites.slice(0, 10).map(s => ({
          IHS_ID_SITE: s.IHS_ID_SITE,
          Site_Name: s.Site_Name,
          Region: s.Region,
          lastVisit: s.Actual_Date_Visit,
          generatorCount: s.Current_Generators?.length || 0
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard statistics',
      message: error.message
    });
  }
});

// ============================================
// CLUSTERS - Get all clusters with full details
// ============================================
router.get('/clusters', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user._id;

    const clusters = await Cluster.find({ supervisor: supervisorId })
      .populate('assigned_technicians.technician', 'fullName email phone specializations')
      .populate('supervisor', 'fullName email')
      .lean();

    // Enrich each cluster with site and technician counts
    const enrichedClusters = await Promise.all(
      clusters.map(async (cluster) => {
        const [siteCount, maintenanceCount] = await Promise.all([
          Site.countDocuments({
            $or: [
              { 'GRATO_Cluster': cluster._id.toString() },
              { cluster_id: cluster._id }
            ]
          }),
          Maintenance.countDocuments({
            status: { $in: ['pending', 'scheduled', 'in_progress'] },
            $expr: {
              $in: [{ $toString: '$tower' },
              await Site.find({
                $or: [
                  { 'GRATO_Cluster': cluster._id.toString() },
                  { cluster_id: cluster._id }
                ]
              }).select('IHS_ID_SITE').lean().then(sites => sites.map(s => s.IHS_ID_SITE))
              ]
            }
          })
        ]);

        return {
          ...cluster,
          stats: {
            technicians: cluster.assigned_technicians?.length || 0,
            sites: siteCount,
            pendingMaintenance: maintenanceCount
          }
        };
      })
    );

    res.status(200).json({
      success: true,
      data: enrichedClusters,
      count: enrichedClusters.length
    });

  } catch (error) {
    console.error('Error fetching clusters:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch clusters',
      message: error.message
    });
  }
});

/**
 * Get pending maintenance for approval
 * GET /api/supervisor/maintenance/pending
 */
router.get('/maintenance/pending',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  async (req, res) => {
    console.log('\n========== GET PENDING MAINTENANCE ==========');

    try {
      const supervisorId = req.user.userId;
      const { page = 1, limit = 20, priority } = req.query;

      console.log('Supervisor ID:', supervisorId);

      // Build query
      const query = {
        supervisor: supervisorId,
        status: 'pending_approval'
      };

      if (priority) {
        query.priority = priority;
      }

      const { site_id } = req.query;
      if (site_id) {
        query.site_id = site_id;
      }

      const skip = (page - 1) * limit;

      // Get maintenance records with pending_approval status
      const maintenanceRecords = await Maintenance.find({ 
        supervisor: supervisorId,
        status: 'pending_approval'
      })
        .populate('technician', 'fullName email phone')
        .populate('parts_used.part_id', 'name part_number category stock')
        .sort({ submitted_at: -1, visit_date: -1 })
        .lean();

      console.log(`Found ${maintenanceRecords.length} pending maintenance records for supervisor ${supervisorId}`);

      // Format maintenance records for frontend
      const formattedRecords = await Promise.all(maintenanceRecords.map(async (record) => {
        const site = await Site.findOne({ IHS_ID_SITE: record.site_id })
          .select('Site_Name Region GRATO_Cluster Latitude Longitude')
          .lean();
        
        return {
          _id: record._id,
          maintenance_id: record.maintenance_id || record._id,
          site_id: record.site_id,
          site_name: site?.Site_Name || record.site_name || record.site_id,
          site_details: site,
          visit_date: record.visit_date,
          visit_type: record.visit_type,
          priority: record.priority,
          technician: record.technician,
          status: record.status,
          work_performed: record.work_performed,
          equipment_checks: record.equipment_checks,
          parts_used: record.parts_used,
          photos: record.photos,
          submitted_at: record.submitted_at,
          days_pending: record.submitted_at ?
            Math.floor((Date.now() - new Date(record.submitted_at)) / (1000 * 60 * 60 * 24)) : 0
        };
      }));

      // Sort by priority and submission date
      formattedRecords.sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const priorityDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.submitted_at) - new Date(a.submitted_at);
      });
      
      // Apply priority filter if provided
      let filteredRecords = formattedRecords;
      if (priority) {
        filteredRecords = formattedRecords.filter(c => c.priority === priority);
      }
      
      // Apply site filter if provided
      if (site_id) {
        filteredRecords = filteredRecords.filter(c => c.site_id === site_id);
      }
      
      // Pagination
      const total = filteredRecords.length;
      const paginatedRecords = filteredRecords.slice(skip, skip + parseInt(limit));

      console.log(`Returning ${paginatedRecords.length} pending maintenance records out of ${total} total`);
      console.log('========== SUCCESS ==========\n');

      res.json({
        success: true,
        data: paginatedRecords,
        pagination: {
          current: parseInt(page),
          pageSize: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      console.log('========== ERROR ==========');
      console.error('Get pending maintenance error:', error);
      console.log('===========================\n');

      logger.error('Get pending maintenance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pending maintenance'
      });
    }
  }
);


/**
 * Approve individual equipment check
 * POST /api/supervisor/maintenance/:id/equipment/:type/approve
 */
router.post('/maintenance/:id/equipment/:type/approve',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  async (req, res) => {
    try {
      const { id, type } = req.params;
      const { comments } = req.body;
      const supervisorId = req.user.userId;

      const maintenance = await Maintenance.findById(id);

      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Verify supervisor ownership
      if (maintenance.supervisor.toString() !== supervisorId.toString() &&
        req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'You can only approve your own maintenance records'
        });
      }

      // Get the equipment check type key
      const checkKey = `${type}_checks`;
      if (!maintenance.equipment_checks || !maintenance.equipment_checks[checkKey]) {
        return res.status(404).json({
          success: false,
          message: 'Equipment check not found'
        });
      }

      // Determine which status field to use
      const statusField = ['generator', 'power_cabinet'].includes(type) ? 'status' : 'check_status';
      
      // Update the specific check status to approved
      const checkData = maintenance.equipment_checks[checkKey];
      
      if (Array.isArray(checkData)) {
        // For array types (generator_checks, power_cabinet_checks), update all items or the first item
        if (checkData.length > 0) {
          checkData.forEach(item => {
            item[statusField] = 'approved';
            item.reviewed_at = new Date();
            item.reviewed_by = supervisorId;
            if (comments) {
              item.supervisor_comments = comments;
            }
          });
        }
      } else if (typeof checkData === 'object' && checkData !== null) {
        // For object types (grid, shelter, cleaning, fuel_tank)
        checkData[statusField] = 'approved';
        checkData.reviewed_at = new Date();
        checkData.reviewed_by = supervisorId;
        if (comments) {
          checkData.supervisor_comments = comments;
        }
      }

      maintenance.markModified('equipment_checks');
      await maintenance.save();

      logger.info('Equipment check approved', {
        maintenance_id: maintenance.maintenance_id,
        check_type: type,
        supervisor: supervisorId
      });

      res.json({
        success: true,
        message: 'Equipment check approved successfully',
        data: {
          check_type: type,
          status: 'approved'
        }
      });

    } catch (error) {
      logger.error('Approve equipment check error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to approve equipment check'
      });
    }
  }
);

/**
 * Reject individual equipment check
 * POST /api/supervisor/maintenance/:id/equipment/:type/reject
 */
router.post('/maintenance/:id/equipment/:type/reject',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  async (req, res) => {
    try {
      const { id, type } = req.params;
      const { reason } = req.body;
      const supervisorId = req.user.userId;

      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason must be at least 10 characters'
        });
      }

      const maintenance = await Maintenance.findById(id);

      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Verify supervisor ownership
      if (maintenance.supervisor.toString() !== supervisorId.toString() &&
        req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'You can only reject your own maintenance records'
        });
      }

      // Get the equipment check type key
      const checkKey = `${type}_checks`;
      if (!maintenance.equipment_checks || !maintenance.equipment_checks[checkKey]) {
        return res.status(404).json({
          success: false,
          message: 'Equipment check not found'
        });
      }

      // Determine which status field to use
      const statusField = ['generator', 'power_cabinet'].includes(type) ? 'status' : 'check_status';
      
      // Update the specific check status to rejected
      const checkData = maintenance.equipment_checks[checkKey];
      
      if (Array.isArray(checkData)) {
        // For array types (generator_checks, power_cabinet_checks)
        if (checkData.length > 0) {
          checkData.forEach(item => {
            item[statusField] = 'rejected';
            item.reviewed_at = new Date();
            item.reviewed_by = supervisorId;
            item.rejection_reason = reason;
          });
        }
      } else if (typeof checkData === 'object' && checkData !== null) {
        // For object types (grid, shelter, cleaning, fuel_tank)
        checkData[statusField] = 'rejected';
        checkData.reviewed_at = new Date();
        checkData.reviewed_by = supervisorId;
        checkData.rejection_reason = reason;
      }

      maintenance.markModified('equipment_checks');
      await maintenance.save();

      logger.info('Equipment check rejected', {
        maintenance_id: maintenance.maintenance_id,
        check_type: type,
        supervisor: supervisorId,
        reason
      });

      res.json({
        success: true,
        message: 'Equipment check rejected',
        data: {
          check_type: type,
          status: 'rejected'
        }
      });

    } catch (error) {
      logger.error('Reject equipment check error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reject equipment check'
      });
    }
  }
);

/**
 * Approve maintenance
 * POST /api/supervisor/maintenance/:id/approve
 */
router.post('/maintenance/:id/approve',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  [
    body('comments').optional().isString().withMessage('Comments must be string')
  ],
  async (req, res) => {
    console.log('\n========== APPROVE MAINTENANCE ==========');

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { id } = req.params;
      const { comments } = req.body;
      const supervisorId = req.user.userId;

      console.log('Maintenance ID:', id);
      console.log('Supervisor ID:', supervisorId);

      const maintenance = await Maintenance.findById(id)
        .populate('technician', 'fullName email');

      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Verify supervisor ownership
      if (maintenance.supervisor.toString() !== supervisorId.toString() &&
        req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'You can only approve your own maintenance records'
        });
      }

      // Approve
      await maintenance.approve(supervisorId, comments);

      console.log('✓ Maintenance approved:', maintenance.maintenance_id);

      logger.info('Maintenance approved', {
        maintenance_id: maintenance.maintenance_id,
        supervisor: supervisorId,
        technician: maintenance.technician._id,
        site: maintenance.site_id
      });

      console.log('========== SUCCESS ==========\n');

      res.json({
        success: true,
        message: 'Maintenance approved successfully',
        data: {
          maintenance_id: maintenance.maintenance_id,
          status: maintenance.status,
          reviewed_at: maintenance.reviewed_at,
          technician: {
            name: maintenance.technician.fullName,
            email: maintenance.technician.email
          }
        }
      });

    } catch (error) {
      console.log('========== ERROR ==========');
      console.error('Approve maintenance error:', error);
      console.log('===========================\n');

      logger.error('Approve maintenance error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to approve maintenance'
      });
    }
  }
);

/**
 * Reject maintenance
 * POST /api/supervisor/maintenance/:id/reject
 */
router.post('/maintenance/:id/reject',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  [
    body('reason').notEmpty().withMessage('Rejection reason is required')
      .isString()
      .isLength({ min: 10, max: 500 })
      .withMessage('Reason must be 10-500 characters')
  ],
  async (req, res) => {
    console.log('\n========== REJECT MAINTENANCE ==========');

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { id } = req.params;
      const { reason } = req.body;
      const supervisorId = req.user.userId;

      console.log('Maintenance ID:', id);
      console.log('Supervisor ID:', supervisorId);
      console.log('Reason:', reason);

      const maintenance = await Maintenance.findById(id)
        .populate('technician', 'fullName email');

      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Verify supervisor ownership
      if (maintenance.supervisor.toString() !== supervisorId.toString() &&
        req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'You can only reject your own maintenance records'
        });
      }

      // Reject
      await maintenance.reject(supervisorId, reason);

      console.log('✓ Maintenance rejected:', maintenance.maintenance_id);

      logger.info('Maintenance rejected', {
        maintenance_id: maintenance.maintenance_id,
        supervisor: supervisorId,
        technician: maintenance.technician._id,
        reason: reason
      });

      console.log('========== SUCCESS ==========\n');

      res.json({
        success: true,
        message: 'Maintenance rejected',
        data: {
          maintenance_id: maintenance.maintenance_id,
          status: maintenance.status,
          reviewed_at: maintenance.reviewed_at,
          rejection_reason: maintenance.rejection_reason,
          technician: {
            name: maintenance.technician.fullName,
            email: maintenance.technician.email
          }
        }
      });

    } catch (error) {
      console.log('========== ERROR ==========');
      console.error('Reject maintenance error:', error);
      console.log('===========================\n');

      logger.error('Reject maintenance error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reject maintenance'
      });
    }
  }
);

/**
 * Delete maintenance
 * DELETE /api/supervisor/maintenance/:id
 */
router.delete('/maintenance/:id',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const supervisorId = req.user.userId;
      const userRole = req.user.role;

      const maintenance = await Maintenance.findById(id);

      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance not found'
        });
      }

      // Authorization check
      if (userRole === 'supervisor' && maintenance.supervisor.toString() !== supervisorId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own scheduled maintenance'
        });
      }

      // Prevent deleting completed tasks
      if (maintenance.status === 'completed') {
          return res.status(400).json({
              success: false,
              message: 'Cannot delete completed maintenance.'
          });
      }

      await Maintenance.findByIdAndDelete(id);

      // Decrement technician task count
      if (maintenance.technician) {
         await User.findByIdAndUpdate(maintenance.technician, {
           $inc: { currentTasksCount: -1 }
         });
      }

      logger.info(`Maintenance deleted by ${userRole} ${supervisorId}: ${id}`);
      
      res.json({
        success: true,
        message: 'Maintenance deleted successfully'
      });

    } catch (error) {
      logger.error('Delete maintenance error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete maintenance',
        error: error.message
      });
    }
  }
);

/**
 * Get maintenance statistics for supervisor
 * GET /api/supervisor/maintenance/stats
 */
router.get('/maintenance/stats',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  async (req, res) => {
    try {
      const supervisorId = req.user.userId;
      const { period = '30' } = req.query; // days

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(period));

      const [
        totalPending,
        totalApproved,
        totalRejected,
        totalCompleted,
        avgApprovalTime,
        byPriority,
        byVisitType
      ] = await Promise.all([
        Maintenance.countDocuments({
          supervisor: supervisorId,
          status: 'pending_approval'
        }),
        Maintenance.countDocuments({
          supervisor: supervisorId,
          status: 'approved'
        }),
        Maintenance.countDocuments({
          supervisor: supervisorId,
          status: 'rejected',
          reviewed_at: { $gte: startDate }
        }),
        Maintenance.countDocuments({
          supervisor: supervisorId,
          status: 'completed',
          completed_at: { $gte: startDate }
        }),
        Maintenance.aggregate([
          {
            $match: {
              supervisor: supervisorId,
              status: { $in: ['approved', 'rejected'] },
              reviewed_at: { $exists: true },
              submitted_at: { $exists: true }
            }
          },
          {
            $project: {
              approval_time: {
                $subtract: ['$reviewed_at', '$submitted_at']
              }
            }
          },
          {
            $group: {
              _id: null,
              avg_time: { $avg: '$approval_time' }
            }
          }
        ]),
        Maintenance.aggregate([
          {
            $match: {
              supervisor: supervisorId,
              submitted_at: { $gte: startDate }
            }
          },
          {
            $group: {
              _id: '$priority',
              count: { $sum: 1 }
            }
          }
        ]),
        Maintenance.aggregate([
          {
            $match: {
              supervisor: supervisorId,
              submitted_at: { $gte: startDate }
            }
          },
          {
            $group: {
              _id: '$visit_type',
              count: { $sum: 1 }
            }
          }
        ])
      ]);

      const avgApprovalHours = avgApprovalTime[0]?.avg_time
        ? Math.round(avgApprovalTime[0].avg_time / (1000 * 60 * 60) * 10) / 10
        : 0;

      res.json({
        success: true,
        data: {
          period_days: parseInt(period),
          pending: totalPending,
          approved: totalApproved,
          rejected: totalRejected,
          completed: totalCompleted,
          avg_approval_time_hours: avgApprovalHours,
          by_priority: byPriority.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {}),
          by_visit_type: byVisitType.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {})
        }
      });

    } catch (error) {
      logger.error('Get maintenance stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch maintenance statistics'
      });
    }
  }
);


/**
 * Get scheduled/approved maintenance
 * GET /api/supervisor/maintenance/scheduled
 */
router.get('/maintenance/scheduled',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  async (req, res) => {
    try {
      const supervisorId = req.user.userId;
      const { page = 1, limit = 20, status } = req.query;

      const query = {
        supervisor: supervisorId
      };

      if (status) {
        query.status = status;
      } else {
        query.status = { $in: ['scheduled', 'approved', 'in_progress'] };
      }

      if (req.query.site_id) {
        query.site_id = req.query.site_id;
      }

      const skip = (page - 1) * limit;

      const scheduled = await Maintenance.find(query)
        .populate('technician', 'fullName email phone')
        .populate('parts_used.part_id', 'name part_number')
        .sort({ visit_date: 1 }) // Soonest first
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      // Enrich with site info
      const enriched = await Promise.all(
        scheduled.map(async (m) => {
          const site = await Site.findOne({ IHS_ID_SITE: m.site_id })
            .select('Site_Name Region GRATO_Cluster')
            .lean();

          return {
            ...m,
            site_details: site
          };
        })
      );

      const total = await Maintenance.countDocuments(query);

      res.json({
        success: true,
        data: enriched,
        pagination: {
          current: parseInt(page),
          pageSize: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      logger.error('Get scheduled maintenance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch scheduled maintenance'
      });
    }
  }
);




// ============================================
// CLUSTERS - Get specific cluster with all details
// ============================================
router.get('/clusters/:clusterId', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user._id;
    const { clusterId } = req.params;

    // Verify supervisor owns this cluster
    const cluster = await Cluster.findOne({ _id: clusterId, supervisor: supervisorId })
      .populate('assigned_technicians.technician', 'fullName email phone specializations assignedTowers')
      .lean();

    if (!cluster) {
      return res.status(404).json({
        success: false,
        error: 'Cluster not found'
      });
    }

    // Get all sites in this cluster
    const sites = await Site.find({
      $or: [
        { 'GRATO_Cluster': clusterId.toString() },
        { cluster_id: clusterId }
      ]
    })
      .populate('Current_Generators', 'model serial_number status')
      .select('IHS_ID_SITE Site_Name Region Actual_Date_Visit Type_of_Visit Current_Generators Technician_Name')
      .lean();

    // Get technicians from cluster
    const technicianIds = cluster.assigned_technicians?.map(at => at.technician._id) || [];

    // Get pending maintenance for sites in this cluster
    const siteIds = sites.map(s => s.IHS_ID_SITE);
    const maintenance = await Maintenance.find({
      tower: { $in: siteIds },
      status: { $in: ['pending', 'scheduled', 'in_progress'] }
    })
      .populate('technician', 'fullName')
      .sort({ scheduledDate: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        cluster: {
          _id: cluster._id,
          name: cluster.name,
          code: cluster.code,
          region: cluster.region,
          description: cluster.description
        },
        technicians: cluster.assigned_technicians || [],
        sites: sites,
        maintenance: maintenance,
        stats: {
          totalTechnicians: technicianIds.length,
          totalSites: sites.length,
          activeSites: sites.filter(s => s.Current_Generators?.length > 0).length,
          pendingMaintenance: maintenance.length,
          totalGenerators: sites.reduce((sum, s) => sum + (s.Current_Generators?.length || 0), 0)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching cluster details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cluster details',
      message: error.message
    });
  }
});

// ============================================
// TECHNICIANS - Get all supervised technicians
// ============================================
router.get('/technicians', authenticateToken, requireRole(['supervisor', 'admin', ]), async (req, res) => {
  try {
    const supervisorId = req.user._id;

    // Get supervisor's clusters
    const clusters = await Cluster.find({ supervisor: supervisorId })
      .select('assigned_technicians')
      .lean();

    const technicianIds = new Set();
    clusters.forEach(cluster => {
      cluster.assigned_technicians?.forEach(at => {
        if (at.technician) {
          technicianIds.add(at.technician.toString());
        }
      });
    });

    // Also get technicians assigned directly to this supervisor
    const supervisor = await User.findById(supervisorId).select('assignedTechnicians');
    if (supervisor && supervisor.assignedTechnicians) {
      supervisor.assignedTechnicians.forEach(tid => technicianIds.add(tid.toString()));
    }

    // Also get technicians who have this supervisor set as their supervisor
    const directlySupervised = await User.find({ supervisor: supervisorId, role: 'technician' }).select('_id');
    directlySupervised.forEach(tech => technicianIds.add(tech._id.toString()));

    // Get technician details
    const technicians = await User.find({
      _id: { $in: Array.from(technicianIds) },
      role: 'technician'
    })
      .select('fullName email phone specializations assignedClusters assignedTowers isActive isOnline')
      .lean();

    // Enrich with assignment and task info
    const enrichedTechnicians = await Promise.all(
      technicians.map(async (tech) => {
        const [pendingTasks, pendingReview, completed, sitesVisited] = await Promise.all([
          Maintenance.countDocuments({
            technician: tech._id,
            status: { $in: ['pending', 'scheduled', 'in_progress', 'draft'] }
          }),
          Maintenance.countDocuments({
            technician: tech._id,
            status: 'pending_approval'
          }),
          Maintenance.countDocuments({
            technician: tech._id,
            status: { $in: ['pending_approval', 'approved', 'completed'] }
          }),
          Site.countDocuments({
            'visit_history.technician_id': tech._id
          })
        ]);

        return {
          _id: tech._id,
          fullName: tech.fullName,
          email: tech.email,
          phone: tech.phone,
          specializations: tech.specializations || [],
          isActive: tech.isActive !== false,
          isOnline: tech.isOnline || false,
          assignedClusters: tech.assignedClusters?.length || 0,
          assignedTowers: tech.assignedTowers?.length || 0,
          sites_assigned: tech.assignedTowers?.length || 0,
          activeTasks: pendingTasks,
          pending_tasks: pendingTasks,
          pending_approvals: pendingReview,
          completed_tasks: completed,
          sitesVisited
        };
      })
    );

    res.status(200).json({
      success: true,
      data: enrichedTechnicians,
      count: enrichedTechnicians.length
    });

  } catch (error) {
    console.error('Error fetching technicians:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch technicians',
      message: error.message
    });
  }
});

// ============================================
// TECHNICIANS - Get specific technician details
// ============================================
router.get('/technicians/:technicianId', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user._id;
    const { technicianId } = req.params;

    // Verify technician is under this supervisor
    const clusters = await Cluster.findOne({
      supervisor: supervisorId,
      'assigned_technicians.technician': technicianId
    }).lean();

    if (!clusters) {
      return res.status(403).json({
        success: false,
        error: 'Technician not found under your supervision'
      });
    }

    const technician = await User.findById(technicianId)
      .populate('assignedClusters', 'name code region')
      .lean();

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    // Get sites assigned to this technician
    const sites = await Site.find({
      'visit_history.technician_id': technicianId
    })
      .select('IHS_ID_SITE Site_Name Region Actual_Date_Visit visit_history')
      .lean();

    // Extract visits for this technician
    let technicianVisits = [];
    sites.forEach(site => {
      site.visit_history?.forEach(visit => {
        if (visit.technician_id?.toString() === technicianId) {
          technicianVisits.push({
            ...visit,
            site_id: site.IHS_ID_SITE,
            Site_Name: site.Site_Name,
            Region: site.Region
          });
        }
      });
    });

    technicianVisits.sort((a, b) => new Date(b.Actual_Date_Visit) - new Date(a.Actual_Date_Visit));

    // Get active tasks
    const activeTasks = await Maintenance.find({
      technician: technicianId,
      status: { $in: ['pending', 'scheduled', 'in_progress'] }
    })
      .populate('supervisor', 'fullName')
      .sort({ scheduledDate: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        technician: {
          _id: technician._id,
          fullName: technician.fullName,
          email: technician.email,
          phone: technician.phone,
          specializations: technician.specializations,
          position: technician.position,
          isActive: technician.isActive
        },
        assignedClusters: technician.assignedClusters || [],
        recentVisits: technicianVisits.slice(0, 20),
        activeTasks,
        stats: {
          totalVisits: technicianVisits.length,
          recentVisitsThisMonth: technicianVisits.filter(v => {
            const visit = new Date(v.Actual_Date_Visit);
            const month = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            return visit >= month;
          }).length,
          activeTasks: activeTasks.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching technician details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch technician details',
      message: error.message
    });
  }
});

// ============================================
// SITES - Get all sites assigned to supervisor (via clusters and technicians)
// ============================================
router.get('/sites', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user._id;
    const { region, priority, needsMaintenance } = req.query;

    // Get supervisor's clusters
    const clusters = await Cluster.find({ supervisor: supervisorId })
      .select('_id')
      .lean();

    const clusterIds = clusters.map(c => c._id);

    // Get all technicians supervised by this supervisor
    const technicians = await User.find({ 
      supervisor: supervisorId, 
      role: 'technician',
      isActive: true 
    })
      .select('assigned_sites')
      .lean();

    // Collect all site IDs assigned to these technicians
    const technicianSiteIds = [];
    technicians.forEach(tech => {
      if (tech.assigned_sites && tech.assigned_sites.length > 0) {
        technicianSiteIds.push(...tech.assigned_sites);
      }
    });

    // Build site query - include sites from both clusters AND assigned to technicians
    const siteQuery = {
      $or: []
    };

    // Add cluster-based sites
    if (clusterIds.length > 0) {
      siteQuery.$or.push(
        { 'GRATO_Cluster': { $in: clusterIds.map(id => id.toString()) } },
        { cluster: { $in: clusterIds } }
      );
    }

    // Add technician-assigned sites
    if (technicianSiteIds.length > 0) {
      siteQuery.$or.push({ IHS_ID_SITE: { $in: technicianSiteIds } });
    }

    // If no clusters or technicians, return empty
    if (siteQuery.$or.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        count: 0,
        message: 'No sites assigned to this supervisor'
      });
    }

    // Apply additional filters
    if (region) siteQuery.Region = region;
    if (priority) siteQuery.Sites_Priority = priority;

    if (needsMaintenance === 'true') {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90);
      siteQuery.$and = [
        { $or: siteQuery.$or },
        {
          $or: [
            { Actual_Date_Visit: { $lt: cutoffDate } },
            { Actual_Date_Visit: { $exists: false } },
            { Actual_Date_Visit: null }
          ]
        }
      ];
      delete siteQuery.$or;
    }

    const sites = await Site.find(siteQuery)
      .populate('Current_Generators', 'model serial_number status')
      .select('IHS_ID_SITE Site_Name Region Sites_Priority Actual_Date_Visit Type_of_Visit Current_Generators Technician_Name')
      .sort({ Actual_Date_Visit: -1 })
      .lean();

    // Enrich with calculated fields
    const enrichedSites = sites.map(site => {
      const lastVisit = site.Actual_Date_Visit ? new Date(site.Actual_Date_Visit) : null;
      const daysSinceVisit = lastVisit ?
        Math.floor((new Date() - lastVisit) / (1000 * 60 * 60 * 24)) : null;

      return {
        ...site,
        daysSinceLastVisit: daysSinceVisit,
        needsVisit: daysSinceVisit && daysSinceVisit > 90,
        generatorCount: site.Current_Generators?.length || 0
      };
    });

    res.status(200).json({
      success: true,
      data: enrichedSites,
      count: enrichedSites.length
    });

  } catch (error) {
    console.error('Error fetching sites:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sites',
      message: error.message
    });
  }
});

// ============================================
// SITES - Get specific site details with all equipment data
// ============================================
router.get('/sites/:siteId', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const { siteId } = req.params;

    const site = await Site.findOne({ IHS_ID_SITE: siteId })
      .populate('Current_Generators', 'model serial_number status specifications current_stats')
      .lean();

    if (!site) {
      return res.status(404).json({
        success: false,
        error: 'Site not found'
      });
    }

    // Return comprehensive site data including all equipment details
    res.status(200).json({
      success: true,
      data: {
        _id: site._id,
        IHS_ID_SITE: site.IHS_ID_SITE,
        Site_Name: site.Site_Name,
        Region: site.Region,
        Sites_Priority: site.Sites_Priority,
        Sites_Type: site.Sites_Type,
        Sites_Configuration_Outdoor_Indoor: site.Sites_Configuration_Outdoor_Indoor,
        Sites_Power_Topology: site.Sites_Power_Topology,
        GRATO_Cluster: site.GRATO_Cluster,
        Latitude: site.Latitude,
        Longitude: site.Longitude,
        Technician_Name: site.Technician_Name,
        Technician_Contact: site.Technician_Contact,
        Company_in_charge_of_Security: site.Company_in_charge_of_Security,
        
        // Visit information
        Actual_Date_Visit: site.Actual_Date_Visit,
        Previous_Date_Visit: site.Previous_Date_Visit,
        Type_of_Visit: site.Type_of_Visit,
        Visit_Comments: site.Visit_Comments,
        
        // Generator information
        Number_of_Generators: site.Number_of_Generators,
        Generators_Details: site.Generators_Details || [],
        DG_Age_Check: site.DG_Age_Check,
        Hour_Meter_Check: site.Hour_Meter_Check,
        Automatization_Status: site.Automatization_Status,
        Current_Generators: site.Current_Generators || [],
        
        // Power Cabinet
        Power_Cab_1_Type: site.Power_Cab_1_Type,
        Rectifiers: site.Rectifiers || [],
        Batteries: site.Batteries || [],
        Alarm_Cable_Status: site.Alarm_Cable_Status,
        
        // Fuel System
        Type_de_Tank: site.Type_de_Tank,
        Tank_Capacity_1: site.Tank_Capacity_1,
        Tank_Length: site.Tank_Length,
        Tank_Width: site.Tank_Width,
        Tank_Height: site.Tank_Height,
        Tank_Bottom: site.Tank_Bottom,
        Fuel_SQ_Check: site.Fuel_SQ_Check,
        Previous_Fuel_Quantity: site.Previous_Fuel_Quantity,
        Fuel_Quantity_Found: site.Fuel_Quantity_Found,
        Height_Found_CM_1: site.Height_Found_CM_1,
        Height_Found_CM_2: site.Height_Found_CM_2,
        Fuel_Quantity_Added: site.Fuel_Quantity_Added,
        Fuel_Quantity_Consumed: site.Fuel_Quantity_Consumed,
        
        // Grid/Electrical
        Earthing_OHM: site.Earthing_OHM,
        ENEO_Working: site.ENEO_Working,
        Phase_Type: site.Phase_Type,
        N_PH1_Voltage: site.N_PH1_Voltage,
        N_PH2_Voltage: site.N_PH2_Voltage,
        N_PH3_Voltage: site.N_PH3_Voltage,
        ENEO_Meter_Number: site.ENEO_Meter_Number,
        ENEO_SQ_Check: site.ENEO_SQ_Check,
        Actual_Index: site.Actual_Index,
        Previous_Index: site.Previous_Index,
        Consumed_KWA: site.Consumed_KWA,
        Comments_on_Grid: site.Comments_on_Grid,
        Grid_Availability: site.Grid_Availability,
        
        // Solar System
        Solar_System: site.Solar_System,
        
        // AC System
        AC_System: site.AC_System,
        
        // Load Readings
        Load_Readings: site.Load_Readings,
        
        // Security Details
        Security_Detail: site.Security_Detail
      }
    });

  } catch (error) {
    console.error('Error fetching site details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch site details',
      message: error.message
    });
  }
});

// ============================================
// MAINTENANCE - Schedule new maintenance
// ============================================
router.post('/maintenance/schedule',
  authenticateToken,
  requireRole('supervisor'),
  [
    body('technician').notEmpty().withMessage('Technician is required'),
    // Accept either site_id or tower
    body().custom((value, { req }) => {
      if (!req.body.site_id && !req.body.tower) throw new Error('Site ID is required');
      return true;
    }),
    // Accept either visit_type or type
    body().custom((value, { req }) => {
      if (!req.body.visit_type && !req.body.type) throw new Error('Visit type is required');
      return true;
    }),
    // Accept either visit_date or scheduledDate
    body().custom((value, { req }) => {
      if (!req.body.visit_date && !req.body.scheduledDate) throw new Error('Scheduled date is required');
      return true;
    }),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { technician, priority, notes } = req.body;
      
      // Flexible field handling
      const targetSiteId = req.body.site_id || req.body.tower;
      const targetDateStr = req.body.visit_date || req.body.scheduledDate;
      let targetType = req.body.visit_type || req.body.type;

      // Handle legacy mapping if needed
      if (req.body.type && !req.body.visit_type) {
         if (targetType === 'routine') targetType = 'PM';
         else if (targetType === 'repair') targetType = 'END';
         else if (targetType === 'inspection') targetType = 'PM'; 
         else if (targetType === 'emergency') targetType = 'END'; 
         else targetType = 'PM'; // Default
      }
      
      const supervisorId = req.user._id || req.user.userId;

      // Verify technician
      const technicianUser = await User.findById(technician);
      if (!technicianUser || technicianUser.role !== 'technician') {
        return res.status(404).json({
          success: false,
          message: 'Technician not found'
        });
      }

      // Verify site exists
      const site = await Site.findOne({
        $or: [
          { IHS_ID_SITE: targetSiteId },
          { _id: mongoose.Types.ObjectId.isValid(targetSiteId) ? targetSiteId : null }
        ]
      });

      if (!site) {
        return res.status(404).json({
          success: false,
          message: 'Site not found'
        });
      }

      const scheduleDateObj = new Date(targetDateStr);

      // Conflict check disabled - allow multiple tasks for same technician
      // const conflict = await Maintenance.findOne({
      //   technician,
      //   status: { $in: ['scheduled', 'in_progress'] },
      //   $or: [
      //      { visit_date: {
      //         $gte: new Date(scheduleDateObj.getTime() - 2 * 60 * 60 * 1000),
      //         $lte: new Date(scheduleDateObj.getTime() + 2 * 60 * 60 * 1000)
      //        }
      //      }
      //   ]
      // });

      // if (conflict) {
      //   return res.status(409).json({
      //     success: false,
      //     message: 'Technician has conflicting task scheduled'
      //   });
      // }

      // Create maintenance record
      const maintenance = new Maintenance({
        maintenance_id: `MAINT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        site_id: site.IHS_ID_SITE,
        site_name: site.Site_Name,
        technician,
        technician_name: technicianUser.fullName,
        supervisor: supervisorId,
        created_by: supervisorId,
        visit_type: targetType, 
        visit_date: scheduleDateObj,
        scheduled_date: scheduleDateObj,
        priority: priority || 'medium',
        status: 'scheduled',
        is_draft: false,
        site_metadata: {
          cluster: site.GRATO_Cluster,
          site_priority: site.Site_Priority,
          state: site.State,
          operator: site.Operator,
        },
        work_performed: notes || ''
      });

      await maintenance.save();
      await maintenance.populate('technician', 'fullName email phone');

      // Create notification for technician
      try {
        const Notification = require('../models/Notifications');
        await Notification.create({
          recipient: technician,
          type: 'task_assigned',
          title: 'New Task Assigned',
          message: `You have been assigned a ${targetType} maintenance task at ${site.Site_Name || site.IHS_ID_SITE} scheduled for ${new Date(targetDateStr).toLocaleDateString()}`,
          data: {
            maintenanceId: maintenance._id,
            siteId: site.IHS_ID_SITE,
            siteName: site.Site_Name,
            additionalData: {
              type: targetType,
              scheduledDate: targetDateStr,
              priority: priority || 'medium'
            }
          },
          priority: priority || 'medium',
          read: false
        });
        logger.info('Notification created for technician:', technician);
      } catch (notifError) {
        logger.error('Failed to create notification:', notifError);
        // Don't fail the request if notification fails
      }

      logger.info('Maintenance scheduled', {
        maintenanceId: maintenance._id,
        site: targetSiteId,
        technician: technicianUser.fullName
      });

      res.status(201).json({
        success: true,
        message: 'Maintenance scheduled successfully',
        data: maintenance
      });

    } catch (error) {
      logger.error('Schedule maintenance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to schedule maintenance',
        message: error.message
      });
    }
  }
);

router.get('/generators',
  authenticateToken,
  requireRole('supervisor', 'admin'),
  async (req, res) => {
    try {
      const { tower_id } = req.query;

      let query = {};

      // If tower_id is provided, filter by it
      if (tower_id) {
        // tower_id could be IHS_ID_SITE format
        // Find the site first to get generator references
        const site = await Site.findOne({
          $or: [
            { IHS_ID_SITE: tower_id },
            { _id: mongoose.Types.ObjectId.isValid(tower_id) ? tower_id : null }
          ]
        }).select('Current_Generators').lean();

        if (site && site.Current_Generators && site.Current_Generators.length > 0) {
          query._id = { $in: site.Current_Generators };
        } else {
          // Return empty array if no generators for this site
          return res.json({
            success: true,
            data: [],
            count: 0
          });
        }
      }

      // Fetch generators
      const Generator = mongoose.model('Generator');
      const generators = await Generator.find(query)
        .select('_id model serial_number status specifications current_stats')
        .lean();

      res.json({
        success: true,
        data: generators,
        count: generators.length
      });

    } catch (error) {
      logger.error('Get supervisor generators error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching generators',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// ============================================
// MAINTENANCE - Get pending and scheduled
// ============================================
router.get('/maintenance', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user._id;
    const { status = 'pending,scheduled,in_progress' } = req.query;

    const statusArray = status.split(',');

    const maintenance = await Maintenance.find({
      supervisor: supervisorId,
      status: { $in: statusArray }
    })
      .populate('technician', 'fullName email phone')
      .sort({ scheduledDate: 1 })
      .lean();

    // Enrich with site info
    const enriched = await Promise.all(
      maintenance.map(async (m) => {
        const site = await Site.findOne({ IHS_ID_SITE: m.tower })
          .select('Site_Name Region')
          .lean();

        return {
          ...m,
          site: site ? {
            name: site.Site_Name,
            region: site.Region
          } : null
        };
      })
    );

    res.status(200).json({
      success: true,
      data: enriched,
      count: enriched.length
    });

  } catch (error) {
    logger.error('Get maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch maintenance',
      message: error.message
    });
  }
});

// ============================================
// SITES - Get all supervised sites
// ============================================
router.get('/sites', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user._id;

    // Get supervisor's clusters
    const clusters = await Cluster.find({ supervisor: supervisorId }).select('_id');
    const clusterIds = clusters.map(c => c._id);

    // Get sites
    const sites = await Site.find({
      $or: clusterIds.length > 0 ? [
        { 'GRATO_Cluster': { $in: clusterIds.map(id => id.toString()) } },
        { cluster_id: { $in: clusterIds } }
      ] : [{ _id: null }]
    })
      .select('IHS_ID_SITE Site_Name Region Actual_Date_Visit Current_Generators')
      .lean();

    // Enrich with pending maintenance count
    const enriched = await Promise.all(sites.map(async (site) => {
      const pendingCount = await Maintenance.countDocuments({
        $or: [
          { tower: site.IHS_ID_SITE },
          { site_id: site.IHS_ID_SITE }
        ],
        status: 'pending_approval'
      });
      return {
        ...site,
        pending_maintenance: pendingCount,
        generator_count: site.Current_Generators?.length || 0
      };
    }));

    res.json({
      success: true,
      data: enriched,
      count: enriched.length
    });
  } catch (error) {
    logger.error('Error fetching supervised sites:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sites'
    });
  }
});

// ============================================
// SITE VISITS - Get technician visits under supervision
// ============================================
/**
 * Get site visits from supervised technicians
 * GET /api/supervisor/site-visits
 * 
 * Returns completed site visits (Maintenance records with status 'pending_approval', 'approved', etc.)
 * These are tasks that have been completed and submitted by technicians
 * NOTE: "Visits" are completed "Tasks" - same unified entity (Maintenance model)
 */
router.get('/site-visits', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user._id;
    const { page = 1, limit = 50, start_date, end_date } = req.query;

    // Get technicians under supervision
    const clusters = await Cluster.find({ supervisor: supervisorId })
      .select('assigned_technicians')
      .lean();

    const technicianIds = new Set();
    clusters.forEach(c => {
      c.assigned_technicians?.forEach(at => {
        technicianIds.add(at.technician.toString());
      });
    });

    if (technicianIds.size === 0) {
      return res.json({
        success: true,
        data: [],
        pagination: { current: 1, pageSize: parseInt(limit), total: 0, pages: 0 }
      });
    }

    // Build query
    const query = {
      'visit_history.technician_id': { $in: Array.from(technicianIds) }
    };

    if (start_date || end_date) {
      query['visit_history.Actual_Date_Visit'] = {};
      if (start_date) query['visit_history.Actual_Date_Visit'].$gte = new Date(start_date);
      if (end_date) query['visit_history.Actual_Date_Visit'].$lte = new Date(end_date);
    }

    const sites = await Site.find(query)
      .select('IHS_ID_SITE Site_Name Region visit_history')
      .lean();

    // Extract visits
    let allVisits = [];
    const techArray = Array.from(technicianIds);

    sites.forEach(site => {
      site.visit_history?.forEach(visit => {
        if (visit.technician_id && techArray.includes(visit.technician_id.toString())) {
          allVisits.push({
            ...visit,
            site_id: site.IHS_ID_SITE,
            Site_Name: site.Site_Name,
            Region: site.Region
          });
        }
      });
    });

    allVisits.sort((a, b) => new Date(b.Actual_Date_Visit) - new Date(a.Actual_Date_Visit));

    const total = allVisits.length;
    const startIdx = (page - 1) * parseInt(limit);
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
    logger.error('Get site visits error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch site visits',
      message: error.message
    });
  }
});

// ============================================
// PART REQUESTS - Get part requests for supervised technicians
// ============================================
router.get('/part-requests', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user.userId;
    const { status, urgency, page = 1, limit = 20 } = req.query;

    console.log('\n========== GET PART REQUESTS ==========');
    console.log('Supervisor ID:', supervisorId);
    console.log('Filters:', { status, urgency });

    // Get all technicians supervised by this supervisor
    const clusters = await Cluster.find({ supervisor: supervisorId })
      .select('assigned_technicians')
      .lean();

    const technicianIds = new Set();
    clusters.forEach(cluster => {
      cluster.assigned_technicians?.forEach(at => {
        if (at.technician) {
          technicianIds.add(at.technician.toString());
        }
      });
    });

    // Also get technicians assigned directly
    const supervisor = await User.findById(supervisorId).select('assignedTechnicians');
    if (supervisor && supervisor.assignedTechnicians) {
      supervisor.assignedTechnicians.forEach(tid => technicianIds.add(tid.toString()));
    }

    // Also get technicians who have this supervisor set
    const directlySupervised = await User.find({ supervisor: supervisorId, role: 'technician' }).select('_id');
    directlySupervised.forEach(tech => technicianIds.add(tech._id.toString()));

    console.log('Found technicians:', Array.from(technicianIds).length);

    // Build query
    const query = {
      technician: { $in: Array.from(technicianIds) }
    };

    if (status) {
      query.status = status;
    }

    if (urgency) {
      query.urgency = urgency;
    }

    const skip = (page - 1) * limit;

    // Get part requests
    const PartRequest = require('../models/PartRequest');
    const Part = require('../models/Part');

    const requests = await PartRequest.find(query)
      .populate('technician', 'fullName email phone')
      .populate('items.part', 'name part_number category stock')
      .populate('supervisor_approval.approved_by', 'fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await PartRequest.countDocuments(query);

    console.log(`Found ${requests.length} part requests`);
    console.log('========== SUCCESS ==========\n');

    res.json({
      success: true,
      data: requests,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.log('========== ERROR ==========');
    console.error('Get part requests error:', error);
    console.log('===========================\n');

    logger.error('Get part requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch part requests',
      message: error.message
    });
  }
});

// ============================================
// PART REQUESTS - Approve part request
// ============================================
router.post('/part-requests/:id/approve',
  authenticateToken,
  requireRole('supervisor'),
  [
    body('comments').optional().isString().withMessage('Comments must be a string')
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

      const { id } = req.params;
      const { comments } = req.body;
      const supervisorId = req.user._id || req.user.userId;

      console.log('\n========== APPROVE PART REQUEST ==========');
      console.log('Request ID:', id);
      console.log('Supervisor ID:', supervisorId);

      const PartRequest = require('../models/PartRequest');
      const partRequest = await PartRequest.findById(id)
        .populate('technician', 'fullName email');

      if (!partRequest) {
        return res.status(404).json({
          success: false,
          message: 'Part request not found'
        });
      }

      // Verify technician is under this supervisor
      const technician = await User.findById(partRequest.technician._id);
      if (!technician) {
        return res.status(404).json({
          success: false,
          message: 'Technician not found'
        });
      }

      // Check if supervisor has authority over this technician
      const clusters = await Cluster.find({
        supervisor: supervisorId,
        'assigned_technicians.technician': partRequest.technician._id
      });

      const supervisor = await User.findById(supervisorId);
      const isDirectlySupervisedTech = technician.supervisor?.toString() === supervisorId.toString();
      const isAssignedTech = supervisor?.assignedTechnicians?.some(tid => tid.toString() === technician._id.toString());

      if (clusters.length === 0 && !isDirectlySupervisedTech && !isAssignedTech) {
        return res.status(403).json({
          success: false,
          message: 'You can only approve requests from your supervised technicians'
        });
      }

      // Check if already processed
      if (partRequest.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `Request is already ${partRequest.status}`
        });
      }

      // Update request
      partRequest.status = 'approved';
      partRequest.supervisor_approval = {
        approved_by: supervisorId,
        approved_at: new Date(),
        comments: comments || ''
      };

      await partRequest.save();

      // Create notification for technician
      try {
        const Notification = require('../models/Notifications');
        await Notification.create({
          recipient: partRequest.technician._id,
          type: 'part_request_approved',
          title: 'Part Request Approved',
          message: `Your part request (${partRequest.request_id}) has been approved${comments ? ': ' + comments : ''}`,
          data: {
            partRequestId: partRequest._id,
            requestId: partRequest.request_id,
            comments: comments || ''
          },
          priority: partRequest.urgency,
          read: false
        });
        logger.info('Notification created for technician:', partRequest.technician._id);
      } catch (notifError) {
        logger.error('Failed to create notification:', notifError);
      }

      logger.info('Part request approved', {
        request_id: partRequest.request_id,
        supervisor: supervisorId,
        technician: partRequest.technician._id
      });

      console.log('✓ Part request approved:', partRequest.request_id);
      console.log('========== SUCCESS ==========\n');

      res.json({
        success: true,
        message: 'Part request approved successfully',
        data: {
          request_id: partRequest.request_id,
          status: partRequest.status,
          approved_at: partRequest.supervisor_approval.approved_at
        }
      });

    } catch (error) {
      console.log('========== ERROR ==========');
      console.error('Approve part request error:', error);
      console.log('===========================\n');

      logger.error('Approve part request error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to approve part request'
      });
    }
  }
);

// ============================================
// PART REQUESTS - Reject part request
// ============================================
router.post('/part-requests/:id/reject',
  authenticateToken,
  requireRole('supervisor'),
  [
    body('reason').notEmpty().withMessage('Rejection reason is required')
      .isString()
      .isLength({ min: 10, max: 500 })
      .withMessage('Reason must be 10-500 characters')
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

      const { id } = req.params;
      const { reason } = req.body;
      const supervisorId = req.user._id || req.user.userId;

      console.log('\n========== REJECT PART REQUEST ==========');
      console.log('Request ID:', id);
      console.log('Supervisor ID:', supervisorId);
      console.log('Reason:', reason);

      const PartRequest = require('../models/PartRequest');
      const partRequest = await PartRequest.findById(id)
        .populate('technician', 'fullName email');

      if (!partRequest) {
        return res.status(404).json({
          success: false,
          message: 'Part request not found'
        });
      }

      // Verify technician is under this supervisor
      const technician = await User.findById(partRequest.technician._id);
      if (!technician) {
        return res.status(404).json({
          success: false,
          message: 'Technician not found'
        });
      }

      // Check if supervisor has authority over this technician
      const clusters = await Cluster.find({
        supervisor: supervisorId,
        'assigned_technicians.technician': partRequest.technician._id
      });

      const supervisor = await User.findById(supervisorId);
      const isDirectlySupervisedTech = technician.supervisor?.toString() === supervisorId.toString();
      const isAssignedTech = supervisor?.assignedTechnicians?.some(tid => tid.toString() === technician._id.toString());

      if (clusters.length === 0 && !isDirectlySupervisedTech && !isAssignedTech) {
        return res.status(403).json({
          success: false,
          message: 'You can only reject requests from your supervised technicians'
        });
      }

      // Check if already processed
      if (partRequest.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `Request is already ${partRequest.status}`
        });
      }

      // Update request
      partRequest.status = 'rejected';
      partRequest.supervisor_approval = {
        approved_by: supervisorId,
        approved_at: new Date(),
        comments: reason
      };

      await partRequest.save();

      // Create notification for technician
      try {
        const Notification = require('../models/Notifications');
        await Notification.create({
          recipient: partRequest.technician._id,
          type: 'part_request_rejected',
          title: 'Part Request Rejected',
          message: `Your part request (${partRequest.request_id}) has been rejected: ${reason}`,
          data: {
            partRequestId: partRequest._id,
            requestId: partRequest.request_id,
            reason: reason
          },
          priority: 'high',
          read: false
        });
        logger.info('Notification created for technician:', partRequest.technician._id);
      } catch (notifError) {
        logger.error('Failed to create notification:', notifError);
      }

      logger.info('Part request rejected', {
        request_id: partRequest.request_id,
        supervisor: supervisorId,
        technician: partRequest.technician._id,
        reason
      });

      console.log('✓ Part request rejected:', partRequest.request_id);
      console.log('========== SUCCESS ==========\n');

      res.json({
        success: true,
        message: 'Part request rejected',
        data: {
          request_id: partRequest.request_id,
          status: partRequest.status,
          rejected_at: partRequest.supervisor_approval.approved_at
        }
      });

    } catch (error) {
      console.log('========== ERROR ==========');
      console.error('Reject part request error:', error);
      console.log('===========================\n');

      logger.error('Reject part request error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reject part request'
      });
    }
  }
);

module.exports = router;


