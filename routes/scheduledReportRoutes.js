const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const {
  createScheduledReport,
  getScheduledReports,
  getUserScheduledReports,
  getScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  triggerReport,
  toggleReportStatus,
  getReportStatistics
} = require('../controllers/scheduledReportController');

/**
 * @route   POST /api/scheduled-reports
 * @desc    Create new scheduled report
 * @access  Private (Finance, Admin)
 */
router.post(
  '/',
  authMiddleware,
  requireRoles('finance', 'admin'),
  createScheduledReport
);

/**
 * @route   GET /api/scheduled-reports
 * @desc    Get all scheduled reports (with filters)
 * @access  Private (Finance, Admin)
 */
router.get(
  '/',
  authMiddleware,
  requireRoles('finance', 'admin'),
  getScheduledReports
);

/**
 * @route   GET /api/scheduled-reports/my-reports
 * @desc    Get current user's scheduled reports
 * @access  Private
 */
router.get(
  '/my-reports',
  authMiddleware,
  getUserScheduledReports
);

/**
 * @route   GET /api/scheduled-reports/statistics
 * @desc    Get scheduled report statistics
 * @access  Private (Finance, Admin)
 */
router.get(
  '/statistics',
  authMiddleware,
  requireRoles('finance', 'admin'),
  getReportStatistics
);

/**
 * @route   GET /api/scheduled-reports/:reportId
 * @desc    Get single scheduled report
 * @access  Private
 */
router.get(
  '/:reportId',
  authMiddleware,
  getScheduledReport
);

/**
 * @route   PUT /api/scheduled-reports/:reportId
 * @desc    Update scheduled report
 * @access  Private (Creator or Admin)
 */
router.put(
  '/:reportId',
  authMiddleware,
  updateScheduledReport
);

/**
 * @route   DELETE /api/scheduled-reports/:reportId
 * @desc    Delete scheduled report
 * @access  Private (Creator or Admin)
 */
router.delete(
  '/:reportId',
  authMiddleware,
  deleteScheduledReport
);

/**
 * @route   POST /api/scheduled-reports/:reportId/trigger
 * @desc    Manually trigger a scheduled report
 * @access  Private (Finance, Admin)
 */
router.post(
  '/:reportId/trigger',
  authMiddleware,
  requireRoles('finance', 'admin'),
  triggerReport
);

/**
 * @route   POST /api/scheduled-reports/:reportId/toggle
 * @desc    Toggle scheduled report active status
 * @access  Private (Creator or Admin)
 */
router.post(
  '/:reportId/toggle',
  authMiddleware,
  toggleReportStatus
);

module.exports = router;