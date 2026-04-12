const express = require('express');
const router = express.Router();
const hrController = require('../controllers/hrController');
const hrFileController = require('../controllers/hrFileController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const { handleMulterError, validateFiles, cleanupTempFiles } = require('../middlewares/uploadMiddleware');

// Protect all routes - only HR and Admin
router.use(authMiddleware);
router.use(requireRoles('hr', 'admin'));

// ============================================
// EMPLOYEE MANAGEMENT ROUTES
// ============================================

// Statistics and Analytics
router.get('/employees/statistics', hrController.getStatistics);

// Export employees to Excel
router.get('/employees/export', hrController.exportEmployees);

// Employee-specific data
router.get('/employees/:id/leave-balance', hrController.getEmployeeLeaveBalance);
router.get('/employees/:id/performance', hrController.getEmployeePerformance);

// CRUD operations
router.get('/employees', hrController.getEmployees);
router.get('/employees/:id', hrController.getEmployee);
router.post('/employees', hrController.createEmployee);
router.put('/employees/:id', hrController.updateEmployee);
router.patch('/employees/:id/status', hrController.updateEmployeeStatus);
router.delete('/employees/:id', hrController.deactivateEmployee);

// ============================================
// DOCUMENT MANAGEMENT ROUTES - ENHANCED
// ============================================

// Upload document with enhanced error handling
router.post(
  '/employees/:id/documents/:type',
  (req, res, next) => {
    console.log('\n=== HR DOCUMENT UPLOAD INITIATED ===');
    console.log('Employee ID:', req.params.id);
    console.log('Document Type:', req.params.type);
    console.log('User:', req.user?.userId);
    console.log('Content-Type:', req.headers['content-type']);
    next();
  },
  upload.single('document'),
  handleMulterError,
  validateFiles,
  (req, res, next) => {
    if (req.file) {
      console.log('✓ File received:', req.file.originalname, `(${(req.file.size / 1024).toFixed(2)} KB)`);
      console.log('  Temp path:', req.file.path);
      console.log('  MIME type:', req.file.mimetype);
    } else {
      console.log('⚠️  No file received');
    }
    next();
  },
  hrController.uploadDocument,
  cleanupTempFiles
);

// Get document information (metadata only)
router.get('/employees/:id/documents/:type/info', hrController.getDocumentInfo);

// Download document (legacy endpoint - kept for backward compatibility)
router.get('/employees/:id/documents/:type', hrController.downloadDocument);

// Delete document
router.delete('/employees/:id/documents/:docId', hrController.deleteDocument);

// ============================================
// NEW: ENHANCED DOCUMENT FILE ROUTES
// ============================================

// Download document by publicId (preferred method)
router.get(
  '/documents/:employeeId/download/:publicId',
  (req, res, next) => {
    console.log('\n=== HR DOCUMENT DOWNLOAD (publicId) ===');
    console.log('Employee ID:', req.params.employeeId);
    console.log('Public ID:', req.params.publicId);
    next();
  },
  hrFileController.downloadHRDocument
);

// View document inline (for PDFs and images)
router.get(
  '/documents/:employeeId/view/:publicId',
  (req, res, next) => {
    console.log('\n=== HR DOCUMENT VIEW (publicId) ===');
    console.log('Employee ID:', req.params.employeeId);
    console.log('Public ID:', req.params.publicId);
    next();
  },
  hrFileController.viewHRDocument
);

// Get document metadata without downloading
router.get(
  '/documents/:employeeId/info/:publicId',
  hrFileController.getHRDocumentInfo
);

// ============================================
// CONTRACT MANAGEMENT ROUTES
// ============================================

// Get contracts expiring soon
router.get('/contracts/expiring', hrController.getExpiringContracts);

// Request contract renewal (HR only)
router.post('/contracts/:id/renew', hrController.requestContractRenewal);

// Approve/reject contract renewal (Admin only)
router.put(
  '/contracts/:id/approve',
  requireRoles('admin'),
  hrController.approveContractRenewal
);

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

// Catch-all error handler for HR routes
router.use((error, req, res, next) => {
  console.error('\n❌ HR Route Error:', error);
  
  // Clean up any uploaded files on error
  if (req.file) {
    const { cleanupFiles } = require('../middlewares/uploadMiddleware');
    cleanupFiles([req.file]);
  }
  
  // Send error response
  if (!res.headersSent) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'An error occurred in HR operations',
      error: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
});

module.exports = router;

