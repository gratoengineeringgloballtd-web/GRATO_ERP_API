const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const {
  createITRequest,
  updateITRequest,
  deleteITRequest,
  getEmployeeITRequests,
  getITRequestDetails,
  getSupervisorITRequests,
  processSupervisorDecision,
  getITDepartmentRequests,
  processITDepartmentDecision,
  updateFulfillmentStatus,
  updateAssetAssignment,
  getAllITRequests,
  getApprovalChainPreview,
  getITRequestsByRole,
  getDashboardStats,
  getCategoryAnalytics,
  getAssetAnalytics,
  getInventoryStatus,
  getITRequestStats,
  saveDraft,
  dischargeITItems,
  acknowledgeDischarge
} = require('../controllers/itSupportController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// ===== INITIALIZE IT SUPPORT STORAGE DIRECTORIES =====
const initITSupportStorage = async () => {
  const itSupportDirs = [
    path.join(__dirname, '../uploads/it-support'),
    path.join(__dirname, '../uploads/it-support/attachments'),
    path.join(__dirname, '../uploads/it-support/receipts'),
    path.join(__dirname, '../uploads/it-support/work-logs'),
    path.join(__dirname, '../uploads/temp')
  ];

  for (const dir of itSupportDirs) {
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o755 });
      console.log(`✓ IT Support directory ready: ${dir}`);
    } catch (error) {
      console.error(`❌ Failed to create directory ${dir}:`, error);
    }
  }
};

// Initialize storage on module load
initITSupportStorage();

// ===== MULTER CONFIGURATION FOR TEMP FILE UPLOADS =====
const uploadDir = path.join(__dirname, '../uploads/temp');

// Configure multer storage (temp location)
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique temporary filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `temp-${uniqueSuffix}-${sanitizedName}`;
    console.log('📁 Creating temp file:', filename);
    cb(null, filename);
  }
});

// File filter with comprehensive validation
const fileFilter = (req, file, cb) => {
  console.log('🔍 Validating file:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size
  });

  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ];

  const allowedExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', 
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', 
    '.txt', '.csv', '.log'
  ];
  
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
    console.log('✅ File validation passed');
    cb(null, true);
  } else {
    console.log('❌ File validation failed');
    cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`), false);
  }
};

// Create multer upload instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max
    files: 10 // Max 10 files
  }
});

// =============================================================================
// ===== SECTION 1: STATIC ROUTES (no URL params — must ALL come first) ========
// =============================================================================

// ===== FILE DOWNLOAD ROUTE =====
// Two dynamic segments (/download/:requestId/:fileName) but the leading
// static segment "download" prevents any clash with /:requestId below.
router.get('/download/:requestId/:fileName',
  authMiddleware,
  async (req, res) => {
    try {
      const { requestId, fileName } = req.params;
      
      console.log('📥 Download request:', { requestId, fileName });
      
      // Verify request exists and user has access
      const ITSupportRequest = require('../models/ITSupportRequest');
      const request = await ITSupportRequest.findById(requestId);
      
      if (!request) {
        return res.status(404).json({ 
          success: false, 
          message: 'Request not found' 
        });
      }

      // Check if user has permission to download
      const User = require('../models/User');
      const user = await User.findById(req.user.userId);
      
      const hasPermission = 
        request.employee.toString() === req.user.userId ||
        req.user.role === 'admin' ||
        req.user.role === 'it' ||
        request.approvalChain?.some(step => step.approver?.email === user.email);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Find attachment with localPath support
      const attachment = request.attachments?.find(att => 
        att.publicId === fileName || 
        att.url?.includes(fileName) ||
        (att.localPath && path.basename(att.localPath) === fileName)
      );

      if (!attachment) {
        return res.status(404).json({
          success: false,
          message: 'File not found in request attachments'
        });
      }

      // Try localPath first, fallback to constructed path
      let filePath = attachment.localPath;
      
      if (!filePath || !fsSync.existsSync(filePath)) {
        // Fallback to uploads directory
        filePath = path.join(__dirname, '../uploads/it-support/attachments', fileName);
      }
      
      // Final check
      if (!fsSync.existsSync(filePath)) {
        console.error('❌ File not found on disk:', filePath);
        return res.status(404).json({ 
          success: false, 
          message: 'File not found on server' 
        });
      }

      console.log('✅ Sending file:', filePath);
      
      // Set content type based on file extension
      const ext = path.extname(fileName).toLowerCase();
      const contentTypes = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.txt': 'text/plain',
        '.csv': 'text/csv'
      };

      res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.name}"`);
      
      res.download(filePath, attachment.name, (err) => {
        if (err) {
          console.error('❌ Error downloading file:', err);
          if (!res.headersSent) {
            res.status(500).json({ 
              success: false, 
              message: 'Error downloading file' 
            });
          }
        }
      });
    } catch (error) {
      console.error('❌ Download error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download file',
        error: error.message
      });
    }
  }
);

// ===== DASHBOARD AND ANALYTICS ROUTES =====
router.get('/dashboard/stats',
  authMiddleware,
  getDashboardStats
);

// Statistics and reporting routes
router.get('/analytics/statistics',
  authMiddleware,
  requireRoles('admin', 'it', 'hr'),
  getITRequestStats
);

router.get('/analytics/categories',
  authMiddleware,
  requireRoles('admin', 'it'),
  getCategoryAnalytics
);

router.get('/analytics/assets',
  authMiddleware,
  requireRoles('admin', 'it'),
  getAssetAnalytics
);

// ===== INVENTORY STATUS =====
router.get('/inventory/status',
  authMiddleware,
  requireRoles('admin', 'it'),
  getInventoryStatus
);

// ===== ROLE-BASED IT REQUESTS =====
// IMPORTANT: must stay above any /:requestId route to prevent "role" being
// captured as a requestId param.
router.get('/role/requests',
  authMiddleware,
  getITRequestsByRole
);

// ===== EMPLOYEE ROUTES =====
router.get('/employee',
  authMiddleware,
  getEmployeeITRequests
);

// ===== SUPERVISOR LIST =====
router.get('/supervisor',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  getSupervisorITRequests
);

// ===== IT DEPARTMENT LIST =====
router.get('/it-department',
  authMiddleware,
  requireRoles('it', 'admin'),
  getITDepartmentRequests
);

// ===== ADMIN LIST =====
router.get('/admin',
  authMiddleware,
  requireRoles('admin'),
  getAllITRequests
);

// ===== PREVIEW APPROVAL CHAIN =====
router.post('/preview-approval-chain',
  authMiddleware,
  getApprovalChainPreview
);

// ===== SAVE DRAFT =====
router.post('/draft',
  authMiddleware,
  saveDraft
);

// ===== CREATE IT REQUEST WITH FILE UPLOAD =====
router.post('/',
  authMiddleware,
  upload.array('attachments', 10),
  async (req, res, next) => {
    try {
      console.log('📤 Upload middleware - Files received:', req.files?.length || 0);

      if (req.files && req.files.length > 0) {
        req.files.forEach((file, index) => {
          console.log(`File ${index + 1}:`, {
            originalname: file.originalname,
            filename: file.filename,
            size: `${(file.size / 1024).toFixed(2)} KB`,
            path: file.path
          });
        });
      }

      next();
    } catch (error) {
      console.error('❌ Upload middleware error:', error);
      next(error);
    }
  },
  createITRequest
);

// =============================================================================
// ===== SECTION 2: STATIC-PREFIX PARAMETERIZED ROUTES ========================
// ===== (static first segment + dynamic second segment)  ======================
// =============================================================================

// Supervisor detail
router.get('/supervisor/:requestId',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  getITRequestDetails
);

// IT Department detail
router.get('/it-department/:requestId',
  authMiddleware,
  requireRoles('it', 'admin'),
  getITRequestDetails
);

// Admin detail
router.get('/admin/:requestId',
  authMiddleware,
  requireRoles('admin'),
  getITRequestDetails
);

// =============================================================================
// ===== SECTION 3: PARAMETERIZED ROUTES — /:requestId/action =================
// ===== (all sub-action PUT routes before the bare /:requestId catch-alls) ====
// =============================================================================

router.put('/:requestId/supervisor',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  processSupervisorDecision
);

router.put('/:requestId/it-department',
  authMiddleware,
  requireRoles('it', 'admin'),
  processITDepartmentDecision
);

router.put('/:requestId/fulfillment',
  authMiddleware,
  requireRoles('it', 'admin'),
  updateFulfillmentStatus
);

router.put('/:requestId/asset-assignment',
  authMiddleware,
  requireRoles('it', 'admin'),
  updateAssetAssignment
);

// ===== DISCHARGE & ACKNOWLEDGMENT =====
router.put('/:requestId/discharge',
  authMiddleware,
  requireRoles('it', 'admin'),
  upload.single('signature'),
  dischargeITItems
);

router.put('/:requestId/acknowledge',
  authMiddleware,
  upload.single('signature'),
  acknowledgeDischarge
);

// =============================================================================
// ===== SECTION 4: GENERIC CATCH-ALL PARAMETERIZED ROUTES (must be last) ======
// =============================================================================

router.put('/:requestId',
  authMiddleware,
  updateITRequest
);

router.delete('/:requestId',
  authMiddleware,
  deleteITRequest
);

router.get('/:requestId',
  authMiddleware,
  getITRequestDetails
);

// ===== ERROR HANDLING MIDDLEWARE =====
router.use((error, req, res, next) => {
  console.error('❌ Route error:', error);

  // Clean up uploaded temp files on error
  if (req.files && Array.isArray(req.files)) {
    console.log(`🧹 Cleaning up ${req.files.length} temp files after error...`);
    Promise.allSettled(
      req.files.map(file => {
        if (file.path && fsSync.existsSync(file.path)) {
          return fs.unlink(file.path).catch(err => 
            console.error('Failed to cleanup temp file:', err)
          );
        }
      })
    ).then(() => {
      console.log('✓ Temp file cleanup complete');
    });
  }

  // Handle multer errors
  if (error instanceof multer.MulterError) {
    const errorMessages = {
      'LIMIT_FILE_SIZE': 'File too large. Maximum size is 25MB per file.',
      'LIMIT_FILE_COUNT': 'Too many files. Maximum is 10 files.',
      'LIMIT_UNEXPECTED_FILE': 'Unexpected file field.'
    };

    return res.status(400).json({
      success: false,
      message: errorMessages[error.code] || `Upload error: ${error.message}`,
      code: error.code
    });
  }

  // Handle file validation errors
  if (error.message && error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  // Generic error response
  res.status(500).json({
    success: false,
    message: error.message || 'Internal server error'
  });
});

module.exports = router;









// const express = require('express');
// const router = express.Router();
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs').promises;
// const fsSync = require('fs');
// const {
//   createITRequest,
//   updateITRequest,
//   deleteITRequest,
//   getEmployeeITRequests,
//   getITRequestDetails,
//   getSupervisorITRequests,
//   processSupervisorDecision,
//   getITDepartmentRequests,
//   processITDepartmentDecision,
//   updateFulfillmentStatus,
//   updateAssetAssignment,
//   getAllITRequests,
//   getApprovalChainPreview,
//   getITRequestsByRole,
//   getDashboardStats,
//   getCategoryAnalytics,
//   getAssetAnalytics,
//   getInventoryStatus,
//   getITRequestStats,
//   saveDraft,
//   dischargeITItems,
//   acknowledgeDischarge
// } = require('../controllers/itSupportController');
// const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// // ===== INITIALIZE IT SUPPORT STORAGE DIRECTORIES =====
// const initITSupportStorage = async () => {
//   const itSupportDirs = [
//     path.join(__dirname, '../uploads/it-support'),
//     path.join(__dirname, '../uploads/it-support/attachments'),
//     path.join(__dirname, '../uploads/it-support/receipts'),
//     path.join(__dirname, '../uploads/it-support/work-logs'),
//     path.join(__dirname, '../uploads/temp')
//   ];

//   for (const dir of itSupportDirs) {
//     try {
//       await fs.mkdir(dir, { recursive: true, mode: 0o755 });
//       console.log(`✓ IT Support directory ready: ${dir}`);
//     } catch (error) {
//       console.error(`❌ Failed to create directory ${dir}:`, error);
//     }
//   }
// };

// // Initialize storage on module load
// initITSupportStorage();

// // ===== MULTER CONFIGURATION FOR TEMP FILE UPLOADS =====
// const uploadDir = path.join(__dirname, '../uploads/temp');

// // Configure multer storage (temp location)
// const storage = multer.diskStorage({
//   destination: async (req, file, cb) => {
//     try {
//       await fs.mkdir(uploadDir, { recursive: true });
//       cb(null, uploadDir);
//     } catch (error) {
//       cb(error);
//     }
//   },
//   filename: (req, file, cb) => {
//     // Generate unique temporary filename
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
//     const filename = `temp-${uniqueSuffix}-${sanitizedName}`;
//     console.log('📁 Creating temp file:', filename);
//     cb(null, filename);
//   }
// });

// // File filter with comprehensive validation
// const fileFilter = (req, file, cb) => {
//   console.log('🔍 Validating file:', {
//     originalname: file.originalname,
//     mimetype: file.mimetype,
//     size: file.size
//   });

//   const allowedMimeTypes = [
//     'image/jpeg',
//     'image/jpg', 
//     'image/png',
//     'image/gif',
//     'image/webp',
//     'application/pdf',
//     'application/msword',
//     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//     'application/vnd.ms-excel',
//     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//     'text/plain',
//     'text/csv'
//   ];

//   const allowedExtensions = [
//     '.jpg', '.jpeg', '.png', '.gif', '.webp', 
//     '.pdf', '.doc', '.docx', '.xls', '.xlsx', 
//     '.txt', '.csv', '.log'
//   ];
  
//   const fileExtension = path.extname(file.originalname).toLowerCase();
  
//   if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
//     console.log('✅ File validation passed');
//     cb(null, true);
//   } else {
//     console.log('❌ File validation failed');
//     cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`), false);
//   }
// };

// // Create multer upload instance
// const upload = multer({
//   storage: storage,
//   fileFilter: fileFilter,
//   limits: {
//     fileSize: 25 * 1024 * 1024, // 25MB max
//     files: 10 // Max 10 files
//   }
// });

// // =============================================================================
// // ===== SECTION 1: STATIC ROUTES (no URL params — must ALL come first) ========
// // =============================================================================

// // ===== FILE DOWNLOAD ROUTE =====
// // Two dynamic segments (/download/:requestId/:fileName) but the leading
// // static segment "download" prevents any clash with /:requestId below.
// router.get('/download/:requestId/:fileName',
//   authMiddleware,
//   async (req, res) => {
//     try {
//       const { requestId, fileName } = req.params;
      
//       console.log('📥 Download request:', { requestId, fileName });
      
//       // Verify request exists and user has access
//       const ITSupportRequest = require('../models/ITSupportRequest');
//       const request = await ITSupportRequest.findById(requestId);
      
//       if (!request) {
//         return res.status(404).json({ 
//           success: false, 
//           message: 'Request not found' 
//         });
//       }

//       // Check if user has permission to download
//       const User = require('../models/User');
//       const user = await User.findById(req.user.userId);
      
//       const hasPermission = 
//         request.employee.toString() === req.user.userId ||
//         req.user.role === 'admin' ||
//         req.user.role === 'it' ||
//         request.approvalChain?.some(step => step.approver?.email === user.email);

//       if (!hasPermission) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//       }

//       // Find attachment with localPath support
//       const attachment = request.attachments?.find(att => 
//         att.publicId === fileName || 
//         att.url?.includes(fileName) ||
//         (att.localPath && path.basename(att.localPath) === fileName)
//       );

//       if (!attachment) {
//         return res.status(404).json({
//           success: false,
//           message: 'File not found in request attachments'
//         });
//       }

//       // Try localPath first, fallback to constructed path
//       let filePath = attachment.localPath;
      
//       if (!filePath || !fsSync.existsSync(filePath)) {
//         // Fallback to uploads directory
//         filePath = path.join(__dirname, '../uploads/it-support/attachments', fileName);
//       }
      
//       // Final check
//       if (!fsSync.existsSync(filePath)) {
//         console.error('❌ File not found on disk:', filePath);
//         return res.status(404).json({ 
//           success: false, 
//           message: 'File not found on server' 
//         });
//       }

//       console.log('✅ Sending file:', filePath);
      
//       // Set content type based on file extension
//       const ext = path.extname(fileName).toLowerCase();
//       const contentTypes = {
//         '.pdf': 'application/pdf',
//         '.jpg': 'image/jpeg',
//         '.jpeg': 'image/jpeg',
//         '.png': 'image/png',
//         '.gif': 'image/gif',
//         '.webp': 'image/webp',
//         '.doc': 'application/msword',
//         '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//         '.xls': 'application/vnd.ms-excel',
//         '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//         '.txt': 'text/plain',
//         '.csv': 'text/csv'
//       };

//       res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
//       res.setHeader('Content-Disposition', `attachment; filename="${attachment.name}"`);
      
//       res.download(filePath, attachment.name, (err) => {
//         if (err) {
//           console.error('❌ Error downloading file:', err);
//           if (!res.headersSent) {
//             res.status(500).json({ 
//               success: false, 
//               message: 'Error downloading file' 
//             });
//           }
//         }
//       });
//     } catch (error) {
//       console.error('❌ Download error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to download file',
//         error: error.message
//       });
//     }
//   }
// );

// // ===== DASHBOARD AND ANALYTICS ROUTES =====
// router.get('/dashboard/stats',
//   authMiddleware,
//   getDashboardStats
// );

// // Statistics and reporting routes
// router.get('/analytics/statistics',
//   authMiddleware,
//   requireRoles('admin', 'it', 'hr'),
//   getITRequestStats
// );

// router.get('/analytics/categories',
//   authMiddleware,
//   requireRoles('admin', 'it'),
//   getCategoryAnalytics
// );

// router.get('/analytics/assets',
//   authMiddleware,
//   requireRoles('admin', 'it'),
//   getAssetAnalytics
// );

// // ===== INVENTORY STATUS =====
// router.get('/inventory/status',
//   authMiddleware,
//   requireRoles('admin', 'it'),
//   getInventoryStatus
// );

// // ===== ROLE-BASED IT REQUESTS =====
// // IMPORTANT: must stay above any /:requestId route to prevent "role" being
// // captured as a requestId param.
// router.get('/role/requests',
//   authMiddleware,
//   getITRequestsByRole
// );

// // ===== EMPLOYEE ROUTES =====
// router.get('/employee',
//   authMiddleware,
//   getEmployeeITRequests
// );

// // ===== SUPERVISOR LIST =====
// router.get('/supervisor',
//   authMiddleware,
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
//   getSupervisorITRequests
// );

// // ===== IT DEPARTMENT LIST =====
// router.get('/it-department',
//   authMiddleware,
//   requireRoles('it', 'admin'),
//   getITDepartmentRequests
// );

// // ===== ADMIN LIST =====
// router.get('/admin',
//   authMiddleware,
//   requireRoles('admin'),
//   getAllITRequests
// );

// // ===== PREVIEW APPROVAL CHAIN =====
// router.post('/preview-approval-chain',
//   authMiddleware,
//   getApprovalChainPreview
// );

// // ===== SAVE DRAFT =====
// router.post('/draft',
//   authMiddleware,
//   saveDraft
// );

// // ===== CREATE IT REQUEST WITH FILE UPLOAD =====
// router.post('/',
//   authMiddleware,
//   upload.array('attachments', 10),
//   async (req, res, next) => {
//     try {
//       console.log('📤 Upload middleware - Files received:', req.files?.length || 0);

//       if (req.files && req.files.length > 0) {
//         req.files.forEach((file, index) => {
//           console.log(`File ${index + 1}:`, {
//             originalname: file.originalname,
//             filename: file.filename,
//             size: `${(file.size / 1024).toFixed(2)} KB`,
//             path: file.path
//           });
//         });
//       }

//       next();
//     } catch (error) {
//       console.error('❌ Upload middleware error:', error);
//       next(error);
//     }
//   },
//   createITRequest
// );

// // =============================================================================
// // ===== SECTION 2: STATIC-PREFIX PARAMETERIZED ROUTES ========================
// // ===== (static first segment + dynamic second segment)  ======================
// // =============================================================================

// // Supervisor detail
// router.get('/supervisor/:requestId',
//   authMiddleware,
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
//   getITRequestDetails
// );

// // IT Department detail
// router.get('/it-department/:requestId',
//   authMiddleware,
//   requireRoles('it', 'admin'),
//   getITRequestDetails
// );

// // Admin detail
// router.get('/admin/:requestId',
//   authMiddleware,
//   requireRoles('admin'),
//   getITRequestDetails
// );

// // =============================================================================
// // ===== SECTION 3: PARAMETERIZED ROUTES — /:requestId/action =================
// // ===== (all sub-action PUT routes before the bare /:requestId catch-alls) ====
// // =============================================================================

// router.put('/:requestId/supervisor',
//   authMiddleware,
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
//   processSupervisorDecision
// );

// router.put('/:requestId/it-department',
//   authMiddleware,
//   requireRoles('it', 'admin'),
//   processITDepartmentDecision
// );

// router.put('/:requestId/fulfillment',
//   authMiddleware,
//   requireRoles('it', 'admin'),
//   updateFulfillmentStatus
// );

// router.put('/:requestId/asset-assignment',
//   authMiddleware,
//   requireRoles('it', 'admin'),
//   updateAssetAssignment
// );

// // ===== DISCHARGE & ACKNOWLEDGMENT =====
// router.put('/:requestId/discharge',
//   authMiddleware,
//   requireRoles('it', 'admin'),
//   upload.single('signature'),
//   dischargeITItems
// );

// router.put('/:requestId/acknowledge',
//   authMiddleware,
//   upload.single('signature'),
//   acknowledgeDischarge
// );

// // =============================================================================
// // ===== SECTION 4: GENERIC CATCH-ALL PARAMETERIZED ROUTES (must be last) ======
// // =============================================================================

// router.put('/:requestId',
//   authMiddleware,
//   updateITRequest
// );

// router.delete('/:requestId',
//   authMiddleware,
//   deleteITRequest
// );

// router.get('/:requestId',
//   authMiddleware,
//   getITRequestDetails
// );

// // ===== ERROR HANDLING MIDDLEWARE =====
// router.use((error, req, res, next) => {
//   console.error('❌ Route error:', error);

//   // Clean up uploaded temp files on error
//   if (req.files && Array.isArray(req.files)) {
//     console.log(`🧹 Cleaning up ${req.files.length} temp files after error...`);
//     Promise.allSettled(
//       req.files.map(file => {
//         if (file.path && fsSync.existsSync(file.path)) {
//           return fs.unlink(file.path).catch(err => 
//             console.error('Failed to cleanup temp file:', err)
//           );
//         }
//       })
//     ).then(() => {
//       console.log('✓ Temp file cleanup complete');
//     });
//   }

//   // Handle multer errors
//   if (error instanceof multer.MulterError) {
//     const errorMessages = {
//       'LIMIT_FILE_SIZE': 'File too large. Maximum size is 25MB per file.',
//       'LIMIT_FILE_COUNT': 'Too many files. Maximum is 10 files.',
//       'LIMIT_UNEXPECTED_FILE': 'Unexpected file field.'
//     };

//     return res.status(400).json({
//       success: false,
//       message: errorMessages[error.code] || `Upload error: ${error.message}`,
//       code: error.code
//     });
//   }

//   // Handle file validation errors
//   if (error.message && error.message.includes('Invalid file type')) {
//     return res.status(400).json({
//       success: false,
//       message: error.message
//     });
//   }

//   // Generic error response
//   res.status(500).json({
//     success: false,
//     message: error.message || 'Internal server error'
//   });
// });

// module.exports = router;







// // ===== DISCHARGE & ACKNOWLEDGMENT ENDPOINTS (PARAMETERIZED) =====
// router.put('/:requestId/discharge',
//   authMiddleware,
//   requireRoles('it', 'admin'),
//   upload.single('signature'),
//   require('../controllers/itSupportController').dischargeITItems
// );

// router.put('/:requestId/acknowledge',
//   authMiddleware,
//   upload.single('signature'),
//   require('../controllers/itSupportController').acknowledgeDischarge
// );
// const express = require('express');
// const router = express.Router();
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs').promises;
// const fsSync = require('fs');
// const {
//   createITRequest,
//   updateITRequest,
//   deleteITRequest,
//   getEmployeeITRequests,
//   getITRequestDetails,
//   getSupervisorITRequests,
//   processSupervisorDecision,
//   getITDepartmentRequests,
//   processITDepartmentDecision,
//   updateFulfillmentStatus,
//   updateAssetAssignment,
//   getAllITRequests,
//   getApprovalChainPreview,
//   getITRequestsByRole,
//   getDashboardStats,
//   getCategoryAnalytics,
//   getAssetAnalytics,
//   getInventoryStatus,
//   getITRequestStats,
//   saveDraft
// } = require('../controllers/itSupportController');
// const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// // ===== INITIALIZE IT SUPPORT STORAGE DIRECTORIES =====
// const initITSupportStorage = async () => {
//   const itSupportDirs = [
//     path.join(__dirname, '../uploads/it-support'),
//     path.join(__dirname, '../uploads/it-support/attachments'),
//     path.join(__dirname, '../uploads/it-support/receipts'),
//     path.join(__dirname, '../uploads/it-support/work-logs'),
//     path.join(__dirname, '../uploads/temp')
//   ];

//   for (const dir of itSupportDirs) {
//     try {
//       await fs.mkdir(dir, { recursive: true, mode: 0o755 });
//       console.log(`✓ IT Support directory ready: ${dir}`);
//     } catch (error) {
//       console.error(`❌ Failed to create directory ${dir}:`, error);
//     }
//   }
// };

// // Initialize storage on module load
// initITSupportStorage();

// // ===== MULTER CONFIGURATION FOR TEMP FILE UPLOADS =====
// const uploadDir = path.join(__dirname, '../uploads/temp');

// // Configure multer storage (temp location)
// const storage = multer.diskStorage({
//   destination: async (req, file, cb) => {
//     try {
//       await fs.mkdir(uploadDir, { recursive: true });
//       cb(null, uploadDir);
//     } catch (error) {
//       cb(error);
//     }
//   },
//   filename: (req, file, cb) => {
//     // Generate unique temporary filename
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
//     const filename = `temp-${uniqueSuffix}-${sanitizedName}`;
//     console.log('📁 Creating temp file:', filename);
//     cb(null, filename);
//   }
// });

// // File filter with comprehensive validation
// const fileFilter = (req, file, cb) => {
//   console.log('🔍 Validating file:', {
//     originalname: file.originalname,
//     mimetype: file.mimetype,
//     size: file.size
//   });

//   const allowedMimeTypes = [
//     'image/jpeg',
//     'image/jpg', 
//     'image/png',
//     'image/gif',
//     'image/webp',
//     'application/pdf',
//     'application/msword',
//     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//     'application/vnd.ms-excel',
//     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//     'text/plain',
//     'text/csv'
//   ];

//   const allowedExtensions = [
//     '.jpg', '.jpeg', '.png', '.gif', '.webp', 
//     '.pdf', '.doc', '.docx', '.xls', '.xlsx', 
//     '.txt', '.csv', '.log'
//   ];
  
//   const fileExtension = path.extname(file.originalname).toLowerCase();
  
//   if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
//     console.log('✅ File validation passed');
//     cb(null, true);
//   } else {
//     console.log('❌ File validation failed');
//     cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`), false);
//   }
// };

// // Create multer upload instance
// const upload = multer({
//   storage: storage,
//   fileFilter: fileFilter,
//   limits: {
//     fileSize: 25 * 1024 * 1024, // 25MB max
//     files: 10 // Max 10 files
//   }
// });

// // ===== FILE DOWNLOAD ROUTE =====
// router.get('/download/:requestId/:fileName',
//   authMiddleware,
//   async (req, res) => {
//     try {
//       const { requestId, fileName } = req.params;
      
//       console.log('📥 Download request:', { requestId, fileName });
      
//       // Verify request exists and user has access
//       const ITSupportRequest = require('../models/ITSupportRequest');
//       const request = await ITSupportRequest.findById(requestId);
      
//       if (!request) {
//         return res.status(404).json({ 
//           success: false, 
//           message: 'Request not found' 
//         });
//       }

//       // Check if user has permission to download
//       const User = require('../models/User');
//       const user = await User.findById(req.user.userId);
      
//       const hasPermission = 
//         request.employee.toString() === req.user.userId ||
//         req.user.role === 'admin' ||
//         req.user.role === 'it' ||
//         request.approvalChain?.some(step => step.approver?.email === user.email);

//       if (!hasPermission) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//       }

//       // Find attachment with localPath support
//       const attachment = request.attachments?.find(att => 
//         att.publicId === fileName || 
//         att.url?.includes(fileName) ||
//         (att.localPath && path.basename(att.localPath) === fileName)
//       );

//       if (!attachment) {
//         return res.status(404).json({
//           success: false,
//           message: 'File not found in request attachments'
//         });
//       }

//       // Try localPath first, fallback to constructed path
//       let filePath = attachment.localPath;
      
//       if (!filePath || !fsSync.existsSync(filePath)) {
//         // Fallback to uploads directory
//         filePath = path.join(__dirname, '../uploads/it-support/attachments', fileName);
//       }
      
//       // Final check
//       if (!fsSync.existsSync(filePath)) {
//         console.error('❌ File not found on disk:', filePath);
//         return res.status(404).json({ 
//           success: false, 
//           message: 'File not found on server' 
//         });
//       }

//       console.log('✅ Sending file:', filePath);
      
//       // Set content type based on file extension
//       const ext = path.extname(fileName).toLowerCase();
//       const contentTypes = {
//         '.pdf': 'application/pdf',
//         '.jpg': 'image/jpeg',
//         '.jpeg': 'image/jpeg',
//         '.png': 'image/png',
//         '.gif': 'image/gif',
//         '.webp': 'image/webp',
//         '.doc': 'application/msword',
//         '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//         '.xls': 'application/vnd.ms-excel',
//         '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//         '.txt': 'text/plain',
//         '.csv': 'text/csv'
//       };

//       res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
//       res.setHeader('Content-Disposition', `attachment; filename="${attachment.name}"`);
      
//       res.download(filePath, attachment.name, (err) => {
//         if (err) {
//           console.error('❌ Error downloading file:', err);
//           if (!res.headersSent) {
//             res.status(500).json({ 
//               success: false, 
//               message: 'Error downloading file' 
//             });
//           }
//         }
//       });
//     } catch (error) {
//       console.error('❌ Download error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to download file',
//         error: error.message
//       });
//     }
//   }
// );

// // ===== DASHBOARD AND ANALYTICS ROUTES =====
// router.get('/dashboard/stats',
//   authMiddleware,
//   getDashboardStats
// );

// // Statistics and reporting routes
// router.get('/analytics/statistics',
//   authMiddleware,
//   requireRoles('admin', 'it', 'hr'),
//   getITRequestStats
// );

// router.get('/analytics/categories',
//   authMiddleware,
//   requireRoles('admin', 'it'),
//   getCategoryAnalytics
// );

// router.get('/analytics/assets',
//   authMiddleware,
//   requireRoles('admin', 'it'),
//   getAssetAnalytics
// );

// // Inventory status 
// router.get('/inventory/status',
//   authMiddleware,
//   requireRoles('admin', 'it'),
//   getInventoryStatus
// );

// // ===== ROLE-BASED IT REQUESTS ENDPOINT =====
// router.get('/role/requests',
//   authMiddleware,
//   getITRequestsByRole
// );

// // ===== EMPLOYEE ROUTES =====
// router.get('/employee', 
//   authMiddleware, 
//   getEmployeeITRequests
// );

// // ===== PREVIEW APPROVAL CHAIN ENDPOINT =====
// router.post('/preview-approval-chain',
//   authMiddleware,
//   getApprovalChainPreview
// );

// // ===== SAVE DRAFT ENDPOINT =====
// router.post('/draft', 
//   authMiddleware, 
//   saveDraft
// );

// // ===== SUPERVISOR ROUTES =====
// router.get('/supervisor', 
//   authMiddleware, 
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'), 
//   getSupervisorITRequests
// );

// // ===== IT DEPARTMENT ROUTES =====
// router.get('/it-department', 
//   authMiddleware, 
//   requireRoles('it', 'admin'),
//   getITDepartmentRequests
// );

// // ===== ADMIN ROUTES =====
// router.get('/admin', 
//   authMiddleware, 
//   requireRoles('admin'), 
//   getAllITRequests
// );

// // ===== CREATE IT REQUEST WITH FILE UPLOAD =====
// router.post('/', 
//   authMiddleware, 
//   upload.array('attachments', 10), // Allow up to 10 files
//   async (req, res, next) => {
//     try {
//       console.log('📤 Upload middleware - Files received:', req.files?.length || 0);
      
//       if (req.files && req.files.length > 0) {
//         req.files.forEach((file, index) => {
//           console.log(`File ${index + 1}:`, {
//             originalname: file.originalname,
//             filename: file.filename,
//             size: `${(file.size / 1024).toFixed(2)} KB`,
//             path: file.path
//           });
//         });
//       }
      
//       next();
//     } catch (error) {
//       console.error('❌ Upload middleware error:', error);
//       next(error);
//     }
//   },
//   createITRequest
// );

// // ===== SPECIFIC PARAMETERIZED ROUTES (Must come before generic routes) =====

// // Supervisor specific routes
// router.get('/supervisor/:requestId', 
//   authMiddleware, 
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
//   getITRequestDetails
// );

// router.put('/:requestId/supervisor', 
//   authMiddleware, 
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'), 
//   processSupervisorDecision
// );

// // IT Department specific routes
// router.get('/it-department/:requestId', 
//   authMiddleware, 
//   requireRoles('it', 'admin'),
//   getITRequestDetails
// );

// router.put('/:requestId/it-department', 
//   authMiddleware, 
//   requireRoles('it', 'admin'),
//   processITDepartmentDecision
// );

// router.put('/:requestId/fulfillment', 
//   authMiddleware, 
//   requireRoles('it', 'admin'),
//   updateFulfillmentStatus
// );

// router.put('/:requestId/asset-assignment', 
//   authMiddleware, 
//   requireRoles('it', 'admin'),
//   updateAssetAssignment
// );

// // Admin specific routes
// router.get('/admin/:requestId', 
//   authMiddleware, 
//   requireRoles('admin'),
//   getITRequestDetails
// );

// // ===== GENERIC PARAMETERIZED ROUTES (Must come last) =====
// router.put('/:requestId', 
//   authMiddleware, 
//   updateITRequest
// );

// router.delete('/:requestId', 
//   authMiddleware, 
//   deleteITRequest
// );

// router.get('/:requestId', 
//   authMiddleware, 
//   getITRequestDetails
// );

// // ===== ERROR HANDLING MIDDLEWARE =====
// router.use((error, req, res, next) => {
//   console.error('❌ Route error:', error);

//   // Clean up uploaded temp files on error
//   if (req.files && Array.isArray(req.files)) {
//     console.log(`🧹 Cleaning up ${req.files.length} temp files after error...`);
//     Promise.allSettled(
//       req.files.map(file => {
//         if (file.path && fsSync.existsSync(file.path)) {
//           return fs.unlink(file.path).catch(err => 
//             console.error('Failed to cleanup temp file:', err)
//           );
//         }
//       })
//     ).then(() => {
//       console.log('✓ Temp file cleanup complete');
//     });
//   }

//   // Handle multer errors
//   if (error instanceof multer.MulterError) {
//     const errorMessages = {
//       'LIMIT_FILE_SIZE': 'File too large. Maximum size is 25MB per file.',
//       'LIMIT_FILE_COUNT': 'Too many files. Maximum is 10 files.',
//       'LIMIT_UNEXPECTED_FILE': 'Unexpected file field.'
//     };

//     return res.status(400).json({
//       success: false,
//       message: errorMessages[error.code] || `Upload error: ${error.message}`,
//       code: error.code
//     });
//   }

//   // Handle file validation errors
//   if (error.message && error.message.includes('Invalid file type')) {
//     return res.status(400).json({
//       success: false,
//       message: error.message
//     });
//   }

//   // Generic error response
//   res.status(500).json({
//     success: false,
//     message: error.message || 'Internal server error'
//   });
// });

// module.exports = router;

