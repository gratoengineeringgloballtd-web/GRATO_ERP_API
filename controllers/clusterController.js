const Site = require('../models/Site');
const Cluster = require('../models/Cluster');
const User = require('../models/User');

// ─── @desc  Get all clusters from Site data with stats ────────────────────────
// ─── @route GET /api/clusters ─────────────────────────────────────────────────
exports.getAllClusters = async (req, res) => {
  try {
    const clusterAggregation = await Site.aggregate([
      { $match: { GRATO_Cluster: { $exists: true, $ne: null, $ne: '' } } },
      {
        $group: {
          _id: '$GRATO_Cluster',
          region: { $first: '$Region' },
          sites: {
            $push: {
              ihsId: '$IHS_ID',
              siteName: '$Site_Name',
              ihsIdSite: '$IHS_ID_SITE',
              priority: '$Sites_Priority',
              siteType: '$Sites_Type',
              tenantsCount: '$Tenants_Count',
            },
          },
          totalSites: { $sum: 1 },
          highPriority: { $sum: { $cond: [{ $eq: ['$Sites_Priority', 'High'] }, 1, 0] } },
          mediumPriority: { $sum: { $cond: [{ $eq: ['$Sites_Priority', 'Medium'] }, 1, 0] } },
          lowPriority: { $sum: { $cond: [{ $eq: ['$Sites_Priority', 'Low'] }, 1, 0] } },
          avgTenants: { $avg: '$Tenants_Count' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fetch matching Cluster documents for _id / supervisor / technicians
    const clusterDocs = await Cluster.find({
      name: { $in: clusterAggregation.map(c => c._id) },
    })
      .populate('supervisor', 'fullName _id email')
      .populate('assigned_technicians.technician', 'fullName _id email')
      .lean();

    const clusterDocMap = {};
    for (const doc of clusterDocs) clusterDocMap[doc.name] = doc;

    const clusters = clusterAggregation.map(clusterAgg => {
      const doc = clusterDocMap[clusterAgg._id];
      return {
        _id: doc?._id?.toString() || null,   // ← critical: expose MongoDB _id
        name: clusterAgg._id,
        description: `Cluster with ${clusterAgg.totalSites} sites`,
        region: clusterAgg.region || doc?.region || 'Unknown',
        status: doc?.status || 'active',
        supervisor: doc?.supervisor || null,
        assigned_technicians: doc?.assigned_technicians || [],
        technicians_count: doc?.assigned_technicians?.length || 0,
        sites_count: clusterAgg.totalSites,
        sites: clusterAgg.sites,
        stats: {
          total_sites: clusterAgg.totalSites,
          total_towers: clusterAgg.totalSites,
          active_towers: clusterAgg.totalSites,
          high_priority_sites: clusterAgg.highPriority,
          medium_priority_sites: clusterAgg.mediumPriority,
          low_priority_sites: clusterAgg.lowPriority,
          avg_tenants: Math.round(clusterAgg.avgTenants || 0),
        },
      };
    });

    res.json({ success: true, data: clusters });
  } catch (err) {
    console.error('Error fetching clusters:', err);
    res.status(500).json({ success: false, error: 'Server error fetching cluster data' });
  }
};

// ─── @desc  Get single cluster ────────────────────────────────────────────────
// ─── @route GET /api/clusters/:id ────────────────────────────────────────────
exports.getCluster = async (req, res) => {
  try {
    const clusterId = req.params.id;
    const sites = await Site.find({ GRATO_Cluster: clusterId }).lean();
    if (sites.length === 0) {
      return res.status(404).json({ success: false, error: 'Cluster not found or has no sites' });
    }
    const doc = await Cluster.findOne({ name: clusterId })
      .populate('supervisor', 'fullName _id email')
      .populate('assigned_technicians.technician', 'fullName _id email')
      .lean();

    res.json({
      success: true,
      data: {
        _id: doc?._id?.toString() || null,
        name: clusterId,
        region: sites[0]?.Region || 'Unknown',
        supervisor: doc?.supervisor || null,
        assigned_technicians: doc?.assigned_technicians || [],
        stats: {
          total_sites: sites.length,
          sites_by_priority: sites.reduce((acc, s) => {
            const p = s.Sites_Priority || 'Unknown';
            acc[p] = (acc[p] || 0) + 1;
            return acc;
          }, {}),
        },
        sites: sites.map(s => ({
          ihsId: s.IHS_ID,
          siteName: s.Site_Name,
          ihsIdSite: s.IHS_ID_SITE,
          priority: s.Sites_Priority,
          siteType: s.Sites_Type,
          tenantsCount: s.Tenants_Count,
          latitude: s.Latitude,
          longitude: s.Longitude,
        })),
      },
    });
  } catch (err) {
    console.error('Error fetching cluster details:', err);
    res.status(500).json({ success: false, error: 'Server error fetching cluster details' });
  }
};

// ─── @desc  Cluster statistics summary ───────────────────────────────────────
// ─── @route GET /api/clusters/stats/summary ──────────────────────────────────
exports.getClusterStats = async (req, res) => {
  try {
    const stats = await Site.aggregate([
      { $match: { GRATO_Cluster: { $exists: true, $ne: null, $ne: '' } } },
      {
        $group: {
          _id: null,
          totalClusters: { $addToSet: '$GRATO_Cluster' },
          totalSites: { $sum: 1 },
          totalTenants: { $sum: '$Tenants_Count' },
          regionsCount: { $addToSet: '$Region' },
        },
      },
      {
        $project: {
          totalClusters: { $size: '$totalClusters' },
          totalSites: 1,
          totalTenants: 1,
          regionsCount: { $size: '$regionsCount' },
        },
      },
    ]);
    res.json(stats[0] || { totalClusters: 0, totalSites: 0, totalTenants: 0, regionsCount: 0 });
  } catch (err) {
    console.error('Error fetching cluster statistics:', err);
    res.status(500).json({ success: false, error: 'Server error fetching cluster statistics' });
  }
};

// ─── @desc  Create cluster ────────────────────────────────────────────────────
// ─── @route POST /api/clusters ───────────────────────────────────────────────
exports.createCluster = async (req, res) => {
  try {
    const cluster = await Cluster.create({
      ...req.body,
      created_by: req.user?.userId || req.user?._id,
    });
    res.status(201).json({ success: true, data: cluster });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// ─── @desc  Update cluster ────────────────────────────────────────────────────
// ─── @route PUT /api/clusters/:id ────────────────────────────────────────────
exports.updateCluster = async (req, res) => {
  try {
    const cluster = await Cluster.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('supervisor', 'fullName _id email')
      .populate('assigned_technicians.technician', 'fullName _id email');
    if (!cluster) return res.status(404).json({ success: false, error: 'Cluster not found' });
    res.json({ success: true, data: cluster });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// ─── @desc  Delete cluster ────────────────────────────────────────────────────
// ─── @route DELETE /api/clusters/:id ─────────────────────────────────────────
exports.deleteCluster = async (req, res) => {
  try {
    const cluster = await Cluster.findByIdAndDelete(req.params.id);
    if (!cluster) return res.status(404).json({ success: false, error: 'Cluster not found' });
    res.json({ success: true, message: 'Cluster deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── @desc  Assign a technician to a cluster ──────────────────────────────────
// ─── @route POST /api/clusters/:id/technicians ───────────────────────────────
exports.assignTechnicianToCluster = async (req, res) => {
  try {
    const { technicianId } = req.body;
    if (!technicianId) {
      return res.status(400).json({ success: false, error: 'technicianId is required' });
    }
    const cluster = await Cluster.findById(req.params.id);
    if (!cluster) return res.status(404).json({ success: false, error: 'Cluster not found' });

    const alreadyAssigned = cluster.assigned_technicians.some(
      t => t.technician?.toString() === technicianId
    );
    if (alreadyAssigned) {
      return res.status(400).json({ success: false, error: 'Technician already assigned to this cluster' });
    }

    cluster.assigned_technicians.push({
      technician: technicianId,
      assigned_date: new Date(),
      role: 'primary',
    });
    await cluster.save();

    const updated = await Cluster.findById(cluster._id)
      .populate('supervisor', 'fullName _id email')
      .populate('assigned_technicians.technician', 'fullName _id email');

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('assignTechnicianToCluster error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── @desc  Remove a technician from a cluster ───────────────────────────────
// ─── @route DELETE /api/clusters/:id/technicians/:technicianId ───────────────
exports.removeTechnicianFromCluster = async (req, res) => {
  try {
    const { id, technicianId } = req.params;
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ success: false, error: 'Cluster not found' });

    const before = cluster.assigned_technicians.length;
    cluster.assigned_technicians = cluster.assigned_technicians.filter(
      t => t.technician?.toString() !== technicianId
    );
    if (cluster.assigned_technicians.length === before) {
      return res.status(404).json({ success: false, error: 'Technician not found in this cluster' });
    }

    await cluster.save();

    const updated = await Cluster.findById(cluster._id)
      .populate('supervisor', 'fullName _id email')
      .populate('assigned_technicians.technician', 'fullName _id email');

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('removeTechnicianFromCluster error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Stubs for route compatibility ───────────────────────────────────────────
exports.addTowerToCluster = async (req, res) => {
  res.status(501).json({ error: 'Use site management to assign sites to clusters via GRATO_Cluster field.' });
};

exports.removeTowerFromCluster = async (req, res) => {
  res.status(501).json({ error: 'Use site management to remove sites from clusters via GRATO_Cluster field.' });
};









// const Site = require('../models/Site');
// const Cluster = require('../models/Cluster');
// const Tower = require('../models/Tower');
// const User = require('../models/User');

// // // @desc    Get all clusters from Site data with stats
// // // @route   GET /api/clusters
// // exports.getAllClusters = async (req, res) => {
// //   try {
// //     // Aggregate sites by GRATO_Cluster to create cluster data
// //     const clusterAggregation = await Site.aggregate([
// //       {
// //         $match: {
// //           GRATO_Cluster: { $exists: true, $ne: null, $ne: '' }
// //         }
// //       },
// //       {
// //         // Group by GRATO_Cluster
// //         $group: {
// //           _id: '$GRATO_Cluster',
// //           region: { $first: '$Region' }, 
// //           sites: {
// //             $push: {
// //               ihsId: '$IHS_ID',
// //               siteName: '$Site_Name',
// //               ihsIdSite: '$IHS_ID_SITE',
// //               priority: '$Sites_Priority',
// //               siteType: '$Sites_Type',
// //               tenantsCount: '$Tenants_Count'
// //             }
// //           },
// //           totalSites: { $sum: 1 },
// //           // Count sites by priority
// //           highPriority: {
// //             $sum: {
// //               $cond: [
// //                 { $eq: ['$Sites_Priority', 'High'] },
// //                 1,
// //                 0
// //               ]
// //             }
// //           },
// //           mediumPriority: {
// //             $sum: {
// //               $cond: [
// //                 { $eq: ['$Sites_Priority', 'Medium'] },
// //                 1,
// //                 0
// //               ]
// //             }
// //           },
// //           lowPriority: {
// //             $sum: {
// //               $cond: [
// //                 { $eq: ['$Sites_Priority', 'Low'] },
// //                 1,
// //                 0
// //               ]
// //             }
// //           },
// //           // Average tenants count
// //           avgTenants: { $avg: '$Tenants_Count' }
// //         }
// //       },
// //       {
// //         // Sort by cluster name
// //         $sort: { _id: 1 }
// //       }
// //     ]);

// //     // Transform the aggregated data to match your frontend expectations
// //     const clustersWithStats = clusterAggregation.map(cluster => ({
// //       _id: cluster._id, // GRATO_Cluster as the cluster ID
// //       name: cluster._id, // Using cluster name as display name
// //       description: `Cluster with ${cluster.totalSites} sites`,
// //       region: cluster.region || 'Unknown',
// //       towers: cluster.sites.map(site => site.ihsIdSite), // Using IHS_ID_SITE as tower references
// //       manager: null, // No manager info in Site model
// //       status: 'active', // Default status
// //       createdAt: new Date(), // Default date
// //       updatedAt: new Date(), // Default date
// //       stats: {
// //         total_towers: cluster.totalSites,
// //         active_towers: cluster.totalSites, // Assuming all are active
// //         total_sites: cluster.totalSites,
// //         high_priority_sites: cluster.highPriority,
// //         medium_priority_sites: cluster.mediumPriority,
// //         low_priority_sites: cluster.lowPriority,
// //         avg_tenants: Math.round(cluster.avgTenants || 0)
// //       },
// //       sites: cluster.sites // Include full site details
// //     }));

// //     res.json(clustersWithStats);
// //   } catch (err) {
// //     console.error('Error fetching clusters from sites:', err);
// //     res.status(500).json({ error: 'Server error fetching cluster data' });
// //   }
// // };

// // // @desc    Get single cluster with detailed stats from Site data
// // // @route   GET /api/clusters/:id
// // exports.getCluster = async (req, res) => {
// //   try {
// //     const clusterId = req.params.id;

// //     // Find all sites belonging to this cluster
// //     const sites = await Site.find({ 
// //       GRATO_Cluster: clusterId 
// //     }).lean();

// //     if (sites.length === 0) {
// //       return res.status(404).json({ error: 'Cluster not found or has no sites' });
// //     }

// //     // Calculate detailed stats
// //     const stats = {
// //       total_sites: sites.length,
// //       active_sites: sites.length, // Assuming all are active
// //       sites_by_type: sites.reduce((acc, site) => {
// //         const type = site.Sites_Type || 'Unknown';
// //         acc[type] = (acc[type] || 0) + 1;
// //         return acc;
// //       }, {}),
// //       sites_by_priority: sites.reduce((acc, site) => {
// //         const priority = site.Sites_Priority || 'Unknown';
// //         acc[priority] = (acc[priority] || 0) + 1;
// //         return acc;
// //       }, {}),
// //       total_tenants: sites.reduce((sum, site) => sum + (site.Tenants_Count || 0), 0),
// //       avg_tenants: sites.reduce((sum, site) => sum + (site.Tenants_Count || 0), 0) / sites.length,
// //       regions: [...new Set(sites.map(site => site.Region).filter(Boolean))]
// //     };

// //     const clusterData = {
// //       _id: clusterId,
// //       name: clusterId,
// //       description: `Cluster with ${sites.length} sites`,
// //       region: sites[0]?.Region || 'Unknown',
// //       towers: sites.map(site => site.IHS_ID_SITE),
// //       manager: null,
// //       status: 'active',
// //       createdAt: new Date(),
// //       updatedAt: new Date(),
// //       stats,
// //       sites: sites.map(site => ({
// //         ihsId: site.IHS_ID,
// //         siteName: site.Site_Name,
// //         ihsIdSite: site.IHS_ID_SITE,
// //         priority: site.Sites_Priority,
// //         siteType: site.Sites_Type,
// //         tenantsCount: site.Tenants_Count,
// //         latitude: site.Latitude,
// //         longitude: site.Longitude,
// //         technician: site.Technician_Name,
// //         technicianContact: site.Technician_Contact
// //       }))
// //     };

// //     res.json(clusterData);
// //   } catch (err) {
// //     console.error('Error fetching cluster details:', err);
// //     res.status(500).json({ error: 'Server error fetching cluster details' });
// //   }
// // };

// // // @desc    Get cluster statistics summary
// // // @route   GET /api/clusters/stats/summary
// // exports.getClusterStats = async (req, res) => {
// //   try {
// //     const stats = await Site.aggregate([
// //       {
// //         $match: {
// //           GRATO_Cluster: { $exists: true, $ne: null, $ne: '' }
// //         }
// //       },
// //       {
// //         $group: {
// //           _id: null,
// //           totalClusters: { $addToSet: '$GRATO_Cluster' },
// //           totalSites: { $sum: 1 },
// //           totalTenants: { $sum: '$Tenants_Count' },
// //           regionsCount: { $addToSet: '$Region' }
// //         }
// //       },
// //       {
// //         $project: {
// //           totalClusters: { $size: '$totalClusters' },
// //           totalSites: 1,
// //           totalTenants: 1,
// //           regionsCount: { $size: '$regionsCount' }
// //         }
// //       }
// //     ]);

// //     const result = stats[0] || {
// //       totalClusters: 0,
// //       totalSites: 0,
// //       totalTenants: 0,
// //       regionsCount: 0
// //     };

// //     res.json(result);
// //   } catch (err) {
// //     console.error('Error fetching cluster statistics:', err);
// //     res.status(500).json({ error: 'Server error fetching cluster statistics' });
// //   }
// // };

// // // Note: Create, Update, Delete operations would need to be handled differently
// // // since we're now working with Site data instead of a dedicated Cluster collection
// // // These operations would involve updating the GRATO_Cluster field in Site documents

// // exports.createCluster = async (req, res) => {
// //   res.status(501).json({ 
// //     error: 'Cluster creation not supported in this mode. Clusters are derived from Site data.' 
// //   });
// // };

// // exports.updateCluster = async (req, res) => {
// //   res.status(501).json({ 
// //     error: 'Direct cluster updates not supported. Update individual sites instead.' 
// //   });
// // };

// // exports.deleteCluster = async (req, res) => {
// //   res.status(501).json({ 
// //     error: 'Direct cluster deletion not supported. Remove GRATO_Cluster from sites instead.' 
// //   });
// // };

// // exports.addTowerToCluster = async (req, res) => {
// //   res.status(501).json({ 
// //     error: 'Use site management to assign sites to clusters via GRATO_Cluster field.' 
// //   });
// // };

// // exports.removeTowerFromCluster = async (req, res) => {
// //   res.status(501).json({ 
// //     error: 'Use site management to remove sites from clusters via GRATO_Cluster field.' 
// //   });
// // };



// exports.getAllClusters = async (req, res) => {
//   try {
//     // Aggregate sites by GRATO_Cluster
//     const clusterAggregation = await Site.aggregate([
//       {
//         $match: {
//           GRATO_Cluster: { $exists: true, $ne: null, $ne: '' }
//         }
//       },
//       {
//         $group: {
//           _id: '$GRATO_Cluster',
//           region: { $first: '$Region' },
//           sites: { $push: '$$ROOT' },
//           totalSites: { $sum: 1 }
//         }
//       },
//       { $sort: { _id: 1 } }
//     ]);

//     // Fetch Cluster documents (which have _id, supervisor, technicians)
//     const clusterDocs = await Cluster.find({
//       name: { $in: clusterAggregation.map(c => c._id) }
//     })
//       .populate('supervisor', 'fullName _id email')
//       .populate('assigned_technicians.technician', 'fullName _id email');

//     // Build a map for fast lookup
//     const clusterDocMap = {};
//     for (const doc of clusterDocs) {
//       clusterDocMap[doc.name] = doc;
//     }

//     const clusters = clusterAggregation.map(clusterAgg => {
//       const clusterDoc = clusterDocMap[clusterAgg._id];
//       return {
//         // ── FIX: Always expose _id from the Cluster document ──
//         _id: clusterDoc?._id?.toString() || null,
//         name: clusterAgg._id,
//         region: clusterAgg.region || '',
//         supervisor: clusterDoc?.supervisor || null,
//         assigned_technicians: clusterDoc?.assigned_technicians || [],
//         sites_count: clusterAgg.totalSites,
//         technicians_count: clusterDoc?.assigned_technicians?.length || 0,
//         // Expose sites array for the SitesList modal
//         sites: clusterAgg.sites || [],
//       };
//     });

//     res.json({ success: true, data: clusters });
//   } catch (error) {
//     console.error('ERROR in getAllClusters:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// };

// exports.createCluster = async (req, res) => {
//   try {
//     const cluster = await Cluster.create({
//       ...req.body,
//       created_by: req.user.userId,
//     });
//     res.status(201).json({ success: true, data: cluster });
//   } catch (error) {
//     res.status(400).json({ success: false, error: error.message });
//   }
// };

// exports.updateCluster = async (req, res) => {
//   try {
//     const cluster = await Cluster.findByIdAndUpdate(req.params.id, req.body, { new: true })
//       .populate('supervisor', 'fullName _id email')
//       .populate('assigned_technicians.technician', 'fullName _id email');
//     if (!cluster) return res.status(404).json({ success: false, message: 'Cluster not found' });
//     res.json({ success: true, data: cluster });
//   } catch (error) {
//     res.status(400).json({ success: false, error: error.message });
//   }
// };

// exports.deleteCluster = async (req, res) => {
//   try {
//     const cluster = await Cluster.findByIdAndDelete(req.params.id);
//     if (!cluster) return res.status(404).json({ success: false, message: 'Cluster not found' });
//     res.json({ success: true, message: 'Cluster deleted' });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// };

// /**
//  * POST /admin/clusters/:id/technicians
//  * Assign a technician to a cluster (adds to assigned_technicians array)
//  * Does NOT make the technician the site owner.
//  */
// exports.assignTechnicianToCluster = async (req, res) => {
//   try {
//     const { technicianId } = req.body;
//     if (!technicianId) {
//       return res.status(400).json({ success: false, error: 'technicianId is required' });
//     }

//     const cluster = await Cluster.findById(req.params.id);
//     if (!cluster) return res.status(404).json({ success: false, message: 'Cluster not found' });

//     // Prevent duplicate assignments
//     const alreadyAssigned = cluster.assigned_technicians.some(
//       t => t.technician?.toString() === technicianId
//     );
//     if (alreadyAssigned) {
//       return res.status(400).json({ success: false, error: 'Technician already assigned to this cluster' });
//     }

//     cluster.assigned_technicians.push({
//       technician: technicianId,
//       assigned_date: new Date(),
//       role: 'primary',
//     });
//     await cluster.save();

//     const updated = await Cluster.findById(cluster._id)
//       .populate('supervisor', 'fullName _id email')
//       .populate('assigned_technicians.technician', 'fullName _id email');

//     res.json({ success: true, data: updated });
//   } catch (error) {
//     console.error('assignTechnicianToCluster error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// };

// /**
//  * DELETE /admin/clusters/:id/technicians/:technicianId
//  * Remove a technician from a cluster assignment.
//  * Does NOT affect site ownership.
//  */
// exports.removeTechnicianFromCluster = async (req, res) => {
//   try {
//     const { id, technicianId } = req.params;

//     const cluster = await Cluster.findById(id);
//     if (!cluster) return res.status(404).json({ success: false, message: 'Cluster not found' });

//     const before = cluster.assigned_technicians.length;
//     cluster.assigned_technicians = cluster.assigned_technicians.filter(
//       t => t.technician?.toString() !== technicianId
//     );

//     if (cluster.assigned_technicians.length === before) {
//       return res.status(404).json({ success: false, error: 'Technician not found in this cluster' });
//     }

//     await cluster.save();

//     const updated = await Cluster.findById(cluster._id)
//       .populate('supervisor', 'fullName _id email')
//       .populate('assigned_technicians.technician', 'fullName _id email');

//     res.json({ success: true, data: updated });
//   } catch (error) {
//     console.error('removeTechnicianFromCluster error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// };
