const express = require('express');
const router = express.Router();
const Site = require('../models/Site');
const Generator = require('../models/Generator'); 
const Maintenance = require('../models/Maintenance'); 
const User = require('../models/User');
const Cluster = require('../models/Cluster');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { body, validationResult } = require('express-validator');
const upload = require('../middlewares/uploadMiddleware');
const logger = require('../utils/logger');

// Get all sites with optional filtering
router.get('/', async (req, res) => {
  try {
    const { search, region, sitesType, priority, visitType, hasGenerators, needsVisit } = req.query;

    // Build filter object
    const filter = {};

    if (search) {
      filter.$or = [
        { Site_Name: { $regex: search, $options: 'i' } },
        { IHS_ID_SITE: { $regex: search, $options: 'i' } },
        { IHS_ID: { $regex: search, $options: 'i' } },
        { TENANT_ID: { $regex: search, $options: 'i' } }
      ];
    }

    if (region) {
      filter.Region = region;
    }

    if (sitesType) {
      filter.Sites_Type = sitesType;
    }

    if (priority) {
      filter.Sites_Priority = priority;
    }

    if (visitType) {
      filter.Type_of_Visit = visitType;
    }

    // Filter by generator presence
    if (hasGenerators === 'true') {
      filter.Current_Generators = { $exists: true, $ne: [] };
    } else if (hasGenerators === 'false') {
      filter.$or = [
        { Current_Generators: { $exists: false } },
        { Current_Generators: { $size: 0 } },
        { Current_Generators: null }
      ];
    }

    // Filter by sites that need visits (more than 90 days)
    if (needsVisit === 'true') {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90);
      filter.$or = [
        { Actual_Date_Visit: { $lt: cutoffDate } },
        { Actual_Date_Visit: { $exists: false } },
        { Actual_Date_Visit: null }
      ];
    }

    const sites = await Site.find(filter)
      .populate({
        path: 'Current_Generators',
        select: 'model serial_number status current_stats'
      })
      .populate({
        path: 'Parts_Used_During_Visit.part_id',
        select: 'name part_number category'
      })
      .sort({ Actual_Date_Visit: -1 });

    res.json({
      success: true,
      data: sites,
      count: sites.length
    });
  } catch (error) {
    logger.error('Error fetching sites:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching site data',
      details: error.message
    });
  }
});


// Get all site visits for technicians under this supervisor
router.get('/supervisor/:supervisorId/technician-visits',
  authenticateToken,
  requireRole('supervisor', 'admin'),
  async (req, res) => {
    console.log('\n========== GET SUPERVISOR TECHNICIAN VISITS ==========');

    try {
      const { supervisorId } = req.params;
      const { page = 1, limit = 50, start_date, end_date } = req.query;

      // Verify the supervisor is accessing their own data or is admin
      if (req.user.userId.toString() !== supervisorId && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      console.log('Finding technicians supervised by:', supervisorId);

      // Find all technicians supervised by this supervisor via different methods
      const technicianIdsSet = new Set();

      // method 1: Direct supervisor link on technician
      const directlySupervised = await User.find({
        supervisor: supervisorId,
        role: 'technician'
      }).select('_id');
      directlySupervised.forEach(t => technicianIdsSet.add(t._id.toString()));

      // method 2: assignedTechnicians on supervisor
      const supervisor = await User.findById(supervisorId).select('assignedTechnicians');
      if (supervisor && supervisor.assignedTechnicians) {
        supervisor.assignedTechnicians.forEach(tid => technicianIdsSet.add(tid.toString()));
      }

      // method 3: via supervised clusters
      const clusters = await Cluster.find({ supervisor: supervisorId }).select('assigned_technicians');
      clusters.forEach(c => {
        c.assigned_technicians?.forEach(at => {
          if (at.technician) technicianIdsSet.add(at.technician.toString());
        });
      });

      const technicianIdsArray = Array.from(technicianIdsSet);

      // Find all technicians in the set to get names
      const technicians = await User.find({
        role: 'technician',
        _id: { $in: technicianIdsArray }
      }).select('_id fullName');

      console.log(`Found ${technicians.length} technicians for supervisor ${supervisorId}`);
      if (technicians.length > 0) {
        console.log('Technicians:', technicians.map(t => `${t.fullName} (${t._id})`));
      }

      if (technicians.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: {
            current: parseInt(page),
            pageSize: parseInt(limit),
            total: 0,
            pages: 0
          }
        });
      }

      const technicianIds = technicians.map(t => t._id.toString());

      console.log('Technician IDs:', technicianIds);

      // Build query for visits from these technicians
      const query = {
        'visit_history.technician_id': { $in: technicianIds }
      };

      // Date filter
      if (start_date || end_date) {
        query['visit_history.Actual_Date_Visit'] = {};
        if (start_date) query['visit_history.Actual_Date_Visit'].$gte = new Date(start_date);
        if (end_date) query['visit_history.Actual_Date_Visit'].$lte = new Date(end_date);
      }

      // Find sites with visits from these technicians
      const sites = await Site.find(query)
        .select('IHS_ID_SITE Site_Name Region visit_history')
        .lean();

      console.log('Found sites with visits:', sites.length);

      // Extract and flatten visit history for supervised technicians only
      let allVisits = [];
      sites.forEach(site => {
        if (site.visit_history && Array.isArray(site.visit_history)) {
          site.visit_history.forEach(visit => {
            const visitTechId = visit.technician_id?.toString();
            if (visitTechId && technicianIds.includes(visitTechId)) {
              // Find technician name
              const tech = technicians.find(t => t._id.toString() === visitTechId);

              allVisits.push({
                ...visit,
                site_id: site.IHS_ID_SITE,
                Site_Name: site.Site_Name,
                IHS_ID_SITE: site.IHS_ID_SITE,
                Region: site.Region,
                technician_name: tech?.fullName || visit.technician_name || 'Unknown',
                // Add these for frontend ApprovalsPage modal
                technician: {
                  fullName: tech?.fullName || visit.technician_name || 'Unknown',
                  _id: visit.technician_id
                },
                site_details: {
                  Site_Name: site.Site_Name,
                  IHS_ID_SITE: site.IHS_ID_SITE
                },
                visit_date: visit.Actual_Date_Visit
              });
            }
          });
        }
      });

      // Sort by date (newest first)
      allVisits.sort((a, b) => new Date(b.Actual_Date_Visit) - new Date(a.Actual_Date_Visit));

      // Pagination
      const total = allVisits.length;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + parseInt(limit);
      const paginatedVisits = allVisits.slice(startIndex, endIndex);

      console.log('Total visits found:', total);
      console.log('Returning:', paginatedVisits.length);
      console.log('========== SUCCESS ==========\n');

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
      console.log('========== ERROR ==========');
      console.error('Get supervisor technician visits error:', error);
      console.log('===========================\n');

      logger.error('Get supervisor technician visits error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching technician site visits',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);


// Merge update endpoint - matches by IHS_ID_SITE
router.post('/merge-update', async (req, res) => {
  console.log('\n========== MERGE UPDATE START ==========');

  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updates provided'
      });
    }

    console.log(`Received ${updates.length} site updates to process`);

    const results = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      notFound: 0,
      fieldsPopulated: 0,
      errors: []
    };

    for (const update of updates) {
      const { IHS_ID_SITE, updates: fieldsToUpdate } = update;

      try {
        // Find existing site by IHS_ID_SITE (primary key)
        const site = await Site.findOne({ IHS_ID_SITE });

        if (!site) {
          results.notFound++;
          console.log(`❌ Site not found: ${IHS_ID_SITE}`);
          results.errors.push({
            IHS_ID_SITE,
            error: 'Site not found in database'
          });
          continue;
        }

        // Count fields that will actually be updated
        let fieldsUpdated = 0;
        const updateLog = {};

        Object.keys(fieldsToUpdate).forEach(field => {
          const currentValue = site[field];
          const newValue = fieldsToUpdate[field];

          // Only update if current field is empty and new value exists
          if (
            (currentValue === null || currentValue === undefined || currentValue === '') &&
            newValue !== null &&
            newValue !== undefined &&
            newValue !== '' &&
            field !== 'IHS_ID_SITE' &&
            field !== '_id' &&
            field !== 'key'
          ) {
            site[field] = newValue;
            fieldsUpdated++;
            updateLog[field] = { from: currentValue, to: newValue };
          }
        });

        if (fieldsUpdated > 0) {
          await site.save();
          results.successful++;
          results.fieldsPopulated += fieldsUpdated;
          console.log(`✅ Updated ${IHS_ID_SITE}: ${fieldsUpdated} fields populated`);
          console.log('   Fields:', Object.keys(updateLog).join(', '));
        } else {
          console.log(`○ ${IHS_ID_SITE}: No empty fields to update`);
        }

        results.totalProcessed++;

      } catch (error) {
        results.failed++;
        console.error(`❌ Error updating ${IHS_ID_SITE}:`, error.message);
        results.errors.push({
          IHS_ID_SITE,
          error: error.message
        });
      }
    }

    console.log('\n========== MERGE UPDATE COMPLETE ==========');
    console.log('📊 Results:');
    console.log(`   Total Processed: ${results.totalProcessed}`);
    console.log(`   ✅ Successful: ${results.successful}`);
    console.log(`   📝 Fields Populated: ${results.fieldsPopulated}`);
    console.log(`   ❌ Failed: ${results.failed}`);
    console.log(`   ⚠️  Not Found: ${results.notFound}`);
    console.log('===========================================\n');

    res.json({
      success: true,
      message: `Merge complete: ${results.successful} sites updated, ${results.fieldsPopulated} fields populated`,
      results
    });

  } catch (error) {
    console.error('Merge update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during merge update',
      error: error.message
    });
  }
});


// Temporary debug endpoint
router.post('/debug-merge', async (req, res) => {
  try {
    const excelSample = req.body[0]; // First row from Excel
    const dbSample = await Site.findOne({}).lean();

    console.log('\n========== DEBUG COMPARISON ==========');
    console.log('Excel Keys:', Object.keys(excelSample));
    console.log('DB Keys:', Object.keys(dbSample));
    console.log('\nExcel Sample:', excelSample);
    console.log('\nDB Sample:', dbSample);
    console.log('======================================\n');

    res.json({
      excel: {
        keys: Object.keys(excelSample),
        sample: excelSample
      },
      database: {
        keys: Object.keys(dbSample),
        sample: dbSample
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Get technician's site visit history
router.get('/technician/:technicianId/visits',
  authenticateToken,
  async (req, res) => {
    console.log('\n========== GET TECHNICIAN SITE VISITS ==========');

    try {
      const { technicianId } = req.params;
      const { page = 1, limit = 20, start_date, end_date } = req.query;

      // Verify user can access this data
      if (req.user.userId.toString() !== technicianId &&
        !['admin', 'supervisor'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'You can only view your own site visits'
        });
      }

      // Find technician
      const technician = await User.findById(technicianId);
      if (!technician) {
        return res.status(404).json({
          success: false,
          message: 'Technician not found'
        });
      }

      console.log('Finding visits for:', technician.fullName);

      // Build query
      const query = {
        'visit_history.technician_id': technicianId
      };

      // Date filter
      if (start_date || end_date) {
        query['visit_history.Actual_Date_Visit'] = {};
        if (start_date) query['visit_history.Actual_Date_Visit'].$gte = new Date(start_date);
        if (end_date) query['visit_history.Actual_Date_Visit'].$lte = new Date(end_date);
      }

      // Find sites with visits from this technician
      const sites = await Site.find(query)
        .select('IHS_ID_SITE Site_Name Region visit_history')
        .lean();

      console.log('Found sites with visits:', sites.length);

      // Extract and flatten visit history
      let allVisits = [];
      sites.forEach(site => {
        if (site.visit_history && Array.isArray(site.visit_history)) {
          site.visit_history.forEach(visit => {
            if (visit.technician_id && visit.technician_id.toString() === technicianId) {
              allVisits.push({
                ...visit,
                site_id: site.IHS_ID_SITE,
                Site_Name: site.Site_Name,
                IHS_ID_SITE: site.IHS_ID_SITE,
                Region: site.Region
              });
            }
          });
        }
      });

      // Sort by date (newest first)
      allVisits.sort((a, b) => new Date(b.Actual_Date_Visit) - new Date(a.Actual_Date_Visit));

      // Pagination
      const total = allVisits.length;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + parseInt(limit);
      const paginatedVisits = allVisits.slice(startIndex, endIndex);

      console.log('Total visits:', total);
      console.log('Returning:', paginatedVisits.length);
      console.log('========== SUCCESS ==========\n');

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
      console.log('========== ERROR ==========');
      console.error('Get technician site visits error:', error);
      console.log('===========================\n');

      logger.error('Get technician site visits error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching site visit history',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Get specific site visit details
router.get('/:siteId/visits/:visitId',
  authenticateToken,
  async (req, res) => {
    console.log('\n========== GET SITE VISIT DETAILS ==========');

    try {
      const { siteId, visitId } = req.params;

      console.log('Site ID:', siteId);
      console.log('Visit ID:', visitId);

      // Find the site
      const site = await Site.findOne({ IHS_ID_SITE: siteId })
        .select('IHS_ID_SITE Site_Name Region visit_history')
        .lean();

      if (!site) {
        return res.status(404).json({
          success: false,
          message: 'Site not found'
        });
      }

      // Find the specific visit
      const visit = site.visit_history?.find(v => v.visit_id === visitId);

      if (!visit) {
        return res.status(404).json({
          success: false,
          message: 'Visit not found'
        });
      }

      // Check access permissions
      if (req.user.userId.toString() !== visit.technician_id?.toString() &&
        !['admin', 'supervisor'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this visit'
        });
      }

      // Enrich with site information
      const enrichedVisit = {
        ...visit,
        site_id: site.IHS_ID_SITE,
        Site_Name: site.Site_Name,
        IHS_ID_SITE: site.IHS_ID_SITE,
        Region: site.Region
      };

      console.log('Visit found:', visitId);
      console.log('========== SUCCESS ==========\n');

      res.json({
        success: true,
        data: enrichedVisit
      });

    } catch (error) {
      console.log('========== ERROR ==========');
      console.error('Get site visit details error:', error);
      console.log('===========================\n');

      logger.error('Get site visit details error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching visit details',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Get site visit statistics for technician
router.get('/technician/:technicianId/visit-stats',
  authenticateToken,
  async (req, res) => {
    console.log('\n========== GET TECHNICIAN VISIT STATS ==========');

    try {
      const { technicianId } = req.params;
      const { period = '30' } = req.query; // days

      // Verify access
      if (req.user.userId.toString() !== technicianId &&
        !['admin', 'supervisor'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(period));

      // Find all visits by this technician
      const sites = await Site.find({
        'visit_history.technician_id': technicianId
      }).select('visit_history').lean();

      // Aggregate statistics
      let totalVisits = 0;
      let totalPartsUsed = 0;
      let visitsWithIssues = 0;
      let visitTypes = {};
      const sitesVisited = new Set();

      sites.forEach(site => {
        site.visit_history?.forEach(visit => {
          if (visit.technician_id?.toString() === technicianId) {
            const visitDate = new Date(visit.Actual_Date_Visit);

            if (visitDate >= startDate) {
              totalVisits++;
              sitesVisited.add(site._id.toString());

              // Count parts
              if (visit.Parts_Used_During_Visit) {
                totalPartsUsed += visit.Parts_Used_During_Visit.length;
              }

              // Check for issues
              if (visit.Issues_Found && Object.values(visit.Issues_Found).some(v => v)) {
                visitsWithIssues++;
              }

              // Count visit types
              const type = visit.Type_of_Visit || 'Unknown';
              visitTypes[type] = (visitTypes[type] || 0) + 1;
            }
          }
        });
      });

      const stats = {
        period: `Last ${period} days`,
        totalVisits,
        sitesVisited: sitesVisited.size,
        avgPartsPerVisit: totalVisits > 0 ? (totalPartsUsed / totalVisits).toFixed(1) : 0,
        visitsWithIssues,
        issueRate: totalVisits > 0 ? ((visitsWithIssues / totalVisits) * 100).toFixed(1) : 0,
        visitsByType: visitTypes
      };

      console.log('Stats calculated:', stats);
      console.log('========== SUCCESS ==========\n');

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      console.log('========== ERROR ==========');
      console.error('Get visit stats error:', error);
      console.log('===========================\n');

      logger.error('Get visit stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error fetching visit statistics'
      });
    }
  }
);

// Get site statistics
router.get('/stats', async (req, res) => {
  try {
    const [
      totalSites,
      regions,
      sitesTypes,
      priorities,
      visitTypes,
      avgTenants,
      recentVisits,
      overdueVisits,
      generatorStats,
      visitStats
    ] = await Promise.all([
      Site.countDocuments({}),
      Site.distinct('Region'),
      Site.distinct('Sites_Type'),
      Site.distinct('Sites_Priority'),
      Site.distinct('Type_of_Visit'),
      Site.aggregate([
        {
          $group: {
            _id: null,
            avgTenants: { $avg: '$Tenants_Count' }
          }
        }
      ]),
      Site.countDocuments({
        Actual_Date_Visit: {
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      }),
      Site.countDocuments({
        $or: [
          {
            Actual_Date_Visit: {
              $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
            }
          },
          { Actual_Date_Visit: { $exists: false } },
          { Actual_Date_Visit: null }
        ]
      }),
      // Generator statistics
      Site.aggregate([
        {
          $group: {
            _id: null,
            totalSites: { $sum: 1 },
            sitesWithGenerators: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$Current_Generators', null] },
                      { $ne: ['$Current_Generators', []] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            sitesWithoutGenerators: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$Current_Generators', null] },
                      { $eq: ['$Current_Generators', []] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            sitesWithOneGenerator: {
              $sum: {
                $cond: [
                  { $eq: [{ $size: { $ifNull: ['$Current_Generators', []] } }, 1] },
                  1,
                  0
                ]
              }
            },
            sitesWithTwoGenerators: {
              $sum: {
                $cond: [
                  { $eq: [{ $size: { $ifNull: ['$Current_Generators', []] } }, 2] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]),
      // Visit statistics
      Site.aggregate([
        {
          $group: {
            _id: null,
            totalVisits: { $sum: { $ifNull: ['$Visit_Stats.total_visits', 0] } },
            avgVisitsPerSite: { $avg: { $ifNull: ['$Visit_Stats.total_visits', 0] } },
            totalPartsUsed: { $sum: { $ifNull: ['$Visit_Stats.total_parts_replaced', 0] } },
            sitesWithIssues: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $ne: ['$Issues_Found.DG_Issues', null] },
                      { $ne: ['$Issues_Found.IPT_BB_Issues', null] },
                      { $ne: ['$Issues_Found.Issue_of_Aircon', null] },
                      { $ne: ['$Issues_Found.Issue_of_Solar', null] },
                      { $ne: ['$Issues_Found.Any_Other_Issue', null] }
                    ]
                  },
                  1,
                  0
                ]
              }
            }
          }
        }
      ])
    ]);

    // Get counts for each region
    const regionStats = await Site.aggregate([
      { $group: { _id: '$Region', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Get counts for each visit type
    const visitTypeStats = await Site.aggregate([
      { $match: { Type_of_Visit: { $ne: null } } },
      { $group: { _id: '$Type_of_Visit', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Get anomalies statistics
    const anomaliesStats = await Site.aggregate([
      {
        $group: {
          _id: null,
          eneoProblems: {
            $sum: { $cond: [{ $eq: ['$ENEO_SQ_Check', 'PROB'] }, 1, 0] }
          },
          fuelProblems: {
            $sum: { $cond: [{ $eq: ['$Fuel_SQ_Check', 'PROB'] }, 1, 0] }
          },
          dgAgeProblems: {
            $sum: { $cond: [{ $eq: ['$DG_Age_Check', 'PROB'] }, 1, 0] }
          },
          hourMeterProblems: {
            $sum: { $cond: [{ $eq: ['$Hour_Meter_Check', 'PROB'] }, 1, 0] }
          },
          automatizationProblems: {
            $sum: { $cond: [{ $eq: ['$Automatization_Status', 'NOK'] }, 1, 0] }
          }
        }
      }
    ]);

    const generatorStatistics = generatorStats[0] || {
      totalSites: 0,
      sitesWithGenerators: 0,
      sitesWithoutGenerators: 0,
      sitesWithOneGenerator: 0,
      sitesWithTwoGenerators: 0
    };

    const visitStatistics = visitStats[0] || {
      totalVisits: 0,
      avgVisitsPerSite: 0,
      totalPartsUsed: 0,
      sitesWithIssues: 0
    };

    const anomalyStatistics = anomaliesStats[0] || {
      eneoProblems: 0,
      fuelProblems: 0,
      dgAgeProblems: 0,
      hourMeterProblems: 0,
      automatizationProblems: 0
    };

    res.json({
      success: true,
      stats: {
        totalSites,
        regions: regions.filter(r => r),
        sitesTypes: sitesTypes.filter(t => t),
        priorities: priorities.filter(p => p),
        visitTypes: visitTypes.filter(v => v),
        avgTenants: avgTenants[0]?.avgTenants || 0,
        recentVisits,
        overdueVisits,
        regionStats,
        visitTypeStats,
        // Generator statistics
        generatorStats: generatorStatistics,
        // Visit statistics
        visitStats: visitStatistics,
        // Anomaly statistics
        anomalyStats: anomalyStatistics
      }
    });
  } catch (error) {
    logger.error('Error fetching site statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching site statistics',
      details: error.message
    });
  }
});

// Upload sites data (handles both original and technician data)
router.post('/upload', async (req, res) => {
  try {
    const data = req.body;

    if (!Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Request body must be an array of site objects'
      });
    }

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid data provided for upload'
      });
    }

    // Validate that all records have IHS_ID_SITE
    const invalidRecords = data.filter(site => !site.IHS_ID_SITE || site.IHS_ID_SITE === '');
    if (invalidRecords.length > 0) {
      return res.status(400).json({
        success: false,
        error: `${invalidRecords.length} records missing required IHS_ID_SITE field`
      });
    }

    // Clean and process the data
    const cleanedData = data.map(site => {
      const { key, rowNumber, ...cleanSite } = site;

      // Convert numeric strings to numbers where appropriate
      const numericFields = [
        'No', 'Latitude', 'Longitude', 'Tenants_Count', 'Earthing_OHM',
        'N_PH1_Voltage', 'N_PH2_Voltage', 'N_PH3_Voltage', 'Actual_Index',
        'Previous_Index', 'Consumed_KWA', 'Tank_Capacity_1', 'Tank_Length',
        'Tank_Width', 'Tank_Height', 'Tank_Bottom', 'Previous_Fuel_Quantity',
        'Height_Found_CM_1', 'Height_Found_CM_2', 'Fuel_Quantity_Found',
        'Fuel_Quantity_Added', 'Fuel_Quantity_Consumed', 'Number_of_Generators',
        'Total_Run_Hours_All_Generators', 'DG_vs_Hours', 'Grid_Gen_Percentage',
        'Belt', 'Oil_Filter', 'Fuel_Filter', 'Separ_Filter', 'Air_Filter',
        'Qty_of_Oil_Changed', 'Qty_of_Radiator_Water', 'Dirty_Oil', 'Time_Passed'
      ];

      numericFields.forEach(field => {
        if (cleanSite[field] && !isNaN(cleanSite[field])) {
          cleanSite[field] = Number(cleanSite[field]);
        }
      });

      // Convert date strings to Date objects
      const dateFields = ['Actual_Date_Visit', 'Previous_Date_Visit'];
      dateFields.forEach(field => {
        if (cleanSite[field]) {
          const date = new Date(cleanSite[field]);
          if (!isNaN(date.getTime())) {
            cleanSite[field] = date;
          }
        }
      });

      // Initialize generator arrays if they don't exist
      if (!cleanSite.Current_Generators) {
        cleanSite.Current_Generators = [];
      }
      if (!cleanSite.Generator_Assignment_History) {
        cleanSite.Generator_Assignment_History = [];
      }

      return cleanSite;
    });

    // Process valid data using bulkWrite for better performance
    const operations = cleanedData.map(site => ({
      updateOne: {
        filter: { IHS_ID_SITE: site.IHS_ID_SITE },
        update: { $set: site },
        upsert: true
      }
    }));

    const result = await Site.bulkWrite(operations);

    res.json({
      success: true,
      message: 'Data processed successfully',
      inserted: result.upsertedCount || 0,
      modified: result.modifiedCount || 0,
      totalProcessed: cleanedData.length
    });

  } catch (error) {
    logger.error('Site upload error:', error);

    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: 'Duplicate IHS_ID_SITE found in upload data',
        details: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Server error processing site data',
        details: error.message
      });
    }
  }
});

// Get specific site by IHS_ID_SITE
router.get('/:ihsIdSite', async (req, res) => {
  try {
    const site = await Site.findOne({ IHS_ID_SITE: req.params.ihsIdSite })
      .populate({
        path: 'Current_Generators',
        select: 'model serial_number specifications current_stats status installation_date last_maintenance'
      })
      .populate({
        path: 'Primary_Generator Secondary_Generator',
        select: 'model serial_number status current_stats specifications'
      })
      .populate({
        path: 'Parts_Used_During_Visit.part_id',
        select: 'name part_number category stock description'
      });

    if (!site) {
      return res.status(404).json({
        success: false,
        error: 'Site not found'
      });
    }

    // Calculate additional metrics
    const siteData = site.toObject();

    // DEBUG: log source and generator counts for troubleshooting mobile discrepancies
    try {
      const ua = req.headers['user-agent'] || req.ip || 'unknown-client';
      console.log(`[SiteLookup] Request from ${ua} for ${req.params.ihsIdSite} - Primary_Generator: ${!!siteData.Primary_Generator}, Secondary_Generator: ${!!siteData.Secondary_Generator}, Current_Generators: ${Array.isArray(siteData.Current_Generators) ? siteData.Current_Generators.length : 0}`);
    } catch (e) {
      // ignore logging errors
    }

    // If Current_Generators is empty but Primary/Secondary generator fields exist, normalize them
    if ((!siteData.Current_Generators || siteData.Current_Generators.length === 0) && (siteData.Primary_Generator || siteData.Secondary_Generator)) {
      siteData.Current_Generators = [];
      if (siteData.Primary_Generator) siteData.Current_Generators.push(siteData.Primary_Generator);
      if (siteData.Secondary_Generator) siteData.Current_Generators.push(siteData.Secondary_Generator);
      console.log(`[SiteLookup] Normalized Current_Generators from primary/secondary for ${req.params.ihsIdSite}`);
    }

    // FALLBACK: Auto-recover generators if missing in site relation but present in generator collection
    if (!siteData.Current_Generators || siteData.Current_Generators.length === 0) {
      try {
        const potentialIds = [req.params.ihsIdSite];
        if (siteData.IHS_ID) potentialIds.push(siteData.IHS_ID);
        
        const orphanedGenerators = await Generator.find({
          tower_id: { $in: potentialIds }
        }).select('model serial_number specifications current_stats status installation_date last_maintenance');

        if (orphanedGenerators.length > 0) {
          siteData.Current_Generators = orphanedGenerators;
          console.log(`[SiteLookup] Recovered ${orphanedGenerators.length} generators via fallback for ${req.params.ihsIdSite}`);
        }
      } catch (err) {
        console.warn('[SiteLookup] Generator recovery failed:', err.message);
      }
    }

    // If still empty, but embedded Generators_Details exist (older schema), map them for mobile
    if ((!siteData.Current_Generators || siteData.Current_Generators.length === 0) && Array.isArray(siteData.Generators_Details) && siteData.Generators_Details.length > 0) {
      siteData.Current_Generators = siteData.Generators_Details.map(g => ({
        _id: g._id || g.id || `GEN_EMBED_${g.generator_number || Math.random().toString(36).slice(2,8)}`,
        id: g._id || g.id || `GEN_EMBED_${g.generator_number || Math.random().toString(36).slice(2,8)}`,
        model: g.brand || g.model || `Generator ${g.generator_number || ''}`,
        serial_number: g.serial_number || g.serial || '',
        status: g.status || 'standby',
        current_stats: {
          runtime: g.actual_running_hours || 0,
          fuel: g.fuel || null,
          power: g.kva || g.power_rating || 0
        },
        specifications: {
          power_rating: g.kva || g.power_rating || 0
        },
        installation_date: g.installation_date || null,
        last_maintenance: g.last_maintenance || null
      }));
      console.log(`[SiteLookup] Mapped ${siteData.Current_Generators.length} embedded Generators_Details for ${req.params.ihsIdSite}`);
    }

    // Ensure each Current_Generators entry has an `id` string and proper object shape for mobile
    if (Array.isArray(siteData.Current_Generators) && siteData.Current_Generators.length > 0) {
      siteData.Current_Generators = siteData.Current_Generators.map(g => {
        if (!g) return g;
        if (typeof g === 'string') return { _id: g, id: g };
        const obj = (g.toObject ? g.toObject() : { ...g });
        if (!obj.id && obj._id) obj.id = String(obj._id);
        return obj;
      });
    }

    // Days since last visit
    if (siteData.Actual_Date_Visit) {
      const today = new Date();
      const lastVisit = new Date(siteData.Actual_Date_Visit);
      siteData.daysSinceLastVisit = Math.floor((today - lastVisit) / (1000 * 60 * 60 * 24));
    }

    // Anomalies check
    siteData.currentAnomalies = site.checkForAnomalies();

    // Next maintenance due
    siteData.nextMaintenanceDue = site.calculateNextMaintenanceDue();

    // Visit summary
    siteData.visitSummary = site.getVisitSummary();

    res.json({
      success: true,
      data: siteData
    });
  } catch (error) {
    logger.error('Error fetching site:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching site data',
      details: error.message
    });
  }
});

// DEBUG ROUTE: Investigate generator links for a site across multiple keys
router.get('/:ihsIdSite/debug', async (req, res) => {
  try {
    const ihsId = req.params.ihsIdSite;
    const site = await Site.findOne({ IHS_ID_SITE: ihsId }).lean();
    if (!site) return res.status(404).json({ success: false, error: 'Site not found' });

    // Attempt various lookup strategies
    const strategies = {};

    // 1) Populate Current_Generators by IDs if present
    if (site.Current_Generators && site.Current_Generators.length > 0) {
      const gens = await require('../models/Generator').find({ _id: { $in: site.Current_Generators } }).lean();
      strategies.currentGenerators = { count: gens.length, samples: gens.slice(0, 5) };
    } else {
      strategies.currentGenerators = { count: 0 };
    }

    // 2) Find generators by tower_id matching common site identifiers
    const candidateKeys = [site.IHS_ID_SITE, site.IHS_ID, site.TENANT_ID, site._id, site.MTN_ID, site.OCM_ID].filter(Boolean);
    const byTower = await require('../models/Generator').find({ tower_id: { $in: candidateKeys } }).lean();
    strategies.byTowerId = { keys: candidateKeys, count: byTower.length, samples: byTower.slice(0,5) };

    // 3) Find generators whose serial or model includes site name (fuzzy)
    const fuzzy = await require('../models/Generator').find({ $or: [ { model: { $regex: site.Site_Name || '', $options: 'i' } }, { serial_number: { $regex: site.Site_Name || '', $options: 'i' } } ] }).limit(5).lean();
    strategies.fuzzy = { count: fuzzy.length, samples: fuzzy };

    // 4) Find generators that reference the site's cluster or region fields
    const clusterKeys = [site.GRATO_Cluster, site.cluster].filter(Boolean);
    let byCluster = [];
    if (clusterKeys.length > 0) {
      byCluster = await require('../models/Generator').find({ tower_id: { $in: clusterKeys } }).limit(10).lean();
    }
    strategies.byCluster = { keys: clusterKeys, count: byCluster.length, samples: byCluster.slice(0,5) };

    return res.json({ success: true, site, strategies });
  } catch (err) {
    console.error('Debug lookup failed', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


router.post('/:ihsIdSite/visit',
  authenticateToken,
  requireRole(['technician', 'admin']),
  upload.array('photos', 10), // Support up to 10 photos
  [
    body('Actual_Date_Visit').notEmpty().withMessage('Visit date required'),
    body('Type_of_Visit').isIn(['PM', 'END', 'RF', 'PM+END', 'PM+RF', 'RF+END', 'PM+RF+END']),
    body('technician_id').notEmpty(),
    body('submit_type').isIn(['draft', 'submit']).withMessage('Must be draft or submit')
  ],
  async (req, res) => {
    console.log('\n========== ENHANCED SITE VISIT SUBMISSION ==========');

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { ihsIdSite } = req.params;
      const visitData = req.body;
      const submitType = visitData.submit_type || 'draft'; // 'draft' or 'submit'
      const uploadedPhotos = req.files || [];

      // Parse JSON fields that might be stringified by FormData
      [
        'Parts_Used_During_Visit', 'Generators_Details', 'Issues_Found',
        'Rectifiers', 'Batteries', 'site_metadata', 'process_tracking',
        'combined_stats', 'pm_checks', 'power_systems', 'electrical_data',
        'fuel_data', 'generators_checked', 'parts_used'
      ].forEach(field => {
        if (visitData[field] && typeof visitData[field] === 'string') {
          try {
            visitData[field] = JSON.parse(visitData[field]);
          } catch (e) {
            console.warn(`Failed to parse ${field}:`, e.message);
          }
        }
      });

      console.log('Site:', ihsIdSite);
      console.log('Submit type:', submitType);
      console.log('Photos uploaded:', uploadedPhotos.length);

      // 1. Find site
      const site = await Site.findOne({ IHS_ID_SITE: ihsIdSite });
      if (!site) {
        return res.status(404).json({
          success: false,
          message: `Site ${ihsIdSite} not found`
        });
      }

      // 2. Verify technician
      const technician = await User.findById(visitData.technician_id);
      if (!technician || technician.role !== 'technician') {
        return res.status(400).json({
          success: false,
          message: 'Invalid technician'
        });
      }

      // 3. Find supervisor (from technician's link or cluster)
      let supervisor = technician.supervisor;
      if (!supervisor) {
        const cluster = await Cluster.findOne({
          'assigned_technicians.technician': technician._id
        }).populate('supervisor');
        if (cluster && cluster.supervisor) {
          supervisor = cluster.supervisor._id;
        } else {
          console.warn('No supervisor found for technician, using default admin');
          const admin = await User.findOne({ role: 'admin' });
          supervisor = admin._id;
        }
      }

      // 4. Process uploaded photos
      const photoRecords = uploadedPhotos.map((file, index) => ({
        url: `/uploads/${file.filename}`,
        category: visitData[`photo_${index}_category`] || 'general',
        description: visitData[`photo_${index}_description`] || '',
        uploaded_at: new Date()
      }));

      console.log(`Processed ${photoRecords.length} photos`);

      // 5. Create visit record for Site History (Legacy/Flat)
      const visitRecord = {
        visit_id: `VISIT_${ihsIdSite}_${Date.now()}`,
        Actual_Date_Visit: new Date(visitData.Actual_Date_Visit),
        Previous_Date_Visit: site.Actual_Date_Visit || null,
        Type_of_Visit: visitData.Type_of_Visit,
        Technician_Name: visitData.technician_name || technician.fullName,
        technician_id: technician._id,

        // Map new structure to old flat structure for compatibility
        Earthing_OHM: visitData.electrical_data?.earthing_ohm || visitData.Earthing_OHM,
        ENEO_Working: visitData.electrical_data?.eneo_working || visitData.ENEO_Working,
        Phase_Type: visitData.electrical_data?.phase_type || visitData.Phase_Type,
        Actual_Index: visitData.electrical_data?.actual_index || visitData.Actual_Index,
        Previous_Index: visitData.electrical_data?.previous_index || visitData.Previous_Index,
        Consumed_KWA: visitData.electrical_data?.consumed_kwa || visitData.Consumed_KWA,

        Fuel_Quantity_Found: visitData.fuel_data?.qte_trouvee || visitData.Fuel_Quantity_Found,
        Fuel_Quantity_Added: visitData.fuel_data?.qte_ajoutee || visitData.Fuel_Quantity_Added,

        Issues_Found: visitData.issues_found || visitData.Issues_Found || {},
        Visit_Comments: visitData.Visit_Comments,
        photos: photoRecords,
        submission_date: new Date(),
        status: submitType === 'submit' ? 'submitted' : 'draft',
        submitted_by: technician._id
      };

      // 6. Save visit to site history
      if (!site.visit_history) {
        site.visit_history = [];
      }
      site.visit_history.push(visitRecord);

      // Update current site fields
      site.Previous_Date_Visit = site.Actual_Date_Visit;
      site.Actual_Date_Visit = visitRecord.Actual_Date_Visit;
      site.Type_of_Visit = visitRecord.Type_of_Visit;
      site.Technician_Name = visitRecord.Technician_Name;

      await site.save();
      console.log('✓ Visit saved to site history');

      // 7. CREATE MAINTENANCE RECORD (Rich Structure)
      const maintenanceData = {
        maintenance_id: `MAINT_${ihsIdSite}_${Date.now()}`,
        site_id: ihsIdSite,
        site_name: site.Site_Name,
        visit_reference: visitRecord.visit_id,
        technician: technician._id,
        technician_name: technician.fullName,
        supervisor: supervisor,
        visit_type: visitData.Type_of_Visit,
        visit_date: visitRecord.Actual_Date_Visit,
        prev_visit_date: site.Previous_Date_Visit,
        hours_on_site: visitData.hours_on_site,
        sbc: visitData.sbc,

        site_metadata: visitData.site_metadata || {
          cluster: site.GRATO_Cluster,
          site_priority: site.Sites_Priority,
          state: site.Region,
          operator: site.Operator
        },

        process_tracking: visitData.process_tracking,

        work_performed: visitData.Visit_Comments || '',
        issues_found: visitData.issues_found || {},
        parts_used: (visitData.parts_used || []).map(p => ({
          part_id: p.part_id,
          part_name: p.part_name,
          part_number: p.part_number,
          quantity_used: p.quantity_used,
          technician_notes: p.technician_notes
        })),

        generators_checked: visitData.generators_checked || [],
        combined_stats: visitData.combined_stats,
        fuel_data: visitData.fuel_data,
        pm_checks: visitData.pm_checks,
        power_systems: visitData.power_systems,
        electrical_data: visitData.electrical_data,
        photos: photoRecords,

        status: submitType === 'submit' ? 'pending_approval' : 'draft',
        is_draft: submitType === 'draft',
        draft_saved_at: submitType === 'draft' ? new Date() : null,
        submitted_at: submitType === 'submit' ? new Date() : null,

        priority: visitData.priority || 'medium',
        created_by: technician._id
      };

      const maintenance = new Maintenance(maintenanceData);
      await maintenance.save();

      console.log('✓ Maintenance record created:', maintenance.maintenance_id);
      console.log('  Status:', maintenance.status);
      console.log('  Is Draft:', maintenance.is_draft);

      // 8. Response
      const response = {
        success: true,
        message: submitType === 'submit'
          ? 'Visit submitted for supervisor approval'
          : 'Visit saved as draft',
        data: {
          visit_id: visitRecord.visit_id,
          maintenance_id: maintenance.maintenance_id,
          site_id: ihsIdSite,
          status: maintenance.status,
          is_draft: maintenance.is_draft,
          submission_date: maintenance.submitted_at || maintenance.draft_saved_at,
          photos_uploaded: photoRecords.length,
          requires_approval: submitType === 'submit'
        }
      };

      logger.info('Site visit processed', {
        site: ihsIdSite,
        technician: technician.fullName,
        maintenance_id: maintenance.maintenance_id,
        submit_type: submitType,
        photos: photoRecords.length
      });

      console.log('========== SUBMISSION COMPLETE ==========\n');

      res.status(201).json(response);

    } catch (error) {
      console.error('Site visit submission error:', error);
      logger.error('Site visit submission error:', error);

      res.status(500).json({
        success: false,
        message: 'Failed to process site visit',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);


/**
 * NEW: Get technician's maintenance drafts
 * GET /api/sites/maintenance/my-drafts
 */
router.get('/maintenance/my-drafts',
  authenticateToken,
  requireRole(['technician']),
  async (req, res) => {
    try {
      const technicianId = req.user.userId;

      const drafts = await Maintenance.find({
        technician: technicianId,
        is_draft: true,
        status: 'draft'
      })
        .sort({ draft_saved_at: -1 })
        .limit(50);

      res.json({
        success: true,
        data: drafts,
        count: drafts.length
      });

    } catch (error) {
      logger.error('Get drafts error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch drafts'
      });
    }
  }
);

/**
 * NEW: Update draft and optionally submit
 * PUT /api/sites/maintenance/:id/update-draft
 */
router.put('/maintenance/:id/update-draft',
  authenticateToken,
  requireRole(['technician']),
  upload.array('new_photos', 10),
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const submitNow = updates.submit_now === 'true';
      const newPhotos = req.files || [];

      const maintenance = await Maintenance.findById(id);
      if (!maintenance) {
        return res.status(404).json({
          success: false,
          message: 'Maintenance record not found'
        });
      }

      // Verify ownership
      if (maintenance.technician.toString() !== req.user.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own records'
        });
      }

      // Can only edit drafts or rejected records
      if (!['draft', 'rejected'].includes(maintenance.status)) {
        return res.status(400).json({
          success: false,
          message: 'Can only edit drafts or rejected records'
        });
      }

      // Track changes for edit history
      const changes = {};
      const fieldsToUpdate = [
        'work_performed', 'issues_found', 'parts_used', 'generators_checked',
        'fuel_data', 'electrical_data', 'priority'
      ];

      fieldsToUpdate.forEach(field => {
        if (updates[field] !== undefined) {
          changes[field] = {
            old: maintenance[field],
            new: updates[field]
          };
          maintenance[field] = updates[field];
        }
      });

      // Add new photos
      if (newPhotos.length > 0) {
        const newPhotoRecords = newPhotos.map((file, index) => ({
          url: `/uploads/${file.filename}`,
          category: updates[`photo_${index}_category`] || 'general',
          description: updates[`photo_${index}_description`] || '',
          uploaded_at: new Date()
        }));

        maintenance.photos.push(...newPhotoRecords);
        changes.photos = { added: newPhotoRecords.length };
      }

      // Log the edit
      maintenance.logEdit(
        req.user.userId,
        changes,
        updates.edit_reason || 'Updated draft'
      );

      // If submitting, change status
      if (submitNow) {
        await maintenance.submitForApproval();

        logger.info('Draft submitted for approval', {
          maintenance_id: maintenance.maintenance_id,
          technician: req.user.userId
        });
      } else {
        maintenance.draft_saved_at = new Date();
        await maintenance.save();
      }

      res.json({
        success: true,
        message: submitNow ? 'Submitted for approval' : 'Draft updated',
        data: {
          maintenance_id: maintenance.maintenance_id,
          status: maintenance.status,
          is_draft: maintenance.is_draft,
          changes_logged: Object.keys(changes).length
        }
      });

    } catch (error) {
      logger.error('Update draft error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update draft'
      });
    }
  }
);


// Get sites needing maintenance
router.get('/maintenance/needed', async (req, res) => {
  try {
    const { priority, region, anomalyType } = req.query;

    const filter = {};
    if (priority) filter.Sites_Priority = priority;
    if (region) filter.Region = region;

    // Add anomaly-specific filters
    if (anomalyType) {
      switch (anomalyType) {
        case 'dg_age':
          filter.DG_Age_Check = 'PROB';
          break;
        case 'hour_meter':
          filter.Hour_Meter_Check = 'PROB';
          break;
        case 'eneo':
          filter.ENEO_SQ_Check = 'PROB';
          break;
        case 'fuel':
          filter.Fuel_SQ_Check = 'PROB';
          break;
        case 'automatization':
          filter.Automatization_Status = 'NOK';
          break;
        case 'overdue':
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - 90);
          filter.$or = [
            { Actual_Date_Visit: { $lt: cutoffDate } },
            { Actual_Date_Visit: { $exists: false } },
            { Actual_Date_Visit: null }
          ];
          break;
      }
    }

    const sites = await Site.find(filter)
      .populate({
        path: 'Current_Generators',
        select: 'model serial_number status current_stats'
      })
      .populate({
        path: 'Parts_Used_During_Visit.part_id',
        select: 'name part_number category'
      })
      .select(`
        IHS_ID_SITE Site_Name Region Sites_Priority Technician_Name
        Actual_Date_Visit Type_of_Visit Current_Generators
        DG_Age_Check Hour_Meter_Check ENEO_SQ_Check Fuel_SQ_Check
        Automatization_Status Issues_Found Visit_Comments
        Generators_Details Parts_Used_During_Visit
      `)
      .sort({ Actual_Date_Visit: 1 }); // Oldest visits first

    // Add computed fields
    const sitesWithAnalysis = sites.map(site => {
      const siteObj = site.toObject();

      // Calculate days since last visit
      if (siteObj.Actual_Date_Visit) {
        const today = new Date();
        const lastVisit = new Date(siteObj.Actual_Date_Visit);
        siteObj.daysSinceLastVisit = Math.floor((today - lastVisit) / (1000 * 60 * 60 * 24));
      } else {
        siteObj.daysSinceLastVisit = null;
      }

      // Identify anomalies
      siteObj.anomalies = [];
      if (siteObj.DG_Age_Check === 'PROB') {
        siteObj.anomalies.push({ type: 'DG Age Check', severity: 'medium' });
      }
      if (siteObj.Hour_Meter_Check === 'PROB') {
        siteObj.anomalies.push({ type: 'Hour Meter Check', severity: 'medium' });
      }
      if (siteObj.ENEO_SQ_Check === 'PROB') {
        siteObj.anomalies.push({ type: 'ENEO SQ Check', severity: 'high' });
      }
      if (siteObj.Fuel_SQ_Check === 'PROB') {
        siteObj.anomalies.push({ type: 'Fuel SQ Check', severity: 'high' });
      }
      if (siteObj.Automatization_Status === 'NOK') {
        siteObj.anomalies.push({ type: 'Automatization', severity: 'high' });
      }
      if (siteObj.daysSinceLastVisit && siteObj.daysSinceLastVisit > 90) {
        siteObj.anomalies.push({
          type: 'Overdue Visit',
          severity: siteObj.daysSinceLastVisit > 180 ? 'high' : 'medium'
        });
      }

      // Priority scoring for maintenance
      siteObj.maintenancePriority = siteObj.anomalies.reduce((score, anomaly) => {
        return score + (anomaly.severity === 'high' ? 3 : 1);
      }, 0);

      // Add priority level
      if (siteObj.maintenancePriority >= 6) {
        siteObj.maintenanceUrgency = 'Critical';
      } else if (siteObj.maintenancePriority >= 3) {
        siteObj.maintenanceUrgency = 'High';
      } else if (siteObj.maintenancePriority >= 1) {
        siteObj.maintenanceUrgency = 'Medium';
      } else {
        siteObj.maintenanceUrgency = 'Low';
      }

      return siteObj;
    });

    // Sort by maintenance priority
    sitesWithAnalysis.sort((a, b) => b.maintenancePriority - a.maintenancePriority);

    res.json({
      success: true,
      data: sitesWithAnalysis,
      count: sitesWithAnalysis.length,
      summary: {
        critical: sitesWithAnalysis.filter(s => s.maintenanceUrgency === 'Critical').length,
        high: sitesWithAnalysis.filter(s => s.maintenanceUrgency === 'High').length,
        medium: sitesWithAnalysis.filter(s => s.maintenanceUrgency === 'Medium').length,
        low: sitesWithAnalysis.filter(s => s.maintenanceUrgency === 'Low').length
      }
    });

  } catch (error) {
    logger.error('Error fetching maintenance needed sites:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching maintenance data',
      details: error.message
    });
  }
});

// Update site details
router.put('/:siteId', authenticateToken, requireRole(['admin', 'supervisor']), [
  body('Site_Name').optional().trim().notEmpty(),
  body('Region').optional().trim(),
  body('GRATO_Cluster').optional().trim(),
  body('Sites_Priority').optional().isIn(['P1', 'P2', 'P3']),
  body('Sites_Type').optional().trim(),
  body('Latitude').optional().isFloat(),
  body('Longitude').optional().isFloat()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { siteId } = req.params;
    const updateData = {};

    // Comprehensive list of fields that can be updated
    const allowedFields = [
      // Basic site info
      'Site_Name', 'Region', 'GRATO_Cluster', 'Sites_Priority', 
      'Sites_Type', 'Latitude', 'Longitude', 'Type_of_Visit',
      'Contact_Person', 'Contact_Phone', 'Visit_Comments',
      
      // Shelter/Configuration
      'Sites_Configuration_Outdoor_Indoor', 'Sites_Power_Topology',
      'Alarm_Cable_Status', 'Company_in_charge_of_Security',
      
      // Generator info
      'Number_of_Generators', 'Generators_Details', 'DG_Age_Check',
      'Hour_Meter_Check', 'Automatization_Status',
      
      // Power Cabinet
      'Power_Cab_1_Type', 'Rectifiers', 'Batteries',
      
      // Fuel System
      'Type_de_Tank', 'Tank_Capacity_1', 'Tank_Length', 'Tank_Width',
      'Tank_Height', 'Tank_Bottom', 'Fuel_SQ_Check',
      'Previous_Fuel_Quantity', 'Fuel_Quantity_Found',
      'Height_Found_CM_1', 'Height_Found_CM_2',
      'Fuel_Quantity_Added', 'Fuel_Quantity_Consumed',
      
      // Grid/Electrical
      'Earthing_OHM', 'ENEO_Working', 'Phase_Type',
      'N_PH1_Voltage', 'N_PH2_Voltage', 'N_PH3_Voltage',
      'ENEO_Meter_Number', 'ENEO_SQ_Check',
      'Actual_Index', 'Previous_Index', 'Consumed_KWA',
      'Comments_on_Grid'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const site = await Site.findOneAndUpdate(
      { IHS_ID_SITE: siteId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!site) {
      return res.status(404).json({
        success: false,
        message: 'Site not found'
      });
    }

    logger.info('Site updated', {
      siteId,
      updatedBy: req.user.userId,
      fields: Object.keys(updateData)
    });

    res.json({
      success: true,
      message: 'Site updated successfully',
      data: site
    });

  } catch (error) {
    logger.error('Error updating site:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating site',
      details: error.message
    });
  }
});

module.exports = router;


