const ScheduledReport = require('../models/ScheduledReport');
const User = require('../models/User');
const { triggerReportNow } = require('../services/scheduledReportService');

/**
 * Create new scheduled report
 */
const createScheduledReport = async (req, res) => {
  try {
    const {
      name,
      description,
      reportType,
      frequency,
      customCron,
      schedule,
      filters,
      recipients,
      format,
      includeCharts
    } = req.body;

    // Validate required fields
    if (!name || !reportType || !frequency || !recipients || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, reportType, frequency, recipients'
      });
    }

    // Create scheduled report
    const scheduledReport = new ScheduledReport({
      name,
      description,
      reportType,
      frequency,
      customCron,
      schedule: schedule || { time: '08:00' },
      filters: filters || {},
      recipients,
      format: format || 'pdf',
      includeCharts: includeCharts !== undefined ? includeCharts : true,
      createdBy: req.user.userId
    });

    await scheduledReport.save();

    res.status(201).json({
      success: true,
      message: 'Scheduled report created successfully',
      data: scheduledReport
    });
  } catch (error) {
    console.error('Create scheduled report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create scheduled report',
      error: error.message
    });
  }
};

/**
 * Get all scheduled reports (with filters)
 */
const getScheduledReports = async (req, res) => {
  try {
    const { active, reportType, frequency, userId } = req.query;

    const filter = {};
    if (active !== undefined) filter.active = active === 'true';
    if (reportType) filter.reportType = reportType;
    if (frequency) filter.frequency = frequency;
    if (userId) filter.createdBy = userId;

    const reports = await ScheduledReport.find(filter)
      .populate('createdBy', 'fullName email department')
      .populate('lastModifiedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: reports,
      count: reports.length
    });
  } catch (error) {
    console.error('Get scheduled reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scheduled reports',
      error: error.message
    });
  }
};

/**
 * Get user's scheduled reports
 */
const getUserScheduledReports = async (req, res) => {
  try {
    const reports = await ScheduledReport.getUserReports(req.user.userId);

    res.json({
      success: true,
      data: reports,
      count: reports.length
    });
  } catch (error) {
    console.error('Get user scheduled reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user reports',
      error: error.message
    });
  }
};

/**
 * Get single scheduled report
 */
const getScheduledReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await ScheduledReport.findById(reportId)
      .populate('createdBy', 'fullName email department')
      .populate('lastModifiedBy', 'fullName email');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled report not found'
      });
    }

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Get scheduled report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scheduled report',
      error: error.message
    });
  }
};

/**
 * Update scheduled report
 */
const updateScheduledReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const updateData = req.body;

    const report = await ScheduledReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled report not found'
      });
    }

    // Check if user is the creator or admin
    if (report.createdBy.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update fields
    const allowedFields = [
      'name', 'description', 'frequency', 'customCron', 'schedule',
      'filters', 'recipients', 'format', 'includeCharts', 'active'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        report[field] = updateData[field];
      }
    });

    report.lastModifiedBy = req.user.userId;

    // Recalculate next run if frequency changed
    if (updateData.frequency || updateData.schedule) {
      report.nextRun = report.calculateNextRun();
    }

    await report.save();

    res.json({
      success: true,
      message: 'Scheduled report updated successfully',
      data: report
    });
  } catch (error) {
    console.error('Update scheduled report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update scheduled report',
      error: error.message
    });
  }
};

/**
 * Delete scheduled report
 */
const deleteScheduledReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await ScheduledReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled report not found'
      });
    }

    // Check if user is the creator or admin
    if (report.createdBy.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await ScheduledReport.findByIdAndDelete(reportId);

    res.json({
      success: true,
      message: 'Scheduled report deleted successfully'
    });
  } catch (error) {
    console.error('Delete scheduled report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete scheduled report',
      error: error.message
    });
  }
};

/**
 * Manually trigger a scheduled report
 */
const triggerReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    const result = await triggerReportNow(reportId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Report triggered and sent successfully',
        data: {
          nextRun: result.nextRun
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Report execution failed',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Trigger report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger report',
      error: error.message
    });
  }
};

/**
 * Toggle scheduled report active status
 */
const toggleReportStatus = async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await ScheduledReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled report not found'
      });
    }

    report.active = !report.active;
    report.lastModifiedBy = req.user.userId;

    if (report.active) {
      report.nextRun = report.calculateNextRun();
    }

    await report.save();

    res.json({
      success: true,
      message: `Report ${report.active ? 'activated' : 'deactivated'} successfully`,
      data: report
    });
  } catch (error) {
    console.error('Toggle report status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle report status',
      error: error.message
    });
  }
};

/**
 * Get scheduled report statistics
 */
const getReportStatistics = async (req, res) => {
  try {
    const stats = await ScheduledReport.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ['$active', true] }, 1, 0] }
          },
          inactive: {
            $sum: { $cond: [{ $eq: ['$active', false] }, 1, 0] }
          },
          totalRuns: { $sum: '$runCount' }
        }
      }
    ]);

    const byType = await ScheduledReport.aggregate([
      {
        $group: {
          _id: '$reportType',
          count: { $sum: 1 }
        }
      }
    ]);

    const byFrequency = await ScheduledReport.aggregate([
      {
        $group: {
          _id: '$frequency',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        summary: stats[0] || { total: 0, active: 0, inactive: 0, totalRuns: 0 },
        byType,
        byFrequency
      }
    });
  } catch (error) {
    console.error('Get report statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};

module.exports = {
  createScheduledReport,
  getScheduledReports,
  getUserScheduledReports,
  getScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  triggerReport,
  toggleReportStatus,
  getReportStatistics
};