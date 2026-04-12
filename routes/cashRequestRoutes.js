// Cash Request Routes
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const cashRequestController = require('../controllers/cashRequestController');
const CashRequest = require('../models/CashRequest');
// Import error handlers from upload middleware
const { handleMulterError, cleanupTempFiles, validateFiles } = require('../middlewares/uploadMiddleware');

// ============================================
// STATIC PATH ROUTES (MUST BE FIRST - NO PARAMETERS)
// ============================================

// Dashboard stats
router.get(
  '/dashboard-stats',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  async (req, res) => {
    try {
      const CashRequest = require('../models/CashRequest');
      const User = require('../models/User');
      
      const user = await User.findById(req.user.userId);
      console.log(`=== DASHBOARD STATS for ${user.role}: ${user.email} ===`);
      
      let baseFilter = {};
      let pendingFilter = {};
      
      if (user.role === 'employee') {
        baseFilter = { employee: req.user.userId };
        pendingFilter = {
          employee: req.user.userId,
          status: { $regex: /pending/ }
        };
      } else if (user.role === 'supervisor') {
        baseFilter = {
          'approvalChain': {
            $elemMatch: {
              'approver.email': user.email
            }
          }
        };
        pendingFilter = {
          'approvalChain': {
            $elemMatch: {
              'approver.email': user.email,
              'status': 'pending'
            }
          }
        };
      } else if (user.role === 'finance') {
        baseFilter = {
          $or: [
            { status: { $regex: /pending_finance/ } },
            { status: 'approved' },
            { status: 'disbursed' },
            { status: 'completed' },
            {
              'approvalChain': {
                $elemMatch: {
                  'approver.role': 'Finance Officer'
                }
              }
            }
          ]
        };
        pendingFilter = {
          $or: [
            { status: { $regex: /pending_finance/ } },
            {
              'approvalChain': {
                $elemMatch: {
                  'approver.email': user.email,
                  'approver.role': 'Finance Officer',
                  'status': 'pending'
                }
              }
            }
          ]
        };
      } else if (user.role === 'admin') {
        baseFilter = {};
        pendingFilter = {
          status: { $regex: /pending/ }
        };
      }
      
      console.log('Base filter:', JSON.stringify(baseFilter, null, 2));
      console.log('Pending filter:', JSON.stringify(pendingFilter, null, 2));
      
      const [total, pending, approved, disbursed, completed, denied] = await Promise.all([
        CashRequest.countDocuments(baseFilter),
        CashRequest.countDocuments(pendingFilter),
        CashRequest.countDocuments({ ...baseFilter, status: 'approved' }),
        CashRequest.countDocuments({ ...baseFilter, status: 'disbursed' }),
        CashRequest.countDocuments({ ...baseFilter, status: 'completed' }),
        CashRequest.countDocuments({ ...baseFilter, status: 'denied' })
      ]);
      
      const stats = {
        total,
        pending,
        approved,
        disbursed,
        completed,
        denied
      };
      
      console.log('Stats calculated:', stats);
      
      res.json({
        success: true,
        data: stats
      });
      
    } catch (error) {
      console.error('Dashboard stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch dashboard stats',
        error: error.message
      });
    }
  }
);

router.get(
  '/dashboard/stats',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getDashboardStats
);

router.get(
  '/check-pending',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.checkPendingRequests
);

router.post(
  '/approval-chain-preview',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getApprovalChainPreview
);

router.get(
  '/export',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.exportCashRequests
);

router.get(
  '/reports/analytics',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.getFinanceReportsData
);

router.get(
  '/justifications/supervisor/pending',
  authMiddleware,
  cashRequestController.getSupervisorJustifications
);

router.get(
  '/reimbursement/limit-status',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getReimbursementLimitStatus
);


router.get(
  '/justification-document/:requestId/:filename',
  authMiddleware,
  async (req, res) => {
    try {
      const { requestId, filename } = req.params;

      console.log('\n=== SERVING JUSTIFICATION DOCUMENT ===');
      console.log('Request ID:', requestId);
      console.log('Requested filename:', filename);
      console.log('User:', req.user.userId);

      // Validate ObjectId format
      if (!requestId.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid request ID format'
        });
      }

      // Find the request
      const request = await CashRequest.findById(requestId).populate('employee', '_id');

      if (!request) {
        console.log('❌ Request not found');
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }

      // Check if user has permission
      const canView =
        request.employee._id.toString() === req.user.userId.toString() ||
        req.user.role === 'admin' ||
        req.user.role === 'finance' ||
        req.user.role === 'supervisor';

      if (!canView) {
        console.log('❌ Access denied');
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this document'
        });
      }

      // Decode filename
      const decodedFilename = decodeURIComponent(filename);
      console.log('Decoded filename:', decodedFilename);

      // Search by name, publicId, or filename in localPath
      const doc = request.justification?.documents?.find(d => {
        if (d.name === decodedFilename) return true;
        if (d.publicId === decodedFilename) return true;
        const pathFilename = path.basename(d.localPath || '');
        if (pathFilename === decodedFilename) return true;
        return false;
      });

      if (!doc) {
        console.log('❌ Document not found in request');
        console.log('Available documents:', request.justification?.documents?.map(d => ({
          name: d.name,
          publicId: d.publicId,
          localPath: d.localPath
        })));
        return res.status(404).json({
          success: false,
          message: 'Document not found in request',
          availableDocuments: request.justification?.documents?.map(d => d.name)
        });
      }

      console.log('✅ Document found:');
      console.log('   Name:', doc.name);
      console.log('   Public ID:', doc.publicId);
      console.log('   Local Path:', doc.localPath);

      // ✅ Use resolveAttachmentPath — works on both local dev and Render
      const { resolveAttachmentPath } = require('../controllers/fileController');

      const resolved =
        resolveAttachmentPath(doc.localPath) ||
        resolveAttachmentPath(doc.publicId);

      if (!resolved) {
        console.log('❌ File not found on disk');
        return res.status(404).json({
          success: false,
          message: 'File not found on server. It may have been lost during a redeployment.',
          details: {
            requestedFilename: decodedFilename,
            storedName:        doc.name,
            publicId:          doc.publicId,
            storedPath:        doc.localPath
          }
        });
      }

      const { filePath } = resolved;

      console.log('📂 Final file path:', filePath);
      console.log('📊 File exists: true');

      // Persist corrected path back to DB if it changed
      if (doc.localPath !== filePath) {
        doc.localPath = filePath;
        await request.save();
        console.log('💾 Updated localPath in DB');
      }

      console.log('✅ Serving file');

      res.setHeader('Content-Type', doc.mimetype || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${doc.name}"`);
      res.sendFile(filePath);

    } catch (error) {
      console.error('❌ Error serving document:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving document',
        error: error.message
      });
    }
  }
);


// ============================================
// EMPLOYEE ROUTES (ALL /employee/* paths)
// ============================================
router.get(
  '/employee',
  authMiddleware,
  cashRequestController.getEmployeeRequests
);

router.get(
  '/employee/:requestId/justification',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getRequestForJustification
);

router.get(
  '/employee/:requestId',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getEmployeeRequest
);

// ============================================
// SUPERVISOR ROUTES (ALL /supervisor/* paths)
// ============================================
router.get(
  '/supervisor/justifications',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getSupervisorJustifications
);

router.get(
  '/supervisor/pending',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getSupervisorRequests
);

router.get(
  '/supervisor/justification/:requestId',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getSupervisorJustification
);

router.get(
  '/supervisor/:requestId',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getSupervisorRequest
);

router.get(
  '/supervisor',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.getSupervisorRequests
);

router.put(
  '/supervisor/:requestId',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.processSupervisorDecision
);

// ============================================
// FINANCE ROUTES (ALL /finance/* paths)
// ============================================
router.get(
  '/finance/justifications',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.getFinanceJustifications
);

router.get(
  '/finance/pending-disbursements',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.getPendingDisbursements
);

router.put(
  '/finance/justification/:requestId',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.processFinanceJustificationDecision
);

router.put(
  '/:requestId/finance/justification',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.processFinanceJustificationDecision
);

router.put(
  '/finance/:requestId',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.processFinanceDecision
);

router.get(
  '/finance',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.getFinanceRequests
);

// ============================================
// ADMIN ROUTES (ALL /admin/* paths)
// ============================================
router.get(
  '/admin/:requestId',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.getAdminRequestDetails
);

router.get(
  '/admin',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.getAllRequests
);

// ============================================
// REIMBURSEMENT ROUTES
// ============================================
router.post(
  '/reimbursement',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  (req, res, next) => {
    console.log('\n=== REIMBURSEMENT REQUEST UPLOAD INITIATED ===');
    console.log('User:', req.user?.userId);
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Raw body keys:', Object.keys(req.body));
    console.log('Has files object:', !!req.files);
    next();
  },
  upload.fields([
    { name: 'receiptDocuments', maxCount: 10 },
    { name: 'attachments', maxCount: 10 },
    { name: 'documents', maxCount: 10 }
  ]),
  (req, res, next) => {
    if (req.files) {
      const allFiles = [];
      
      if (req.files.receiptDocuments) {
        console.log(`Found ${req.files.receiptDocuments.length} files in 'receiptDocuments'`);
        allFiles.push(...req.files.receiptDocuments);
      }
      if (req.files.attachments) {
        console.log(`Found ${req.files.attachments.length} files in 'attachments'`);
        allFiles.push(...req.files.attachments);
      }
      if (req.files.documents) {
        console.log(`Found ${req.files.documents.length} files in 'documents'`);
        allFiles.push(...req.files.documents);
      }
      
      req.files = allFiles;
      console.log(`Normalized ${allFiles.length} total files for reimbursement`);
    } else {
      console.log('⚠️ No files detected in request');
    }
    next();
  },
  handleMulterError,
  validateFiles,
  (req, res, next) => {
    console.log('Files after validation:', req.files?.length || 0);
    if (req.files && req.files.length > 0) {
      console.log('Receipt documents:');
      req.files.forEach(file => {
        console.log(`  - ${file.originalname} (${file.size} bytes)`);
      });
    }
    next();
  },
  cashRequestController.createReimbursementRequest,
  cleanupTempFiles
);

// ============================================
// CREATE REQUEST (POST)
// ============================================
router.post(
  '/',
  authMiddleware,
  (req, res, next) => {
    console.log('\n=== CASH REQUEST UPLOAD INITIATED ===');
    console.log('User:', req.user?.userId);
    console.log('Content-Type:', req.headers['content-type']);
    next();
  },
  upload.array('attachments', 10),
  handleMulterError,
  validateFiles,
  (req, res, next) => {
    console.log('Files uploaded successfully:');
    if (req.files) {
      req.files.forEach(file => {
        console.log(`  - ${file.originalname} (${file.size} bytes) at ${file.path}`);
      });
    }
    next();
  },
  cashRequestController.createRequest,
  cleanupTempFiles
);

// ============================================
// ROUTES WITH :requestId PARAMETER (BEFORE GENERIC /:requestId)
// ============================================

// Submit justification
router.post(
  '/:requestId/justification',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  (req, res, next) => {
    console.log('=== JUSTIFICATION UPLOAD MIDDLEWARE ===');
    console.log('Request ID:', req.params.requestId);
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Request has files:', !!req.files);
    console.log('User:', req.user?.userId);
    next();
  },
  upload.fields([
    { name: 'documents', maxCount: 10 },
    { name: 'attachments', maxCount: 10 },
    { name: 'justificationDocuments', maxCount: 10 }
  ]),
  (req, res, next) => {
    if (req.files) {
      const allFiles = [];
      
      if (req.files.documents) {
        console.log(`Found ${req.files.documents.length} files in 'documents'`);
        allFiles.push(...req.files.documents);
      }
      if (req.files.attachments) {
        console.log(`Found ${req.files.attachments.length} files in 'attachments'`);
        allFiles.push(...req.files.attachments);
      }
      if (req.files.justificationDocuments) {
        console.log(`Found ${req.files.justificationDocuments.length} files in 'justificationDocuments'`);
        allFiles.push(...req.files.justificationDocuments);
      }
      
      req.files = allFiles;
      console.log(`Normalized ${allFiles.length} total files for justification`);
    } else {
      console.log('⚠️ No files detected in request');
    }
    next();
  },
  handleMulterError,
  validateFiles,
  (req, res, next) => {
    console.log('Files after validation:', req.files?.length || 0);
    if (req.files && req.files.length > 0) {
      console.log('Justification documents:');
      req.files.forEach(file => {
        console.log(`  - ${file.originalname} (${file.size} bytes)`);
      });
    }
    next();
  },
  cashRequestController.submitJustification,
  cleanupTempFiles
);

// Justification decision
router.put(
  '/justification/:requestId/decision',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  cashRequestController.processJustificationDecision
);

// Disbursement routes
router.post(
  '/:requestId/disburse',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.processDisbursement
);

router.get(
  '/:requestId/disbursements',
  authMiddleware,
  requireRoles('finance', 'admin', 'employee'),
  cashRequestController.getDisbursementHistory
);

// Acknowledge receipt of disbursement
router.post(
  '/:requestId/disbursements/:disbursementId/acknowledge',
  authMiddleware,
  cashRequestController.acknowledgeCashDisbursement
);

// Edit routes
router.put(
  '/:requestId/edit',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  upload.array('attachments', 10),
  handleMulterError,
  validateFiles,
  cashRequestController.editCashRequest,
  cleanupTempFiles
);

router.get(
  '/:requestId/edit-history',
  authMiddleware,
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const request = await CashRequest.findById(requestId)
        .populate('editHistory.editedBy', 'fullName email')
        .select('editHistory totalEdits isEdited originalValues');

      if (!request) {
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }

      res.json({
        success: true,
        data: {
          isEdited: request.isEdited,
          totalEdits: request.totalEdits,
          editHistory: request.editHistory || [],
          originalValues: request.originalValues
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch edit history',
        error: error.message
      });
    }
  }
);

// PDF generation
router.get(
  '/:requestId/pdf',
  authMiddleware,
  cashRequestController.generateCashRequestPDF
);

// Supervisor decision
router.put(
  '/:requestId/supervisor',
  authMiddleware,
  cashRequestController.processSupervisorDecision
);

// Finance decision
router.put(
  '/:requestId/finance',
  authMiddleware,
  requireRoles('finance', 'admin'),
  cashRequestController.processFinanceDecision
);

/**
 * Get pending HR approvals
 * GET /api/cash-requests/hr/pending
 */
router.get(
  '/hr/pending',
  authMiddleware,
  requireRoles('admin', 'hr'),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);
      
      console.log('=== GET HR PENDING APPROVALS ===');
      console.log(`User: ${user.fullName} (${user.email})`);

      // Find requests where HR is pending
      const requests = await CashRequest.find({
        status: 'pending_hr',
        'approvalChain': {
          $elemMatch: {
            'approver.email': user.email,
            'approver.role': 'HR Head',
            'status': 'pending'
          }
        }
      })
      .populate('employee', 'fullName email department position')
      .sort({ createdAt: -1 });

      console.log(`Found ${requests.length} requests pending HR approval`);

      res.json({
        success: true,
        data: requests,
        count: requests.length,
        userInfo: {
          name: user.fullName,
          email: user.email,
          role: user.role
        }
      });

    } catch (error) {
      console.error('Get HR pending approvals error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch HR approvals',
        error: error.message
      });
    }
  }
);

/**
 * Get HR justification approvals
 * GET /api/cash-requests/hr/justifications
 */
router.get(
  '/hr/justifications',
  authMiddleware,
  requireRoles('admin', 'hr'),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);
      
      console.log('=== GET HR JUSTIFICATION APPROVALS ===');
      console.log(`User: ${user.fullName} (${user.email})`);

      const requests = await CashRequest.find({
        status: 'justification_pending_hr',
        'justificationApprovalChain': {
          $elemMatch: {
            'approver.email': user.email,
            'approver.role': 'HR Head',
            'status': 'pending'
          }
        }
      })
      .populate('employee', 'fullName email department')
      .sort({ 'justification.justificationDate': -1 });

      console.log(`Found ${requests.length} justifications pending HR approval`);

      res.json({
        success: true,
        data: requests,
        count: requests.length
      });

    } catch (error) {
      console.error('Get HR justifications error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch HR justifications',
        error: error.message
      });
    }
  }
);

/**
 * Get single request for HR review
 * GET /api/cash-requests/hr/:requestId
 */
router.get(
  '/hr/:requestId',
  authMiddleware,
  requireRoles('admin', 'hr'),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const user = await User.findById(req.user.userId);

      const request = await CashRequest.findById(requestId)
        .populate('employee', 'fullName email department position')
        .populate('approvalChain.decidedBy', 'fullName email')
        .populate('projectId', 'name code');

      if (!request) {
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }

      // Check if user has HR approval authority
      const canView = 
        user.role === 'admin' ||
        request.approvalChain.some(step => 
          step.approver.email === user.email && step.approver.role === 'HR Head'
        );

      if (!canView) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      res.json({
        success: true,
        data: request
      });

    } catch (error) {
      console.error('Get HR request error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch request',
        error: error.message
      });
    }
  }
);

/**
 * Process HR approval decision
 * PUT /api/cash-requests/hr/:requestId
 */
router.put(
  '/hr/:requestId',
  authMiddleware,
  requireRoles('admin', 'hr'),
  cashRequestController.processSupervisorDecision  // ✅ Reuses same function with version control
);

/**
 * Get HR dashboard stats
 * GET /api/cash-requests/hr/dashboard/stats
 */
router.get(
  '/hr/dashboard/stats',
  authMiddleware,
  requireRoles('admin', 'hr'),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);

      const [
        pendingApprovals,
        pendingJustifications,
        approvedThisMonth,
        rejectedThisMonth
      ] = await Promise.all([
        // Pending approvals
        CashRequest.countDocuments({
          status: 'pending_hr',
          'approvalChain': {
            $elemMatch: {
              'approver.email': user.email,
              'status': 'pending'
            }
          }
        }),
        // Pending justifications
        CashRequest.countDocuments({
          status: 'justification_pending_hr',
          'justificationApprovalChain': {
            $elemMatch: {
              'approver.email': user.email,
              'status': 'pending'
            }
          }
        }),
        // Approved this month
        CashRequest.countDocuments({
          'approvalChain': {
            $elemMatch: {
              'approver.email': user.email,
              'status': 'approved',
              'actionDate': { $gte: new Date(new Date().setDate(1)) }
            }
          }
        }),
        // Rejected this month
        CashRequest.countDocuments({
          'approvalChain': {
            $elemMatch: {
              'approver.email': user.email,
              'status': 'rejected',
              'actionDate': { $gte: new Date(new Date().setDate(1)) }
            }
          }
        })
      ]);

      res.json({
        success: true,
        data: {
          pendingApprovals,
          pendingJustifications,
          approvedThisMonth,
          rejectedThisMonth,
          totalPending: pendingApprovals + pendingJustifications
        }
      });

    } catch (error) {
      console.error('Get HR dashboard stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch HR stats',
        error: error.message
      });
    }
  }
);

// Delete request
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('\n=== DELETE REQUEST ===');
    console.log('Request ID:', id);
    console.log('User ID:', req.user.userId);

    const request = await CashRequest.findById(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found or already deleted'
      });
    }

    console.log('Found request:', {
      id: request._id,
      status: request.status,
      employee: request.employee
    });

    if (request.employee.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own requests'
      });
    }

    if (request.status !== 'pending_supervisor') {
      return res.status(400).json({
        success: false,
        message: 'Can only delete requests that are pending first approval',
        details: `Current status: ${request.status}`
      });
    }

    const hasApproverAction = request.approvalChain.some(step => 
      step.status !== 'pending'
    );

    if (hasApproverAction) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete - approval process has already started',
        details: 'At least one approver has taken action on this request'
      });
    }

    const firstApprover = request.approvalChain[0];
    if (!firstApprover || firstApprover.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete - first approver has already reviewed this request'
      });
    }

    await CashRequest.findByIdAndDelete(id);

    console.log('✅ Request deleted successfully');

    return res.status(200).json({
      success: true,
      message: 'Request deleted successfully',
      data: {
        deletedId: id,
        displayId: request.displayId
      }
    });

  } catch (error) {
    console.error('Delete request error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete request',
      error: error.message
    });
  }
});

// ============================================
// GENERIC /:requestId ROUTE (MUST BE ABSOLUTELY LAST)
// ============================================
router.get(
  '/:requestId',
  authMiddleware,
  async (req, res, next) => {
    try {
      const { requestId } = req.params;
      
      console.log(`\n=== GENERIC GET REQUEST ===`);
      console.log(`Request ID: ${requestId}`);
      console.log(`User: ${req.user.userId}`);
      
      // Validate ObjectId format before querying
      if (!requestId.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid request ID format'
        });
      }
      
      const User = require('../models/User');

      const request = await CashRequest.findById(requestId)
        .populate('employee', 'fullName email department position')
        .populate('projectId', 'name code')
        .populate('budgetAllocation.budgetCodeId', 'code name');

      if (!request) {
        console.log('❌ Request not found');
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }

      const user = await User.findById(req.user.userId);

      const isOwner = request.employee._id.equals(req.user.userId);
      const isApprover = request.approvalChain.some(step => 
        step.approver.email === user.email
      );
      const isAdmin = user.role === 'admin';
      const isFinance = user.role === 'finance';

      if (!isOwner && !isApprover && !isAdmin && !isFinance) {
        console.log('❌ Access denied');
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      console.log('✅ Request found and access granted');
      console.log(`Status: ${request.status}`);

      res.json({
        success: true,
        data: request
      });

    } catch (error) {
      console.error('Get request details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch request details',
        error: error.message
      });
    }
  }
);

// ============================================
// ERROR HANDLING MIDDLEWARE (MUST BE LAST)
// ============================================
router.use((error, req, res, next) => {
  console.error('Cash request route error:', error);
  
  if (req.files) {
    const { cleanupFiles } = require('../middlewares/uploadMiddleware');
    cleanupFiles(req.files);
  }
  
  res.status(500).json({
    success: false,
    message: error.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

module.exports = router;