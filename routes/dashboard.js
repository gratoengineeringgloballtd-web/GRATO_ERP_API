const express = require('express');
const router = express.Router();
const Generator = require('../models/Generator');
const Tower = require('../models/Tower');
const Telemetry = require('../models/Telemetry');

// ========== DIESEL RECONCILIATION SYSTEM (added) ==========
const CycleReconciliation = require('../models/CycleReconciliation');
const CmsDailyRecord      = require('../models/CmsDailyRecord');
const DieselAlert         = require('../models/DieselAlert');
const DieselCycle         = require('../models/DieselCycle');
const SiteBudget          = require('../models/SiteBudget');
const FuelRequest         = require('../models/FuelRequest');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

const DIESEL_ROLES = ['diesel_manager', 'data_collector', 'admin', 'supervisor'];

// ========== EXISTING: Generator Fleet Dashboard Statistics ==========
// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    // Get total generators count
    const totalGenerators = await Generator.countDocuments();
    
    // Get active generators (running status)
    const activeGenerators = await Generator.countDocuments({ status: 'running' });
    
    // Get generators with active alerts
    // Assuming there's an 'alerts' field in the schema that indicates issues
    const activeAlerts = await Generator.countDocuments({
      $or: [
        { status: 'fault' },
        { 'current_stats.fuel': { $lt: 20 } }, // Low fuel alert (less than 20%)
        { alerts: { $exists: true, $ne: [] } } // Any generators with non-empty alerts array
      ]
    });
    
    // Get maintenance due count
    // Assuming maintenance due is determined by 'next_maintenance_date' being before current date
    const currentDate = new Date();
    const maintenanceDue = await Generator.countDocuments({
      $or: [
        { next_maintenance_date: { $lte: currentDate } },
        { 'current_stats.runtime_hours': { $gte: 1000 } } // Or runtime hours exceed threshold
      ]
    });
    
    // Get generator status distribution for pie chart
    const statusDistribution = await Generator.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { status: '$_id', count: 1, _id: 0 } }
    ]);
    
    // Get fuel levels overview for the fuel chart
    const fuelLevels = await Generator.aggregate([
      { 
        $project: {
          fuel_level: '$current_stats.fuel',
          name: 1,
          tower_id: 1
        }
      },
      {
        $lookup: {
          from: 'towers',
          localField: 'tower_id',
          foreignField: '_id',
          as: 'tower'
        }
      },
      {
        $project: {
          name: 1,
          fuel_level: 1,
          tower_name: { $arrayElemAt: ['$tower.name', 0] }
        }
      },
      { $sort: { fuel_level: 1 } },
      { $limit: 10 } // Get 10 generators with lowest fuel levels
    ]);
    
    // Compile all stats in one response object
    const dashboardStats = {
      total_generators: totalGenerators,
      active_generators: activeGenerators,
      active_alerts: activeAlerts,
      maintenance_due: maintenanceDue,
      status_distribution: statusDistribution,
      fuel_levels: fuelLevels
    };
    
    res.json(dashboardStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== DIESEL RECONCILIATION SYSTEM (added) ==========
// All routes below are namespaced under /kpis, /cluster-heatmap, /daily-trend,
// /low-fuel, /zero-grid, /cycles — none collide with /stats above.

// GET /api/dashboard/kpis/:cycle_key
//
// FIXED (found via a user-reported bug: "Fuel Requests" panel showed
// 0/0/0/0 despite 3 real, correctly-approved requests existing for the
// cycle). Root cause: this file is the one actually mounted at
// /api/dashboard in app.js — the exact path the frontend calls — but its
// /kpis/:cycle_key handler was an older, separately-maintained copy of
// the same route that also exists in routes/dashboardRoutes.js (mounted
// under /api/diesel-recon/dashboard, which the frontend never reaches).
// The two copies had silently diverged: this one never got the
// FuelRequest aggregation added, so `kpis.fuel_requests` was always
// undefined here, and the frontend's `kpis?.fuel_requests || {}`
// fallback silently turned every stat into 0 with no error anywhere.
// This handler now matches routes/dashboardRoutes.js exactly.
router.get('/kpis/:cycle_key', authenticateToken, requireRole(DIESEL_ROLES), asyncHandler(async (req, res) => {
  const ck = req.params.cycle_key;
  const [agg, alertSummary, cycle, budgetAgg, fuelReqAgg] = await Promise.all([
    CycleReconciliation.aggregate([
      { $match: { cycle_key: ck } },
      { $group: {
        _id: null,
        total_sites:           { $sum: 1 },
        total_budget_liters:   { $sum: '$budget_liters' },
        total_contractual:     { $sum: '$contractual_consumption' },
        total_cms_consumed:    { $sum: '$cms_consumption' },
        total_field_added:     { $sum: '$field_fuel_added' },
        total_final_rh:        { $sum: '$final_rh' },
        total_field_rh:        { $sum: '$field_rh' },
        total_tomcard:         { $sum: { $ifNull: ['$tomcard_purchased', 0] } },
        total_theft:           { $sum: '$theft_liters' },
        sites_over_ccph:       { $sum: { $cond: ['$alerts.consumption_over_ccph', 1, 0] } },
        sites_low_fuel:        { $sum: { $cond: ['$alerts.low_fuel', 1, 0] } },
        sites_zero_grid:       { $sum: { $cond: ['$alerts.zero_grid_24h', 1, 0] } },
        sites_missing_grato:   { $sum: { $cond: ['$alerts.missing_grato', 1, 0] } },
        sites_missing_cms:     { $sum: { $cond: ['$alerts.missing_cms', 1, 0] } },
        sites_theft_suspected: { $sum: { $cond: ['$alerts.theft_suspected', 1, 0] } },
        total_alerts:          { $sum: '$alert_count' },
        avg_cons_var_pct:      { $avg: { $ifNull: ['$cons_variance_pct', 0] } },
      }},
    ]),
    DieselAlert.aggregate([
      { $match: { cycle_key: ck, status: { $in: ['open', 'acknowledged'] } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    DieselCycle.findOne({ cycle_key: ck }).lean(),
    // SiteBudget: authoritative budget data (from Book11 upload)
    SiteBudget.aggregate([
      { $match: { cycle_key: ck } },
      { $group: {
        _id: '$cluster',
        sites:                    { $sum: 1 },
        budget_liters:            { $sum: '$budget_liters' },
        budget_xaf:               { $sum: '$budget_xaf' },
        liters_used:              { $sum: '$liters_used' },
        budget_liters_approved_ihs: { $sum: '$budget_liters_approved_ihs' },
      }},
    ]),
    // FuelRequest: approval chain stats — this was entirely missing before
    FuelRequest.aggregate([
      { $match: { cycle_key: ck } },
      { $group: {
        _id: null,
        total_requests:  { $sum: 1 },
        pending:         { $sum: { $cond: [{ $regexMatch: { input: '$status', regex: /^pending_/ } }, 1, 0] } },
        approved:        { $sum: { $cond: [{ $in: ['$status', ['approved','scheduled','purchase_made','partially_refueled','refueled','completed']] }, 1, 0] } },
        disbursed:       { $sum: { $cond: [{ $ne: ['$disbursed_at', null] }, 1, 0] } },
        denied:          { $sum: { $cond: [{ $eq: ['$status', 'denied'] }, 1, 0] } },
        total_liters_approved:  { $sum: { $ifNull: ['$liters_approved', '$liters_requested'] } },
        total_xaf_approved:     { $sum: { $multiply: [{ $ifNull: ['$liters_approved', '$liters_requested'] }, 828] } },
        total_xaf_disbursed:    { $sum: { $ifNull: ['$disbursement.actual_xaf', 0] } },
      }},
    ]),
  ]);

  const kpis  = agg[0] || {};
  const alertsBySeverity = {};
  for (const a of alertSummary) alertsBySeverity[a._id] = a.count;

  // SiteBudget totals (authoritative — from Book11 import)
  const sbTotals = budgetAgg.reduce((acc, c) => {
    acc.budget_liters            += c.budget_liters || 0;
    acc.budget_xaf               += c.budget_xaf    || 0;
    acc.liters_used              += c.liters_used    || 0;
    acc.budget_liters_approved_ihs += c.budget_liters_approved_ihs || 0;
    return acc;
  }, { budget_liters: 0, budget_xaf: 0, liters_used: 0, budget_liters_approved_ihs: 0 });

  const effective_budget_liters = sbTotals.budget_liters || kpis.total_budget_liters || 0;
  const fuelReq = fuelReqAgg[0] || {};

  res.json({
    success: true,
    data: {
      cycle,
      kpis: {
        ...kpis,
        total_budget_liters:        effective_budget_liters,
        total_budget_xaf:           sbTotals.budget_xaf,
        total_liters_used_requests: sbTotals.liters_used,
        budget_liters_approved_ihs: sbTotals.budget_liters_approved_ihs,
        budget_utilisation_pct: effective_budget_liters > 0
          ? ((kpis.total_cms_consumed / effective_budget_liters) * 100).toFixed(1)
          : null,
        fuel_request_committed_pct: effective_budget_liters > 0 && fuelReq.total_liters_approved
          ? ((fuelReq.total_liters_approved / effective_budget_liters) * 100).toFixed(1)
          : null,
        contractual_vs_cms_var: kpis.total_cms_consumed - kpis.total_contractual,
        fuel_requests: {
          total:              fuelReq.total_requests   || 0,
          pending:            fuelReq.pending          || 0,
          approved:           fuelReq.approved         || 0,
          disbursed:          fuelReq.disbursed        || 0,
          denied:             fuelReq.denied           || 0,
          total_liters_approved: fuelReq.total_liters_approved || 0,
          total_xaf_approved:    fuelReq.total_xaf_approved    || 0,
          total_xaf_disbursed:   fuelReq.total_xaf_disbursed   || 0,
        },
        budget_by_cluster: budgetAgg,
      },
      alerts_by_severity: alertsBySeverity,
      open_alerts_total: Object.values(alertsBySeverity).reduce((a, b) => a + b, 0),
    },
  });
}));

// GET /api/dashboard/cluster-heatmap/:cycle_key
router.get('/cluster-heatmap/:cycle_key', authenticateToken, requireRole(DIESEL_ROLES), asyncHandler(async (req, res) => {
  const clusters = await CycleReconciliation.getClusterSummary(req.params.cycle_key);
  res.json({ success: true, data: clusters });
}));

// GET /api/dashboard/daily-trend/:cycle_key
router.get('/daily-trend/:cycle_key', authenticateToken, requireRole(DIESEL_ROLES), asyncHandler(async (req, res) => {
  const cycle = await DieselCycle.findOne({ cycle_key: req.params.cycle_key }).lean();
  if (!cycle) return res.status(404).json({ success: false, message: 'Cycle not found' });

  const trend = await CmsDailyRecord.aggregate([
    { $match: { cycle_key: req.params.cycle_key } },
    { $group: {
      _id:           '$record_date',
      total_gen_rh:  { $sum: '$gen_rh' },
      total_consumed: { $sum: '$fuel_consumption_without_drop' },
      total_refuel:  { $sum: '$refuel_l' },
      total_grid_h:  { $sum: '$grid_availability_hr' },
      sites_count:   { $sum: 1 },
      zero_grid_sites: { $sum: { $cond: ['$zero_grid_flag', 1, 0] } },
    }},
    { $sort: { _id: 1 } },
    { $project: {
      date:          '$_id',
      total_gen_rh:  1, total_consumed: 1, total_refuel: 1,
      total_grid_h:  1, sites_count: 1, zero_grid_sites: 1,
    }},
  ]);

  res.json({ success: true, data: trend });
}));

// GET /api/dashboard/low-fuel — Sites with low fuel right now
router.get('/low-fuel', authenticateToken, requireRole(DIESEL_ROLES), asyncHandler(async (req, res) => {
  const { threshold_l = 500 } = req.query;
  const latest = await CmsDailyRecord.aggregate([
    { $sort: { record_date: -1 } },
    { $group: { _id: '$site_id', latest: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$latest' } },
    { $match: { fuel_level_l: { $lt: +threshold_l, $gt: 0 } } },
    { $sort: { fuel_level_l: 1 } },
    { $limit: 50 },
  ]);
  res.json({ success: true, data: latest, count: latest.length });
}));

// GET /api/dashboard/zero-grid — Sites with consecutive zero grid hours
router.get('/zero-grid', authenticateToken, requireRole(DIESEL_ROLES), asyncHandler(async (req, res) => {
  const sites = await CmsDailyRecord.getZeroGridAlerts();
  res.json({ success: true, data: sites, count: sites.length });
}));

// GET /api/dashboard/cycles — List all cycles for selector
router.get('/cycles', authenticateToken, asyncHandler(async (req, res) => {
  const cycles = await DieselCycle.find().sort({ start_date: -1 }).limit(24).lean();
  res.json({ success: true, data: cycles });
}));

module.exports = router;










// const express = require('express');
// const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
// const Cluster = require('../models/Cluster');
// const Tower = require('../models/Tower');
// const User = require('../models/User');
// const Site = require('../models/Site');
// const Generator = require('../models/Generator');
// const Maintenance = require('../models/Maintenance');

// const router = express.Router();

// /**
//  * Get supervisor's dashboard data (UPDATED VERSION)
//  * Returns all clusters, towers, technicians, and site visits under this supervisor
//  * GET /api/dashboard/supervisor
//  */
// router.get('/supervisor', authenticateToken, requireRole('supervisor'), async (req, res) => {
//   try {
//     const supervisorId = req.user.userId;

//     // Get all clusters supervised by this supervisor
//     const clusters = await Cluster.find({ supervisor: supervisorId })
//       .populate('assigned_technicians.technician', 'fullName phone email specializations')
//       .lean();

//     if (clusters.length === 0) {
//       return res.json({
//         success: true,
//         data: {
//           supervisor: await User.findById(supervisorId).select('fullName email phone'),
//           clusters: [],
//           towers: [],
//           technicians: [],
//           siteVisits: [],
//           stats: {
//             totalClusters: 0,
//             totalTowers: 0,
//             totalTechnicians: 0,
//             totalGenerators: 0,
//             activeTowers: 0,
//             pendingMaintenance: 0,
//             siteVisitsThisWeek: 0,
//             siteVisitsThisMonth: 0
//           }
//         }
//       });
//     }

//     const clusterIds = clusters.map(c => c._id);

//     // Get all towers in these clusters
//     const towers = await Tower.find({ cluster_id: { $in: clusterIds } })
//       .populate('cluster_id', 'name code')
//       .populate('primary_generator', 'status current_stats model')
//       .populate('backup_generator', 'status current_stats model')
//       .lean();

//     // Get all technicians assigned to these clusters
//     const technicianIds = new Set();
//     clusters.forEach(cluster => {
//       cluster.assigned_technicians?.forEach(at => {
//         technicianIds.add(at.technician._id.toString());
//       });
//     });

//     const technicians = await User.find({
//       _id: { $in: Array.from(technicianIds) },
//       role: 'technician'
//     }).select('fullName email phone specializations assignedClusters assignedTowers').lean();

//     // Get all generators in these towers
//     const towerIds = towers.map(t => t._id);
//     const generators = await Generator.find({ tower_id: { $in: towerIds } }).lean();

//     // Get pending maintenance
//     const pendingMaintenance = await Maintenance.countDocuments({
//       tower: { $in: towerIds },
//       status: { $in: ['pending', 'scheduled', 'in_progress'] }
//     });

//     // Get site visits from supervised technicians
//     const sites = await Site.find({
//       'visit_history.technician_id': { $in: Array.from(technicianIds) }
//     })
//     .select('IHS_ID_SITE Site_Name Region visit_history')
//     .lean();

//     // Extract and flatten site visits
//     let allVisits = [];
//     const technicianIdsArray = Array.from(technicianIds);
    
//     sites.forEach(site => {
//       if (site.visit_history && Array.isArray(site.visit_history)) {
//         site.visit_history.forEach(visit => {
//           if (visit.technician_id && 
//               technicianIdsArray.includes(visit.technician_id.toString())) {
//             allVisits.push({
//               ...visit,
//               site_id: site.IHS_ID_SITE,
//               Site_Name: site.Site_Name,
//               Region: site.Region
//             });
//           }
//         });
//       }
//     });

//     // Sort by date (newest first)
//     allVisits.sort((a, b) => 
//       new Date(b.Actual_Date_Visit) - new Date(a.Actual_Date_Visit)
//     );

//     // Calculate date-based stats
//     const now = new Date();
//     const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
//     const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

//     const siteVisitsThisWeek = allVisits.filter(v => 
//       new Date(v.Actual_Date_Visit) >= weekAgo
//     ).length;

//     const siteVisitsThisMonth = allVisits.filter(v => 
//       new Date(v.Actual_Date_Visit) >= monthAgo
//     ).length;

//     // Calculate statistics
//     const stats = {
//       totalClusters: clusters.length,
//       totalTowers: towers.length,
//       totalTechnicians: technicians.length,
//       totalGenerators: generators.length,
//       activeTowers: towers.filter(t => t.status === 'active').length,
//       pendingMaintenance: pendingMaintenance,
//       siteVisitsThisWeek: siteVisitsThisWeek,
//       siteVisitsThisMonth: siteVisitsThisMonth,
//       totalSiteVisits: allVisits.length,
//       towersByCluster: {},
//       generatorsByStatus: {},
//       visitsByRegion: {},
//       visitsByType: {}
//     };

//     // Group towers by cluster
//     clusters.forEach(cluster => {
//       stats.towersByCluster[cluster.name] = towers.filter(
//         t => t.cluster_id._id.toString() === cluster._id.toString()
//       ).length;
//     });

//     // Group generators by status
//     generators.forEach(gen => {
//       stats.generatorsByStatus[gen.status] = (stats.generatorsByStatus[gen.status] || 0) + 1;
//     });

//     // Group visits by region
//     allVisits.forEach(visit => {
//       const region = visit.Region || 'Unknown';
//       stats.visitsByRegion[region] = (stats.visitsByRegion[region] || 0) + 1;
//     });

//     // Group visits by type
//     allVisits.forEach(visit => {
//       const type = visit.Type_of_Visit || 'Unknown';
//       stats.visitsByType[type] = (stats.visitsByType[type] || 0) + 1;
//     });

//     res.json({
//       success: true,
//       data: {
//         supervisor: await User.findById(supervisorId).select('fullName email phone managementLevel'),
//         clusters: clusters,
//         towers: towers,
//         technicians: technicians,
//         siteVisits: allVisits.slice(0, 50), // Return latest 50 visits in dashboard
//         stats: stats
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching supervisor dashboard:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch supervisor dashboard',
//       details: error.message
//     });
//   }
// });


// /**
//  * Get technician's dashboard data
//  * Returns all towers and sites assigned to this technician
//  * GET /api/dashboard/technician
//  */
// router.get('/technician', authenticateToken, async (req, res) => {
//   try {
//     const technicianId = req.user.userId;

//     // Get technician details with assignments
//     const technician = await User.findById(technicianId)
//       .populate('assignedClusters', 'name code region')
//       .populate('assignedTowers')
//       .lean();

//     if (!technician) {
//       return res.status(404).json({
//         success: false,
//         error: 'Technician not found'
//       });
//     }

//     // Get all towers assigned to this technician
//     const towers = await Tower.find({ _id: { $in: technician.assignedTowers || [] } })
//       .populate('cluster_id', 'name code')
//       .populate('primary_generator', 'status current_stats model')
//       .populate('backup_generator', 'status current_stats model')
//       .populate('supervisor', 'fullName phone email')
//       .lean();

//     // Get sites (for backward compatibility)
//     const towerIds = towers.map(t => t._id);
//     const sites = await Site.find({ tower_reference: { $in: towerIds } })
//       .select('IHS_ID_SITE Site_Name GRATO_Cluster Region Technician_Name Actual_Date_Visit')
//       .lean();

//     // Get generators for these towers
//     const generators = await Generator.find({ tower_id: { $in: towerIds } }).lean();

//     // Get technician's pending and current tasks
//     const tasks = await Maintenance.find({
//       technician: technicianId,
//       status: { $in: ['pending', 'scheduled', 'in_progress'] }
//     })
//       .populate('supervisor', 'fullName email')
//       .sort({ visit_date: 1 })
//       .lean();

//     // Calculate statistics
//     const stats = {
//       totalClusters: technician.assignedClusters?.length || 0,
//       totalTowers: towers.length,
//       totalSites: sites.length,
//       totalGenerators: generators.length,
//       activeTowers: towers.filter(t => t.status === 'active').length,
//       pendingTasks: tasks.filter(t => t.status === 'pending').length,
//       inProgressTasks: tasks.filter(t => t.status === 'in_progress').length,
//       completedTasks: technician.completedTasks || 0,
//       towersByCluster: {},
//       generatorsByStatus: {}
//     };

//     // Group towers by cluster
//     (technician.assignedClusters || []).forEach(cluster => {
//       stats.towersByCluster[cluster.name] = towers.filter(
//         t => t.cluster_id?._id?.toString() === cluster._id.toString()
//       ).length;
//     });

//     // Group generators by status
//     generators.forEach(gen => {
//       stats.generatorsByStatus[gen.status] = (stats.generatorsByStatus[gen.status] || 0) + 1;
//     });

//     res.json({
//       success: true,
//       data: {
//         technician: {
//           id: technician._id,
//           fullName: technician.fullName,
//           email: technician.email,
//           phone: technician.phone,
//           specializations: technician.specializations,
//           completedTasks: technician.completedTasks
//         },
//         clusters: technician.assignedClusters || [],
//         towers: towers,
//         sites: sites,
//         generators: generators,
//         tasks: tasks,
//         stats: stats
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching technician dashboard:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch technician dashboard',
//       details: error.message
//     });
//   }
// });

// /**
//  * Get admin's full dashboard
//  * Returns all data across the system
//  * GET /api/dashboard/admin
//  */
// router.get('/admin', authenticateToken, requireRole(['admin']), async (req, res) => {
//   try {
//     // Get counts for all entities
//     const [
//       totalClusters,
//       totalTowers,
//       totalGenerators,
//       totalSupervisors,
//       totalTechnicians,
//       totalSites,
//       activeTowers,
//       pendingMaintenance
//     ] = await Promise.all([
//       Cluster.countDocuments({}),
//       Tower.countDocuments({}),
//       Generator.countDocuments({}),
//       User.countDocuments({ role: 'supervisor' }),
//       User.countDocuments({ role: { $in: ['technician', 'ac'] } }),
//       Site.countDocuments({}),
//       Tower.countDocuments({ status: 'active' }),
//       Maintenance.countDocuments({ status: { $in: ['pending', 'scheduled', 'in_progress'] } })
//     ]);

//     // Get clusters with details
//     const clusters = await Cluster.find({})
//       .populate('supervisor', 'fullName email phone')
//       .select('name code region stats supervisor')
//       .lean();

//     // Get generators by status
//     const generatorsByStatus = await Generator.aggregate([
//       { $group: { _id: '$status', count: { $sum: 1 } } }
//     ]);

//     // Get towers by cluster
//     const towersByCluster = await Tower.aggregate([
//       {
//         $lookup: {
//           from: 'clusters',
//           localField: 'cluster_id',
//           foreignField: '_id',
//           as: 'cluster'
//         }
//       },
//       { $unwind: { path: '$cluster', preserveNullAndEmptyArrays: true } },
//       {
//         $group: {
//           _id: '$cluster.name',
//           count: { $sum: 1 }
//         }
//       }
//     ]);

//     // Get recent maintenance activities
//     const recentMaintenance = await Maintenance.find({})
//       .sort({ createdAt: -1 })
//       .limit(10)
//       .populate('technician', 'fullName')
//       .populate('supervisor', 'fullName')
//       .select('visit_type status visit_date site_id technician supervisor')
//       .lean();

//     // Get supervisors with their cluster counts
//     const supervisors = await User.find({ role: 'supervisor' })
//       .select('fullName email phone supervisedClusters')
//       .lean();

//     for (let supervisor of supervisors) {
//       supervisor.clusterCount = await Cluster.countDocuments({ supervisor: supervisor._id });
//     }

//     // Get technicians with their assignment counts
//     const technicians = await User.find({ role: 'technician' })
//       .select('fullName email phone specializations assignedClusters assignedTowers')
//       .lean();

//     for (let technician of technicians) {
//       technician.clusterCount = technician.assignedClusters?.length || 0;
//       technician.towerCount = technician.assignedTowers?.length || 0;
//     }

//     res.json({
//       success: true,
//       data: {
//         overview: {
//           totalClusters,
//           totalTowers,
//           totalGenerators,
//           totalSupervisors,
//           totalTechnicians,
//           totalSites,
//           activeTowers,
//           pendingMaintenance
//         },
//         clusters: clusters,
//         supervisors: supervisors,
//         technicians: technicians,
//         charts: {
//           generatorsByStatus: generatorsByStatus.reduce((acc, item) => {
//             acc[item._id] = item.count;
//             return acc;
//           }, {}),
//           towersByCluster: towersByCluster.reduce((acc, item) => {
//             acc[item._id || 'Unassigned'] = item.count;
//             return acc;
//           }, {})
//         },
//         recentMaintenance: recentMaintenance
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching admin dashboard:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch admin dashboard',
//       details: error.message
//     });
//   }
// });

// /**
//  * Get supervisor's specific cluster details
//  * GET /api/dashboard/supervisor/cluster/:clusterId
//  */
// router.get('/supervisor/cluster/:clusterId', authenticateToken, requireRole(['supervisor']), async (req, res) => {
//   try {
//     const { clusterId } = req.params;
//     const supervisorId = req.user.userId;

//     // Verify supervisor owns this cluster
//     const cluster = await Cluster.findOne({ _id: clusterId, supervisor: supervisorId })
//       .populate('assigned_technicians.technician', 'fullName phone email specializations')
//       .lean();

//     if (!cluster) {
//       return res.status(404).json({
//         success: false,
//         error: 'Cluster not found or access denied'
//       });
//     }

//     // Get towers in this cluster
//     const towers = await Tower.find({ cluster_id: clusterId })
//       .populate('primary_generator', 'status current_stats model')
//       .populate('backup_generator', 'status current_stats model')
//       .lean();

//     // Get generators for these towers
//     const towerIds = towers.map(t => t._id);
//     const generators = await Generator.find({ tower_id: { $in: towerIds } }).lean();

//     // Get maintenance for these towers
//     const maintenance = await Maintenance.find({ tower: { $in: towerIds } })
//       .populate('technician', 'fullName')
//       .sort({ scheduledDate: -1 })
//       .limit(20)
//       .lean();

//     res.json({
//       success: true,
//       data: {
//         cluster: cluster,
//         towers: towers,
//         generators: generators,
//         maintenance: maintenance,
//         stats: {
//           totalTowers: towers.length,
//           activeTowers: towers.filter(t => t.status === 'active').length,
//           totalGenerators: generators.length,
//           operationalGenerators: generators.filter(g => g.status === 'running' || g.status === 'standby').length,
//           technicians: cluster.assigned_technicians?.length || 0
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching cluster details:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch cluster details',
//       details: error.message
//     });
//   }
// });

// /**
//  * Get technician's specific tower details
//  * GET /api/dashboard/technician/tower/:towerId
//  */
// router.get('/technician/tower/:towerId', authenticateToken, requireRole(['technician']), async (req, res) => {
//   try {
//     const { towerId } = req.params;
//     const technicianId = req.user.userId;

//     // Get technician to verify tower assignment
//     const technician = await User.findById(technicianId).select('assignedTowers').lean();
    
//     if (!technician.assignedTowers?.includes(towerId)) {
//       return res.status(403).json({
//         success: false,
//         error: 'Access denied: Tower not assigned to this technician'
//       });
//     }

//     // Get tower with full details
//     const tower = await Tower.findById(towerId)
//       .populate('cluster_id', 'name code region')
//       .populate('supervisor', 'fullName phone email')
//       .populate('primary_generator')
//       .populate('backup_generator')
//       .lean();

//     if (!tower) {
//       return res.status(404).json({
//         success: false,
//         error: 'Tower not found'
//       });
//     }

//     // Get site (for backward compatibility)
//     const site = await Site.findOne({ tower_reference: towerId }).lean();

//     // Get maintenance history for this tower
//     const maintenanceHistory = await Maintenance.find({ tower: towerId })
//       .sort({ scheduledDate: -1 })
//       .populate('technician', 'fullName')
//       .limit(10)
//       .lean();

//     // Get pending tasks for this tower
//     const pendingTasks = await Maintenance.find({
//       tower: towerId,
//       status: { $in: ['pending', 'scheduled', 'in_progress'] }
//     }).sort({ scheduledDate: 1 }).lean();

//     res.json({
//       success: true,
//       data: {
//         tower: tower,
//         site: site,
//         maintenanceHistory: maintenanceHistory,
//         pendingTasks: pendingTasks
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching tower details:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch tower details',
//       details: error.message
//     });
//   }
// });

// module.exports = router;