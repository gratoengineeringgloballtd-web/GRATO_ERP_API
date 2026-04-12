const express = require('express');
const router = express.Router();
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
const upload = require('../middlewares/uploadMiddleware');

// ✅ ADD THIS LINE - Import PurchaseRequisition model
const PurchaseRequisition = require('../models/PurchaseRequisition');

// ============================================
// STATIC ROUTES FIRST
// ============================================

// Dashboard stats
router.get('/dashboard-stats', 
  authMiddleware,
  purchaseRequisitionController.getDashboardStats
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
  requireRoles('finance', 'admin'),
  purchaseRequisitionController.getFinanceRequisitions
);

router.get('/finance/dashboard-data', 
  authMiddleware, 
  requireRoles('finance', 'admin'),
  purchaseRequisitionController.getFinanceDashboardData
);

// ✅ NEW: Pending disbursements (BEFORE generic routes)
router.get('/finance/pending-disbursements',
  authMiddleware,
  requireRoles('finance', 'admin'),
  purchaseRequisitionController.getPendingDisbursements
);

router.get('/finance/budget-codes', 
  authMiddleware,
  requireRoles('finance', 'admin'),
  purchaseRequisitionController.getBudgetCodesForVerification
);

// Dashboard stats
router.get('/dashboard-stats', 
  authMiddleware,
  purchaseRequisitionController.getDashboardStats
);

// Purchase requisition specific dashboard stats
router.get('/pr-dashboard-stats', 
  authMiddleware,
  purchaseRequisitionController.getPurchaseRequisitionDashboardStats
);

// Supervisor routes
router.get('/supervisor', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical'), 
  purchaseRequisitionController.getSupervisorRequisitions
);

// Supply Chain Coordinator routes
router.get('/supply-chain', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin'),
  purchaseRequisitionController.getSupplyChainRequisitions
);

router.get('/supply-chain/pending-decisions',
  authMiddleware,
  requireRoles('supply_chain', 'admin'),
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
  requireRoles('supply_chain', 'admin'),
  purchaseRequisitionController.getAvailableBuyers
);

router.get('/buyer', 
  authMiddleware, 
  requireRoles('buyer', 'supply_chain', 'admin'),
  purchaseRequisitionController.getBuyerRequisitions
);

// Head approval routes
router.get('/head-approval', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin'),
  purchaseRequisitionController.getHeadApprovalRequisitions
);

router.get('/head-approval/stats',
  authMiddleware,
  requireRoles('supply_chain', 'admin'),
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
  requireRoles('admin'), 
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
  requireRoles('finance', 'admin'),
  purchaseRequisitionController.processFinanceVerification
);

router.post('/:requisitionId/finance-verification', 
  authMiddleware, 
  requireRoles('finance', 'admin'),
  purchaseRequisitionController.processFinanceVerification
);

// STEP 2: Supply Chain Coordinator Business Decisions
router.put('/:requisitionId/supply-chain-decisions', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin'),
  purchaseRequisitionController.processSupplyChainBusinessDecisions
);

router.post('/:requisitionId/supply-chain-decisions', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin'),
  purchaseRequisitionController.processSupplyChainBusinessDecisions
);

// Supply Chain Reject
router.post('/:requisitionId/supply-chain-reject',
  authMiddleware,
  requireRoles('supply_chain', 'admin'),
  supplyChainRejectionController.rejectSupplyChainRequisition
);

router.get('/head-approval/:requisitionId', 
  authMiddleware, 
  requireRoles('supply_chain', 'admin'),
  purchaseRequisitionController.getHeadApprovalRequisition
);

// Supervisor decision
router.put('/:requisitionId/supervisor', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical'), 
  purchaseRequisitionController.processSupervisorDecision
);

router.post('/:requisitionId/supervisor', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical'), 
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

      // Check if file exists locally
      const fs = require('fs');
      if (!attachment.localPath || !fs.existsSync(attachment.localPath)) {
        console.error('File not found at path:', attachment.localPath);
        return res.status(404).json({
          success: false,
          message: 'File not found on server. It may have been deleted.'
        });
      }

      // Set headers for download
      res.setHeader('Content-Type', attachment.mimetype || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.name}"`);
      res.setHeader('Content-Length', attachment.size);

      // Stream file to response
      const fileStream = fs.createReadStream(attachment.localPath);
      fileStream.pipe(res);

      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Error downloading file'
          });
        }
      });

      console.log('✅ File download started');

    } catch (error) {
      console.error('Download attachment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download attachment',
        error: error.message
      });
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

      // Check if file exists
      const fs = require('fs');
      if (!attachment.localPath || !fs.existsSync(attachment.localPath)) {
        return res.status(404).json({
          success: false,
          message: 'File not found on server'
        });
      }

      // Set headers for inline display
      res.setHeader('Content-Type', attachment.mimetype || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${attachment.name}"`);
      res.setHeader('Content-Length', attachment.size);

      // Stream file
      const fileStream = fs.createReadStream(attachment.localPath);
      fileStream.pipe(res);

      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Error previewing file'
          });
        }
      });

    } catch (error) {
      console.error('Preview attachment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to preview attachment',
        error: error.message
      });
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

      // Check if file exists
      const fs = require('fs');
      const fileExists = attachment.localPath && fs.existsSync(attachment.localPath);

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
  requireRoles('admin'),
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

      // Delete physical file
      if (attachment.localPath) {
        const fs = require('fs');
        if (fs.existsSync(attachment.localPath)) {
          await fs.promises.unlink(attachment.localPath);
          console.log('✅ File deleted:', attachment.localPath);
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
  requireRoles('finance', 'admin'),
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
// GENERIC ROUTES (last)
// ============================================

router.get('/:requisitionId', 
  authMiddleware, 
  purchaseRequisitionController.getEmployeeRequisition
);

router.put('/:requisitionId',
  authMiddleware,
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




