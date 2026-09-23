const express = require('express');
const { authenticateToken } = require('../middlewares/authMiddleware');
const {
  filterClusterAccess,
  filterTowerAccess,
  canAccessCluster,
  canAccessTower,
  getUserDashboardData
} = require('../middlewares/authMiddleware');

const Cluster = require('../models/Cluster');
const Tower = require('../models/Tower');
const Generator = require('../models/Generator');
const User = require('../models/User');
const Maintenance = require('../models/Maintenance');

const router = express.Router();

/**
 * GET /api/protected/dashboard
 * Get user's personalized dashboard data
 */
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const dashboardData = await getUserDashboardData(req.user.userId, req.user.userType);
    
    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data'
    });
  }
});

/**
 * GET /api/protected/clusters
 * Get clusters accessible to the current user
 */
router.get('/clusters', authenticateToken, filterClusterAccess, async (req, res) => {
  try {
    let query = {};
    
    // If not admin/analyst, filter by accessible clusters
    if (!req.userAccess.canAccessAllClusters) {
      query._id = { $in: req.accessibleClusters };
    }

    const clusters = await Cluster.find(query)
      .populate('supervisor', 'fullName email phone')
      .populate('assigned_technicians.technician', 'fullName specializations')
      .sort({ name: 1 });

    res.json({
      success: true,
      count: clusters.length,
      data: clusters
    });
  } catch (error) {
    console.error('Error fetching clusters:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching clusters'
    });
  }
});

/**
 * GET /api/protected/clusters/:id
 * Get single cluster details (if user has access)
 */
router.get('/clusters/:id', authenticateToken, canAccessCluster, async (req, res) => {
  try {
    const cluster = await Cluster.findById(req.params.id)
      .populate('supervisor', 'fullName email phone')
      .populate('assigned_technicians.technician', 'fullName email phone specializations');

    if (!cluster) {
      return res.status(404).json({
        success: false,
        message: 'Cluster not found'
      });
    }

    // Get towers in this cluster
    const towers = await Tower.find({ cluster_id: cluster._id })
      .select('name status location operational_stats')
      .limit(100);

    res.json({
      success: true,
      data: {
        cluster,
        towers: towers,
        towerCount: towers.length
      }
    });
  } catch (error) {
    console.error('Error fetching cluster:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cluster details'
    });
  }
});

/**
 * GET /api/protected/towers
 * Get towers accessible to the current user
 */
router.get('/towers', authenticateToken, filterTowerAccess, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, cluster } = req.query;
    
    let query = {};
    
    // Filter by accessible towers
    if (!req.userAccess.canAccessAllTowers) {
      query._id = { $in: req.accessibleTowers };
    }

    // Additional filters
    if (status) query.status = status;
    if (cluster) query.cluster_id = cluster;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [towers, total] = await Promise.all([
      Tower.find(query)
        .populate('cluster_id', 'name region')
        .populate('supervisor', 'fullName phone')
        .populate('primary_generator', 'status current_stats')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ name: 1 }),
      Tower.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: towers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching towers:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching towers'
    });
  }
});

/**
 * GET /api/protected/towers/:id
 * Get single tower details (if user has access)
 */
router.get('/towers/:id', authenticateToken, canAccessTower, async (req, res) => {
  try {
    const tower = await Tower.findById(req.params.id)
      .populate('cluster_id', 'name region')
      .populate('supervisor', 'fullName email phone')
      .populate('primary_generator')
      .populate('backup_generator')
      .populate('assigned_technicians.technician_id', 'fullName phone specializations');

    if (!tower) {
      return res.status(404).json({
        success: false,
        message: 'Tower not found'
      });
    }

    // Get recent maintenance
    const recentMaintenance = await Maintenance.find({ tower: tower._id })
      .sort({ scheduledDate: -1 })
      .limit(5)
      .populate('technician', 'fullName');

    res.json({
      success: true,
      data: {
        tower,
        recentMaintenance
      }
    });
  } catch (error) {
    console.error('Error fetching tower:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tower details'
    });
  }
});

/**
 * GET /api/protected/my-assignments
 * Get current user's assignments (clusters, towers, tasks)
 */
router.get('/my-assignments', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .populate('assignedClusters', 'name region stats')
      .populate('assignedTowers', 'name status location cluster_id')
      .populate('currentTasks');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let assignments = {
      role: user.role,
      clusters: [],
      towers: [],
      tasks: user.currentTasks || []
    };

    if (user.role === 'supervisor') {
      // Get supervised clusters
      assignments.clusters = await Cluster.find({ supervisor: user._id })
        .select('name region stats');
      
      // Get towers in supervised clusters
      const clusterIds = assignments.clusters.map(c => c._id);
      assignments.towers = await Tower.find({ cluster_id: { $in: clusterIds } })
        .select('name status location cluster_id')
        .limit(100);
    } else if (user.role === 'technician') {
      assignments.clusters = user.assignedClusters || [];
      assignments.towers = user.assignedTowers || [];
    }

    res.json({
      success: true,
      data: assignments
    });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assignments'
    });
  }
});

/**
 * GET /api/protected/stats
 * Get role-specific statistics
 */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = {};

    if (req.user.userType === 'admin' || req.user.userType === 'analyst') {
      // System-wide stats
      stats.clusters = await Cluster.countDocuments({});
      stats.towers = await Tower.countDocuments({});
      stats.activeTowers = await Tower.countDocuments({ status: 'active' });
      stats.generators = await Generator.countDocuments({});
      stats.technicians = await User.countDocuments({ role: { $in: ['technician', 'ac'] } });
      stats.supervisors = await User.countDocuments({ role: 'supervisor' });
      stats.pendingMaintenance = await Maintenance.countDocuments({ 
        status: { $in: ['pending', 'scheduled'] } 
      });
    } else if (req.user.userType === 'supervisor') {
      // Supervisor's stats
      const clusters = await Cluster.find({ supervisor: req.user.userId });
      const clusterIds = clusters.map(c => c._id);
      
      stats.myClusters = clusters.length;
      stats.myTowers = await Tower.countDocuments({ cluster_id: { $in: clusterIds } });
      stats.activeTowers = await Tower.countDocuments({ 
        cluster_id: { $in: clusterIds }, 
        status: 'active' 
      });
      stats.myTechnicians = clusters.reduce((sum, c) => 
        sum + (c.assigned_technicians?.length || 0), 0
      );
      stats.pendingMaintenance = await Maintenance.countDocuments({
        tower: { $in: await Tower.find({ cluster_id: { $in: clusterIds } }).distinct('_id') },
        status: { $in: ['pending', 'scheduled'] }
      });
    } else if (req.user.userType === 'technician') {
      // Technician's stats
      const user = await User.findById(req.user.userId);
      const towerIds = user.assignedTowers || [];
      
      stats.myTowers = towerIds.length;
      stats.myClusters = user.assignedClusters?.length || 0;
      stats.currentTasks = user.currentTasks?.length || 0;
      stats.completedTasks = user.completedTasks || 0;
      stats.pendingMaintenance = await Maintenance.countDocuments({
        technician: user._id,
        status: { $in: ['pending', 'scheduled'] }
      });
    }

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics'
    });
  }
});

/**
 * GET /api/protected/generators
 * Get generators in user's accessible towers
 */
router.get('/generators', authenticateToken, filterTowerAccess, async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    
    let query = {};
    
    // Filter by accessible towers
    if (!req.userAccess.canAccessAllTowers) {
      query.tower_id = { $in: req.accessibleTowers };
    }

    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [generators, total] = await Promise.all([
      Generator.find(query)
        .populate('tower_id', 'name location cluster_id')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ _id: 1 }),
      Generator.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: generators,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching generators:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching generators'
    });
  }
});

module.exports = router;