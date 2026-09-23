const User = require('../models/User');
const Cluster = require('../models/Cluster');
const Tower = require('../models/Tower');
const Generator = require('../models/Generator');
const Maintenance = require('../models/Maintenance');
const Site = require('../models/Site');
const multer = require('multer');
const upload = multer();

/**
 * Get all technicians (Admin/Supervisor access)
 */
exports.getAllTechnicians = async (req, res) => {
  try {
    const { 
      isActive, 
      cluster, 
      specialization,
      search,
      page = 1,
      limit = 50
    } = req.query;

    // Build query
    const query = { role: { $in: ['technician', 'ac'] } };

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (cluster) {
      query.assignedClusters = cluster;
    }

    if (specialization) {
      query.specializations = specialization;
    }

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get technicians with populated data
    const technicians = await User.find(query)
      .populate({
        path: 'assignedClusters',
        select: 'name code region supervisor',
        populate: {
          path: 'supervisor',
          select: 'fullName email phone'
        }
      })
      .populate({
        path: 'assignedTowers',
        select: 'name location status cluster_id',
        options: { limit: 100 }
      })
      .select('-password -refreshToken')
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await User.countDocuments(query);

    // Enrich with additional data
    const enrichedTechnicians = technicians.map(tech => ({
      ...tech,
      clusterCount: tech.assignedClusters?.length || 0,
      towerCount: tech.assignedTowers?.length || 0,
      currentTasksCount: tech.currentTasks?.length || 0,
      isAvailable: (tech.currentTasks?.length || 0) < 5
    }));

    res.status(200).json({
      success: true,
      count: enrichedTechnicians.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: enrichedTechnicians
    });
  } catch (error) {
    console.error('Error fetching technicians:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch technicians',
      message: error.message
    });
  }
};

/**
 * Get single technician by ID
 */
exports.getTechnicianById = async (req, res) => {
  try {
    const { id } = req.params;

    const technician = await User.findOne({ _id: id, role: { $in: ['technician', 'ac'] } })
      .populate({
        path: 'assignedClusters',
        select: 'name code region supervisor stats',
        populate: {
          path: 'supervisor',
          select: 'fullName email phone'
        }
      })
      .populate({
        path: 'assignedTowers',
        select: 'name location status specifications cluster_id',
        populate: {
          path: 'cluster_id',
          select: 'name code'
        }
      })
      .populate({
        path: 'currentTasks',
        select: 'maintenanceType scheduledDate status equipment tower',
        populate: {
          path: 'tower',
          select: 'name location'
        }
      })
      .select('-password -refreshToken')
      .lean();

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    // Calculate statistics
    const stats = {
      totalClusters: technician.assignedClusters?.length || 0,
      totalTowers: technician.assignedTowers?.length || 0,
      activeTasks: technician.currentTasks?.length || 0,
      completedTasks: technician.completedTasks || 0,
      averageTaskTime: technician.averageTaskTime || 0,
      rating: technician.rating || 0,
      towersByCluster: {}
    };

    // Group towers by cluster
    if (technician.assignedClusters && technician.assignedTowers) {
      for (const cluster of technician.assignedClusters) {
        const towersInCluster = technician.assignedTowers.filter(
          tower => tower.cluster_id?._id?.toString() === cluster._id.toString()
        );
        stats.towersByCluster[cluster.name] = towersInCluster.length;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...technician,
        stats
      }
    });
  } catch (error) {
    console.error('Error fetching technician:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch technician',
      message: error.message
    });
  }
};

/**
 * Create new technician
 */
exports.createTechnician = async (req, res) => {
  try {
    const {
      email,
      password,
      fullName,
      phone,
      specializations,
      assignedClusters,
      certifications
    } = req.body;

    // Validate required fields
    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email, password, fullName'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email or phone already exists'
      });
    }

    // Create technician
    const role = req.body.role === 'ac' ? 'ac' : 'technician';

    const technician = new User({
      email,
      password,
      fullName,
      phone,
      role,
      specializations: specializations || ['generator', 'maintenance'],
      assignedClusters: assignedClusters || [],
      certifications: certifications || [],
      isActive: false, // Needs activation
      department: 'Field Operations',
      position: 'Field Technician',
      created_by: req.user._id
    });

    await technician.save();

    // Return without password
    const technicianData = await User.findById(technician._id)
      .select('-password -refreshToken')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Technician created successfully',
      data: technicianData
    });
  } catch (error) {
    console.error('Error creating technician:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create technician',
      message: error.message
    });
  }
};

/**
 * Update technician
 */
exports.updateTechnician = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove sensitive fields
    delete updates.password;
    delete updates.role;
    delete updates.refreshToken;

    const technician = await User.findOneAndUpdate(
      { _id: id, role: { $in: ['technician', 'ac'] } },
      { 
        $set: updates,
        last_updated_by: req.user._id
      },
      { new: true, runValidators: true }
    )
      .select('-password -refreshToken')
      .lean();

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Technician updated successfully',
      data: technician
    });
  } catch (error) {
    console.error('Error updating technician:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update technician',
      message: error.message
    });
  }
};

/**
 * Activate technician
 */
exports.activateTechnician = async (req, res) => {
  try {
    const { id } = req.params;

    const technician = await User.findOneAndUpdate(
      { _id: id, role: { $in: ['technician', 'ac'] } },
      { 
        $set: { 
          isActive: true,
          last_updated_by: req.user._id
        }
      },
      { new: true }
    )
      .select('-password -refreshToken')
      .lean();

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Technician activated successfully',
      data: technician
    });
  } catch (error) {
    console.error('Error activating technician:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to activate technician',
      message: error.message
    });
  }
};

/**
 * Deactivate technician
 */
exports.deactivateTechnician = async (req, res) => {
  try {
    const { id } = req.params;

    const technician = await User.findOneAndUpdate(
      { _id: id, role: { $in: ['technician', 'ac'] } },
      { 
        $set: { 
          isActive: false,
          last_updated_by: req.user._id
        }
      },
      { new: true }
    )
      .select('-password -refreshToken')
      .lean();

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Technician deactivated successfully',
      data: technician
    });
  } catch (error) {
    console.error('Error deactivating technician:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to deactivate technician',
      message: error.message
    });
  }
};

/**
 * Delete technician
 */
exports.deleteTechnician = async (req, res) => {
  try {
    const { id } = req.params;

    const technician = await User.findOneAndDelete({
      _id: id,
      role: { $in: ['technician', 'ac'] }
    });

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    // Remove from cluster assignments
    await Cluster.updateMany(
      { 'assigned_technicians.technician': id },
      { $pull: { assigned_technicians: { technician: id } } }
    );

    res.status(200).json({
      success: true,
      message: 'Technician deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting technician:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete technician',
      message: error.message
    });
  }
};

/**
 * Assign clusters to technician
 */
exports.assignClusters = async (req, res) => {
  try {
    const { id } = req.params;
    const { clusterIds } = req.body;

    if (!Array.isArray(clusterIds)) {
      return res.status(400).json({
        success: false,
        error: 'clusterIds must be an array'
      });
    }

    // Verify all clusters exist
    const clusters = await Cluster.find({ _id: { $in: clusterIds } });
    
    if (clusters.length !== clusterIds.length) {
      return res.status(400).json({
        success: false,
        error: 'One or more clusters not found'
      });
    }

    // Update technician
    const technician = await User.findOneAndUpdate(
      { _id: id, role: { $in: ['technician', 'ac'] } },
      { $set: { assignedClusters: clusterIds } },
      { new: true }
    )
      .populate('assignedClusters', 'name code region')
      .select('-password -refreshToken')
      .lean();

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    // Update clusters to include this technician
    for (const clusterId of clusterIds) {
      await Cluster.findByIdAndUpdate(
        clusterId,
        {
          $addToSet: {
            assigned_technicians: {
              technician: id,
              assigned_date: new Date(),
              role: 'primary',
              specializations: technician.specializations || []
            }
          }
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Clusters assigned successfully',
      data: technician
    });
  } catch (error) {
    console.error('Error assigning clusters:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to assign clusters',
      message: error.message
    });
  }
};

/**
 * Assign towers to technician
 */
exports.assignTowers = async (req, res) => {
  try {
    const { id } = req.params;
    const { towerIds } = req.body;

    if (!Array.isArray(towerIds)) {
      return res.status(400).json({
        success: false,
        error: 'towerIds must be an array'
      });
    }

    // Verify all towers exist
    const towers = await Tower.find({ _id: { $in: towerIds } });
    
    if (towers.length !== towerIds.length) {
      return res.status(400).json({
        success: false,
        error: 'One or more towers not found'
      });
    }

    // Update technician
    const technician = await User.findOneAndUpdate(
      { _id: id, role: { $in: ['technician', 'ac'] } },
      { $set: { assignedTowers: towerIds } },
      { new: true }
    )
      .populate('assignedTowers', 'name location status')
      .select('-password -refreshToken')
      .lean();

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    // Update towers to include this technician
    for (const towerId of towerIds) {
      await Tower.findByIdAndUpdate(
        towerId,
        {
          $addToSet: {
            assigned_technicians: {
              technician_id: id,
              assigned_date: new Date(),
              assignment_type: 'primary'
            }
          }
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Towers assigned successfully',
      data: technician
    });
  } catch (error) {
    console.error('Error assigning towers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to assign towers',
      message: error.message
    });
  }
};

/**
 * Get technician's dashboard data
 */
exports.getTechnicianDashboard = async (req, res) => {
  try {
    const technicianId = req.user._id;

    const technician = await User.findById(technicianId)
      .select('assignedClusters assignedTowers currentTasks completedTasks')
      .lean();

    if (!technician) {
      return res.status(404).json({
        success: false,
        error: 'Technician not found'
      });
    }

    // Get maintenance statistics
    const now = new Date();
    const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
    const cycleStart  = now.getDate() >= 26
      ? new Date(now.getFullYear(), now.getMonth(), 26)
      : new Date(now.getFullYear(), now.getMonth() - 1, 26);

    const [
      pendingTasks, scheduledTasks, inProgressTasks, completedTasks,
      approvedTasks, draftTasks, totalCompleted, completedThisMonth,
      activeTasks, fuelRequestsScheduled, fuelRequestsPending,
    ] = await Promise.all([
      Maintenance.countDocuments({ technician: technicianId, status: 'pending_approval' }),
      // CURRENT scheduled: visit_date >= today (not all-time)
      Maintenance.countDocuments({ technician: technicianId, status: 'scheduled', visit_date: { $gte: todayStart } }),
      Maintenance.countDocuments({ technician: technicianId, status: 'in_progress' }),
      // Completed THIS CYCLE (26th-25th window)
      Maintenance.countDocuments({ technician: technicianId, status: { $in: ['completed','approved'] }, completed_at: { $gte: cycleStart } }),
      Maintenance.countDocuments({ technician: technicianId, status: 'approved' }),
      Maintenance.countDocuments({ technician: technicianId, status: 'draft' }),
      // ALL TIME total (for history tab)
      Maintenance.countDocuments({ technician: technicianId, status: { $in: ['completed','approved'] } }),
      Maintenance.countDocuments({ technician: technicianId, status: { $in: ['completed','approved'] }, completed_at: { $gte: monthStart } }),
      Maintenance.find({ technician: technicianId, status: { $in: ['scheduled','in_progress'] }, visit_date: { $gte: cycleStart } }).select('visit_type equipment_checks required_actions').lean(),
      require('../models/FuelRequest').countDocuments({ assigned_to: technicianId, status: { $in: ['scheduled','approved','purchase_made'] } }).catch(() => 0),
      require('../models/FuelRequest').countDocuments({ requested_by: technicianId, status: { $regex: /^pending_/ } }).catch(() => 0),
    ]);

    // Calculate action counts
    const actionCounts = {
      preventive: 0,
      refueling: 0,
      corrective: 0,
      // Keep legacy for backward compatibility if needed, but they will be 0 mostly
      generator: 0,
      fuel_refill: 0,
      cleaning: 0,
      power_cabinet: 0,
      grid: 0,
      shelter: 0,
      fuel_tank_inspection: 0
    };

    console.log('🔍 Processing', activeTasks.length, 'active tasks for action counts');
    
    activeTasks.forEach(task => {
      // New Logic: Count by visit_type (Preventive, Refueling, Corrective)
      if (task.visit_type) {
         const type = task.visit_type.toUpperCase();
         if (type.includes('PM')) actionCounts.preventive++;
         if (type.includes('RF')) actionCounts.refueling++;
         if (type.includes('END') || type.includes('CM')) actionCounts.corrective++;
      } else if (task.required_actions && Array.isArray(task.required_actions)) {
         // Fallback for legacy tasks without visit_type (if any)
         const hasPM = task.required_actions.some(a => ['generator','cleaning','grid','power_cabinet','shelter'].includes(a));
         const hasRF = task.required_actions.some(a => a.includes('fuel'));
         
         if (hasPM) actionCounts.preventive++;
         if (hasRF) actionCounts.refueling++;
      }

      // Legacy Logic (Deprecated but kept safe):
      if (task.required_actions && Array.isArray(task.required_actions)) {
        console.log('  Task:', task._id, '| Required Actions:', task.required_actions);
        const checks = task.equipment_checks || {};
        // ... (rest of legacy loop logic is effectively skipped if required_actions is empty)
        
        task.required_actions.forEach(actionRaw => {
          const action = actionRaw?.toLowerCase().trim();
          
          // Legacy counts
          const checkKey = action === 'generator' ? 'generator_checks' : `${action}_checks`;
          const checks = task.equipment_checks || {};
          // Simplified check for legacy counts just in case
          let isCompleted = false;
          // (Omitting detailed check logic since we moved to visit_type)
          
          if (!isCompleted) {
             if (action === 'generator') actionCounts.generator++;
             else if (action === 'fuel_refill') actionCounts.fuel_refill++;
             else if (action === 'cleaning') actionCounts.cleaning++;
             else if (action === 'power_cabinet') actionCounts.power_cabinet++;
             else if (action === 'grid') actionCounts.grid++;
             else if (action === 'shelter') actionCounts.shelter++;
             else if (action.includes('fuel_tank')) actionCounts.fuel_tank_inspection++;
          }
        });
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalClusters: technician.assignedClusters?.length || 0,
        totalTowers:   technician.assignedTowers?.length   || 0,
        pendingTasks,
        scheduledTasks,        // current (visit_date >= today)
        inProgressTasks,
        completedTasks,        // this cycle
        completedThisMonth,
        approvedTasks,
        draftTasks,
        totalCompleted,        // all time (for history tab)
        fuelRequestsScheduled, // approved fuel requests awaiting execution
        fuelRequestsPending,   // raised requests in approval chain
        actionCounts,
      }
    });
    
    console.log('📊 Dashboard Stats for Technician:', technicianId);
    console.log('   Action Counts:', JSON.stringify(actionCounts, null, 2));
  } catch (error) {
    console.error('Error fetching technician dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      message: error.message
    });
  }
};

/**
 * Get technician's maintenance tasks
 */
exports.getTechnicianTasks = async (req, res) => {
  try {
    const technicianId = req.user._id;
    const { status, page = 1, limit = 20 } = req.query;

    const query = { technician: technicianId };
    
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const tasks = await Maintenance.find(query)
      .populate('supervisor', 'fullName email')
      .populate('parts_used.part_id', 'name part_number')
      .sort({ visit_date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Maintenance.countDocuments(query);

    res.status(200).json({
      success: true,
      count: tasks.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: tasks
    });
  } catch (error) {
    console.error('Error fetching technician tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tasks',
      message: error.message
    });
  }
};

/**
 * Get available technicians (for assignment)
 */
exports.getAvailableTechnicians = async (req, res) => {
  try {
    const { specialization, maxTasks = 5 } = req.query;

    const query = {
      role: { $in: ['technician', 'ac'] },
      isActive: true,
      $expr: { $lt: [{ $size: { $ifNull: ['$currentTasks', []] } }, parseInt(maxTasks)] }
    };

    if (specialization) {
      query.specializations = specialization;
    }

    const technicians = await User.find(query)
      .populate('assignedClusters', 'name code')
      .select('fullName email phone specializations currentTasks assignedClusters')
      .sort({ 'currentTasks': 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: technicians.length,
      data: technicians
    });
  } catch (error) {
    console.error('Error fetching available technicians:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available technicians',
      message: error.message
    });
  }
};

/**
 * Create or save maintenance visit as draft
 */
exports.saveDraft = async (req, res) => {
  try {
    const technicianId = req.user._id;
    const visitData = req.body;

    // Generate unique maintenance ID
    const maintenanceId = `MAINT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const maintenance = new Maintenance({
      maintenance_id: maintenanceId,
      site_id: visitData.site_id,
      technician: technicianId,
      supervisor: req.user.supervisorId || technicianId, // Will need to be set properly
      visit_type: visitData.visit_type,
      visit_date: visitData.visit_date || new Date(),
      hours_on_site: visitData.hours_on_site,
      generators_checked: visitData.generators_checked || [],
      fuel_data: visitData.fuel_data,
      electrical_data: visitData.electrical_data,
      work_performed: visitData.work_performed,
      issues_found: visitData.issues_found,
      photos: visitData.photos || [],
      status: 'draft',
      is_draft: true,
      draft_saved_at: new Date(),
      priority: 'medium',
    });

    await maintenance.save();

    res.status(201).json({
      success: true,
      message: 'Draft saved successfully',
      data: maintenance,
    });
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save draft',
      message: error.message,
    });
  }
};

/**
 * Submit maintenance visit for approval
 */
exports.submitVisit = [
  upload.none(), // Parse multipart/form-data
  async (req, res) => {
    try {
      const technicianId = req.user._id;
      const visitData = req.body;

      console.log('📥 Received payload for submitVisit:', visitData);

      console.log('🔍 Technician ID:', technicianId);
      console.log('🔍 Visit Data:', visitData);

      // Normalize field names (handle camelCase from mobile app)
      const siteId = visitData.site_id || visitData.siteId;
      const visitType = visitData.visit_type || visitData.type;

      // Validate required fields
      if (!siteId || !visitType) {
        console.log('❌ Validation failed: Missing site_id or visit_type');
        return res.status(400).json({
          success: false,
          error: 'Site ID and Visit Type are required',
        });
      }

      console.log('✅ Validation passed: Required fields are present');

      if (req.user.role === 'ac') {
        const allowedChecks = ['shelter', 'cleaning'];
        const incomingChecks = Object.keys(visitData.checks || {});
        const disallowed = incomingChecks.filter(k => !allowedChecks.includes(k));
        if (disallowed.length > 0) {
          return res.status(403).json({
            success: false,
            error: 'AC technicians can only submit shelter and site cleaning checks'
          });
        }
      }

      // Get site details (try multiple field names)
      let site = await Site.findOne({ IHS_ID_SITE: siteId });
      if (!site) {
        site = await Site.findOne({ site_id: siteId });
      }
      if (!site) {
        console.log('❌ Site not found for site_id:', siteId);
        return res.status(404).json({
          success: false,
          error: 'Site not found',
        });
      }

      // Ensure normalized values are used in subsequent logic
      visitData.site_id = siteId;
      visitData.visit_type = visitType;

      console.log('✅ Site found:', site);

      // Generate unique IDs
      const maintenanceId = `MAINT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      const visitReference = `VISIT_${site.site_id}_${Date.now()}`;

      // Map mobile app keys to schema keys
      const mappedChecks = {};
      if (visitData.checks) {
         if (visitData.checks.generator) mappedChecks.generator_checks = visitData.checks.generator;
         if (visitData.checks.power_cabinet) mappedChecks.power_cabinet_checks = visitData.checks.power_cabinet;
         if (visitData.checks.grid) mappedChecks.grid_checks = visitData.checks.grid;
         if (visitData.checks.shelter) mappedChecks.shelter_checks = visitData.checks.shelter;
         if (visitData.checks.cleaning) mappedChecks.cleaning_checks = visitData.checks.cleaning;
         if (visitData.checks.fuel_tank) mappedChecks.fuel_tank_checks = visitData.checks.fuel_tank;
        if (visitData.checks.fuel_tank) {
          // Ensure all refuel fields are present
          const defaultFuelTankChecks = {
            status: false,
            status_comment: '',
            separating_filter: false,
            separating_filter_comment: '',
            water_in_tank: false,
            water_in_tank_comment: '',
            fuel_line: false,
            fuel_line_comment: '',
            is_waterproof: false,
            is_waterproof_comment: '',
            comments: '',
            check_status: 'draft',
            checked_at: null,
            checked_by: null,
            submitted_at: null,
            reviewed_at: null,
            reviewed_by: null,
            supervisor_comments: '',
            rejection_reason: '',
            fuel_level: null,
            fuel_added: null,
            fse_name: '',
            tank_length_cm: null,
            tank_height_cm: null,
            tank_width_cm: null,
            tank_observations: '',
            fuel_sensor_status: '',
            dip_stick_before_cm: null,
            dip_stick_after_cm: null,
            truck_flow_meter_before_l: null,
            truck_flow_meter_after_l: null,
            truck_plate_number: '',
            guard_name: '',
            guard_number: '',
            planifier: '',
          };
          mappedChecks.fuel_tank_checks = { ...defaultFuelTankChecks, ...visitData.checks.fuel_tank };
        }
      }

      let maintenance;
      // Check if we are updating an existing maintenance record (e.g. from draft or task)
      if (visitData.maintenanceId || visitData.maintenance_id) {
          const mId = visitData.maintenanceId || visitData.maintenance_id;
          // Try finding by internal _id or maintenance_id string
          if (mId.match(/^[0-9a-fA-F]{24}$/)) {
             maintenance = await Maintenance.findById(mId);
          } 
          if (!maintenance) {
             maintenance = await Maintenance.findOne({ maintenance_id: mId });
          }
      }

      if (maintenance) {
          console.log('🔄 Updating existing maintenance record:', maintenance._id);
          if (req.user.role === 'ac') {
            const required = Array.isArray(maintenance.required_actions)
              ? maintenance.required_actions
              : [];
            const disallowed = required.filter(action => !['shelter', 'cleaning'].includes(String(action).toLowerCase()));
            if (disallowed.length > 0) {
              return res.status(403).json({
                success: false,
                error: 'AC technicians can only submit shelter and site cleaning checks'
              });
            }
          }
          // Update fields
          maintenance.visit_date = visitData.visit_date || new Date();
          maintenance.status = 'pending_approval';
          maintenance.is_draft = false;
          maintenance.submitted_at = new Date();
          maintenance.work_performed = visitData.work_performed || maintenance.work_performed;
          maintenance.equipment_checks = { ...maintenance.equipment_checks, ...mappedChecks };
          if (visitData.photos) maintenance.photos = visitData.photos;
          
          await maintenance.save();
      } else {
          console.log('🆕 Creating new maintenance record');
          const maintenanceId = `MAINT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
          const visitReference = `VISIT_${site.site_id}_${Date.now()}`;
          
          maintenance = new Maintenance({
            maintenance_id: maintenanceId,
            site_id: visitData.site_id,
            site_name: site.Site_Name,
            visit_reference: visitReference,
            technician: technicianId,
            supervisor: req.user.supervisorId || technicianId,
            visit_type: visitData.visit_type,
            visit_date: visitData.visit_date || new Date(),
            hours_on_site: visitData.hours_on_site,
            site_metadata: {
              cluster: site.GRATO_Cluster,
              site_priority: site.Site_Priority,
              state: site.State,
              operator: site.Operator,
            },
            generators_checked: visitData.generators_checked || [],
            fuel_data: visitData.fuel_data,
            electrical_data: visitData.electrical_data,
            work_performed: visitData.work_performed,
            issues_found: visitData.issues_found,
            equipment_checks: mappedChecks,
            photos: visitData.photos || [],
            status: 'pending_approval',
            is_draft: false,
            submitted_at: new Date(),
            priority: 'medium',
          });

          await maintenance.save();

          // Update site visit history only on creation to avoid duplicates
          site.visit_history = site.visit_history || [];
          site.visit_history.push({
            visit_id: visitReference,
            visit_date: visitData.visit_date || new Date(),
            visit_type: visitData.visit_type,
            technician_id: technicianId,
            status: 'pending_approval',
          });
          site.Last_Visit = visitData.visit_date || new Date();
          await site.save();
      }

      res.status(201).json({
        success: true,
        message: 'Visit submitted for approval',
        data: maintenance,
      });
    } catch (error) {
      console.error('Error submitting visit:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to submit visit',
        message: error.message,
      });
    }
  },
];















// const User = require('../models/User');
// const Cluster = require('../models/Cluster');
// const Tower = require('../models/Tower');
// const Generator = require('../models/Generator');
// const Maintenance = require('../models/Maintenance');
// const Site = require('../models/Site');
// const multer = require('multer');
// const upload = multer();

// /**
//  * Get all technicians (Admin/Supervisor access)
//  */
// exports.getAllTechnicians = async (req, res) => {
//   try {
//     const { 
//       isActive, 
//       cluster, 
//       specialization,
//       search,
//       page = 1,
//       limit = 50
//     } = req.query;

//     // Build query
//     const query = { role: { $in: ['technician', 'ac'] } };

//     if (isActive !== undefined) {
//       query.isActive = isActive === 'true';
//     }

//     if (cluster) {
//       query.assignedClusters = cluster;
//     }

//     if (specialization) {
//       query.specializations = specialization;
//     }

//     if (search) {
//       query.$or = [
//         { fullName: { $regex: search, $options: 'i' } },
//         { email: { $regex: search, $options: 'i' } },
//         { username: { $regex: search, $options: 'i' } }
//       ];
//     }

//     // Calculate pagination
//     const skip = (page - 1) * limit;

//     // Get technicians with populated data
//     const technicians = await User.find(query)
//       .populate({
//         path: 'assignedClusters',
//         select: 'name code region supervisor',
//         populate: {
//           path: 'supervisor',
//           select: 'fullName email phone'
//         }
//       })
//       .populate({
//         path: 'assignedTowers',
//         select: 'name location status cluster_id',
//         options: { limit: 100 }
//       })
//       .select('-password -refreshToken')
//       .sort({ fullName: 1 })
//       .skip(skip)
//       .limit(parseInt(limit))
//       .lean();

//     // Get total count
//     const total = await User.countDocuments(query);

//     // Enrich with additional data
//     const enrichedTechnicians = technicians.map(tech => ({
//       ...tech,
//       clusterCount: tech.assignedClusters?.length || 0,
//       towerCount: tech.assignedTowers?.length || 0,
//       currentTasksCount: tech.currentTasks?.length || 0,
//       isAvailable: (tech.currentTasks?.length || 0) < 5
//     }));

//     res.status(200).json({
//       success: true,
//       count: enrichedTechnicians.length,
//       total,
//       page: parseInt(page),
//       pages: Math.ceil(total / limit),
//       data: enrichedTechnicians
//     });
//   } catch (error) {
//     console.error('Error fetching technicians:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch technicians',
//       message: error.message
//     });
//   }
// };

// /**
//  * Get single technician by ID
//  */
// exports.getTechnicianById = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const technician = await User.findOne({ _id: id, role: { $in: ['technician', 'ac'] } })
//       .populate({
//         path: 'assignedClusters',
//         select: 'name code region supervisor stats',
//         populate: {
//           path: 'supervisor',
//           select: 'fullName email phone'
//         }
//       })
//       .populate({
//         path: 'assignedTowers',
//         select: 'name location status specifications cluster_id',
//         populate: {
//           path: 'cluster_id',
//           select: 'name code'
//         }
//       })
//       .populate({
//         path: 'currentTasks',
//         select: 'maintenanceType scheduledDate status equipment tower',
//         populate: {
//           path: 'tower',
//           select: 'name location'
//         }
//       })
//       .select('-password -refreshToken')
//       .lean();

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     // Calculate statistics
//     const stats = {
//       totalClusters: technician.assignedClusters?.length || 0,
//       totalTowers: technician.assignedTowers?.length || 0,
//       activeTasks: technician.currentTasks?.length || 0,
//       completedTasks: technician.completedTasks || 0,
//       averageTaskTime: technician.averageTaskTime || 0,
//       rating: technician.rating || 0,
//       towersByCluster: {}
//     };

//     // Group towers by cluster
//     if (technician.assignedClusters && technician.assignedTowers) {
//       for (const cluster of technician.assignedClusters) {
//         const towersInCluster = technician.assignedTowers.filter(
//           tower => tower.cluster_id?._id?.toString() === cluster._id.toString()
//         );
//         stats.towersByCluster[cluster.name] = towersInCluster.length;
//       }
//     }

//     res.status(200).json({
//       success: true,
//       data: {
//         ...technician,
//         stats
//       }
//     });
//   } catch (error) {
//     console.error('Error fetching technician:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch technician',
//       message: error.message
//     });
//   }
// };

// /**
//  * Create new technician
//  */
// exports.createTechnician = async (req, res) => {
//   try {
//     const {
//       email,
//       password,
//       fullName,
//       phone,
//       specializations,
//       assignedClusters,
//       certifications
//     } = req.body;

//     // Validate required fields
//     if (!email || !password || !fullName) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required fields: email, password, fullName'
//       });
//     }

//     // Check if user already exists
//     const existingUser = await User.findOne({
//       $or: [{ email }, { phone }]
//     });

//     if (existingUser) {
//       return res.status(400).json({
//         success: false,
//         error: 'User with this email or phone already exists'
//       });
//     }

//     // Create technician
//     const role = req.body.role === 'ac' ? 'ac' : 'technician';

//     const technician = new User({
//       email,
//       password,
//       fullName,
//       phone,
//       role,
//       specializations: specializations || ['generator', 'maintenance'],
//       assignedClusters: assignedClusters || [],
//       certifications: certifications || [],
//       isActive: false, // Needs activation
//       department: 'Field Operations',
//       position: 'Field Technician',
//       created_by: req.user._id
//     });

//     await technician.save();

//     // Return without password
//     const technicianData = await User.findById(technician._id)
//       .select('-password -refreshToken')
//       .lean();

//     res.status(201).json({
//       success: true,
//       message: 'Technician created successfully',
//       data: technicianData
//     });
//   } catch (error) {
//     console.error('Error creating technician:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to create technician',
//       message: error.message
//     });
//   }
// };

// /**
//  * Update technician
//  */
// exports.updateTechnician = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const updates = req.body;

//     // Remove sensitive fields
//     delete updates.password;
//     delete updates.role;
//     delete updates.refreshToken;

//     const technician = await User.findOneAndUpdate(
//       { _id: id, role: { $in: ['technician', 'ac'] } },
//       { 
//         $set: updates,
//         last_updated_by: req.user._id
//       },
//       { new: true, runValidators: true }
//     )
//       .select('-password -refreshToken')
//       .lean();

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: 'Technician updated successfully',
//       data: technician
//     });
//   } catch (error) {
//     console.error('Error updating technician:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to update technician',
//       message: error.message
//     });
//   }
// };

// /**
//  * Activate technician
//  */
// exports.activateTechnician = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const technician = await User.findOneAndUpdate(
//       { _id: id, role: { $in: ['technician', 'ac'] } },
//       { 
//         $set: { 
//           isActive: true,
//           last_updated_by: req.user._id
//         }
//       },
//       { new: true }
//     )
//       .select('-password -refreshToken')
//       .lean();

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: 'Technician activated successfully',
//       data: technician
//     });
//   } catch (error) {
//     console.error('Error activating technician:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to activate technician',
//       message: error.message
//     });
//   }
// };

// /**
//  * Deactivate technician
//  */
// exports.deactivateTechnician = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const technician = await User.findOneAndUpdate(
//       { _id: id, role: { $in: ['technician', 'ac'] } },
//       { 
//         $set: { 
//           isActive: false,
//           last_updated_by: req.user._id
//         }
//       },
//       { new: true }
//     )
//       .select('-password -refreshToken')
//       .lean();

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: 'Technician deactivated successfully',
//       data: technician
//     });
//   } catch (error) {
//     console.error('Error deactivating technician:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to deactivate technician',
//       message: error.message
//     });
//   }
// };

// /**
//  * Delete technician
//  */
// exports.deleteTechnician = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const technician = await User.findOneAndDelete({
//       _id: id,
//       role: { $in: ['technician', 'ac'] }
//     });

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     // Remove from cluster assignments
//     await Cluster.updateMany(
//       { 'assigned_technicians.technician': id },
//       { $pull: { assigned_technicians: { technician: id } } }
//     );

//     res.status(200).json({
//       success: true,
//       message: 'Technician deleted successfully'
//     });
//   } catch (error) {
//     console.error('Error deleting technician:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to delete technician',
//       message: error.message
//     });
//   }
// };

// /**
//  * Assign clusters to technician
//  */
// exports.assignClusters = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { clusterIds } = req.body;

//     if (!Array.isArray(clusterIds)) {
//       return res.status(400).json({
//         success: false,
//         error: 'clusterIds must be an array'
//       });
//     }

//     // Verify all clusters exist
//     const clusters = await Cluster.find({ _id: { $in: clusterIds } });
    
//     if (clusters.length !== clusterIds.length) {
//       return res.status(400).json({
//         success: false,
//         error: 'One or more clusters not found'
//       });
//     }

//     // Update technician
//     const technician = await User.findOneAndUpdate(
//       { _id: id, role: { $in: ['technician', 'ac'] } },
//       { $set: { assignedClusters: clusterIds } },
//       { new: true }
//     )
//       .populate('assignedClusters', 'name code region')
//       .select('-password -refreshToken')
//       .lean();

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     // Update clusters to include this technician
//     for (const clusterId of clusterIds) {
//       await Cluster.findByIdAndUpdate(
//         clusterId,
//         {
//           $addToSet: {
//             assigned_technicians: {
//               technician: id,
//               assigned_date: new Date(),
//               role: 'primary',
//               specializations: technician.specializations || []
//             }
//           }
//         }
//       );
//     }

//     res.status(200).json({
//       success: true,
//       message: 'Clusters assigned successfully',
//       data: technician
//     });
//   } catch (error) {
//     console.error('Error assigning clusters:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to assign clusters',
//       message: error.message
//     });
//   }
// };

// /**
//  * Assign towers to technician
//  */
// exports.assignTowers = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { towerIds } = req.body;

//     if (!Array.isArray(towerIds)) {
//       return res.status(400).json({
//         success: false,
//         error: 'towerIds must be an array'
//       });
//     }

//     // Verify all towers exist
//     const towers = await Tower.find({ _id: { $in: towerIds } });
    
//     if (towers.length !== towerIds.length) {
//       return res.status(400).json({
//         success: false,
//         error: 'One or more towers not found'
//       });
//     }

//     // Update technician
//     const technician = await User.findOneAndUpdate(
//       { _id: id, role: { $in: ['technician', 'ac'] } },
//       { $set: { assignedTowers: towerIds } },
//       { new: true }
//     )
//       .populate('assignedTowers', 'name location status')
//       .select('-password -refreshToken')
//       .lean();

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     // Update towers to include this technician
//     for (const towerId of towerIds) {
//       await Tower.findByIdAndUpdate(
//         towerId,
//         {
//           $addToSet: {
//             assigned_technicians: {
//               technician_id: id,
//               assigned_date: new Date(),
//               assignment_type: 'primary'
//             }
//           }
//         }
//       );
//     }

//     res.status(200).json({
//       success: true,
//       message: 'Towers assigned successfully',
//       data: technician
//     });
//   } catch (error) {
//     console.error('Error assigning towers:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to assign towers',
//       message: error.message
//     });
//   }
// };

// /**
//  * Get technician's dashboard data
//  */
// exports.getTechnicianDashboard = async (req, res) => {
//   try {
//     const technicianId = req.user._id;

//     const technician = await User.findById(technicianId)
//       .select('assignedClusters assignedTowers currentTasks completedTasks')
//       .lean();

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     // Get maintenance statistics
//     const [
//       pendingTasks,
//       scheduledTasks,
//       inProgressTasks,
//       completedTasks,
//       approvedTasks,
//       draftTasks,
//       activeTasks
//     ] = await Promise.all([
//       Maintenance.countDocuments({ technician: technicianId, status: 'pending_approval' }),
//       Maintenance.countDocuments({ technician: technicianId, status: 'scheduled' }),
//       Maintenance.countDocuments({ technician: technicianId, status: 'in_progress' }),
//       Maintenance.countDocuments({ technician: technicianId, status: 'completed' }),
//       Maintenance.countDocuments({ technician: technicianId, status: 'approved' }),
//       Maintenance.countDocuments({ technician: technicianId, status: 'draft' }),
//       Maintenance.find({ technician: technicianId, status: { $in: ['scheduled', 'in_progress', 'pending'] } }).select('visit_type equipment_checks required_actions')
//     ]);

//     // Calculate action counts
//     const actionCounts = {
//       preventive: 0,
//       refueling: 0,
//       corrective: 0,
//       // Keep legacy for backward compatibility if needed, but they will be 0 mostly
//       generator: 0,
//       fuel_refill: 0,
//       cleaning: 0,
//       power_cabinet: 0,
//       grid: 0,
//       shelter: 0,
//       fuel_tank_inspection: 0
//     };

//     console.log('🔍 Processing', activeTasks.length, 'active tasks for action counts');
    
//     activeTasks.forEach(task => {
//       // New Logic: Count by visit_type (Preventive, Refueling, Corrective)
//       if (task.visit_type) {
//          const type = task.visit_type.toUpperCase();
//          if (type.includes('PM')) actionCounts.preventive++;
//          if (type.includes('RF')) actionCounts.refueling++;
//          if (type.includes('END') || type.includes('CM')) actionCounts.corrective++;
//       } else if (task.required_actions && Array.isArray(task.required_actions)) {
//          // Fallback for legacy tasks without visit_type (if any)
//          const hasPM = task.required_actions.some(a => ['generator','cleaning','grid','power_cabinet','shelter'].includes(a));
//          const hasRF = task.required_actions.some(a => a.includes('fuel'));
         
//          if (hasPM) actionCounts.preventive++;
//          if (hasRF) actionCounts.refueling++;
//       }

//       // Legacy Logic (Deprecated but kept safe):
//       if (task.required_actions && Array.isArray(task.required_actions)) {
//         console.log('  Task:', task._id, '| Required Actions:', task.required_actions);
//         const checks = task.equipment_checks || {};
//         // ... (rest of legacy loop logic is effectively skipped if required_actions is empty)
        
//         task.required_actions.forEach(actionRaw => {
//           const action = actionRaw?.toLowerCase().trim();
          
//           // Legacy counts
//           const checkKey = action === 'generator' ? 'generator_checks' : `${action}_checks`;
//           const checks = task.equipment_checks || {};
//           // Simplified check for legacy counts just in case
//           let isCompleted = false;
//           // (Omitting detailed check logic since we moved to visit_type)
          
//           if (!isCompleted) {
//              if (action === 'generator') actionCounts.generator++;
//              else if (action === 'fuel_refill') actionCounts.fuel_refill++;
//              else if (action === 'cleaning') actionCounts.cleaning++;
//              else if (action === 'power_cabinet') actionCounts.power_cabinet++;
//              else if (action === 'grid') actionCounts.grid++;
//              else if (action === 'shelter') actionCounts.shelter++;
//              else if (action.includes('fuel_tank')) actionCounts.fuel_tank_inspection++;
//           }
//         });
//       }
//     });

//     res.status(200).json({
//       success: true,
//       data: {
//         totalClusters: technician.assignedClusters?.length || 0,
//         totalTowers: technician.assignedTowers?.length || 0,
//         pendingTasks,
//         scheduledTasks,
//         inProgressTasks,
//         completedTasks,
//         approvedTasks,
//         draftTasks,
//         totalCompleted: technician.completedTasks || 0,
//         actionCounts
//       }
//     });
    
//     console.log('📊 Dashboard Stats for Technician:', technicianId);
//     console.log('   Action Counts:', JSON.stringify(actionCounts, null, 2));
//   } catch (error) {
//     console.error('Error fetching technician dashboard:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch dashboard data',
//       message: error.message
//     });
//   }
// };

// /**
//  * Get technician's maintenance tasks
//  */
// exports.getTechnicianTasks = async (req, res) => {
//   try {
//     const technicianId = req.user._id;
//     const { status, page = 1, limit = 20 } = req.query;

//     const query = { technician: technicianId };
    
//     if (status) {
//       query.status = status;
//     }

//     const skip = (page - 1) * limit;

//     const tasks = await Maintenance.find(query)
//       .populate('supervisor', 'fullName email')
//       .populate('parts_used.part_id', 'name part_number')
//       .sort({ visit_date: -1 })
//       .skip(skip)
//       .limit(parseInt(limit))
//       .lean();

//     const total = await Maintenance.countDocuments(query);

//     res.status(200).json({
//       success: true,
//       count: tasks.length,
//       total,
//       page: parseInt(page),
//       pages: Math.ceil(total / limit),
//       data: tasks
//     });
//   } catch (error) {
//     console.error('Error fetching technician tasks:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch tasks',
//       message: error.message
//     });
//   }
// };

// /**
//  * Get available technicians (for assignment)
//  */
// exports.getAvailableTechnicians = async (req, res) => {
//   try {
//     const { specialization, maxTasks = 5 } = req.query;

//     const query = {
//       role: { $in: ['technician', 'ac'] },
//       isActive: true,
//       $expr: { $lt: [{ $size: { $ifNull: ['$currentTasks', []] } }, parseInt(maxTasks)] }
//     };

//     if (specialization) {
//       query.specializations = specialization;
//     }

//     const technicians = await User.find(query)
//       .populate('assignedClusters', 'name code')
//       .select('fullName email phone specializations currentTasks assignedClusters')
//       .sort({ 'currentTasks': 1 })
//       .lean();

//     res.status(200).json({
//       success: true,
//       count: technicians.length,
//       data: technicians
//     });
//   } catch (error) {
//     console.error('Error fetching available technicians:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch available technicians',
//       message: error.message
//     });
//   }
// };

// /**
//  * Create or save maintenance visit as draft
//  */
// exports.saveDraft = async (req, res) => {
//   try {
//     const technicianId = req.user._id;
//     const visitData = req.body;

//     // Generate unique maintenance ID
//     const maintenanceId = `MAINT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

//     const maintenance = new Maintenance({
//       maintenance_id: maintenanceId,
//       site_id: visitData.site_id,
//       technician: technicianId,
//       supervisor: req.user.supervisorId || technicianId, // Will need to be set properly
//       visit_type: visitData.visit_type,
//       visit_date: visitData.visit_date || new Date(),
//       hours_on_site: visitData.hours_on_site,
//       generators_checked: visitData.generators_checked || [],
//       fuel_data: visitData.fuel_data,
//       electrical_data: visitData.electrical_data,
//       work_performed: visitData.work_performed,
//       issues_found: visitData.issues_found,
//       photos: visitData.photos || [],
//       status: 'draft',
//       is_draft: true,
//       draft_saved_at: new Date(),
//       priority: 'medium',
//     });

//     await maintenance.save();

//     res.status(201).json({
//       success: true,
//       message: 'Draft saved successfully',
//       data: maintenance,
//     });
//   } catch (error) {
//     console.error('Error saving draft:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to save draft',
//       message: error.message,
//     });
//   }
// };

// /**
//  * Submit maintenance visit for approval
//  */
// exports.submitVisit = [
//   upload.none(), // Parse multipart/form-data
//   async (req, res) => {
//     try {
//       const technicianId = req.user._id;
//       const visitData = req.body;

//       console.log('📥 Received payload for submitVisit:', visitData);

//       console.log('🔍 Technician ID:', technicianId);
//       console.log('🔍 Visit Data:', visitData);

//       // Normalize field names (handle camelCase from mobile app)
//       const siteId = visitData.site_id || visitData.siteId;
//       const visitType = visitData.visit_type || visitData.type;

//       // Validate required fields
//       if (!siteId || !visitType) {
//         console.log('❌ Validation failed: Missing site_id or visit_type');
//         return res.status(400).json({
//           success: false,
//           error: 'Site ID and Visit Type are required',
//         });
//       }

//       console.log('✅ Validation passed: Required fields are present');

//       if (req.user.role === 'ac') {
//         const allowedChecks = ['shelter', 'cleaning'];
//         const incomingChecks = Object.keys(visitData.checks || {});
//         const disallowed = incomingChecks.filter(k => !allowedChecks.includes(k));
//         if (disallowed.length > 0) {
//           return res.status(403).json({
//             success: false,
//             error: 'AC technicians can only submit shelter and site cleaning checks'
//           });
//         }
//       }

//       // Get site details (try multiple field names)
//       let site = await Site.findOne({ IHS_ID_SITE: siteId });
//       if (!site) {
//         site = await Site.findOne({ site_id: siteId });
//       }
//       if (!site) {
//         console.log('❌ Site not found for site_id:', siteId);
//         return res.status(404).json({
//           success: false,
//           error: 'Site not found',
//         });
//       }

//       // Ensure normalized values are used in subsequent logic
//       visitData.site_id = siteId;
//       visitData.visit_type = visitType;

//       console.log('✅ Site found:', site);

//       // Generate unique IDs
//       const maintenanceId = `MAINT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
//       const visitReference = `VISIT_${site.site_id}_${Date.now()}`;

//       // Map mobile app keys to schema keys
//       const mappedChecks = {};
//       if (visitData.checks) {
//          if (visitData.checks.generator) mappedChecks.generator_checks = visitData.checks.generator;
//          if (visitData.checks.power_cabinet) mappedChecks.power_cabinet_checks = visitData.checks.power_cabinet;
//          if (visitData.checks.grid) mappedChecks.grid_checks = visitData.checks.grid;
//          if (visitData.checks.shelter) mappedChecks.shelter_checks = visitData.checks.shelter;
//          if (visitData.checks.cleaning) mappedChecks.cleaning_checks = visitData.checks.cleaning;
//          if (visitData.checks.fuel_tank) mappedChecks.fuel_tank_checks = visitData.checks.fuel_tank;
//         if (visitData.checks.fuel_tank) {
//           // Ensure all refuel fields are present
//           const defaultFuelTankChecks = {
//             status: false,
//             status_comment: '',
//             separating_filter: false,
//             separating_filter_comment: '',
//             water_in_tank: false,
//             water_in_tank_comment: '',
//             fuel_line: false,
//             fuel_line_comment: '',
//             is_waterproof: false,
//             is_waterproof_comment: '',
//             comments: '',
//             check_status: 'draft',
//             checked_at: null,
//             checked_by: null,
//             submitted_at: null,
//             reviewed_at: null,
//             reviewed_by: null,
//             supervisor_comments: '',
//             rejection_reason: '',
//             fuel_level: null,
//             fuel_added: null,
//             fse_name: '',
//             tank_length_cm: null,
//             tank_height_cm: null,
//             tank_width_cm: null,
//             tank_observations: '',
//             fuel_sensor_status: '',
//             dip_stick_before_cm: null,
//             dip_stick_after_cm: null,
//             truck_flow_meter_before_l: null,
//             truck_flow_meter_after_l: null,
//             truck_plate_number: '',
//             guard_name: '',
//             guard_number: '',
//             planifier: '',
//           };
//           mappedChecks.fuel_tank_checks = { ...defaultFuelTankChecks, ...visitData.checks.fuel_tank };
//         }
//       }

//       let maintenance;
//       // Check if we are updating an existing maintenance record (e.g. from draft or task)
//       if (visitData.maintenanceId || visitData.maintenance_id) {
//           const mId = visitData.maintenanceId || visitData.maintenance_id;
//           // Try finding by internal _id or maintenance_id string
//           if (mId.match(/^[0-9a-fA-F]{24}$/)) {
//              maintenance = await Maintenance.findById(mId);
//           } 
//           if (!maintenance) {
//              maintenance = await Maintenance.findOne({ maintenance_id: mId });
//           }
//       }

//       if (maintenance) {
//           console.log('🔄 Updating existing maintenance record:', maintenance._id);
//           if (req.user.role === 'ac') {
//             const required = Array.isArray(maintenance.required_actions)
//               ? maintenance.required_actions
//               : [];
//             const disallowed = required.filter(action => !['shelter', 'cleaning'].includes(String(action).toLowerCase()));
//             if (disallowed.length > 0) {
//               return res.status(403).json({
//                 success: false,
//                 error: 'AC technicians can only submit shelter and site cleaning checks'
//               });
//             }
//           }
//           // Update fields
//           maintenance.visit_date = visitData.visit_date || new Date();
//           maintenance.status = 'pending_approval';
//           maintenance.is_draft = false;
//           maintenance.submitted_at = new Date();
//           maintenance.work_performed = visitData.work_performed || maintenance.work_performed;
//           maintenance.equipment_checks = { ...maintenance.equipment_checks, ...mappedChecks };
//           if (visitData.photos) maintenance.photos = visitData.photos;
          
//           await maintenance.save();
//       } else {
//           console.log('🆕 Creating new maintenance record');
//           const maintenanceId = `MAINT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
//           const visitReference = `VISIT_${site.site_id}_${Date.now()}`;
          
//           maintenance = new Maintenance({
//             maintenance_id: maintenanceId,
//             site_id: visitData.site_id,
//             site_name: site.Site_Name,
//             visit_reference: visitReference,
//             technician: technicianId,
//             supervisor: req.user.supervisorId || technicianId,
//             visit_type: visitData.visit_type,
//             visit_date: visitData.visit_date || new Date(),
//             hours_on_site: visitData.hours_on_site,
//             site_metadata: {
//               cluster: site.GRATO_Cluster,
//               site_priority: site.Site_Priority,
//               state: site.State,
//               operator: site.Operator,
//             },
//             generators_checked: visitData.generators_checked || [],
//             fuel_data: visitData.fuel_data,
//             electrical_data: visitData.electrical_data,
//             work_performed: visitData.work_performed,
//             issues_found: visitData.issues_found,
//             equipment_checks: mappedChecks,
//             photos: visitData.photos || [],
//             status: 'pending_approval',
//             is_draft: false,
//             submitted_at: new Date(),
//             priority: 'medium',
//           });

//           await maintenance.save();

//           // Update site visit history only on creation to avoid duplicates
//           site.visit_history = site.visit_history || [];
//           site.visit_history.push({
//             visit_id: visitReference,
//             visit_date: visitData.visit_date || new Date(),
//             visit_type: visitData.visit_type,
//             technician_id: technicianId,
//             status: 'pending_approval',
//           });
//           site.Last_Visit = visitData.visit_date || new Date();
//           await site.save();
//       }

//       res.status(201).json({
//         success: true,
//         message: 'Visit submitted for approval',
//         data: maintenance,
//       });
//     } catch (error) {
//       console.error('Error submitting visit:', error);
//       res.status(500).json({
//         success: false,
//         error: 'Failed to submit visit',
//         message: error.message,
//       });
//     }
//   },
// ];
