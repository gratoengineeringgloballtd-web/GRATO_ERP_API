// NEW FILE: routes/dataCollectorRoutes.js

const express = require('express');
const router = express.Router();
const Site = require('../models/Site');
const User = require('../models/User');
const Maintenance = require('../models/Maintenance');
const FuelConsumption = require('../models/FuelConsumption');
const Generator = require('../models/Generator');
const Cluster = require('../models/Cluster');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');
const ExcelJS = require('exceljs'); // For exports

/**
 * Get data quality dashboard
 * GET /api/data-collector/dashboard
 */
router.get('/dashboard',
  authenticateToken,
  requireRole(['data_collector', 'admin']),
  async (req, res) => {
    try {
      const [
        totalSites,
        sitesWithVisits,
        sitesNeedingVisits,
        totalTechnicians,
        activeTechnicians,
        maintenanceRecords,
        fuelRecords,
        dataCompletenessScore
      ] = await Promise.all([
        Site.countDocuments({}),
        Site.countDocuments({ Actual_Date_Visit: { $exists: true } }),
        Site.countDocuments({
          $or: [
            { Actual_Date_Visit: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
            { Actual_Date_Visit: { $exists: false } }
          ]
        }),
        User.countDocuments({ role: { $in: ['technician', 'ac'] } }),
        User.countDocuments({ role: { $in: ['technician', 'ac'] }, isActive: true }),
        Maintenance.countDocuments({}),
        FuelConsumption.countDocuments({}),
        calculateDataCompletenessScore()
      ]);

      res.json({
        success: true,
        data: {
          sites: {
            total: totalSites,
            with_visits: sitesWithVisits,
            needing_visits: sitesNeedingVisits,
            visit_coverage: totalSites > 0 ? Math.round((sitesWithVisits / totalSites) * 100) : 0
          },
          technicians: {
            total: totalTechnicians,
            active: activeTechnicians,
            inactive: totalTechnicians - activeTechnicians
          },
          records: {
            maintenance: maintenanceRecords,
            fuel: fuelRecords
          },
          data_quality: dataCompletenessScore
        }
      });

    } catch (error) {
      logger.error('Data collector dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard data'
      });
    }
  }
);

// Helper function for data completeness
async function calculateDataCompletenessScore() {
  const sites = await Site.find({}).select('IHS_ID_SITE Site_Name Latitude Longitude Technician_Name GRATO_Cluster').lean();
  
  let totalFields = 0;
  let completedFields = 0;
  
  const requiredFields = ['IHS_ID_SITE', 'Site_Name', 'Latitude', 'Longitude', 'Technician_Name', 'GRATO_Cluster'];
  
  sites.forEach(site => {
    requiredFields.forEach(field => {
      totalFields++;
      if (site[field] && site[field] !== '' && site[field] !== 0) {
        completedFields++;
      }
    });
  });
  
  const score = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 0;
  
  return {
    score: score,
    total_sites: sites.length,
    total_fields_checked: totalFields,
    completed_fields: completedFields
  };
}

/**
 * Get data quality report
 * GET /api/data-collector/reports/data-quality
 */
router.get('/reports/data-quality',
  authenticateToken,
  requireRole(['data_collector', 'admin']),
  async (req, res) => {
    try {
      // Find sites with missing critical data
      const sitesWithIssues = await Site.find({
        $or: [
          { Site_Name: { $in: [null, ''] } },
          { Latitude: { $in: [null, 0] } },
          { Longitude: { $in: [null, 0] } },
          { Technician_Name: { $in: [null, ''] } },
          { GRATO_Cluster: { $in: [null, ''] } }
        ]
      }).select('IHS_ID_SITE Site_Name Region Latitude Longitude Technician_Name GRATO_Cluster').lean();

      const issues = sitesWithIssues.map(site => {
        const missingFields = [];
        if (!site.Site_Name) missingFields.push('Site_Name');
        if (!site.Latitude || site.Latitude === 0) missingFields.push('Latitude');
        if (!site.Longitude || site.Longitude === 0) missingFields.push('Longitude');
        if (!site.Technician_Name) missingFields.push('Technician_Name');
        if (!site.GRATO_Cluster) missingFields.push('GRATO_Cluster');

        return {
          site_id: site.IHS_ID_SITE,
          site_name: site.Site_Name || 'Unknown',
          region: site.Region,
          missing_fields: missingFields,
          severity: missingFields.length > 3 ? 'high' : missingFields.length > 1 ? 'medium' : 'low'
        };
      });

      res.json({
        success: true,
        data: {
          total_sites_with_issues: issues.length,
          issues: issues,
          summary: {
            high_severity: issues.filter(i => i.severity === 'high').length,
            medium_severity: issues.filter(i => i.severity === 'medium').length,
            low_severity: issues.filter(i => i.severity === 'low').length
          }
        }
      });

    } catch (error) {
      logger.error('Data quality report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate data quality report'
      });
    }
  }
);

/**
 * Get missing data report
 * GET /api/data-collector/reports/missing-data
 */
router.get('/reports/missing-data',
  authenticateToken,
  requireRole(['data_collector', 'admin']),
  async (req, res) => {
    try {
      const [
        sitesWithoutVisits,
        sitesWithoutTechnicians,
        sitesWithoutClusters,
        sitesWithoutCoordinates,
        techniciansWithoutSites
      ] = await Promise.all([
        Site.find({
          $or: [
            { Actual_Date_Visit: { $exists: false } },
            { Actual_Date_Visit: null }
          ]
        }).select('IHS_ID_SITE Site_Name Region').limit(100).lean(),

        Site.find({
          $or: [
            { Technician_Name: { $exists: false } },
            { Technician_Name: null },
            { Technician_Name: '' }
          ]
        }).select('IHS_ID_SITE Site_Name Region').limit(100).lean(),

        Site.find({
          $or: [
            { GRATO_Cluster: { $exists: false } },
            { GRATO_Cluster: null },
            { GRATO_Cluster: '' }
          ]
        }).select('IHS_ID_SITE Site_Name Region').limit(100).lean(),

        Site.find({
          $or: [
            { Latitude: { $in: [null, 0] } },
            { Longitude: { $in: [null, 0] } }
          ]
        }).select('IHS_ID_SITE Site_Name Region').limit(100).lean(),

        User.aggregate([
          { $match: { role: 'technician', isActive: true } },
          {
            $lookup: {
              from: 'sites',
              localField: 'fullName',
              foreignField: 'Technician_Name',
              as: 'sites'
            }
          },
          { $match: { 'sites': { $size: 0 } } },
          { $project: { fullName: 1, email: 1, phone: 1 } }
        ])
      ]);

      res.json({
        success: true,
        data: {
          sites_without_visits: {
            count: sitesWithoutVisits.length,
            samples: sitesWithoutVisits.slice(0, 10)
          },
          sites_without_technicians: {
            count: sitesWithoutTechnicians.length,
            samples: sitesWithoutTechnicians.slice(0, 10)
          },
          sites_without_clusters: {
            count: sitesWithoutClusters.length,
            samples: sitesWithoutClusters.slice(0, 10)
          },
          sites_without_coordinates: {
            count: sitesWithoutCoordinates.length,
            samples: sitesWithoutCoordinates.slice(0, 10)
          },
          technicians_without_sites: {
            count: techniciansWithoutSites.length,
            list: techniciansWithoutSites
          }
        }
      });

    } catch (error) {
      logger.error('Missing data report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate missing data report'
      });
    }
  }
);

/**
 * Export all data (Excel)
 * GET /api/data-collector/export/all
 */
router.get('/export/all',
  authenticateToken,
  requireRole(['data_collector', 'admin']),
  async (req, res) => {
    try {
      const { data_type = 'sites', start_date, end_date } = req.query;

      const workbook = new ExcelJS.Workbook();
      
      // Date Filter Construction
      const dateFilter = {};
      if (start_date || end_date) {
        dateFilter.$gte = start_date ? new Date(start_date) : new Date(0); // Default to epoch if no start
        if (end_date) {
             const eDate = new Date(end_date);
             eDate.setHours(23, 59, 59); // End of day
             dateFilter.$lte = eDate;
        }
      }

      if (data_type === 'sites' || data_type === 'all') {
        const query = {};
        if (start_date || end_date) {
            // For sites, filter by Last Visit date if date range provided
            query.Actual_Date_Visit = dateFilter;
        }

        const sites = await Site.find(query)
          .select('IHS_ID_SITE Site_Name Region GRATO_Cluster Technician_Name Actual_Date_Visit Type_of_Visit')
          .lean();

        const sitesSheet = workbook.addWorksheet('Sites');
        sitesSheet.columns = [
          { header: 'Site ID', key: 'IHS_ID_SITE', width: 20 },
          { header: 'Site Name', key: 'Site_Name', width: 30 },
          { header: 'Region', key: 'Region', width: 15 },
          { header: 'Cluster', key: 'GRATO_Cluster', width: 20 },
          { header: 'Technician', key: 'Technician_Name', width: 25 },
          { header: 'Last Visit', key: 'Actual_Date_Visit', width: 15 },
          { header: 'Visit Type', key: 'Type_of_Visit', width: 15 }
        ];

        sites.forEach(site => sitesSheet.addRow(site));
      }

      if (data_type === 'technicians' || data_type === 'all') {
        const technicians = await User.find({ role: 'technician' })
          .select('fullName email phone specializations isActive')
          .lean();

        const techSheet = workbook.addWorksheet('Technicians');
        techSheet.columns = [
          { header: 'Full Name', key: 'fullName', width: 30 },
          { header: 'Email', key: 'email', width: 30 },
          { header: 'Phone', key: 'phone', width: 20 },
          { header: 'Specializations', key: 'specializations', width: 30 },
          { header: 'Active', key: 'isActive', width: 10 }
        ];

        technicians.forEach(tech => {
          techSheet.addRow({
            ...tech,
            specializations: tech.specializations?.join(', ') || ''
          });
        });
      }

      if (data_type === 'maintenance' || data_type === 'all') {
        const query = {};
        if (start_date || end_date) {
            query.visit_date = dateFilter;
        }

        const maintenance = await Maintenance.find(query)
          .populate('technician', 'fullName')
          .populate('supervisor', 'fullName')
          .select('maintenance_id site_id visit_type visit_date status')
          .lean();

        const maintSheet = workbook.addWorksheet('Maintenance');
        maintSheet.columns = [
          { header: 'Maintenance ID', key: 'maintenance_id', width: 30 },
          { header: 'Site ID', key: 'site_id', width: 20 },
          { header: 'Technician', key: 'technician_name', width: 25 },
          { header: 'Supervisor', key: 'supervisor_name', width: 25 },
          { header: 'Visit Type', key: 'visit_type', width: 15 },
          { header: 'Visit Date', key: 'visit_date', width: 15 },
          { header: 'Status', key: 'status', width: 20 }
        ];

        maintenance.forEach(m => {
          maintSheet.addRow({
            ...m,
            technician_name: m.technician?.fullName || '',
            supervisor_name: m.supervisor?.fullName || ''
          });
        });
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=data_export_${Date.now()}.xlsx`);

      await workbook.xlsx.write(res);
      res.end();

    } catch (error) {
      logger.error('Export data error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export data'
      });
    }
  }
);

/**
 * Get technician activity report
 * GET /api/data-collector/reports/technician-activity
 */
router.get('/reports/technician-activity',
  authenticateToken,
  requireRole(['data_collector', 'admin']),
  async (req, res) => {
    try {
      const { period = '30' } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(period));

      const technicians = await User.find({ role: 'technician' })
        .select('fullName email')
        .lean();

      const activity = await Promise.all(
        technicians.map(async (tech) => {
          const [visits, maintenanceRecords, sitesAssigned] = await Promise.all([
            Maintenance.countDocuments({
              technician: tech._id,
              submitted_at: { $gte: startDate }
            }),
            Maintenance.countDocuments({
              technician: tech._id,
              status: 'completed',
              completed_at: { $gte: startDate }
            }),
            Site.countDocuments({
              Technician_Name: tech.fullName
            })
          ]);

          return {
            technician_id: tech._id,
            technician_name: tech.fullName,
            email: tech.email,
            sites_assigned: sitesAssigned,
            visits_submitted: visits,
            maintenance_completed: maintenanceRecords,
            activity_score: visits + (maintenanceRecords * 2)
          };
        })
      );

      activity.sort((a, b) => b.activity_score - a.activity_score);

      res.json({
        success: true,
        data: {
          period_days: parseInt(period),
          technicians: activity,
          summary: {
            total_technicians: activity.length,
            active: activity.filter(a => a.activity_score > 0).length,
            inactive: activity.filter(a => a.activity_score === 0).length,
            avg_visits: activity.reduce((sum, a) => sum + a.visits_submitted, 0) / activity.length
          }
        }
      });

    } catch (error) {
      logger.error('Technician activity report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate technician activity report'
      });
    }
  }
);

/**
 * Get visit coverage report
 * GET /api/data-collector/reports/visit-coverage
 */
router.get('/reports/visit-coverage',
  authenticateToken,
  requireRole(['data_collector', 'admin']),
  async (req, res) => {
    try {
      const { group_by = 'region' } = req.query;

      let groupField = '$Region';
      if (group_by === 'cluster') groupField = '$GRATO_Cluster';

      const coverage = await Site.aggregate([
        {
          $group: {
            _id: groupField,
            total_sites: { $sum: 1 },
            sites_with_visits: {
              $sum: {
                $cond: [
                  { $ne: ['$Actual_Date_Visit', null] },
                  1,
                  0
                ]
              }
            },
            recent_visits: {
              $sum: {
                $cond: [
                  {
                    $gte: [
                      '$Actual_Date_Visit',
                      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
                    ]
                  },
                  1,
                  0
                ]
              }
            }
          }
        },
        {
          $project: {
            _id: 1,
            total_sites: 1,
            sites_with_visits: 1,
            recent_visits: 1,
            coverage_percentage: {
              $multiply: [
                { $divide: ['$sites_with_visits', '$total_sites'] },
                100
              ]
            },
            recent_coverage_percentage: {
              $multiply: [
                { $divide: ['$recent_visits', '$total_sites'] },
                100
              ]
            }
          }
        },
        {
          $sort: { coverage_percentage: -1 }
        }
      ]);

      res.json({
        success: true,
        data: {
          grouped_by: group_by,
          coverage: coverage
        }
      });

    } catch (error) {
      logger.error('Visit coverage report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate visit coverage report'
      });
    }
  }
);

/**
 * Get all submitted maintenance records
 * GET /api/data-collector/maintenance/submitted
 */
router.get('/maintenance/submitted',
  authenticateToken,
  requireRole(['data_collector', 'admin']),
  async (req, res) => {
    try {
      const maintenance = await Maintenance.find({
        status: { $in: ['pending_approval', 'approved', 'completed', 'rejected'] },
        submitted_at: { $exists: true }
      })
        .populate('technician', 'fullName email phoneNumber')
        .populate('site_id', 'Site_Name Region Cluster IHS_ID_SITE Latitude Longitude')
        .sort({ submitted_at: -1 })
        .lean();

      // Format the response to include site_details
      const formattedMaintenance = maintenance.map(m => ({
        ...m,
        site_details: m.site_id,
        site_name: m.site_id?.Site_Name || null,
        technician_name: m.technician?.fullName || null
      }));

      res.json({
        success: true,
        data: formattedMaintenance
      });

    } catch (error) {
      logger.error('Get submitted maintenance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch submitted maintenance records'
      });
    }
  }
);

module.exports = router;



