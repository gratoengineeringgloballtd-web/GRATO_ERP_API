const express = require('express');
const router = express.Router();
const FuelConsumption = require('../models/FuelConsumption');
const Site = require('../models/Site');
const Generator = require('../models/Generator');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Diesel Manager Dashboard
 * GET /api/fuel/dashboard
 */
router.get('/dashboard',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { period = '30' } = req.query;
      const days = parseInt(period);
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [
        totalSites,
        pendingRequests,
        approvedRequests,
        totalConsumed,
        totalAdded,
        anomalies,
        criticalSites
      ] = await Promise.all([
        FuelConsumption.distinct('site_id', {
          record_date: { $gte: startDate }
        }).then(sites => sites.length),
        
        FuelConsumption.countDocuments({
          approval_status: 'pending',
          'request_info.fuel_requested': { $gt: 0 }
        }),
        
        FuelConsumption.countDocuments({
          approval_status: 'approved',
          record_date: { $gte: startDate }
        }),
        
        FuelConsumption.aggregate([
          { $match: { record_date: { $gte: startDate } } },
          { $group: { _id: null, total: { $sum: '$fuel_data.fuel_consumed' } } }
        ]).then(r => r[0]?.total || 0),
        
        FuelConsumption.aggregate([
          { $match: { record_date: { $gte: startDate } } },
          { $group: { _id: null, total: { $sum: '$fuel_data.fuel_added' } } }
        ]).then(r => r[0]?.total || 0),
        
        FuelConsumption.countDocuments({
          record_date: { $gte: startDate },
          'metrics.anomaly_detected': true
        }),
        
        // Sites with low fuel (less than 20%)
        FuelConsumption.aggregate([
          {
            $match: {
              record_date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            }
          },
          { $sort: { record_date: -1 } },
          {
            $group: {
              _id: '$site_id',
              latest: { $first: '$$ROOT' }
            }
          },
          {
            $match: {
              $expr: {
                $lt: [
                  { $divide: ['$latest.fuel_data.closing_level', '$latest.fuel_data.tank_capacity'] },
                  0.2
                ]
              }
            }
          },
          { $count: 'count' }
        ]).then(r => r[0]?.count || 0)
      ]);

      const avgConsumptionRate = totalConsumed > 0 && totalAdded > 0 
        ? Math.round((totalConsumed / days) * 10) / 10 
        : 0;

      res.json({
        success: true,
        data: {
          period_days: days,
          overview: {
            total_sites_monitored: totalSites,
            pending_requests: pendingRequests,
            approved_requests: approvedRequests,
            critical_sites: criticalSites,
            anomalies_detected: anomalies
          },
          fuel_stats: {
            total_consumed_liters: Math.round(totalConsumed),
            total_added_liters: Math.round(totalAdded),
            avg_daily_consumption: avgConsumptionRate,
            net_balance: Math.round(totalAdded - totalConsumed)
          }
        }
      });

    } catch (error) {
      logger.error('Diesel manager dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard data'
      });
    }
  }
);


/**
 * Get scheduled/approved maintenance for diesel manager
 * GET /api/fuel/maintenance/scheduled
 */
router.get('/maintenance/scheduled',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const managerId = req.user._id || req.user.userId;
      const { page = 1, limit = 20, status } = req.query;

      const query = {
        supervisor: managerId
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

      const Maintenance = require('../models/Maintenance');
      const scheduled = await Maintenance.find(query)
        .populate('technician', 'fullName email phone')
        .populate('parts_used.part_id', 'name part_number')
        .sort({ visit_date: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      const enriched = await Promise.all(
        scheduled.map(async (m) => {
          const site = await Site.findOne({ IHS_ID_SITE: m.site_id })
            .select('Site_Name Region GRATO_Cluster')
            .lean();
          return { ...m, site_details: site };
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
      res.status(500).json({ success: false, error: 'Failed to fetch scheduled maintenance' });
    }
  }
);


/**
 * Schedule a fuel maintenance task
 * POST /api/fuel/fuel-requests
 */
router.post('/fuel-requests',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  [
    body('technician').notEmpty().withMessage('Technician is required'),
    body().custom((value, { req }) => {
      if (!req.body.site_id) throw new Error('Site ID is required');
      return true;
    }),
    body().custom((value, { req }) => {
      if (!req.body.type && !req.body.visit_type) throw new Error('Visit type is required');
      return true;
    }),
    body().custom((value, { req }) => {
      if (!req.body.scheduled_date && !req.body.visit_date) throw new Error('Scheduled date is required');
      return true;
    }),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical', 'Low', 'Medium', 'High', 'Critical'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { technician, priority, notes, estimated_duration } = req.body;
      const targetSiteId = req.body.site_id;
      const targetDateStr = req.body.scheduled_date || req.body.visit_date;
      let targetType = req.body.type || req.body.visit_type;

      if (req.body.type && !req.body.visit_type) {
        if (targetType === 'routine') targetType = 'PM';
        else if (targetType === 'repair') targetType = 'END';
        else if (targetType === 'inspection') targetType = 'PM';
        else if (targetType === 'emergency') targetType = 'END';
        else if (targetType === 'RF') targetType = 'RF';
        else targetType = 'PM';
      }

      const managerId = req.user._id || req.user.userId;
      const User = require('../models/User');
      const technicianUser = await User.findById(technician);
      if (!technicianUser) {
        return res.status(404).json({ success: false, message: 'Technician not found' });
      }

      const site = await Site.findOne({ $or: [{ IHS_ID_SITE: targetSiteId }, { _id: targetSiteId }] });
      if (!site) {
        return res.status(404).json({ success: false, message: 'Site not found' });
      }

      const scheduleDateObj = new Date(targetDateStr);
      const Maintenance = require('../models/Maintenance');
      const maintenance = new Maintenance({
        maintenance_id: `MAINT_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        site_id: site.IHS_ID_SITE,
        site_name: site.Site_Name,
        technician,
        technician_name: technicianUser.fullName,
        supervisor: managerId,
        created_by: managerId,
        visit_type: targetType,
        visit_date: scheduleDateObj,
        scheduled_date: scheduleDateObj,
        priority: priority || 'medium',
        status: 'scheduled',
        is_draft: false,
        estimated_duration: estimated_duration || '',
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

      try {
        const Notification = require('../models/Notifications');
        await Notification.create({
          recipient: technician,
          type: 'task_assigned',
          title: 'New Fuel Task Assigned',
          message: `You have been assigned a ${targetType} fuel task at ${site.Site_Name || site.IHS_ID_SITE} scheduled for ${scheduleDateObj.toLocaleDateString()}`,
          data: {
            maintenanceId: maintenance._id,
            siteId: site.IHS_ID_SITE,
            siteName: site.Site_Name,
            additionalData: { type: targetType, scheduledDate: targetDateStr, priority: priority || 'medium', estimated_duration: estimated_duration || '' }
          },
          priority: priority || 'medium',
          read: false
        });
      } catch (notifError) {
        logger.error('Failed to create notification:', notifError);
      }

      res.status(201).json({ success: true, message: 'Fuel maintenance scheduled successfully', data: maintenance });
    } catch (error) {
      logger.error('Schedule fuel maintenance error:', error);
      res.status(500).json({ success: false, error: 'Failed to schedule fuel maintenance', message: error.message });
    }
  }
);


/**
 * Get fuel consumption for all sites
 * GET /api/fuel/consumption/by-site/all
 */
router.get('/consumption/by-site/all',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { days = '30' } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      const records = await FuelConsumption.find({ record_date: { $gte: startDate } })
        .populate('recorded_by', 'fullName')
        .sort({ record_date: -1 });
      res.json({ success: true, data: records, count: records.length });
    } catch (error) {
      logger.error('Get all sites fuel consumption error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch all sites fuel consumption data' });
    }
  }
);


/**
 * Get all technicians
 * GET /api/fuel/technicians
 */
router.get('/technicians',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { region } = req.query;
      const query = { role: { $in: ['technician', 'fuel', 'ac'] } };
      if (region) query.Region = region;
      const users = await require('../models/User').find(query)
        .select('fullName email phone specializations assignedClusters assignedTowers isActive isOnline Region role')
        .lean();
      res.status(200).json({ success: true, data: users, count: users.length });
    } catch (error) {
      logger.error('Diesel manager fetch technicians error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch technicians', message: error.message });
    }
  }
);


/**
 * Get all sites
 * GET /api/fuel/sites
 */
router.get('/sites',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor', 'technician', 'fuel']),
  async (req, res) => {
    try {
      const { region, priority } = req.query;
      const query = {};
      if (region) query.Region = region;
      if (priority) query.Sites_Priority = priority;
      const sites = await Site.find(query)
        .populate('Current_Generators', 'model serial_number status')
        .select('IHS_ID_SITE Site_Name Region Sites_Priority Actual_Date_Visit Type_of_Visit Current_Generators Technician_Name GRATO_Cluster Fuel_Quantity_Found Tank_Capacity_1 Latitude Longitude')
        .sort({ Actual_Date_Visit: -1 })
        .lean();
      const enrichedSites = sites.map(site => {
        const lastVisit = site.Actual_Date_Visit ? new Date(site.Actual_Date_Visit) : null;
        const daysSinceVisit = lastVisit ? Math.floor((new Date() - lastVisit) / (1000 * 60 * 60 * 24)) : null;
        // Schema field is Tank_Capacity_1 — alias to Tank_Capacity for
        // API-contract stability with existing frontend consumers.
        return { ...site, Tank_Capacity: site.Tank_Capacity_1, daysSinceLastVisit: daysSinceVisit, needsVisit: daysSinceVisit && daysSinceVisit > 90, generatorCount: site.Current_Generators?.length || 0 };
      });
      res.status(200).json({ success: true, data: enrichedSites, count: enrichedSites.length });
    } catch (error) {
      logger.error('Diesel manager fetch sites error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch sites', message: error.message });
    }
  }
);


/**
 * Get fuel consumption by site
 * GET /api/fuel/consumption/site/:siteId
 */
router.get('/consumption/site/:siteId',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor']),
  async (req, res) => {
    try {
      const { siteId } = req.params;
      const { days = '30' } = req.query;
      const endDate   = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const summary = await FuelConsumption.getSiteSummary(siteId, startDate, endDate);
      if (!summary) {
        return res.status(404).json({ success: false, message: 'No fuel data found for this site' });
      }
      const records = await FuelConsumption.find({ site_id: siteId, record_date: { $gte: startDate } })
        .populate('recorded_by', 'fullName')
        .sort({ record_date: -1 })
        .limit(100);
      res.json({ success: true, data: { summary, records } });
    } catch (error) {
      logger.error('Get site fuel consumption error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch fuel consumption data' });
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
        .limit(parseInt(limit))
        .lean();
      const enriched = await Promise.all(
        requests.map(async (r) => {
          const site = await Site.findOne({ IHS_ID_SITE: r.site_id })
            .select('Site_Name Region GRATO_Cluster')
            .lean();
          return { ...r, site_details: site, days_pending: r.request_info?.requested_at ? Math.floor((Date.now() - new Date(r.request_info.requested_at)) / (1000 * 60 * 60 * 24)) : 0 };
        })
      );
      const total = await FuelConsumption.countDocuments({
        approval_status: 'pending',
        $or: [{ 'request_info.fuel_requested': { $gt: 0 } }, { 'fuel_data.fuel_added': { $gt: 0 } }],
        ...(urgency && { 'request_info.request_urgency': urgency })
      });
      res.json({ success: true, data: enriched, pagination: { current: parseInt(page), pageSize: parseInt(limit), total, pages: Math.ceil(total / limit) } });
    } catch (error) {
      logger.error('Get pending fuel requests error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch pending requests' });
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
  [body('notes').optional().isString()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
      const { id } = req.params;
      const { notes } = req.body;
      const approverId = req.user.userId;
      const fuelRecord = await FuelConsumption.findById(id).populate('request_info.requested_by', 'fullName email');
      if (!fuelRecord) return res.status(404).json({ success: false, message: 'Fuel request not found' });
      await fuelRecord.approveRequest(approverId, notes);
      logger.info('Fuel request approved', { fuel_record_id: id, site: fuelRecord.site_id, approved_by: approverId });
      res.json({ success: true, message: 'Fuel request approved', data: { site_id: fuelRecord.site_id, site_name: fuelRecord.site_name, approved_quantity: fuelRecord.request_info?.fuel_requested, approval_status: fuelRecord.approval_status, approved_at: fuelRecord.approved_at } });
    } catch (error) {
      logger.error('Approve fuel request error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to approve fuel request' });
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
  [body('reason').notEmpty().withMessage('Rejection reason required').isLength({ min: 10, max: 500 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
      const { id } = req.params;
      const { reason } = req.body;
      const approverId = req.user.userId;
      const fuelRecord = await FuelConsumption.findById(id).populate('request_info.requested_by', 'fullName email');
      if (!fuelRecord) return res.status(404).json({ success: false, message: 'Fuel request not found' });
      await fuelRecord.rejectRequest(approverId, reason);
      logger.info('Fuel request rejected', { fuel_record_id: id, site: fuelRecord.site_id, rejected_by: approverId, reason });
      res.json({ success: true, message: 'Fuel request rejected', data: { site_id: fuelRecord.site_id, site_name: fuelRecord.site_name, approval_status: fuelRecord.approval_status, rejection_reason: fuelRecord.rejection_reason } });
    } catch (error) {
      logger.error('Reject fuel request error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to reject fuel request' });
    }
  }
);


/**
 * Get fuel consumption trends
 * GET /api/fuel/analytics/trends
 */
router.get('/analytics/trends',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { days = '30', groupBy = 'daily' } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      const groupFormat = groupBy === 'daily' ? '%Y-%m-%d' : groupBy === 'weekly' ? '%Y-W%U' : '%Y-%m';
      const trends = await FuelConsumption.aggregate([
        { $match: { record_date: { $gte: startDate } } },
        { $group: {
          _id: { $dateToString: { format: groupFormat, date: '$record_date' } },
          total_consumed: { $sum: '$fuel_data.fuel_consumed' },
          total_added:    { $sum: '$fuel_data.fuel_added' },
          total_runtime:  { $sum: '$runtime_data.runtime_hours' },
          avg_consumption_rate: { $avg: '$metrics.consumption_rate' },
          sites_count: { $addToSet: '$site_id' }
        }},
        { $project: {
          date: '$_id',
          total_consumed: { $round: ['$total_consumed', 2] },
          total_added:    { $round: ['$total_added', 2] },
          total_runtime:  { $round: ['$total_runtime', 2] },
          avg_consumption_rate: { $round: ['$avg_consumption_rate', 2] },
          sites_count: { $size: '$sites_count' }
        }},
        { $sort: { date: 1 } }
      ]);
      res.json({ success: true, data: { period_days: parseInt(days), group_by: groupBy, trends } });
    } catch (error) {
      logger.error('Get fuel trends error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch fuel trends' });
    }
  }
);


/**
 * Get fuel anomalies
 * GET /api/fuel/analytics/anomalies
 */
router.get('/analytics/anomalies',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { days = '7' } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      // detectAnomalies is not defined as a static on FuelConsumption.
      // Implemented inline here to avoid any dependency on a missing static method.
      const anomalyRecords = await FuelConsumption.find({
        record_date: { $gte: startDate },
        'metrics.anomaly_detected': true
      }).sort({ record_date: -1 }).lean();

      const enriched = await Promise.all(
        anomalyRecords.map(async (a) => {
          const site = await Site.findOne({ IHS_ID_SITE: a.site_id })
            .select('Site_Name Region GRATO_Cluster')
            .lean();
          return { ...a, site_details: site };
        })
      );

      res.json({ success: true, data: enriched, count: enriched.length });
    } catch (error) {
      logger.error('Get fuel anomalies error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch fuel anomalies' });
    }
  }
);


/**
 * LOW FUEL ALERTS  ← was missing, causing the 404
 * GET /api/fuel/alerts/low-fuel
 */
router.get('/alerts/low-fuel',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { threshold = 25 } = req.query;  // percentage of tank capacity

      const latestRecords = await FuelConsumption.aggregate([
        { $sort: { record_date: -1 } },
        {
          $group: {
            _id: '$site_id',
            latest: { $first: '$$ROOT' }
          }
        },
        { $replaceRoot: { newRoot: '$latest' } },
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

      const enriched = await Promise.all(
        latestRecords.map(async (record) => {
          const site = await Site.findOne({ IHS_ID_SITE: record.site_id })
            .select('Site_Name Region GRATO_Cluster Technician_Name')
            .lean();

          const fuelPercentage = record.fuel_data.tank_capacity > 0
            ? Math.round((record.fuel_data.closing_level / record.fuel_data.tank_capacity) * 100)
            : 0;

          return {
            site_id:       record.site_id,
            site_name:     site?.Site_Name,
            region:        site?.Region,
            cluster:       site?.GRATO_Cluster,
            technician:    site?.Technician_Name,
            fuel_level:    record.fuel_data.closing_level,
            tank_capacity: record.fuel_data.tank_capacity,
            fuel_percentage: fuelPercentage,
            last_updated:  record.record_date,
            urgency:       fuelPercentage < 10 ? 'critical' : fuelPercentage < 20 ? 'high' : 'medium'
          };
        })
      );

      enriched.sort((a, b) => a.fuel_percentage - b.fuel_percentage);

      res.json({ success: true, data: enriched, count: enriched.length });

    } catch (error) {
      logger.error('Get low fuel alerts error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch low fuel alerts' });
    }
  }
);


/**
 * Create a new fuel consumption record
 * POST /api/fuel/record
 */
router.post('/record',
  authenticateToken,
  [
    body('site_id').notEmpty().withMessage('Site ID is required'),
    body('opening_level').isNumeric().withMessage('Opening level must be a number'),
    body('closing_level').isNumeric().withMessage('Closing level must be a number'),
    body('fuel_added').optional().isNumeric(),
    body('tank_capacity').isNumeric().withMessage('Tank capacity is required'),
    body('runtime_hours').optional().isNumeric()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const {
        site_id, site_name, generator_id,
        opening_level, closing_level, fuel_added = 0, fuel_price,
        tank_capacity, opening_hours, closing_hours, runtime_hours,
        workflow_status, workflow_history, workflow_last_updated,
        ...rest
      } = req.body;

      const fuel_consumed = Math.max(0, (parseFloat(opening_level) + parseFloat(fuel_added)) - parseFloat(closing_level));
      let consumption_rate = 0;
      let calculated_runtime = runtime_hours;
      if (!calculated_runtime && opening_hours !== undefined && closing_hours !== undefined) {
        calculated_runtime = parseFloat(closing_hours) - parseFloat(opening_hours);
      }
      if (calculated_runtime > 0) consumption_rate = fuel_consumed / calculated_runtime;

      const newRecord = new FuelConsumption({
        site_id, site_name, generator_id,
        record_date: new Date(),
        fuel_data: { opening_level, closing_level, fuel_added, fuel_consumed, tank_capacity, fuel_type: 'diesel' },
        runtime_data: { opening_hours, closing_hours, runtime_hours: calculated_runtime },
        metrics: { consumption_rate, cost_estimate: fuel_price ? (fuel_consumed * fuel_price) : 0 },
        recorded_by: req.user.userId,
        workflow_status: 'completed',
        workflow_history: [
          ...(Array.isArray(workflow_history) ? workflow_history : []),
          { status: 'completed', timestamp: new Date(), meta: { auto: true } }
        ],
        workflow_last_updated: new Date(),
        refuel_submitted: true,
        ...rest
      });

      await newRecord.save();

      if (site_id) {
        await Site.findOneAndUpdate(
          { IHS_ID_SITE: site_id },
          { 'fuel_status.current_level': closing_level },
          { new: true }
        ).catch(err => logger.error('Failed to update site fuel level', err));
      }

      res.status(201).json({ success: true, message: 'Fuel record created successfully', data: newRecord });
    } catch (error) {
      logger.error('Create fuel record error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to create fuel record' });
    }
  }
);


/**
 * Update workflow status
 * PATCH /api/fuel/record/:id/status
 */
router.patch('/record/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, meta } = req.body;
    const record = await FuelConsumption.findById(id);
    if (!record) return res.status(404).json({ success: false, error: 'Record not found' });
    const already = record.workflow_history.find(h => h.status === status);
    if (!already) {
      record.workflow_history.push({ status, timestamp: new Date(), meta: meta || {} });
      record.workflow_status = status;
      record.workflow_last_updated = new Date();
      await record.save();
    }
    res.json({ success: true, data: record });
  } catch (error) {
    logger.error('Update workflow status error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update workflow status' });
  }
});


module.exports = router;





