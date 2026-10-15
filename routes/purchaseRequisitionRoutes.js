const express = require('express');
const router = express.Router();
const https = require('https');
const purchaseRequisitionController = require('../controllers/purchaseRequisitionController');
const resubmitController = require('../controllers/resubmitRequisitionController');
const clarificationController = require('../controllers/clarificationController');
const supplyChainRejectionController = require('../controllers/supplyChainRejectionController');
const cancellationController = require('../controllers/Cancellationcontroller');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const { 
  downloadFile, 
  getFileMetadata,
  deleteFile 
} = require('../utils/localFileStorage');
const { deleteFile: deleteCloudinaryFile } = require('../utils/cloudinaryStorage');
const upload = require('../middlewares/uploadMiddleware');

// ✅ ADD THIS LINE - Import PurchaseRequisition model
const PurchaseRequisition = require('../models/PurchaseRequisition');

// ============================================
// ATTACHMENT STORAGE HELPERS
// (Attachments can live on Cloudinary — localPath is an https:// URL —
//  or on local disk from before the Cloudinary migration — localPath is
//  a filesystem path. These helpers branch on that.)
// ============================================

const isRemoteUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

/**
 * Streams a remote (Cloudinary) file straight through to the response,
 * without ever writing it to local disk.
 */
const streamRemoteFile = (url, res, { mimetype, filename, size, disposition }) => {
  https.get(url, (upstream) => {
    if (upstream.statusCode && upstream.statusCode >= 400) {
      console.error(`Remote file fetch failed (${upstream.statusCode}) for`, url);
      if (!res.headersSent) {
        res.status(404).json({
          success: false,
          message: 'File not found on Cloudinary. It may have been deleted.'
        });
      }
      upstream.resume();
      return;
    }

    res.setHeader('Content-Type', mimetype || upstream.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    if (size) res.setHeader('Content-Length', size);

    upstream.pipe(res);
  }).on('error', (error) => {
    console.error('Error streaming remote file:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error retrieving file from storage'
      });
    }
  });
};

/**
 * Streams or redirects an attachment to the response, whichever storage
 * backend it lives on. `disposition` is 'attachment' (download) or 'inline' (preview).
 */
const serveAttachment = (attachment, res, disposition) => {
  const source = attachment.localPath || attachment.url;

  if (isRemoteUrl(source)) {
    console.log(`Serving Cloudinary attachment (${disposition}):`, source);
    streamRemoteFile(source, res, {
      mimetype: attachment.mimetype,
      filename: attachment.name,
      size: attachment.size,
      disposition
    });
    return;
  }

  // Legacy local-disk attachment
  const fs = require('fs');
  if (!source || !fs.existsSync(source)) {
    console.error('File not found at path:', source);
    res.status(404).json({
      success: false,
      message: 'File not found on server. It may have been deleted.'
    });
    return;
  }

  res.setHeader('Content-Type', attachment.mimetype || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename="${attachment.name}"`);
  res.setHeader('Content-Length', attachment.size);

  const fileStream = fs.createReadStream(source);
  fileStream.pipe(res);
  fileStream.on('error', (error) => {
    console.error('Error streaming local file:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error retrieving file'
      });
    }
  });
};

// ============================================
// STATIC ROUTES FIRST
// ============================================

// // Dashboard stats
// router.get('/dashboard-stats', 
//   authMiddleware,
//   purchaseRequisitionController.getDashboardStats
// );

// router.get(
//   '/dashboard-stats',
//   authMiddleware,
//   async (req, res) => {
//     try {
//       const PurchaseRequisition = require('../models/PurchaseRequisition');
//       const User = require('../models/User');

//       const user = await User.findById(req.user.userId);

//       const ALL_PENDING = [
//         'pending_supervisor',
//         'pending_finance_verification',
//         'pending_supply_chain_review',
//         'pending_buyer_assignment',
//         'pending_head_approval',
//         'pending_ceo_approval'
//       ];

//       let baseFilter   = {};
//       let pendingFilter = {};

//       if (user.role === 'employee') {
//         // Employee sees only their own requisitions
//         baseFilter    = { employee: req.user.userId };
//         pendingFilter = { employee: req.user.userId, status: { $in: ALL_PENDING } };

//       } else if (['supervisor', 'technical', 'hr', 'it', 'hse', 'project'].includes(user.role)) {
//         // Supervisor-type roles: only requests where it is currently their turn
//         baseFilter = {
//           'approvalChain': { $elemMatch: { 'approver.email': user.email } }
//         };
//         pendingFilter = {
//           $and: [
//             {
//               'approvalChain': {
//                 $elemMatch: { 'approver.email': user.email, 'status': 'pending' }
//               }
//             },
//             { status: { $in: ALL_PENDING } }
//           ]
//         };

//       } else if (user.role === 'finance') {
//         // Finance: requests sitting at finance verification stage
//         baseFilter    = { status: { $in: ['pending_finance_verification', 'approved', 'completed', 'in_procurement', 'procurement_complete', 'delivered'] } };
//         pendingFilter = {
//           status: 'pending_finance_verification',
//           'approvalChain': {
//             $elemMatch: { 'approver.email': user.email, 'status': 'pending' }
//           }
//         };

//       } else if (user.role === 'supply_chain') {
//         // Supply chain: requests at their review / buyer-assignment stage
//         baseFilter    = { status: { $in: ['pending_supply_chain_review', 'pending_buyer_assignment', 'supply_chain_approved', 'in_procurement', 'procurement_complete'] } };
//         pendingFilter = { status: { $in: ['pending_supply_chain_review', 'pending_buyer_assignment'] } };

//       } else if (user.role === 'buyer') {
//         // Buyer: requisitions assigned to them
//         baseFilter    = { 'supplyChainReview.assignedBuyer': req.user.userId };
//         pendingFilter = {
//           'supplyChainReview.assignedBuyer': req.user.userId,
//           status: { $in: ['pending_buyer_assignment', 'in_procurement'] }
//         };

//       } else if (user.role === 'ceo') {
//         // CEO: only requests explicitly waiting for CEO sign-off
//         baseFilter    = {};
//         pendingFilter = { status: 'pending_ceo_approval' };

//       } else if (user.role === 'admin') {
//         baseFilter    = {};
//         pendingFilter = { status: { $in: ALL_PENDING } };

//       } else {
//         // Fallback — own requests
//         baseFilter    = { employee: req.user.userId };
//         pendingFilter = { employee: req.user.userId, status: { $in: ALL_PENDING } };
//       }

//       const [total, pending, approved, rejected, completed] = await Promise.all([
//         PurchaseRequisition.countDocuments(baseFilter),
//         PurchaseRequisition.countDocuments(pendingFilter),
//         PurchaseRequisition.countDocuments({ ...baseFilter, status: { $in: ['approved', 'in_procurement', 'procurement_complete', 'delivered'] } }),
//         PurchaseRequisition.countDocuments({ ...baseFilter, status: 'rejected' }),
//         PurchaseRequisition.countDocuments({ ...baseFilter, status: 'completed' })
//       ]);

//       res.json({
//         success: true,
//         data: { total, pending, approved, rejected, completed }
//       });

//     } catch (error) {
//       console.error('PR dashboard stats error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch purchase requisition stats',
//         error: error.message
//       });
//     }
//   }
// );



// ============================================
// PURCHASE REQUISITION DASHBOARD STATS
// (single definition — do NOT duplicate this route elsewhere in the file)
// ============================================
router.get(
  '/dashboard-stats',
  authMiddleware,
  async (req, res) => {
    try {
      const PurchaseRequisition = require('../models/PurchaseRequisition');
      const User = require('../models/User');

      const user = await User.findById(req.user.userId);

      const ALL_PENDING = [
        'pending_supervisor',
        'pending_finance_verification',
        'pending_supply_chain_review',
        'pending_buyer_assignment',
        'pending_head_approval',
        'pending_ceo_approval'
      ];

      let baseFilter = {};
      let pendingFilter = {};

      if (user.role === 'employee') {
        baseFilter = { employee: req.user.userId };
        pendingFilter = { employee: req.user.userId, status: { $in: ALL_PENDING } };

      } else if (['supervisor', 'technical', 'hr', 'it', 'hse', 'project'].includes(user.role)) {
        // Only requisitions where this user currently has a pending approval-chain step
        baseFilter = {
          'approvalChain': { $elemMatch: { 'approver.email': user.email } }
        };
        pendingFilter = {
          $and: [
            {
              'approvalChain': {
                $elemMatch: { 'approver.email': user.email, 'status': 'pending' }
              }
            },
            { status: 'pending_supervisor' }
          ]
        };

      } else if (user.role === 'finance') {
        // Finance verification is a separate field, not part of approvalChain
        baseFilter = {
          status: {
            $in: [
              'pending_finance_verification', 'pending_supply_chain_review',
              'pending_buyer_assignment', 'pending_head_approval',
              'pending_ceo_approval', 'approved', 'in_procurement',
              'procurement_complete', 'delivered', 'completed',
              'partially_disbursed', 'fully_disbursed'
            ]
          }
        };
        pendingFilter = { status: 'pending_finance_verification' };

      } else if (user.role === 'supply_chain') {
        baseFilter = {
          status: {
            $in: [
              'pending_supply_chain_review', 'pending_buyer_assignment',
              'pending_head_approval', 'pending_ceo_approval',
              'approved', 'in_procurement', 'procurement_complete', 'delivered'
            ]
          }
        };
        pendingFilter = { status: { $in: ['pending_supply_chain_review', 'pending_buyer_assignment'] } };

      } else if (user.role === 'buyer') {
        baseFilter = { 'supplyChainReview.assignedBuyer': req.user.userId };
        pendingFilter = {
          'supplyChainReview.assignedBuyer': req.user.userId,
          status: { $in: ['pending_head_approval', 'in_procurement'] }
        };

      } else if (user.role === 'ceo') {
        // CEO pending = only requisitions explicitly waiting on CEO sign-off
        baseFilter = {};
        pendingFilter = { status: 'pending_ceo_approval' };

      } else if (user.role === 'admin') {
        baseFilter = {};
        pendingFilter = { status: { $in: ALL_PENDING } };

      } else {
        baseFilter = { employee: req.user.userId };
        pendingFilter = { employee: req.user.userId, status: { $in: ALL_PENDING } };
      }

      const [total, pending, approved, rejected, completed] = await Promise.all([
        PurchaseRequisition.countDocuments(baseFilter),
        PurchaseRequisition.countDocuments(pendingFilter),
        PurchaseRequisition.countDocuments({ ...baseFilter, status: { $in: ['approved', 'in_procurement', 'procurement_complete', 'delivered'] } }),
        PurchaseRequisition.countDocuments({ ...baseFilter, status: 'rejected' }),
        PurchaseRequisition.countDocuments({ ...baseFilter, status: 'completed' })
      ]);

      res.json({
        success: true,
        data: { total, pending, approved, rejected, completed }
      });

    } catch (error) {
      console.error('PR dashboard stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch purchase requisition stats',
        error: error.message
      });
    }
  }
);

// Employee routes
router.post('/', 
  authMiddleware, 
  upload.array('attachments', 5),
  purchaseRequisitionController.createRequisition
);

router.get('/employee', 
  authMiddleware, 
  purchaseRequisitionController.getEmployeeRequisitions
);

// Finance routes
router.get('/finance', 
  authMiddleware, 
  requireRoles('finance', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getFinanceRequisitions
);

router.get('/finance/dashboard-data', 
  authMiddleware, 
  requireRoles('finance', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getFinanceDashboardData
);

// ✅ NEW: Pending disbursements (BEFORE generic routes)
router.get('/finance/pending-disbursements',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getPendingDisbursements
);

router.get('/finance/budget-codes', 
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getBudgetCodesForVerification
);

// // Dashboard stats
// router.get('/dashboard-stats', 
//   authMiddleware,
//   purchaseRequisitionController.getDashboardStats
// );

// Purchase requisition specific dashboard stats
router.get('/pr-dashboard-stats', 
  authMiddleware,
  purchaseRequisitionController.getPurchaseRequisitionDashboardStats
);

// Supervisor routes
router.get('/supervisor', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'it', 'ceo'), 
  purchaseRequisitionController.getSupervisorRequisitions
);

// Supply Chain Coordinator routes
router.get('/supply-chain', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getSupplyChainRequisitions
);

router.get('/supply-chain/pending-decisions',
  authMiddleware,
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  async (req, res) => {
    try {
      // Get requisitions pending supply chain business decisions
      const requisitions = await PurchaseRequisition.find({
        status: 'pending_supply_chain_review'
      })
      .populate('employee', 'fullName email department')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .sort({ createdAt: -1 });
      
      res.json({
        success: true,
        data: requisitions,
        count: requisitions.length
      });
    } catch (error) {
      console.error('Get pending supply chain decisions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch pending decisions',
        error: error.message
      });
    }
  }
);

// Buyer routes
router.get('/buyers/available',
  authMiddleware,
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getAvailableBuyers
);

router.get('/buyer', 
  authMiddleware, 
  requireRoles('buyer', 'supply_chain', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getBuyerRequisitions
);

// Head approval routes
router.get('/head-approval', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getHeadApprovalRequisitions
);

router.get('/head-approval/stats',
  authMiddleware,
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  async (req, res) => {
    try {
      const pending = await PurchaseRequisition.countDocuments({
        status: 'pending_head_approval'
      });
      
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      
      const approvedToday = await PurchaseRequisition.countDocuments({
        'headApproval.decision': 'approved',
        'headApproval.decisionDate': { $gte: startOfDay }
      });
      
      res.json({
        success: true,
        data: {
          pending,
          approvedToday,
          generatedAt: new Date()
        }
      });
    } catch (error) {
      console.error('Get head approval stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch stats',
        error: error.message
      });
    }
  }
);

// Admin routes
router.get('/admin', 
  authMiddleware, 
  requireRoles('admin', 'ceo', 'it'), 
  purchaseRequisitionController.getAllRequisitions
);

router.get(
  '/:requisitionId/petty-cash-pdf',
  authMiddleware,
  purchaseRequisitionController.generatePettyCashFormPDF
);


// ============================================
// ACTION ROUTES - NEW APPROVAL FLOW
// ============================================


// STEP 1: Finance Verification (Budget Check)
router.put('/:requisitionId/finance-verification', 
  authMiddleware, 
  requireRoles('finance', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.processFinanceVerification
);

router.post('/:requisitionId/finance-verification', 
  authMiddleware, 
  requireRoles('finance', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.processFinanceVerification
);

// STEP 2: Supply Chain Coordinator Business Decisions
router.put('/:requisitionId/supply-chain-decisions', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.processSupplyChainBusinessDecisions
);

router.post('/:requisitionId/supply-chain-decisions', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.processSupplyChainBusinessDecisions
);

// Supply Chain Reject
router.post('/:requisitionId/supply-chain-reject',
  authMiddleware,
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  supplyChainRejectionController.rejectSupplyChainRequisition
);

router.get('/head-approval/:requisitionId', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  purchaseRequisitionController.getHeadApprovalRequisition
);

// Supervisor decision
router.put('/:requisitionId/supervisor', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'ceo', 'it'), 
  purchaseRequisitionController.processSupervisorDecision
);

router.post('/:requisitionId/supervisor', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'ceo', 'it'), 
  purchaseRequisitionController.processSupervisorDecision
);

/**
 * Download attachment from purchase requisition
 * GET /api/purchase-requisitions/:requisitionId/attachments/:attachmentId/download
 */
router.get('/:requisitionId/attachments/:attachmentId/download',
  authMiddleware,
  async (req, res) => {
    try {
      const { requisitionId, attachmentId } = req.params;
      
      console.log('\n=== DOWNLOAD ATTACHMENT ===');
      console.log('Requisition ID:', requisitionId);
      console.log('Attachment ID:', attachmentId);
      console.log('User:', req.user.userId);

      // Get requisition
      const requisition = await PurchaseRequisition.findById(requisitionId)
        .populate('employee', 'fullName email department');

      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }

      // Check permissions
      const User = require('../models/User');
      const user = await User.findById(req.user.userId);
      const canView = 
        requisition.employee._id.equals(req.user.userId) || // Owner
        user.role === 'admin' || // Admin
        user.role === 'finance' || // Finance
        user.role === 'supply_chain' || // Supply Chain
        user.role === 'ceo' ||
        requisition.approvalChain?.some(step => step.approver.email === user.email); // Approver

      if (!canView) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this attachment.'
        });
      }

      // Find attachment
      const attachment = requisition.attachments?.find(
        att => att._id.toString() === attachmentId || att.publicId === attachmentId
      );

      if (!attachment) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found'
        });
      }

      console.log('Attachment found:', {
        name: attachment.name,
        publicId: attachment.publicId,
        localPath: attachment.localPath,
        size: attachment.size
      });

      // Serves from Cloudinary (streams remote URL) or local disk (legacy),
      // whichever this attachment was stored on.
      serveAttachment(attachment, res, 'attachment');

      console.log('✅ File download started');

    } catch (error) {
      console.error('Download attachment error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Failed to download attachment',
          error: error.message
        });
      }
    }
  }
);

/**
 * Preview attachment (opens in browser)
 * GET /api/purchase-requisitions/:requisitionId/attachments/:attachmentId/preview
 */
router.get('/:requisitionId/attachments/:attachmentId/preview',
  authMiddleware,
  async (req, res) => {
    try {
      const { requisitionId, attachmentId } = req.params;

      // Get requisition
      const requisition = await PurchaseRequisition.findById(requisitionId)
        .populate('employee', 'fullName email department');

      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }

      // Check permissions (same as download)
      const User = require('../models/User');
      const user = await User.findById(req.user.userId);
      const canView = 
        requisition.employee._id.equals(req.user.userId) ||
        user.role === 'admin' ||
        user.role === 'finance' ||
        user.role === 'supply_chain' ||
        user.role === 'ceo' ||
        requisition.approvalChain?.some(step => step.approver.email === user.email);

      if (!canView) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Find attachment
      const attachment = requisition.attachments?.find(
        att => att._id.toString() === attachmentId || att.publicId === attachmentId
      );

      if (!attachment) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found'
        });
      }

      // Serves from Cloudinary (streams remote URL) or local disk (legacy)
      serveAttachment(attachment, res, 'inline');

    } catch (error) {
      console.error('Preview attachment error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Failed to preview attachment',
          error: error.message
        });
      }
    }
  }
);

/**
 * Get attachment metadata
 * GET /api/purchase-requisitions/:requisitionId/attachments/:attachmentId
 */
router.get('/:requisitionId/attachments/:attachmentId',
  authMiddleware,
  async (req, res) => {
    try {
      const { requisitionId, attachmentId } = req.params;

      const requisition = await PurchaseRequisition.findById(requisitionId)
        .populate('employee', 'fullName email');

      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }

      // Check permissions
      const User = require('../models/User');
      const user = await User.findById(req.user.userId);
      const canView = 
        requisition.employee._id.equals(req.user.userId) ||
        user.role === 'admin' ||
        user.role === 'finance' ||
        user.role === 'supply_chain' ||
        user.role === 'ceo' ||
        requisition.approvalChain?.some(step => step.approver.email === user.email);

      if (!canView) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const attachment = requisition.attachments?.find(
        att => att._id.toString() === attachmentId || att.publicId === attachmentId
      );

      if (!attachment) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found'
        });
      }

      // Cloudinary attachments are always considered to exist (they're
      // served on demand); only legacy local-disk attachments need a
      // filesystem check.
      const source = attachment.localPath || attachment.url;
      const fileExists = isRemoteUrl(source)
        ? true
        : !!(source && require('fs').existsSync(source));

      res.json({
        success: true,
        data: {
          id: attachment._id,
          name: attachment.name,
          publicId: attachment.publicId,
          size: attachment.size,
          mimetype: attachment.mimetype,
          uploadedAt: attachment.uploadedAt,
          exists: fileExists,
          canPreview: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'].includes(attachment.mimetype)
        }
      });

    } catch (error) {
      console.error('Get attachment metadata error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get attachment metadata',
        error: error.message
      });
    }
  }
);

/**
 * Delete attachment (admin/owner only)
 * DELETE /api/purchase-requisitions/:requisitionId/attachments/:attachmentId
 */
router.delete('/:requisitionId/attachments/:attachmentId',
  authMiddleware,
  requireRoles('admin', 'ceo'),
  async (req, res) => {
    try {
      const { requisitionId, attachmentId } = req.params;

      const requisition = await PurchaseRequisition.findById(requisitionId);

      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }

      const attachmentIndex = requisition.attachments?.findIndex(
        att => att._id.toString() === attachmentId || att.publicId === attachmentId
      );

      if (attachmentIndex === -1) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found'
        });
      }

      const attachment = requisition.attachments[attachmentIndex];
      const source = attachment.localPath || attachment.url;

      if (isRemoteUrl(source)) {
        // Cloudinary-hosted file
        const result = await deleteCloudinaryFile(attachment);
        if (result.success) {
          console.log('✅ File deleted from Cloudinary:', attachment.publicId);
        } else {
          console.warn('⚠️  Could not delete from Cloudinary (continuing to remove DB record):', result.error);
        }
      } else if (source) {
        // Legacy local-disk file
        const fs = require('fs');
        if (fs.existsSync(source)) {
          await fs.promises.unlink(source);
          console.log('✅ File deleted:', source);
        }
      }

      // Remove from database
      requisition.attachments.splice(attachmentIndex, 1);
      await requisition.save();

      res.json({
        success: true,
        message: 'Attachment deleted successfully'
      });

    } catch (error) {
      console.error('Delete attachment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete attachment',
        error: error.message
      });
    }
  }
);

// ============================================
// DISBURSEMENT ROUTES (BEFORE generic :requisitionId)
// ============================================

// ✅ NEW: Process disbursement
router.post('/:requisitionId/disburse',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  purchaseRequisitionController.processDisbursement
);

// ✅ NEW: Get disbursement history
router.get('/:requisitionId/disbursements',
  authMiddleware,
  purchaseRequisitionController.getDisbursementHistory
);

// ============================================
// JUSTIFICATION ROUTES (BEFORE generic :requisitionId)
// ============================================

router.post(
  '/:requisitionId/justify',
  authMiddleware,
  upload.array('receipts', 10),
  purchaseRequisitionController.submitPurchaseRequisitionJustification
);

// Existing route (already there):
router.post(
  '/:requisitionId/justify',
  authMiddleware,
  upload.array('receipts', 10),
  purchaseRequisitionController.submitPurchaseRequisitionJustification
);

// ✅ ADD THIS — justification decision route for all approvers
router.post(
  '/:requisitionId/justification-decision',
  authMiddleware,
  requireRoles('employee', 'supervisor', 'technical', 'finance', 'supply_chain', 'hr', 'it', 'admin', 'ceo'),
  purchaseRequisitionController.processJustificationDecision
);

router.get(
  '/:requisitionId/justification',
  authMiddleware,
  purchaseRequisitionController.getPurchaseRequisitionJustification
);

router.get(
  '/:requisitionId/receipts/:receiptId/download',
  authMiddleware,
  purchaseRequisitionController.downloadJustificationReceipt
);

// ✅ NEW: Acknowledge disbursement receipt
router.post('/:requisitionId/disbursements/:disbursementId/acknowledge',
    authMiddleware,
    purchaseRequisitionController.acknowledgeDisbursement
);

// ✅ NEW: Resubmit rejected requisition
router.post('/:requisitionId/resubmit',
  authMiddleware,
  upload.array('attachments', 5),
  resubmitController.resubmitRequisition
);

// ✅ NEW: Get rejection history
router.get('/:requisitionId/rejection-history',
  authMiddleware,
  resubmitController.getRejectionHistory
);

// ✅ NEW: Request clarification from previous approver
router.post('/:requisitionId/request-clarification',
  authMiddleware,
  clarificationController.requestClarification
);

// ✅ NEW: Provide clarification response
router.post('/:requisitionId/provide-clarification',
  authMiddleware,
  clarificationController.provideClarification
);

// ✅ NEW: Get clarification history
router.get('/:requisitionId/clarification-history',
  authMiddleware,
  clarificationController.getClarificationHistory
);

// Get pending cancellation requests for current approver
router.get('/cancellation-requests',
  authMiddleware,
  cancellationController.getCancellationRequests
);

// Employee submits cancellation request
router.post('/:requisitionId/request-cancellation',
  authMiddleware,
  cancellationController.requestCancellation
);

// Approver processes the cancellation (approve or reject)
router.post('/:requisitionId/process-cancellation',
  authMiddleware,
  cancellationController.processCancellationApproval
);

// ============================================
// SUPPLY CHAIN DASHBOARD DATA (must stay above the generic /:requisitionId routes)
// ============================================
router.get('/dashboard/stats',
  authMiddleware,
  purchaseRequisitionController.getDashboardStats
);

router.get('/procurement/planning',
  authMiddleware,
  requireRoles('supply_chain', 'admin', 'ceo', 'it', 'finance', 'buyer', 'project'),
  purchaseRequisitionController.getProcurementPlanningData
);

router.get('/buyer-assignment-tracking',
  authMiddleware,
  requireRoles('supply_chain', 'admin', 'ceo', 'it'),
  async (req, res) => {
    try {
      const reqs = await PurchaseRequisition.find({
        'supplyChainReview.assignedBuyer': { $exists: true, $ne: null },
        status: { $in: ['pending_head_approval', 'pending_ceo', 'pending_ceo_approval', 'approved', 'in_procurement', 'procurement_complete'] }
      })
        .populate('supplyChainReview.assignedBuyer', 'fullName email')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();

      const stageOf = (status) => {
        if (status === 'procurement_complete') return 'procurement_complete';
        if (status === 'in_procurement') return 'sourcing_initiated';
        return 'assigned';
      };
      const labels = {
        assigned: 'Assigned',
        sourcing_initiated: 'Sourcing Initiated',
        quotes_evaluated: 'Quotes Evaluated',
        vendor_selected: 'Vendor Selected',
        purchase_order_created: 'PO Created',
        procurement_complete: 'Procurement Complete'
      };
      const stageCounts = Object.keys(labels).reduce((a, k) => ({ ...a, [k]: 0 }), {});

      const data = reqs.map((r) => {
        const stage = stageOf(r.status);
        stageCounts[stage] += 1;
        const assignedAt = r.supplyChainReview?.buyerAssignmentDate;
        return {
          requisitionId: r._id,
          requisitionNumber: r.requisitionNumber,
          title: r.title,
          assignedBuyer: r.supplyChainReview?.assignedBuyer
            ? { id: r.supplyChainReview.assignedBuyer._id, name: r.supplyChainReview.assignedBuyer.fullName }
            : null,
          stage,
          stageLabel: labels[stage],
          rfq: null,
          daysSinceAssignment: assignedAt ? Math.floor((Date.now() - new Date(assignedAt).getTime()) / 86400000) : null
        };
      });

      res.json({ success: true, data, stageCounts });
    } catch (error) {
      console.error('Buyer assignment tracking error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch buyer assignment tracking', error: error.message });
    }
  }
);

// ============================================
// SUPPLY CHAIN ANALYTICS (real figures computed from requisitions)
// GET /api/purchase-requisitions/analytics/supply-chain?period=monthly|quarterly|yearly&category=all|<itemCategory>
// ============================================
router.get('/analytics/supply-chain',
  authMiddleware,
  requireRoles('supply_chain', 'admin', 'ceo', 'it', 'finance', 'buyer', 'project'),
  async (req, res) => {
    try {
      const { period = 'quarterly', category = 'all' } = req.query;
      const windowMonths = period === 'monthly' ? 1 : period === 'yearly' ? 12 : 3;
      const trendMonths = Math.max(6, windowMonths);

      const now = new Date();
      const windowStart = new Date(now.getFullYear(), now.getMonth() - (windowMonths - 1), 1);
      const trendStart = new Date(now.getFullYear(), now.getMonth() - (trendMonths - 1), 1);

      const query = { status: { $ne: 'draft' }, createdAt: { $gte: trendStart } };
      if (category && category !== 'all') query.itemCategory = category;

      const all = await PurchaseRequisition.find(query)
        .select('status itemCategory budgetXAF createdAt approvalChain.actionDate approvalChain.status financeVerification.verificationDate supplyChainReview.buyerAssignmentDate headApproval.decisionDate procurementDetails.selectedVendor procurementDetails.finalCost procurementDetails.deliveryStatus procurementDetails.deliveryDate')
        .lean();

      const APPROVED_PLUS = ['approved', 'supply_chain_approved', 'partially_disbursed', 'fully_disbursed', 'in_procurement', 'procurement_complete', 'delivered', 'completed'];
      const REJECTED = ['rejected', 'supply_chain_rejected'];
      const DAY = 86400000;
      const days = (a, b) => (a && b ? (new Date(b) - new Date(a)) / DAY : null);
      const avg = (arr) => {
        const v = arr.filter((x) => x !== null && x !== undefined && x >= 0);
        return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : 0;
      };
      const spendOf = (r) => (r.procurementDetails?.finalCost > 0 ? r.procurementDetails.finalCost : (r.budgetXAF || 0));
      const decisionTime = (r) => days(r.createdAt, r.headApproval?.decisionDate);

      const inWindow = all.filter((r) => new Date(r.createdAt) >= windowStart);
      const approved = inWindow.filter((r) => APPROVED_PLUS.includes(r.status));
      const rejected = inWindow.filter((r) => REJECTED.includes(r.status));

      const totalSpend = approved.reduce((a, r) => a + spendOf(r), 0);
      const totalAllocated = approved.reduce((a, r) => a + (r.budgetXAF || 0), 0);
      const costSavings = approved.reduce((a, r) => {
        const fc = r.procurementDetails?.finalCost;
        return fc > 0 && r.budgetXAF > fc ? a + (r.budgetXAF - fc) : a;
      }, 0);
      const delivered = inWindow.filter((r) => r.procurementDetails?.deliveryStatus === 'delivered').length;
      const delayed = inWindow.filter((r) => r.procurementDetails?.deliveryStatus === 'delayed').length;
      const vendorsInWindow = new Set(inWindow.map((r) => r.procurementDetails?.selectedVendor).filter(Boolean));
      const decided = approved.length + rejected.length;

      const summary = {
        totalRequisitions: inWindow.length,
        totalSpend,
        averageProcessingTime: avg(inWindow.map(decisionTime)),
        approvalRate: decided ? Math.round((approved.length / decided) * 100) : 0,
        budgetUtilization: totalAllocated ? Math.min(100, Math.round((totalSpend / totalAllocated) * 100)) : 0,
        activeVendors: vendorsInWindow.size,
        costSavings,
        deliveryPerformance: delivered + delayed ? Math.round((delivered / (delivered + delayed)) * 100) : 0
      };

      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const trendData = [];
      for (let i = trendMonths - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const rows = all.filter((r) => new Date(r.createdAt) >= d && new Date(r.createdAt) < next);
        trendData.push({
          month: `${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${String(d.getFullYear()).slice(2)}` : ''}`,
          requisitions: rows.length,
          spend: rows.filter((r) => APPROVED_PLUS.includes(r.status)).reduce((a, r) => a + spendOf(r), 0),
          avgTime: avg(rows.map(decisionTime))
        });
      }

      const catMap = {};
      inWindow.forEach((r) => {
        const k = r.itemCategory && r.itemCategory !== 'all' ? r.itemCategory : 'Other';
        catMap[k] = catMap[k] || { name: k, count: 0, spend: 0 };
        catMap[k].count += 1;
        if (APPROVED_PLUS.includes(r.status)) catMap[k].spend += spendOf(r);
      });
      const categoryBreakdown = Object.values(catMap)
        .map((c) => ({ ...c, value: inWindow.length ? Math.round((c.count / inWindow.length) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);

      const vMap = {};
      inWindow.forEach((r) => {
        const v = r.procurementDetails?.selectedVendor;
        if (!v) return;
        vMap[v] = vMap[v] || { name: v, orders: 0, spend: 0, delivered: 0, delayed: 0 };
        vMap[v].orders += 1;
        vMap[v].spend += spendOf(r);
        if (r.procurementDetails.deliveryStatus === 'delivered') vMap[v].delivered += 1;
        if (r.procurementDetails.deliveryStatus === 'delayed') vMap[v].delayed += 1;
      });
      const ratingByName = {};
      try {
        const SupplierPerformance = require('../models/SupplierPerformance');
        const perf = await SupplierPerformance.aggregate([
          { $match: { supplierName: { $in: Object.keys(vMap) } } },
          { $group: { _id: '$supplierName', score: { $avg: '$overallScore' } } }
        ]);
        perf.forEach((p) => { ratingByName[p._id] = Math.round((p.score / 20) * 10) / 10; });
      } catch (e) { /* ratings are optional */ }
      const vendorPerformance = Object.values(vMap)
        .map((v) => ({
          name: v.name,
          rating: ratingByName[v.name] ?? null,
          orders: v.orders,
          onTime: v.delivered + v.delayed ? Math.round((v.delivered / (v.delivered + v.delayed)) * 100) : null,
          spend: v.spend
        }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 10);

      const lastSupervisor = (r) => {
        const ds = (r.approvalChain || []).filter((s) => s.status === 'approved' && s.actionDate).map((s) => new Date(s.actionDate));
        return ds.length ? new Date(Math.max(...ds)) : null;
      };
      const stageDefs = [
        { stage: 'Supervisor Approval', from: (r) => r.createdAt, to: lastSupervisor },
        { stage: 'Finance Verification', from: lastSupervisor, to: (r) => r.financeVerification?.verificationDate },
        { stage: 'Supply Chain Review', from: (r) => r.financeVerification?.verificationDate, to: (r) => r.supplyChainReview?.buyerAssignmentDate },
        { stage: 'Head of Business Approval', from: (r) => r.supplyChainReview?.buyerAssignmentDate, to: (r) => r.headApproval?.decisionDate }
      ];
      const processingTimes = stageDefs.map((d) => {
        const reached = inWindow.filter((r) => d.to(r));
        return {
          stage: d.stage,
          avgDays: avg(reached.map((r) => days(d.from(r), d.to(r)))),
          percentage: inWindow.length ? Math.round((reached.length / inWindow.length) * 100) : 0
        };
      });

      const alerts = [];
      if (summary.budgetUtilization >= 80) alerts.push({ type: 'warning', message: `Budget utilization at ${summary.budgetUtilization}%`, category: 'Budget' });
      const stuck = inWindow.filter((r) => ['pending_supply_chain_review', 'pending_buyer_assignment'].includes(r.status) && (Date.now() - new Date(r.createdAt)) > 7 * DAY).length;
      if (stuck) alerts.push({ type: 'warning', message: `${stuck} requisition(s) waiting at Supply Chain for over 7 days`, category: 'Workflow' });
      if (delayed) alerts.push({ type: 'info', message: `${delayed} delayed deliveries in this period`, category: 'Delivery' });
      if (summary.approvalRate >= 90 && decided >= 5) alerts.push({ type: 'success', message: `Approval rate is ${summary.approvalRate}%`, category: 'Efficiency' });

      res.json({ success: true, data: { summary, trendData, categoryBreakdown, vendorPerformance, processingTimes, alerts } });
    } catch (error) {
      console.error('Supply chain analytics error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch supply chain analytics', error: error.message });
    }
  }
);

// ============================================
// GENERIC ROUTES (last)
// ============================================

router.get('/:requisitionId', 
  authMiddleware, 
  purchaseRequisitionController.getEmployeeRequisition
);

router.put('/:requisitionId',
  authMiddleware,
  upload.array('attachments', 5),
  purchaseRequisitionController.updateRequisition
);

router.delete('/:requisitionId',
  authMiddleware,
  purchaseRequisitionController.deleteRequisition
);

router.get('/:requisitionId', 
  authMiddleware, 
  purchaseRequisitionController.getEmployeeRequisition
);

module.exports = router;











// const express = require('express');
// const router = express.Router();
// const purchaseRequisitionController = require('../controllers/purchaseRequisitionController');
// const resubmitController = require('../controllers/resubmitRequisitionController');
// const clarificationController = require('../controllers/clarificationController');
// const supplyChainRejectionController = require('../controllers/supplyChainRejectionController');
// const cancellationController = require('../controllers/Cancellationcontroller');
// const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
// const { 
//   downloadFile, 
//   getFileMetadata,
//   deleteFile 
// } = require('../utils/localFileStorage');
// const upload = require('../middlewares/uploadMiddleware');

// // ✅ ADD THIS LINE - Import PurchaseRequisition model
// const PurchaseRequisition = require('../models/PurchaseRequisition');

// // ============================================
// // STATIC ROUTES FIRST
// // ============================================

// // // Dashboard stats
// // router.get('/dashboard-stats', 
// //   authMiddleware,
// //   purchaseRequisitionController.getDashboardStats
// // );

// router.get(
//   '/dashboard-stats',
//   authMiddleware,
//   async (req, res) => {
//     try {
//       const PurchaseRequisition = require('../models/PurchaseRequisition');
//       const User = require('../models/User');

//       const user = await User.findById(req.user.userId);

//       const ALL_PENDING = [
//         'pending_supervisor',
//         'pending_finance_verification',
//         'pending_supply_chain_review',
//         'pending_buyer_assignment',
//         'pending_head_approval',
//         'pending_ceo_approval'
//       ];

//       let baseFilter   = {};
//       let pendingFilter = {};

//       if (user.role === 'employee') {
//         // Employee sees only their own requisitions
//         baseFilter    = { employee: req.user.userId };
//         pendingFilter = { employee: req.user.userId, status: { $in: ALL_PENDING } };

//       } else if (['supervisor', 'technical', 'hr', 'it', 'hse', 'project'].includes(user.role)) {
//         // Supervisor-type roles: only requests where it is currently their turn
//         baseFilter = {
//           'approvalChain': { $elemMatch: { 'approver.email': user.email } }
//         };
//         pendingFilter = {
//           $and: [
//             {
//               'approvalChain': {
//                 $elemMatch: { 'approver.email': user.email, 'status': 'pending' }
//               }
//             },
//             { status: { $in: ALL_PENDING } }
//           ]
//         };

//       } else if (user.role === 'finance') {
//         // Finance: requests sitting at finance verification stage
//         baseFilter    = { status: { $in: ['pending_finance_verification', 'approved', 'completed', 'in_procurement', 'procurement_complete', 'delivered'] } };
//         pendingFilter = {
//           status: 'pending_finance_verification',
//           'approvalChain': {
//             $elemMatch: { 'approver.email': user.email, 'status': 'pending' }
//           }
//         };

//       } else if (user.role === 'supply_chain') {
//         // Supply chain: requests at their review / buyer-assignment stage
//         baseFilter    = { status: { $in: ['pending_supply_chain_review', 'pending_buyer_assignment', 'supply_chain_approved', 'in_procurement', 'procurement_complete'] } };
//         pendingFilter = { status: { $in: ['pending_supply_chain_review', 'pending_buyer_assignment'] } };

//       } else if (user.role === 'buyer') {
//         // Buyer: requisitions assigned to them
//         baseFilter    = { 'supplyChainReview.assignedBuyer': req.user.userId };
//         pendingFilter = {
//           'supplyChainReview.assignedBuyer': req.user.userId,
//           status: { $in: ['pending_buyer_assignment', 'in_procurement'] }
//         };

//       } else if (user.role === 'ceo') {
//         // CEO: only requests explicitly waiting for CEO sign-off
//         baseFilter    = {};
//         pendingFilter = { status: 'pending_ceo_approval' };

//       } else if (user.role === 'admin') {
//         baseFilter    = {};
//         pendingFilter = { status: { $in: ALL_PENDING } };

//       } else {
//         // Fallback — own requests
//         baseFilter    = { employee: req.user.userId };
//         pendingFilter = { employee: req.user.userId, status: { $in: ALL_PENDING } };
//       }

//       const [total, pending, approved, rejected, completed] = await Promise.all([
//         PurchaseRequisition.countDocuments(baseFilter),
//         PurchaseRequisition.countDocuments(pendingFilter),
//         PurchaseRequisition.countDocuments({ ...baseFilter, status: { $in: ['approved', 'in_procurement', 'procurement_complete', 'delivered'] } }),
//         PurchaseRequisition.countDocuments({ ...baseFilter, status: 'rejected' }),
//         PurchaseRequisition.countDocuments({ ...baseFilter, status: 'completed' })
//       ]);

//       res.json({
//         success: true,
//         data: { total, pending, approved, rejected, completed }
//       });

//     } catch (error) {
//       console.error('PR dashboard stats error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch purchase requisition stats',
//         error: error.message
//       });
//     }
//   }
// );

// // Employee routes
// router.post('/', 
//   authMiddleware, 
//   upload.array('attachments', 5),
//   purchaseRequisitionController.createRequisition
// );

// router.get('/employee', 
//   authMiddleware, 
//   purchaseRequisitionController.getEmployeeRequisitions
// );

// // Finance routes
// router.get('/finance', 
//   authMiddleware, 
//   requireRoles('finance', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getFinanceRequisitions
// );

// router.get('/finance/dashboard-data', 
//   authMiddleware, 
//   requireRoles('finance', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getFinanceDashboardData
// );

// // ✅ NEW: Pending disbursements (BEFORE generic routes)
// router.get('/finance/pending-disbursements',
//   authMiddleware,
//   requireRoles('finance', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getPendingDisbursements
// );

// router.get('/finance/budget-codes', 
//   authMiddleware,
//   requireRoles('finance', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getBudgetCodesForVerification
// );

// // Dashboard stats
// router.get('/dashboard-stats', 
//   authMiddleware,
//   purchaseRequisitionController.getDashboardStats
// );

// // Purchase requisition specific dashboard stats
// router.get('/pr-dashboard-stats', 
//   authMiddleware,
//   purchaseRequisitionController.getPurchaseRequisitionDashboardStats
// );

// // Supervisor routes
// router.get('/supervisor', 
//   authMiddleware, 
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'it', 'ceo'), 
//   purchaseRequisitionController.getSupervisorRequisitions
// );

// // Supply Chain Coordinator routes
// router.get('/supply-chain', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getSupplyChainRequisitions
// );

// router.get('/supply-chain/pending-decisions',
//   authMiddleware,
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   async (req, res) => {
//     try {
//       // Get requisitions pending supply chain business decisions
//       const requisitions = await PurchaseRequisition.find({
//         status: 'pending_supply_chain_review'
//       })
//       .populate('employee', 'fullName email department')
//       .populate('financeVerification.verifiedBy', 'fullName email')
//       .sort({ createdAt: -1 });
      
//       res.json({
//         success: true,
//         data: requisitions,
//         count: requisitions.length
//       });
//     } catch (error) {
//       console.error('Get pending supply chain decisions error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch pending decisions',
//         error: error.message
//       });
//     }
//   }
// );

// // Buyer routes
// router.get('/buyers/available',
//   authMiddleware,
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getAvailableBuyers
// );

// router.get('/buyer', 
//   authMiddleware, 
//   requireRoles('buyer', 'supply_chain', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getBuyerRequisitions
// );

// // Head approval routes
// router.get('/head-approval', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getHeadApprovalRequisitions
// );

// router.get('/head-approval/stats',
//   authMiddleware,
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   async (req, res) => {
//     try {
//       const pending = await PurchaseRequisition.countDocuments({
//         status: 'pending_head_approval'
//       });
      
//       const startOfDay = new Date();
//       startOfDay.setHours(0, 0, 0, 0);
      
//       const approvedToday = await PurchaseRequisition.countDocuments({
//         'headApproval.decision': 'approved',
//         'headApproval.decisionDate': { $gte: startOfDay }
//       });
      
//       res.json({
//         success: true,
//         data: {
//           pending,
//           approvedToday,
//           generatedAt: new Date()
//         }
//       });
//     } catch (error) {
//       console.error('Get head approval stats error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch stats',
//         error: error.message
//       });
//     }
//   }
// );

// // Admin routes
// router.get('/admin', 
//   authMiddleware, 
//   requireRoles('admin', 'ceo', 'it'), 
//   purchaseRequisitionController.getAllRequisitions
// );

// router.get(
//   '/:requisitionId/petty-cash-pdf',
//   authMiddleware,
//   purchaseRequisitionController.generatePettyCashFormPDF
// );


// // ============================================
// // ACTION ROUTES - NEW APPROVAL FLOW
// // ============================================


// // STEP 1: Finance Verification (Budget Check)
// router.put('/:requisitionId/finance-verification', 
//   authMiddleware, 
//   requireRoles('finance', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.processFinanceVerification
// );

// router.post('/:requisitionId/finance-verification', 
//   authMiddleware, 
//   requireRoles('finance', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.processFinanceVerification
// );

// // STEP 2: Supply Chain Coordinator Business Decisions
// router.put('/:requisitionId/supply-chain-decisions', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.processSupplyChainBusinessDecisions
// );

// router.post('/:requisitionId/supply-chain-decisions', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.processSupplyChainBusinessDecisions
// );

// // Supply Chain Reject
// router.post('/:requisitionId/supply-chain-reject',
//   authMiddleware,
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   supplyChainRejectionController.rejectSupplyChainRequisition
// );

// router.get('/head-approval/:requisitionId', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin', 'ceo', 'it'),
//   purchaseRequisitionController.getHeadApprovalRequisition
// );

// // Supervisor decision
// router.put('/:requisitionId/supervisor', 
//   authMiddleware, 
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'ceo', 'it'), 
//   purchaseRequisitionController.processSupervisorDecision
// );

// router.post('/:requisitionId/supervisor', 
//   authMiddleware, 
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'ceo', 'it'), 
//   purchaseRequisitionController.processSupervisorDecision
// );

// /**
//  * Download attachment from purchase requisition
//  * GET /api/purchase-requisitions/:requisitionId/attachments/:attachmentId/download
//  */
// router.get('/:requisitionId/attachments/:attachmentId/download',
//   authMiddleware,
//   async (req, res) => {
//     try {
//       const { requisitionId, attachmentId } = req.params;
      
//       console.log('\n=== DOWNLOAD ATTACHMENT ===');
//       console.log('Requisition ID:', requisitionId);
//       console.log('Attachment ID:', attachmentId);
//       console.log('User:', req.user.userId);

//       // Get requisition
//       const requisition = await PurchaseRequisition.findById(requisitionId)
//         .populate('employee', 'fullName email department');

//       if (!requisition) {
//         return res.status(404).json({
//           success: false,
//           message: 'Requisition not found'
//         });
//       }

//       // Check permissions
//       const User = require('../models/User');
//       const user = await User.findById(req.user.userId);
//       const canView = 
//         requisition.employee._id.equals(req.user.userId) || // Owner
//         user.role === 'admin' || // Admin
//         user.role === 'finance' || // Finance
//         user.role === 'supply_chain' || // Supply Chain
//         user.role === 'ceo' ||
//         requisition.approvalChain?.some(step => step.approver.email === user.email); // Approver

//       if (!canView) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied. You do not have permission to view this attachment.'
//         });
//       }

//       // Find attachment
//       const attachment = requisition.attachments?.find(
//         att => att._id.toString() === attachmentId || att.publicId === attachmentId
//       );

//       if (!attachment) {
//         return res.status(404).json({
//           success: false,
//           message: 'Attachment not found'
//         });
//       }

//       console.log('Attachment found:', {
//         name: attachment.name,
//         publicId: attachment.publicId,
//         localPath: attachment.localPath,
//         size: attachment.size
//       });

//       // Check if file exists locally
//       const fs = require('fs');
//       if (!attachment.localPath || !fs.existsSync(attachment.localPath)) {
//         console.error('File not found at path:', attachment.localPath);
//         return res.status(404).json({
//           success: false,
//           message: 'File not found on server. It may have been deleted.'
//         });
//       }

//       // Set headers for download
//       res.setHeader('Content-Type', attachment.mimetype || 'application/octet-stream');
//       res.setHeader('Content-Disposition', `attachment; filename="${attachment.name}"`);
//       res.setHeader('Content-Length', attachment.size);

//       // Stream file to response
//       const fileStream = fs.createReadStream(attachment.localPath);
//       fileStream.pipe(res);

//       fileStream.on('error', (error) => {
//         console.error('Error streaming file:', error);
//         if (!res.headersSent) {
//           res.status(500).json({
//             success: false,
//             message: 'Error downloading file'
//           });
//         }
//       });

//       console.log('✅ File download started');

//     } catch (error) {
//       console.error('Download attachment error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to download attachment',
//         error: error.message
//       });
//     }
//   }
// );

// /**
//  * Preview attachment (opens in browser)
//  * GET /api/purchase-requisitions/:requisitionId/attachments/:attachmentId/preview
//  */
// router.get('/:requisitionId/attachments/:attachmentId/preview',
//   authMiddleware,
//   async (req, res) => {
//     try {
//       const { requisitionId, attachmentId } = req.params;

//       // Get requisition
//       const requisition = await PurchaseRequisition.findById(requisitionId)
//         .populate('employee', 'fullName email department');

//       if (!requisition) {
//         return res.status(404).json({
//           success: false,
//           message: 'Requisition not found'
//         });
//       }

//       // Check permissions (same as download)
//       const User = require('../models/User');
//       const user = await User.findById(req.user.userId);
//       const canView = 
//         requisition.employee._id.equals(req.user.userId) ||
//         user.role === 'admin' ||
//         user.role === 'finance' ||
//         user.role === 'supply_chain' ||
//         user.role === 'ceo' ||
//         requisition.approvalChain?.some(step => step.approver.email === user.email);

//       if (!canView) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//       }

//       // Find attachment
//       const attachment = requisition.attachments?.find(
//         att => att._id.toString() === attachmentId || att.publicId === attachmentId
//       );

//       if (!attachment) {
//         return res.status(404).json({
//           success: false,
//           message: 'Attachment not found'
//         });
//       }

//       // Check if file exists
//       const fs = require('fs');
//       if (!attachment.localPath || !fs.existsSync(attachment.localPath)) {
//         return res.status(404).json({
//           success: false,
//           message: 'File not found on server'
//         });
//       }

//       // Set headers for inline display
//       res.setHeader('Content-Type', attachment.mimetype || 'application/octet-stream');
//       res.setHeader('Content-Disposition', `inline; filename="${attachment.name}"`);
//       res.setHeader('Content-Length', attachment.size);

//       // Stream file
//       const fileStream = fs.createReadStream(attachment.localPath);
//       fileStream.pipe(res);

//       fileStream.on('error', (error) => {
//         console.error('Error streaming file:', error);
//         if (!res.headersSent) {
//           res.status(500).json({
//             success: false,
//             message: 'Error previewing file'
//           });
//         }
//       });

//     } catch (error) {
//       console.error('Preview attachment error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to preview attachment',
//         error: error.message
//       });
//     }
//   }
// );

// /**
//  * Get attachment metadata
//  * GET /api/purchase-requisitions/:requisitionId/attachments/:attachmentId
//  */
// router.get('/:requisitionId/attachments/:attachmentId',
//   authMiddleware,
//   async (req, res) => {
//     try {
//       const { requisitionId, attachmentId } = req.params;

//       const requisition = await PurchaseRequisition.findById(requisitionId)
//         .populate('employee', 'fullName email');

//       if (!requisition) {
//         return res.status(404).json({
//           success: false,
//           message: 'Requisition not found'
//         });
//       }

//       // Check permissions
//       const User = require('../models/User');
//       const user = await User.findById(req.user.userId);
//       const canView = 
//         requisition.employee._id.equals(req.user.userId) ||
//         user.role === 'admin' ||
//         user.role === 'finance' ||
//         user.role === 'supply_chain' ||
//         user.role === 'ceo' ||
//         requisition.approvalChain?.some(step => step.approver.email === user.email);

//       if (!canView) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//       }

//       const attachment = requisition.attachments?.find(
//         att => att._id.toString() === attachmentId || att.publicId === attachmentId
//       );

//       if (!attachment) {
//         return res.status(404).json({
//           success: false,
//           message: 'Attachment not found'
//         });
//       }

//       // Check if file exists
//       const fs = require('fs');
//       const fileExists = attachment.localPath && fs.existsSync(attachment.localPath);

//       res.json({
//         success: true,
//         data: {
//           id: attachment._id,
//           name: attachment.name,
//           publicId: attachment.publicId,
//           size: attachment.size,
//           mimetype: attachment.mimetype,
//           uploadedAt: attachment.uploadedAt,
//           exists: fileExists,
//           canPreview: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'].includes(attachment.mimetype)
//         }
//       });

//     } catch (error) {
//       console.error('Get attachment metadata error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to get attachment metadata',
//         error: error.message
//       });
//     }
//   }
// );

// /**
//  * Delete attachment (admin/owner only)
//  * DELETE /api/purchase-requisitions/:requisitionId/attachments/:attachmentId
//  */
// router.delete('/:requisitionId/attachments/:attachmentId',
//   authMiddleware,
//   requireRoles('admin', 'ceo'),
//   async (req, res) => {
//     try {
//       const { requisitionId, attachmentId } = req.params;

//       const requisition = await PurchaseRequisition.findById(requisitionId);

//       if (!requisition) {
//         return res.status(404).json({
//           success: false,
//           message: 'Requisition not found'
//         });
//       }

//       const attachmentIndex = requisition.attachments?.findIndex(
//         att => att._id.toString() === attachmentId || att.publicId === attachmentId
//       );

//       if (attachmentIndex === -1) {
//         return res.status(404).json({
//           success: false,
//           message: 'Attachment not found'
//         });
//       }

//       const attachment = requisition.attachments[attachmentIndex];

//       // Delete physical file
//       if (attachment.localPath) {
//         const fs = require('fs');
//         if (fs.existsSync(attachment.localPath)) {
//           await fs.promises.unlink(attachment.localPath);
//           console.log('✅ File deleted:', attachment.localPath);
//         }
//       }

//       // Remove from database
//       requisition.attachments.splice(attachmentIndex, 1);
//       await requisition.save();

//       res.json({
//         success: true,
//         message: 'Attachment deleted successfully'
//       });

//     } catch (error) {
//       console.error('Delete attachment error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to delete attachment',
//         error: error.message
//       });
//     }
//   }
// );

// // ============================================
// // DISBURSEMENT ROUTES (BEFORE generic :requisitionId)
// // ============================================

// // ✅ NEW: Process disbursement
// router.post('/:requisitionId/disburse',
//   authMiddleware,
//   requireRoles('finance', 'admin', 'ceo'),
//   purchaseRequisitionController.processDisbursement
// );

// // ✅ NEW: Get disbursement history
// router.get('/:requisitionId/disbursements',
//   authMiddleware,
//   purchaseRequisitionController.getDisbursementHistory
// );

// // ============================================
// // JUSTIFICATION ROUTES (BEFORE generic :requisitionId)
// // ============================================

// router.post(
//   '/:requisitionId/justify',
//   authMiddleware,
//   upload.array('receipts', 10),
//   purchaseRequisitionController.submitPurchaseRequisitionJustification
// );

// // Existing route (already there):
// router.post(
//   '/:requisitionId/justify',
//   authMiddleware,
//   upload.array('receipts', 10),
//   purchaseRequisitionController.submitPurchaseRequisitionJustification
// );

// // ✅ ADD THIS — justification decision route for all approvers
// router.post(
//   '/:requisitionId/justification-decision',
//   authMiddleware,
//   requireRoles('employee', 'supervisor', 'technical', 'finance', 'supply_chain', 'hr', 'it', 'admin', 'ceo'),
//   purchaseRequisitionController.processJustificationDecision
// );

// router.get(
//   '/:requisitionId/justification',
//   authMiddleware,
//   purchaseRequisitionController.getPurchaseRequisitionJustification
// );

// router.get(
//   '/:requisitionId/receipts/:receiptId/download',
//   authMiddleware,
//   purchaseRequisitionController.downloadJustificationReceipt
// );

// // ✅ NEW: Acknowledge disbursement receipt
// router.post('/:requisitionId/disbursements/:disbursementId/acknowledge',
//     authMiddleware,
//     purchaseRequisitionController.acknowledgeDisbursement
// );

// // ✅ NEW: Resubmit rejected requisition
// router.post('/:requisitionId/resubmit',
//   authMiddleware,
//   upload.array('attachments', 5),
//   resubmitController.resubmitRequisition
// );

// // ✅ NEW: Get rejection history
// router.get('/:requisitionId/rejection-history',
//   authMiddleware,
//   resubmitController.getRejectionHistory
// );

// // ✅ NEW: Request clarification from previous approver
// router.post('/:requisitionId/request-clarification',
//   authMiddleware,
//   clarificationController.requestClarification
// );

// // ✅ NEW: Provide clarification response
// router.post('/:requisitionId/provide-clarification',
//   authMiddleware,
//   clarificationController.provideClarification
// );

// // ✅ NEW: Get clarification history
// router.get('/:requisitionId/clarification-history',
//   authMiddleware,
//   clarificationController.getClarificationHistory
// );

// // Get pending cancellation requests for current approver
// router.get('/cancellation-requests',
//   authMiddleware,
//   cancellationController.getCancellationRequests
// );

// // Employee submits cancellation request
// router.post('/:requisitionId/request-cancellation',
//   authMiddleware,
//   cancellationController.requestCancellation
// );

// // Approver processes the cancellation (approve or reject)
// router.post('/:requisitionId/process-cancellation',
//   authMiddleware,
//   cancellationController.processCancellationApproval
// );

// // ============================================
// // GENERIC ROUTES (last)
// // ============================================

// router.get('/:requisitionId', 
//   authMiddleware, 
//   purchaseRequisitionController.getEmployeeRequisition
// );

// router.put('/:requisitionId',
//   authMiddleware,
//   purchaseRequisitionController.updateRequisition
// );

// router.delete('/:requisitionId',
//   authMiddleware,
//   purchaseRequisitionController.deleteRequisition
// );

// router.get('/:requisitionId', 
//   authMiddleware, 
//   purchaseRequisitionController.getEmployeeRequisition
// );

// module.exports = router;




