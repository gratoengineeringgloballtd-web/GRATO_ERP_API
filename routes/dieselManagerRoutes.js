const express = require('express');
const router = express.Router();
const FuelConsumption = require('../models/FuelConsumption');
const Site = require('../models/Site');
const Generator = require('../models/Generator');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Get fuel consumption dashboard
 * GET /api/fuel/dashboard
 */
router.get('/dashboard',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { period = '30' } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(period));

      const [
        totalConsumption,
        pendingRequests,
        criticalSites,
        avgConsumptionRate,
        anomalyCount
      ] = await Promise.all([
        FuelConsumption.aggregate([
          { $match: { record_date: { $gte: startDate } } },
          { $group: { _id: null, total: { $sum: '$fuel_data.fuel_consumed' } } }
        ]),
        FuelConsumption.countDocuments({
          approval_status: 'pending',
          'request_info.fuel_requested': { $gt: 0 }
        }),
        FuelConsumption.countDocuments({
          record_date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          'fuel_data.closing_level': { $lt: 100 } // Less than 100 liters
        }),
        FuelConsumption.aggregate([
          { $match: { record_date: { $gte: startDate } } },
          { $group: { _id: null, avg: { $avg: '$metrics.consumption_rate' } } }
        ]),
        FuelConsumption.countDocuments({
          'metrics.anomaly_detected': true,
          record_date: { $gte: startDate }
        })
      ]);

      res.json({
        success: true,
        data: {
          period_days: parseInt(period),
          total_consumption: totalConsumption[0]?.total || 0,
          pending_requests: pendingRequests,
          critical_sites: criticalSites,
          avg_consumption_rate: avgConsumptionRate[0]?.avg || 0,
          anomaly_count: anomalyCount
        }
      });

    } catch (error) {
      logger.error('Fuel dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch fuel dashboard'
      });
    }
  }
);


/**
 * Get all technicians (for diesel manager)
 * GET /api/fuel/technicians
 */
router.get('/technicians',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { region } = req.query;
      const query = { role: 'technician' };
      if (region) query.Region = region;

      const technicians = await require('../models/User').find(query)
        .select('fullName email phone specializations assignedClusters assignedTowers isActive isOnline Region')
        .lean();

      res.status(200).json({
        success: true,
        data: technicians,
        count: technicians.length
      });
    } catch (error) {
      logger.error('Diesel manager fetch technicians error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch technicians',
        message: error.message
      });
    }
  }
);


/**
 * Get all sites (for diesel manager)
 * GET /api/fuel/sites
 */
router.get('/sites',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      // Optionally, add filters via query params
      const { region, priority } = req.query;
      const query = {};
      if (region) query.Region = region;
      if (priority) query.Sites_Priority = priority;

      const sites = await Site.find(query)
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
      logger.error('Diesel manager fetch sites error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch sites',
        message: error.message
      });
    }
  }
);


/**
 * Get fuel consumption by site
 * GET /api/fuel/consumption/by-site/:siteId
 */
router.get('/consumption/by-site/:siteId',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor']),
  async (req, res) => {
    try {
      const { siteId } = req.params;
      const { start_date, end_date, page = 1, limit = 20 } = req.query;

      const query = { site_id: siteId };
      
      if (start_date || end_date) {
        query.record_date = {};
        if (start_date) query.record_date.$gte = new Date(start_date);
        if (end_date) query.record_date.$lte = new Date(end_date);
      }

      const skip = (page - 1) * limit;

      const [records, total, site] = await Promise.all([
        FuelConsumption.find(query)
          .populate('recorded_by', 'fullName')
          .sort({ record_date: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        FuelConsumption.countDocuments(query),
        Site.findOne({ IHS_ID_SITE: siteId })
          .select('Site_Name Region GRATO_Cluster')
      ]);

      res.json({
        success: true,
        data: {
          site: site,
          records: records,
          pagination: {
            current: parseInt(page),
            pageSize: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });

    } catch (error) {
      logger.error('Get site fuel consumption error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch fuel consumption data'
      });
    }
  }
);

/**
 * Get fuel consumption summary for site
 * GET /api/fuel/consumption/summary/:siteId
 */
router.get('/consumption/summary/:siteId',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor']),
  async (req, res) => {
    try {
      const { siteId } = req.params;
      const { period = '30' } = req.query;

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(period));

      const summary = await FuelConsumption.getSiteSummary(siteId, startDate, endDate);

      res.json({
        success: true,
        data: summary
      });

    } catch (error) {
      logger.error('Get fuel summary error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch fuel summary'
      });
    }
  }
);

/**
 * Get pending fuel requests
 * GET /api/fuel/requests/pending
 */
router.get('/requests/pending',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { urgency, page = 1, limit = 20 } = req.query;

      const filters = {};
      if (urgency) filters.urgency = urgency;

      const skip = (page - 1) * limit;

      const requests = await FuelConsumption.getPendingRequests(filters)
        .skip(skip)
        .limit(parseInt(limit));

      // Enrich with site info
      const enriched = await Promise.all(
        requests.map(async (req) => {
          const site = await Site.findOne({ IHS_ID_SITE: req.site_id })
            .select('Site_Name Region GRATO_Cluster');

          return {
            ...req.toObject(),
            site_details: site,
            fuel_percentage: req.fuel_percentage_remaining,
            days_until_empty: req.days_until_empty
          };
        })
      );

      const total = await FuelConsumption.countDocuments({
        'request_info.fuel_requested': { $gt: 0 },
        approval_status: 'pending'
      });

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
      logger.error('Get pending fuel requests error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pending requests'
      });
    }
  }
);

/**
 * Approve fuel request
 * POST /api/fuel/requests/:id/approve
 */
router.post('/requests/:id/approve',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  [
    body('notes').optional().isString()
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const dieselManagerId = req.user.userId;

      const fuelRecord = await FuelConsumption.findById(id)
        .populate('request_info.requested_by', 'fullName email');

      if (!fuelRecord) {
        return res.status(404).json({
          success: false,
          message: 'Fuel request not found'
        });
      }

      await fuelRecord.approveFuelRequest(dieselManagerId, notes);

      logger.info('Fuel request approved', {
        request_id: id,
        site: fuelRecord.site_id,
        quantity: fuelRecord.request_info.fuel_requested,
        approved_by: dieselManagerId
      });

      res.json({
        success: true,
        message: 'Fuel request approved',
        data: {
          site_id: fuelRecord.site_id,
          fuel_requested: fuelRecord.request_info.fuel_requested,
          approved_at: fuelRecord.approved_at
        }
      });

    } catch (error) {
      logger.error('Approve fuel request error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to approve fuel request'
      });
    }
  }
);

/**
 * Reject fuel request
 * POST /api/fuel/requests/:id/reject
 */
router.post('/requests/:id/reject',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  [
    body('reason').notEmpty().withMessage('Rejection reason required')
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
      const dieselManagerId = req.user.userId;

      const fuelRecord = await FuelConsumption.findById(id);

      if (!fuelRecord) {
        return res.status(404).json({
          success: false,
          message: 'Fuel request not found'
        });
      }

      await fuelRecord.rejectFuelRequest(dieselManagerId, reason);

      logger.info('Fuel request rejected', {
        request_id: id,
        site: fuelRecord.site_id,
        reason: reason
      });

      res.json({
        success: true,
        message: 'Fuel request rejected',
        data: {
          site_id: fuelRecord.site_id,
          rejection_reason: fuelRecord.rejection_reason
        }
      });

    } catch (error) {
      logger.error('Reject fuel request error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reject fuel request'
      });
    }
  }
);

/**
 * Mark fuel as delivered
 * POST /api/fuel/requests/:id/deliver
 */
router.post('/requests/:id/deliver',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  [
    body('delivered_quantity').isNumeric().withMessage('Delivered quantity required'),
    body('delivered_by').notEmpty().withMessage('Delivery person name required')
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
      const { delivered_quantity, delivered_by, notes } = req.body;

      const fuelRecord = await FuelConsumption.findById(id);

      if (!fuelRecord) {
        return res.status(404).json({
          success: false,
          message: 'Fuel request not found'
        });
      }

      await fuelRecord.markDelivered(delivered_quantity, delivered_by, notes);

      logger.info('Fuel delivered', {
        request_id: id,
        site: fuelRecord.site_id,
        quantity: delivered_quantity,
        delivered_by: delivered_by
      });

      res.json({
        success: true,
        message: 'Fuel delivery recorded',
        data: {
          site_id: fuelRecord.site_id,
          delivered_quantity: delivered_quantity,
          delivered_at: fuelRecord.delivery_info.delivered_at
        }
      });

    } catch (error) {
      logger.error('Mark fuel delivered error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to mark fuel as delivered'
      });
    }
  }
);

/**
 * Get consumption trends
 * GET /api/fuel/analytics/trends
 */
router.get('/analytics/trends',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { period = '30' } = req.query;

      const trends = await FuelConsumption.getConsumptionTrends(parseInt(period));

      res.json({
        success: true,
        data: {
          period_days: parseInt(period),
          trends: trends
        }
      });

    } catch (error) {
      logger.error('Get consumption trends error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch consumption trends'
      });
    }
  }
);

/**
 * Get sites with low fuel
 * GET /api/fuel/alerts/low-fuel
 */
router.get('/alerts/low-fuel',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { threshold = 25 } = req.query; // percentage

      // Get latest fuel record for each site
      const latestRecords = await FuelConsumption.aggregate([
        {
          $sort: { record_date: -1 }
        },
        {
          $group: {
            _id: '$site_id',
            latest: { $first: '$$ROOT' }
          }
        },
        {
          $replaceRoot: { newRoot: '$latest' }
        },
        {
          $match: {
            $expr: {
              $lt: [
                {
                  $multiply: [
                    { $divide: ['$fuel_data.closing_level', '$fuel_data.tank_capacity'] },
                    100
                  ]
                },
                parseInt(threshold)
              ]
            }
          }
        }
      ]);

      // Enrich with site details
      const enriched = await Promise.all(
        latestRecords.map(async (record) => {
          const site = await Site.findOne({ IHS_ID_SITE: record.site_id })
            .select('Site_Name Region GRATO_Cluster Technician_Name');

          const fuelPercentage = Math.round(
            (record.fuel_data.closing_level / record.fuel_data.tank_capacity) * 100
          );

          return {
            site_id: record.site_id,
            site_name: site?.Site_Name,
            region: site?.Region,
            cluster: site?.GRATO_Cluster,
            technician: site?.Technician_Name,
            fuel_level: record.fuel_data.closing_level,
            tank_capacity: record.fuel_data.tank_capacity,
            fuel_percentage: fuelPercentage,
            last_updated: record.record_date,
            urgency: fuelPercentage < 10 ? 'critical' : fuelPercentage < 20 ? 'high' : 'medium'
          };
        })
      );

      // Sort by urgency
      enriched.sort((a, b) => a.fuel_percentage - b.fuel_percentage);

      res.json({
        success: true,
        data: enriched,
        count: enriched.length
      });

    } catch (error) {
      logger.error('Get low fuel alerts error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch low fuel alerts'
      });
    }
  }
);

module.exports = router;