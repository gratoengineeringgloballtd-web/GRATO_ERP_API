const express = require('express');
const router = express.Router();
const hrController = require('../controllers/hrController');
const hrFileController = require('../controllers/hrFileController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const { handleMulterError, validateFiles, cleanupTempFiles } = require('../middlewares/uploadMiddleware');

router.use(authMiddleware);

// Full HR management (employee CRUD, statistics, leave/performance, contracts) —
// unchanged from before.
const requireHRRole = requireRoles('hr', 'admin', 'ceo');

// Document-management-only access. Grants carmel.dafny@gratoglobal.com the ability to
// browse employees and manage their documents specifically, without full HR access
// (no employee create/edit/deactivate, no statistics/export, no leave/performance data,
// no contracts). This is additive to whatever her base role already grants elsewhere —
// it does not change her role or touch any other part of the app.
const DOCUMENT_ONLY_EMAILS = ['carmel.dafny@gratoglobal.com'];
const requireHRDocumentAccess = (req, res, next) => {
  const role = req.user?.role;
  const email = req.user?.email?.toLowerCase();
  if (['hr', 'admin', 'ceo'].includes(role) || DOCUMENT_ONLY_EMAILS.includes(email)) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied' });
};

// ============================================
// EMPLOYEE MANAGEMENT ROUTES
// ============================================

// Statistics and Analytics
router.get('/employees/statistics', requireHRRole, hrController.getStatistics);

// Export employees to Excel
router.get('/employees/export', requireHRRole, hrController.exportEmployees);

// Employee-specific data
router.get('/employees/:id/leave-balance', requireHRRole, hrController.getEmployeeLeaveBalance);
router.get('/employees/:id/performance', requireHRRole, hrController.getEmployeePerformance);

// Read access (list + single employee) — needed by document-only users to find and
// open an employee record; full CRUD below stays HR/admin/ceo only.
router.get('/employees', requireHRDocumentAccess, hrController.getEmployees);
router.get('/employees/:id', requireHRDocumentAccess, hrController.getEmployee);
router.post('/employees', requireHRRole, hrController.createEmployee);
router.put('/employees/:id', requireHRRole, hrController.updateEmployee);
router.patch('/employees/:id/status', requireHRRole, hrController.updateEmployeeStatus);
router.delete('/employees/:id', requireHRRole, hrController.deactivateEmployee);

// ============================================
// DOCUMENT MANAGEMENT ROUTES - ENHANCED
// ============================================

// Upload document with enhanced error handling
router.post(
  '/employees/:id/documents/:type',
  requireHRDocumentAccess,
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
router.get('/employees/:id/documents/:type/info', requireHRDocumentAccess, hrController.getDocumentInfo);

// Download document (legacy endpoint - kept for backward compatibility)
router.get('/employees/:id/documents/:type', requireHRDocumentAccess, hrController.downloadDocument);

// Delete document
router.delete('/employees/:id/documents/:docId', requireHRDocumentAccess, hrController.deleteDocument);

// ============================================
// CUSTOM DOCUMENT SECTIONS
// ============================================

// List all document sections (built-in + custom)
router.get('/document-sections', requireHRDocumentAccess, hrController.getDocumentSections);

// Create a new custom document section
router.post('/document-sections', requireHRDocumentAccess, hrController.createDocumentSection);

// Remove a custom document section (soft delete - built-in sections can't be removed)
router.delete('/document-sections/:key', requireHRDocumentAccess, hrController.deactivateDocumentSection);

// ============================================
// NEW: ENHANCED DOCUMENT FILE ROUTES
// ============================================

// Download document by publicId (preferred method)
router.get(
  '/documents/:employeeId/download/:publicId',
  requireHRDocumentAccess,
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
  requireHRDocumentAccess,
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
  requireHRDocumentAccess,
  hrFileController.getHRDocumentInfo
);

// ============================================
// CONTRACT MANAGEMENT ROUTES
// ============================================

// Get contracts expiring soon
router.get('/contracts/expiring', requireHRRole, hrController.getExpiringContracts);

// Request contract renewal (HR only)
router.post('/contracts/:id/renew', requireHRRole, hrController.requestContractRenewal);

// Approve/reject contract renewal (Admin only)
router.put(
  '/contracts/:id/approve',
  requireRoles('admin', 'ceo'),
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

