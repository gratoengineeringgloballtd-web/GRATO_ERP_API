const User = require('../models/User');
const DailyAttendance = require('../models/DailyAttendance');
const Cluster = require('../models/Cluster');
const Tower = require('../models/Tower');
const Generator = require('../models/Generator');
const Maintenance = require('../models/Maintenance'); // Assuming you have this
const logger = require('../utils/logger');

/**
 * Get supervisor's supervised technicians with full details
 * GET /api/supervisor/technicians
 */
exports.getSupervisedTechnicians = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user.id;

    logger.info(`Fetching technicians for supervisor: ${supervisorId}`);

    // Get supervisor to verify
    const supervisor = await User.findById(supervisorId);
    if (!supervisor || supervisor.role !== 'supervisor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Supervisor role required.'
      });
    }

    // Get all technicians supervised by this supervisor
    const technicians = await User.find({
      role: 'technician',
      _id: { $in: supervisor.supervisedTechnicians || [] }
    })
      .populate({
        path: 'assignedClusters',
        select: 'name code region supervisor stats',
        populate: {
          path: 'supervisor',
          select: 'fullName email'
        }
      })
      .populate({
        path: 'assignedTowers',
        select: 'name location status specifications maintenance_schedule',
        options: { limit: 50 } // Limit to avoid huge payloads
      })
      .select('-password -refreshToken')
      .lean();

    // Enrich with additional stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get attendance for these technicians
    const attendanceRecords = await DailyAttendance.find({
        technician: { $in: technicians.map(t => t._id) },
        date: today
    }).lean();

    const attendanceMap = attendanceRecords.reduce((acc, curr) => {
        acc[curr.technician.toString()] = curr;
        return acc;
    }, {});

    const enrichedTechnicians = technicians.map(tech => ({
      ...tech,
      clusterCount: tech.assignedClusters?.length || 0,
      towerCount: tech.assignedTowers?.length || 0,
      clusterNames: tech.assignedClusters?.map(c => c.name).join(', ') || 'None',
      isActive: tech.isActive !== false,
      dailyAttendance: attendanceMap[tech._id.toString()] || null,
      isCheckedIn: !!attendanceMap[tech._id.toString()]
    }));

    logger.info(`Found ${enrichedTechnicians.length} technicians for supervisor ${supervisorId}`);

    res.status(200).json({
      success: true,
      count: enrichedTechnicians.length,
      data: enrichedTechnicians
    });
  } catch (error) {
    logger.error('Error fetching supervised technicians:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch technicians',
      error: error.message
    });
  }
};

/**
 * Get supervisor's towers with generators
 * GET /api/supervisor/towers
 */
exports.getSupervisorTowers = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user.id;

    logger.info(`Fetching towers for supervisor: ${supervisorId}`);

    // Get supervisor
    const supervisor = await User.findById(supervisorId);
    if (!supervisor || supervisor.role !== 'supervisor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Supervisor role required.'
      });
    }

    // Get towers assigned to this supervisor
    const towers = await Tower.find({
      _id: { $in: supervisor.assignedTowers || [] }
    })
      .populate('cluster_id', 'name code region')
      .populate('primary_generator', 'model status current_stats')
      .populate('backup_generator', 'model status current_stats')
      .populate('supervisor', 'fullName email phone')
      .select('-assigned_technicians.technician_id') // Exclude detailed technician info
      .lean();

    logger.info(`Found ${towers.length} towers for supervisor ${supervisorId}`);

    res.status(200).json({
      success: true,
      count: towers.length,
      data: towers
    });
  } catch (error) {
    logger.error('Error fetching supervisor towers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch towers',
      error: error.message
    });
  }
};

router.get('/technician-site-visits',
  authenticateToken,
  requireRole(['supervisor']),
  async (req, res) => {
    console.log('\n========== GET SUPERVISOR TECHNICIAN SITE VISITS ==========');
    
    try {
      const supervisorId = req.user.userId;
      const { technicianId, startDate, endDate, region, visitType } = req.query;

      console.log('Supervisor ID:', supervisorId);
      console.log('Filters:', { technicianId, startDate, endDate, region, visitType });

      // Find all clusters supervised by this supervisor
      const clusters = await Cluster.find({ supervisor: supervisorId })
        .select('assigned_technicians')
        .lean();

      if (clusters.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No clusters assigned to this supervisor'
        });
      }

      // Extract all technician IDs from clusters
      const technicianIds = new Set();
      clusters.forEach(cluster => {
        if (cluster.assigned_technicians && Array.isArray(cluster.assigned_technicians)) {
          cluster.assigned_technicians.forEach(at => {
            if (at.technician) {
              technicianIds.add(at.technician.toString());
            }
          });
        }
      });

      console.log('Found supervised technicians:', technicianIds.size);

      if (technicianIds.size === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No technicians assigned to supervised clusters'
        });
      }

      // Build query for site visits
      const query = {
        'visit_history.technician_id': { $in: Array.from(technicianIds) }
      };

      // Apply additional filters if provided
      if (technicianId) {
        query['visit_history.technician_id'] = technicianId;
      }

      if (region) {
        query.Region = region;
      }

      if (visitType) {
        query['visit_history.Type_of_Visit'] = visitType;
      }

      // Date range filter
      if (startDate || endDate) {
        query['visit_history.Actual_Date_Visit'] = {};
        if (startDate) {
          query['visit_history.Actual_Date_Visit'].$gte = new Date(startDate);
        }
        if (endDate) {
          query['visit_history.Actual_Date_Visit'].$lte = new Date(endDate);
        }
      }

      console.log('Query:', JSON.stringify(query, null, 2));

      // Find all sites with visits from supervised technicians
      const sites = await Site.find(query)
        .select('IHS_ID_SITE Site_Name Region visit_history')
        .lean();

      console.log('Sites found:', sites.length);

      // Extract and flatten all visits from supervised technicians
      let allVisits = [];
      const technicianIdsArray = Array.from(technicianIds);

      sites.forEach(site => {
        if (site.visit_history && Array.isArray(site.visit_history)) {
          site.visit_history.forEach(visit => {
            // Check if visit is from a supervised technician
            if (visit.technician_id && 
                technicianIdsArray.includes(visit.technician_id.toString())) {
              
              // Apply filters
              let includeVisit = true;

              if (technicianId && visit.technician_id.toString() !== technicianId) {
                includeVisit = false;
              }

              if (visitType && visit.Type_of_Visit !== visitType) {
                includeVisit = false;
              }

              if (startDate || endDate) {
                const visitDate = new Date(visit.Actual_Date_Visit);
                if (startDate && visitDate < new Date(startDate)) {
                  includeVisit = false;
                }
                if (endDate && visitDate > new Date(endDate)) {
                  includeVisit = false;
                }
              }

              if (includeVisit) {
                allVisits.push({
                  ...visit,
                  site_id: site.IHS_ID_SITE,
                  Site_Name: site.Site_Name,
                  IHS_ID_SITE: site.IHS_ID_SITE,
                  Region: site.Region
                });
              }
            }
          });
        }
      });

      // Sort by date (newest first)
      allVisits.sort((a, b) => 
        new Date(b.Actual_Date_Visit) - new Date(a.Actual_Date_Visit)
      );

      console.log('Total visits found:', allVisits.length);

      // Get technician names for the visits
      const uniqueTechnicianIds = [...new Set(allVisits.map(v => v.technician_id))];
      const technicians = await User.find({
        _id: { $in: uniqueTechnicianIds }
      }).select('_id fullName').lean();

      const technicianMap = {};
      technicians.forEach(tech => {
        technicianMap[tech._id.toString()] = tech.fullName;
      });

      // Enrich visits with technician names
      allVisits = allVisits.map(visit => ({
        ...visit,
        technician_name: visit.technician_name || technicianMap[visit.technician_id?.toString()] || 'Unknown'
      }));

      console.log('========== SUCCESS ==========\n');

      res.json({
        success: true,
        data: allVisits,
        count: allVisits.length,
        summary: {
          totalVisits: allVisits.length,
          supervisedTechnicians: technicianIds.size,
          uniqueSites: new Set(allVisits.map(v => v.site_id)).size,
          dateRange: {
            earliest: allVisits.length > 0 ? 
              allVisits[allVisits.length - 1].Actual_Date_Visit : null,
            latest: allVisits.length > 0 ? 
              allVisits[0].Actual_Date_Visit : null
          }
        }
      });

    } catch (error) {
      console.log('========== ERROR ==========');
      console.error('Get supervisor technician site visits error:', error);
      console.log('===========================\n');
      
      logger.error('Get supervisor technician site visits error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching technician site visits',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// In authController.js or supervisorController.js
// Replace or update your getSupervisorGenerators function

exports.getSupervisorGenerators = async (req, res) => {
  try {
    const supervisorId = req.user.userId || req.user._id;
    
    console.log('Getting generators for supervisor:', supervisorId);
    
    // Get supervisor with assigned clusters
    const supervisor = await User.findById(supervisorId)
      .select('assignedClusters')
      .lean();

    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    console.log('Supervisor assigned clusters:', supervisor.assignedClusters);

    // Get clusters and their towers
    const clusters = await Cluster.find({
      _id: { $in: supervisor.assignedClusters || [] }
    }).select('towers').lean();

    const towerIds = [...new Set(clusters.flatMap(cluster => cluster.towers || []))];
    
    console.log('Tower IDs:', towerIds);

    if (towerIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: []
      });
    }

    // CRITICAL FIX: Get generators for these towers
    // Also check for generators in Site collection via generator updates
    const Generator = require('../models/Generator');
    const GeneratorUpdate = require('../models/GeneratorUpdate');
    const Tower = require('../models/Tower');
    const Site = require('../models/Site');

    // Get towers with their site IDs
    const towers = await Tower.find({ _id: { $in: towerIds } })
      .select('_id name IHS_ID_SITE site_name')
      .lean();

    console.log('Towers found:', towers.length);

    // Collect site IDs from towers
    const siteIds = towers
      .map(t => t.IHS_ID_SITE)
      .filter(Boolean);

    console.log('Site IDs from towers:', siteIds);

    // Method 1: Get generators directly assigned to towers
    const generatorsFromTowers = await Generator.find({ 
      tower_id: { $in: towerIds } 
    }).lean();

    console.log('Generators from towers:', generatorsFromTowers.length);

    // Method 2: Get generators from approved generator updates for these sites
    const approvedUpdates = await GeneratorUpdate.find({
      site_id: { $in: siteIds },
      status: 'approved'
    })
      .sort({ reviewed_at: -1 })
      .lean();

    console.log('Approved generator updates:', approvedUpdates.length);

    // Build generator list from updates
    const generatorsFromUpdates = [];
    const processedSites = new Set();

    for (const update of approvedUpdates) {
      // Only take the latest update per site
      if (processedSites.has(update.site_id)) continue;
      processedSites.add(update.site_id);

      // Find the corresponding tower
      const tower = towers.find(t => t.IHS_ID_SITE === update.site_id);
      
      if (tower) {
        // Create a generator object from the update
        const generatorFromUpdate = {
          _id: update.existing_generator_id || update.new_generator_id || `GEN_${update.site_id}`,
          model: update.model,
          serial_number: update.serial_number,
          manufacturer: update.manufacturer,
          tower_id: tower._id,
          tower_name: tower.name,
          site_id: update.site_id,
          specifications: {
            power_rating: update.power_rating,
            fuel_capacity: update.fuel_capacity,
            fuel_type: update.fuel_type
          },
          current_stats: {
            fuel: update.fuel_level,
            power: update.power_output,
            runtime: update.runtime,
            temperature: update.temperature
          },
          status: update.generator_status,
          last_maintenance: update.reviewed_at,
          installation_date: update.installation_date,
          maintenance_interval: update.maintenance_interval,
          // Add flag to indicate this came from an update
          source: 'generator_update',
          update_id: update._id
        };

        generatorsFromUpdates.push(generatorFromUpdate);
      }
    }

    console.log('Generators from updates:', generatorsFromUpdates.length);

    // Merge both sources, preferring generators from updates (more recent data)
    const allGenerators = [];
    const generatorsByTower = new Map();

    // Add generators from updates first (most recent)
    generatorsFromUpdates.forEach(gen => {
      generatorsByTower.set(gen.tower_id.toString(), gen);
    });

    // Add generators from towers if not already present
    generatorsFromTowers.forEach(gen => {
      const towerId = gen.tower_id.toString();
      if (!generatorsByTower.has(towerId)) {
        generatorsByTower.set(towerId, {
          ...gen,
          source: 'generator_collection'
        });
      }
    });

    // Convert to array
    const finalGenerators = Array.from(generatorsByTower.values());

    console.log('Final generators count:', finalGenerators.length);

    res.status(200).json({
      success: true,
      count: finalGenerators.length,
      data: finalGenerators,
      debug: {
        supervisor_id: supervisorId,
        clusters_count: supervisor.assignedClusters?.length || 0,
        towers_count: towerIds.length,
        generators_from_towers: generatorsFromTowers.length,
        generators_from_updates: generatorsFromUpdates.length,
        final_count: finalGenerators.length
      }
    });

  } catch (error) {
    console.error('Error getting supervisor generators:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve supervisor generators',
      error: error.message
    });
  }
};


/**
 * Get supervisor's clusters
 * GET /api/supervisor/clusters
 */
exports.getSupervisorClusters = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user.id;

    logger.info(`Fetching clusters for supervisor: ${supervisorId}`);

    // Get clusters where this supervisor is assigned
    const clusters = await Cluster.find({
      supervisor: supervisorId
    })
      .populate({
        path: 'assigned_technicians.technician',
        select: 'fullName email phone specializations technicianId'
      })
      .lean();

    logger.info(`Found ${clusters.length} clusters for supervisor ${supervisorId}`);

    res.status(200).json({
      success: true,
      count: clusters.length,
      data: clusters
    });
  } catch (error) {
    logger.error('Error fetching supervisor clusters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clusters',
      error: error.message
    });
  }
};

/**
 * Get supervisor dashboard stats
 * GET /api/supervisor/dashboard
 */
exports.getSupervisorDashboard = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user.id;

    logger.info(`Fetching dashboard stats for supervisor: ${supervisorId}`);

    // Get supervisor with populated data
    const supervisor = await User.findById(supervisorId)
      .populate('supervisedClusters', 'name stats')
      .populate('supervisedTechnicians', 'fullName isActive')
      .lean();

    if (!supervisor || supervisor.role !== 'supervisor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Supervisor role required.'
      });
    }

    // Get towers count
    const towersCount = await Tower.countDocuments({
      _id: { $in: supervisor.assignedTowers || [] }
    });

    // Get generators count
    const generatorsCount = await Generator.countDocuments({
      tower_id: { $in: supervisor.assignedTowers || [] }
    });

    // Get active technicians count
    const activeTechnicians = supervisor.supervisedTechnicians?.filter(
      t => t.isActive !== false
    ).length || 0;

    // Get pending maintenance (if you have Maintenance model)
    let pendingMaintenanceCount = 0;
    try {
      pendingMaintenanceCount = await Maintenance.countDocuments({
        supervisor: supervisorId,
        status: { $in: ['pending', 'scheduled'] }
      });
    } catch (err) {
      logger.warn('Maintenance model not found or error counting:', err.message);
    }

    // Calculate cluster stats
    const clusterStats = {
      total: supervisor.supervisedClusters?.length || 0,
      totalTowers: supervisor.supervisedClusters?.reduce((sum, c) => 
        sum + (c.stats?.total_towers || 0), 0) || 0,
      activeTowers: supervisor.supervisedClusters?.reduce((sum, c) => 
        sum + (c.stats?.active_towers || 0), 0) || 0
    };

    const stats = {
      clusters: clusterStats.total,
      technicians: supervisor.supervisedTechnicians?.length || 0,
      activeTechnicians,
      towers: towersCount,
      generators: generatorsCount,
      pendingMaintenance: pendingMaintenanceCount,
      clusterStats
    };

    logger.info(`Dashboard stats for supervisor ${supervisorId}:`, stats);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching supervisor dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
};

router.get('/maintenance/pending',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  async (req, res) => {
    try {
      const filter = {
        status: 'pending'
      };

      // If supervisor, only show their pending maintenance
      if (req.user.role === 'supervisor') {
        filter.supervisor = req.user.userId;
      }

      const maintenance = await Maintenance.find(filter)
        .populate({
          path: 'technician',
          select: 'fullName email phone role isActive'
        })
        .populate({
          path: 'supervisor',
          select: 'fullName email'
        })
        .populate({
          path: 'parts_used.part_id',
          select: 'name part_number category stock'
        })
        .sort({ createdAt: -1 });

      // Enrich with tower information
      const enrichedMaintenance = await Promise.all(
        maintenance.map(async (item) => {
          const site = await Site.findOne({ IHS_ID_SITE: item.tower })
            .select('Site_Name Region IHS_ID_SITE');
          
          const maintenanceObj = item.toObject();
          maintenanceObj.tower = {
            _id: item.tower,
            name: site ? site.Site_Name : item.tower,
            IHS_ID_SITE: item.tower,
            region: site ? site.Region : null
          };
          
          return maintenanceObj;
        })
      );

      res.json({
        success: true,
        data: enrichedMaintenance,
        count: enrichedMaintenance.length
      });

    } catch (error) {
      logger.error('Get pending maintenance error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching pending maintenance',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

router.post('/maintenance/:id/approve',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  async (req, res) => {
    try {
      const { id } = req.params;

      const maintenance = await Maintenance.findById(id);
      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance not found'
        });
      }

      // Verify supervisor owns this maintenance
      if (req.user.role === 'supervisor' && 
          maintenance.supervisor.toString() !== req.user.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only approve your own scheduled maintenance'
        });
      }

      maintenance.status = 'scheduled';
      maintenance.reviewed_at = new Date();
      maintenance.reviewed_by = req.user.userId;
      await maintenance.save();

      await maintenance.populate([
        { path: 'technician', select: 'fullName email phone' },
        { path: 'supervisor', select: 'fullName email' },
        { path: 'parts_used.part_id', select: 'name part_number category' }
      ]);

      logger.info('Maintenance approved', {
        maintenanceId: id,
        approvedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Maintenance approved successfully',
        data: maintenance
      });

    } catch (error) {
      logger.error('Approve maintenance error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error approving maintenance',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

router.patch('/maintenance/:id/cancel',
  authenticateToken,
  requireRole(['supervisor', 'admin']),
  [
    body('cancellationReason').optional().isString()
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { cancellationReason } = req.body;

      const maintenance = await Maintenance.findById(id);
      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance not found'
        });
      }

      // Verify supervisor owns this maintenance
      if (req.user.role === 'supervisor' && 
          maintenance.supervisor.toString() !== req.user.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only cancel your own scheduled maintenance'
        });
      }

      // Can only cancel pending or scheduled maintenance
      if (!['pending', 'scheduled'].includes(maintenance.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel maintenance with status: ${maintenance.status}`
        });
      }

      maintenance.status = 'cancelled';
      maintenance.cancellationReason = cancellationReason || 'No reason provided';
      maintenance.cancelledAt = new Date();
      maintenance.cancelledBy = req.user.userId;
      await maintenance.save();

      // Decrease technician's task count
      await User.findByIdAndUpdate(maintenance.technician, {
        $inc: { currentTasksCount: -1 }
      });

      logger.info('Maintenance cancelled', {
        maintenanceId: id,
        cancelledBy: req.user.userId,
        reason: cancellationReason
      });

      res.json({
        success: true,
        message: 'Maintenance cancelled successfully',
        data: maintenance
      });

    } catch (error) {
      logger.error('Cancel maintenance error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error cancelling maintenance',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * Get pending maintenance for supervisor
 * GET /api/supervisor/maintenance/pending
 */
exports.getPendingMaintenance = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user.id;

    logger.info(`Fetching pending maintenance for supervisor: ${supervisorId}`);

    // Check if Maintenance model exists
    const Maintenance = require('../models/Maintenance');
    
    const maintenance = await Maintenance.find({
      supervisor: supervisorId,
      status: { $in: ['pending', 'pending_approval'] }
    })
      .populate('technician', 'fullName email phone')
      .sort({ createdAt: -1 })
      .lean();

    logger.info(`Found ${maintenance.length} pending maintenance for supervisor ${supervisorId}`);

    res.status(200).json({
      success: true,
      count: maintenance.length,
      data: maintenance
    });
  } catch (error) {
    // If Maintenance model doesn't exist, return empty array
    if (error.message.includes('Cannot find module')) {
      logger.warn('Maintenance model not found, returning empty array');
      return res.status(200).json({
        success: true,
        count: 0,
        data: []
      });
    }

    logger.error('Error fetching pending maintenance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending maintenance',
      error: error.message
    });
  }
};

/**
 * Get scheduled maintenance for supervisor
 * GET /api/supervisor/maintenance/scheduled
 */
exports.getScheduledMaintenance = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user.id;

    logger.info(`Fetching scheduled maintenance for supervisor: ${supervisorId}`);

    const Maintenance = require('../models/Maintenance');
    
    const maintenance = await Maintenance.find({
      supervisor: supervisorId,
      status: { $in: ['scheduled', 'in_progress', 'completed'] }
    })
      .populate('technician', 'fullName email phone')
      .sort({ visit_date: -1 })
      .lean();

    logger.info(`Found ${maintenance.length} scheduled maintenance for supervisor ${supervisorId}`);

    res.status(200).json({
      success: true,
      count: maintenance.length,
      data: maintenance
    });
  } catch (error) {
    if (error.message.includes('Cannot find module')) {
      logger.warn('Maintenance model not found, returning empty array');
      return res.status(200).json({
        success: true,
        count: 0,
        data: []
      });
    }

    logger.error('Error fetching scheduled maintenance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scheduled maintenance',
      error: error.message
    });
  }
};

/**
 * Schedule maintenance
 * POST /api/supervisor/maintenance/schedule
 */
exports.scheduleMaintenance = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user.id;
    
    logger.info('Scheduling maintenance:', req.body);

    const Maintenance = require('../models/Maintenance');

    const maintenanceData = {
      ...req.body,
      supervisor: supervisorId,
      createdBy: supervisorId,
      status: 'scheduled'
    };

    const maintenance = new Maintenance(maintenanceData);
    await maintenance.save();

    // Populate fields for response
    await maintenance.populate([
      { path: 'technician', select: 'fullName email phone' },
      { path: 'tower', select: 'name location' },
      { path: 'supervisor', select: 'fullName email' }
    ]);

    logger.info(`Maintenance scheduled successfully: ${maintenance._id}`);

    res.status(201).json({
      success: true,
      message: 'Maintenance scheduled successfully',
      data: maintenance
    });
  } catch (error) {
    if (error.message.includes('Cannot find module')) {
      logger.error('Maintenance model not found');
      return res.status(501).json({
        success: false,
        message: 'Maintenance feature not implemented yet'
      });
    }

    logger.error('Error scheduling maintenance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule maintenance',
      error: error.message
    });
  }
};

/**
 * Get generators by tower
 * GET /api/supervisor/towers/:towerId/generators
 */
exports.getGeneratorsByTower = async (req, res) => {
  try {
    const { towerId } = req.params;
    const supervisorId = req.user._id || req.user.id;

    // Verify supervisor has access to this tower
    const supervisor = await User.findById(supervisorId);
    if (!supervisor.assignedTowers.includes(towerId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this tower'
      });
    }

    const generators = await Generator.find({ tower_id: towerId })
      .populate('assigned_technician', 'fullName email')
      .lean();

    res.status(200).json({
      success: true,
      count: generators.length,
      data: generators
    });
  } catch (error) {
    logger.error('Error fetching generators by tower:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch generators',
      error: error.message
    });
  }
};

/**
 * Delete scheduled maintenance
 * DELETE /api/supervisor/maintenance/:id
 */
exports.deleteMaintenance = async (req, res) => {
  try {
    const { id } = req.params;
    const supervisorId = req.user._id || req.user.id;
    const userRole = req.user.role;

    const Maintenance = require('../models/Maintenance');

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

    // Decrement technician task count if applicable
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
};
