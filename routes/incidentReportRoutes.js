const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const IncidentReport = require('../models/IncidentReport');

const {
  // Core functions
  createIncidentReport,
  getIncidentReportDetails,
  
  // Employee functions
  getEmployeeIncidentReports,
  
  // HSE Management functions
  getHSEIncidentReports,
  updateIncidentStatus,
  startInvestigation,
  completeInvestigation,
  addCorrectiveAction,
  addPreventiveAction,
  updateActionStatus,
  resolveIncident,
  addHSEUpdate,
  getHSEDashboardStats,
  
  // Role-based view
  getIncidentReportsByRole,
  getIncidentDashboardStats

} = require('../controllers/incidentReportController');

// ==========================================
// IMPORTANT: Specific routes MUST come BEFORE parameterized routes (:reportId)
// ==========================================

/**
 * @route   POST /api/incident-reports
 * @desc    Create new incident report
 * @access  Private (All authenticated users)
 */
router.post(
  '/',
  authMiddleware,
  upload.array('attachments', 10),
  createIncidentReport
);


/**
 * @route   GET /api/incident-reports/role/view
 * @desc    Get incidents based on user role
 * @access  Private
 */
router.get(
  '/role/view',
  authMiddleware,
  getIncidentReportsByRole
);

/**
 * @route   GET /api/incident-reports/dashboard-stats
 * @desc    Get incident statistics for dashboard
 * @access  Private (All authenticated users)
 */
router.get(
  '/dashboard-stats',
  authMiddleware,
  getIncidentDashboardStats
);


/**
 * @route   GET /api/incident-reports/download/:filename
 * @desc    Download incident attachment file
 * @access  Private (Authenticated users with access to the incident)
 */
router.get(
  '/download/:filename',
  authMiddleware,
  async (req, res) => {
    try {
      const { filename } = req.params;
      const filePath = path.join(__dirname, '../uploads/incidents', filename);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: 'File not found'
        });
      }

      // Find incident report with this attachment to verify access
      const report = await IncidentReport.findOne({
        'attachments.publicId': filename
      }).populate('employee', 'fullName email department');

      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found in any incident report'
        });
      }

      // Check permissions
      const user = await User.findById(req.user.userId);
      const canDownload = 
        report.employee._id.toString() === req.user.userId.toString() || // Owner
        user.role === 'admin' || // Admin
        user.role === 'hse' || // HSE
        user.role === 'hr' || // HR
        (user.role === 'supervisor' && report.department === user.department); // Supervisor

      if (!canDownload) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to download this file'
        });
      }

      // Get the original filename
      const attachment = report.attachments.find(a => a.publicId === filename);
      const originalName = attachment ? attachment.name : filename;

      // Set headers for download
      res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
      res.setHeader('Content-Type', attachment?.mimetype || 'application/octet-stream');

      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        res.status(500).json({
          success: false,
          message: 'Error downloading file'
        });
      });

    } catch (error) {
      console.error('Download file error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download file',
        error: error.message
      });
    }
  }
);


// ==========================================
// ROLE-BASED VIEW ROUTES (Must come BEFORE /:reportId)
// ==========================================

/**
 * @route   GET /api/incident-reports/dashboard-stats
 * @desc    Get incident statistics for dashboard
 * @access  Private (All authenticated users)
 */
router.get(
  '/dashboard-stats',
  authMiddleware,
  getIncidentDashboardStats
);

// ==========================================
// EMPLOYEE ROUTES (Must come BEFORE /:reportId)
// ==========================================

/**
 * @route   GET /api/incident-reports/employee/my-reports
 * @desc    Get employee's own incident reports
 * @access  Private (Employee)
 */
router.get(
  '/employee/my-reports',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  getEmployeeIncidentReports
);

/**
 * @route   GET /api/incident-reports/employee
 * @desc    Alias for employee's own reports
 * @access  Private (Employee)
 */
router.get(
  '/employee',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  getEmployeeIncidentReports
);

// ==========================================
// HSE COORDINATOR ROUTES (Must come BEFORE /:reportId)
// ==========================================

/**
 * @route   GET /api/incident-reports/hse/dashboard
 * @desc    Get HSE dashboard statistics
 * @access  Private (HSE, Admin)
 */
router.get(
  '/hse/dashboard',
  authMiddleware,
  requireRoles('hse', 'admin'),
  getHSEDashboardStats
);

/**
 * @route   GET /api/incident-reports/hse/all
 * @desc    Get all incident reports for HSE management
 * @access  Private (HSE, Admin)
 */
router.get(
  '/hse/all',
  authMiddleware,
  requireRoles('hse', 'admin'),
  getHSEIncidentReports
);

/**
 * @route   GET /api/incident-reports/hse
 * @desc    Alias for HSE reports
 * @access  Private (HSE, Admin)
 */
router.get(
  '/hse',
  authMiddleware,
  requireRoles('hse', 'admin'),
  getHSEIncidentReports
);

// ==========================================
// SUPERVISOR/HR/ADMIN ROUTES (Must come BEFORE /:reportId)
// ==========================================

/**
 * @route   GET /api/incident-reports/supervisor/view
 * @desc    View department incidents (supervisor awareness)
 * @access  Private (Supervisor, Admin)
 */
router.get(
  '/supervisor/view',
  authMiddleware,
  requireRoles('technical', 'admin'),
  getIncidentReportsByRole
);

/**
 * @route   GET /api/incident-reports/supervisor
 * @desc    Alias for supervisor view
 * @access  Private (Supervisor, Admin)
 */
router.get(
  '/supervisor',
  authMiddleware,
  requireRoles('supervisor', 'admin'),
  getIncidentReportsByRole
);

/**
 * @route   GET /api/incident-reports/hr/view
 * @desc    View all incidents (HR awareness)
 * @access  Private (HR, Admin)
 */
router.get(
  '/hr/view',
  authMiddleware,
  requireRoles('hr', 'admin'),
  getIncidentReportsByRole
);

/**
 * @route   GET /api/incident-reports/hr
 * @desc    Alias for HR view
 * @access  Private (HR, Admin)
 */
router.get(
  '/hr',
  authMiddleware,
  requireRoles('hr', 'admin'),
  getIncidentReportsByRole
);

/**
 * @route   GET /api/incident-reports/admin/all
 * @desc    View all incidents (Admin)
 * @access  Private (Admin only)
 */
router.get(
  '/admin/all',
  authMiddleware,
  requireRoles('admin'),
  getIncidentReportsByRole
);

/**
 * @route   GET /api/incident-reports/admin
 * @desc    Alias for admin view
 * @access  Private (Admin only)
 */
router.get(
  '/admin',
  authMiddleware,
  requireRoles('admin'),
  getIncidentReportsByRole
);

// ==========================================
// PARAMETERIZED ROUTES (Must come AFTER all specific routes)
// ==========================================

/**
 * @route   PATCH /api/incident-reports/:reportId/status
 * @desc    Update incident status
 * @access  Private (HSE, Admin)
 */
router.patch(
  '/:reportId/status',
  authMiddleware,
  requireRoles('hse', 'admin'),
  updateIncidentStatus
);

/**
 * @route   POST /api/incident-reports/:reportId/investigation/start
 * @desc    Start investigation
 * @access  Private (HSE, Admin)
 */
router.post(
  '/:reportId/investigation/start',
  authMiddleware,
  requireRoles('hse', 'admin'),
  startInvestigation
);

/**
 * @route   POST /api/incident-reports/:reportId/investigation/complete
 * @desc    Complete investigation
 * @access  Private (HSE, Admin)
 */
router.post(
  '/:reportId/investigation/complete',
  authMiddleware,
  requireRoles('hse', 'admin'),
  completeInvestigation
);

/**
 * @route   POST /api/incident-reports/:reportId/corrective-action
 * @desc    Add corrective action
 * @access  Private (HSE, Admin)
 */
router.post(
  '/:reportId/corrective-action',
  authMiddleware,
  requireRoles('hse', 'admin'),
  addCorrectiveAction
);

/**
 * @route   POST /api/incident-reports/:reportId/preventive-action
 * @desc    Add preventive action
 * @access  Private (HSE, Admin)
 */
router.post(
  '/:reportId/preventive-action',
  authMiddleware,
  requireRoles('hse', 'admin'),
  addPreventiveAction
);

/**
 * @route   PATCH /api/incident-reports/:reportId/action/:actionId
 * @desc    Update action status (corrective or preventive)
 * @access  Private (HSE, Admin, or assigned person)
 */
router.patch(
  '/:reportId/action/:actionId',
  authMiddleware,
  updateActionStatus
);

/**
 * @route   POST /api/incident-reports/:reportId/resolve
 * @desc    Resolve incident
 * @access  Private (HSE, Admin)
 */
router.post(
  '/:reportId/resolve',
  authMiddleware,
  requireRoles('hse', 'admin'),
  resolveIncident
);

/**
 * @route   POST /api/incident-reports/:reportId/update
 * @desc    Add HSE update/comment
 * @access  Private (HSE, Admin)
 */
router.post(
  '/:reportId/update',
  authMiddleware,
  requireRoles('hse', 'admin'),
  addHSEUpdate
);

/**
 * @route   GET /api/incident-reports/:reportId
 * @desc    Get single incident report details (MUST BE LAST)
 * @access  Private (Report owner, HSE, HR, Admin, Supervisor)
 */
router.get(
  '/:reportId',
  authMiddleware,
  getIncidentReportDetails
);

module.exports = router;





