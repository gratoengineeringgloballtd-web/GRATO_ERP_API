const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const { upload, handleMulterError } = require('../middlewares/uploadMiddleware');
const pdfService = require('../services/pdfService');
const { saveFile, STORAGE_CATEGORIES } = require('../utils/localFileStorage');
const { buildPurchaseOrderPdfData } = require('../services/purchaseOrderPdfData');

// Import controllers
const buyerRequisitionController = require('../controllers/buyerRequisitionController');
const buyerPurchaseOrderController = require('../controllers/buyerPurchaseOrderController');
const buyerDeliveryController = require('../controllers/buyerDeliveryController');
const quotationController = require('../controllers/quotationController');
const debitNoteController = require('../controllers/debitNoteController');

// Destructure tenderJustificationUpload alongside the controller functions
const { tenderJustificationUpload } = buyerPurchaseOrderController;

// Middleware to ensure only buyers, supply_chain users, and admins can access
const buyerAuthMiddleware = requireRoles('buyer', 'supply_chain', 'admin');

// =============================================
// ROUTE PARAMETER VALIDATION (MUST BE EARLY)
// =============================================

router.param('poId', async (req, res, next, poId) => {
  try {
    if (!poId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid purchase order ID format' });
    }
    req.poId = poId;
    next();
  } catch (error) { next(error); }
});

router.param('requisitionId', async (req, res, next, requisitionId) => {
  try {
    if (!requisitionId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid requisition ID format' });
    }
    req.requisitionId = requisitionId;
    next();
  } catch (error) { next(error); }
});

router.param('supplierId', async (req, res, next, supplierId) => {
  try {
    if (!supplierId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid supplier ID format' });
    }
    req.supplierId = supplierId;
    next();
  } catch (error) { next(error); }
});

router.param('quoteId', async (req, res, next, quoteId) => {
  try {
    if (!quoteId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid quote ID format' });
    }
    req.quoteId = quoteId;
    next();
  } catch (error) { next(error); }
});

router.param('debitNoteId', async (req, res, next, debitNoteId) => {
  try {
    if (!debitNoteId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid debit note ID format' });
    }
    req.debitNoteId = debitNoteId;
    next();
  } catch (error) { next(error); }
});

router.param('formId', async (req, res, next, formId) => {
  try {
    if (!formId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid petty cash form ID format' });
    }
    req.formId = formId;
    next();
  } catch (error) { next(error); }
});

// =============================================
// SUPPLY CHAIN PO MANAGEMENT ROUTES (SPECIFIC ROUTES FIRST)
// =============================================

router.get('/purchase-orders/supply-chain/stats',
  authMiddleware,
  requireRoles('supply_chain', 'admin'),
  buyerPurchaseOrderController.getSupplyChainPOStats
);

router.get('/purchase-orders/supply-chain/pending',
  authMiddleware,
  requireRoles('supply_chain', 'admin'),
  buyerPurchaseOrderController.getSupplyChainPendingPOs
);

// =============================================
// SUPERVISOR PO MANAGEMENT ROUTES
// =============================================

router.get('/purchase-orders/supervisor/pending',
  authMiddleware,
  requireRoles('supervisor', 'admin', 'hr', 'technical', 'finance', 'it', 'employee'),
  async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const PurchaseOrder = require('../models/PurchaseOrder');
      const User = require('../models/User');

      const currentUser = await User.findById(req.user.userId);
      if (!currentUser) return res.status(404).json({ success: false, message: 'User not found' });

      const pendingPOs = await PurchaseOrder.find({
        'approvalChain.approver.email': currentUser.email,
        $or: [
          { status: 'pending_department_approval' },
          { status: 'pending_head_of_business_approval' },
          { status: 'pending_finance_approval' },
          { status: 'pending_head_approval' },
          { status: 'pending_approval' }
        ]
      })
        .populate('supplierId', 'name email phone')
        .populate('buyerId', 'fullName email')
        .populate('requisitionId', 'requisitionNumber title')
        .sort({ createdAt: -1 });

      const filteredPOs = pendingPOs.filter(po => {
        const currentStep = po.approvalChain?.find(step =>
          step.level === po.currentApprovalLevel &&
          step.approver?.email === currentUser.email &&
          step.status === 'pending'
        );
        return !!currentStep;
      });

      const formattedPOs = filteredPOs.map(po => ({
        id: po._id,
        poNumber: po.poNumber,
        supplierName: po.supplierDetails?.name || po.supplierId?.name || 'Unknown',
        supplierEmail: po.supplierDetails?.email || po.supplierId?.email || '',
        totalAmount: po.totalAmount,
        currency: po.currency || 'XAF',
        items: po.items || [],
        status: po.status,
        creationDate: po.createdAt,
        expectedDeliveryDate: po.expectedDeliveryDate,
        approvalChain: po.approvalChain,
        currentApprovalLevel: po.currentApprovalLevel,
        requisitionNumber: po.requisitionId?.requisitionNumber,
        buyerName: po.buyerId?.fullName
      }));

      res.json({ success: true, data: formattedPOs, count: formattedPOs.length });
    } catch (error) {
      console.error('Get supervisor pending POs error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch pending purchase orders', error: error.message });
    }
  }
);

router.get('/purchase-orders/supervisor/stats',
  authMiddleware,
  requireRoles('supervisor', 'admin'),
  async (req, res) => {
    try {
      const PurchaseOrder = require('../models/PurchaseOrder');
      const stats = await PurchaseOrder.aggregate([
        { $match: { 'assignedDepartment.supervisorId': req.user.userId } },
        { $group: { _id: '$status', count: { $sum: 1 }, totalValue: { $sum: '$totalAmount' } } }
      ]);

      res.json({
        success: true,
        data: {
          pending: stats.find(s => s._id === 'pending_supervisor_approval')?.count || 0,
          approved: stats.find(s => s._id === 'approved')?.count || 0,
          rejected: stats.find(s => s._id === 'rejected')?.count || 0,
          total: stats.reduce((sum, s) => sum + s.count, 0),
          totalValue: stats.reduce((sum, s) => sum + s.totalValue, 0),
          breakdown: stats
        }
      });
    } catch (error) {
      console.error('Get supervisor PO stats error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch purchase order statistics', error: error.message });
    }
  }
);

// Approve PO (Supervisor)
router.post('/purchase-orders/:poId/approve',
  authMiddleware,
  async (req, res) => {
    try {
      const { poId } = req.params;
      const { decision, comments } = req.body;

      const PurchaseOrder = require('../models/PurchaseOrder');
      const User = require('../models/User');

      const po = await PurchaseOrder.findById(poId)
        .populate('supplierId', 'fullName email phone supplierDetails')
        .populate('items.itemId', 'code description category unitOfMeasure');

      if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });

      const currentUser = await User.findById(req.user.userId).select('fullName email signature');

      const currentStep = po.approvalChain?.find(step =>
        step.level === po.currentApprovalLevel &&
        step.approver?.email === currentUser.email &&
        step.status === 'pending'
      );

      if (!currentStep) return res.status(403).json({ success: false, message: 'You are not authorized to approve this purchase order at this stage' });
      if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ success: false, message: 'Invalid decision. Must be "approved" or "rejected"' });

      currentStep.status = decision;
      const actionDate = new Date();
      currentStep.actionDate = actionDate;
      currentStep.actionTime = actionDate.toTimeString().split(' ')[0];
      currentStep.comments = comments;

      if (decision === 'approved') {
        const signatureBlocks = [
          { label: 'Supply Chain', signaturePath: null, signedAt: po.supplyChainReview?.reviewDate || null },
          { label: 'Department Head' },
          { label: 'Head of Business' },
          { label: 'Finance' }
        ];

        if (po.supplyChainReview?.reviewedBy) {
          const scUser = await User.findById(po.supplyChainReview.reviewedBy).select('signature');
          signatureBlocks[0].signaturePath = scUser?.signature?.localPath || null;
        }

        const approverEmails = po.approvalChain
          ?.filter(step => step.status === 'approved' || step.level === currentStep.level)
          .map(step => step.approver?.email).filter(Boolean) || [];

        const approverUsers = approverEmails.length
          ? await User.find({ email: { $in: approverEmails } }).select('email signature')
          : [];
        const approverByEmail = new Map(approverUsers.map(u => [u.email, u]));

        po.approvalChain?.forEach(step => {
          const blockIndex = step.level;
          if (!signatureBlocks[blockIndex]) return;
          if (step.level === currentStep.level) {
            signatureBlocks[blockIndex].signaturePath = currentUser?.signature?.localPath || null;
            signatureBlocks[blockIndex].signedAt = actionDate;
            return;
          }
          if (step.status === 'approved') {
            const approverUser = approverByEmail.get(step.approver?.email);
            signatureBlocks[blockIndex].signaturePath = approverUser?.signature?.localPath || null;
            signatureBlocks[blockIndex].signedAt = step.actionDate || step.updatedAt || null;
          }
        });

        const pdfData = { ...buildPurchaseOrderPdfData(po), signatures: signatureBlocks };
        const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
        if (!pdfResult.success) return res.status(500).json({ success: false, message: pdfResult.error || 'Failed to generate signed document' });

        const signedDocData = await saveFile(
          { buffer: pdfResult.buffer, originalname: `PO-${po.poNumber}-Level-${currentStep.level}-signed.pdf`, mimetype: 'application/pdf', size: pdfResult.buffer.length },
          STORAGE_CATEGORIES.SIGNED_DOCUMENTS,
          `level-${currentStep.level}`,
          `PO-${po.poNumber}-Level-${currentStep.level}-signed-${Date.now()}.pdf`
        );

        currentStep.signedDocument = {
          publicId: signedDocData.publicId,
          url: signedDocData.url,
          localPath: signedDocData.localPath,
          format: signedDocData.format,
          resourceType: signedDocData.resourceType,
          bytes: signedDocData.bytes,
          originalName: signedDocData.originalName,
          uploadedAt: signedDocData.uploadedAt
        };
      }

      const maxLevel = Math.max(...po.approvalChain.map(step => step.level));

      if (decision === 'approved' && currentStep.level < maxLevel) {
        po.currentApprovalLevel = currentStep.level + 1;
        const nextStep = po.approvalChain.find(step => step.level === po.currentApprovalLevel);
        if (nextStep) {
          if (po.currentApprovalLevel === 2) po.status = 'pending_head_of_business_approval';
          else if (po.currentApprovalLevel === 3) po.status = 'pending_finance_approval';
          else po.status = 'pending_department_approval';
          nextStep.activatedDate = new Date();
        }
      } else if (decision === 'approved' && currentStep.level === maxLevel) {
        po.status = 'approved';
        po.approvalDate = new Date();
        po.currentApprovalLevel = maxLevel;
      } else if (decision === 'rejected') {
        po.status = 'rejected';
        po.rejectionDetails = { rejectedBy: req.user.userId, rejectedAt: new Date(), reason: comments || 'Rejected during approval process', stage: `level_${currentStep.level}` };
      }

      po.activities = po.activities || [];
      po.activities.push({ type: decision === 'approved' ? 'updated' : 'cancelled', description: comments || `Purchase order ${decision} by ${currentUser.fullName}`, user: currentUser.fullName, timestamp: new Date() });

      await po.save();

      res.json({ success: true, message: `Purchase order ${decision} successfully`, data: { poNumber: po.poNumber, status: po.status, currentLevel: po.currentApprovalLevel, decision } });
    } catch (error) {
      console.error('Approve PO error:', error);
      res.status(500).json({ success: false, message: 'Failed to process approval', error: error.message });
    }
  }
);

router.post('/purchase-orders/:poId/supervisor-reject',
  authMiddleware,
  requireRoles('supervisor', 'admin'),
  async (req, res) => {
    try {
      const { poId } = req.params;
      const { reason } = req.body;
      const PurchaseOrder = require('../models/PurchaseOrder');

      if (!reason || reason.trim().length === 0) return res.status(400).json({ success: false, message: 'Rejection reason is required' });

      const po = await PurchaseOrder.findById(poId);
      if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });
      if (po.assignedDepartment?.supervisorId?.toString() !== req.user.userId) {
        return res.status(403).json({ success: false, message: 'Unauthorized: You are not the assigned supervisor for this purchase order' });
      }
      if (po.status !== 'pending_supervisor_approval') {
        return res.status(400).json({ success: false, message: 'Purchase order is not in pending supervisor approval status' });
      }

      po.status = 'rejected';
      po.supervisorApproval = { rejectedBy: req.user.userId, rejectedAt: new Date(), reason };
      po.activities.push({ action: 'supervisor_rejected', performedBy: req.user.userId, timestamp: new Date(), details: `Purchase order rejected: ${reason}` });
      await po.save();

      res.json({ success: true, message: 'Purchase order rejected successfully', data: po });
    } catch (error) {
      console.error('Supervisor reject PO error:', error);
      res.status(500).json({ success: false, message: 'Failed to reject purchase order', error: error.message });
    }
  }
);

router.post('/purchase-orders/validate-bulk',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const { poIds } = req.body;
      if (!poIds || !Array.isArray(poIds) || poIds.length === 0) return res.status(400).json({ success: false, message: 'Purchase order IDs are required' });
      if (poIds.length > 50) return res.status(400).json({ success: false, message: 'Cannot process more than 50 purchase orders at once' });

      const PurchaseOrder = require('../models/PurchaseOrder');
      const purchaseOrders = await PurchaseOrder.find({ _id: { $in: poIds }, buyerId: req.user.userId })
        .select('poNumber status totalAmount currency supplierDetails.name createdAt');

      const validPoIds = purchaseOrders.map(po => po._id.toString());
      const invalidPoIds = poIds.filter(id => !validPoIds.includes(id));

      res.json({
        success: true,
        data: {
          validPurchaseOrders: purchaseOrders.map(po => ({ id: po._id, poNumber: po.poNumber, status: po.status, totalAmount: po.totalAmount, currency: po.currency, supplierName: po.supplierDetails?.name, creationDate: po.createdAt })),
          invalidPoIds,
          validCount: validPoIds.length,
          invalidCount: invalidPoIds.length,
          totalSelected: poIds.length
        }
      });
    } catch (error) {
      console.error('Validate bulk POs error:', error);
      res.status(500).json({ success: false, message: 'Failed to validate purchase orders', error: error.message });
    }
  }
);

router.post('/purchase-orders/bulk-download', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.bulkDownloadPurchaseOrders);
router.get('/purchase-orders/:poId/download-for-signing', authMiddleware, requireRoles('supply_chain', 'admin'), buyerPurchaseOrderController.downloadPOForSigning);

router.get('/purchase-orders/:poId/pdf-data',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const { poId } = req.params;
      const PurchaseOrder = require('../models/PurchaseOrder');
      const User = require('../models/User');

      const purchaseOrder = await PurchaseOrder.findById(poId)
        .populate('supplierId', 'fullName email phone supplierDetails')
        .populate('requisitionId', 'title requisitionNumber employee')
        .populate('items.itemId', 'code description category unitOfMeasure');

      if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });

      if (purchaseOrder.buyerId.toString() !== req.user.userId) {
        const user = await User.findById(req.user.userId);
        if (!['admin', 'supply_chain'].includes(user.role)) return res.status(403).json({ success: false, message: 'Unauthorized access to purchase order' });
      }

      const pdfData = {
        id: purchaseOrder._id,
        poNumber: purchaseOrder.poNumber,
        requisitionId: purchaseOrder.requisitionId?._id,
        requisitionTitle: purchaseOrder.requisitionId?.title,
        supplierDetails: {
          name: purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.supplierDetails?.companyName || purchaseOrder.supplierId?.fullName,
          email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
          phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
          address: purchaseOrder.supplierDetails?.address || purchaseOrder.supplierId?.supplierDetails?.address,
          businessType: purchaseOrder.supplierDetails?.businessType || purchaseOrder.supplierId?.supplierDetails?.businessType
        },
        creationDate: purchaseOrder.createdAt,
        expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
        actualDeliveryDate: purchaseOrder.actualDeliveryDate,
        status: purchaseOrder.status,
        totalAmount: purchaseOrder.totalAmount,
        currency: purchaseOrder.currency,
        paymentTerms: purchaseOrder.paymentTerms,
        deliveryAddress: purchaseOrder.deliveryAddress,
        items: purchaseOrder.items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice || item.quantity * item.unitPrice,
          specifications: item.specifications,
          itemCode: item.itemCode || (item.itemId ? item.itemId.code : ''),
          category: item.category || (item.itemId ? item.itemId.category : ''),
          unitOfMeasure: item.unitOfMeasure || (item.itemId ? item.itemId.unitOfMeasure : '')
        })),
        specialInstructions: purchaseOrder.specialInstructions,
        notes: purchaseOrder.notes,
        progress: purchaseOrder.progress,
        currentStage: purchaseOrder.currentStage,
        activities: purchaseOrder.activities
      };

      res.json({ success: true, data: pdfData });
    } catch (error) {
      console.error('Get PDF data error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch purchase order data for PDF', error: error.message });
    }
  }
);

router.get('/purchase-orders/:poId/download-pdf', authMiddleware, requireRoles('buyer', 'supply_chain', 'admin', 'supervisor', 'manager', 'finance', 'hr', 'technical', 'hse'), buyerPurchaseOrderController.downloadPurchaseOrderPDF);
router.get('/purchase-orders/:poId/preview-pdf', authMiddleware, requireRoles('buyer', 'supply_chain', 'admin', 'supervisor', 'manager', 'finance', 'hr', 'technical', 'hse'), buyerPurchaseOrderController.previewPurchaseOrderPDF);
router.post('/purchase-orders/:poId/email-pdf', authMiddleware, requireRoles('buyer', 'supply_chain', 'admin', 'supervisor', 'manager', 'finance', 'hr', 'technical', 'hse'), buyerPurchaseOrderController.emailPurchaseOrderPDF);
router.post('/purchase-orders/:poId/assign-department', authMiddleware, requireRoles('supply_chain', 'admin'), buyerPurchaseOrderController.assignPOToDepartment);
router.post('/purchase-orders/:poId/reject', authMiddleware, requireRoles('supply_chain', 'admin'), buyerPurchaseOrderController.rejectPO);
router.post('/purchase-orders/:poId/send', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.sendPurchaseOrderToSupplier);
router.post('/purchase-orders/:poId/cancel', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.cancelPurchaseOrder);

// =============================================
// BUYER PURCHASE ORDER ROUTES
// =============================================

router.get('/purchase-orders', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.getPurchaseOrders);

// ── CREATE PO — supports both JSON (with tender) and multipart/form-data (justification file) ──
router.post(
  '/purchase-orders',
  authMiddleware,
  buyerAuthMiddleware,
  // Run multer before the controller so req.file is available on both paths.
  // If no file is uploaded the middleware is transparent.
  (req, res, next) => {
    tenderJustificationUpload(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Justification document must be under 10 MB' });
      }
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    });
  },
  buyerPurchaseOrderController.createPurchaseOrder
);

router.post('/purchase-orders/validate-items', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.validatePOItems);
router.get('/purchase-orders/:poId', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.getPurchaseOrderDetails);
router.put('/purchase-orders/:poId', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.updatePurchaseOrder);

// =============================================
// QUOTE ROUTES
// =============================================

router.post('/quotes/:quoteId/create-purchase-order', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.createPurchaseOrderFromQuote);

// =============================================
// QUOTATION PDF ROUTES
// =============================================

router.get('/quotations/:quoteId/download-pdf', authMiddleware, buyerAuthMiddleware, quotationController.downloadQuotationPDF);
router.get('/quotations/:quoteId/preview-pdf', authMiddleware, buyerAuthMiddleware, quotationController.previewQuotationPDF);
router.post('/quotations/:quoteId/email-pdf', authMiddleware, buyerAuthMiddleware, quotationController.emailQuotationPDF);

// =============================================
// DEBIT NOTE ROUTES
// =============================================

router.get('/debit-note-approvals',
  authMiddleware,
  requireRoles('supervisor', 'technical', 'hr', 'finance', 'admin'),
  async (req, res) => {
    try {
      const DebitNote = require('../models/DebitNote');

      const pendingDebitNotes = await DebitNote.find({
        'approvalChain.approver.email': req.user.email,
        'approvalChain.status': 'pending',
        status: { $in: ['pending_approval'] },
        $expr: {
          $let: {
            vars: { currentStep: { $arrayElemAt: [{ $filter: { input: '$approvalChain', cond: { $eq: ['$$this.level', '$currentApprovalLevel'] } } }, 0] } },
            in: { $eq: ['$$currentStep.approver.email', req.user.email] }
          }
        }
      })
        .populate('purchaseOrderId', 'poNumber totalAmount')
        .populate('supplierId', 'name email')
        .populate('createdBy', 'fullName')
        .sort({ createdAt: -1 });

      res.json({ success: true, data: pendingDebitNotes, count: pendingDebitNotes.length });
    } catch (error) {
      console.error('Get pending debit notes error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch pending debit notes', error: error.message });
    }
  }
);

router.get('/debit-note-approvals/:debitNoteId/download-pdf', authMiddleware, requireRoles('supervisor', 'technical', 'hr', 'finance', 'admin'), debitNoteController.downloadDebitNotePDF);
router.post('/debit-note-approvals/:debitNoteId/process', authMiddleware, requireRoles('supervisor', 'technical', 'hr', 'finance', 'admin'), debitNoteController.processDebitNoteApproval);
router.get('/debit-notes', authMiddleware, buyerAuthMiddleware, debitNoteController.getDebitNotes);
router.post('/debit-notes', authMiddleware, buyerAuthMiddleware, debitNoteController.createDebitNote);
router.get('/debit-notes/:debitNoteId', authMiddleware, buyerAuthMiddleware, debitNoteController.getDebitNoteDetails);
router.get('/debit-notes/:debitNoteId/download-pdf', authMiddleware, buyerAuthMiddleware, debitNoteController.downloadDebitNotePDF);

router.get('/debit-notes/:debitNoteId/preview-pdf',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const { debitNoteId } = req.params;
      const debitNote = await require('../models/DebitNote').findById(debitNoteId)
        .populate('purchaseOrderId', 'poNumber totalAmount')
        .populate('supplierId', 'name email phone address');

      if (!debitNote) return res.status(404).json({ success: false, message: 'Debit note not found' });

      const pdfData = {
        debitNoteNumber: debitNote.debitNoteNumber,
        poNumber: debitNote.purchaseOrderId?.poNumber,
        supplierDetails: {
          name: debitNote.supplierId?.name,
          email: debitNote.supplierId?.email,
          phone: debitNote.supplierId?.phone,
          address: typeof debitNote.supplierId?.address === 'object'
            ? `${debitNote.supplierId.address.street || ''}, ${debitNote.supplierId.address.city || ''}`
            : debitNote.supplierId?.address
        },
        reason: debitNote.reason,
        description: debitNote.description,
        originalAmount: debitNote.originalAmount,
        debitAmount: debitNote.debitAmount,
        currency: debitNote.currency,
        status: debitNote.status,
        createdAt: debitNote.createdAt,
        approvalChain: debitNote.approvalChain
      };

      const pdfResult = await require('../services/pdfService').generateDebitNotePDF(pdfData);
      if (!pdfResult.success) return res.status(500).json({ success: false, message: 'Failed to generate PDF' });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Debit_Note_${debitNote.debitNoteNumber}_preview.pdf"`);
      res.send(pdfResult.buffer);
    } catch (error) {
      console.error('Preview debit note PDF error:', error);
      res.status(500).json({ success: false, message: 'Failed to generate PDF preview' });
    }
  }
);

router.post('/debit-notes/:debitNoteId/email-pdf',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const { debitNoteId } = req.params;
      const { emailTo, message = '' } = req.body;

      const debitNote = await require('../models/DebitNote').findById(debitNoteId)
        .populate('purchaseOrderId', 'poNumber')
        .populate('supplierId', 'name email');

      if (!debitNote) return res.status(404).json({ success: false, message: 'Debit note not found' });

      const pdfData = {
        debitNoteNumber: debitNote.debitNoteNumber,
        poNumber: debitNote.purchaseOrderId?.poNumber,
        supplierDetails: debitNote.supplierDetails,
        reason: debitNote.reason,
        description: debitNote.description,
        originalAmount: debitNote.originalAmount,
        debitAmount: debitNote.debitAmount,
        currency: debitNote.currency,
        status: debitNote.status,
        createdAt: debitNote.createdAt,
        approvalChain: debitNote.approvalChain
      };

      const pdfResult = await require('../services/pdfService').generateDebitNotePDF(pdfData);
      if (!pdfResult.success) return res.status(500).json({ success: false, message: 'Failed to generate PDF' });

      const { sendEmail } = require('../services/emailService');
      await sendEmail({
        to: emailTo || debitNote.supplierDetails?.email,
        subject: `Debit Note ${debitNote.debitNoteNumber}`,
        html: `<p>Please find attached the debit note document.</p>${message ? `<p>${message}</p>` : ''}<p>Best regards,<br>GRATO ENGINEERING GLOBAL LTD</p>`,
        attachments: [{ filename: pdfResult.filename, content: pdfResult.buffer, contentType: 'application/pdf' }]
      });

      res.json({ success: true, message: `Debit note PDF sent to ${emailTo}` });
    } catch (error) {
      console.error('Email debit note PDF error:', error);
      res.status(500).json({ success: false, message: 'Failed to email PDF' });
    }
  }
);

// =============================================
// SUPPLIER ROUTES
// =============================================

router.get('/suppliers', authMiddleware, buyerAuthMiddleware, buyerPurchaseOrderController.getSuppliers);

router.get('/suppliers/:supplierId',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const Supplier = require('../models/Supplier');
      const supplier = await Supplier.findById(req.params.supplierId)
        .select('name email phone address businessType categories performance bankDetails documents certifications');
      if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
      res.json({ success: true, data: supplier });
    } catch (error) {
      console.error('Get supplier details error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch supplier details', error: error.message });
    }
  }
);

// =============================================
// ITEMS ROUTES
// =============================================

router.get('/items/categories',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const Item = require('../models/Item');
      const categories = await Item.distinct('category', { isActive: true });
      res.json({ success: true, data: categories.sort() });
    } catch (error) {
      console.error('Get item categories error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch item categories', error: error.message });
    }
  }
);

router.get('/items/search',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const { q, limit = 10 } = req.query;
      if (!q || q.length < 2) return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters' });

      const Item = require('../models/Item');
      const items = await Item.find({ isActive: true, $or: [{ description: { $regex: q, $options: 'i' } }, { code: { $regex: q, $options: 'i' } }] })
        .select('_id code description category unitOfMeasure standardPrice')
        .limit(parseInt(limit))
        .sort({ description: 1 });

      res.json({ success: true, data: items });
    } catch (error) {
      console.error('Search items error:', error);
      res.status(500).json({ success: false, message: 'Failed to search items', error: error.message });
    }
  }
);

router.get('/items',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const { search, category, limit = 50 } = req.query;
      const Item = require('../models/Item');

      let query = { isActive: true };
      if (search) query.$or = [{ description: { $regex: search, $options: 'i' } }, { code: { $regex: search, $options: 'i' } }, { specifications: { $regex: search, $options: 'i' } }];
      if (category && category !== 'all') query.category = category;

      const items = await Item.find(query)
        .select('code description category subcategory unitOfMeasure standardPrice specifications')
        .sort({ category: 1, description: 1 })
        .limit(parseInt(limit));

      res.json({ success: true, data: items });
    } catch (error) {
      console.error('Get items error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch items', error: error.message });
    }
  }
);

// =============================================
// PURCHASE REQUISITION ROUTES
// =============================================

router.get('/requisitions', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.getAssignedRequisitions);
router.post('/requisitions/:requisitionId/start-sourcing', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.startSourcing);
router.post('/requisitions/:requisitionId/rfq', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.startSourcing);
router.get('/requisitions/:requisitionId/rfq', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.getRFQDetails || ((req, res) => res.status(501).json({ success: false, message: 'RFQ details endpoint not implemented yet' })));
router.get('/requisitions/:requisitionId/quotes', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.getQuotes);
router.post('/requisitions/:requisitionId/quotes/evaluate', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.evaluateQuotes);
router.post('/requisitions/:requisitionId/quotes/:quoteId/select', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.selectQuote);
router.post('/requisitions/:requisitionId/quotes/:quoteId/reject', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.rejectQuote);
router.post('/requisitions/:requisitionId/quotes/:quoteId/clarify', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.requestQuoteClarification);
router.get('/requisitions/:requisitionId', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.getRequisitionDetails);
router.post('/requisitions/:requisitionId/justification', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.updatePurchaseJustification);

// =============================================
// DELIVERY MANAGEMENT ROUTES
// =============================================

const notImplemented = (label) => (req, res) => res.status(501).json({ success: false, message: `${label} endpoint not implemented yet` });

router.get('/deliveries', authMiddleware, buyerAuthMiddleware, buyerDeliveryController?.getDeliveries || notImplemented('Deliveries'));
router.post('/deliveries/:deliveryId/confirm', authMiddleware, buyerAuthMiddleware, buyerDeliveryController?.confirmDelivery || notImplemented('Confirm delivery'));
router.post('/deliveries/:deliveryId/report-issue', authMiddleware, buyerAuthMiddleware, buyerDeliveryController?.reportDeliveryIssue || notImplemented('Report delivery issue'));

// =============================================
// DASHBOARD & ANALYTICS ROUTES
// =============================================

router.get('/dashboard', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.getBuyerDashboard);

router.get('/analytics',
  authMiddleware,
  buyerAuthMiddleware,
  async (req, res) => {
    try {
      const { period = '30d' } = req.query;
      const PurchaseOrder = require('../models/PurchaseOrder');
      const PurchaseRequisition = require('../models/PurchaseRequisition');

      const now = new Date();
      const msMap = { '7d': 7, '30d': 30, '90d': 90 };
      const days = msMap[period] || 30;
      const startDate = new Date(now.getTime() - days * 86400000);

      const [poAnalytics, reqAnalytics] = await Promise.all([
        PurchaseOrder.aggregate([{ $match: { buyerId: req.user.userId, createdAt: { $gte: startDate } } }, { $group: { _id: '$status', count: { $sum: 1 }, totalValue: { $sum: '$totalAmount' } } }]),
        PurchaseRequisition.aggregate([{ $match: { assignedBuyerId: req.user.userId, createdAt: { $gte: startDate } } }, { $group: { _id: '$status', count: { $sum: 1 } } }])
      ]);

      res.json({
        success: true,
        data: {
          period,
          purchaseOrders: poAnalytics,
          requisitions: reqAnalytics,
          summary: {
            totalPOs: poAnalytics.reduce((s, i) => s + i.count, 0),
            totalValue: poAnalytics.reduce((s, i) => s + i.totalValue, 0),
            totalRequisitions: reqAnalytics.reduce((s, i) => s + i.count, 0)
          }
        }
      });
    } catch (error) {
      console.error('Get analytics error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch analytics', error: error.message });
    }
  }
);

// =============================================
// PETTY CASH FORM ROUTES
// =============================================

router.get('/petty-cash-forms/stats', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.getPettyCashStats);
router.get('/petty-cash-forms', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.getPettyCashForms);
router.get('/petty-cash-forms/:formId/download', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.downloadPettyCashFormPDF);
router.get('/petty-cash-forms/:formId', authMiddleware, buyerAuthMiddleware, buyerRequisitionController.getPettyCashFormDetails);

// =============================================
// ERROR HANDLING MIDDLEWARE
// =============================================

router.use((error, req, res, next) => {
  if (error.name === 'PDFGenerationError') return res.status(500).json({ success: false, message: 'Failed to generate PDF document', error: error.message });
  if (error.name === 'FileSizeError') return res.status(413).json({ success: false, message: 'File size too large for processing', error: error.message });
  if (error.name === 'ZipCreationError') return res.status(500).json({ success: false, message: 'Failed to create ZIP archive', error: error.message });
  if (error.name === 'EmailError') return res.status(500).json({ success: false, message: 'Failed to send email with PDF attachment', error: error.message });
  next(error);
});

module.exports = router;









// const express = require('express');
// const router = express.Router();
// const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
// const { upload, handleMulterError } = require('../middlewares/uploadMiddleware');
// const pdfService = require('../services/pdfService');
// const { saveFile, STORAGE_CATEGORIES } = require('../utils/localFileStorage');
// const { buildPurchaseOrderPdfData } = require('../services/purchaseOrderPdfData');

// // Import controllers
// const buyerRequisitionController = require('../controllers/buyerRequisitionController');
// const buyerPurchaseOrderController = require('../controllers/buyerPurchaseOrderController');
// const buyerDeliveryController = require('../controllers/buyerDeliveryController');
// const quotationController = require('../controllers/quotationController');
// const debitNoteController = require('../controllers/debitNoteController');

// // Middleware to ensure only buyers, supply_chain users, and admins can access
// const buyerAuthMiddleware = requireRoles('buyer', 'supply_chain', 'admin');

// // =============================================
// // ROUTE PARAMETER VALIDATION (MUST BE EARLY)
// // =============================================

// // Validate purchase order ID parameter
// router.param('poId', async (req, res, next, poId) => {
//   try {
//     if (!poId.match(/^[0-9a-fA-F]{24}$/)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid purchase order ID format'
//       });
//     }
//     req.poId = poId;
//     next();
//   } catch (error) {
//     next(error);
//   }
// });

// // Validate requisition ID parameter
// router.param('requisitionId', async (req, res, next, requisitionId) => {
//   try {
//     if (!requisitionId.match(/^[0-9a-fA-F]{24}$/)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid requisition ID format'
//       });
//     }
//     req.requisitionId = requisitionId;
//     next();
//   } catch (error) {
//     next(error);
//   }
// });

// // Validate supplier ID parameter
// router.param('supplierId', async (req, res, next, supplierId) => {
//   try {
//     if (!supplierId.match(/^[0-9a-fA-F]{24}$/)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid supplier ID format'
//       });
//     }
//     req.supplierId = supplierId;
//     next();
//   } catch (error) {
//     next(error);
//   }
// });

// // Validate quote ID parameter
// router.param('quoteId', async (req, res, next, quoteId) => {
//   try {
//     if (!quoteId.match(/^[0-9a-fA-F]{24}$/)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid quote ID format'
//       });
//     }
//     req.quoteId = quoteId;
//     next();
//   } catch (error) {
//     next(error);
//   }
// });

// // Validate debit note ID parameter
// router.param('debitNoteId', async (req, res, next, debitNoteId) => {
//   try {
//     if (!debitNoteId.match(/^[0-9a-fA-F]{24}$/)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid debit note ID format'
//       });
//     }
//     req.debitNoteId = debitNoteId;
//     next();
//   } catch (error) {
//     next(error);
//   }
// });

// // Validate petty cash form ID parameter
// router.param('formId', async (req, res, next, formId) => {
//   try {
//     if (!formId.match(/^[0-9a-fA-F]{24}$/)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid petty cash form ID format'
//       });
//     }
//     req.formId = formId;
//     next();
//   } catch (error) {
//     next(error);
//   }
// });

// // =============================================
// // SUPPLY CHAIN PO MANAGEMENT ROUTES (SPECIFIC ROUTES FIRST)
// // =============================================

// // Get Supply Chain PO statistics
// router.get('/purchase-orders/supply-chain/stats', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin'),
//   buyerPurchaseOrderController.getSupplyChainPOStats
// );

// // Get pending POs for Supply Chain assignment
// router.get('/purchase-orders/supply-chain/pending', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin'),
//   buyerPurchaseOrderController.getSupplyChainPendingPOs
// );

// // =============================================
// // SUPERVISOR PO MANAGEMENT ROUTES
// // =============================================

// // Get pending POs for Supervisor review
// router.get('/purchase-orders/supervisor/pending', 
//   authMiddleware, 
//   requireRoles('supervisor', 'admin', 'hr', 'technical', 'finance', 'it', 'employee'),
//   async (req, res) => {
//     try {
//       // Force no cache
//       res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
//       res.setHeader('Pragma', 'no-cache');
//       res.setHeader('Expires', '0');
      
//       const PurchaseOrder = require('../models/PurchaseOrder');
//       const User = require('../models/User');
      
//       console.log('Fetching supervisor pending POs for user:', req.user.userId);
//       console.log('User email:', req.user.email);
      
//       // Get current user details
//       const currentUser = await User.findById(req.user.userId);
      
//       if (!currentUser) {
//         return res.status(404).json({
//           success: false,
//           message: 'User not found'
//         });
//       }

//       console.log('Current user role:', currentUser.role);
      
//       // Find POs where user is in approval chain and status is pending their approval
//       const pendingPOs = await PurchaseOrder.find({
//         'approvalChain.approver.email': currentUser.email,
//         $or: [
//           { status: 'pending_department_approval' },
//           { status: 'pending_head_of_business_approval' },
//           { status: 'pending_finance_approval' },
//           { status: 'pending_head_approval' },
//           { status: 'pending_approval' }
//         ]
//       })
//       .populate('supplierId', 'name email phone')
//       .populate('buyerId', 'fullName email')
//       .populate('requisitionId', 'requisitionNumber title')
//       .sort({ createdAt: -1 });

//       console.log(`Found ${pendingPOs.length} POs for supervisor`);

//       // Filter to only POs where current user's approval is actually pending
//       const filteredPOs = pendingPOs.filter(po => {
//         const currentStep = po.approvalChain?.find(step => 
//           step.level === po.currentApprovalLevel && 
//           step.approver?.email === currentUser.email &&
//           step.status === 'pending'
//         );
//         return !!currentStep;
//       });

//       console.log(`${filteredPOs.length} POs actually need this user's approval`);

//       // Format POs for frontend
//       const formattedPOs = filteredPOs.map(po => ({
//         id: po._id,
//         poNumber: po.poNumber,
//         supplierName: po.supplierDetails?.name || po.supplierId?.name || 'Unknown',
//         supplierEmail: po.supplierDetails?.email || po.supplierId?.email || '',
//         totalAmount: po.totalAmount,
//         currency: po.currency || 'XAF',
//         items: po.items || [],
//         status: po.status,
//         creationDate: po.createdAt,
//         expectedDeliveryDate: po.expectedDeliveryDate,
//         approvalChain: po.approvalChain,
//         currentApprovalLevel: po.currentApprovalLevel,
//         requisitionNumber: po.requisitionId?.requisitionNumber,
//         buyerName: po.buyerId?.fullName
//       }));

//       res.json({
//         success: true,
//         data: formattedPOs,
//         count: formattedPOs.length
//       });

//     } catch (error) {
//       console.error('Get supervisor pending POs error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch pending purchase orders',
//         error: error.message
//       });
//     }
//   }
// );

// // Get Supervisor PO statistics
// router.get('/purchase-orders/supervisor/stats', 
//   authMiddleware, 
//   requireRoles('supervisor', 'admin'),
//   async (req, res) => {
//     try {
//       const PurchaseOrder = require('../models/PurchaseOrder');
      
//       const stats = await PurchaseOrder.aggregate([
//         {
//           $match: {
//             'assignedDepartment.supervisorId': req.user.userId
//           }
//         },
//         {
//           $group: {
//             _id: '$status',
//             count: { $sum: 1 },
//             totalValue: { $sum: '$totalAmount' }
//           }
//         }
//       ]);

//       const totalPending = stats.find(s => s._id === 'pending_supervisor_approval')?.count || 0;
//       const totalApproved = stats.find(s => s._id === 'approved')?.count || 0;
//       const totalRejected = stats.find(s => s._id === 'rejected')?.count || 0;

//       res.json({
//         success: true,
//         data: {
//           pending: totalPending,
//           approved: totalApproved,
//           rejected: totalRejected,
//           total: stats.reduce((sum, s) => sum + s.count, 0),
//           totalValue: stats.reduce((sum, s) => sum + s.totalValue, 0),
//           breakdown: stats
//         }
//       });

//     } catch (error) {
//       console.error('Get supervisor PO stats error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch purchase order statistics',
//         error: error.message
//       });
//     }
//   }
// );

// // Approve PO (Supervisor)
// router.post('/purchase-orders/:poId/approve', 
//   authMiddleware, 
//   // requireRoles('supervisor', 'admin', 'hr', 'technical', 'finance'),
//   async (req, res) => {
//     try {
//       const { poId } = req.params;
//       const { decision, comments } = req.body;
      
//       console.log('Processing PO approval:', {
//         poId,
//         decision,
//         userId: req.user.userId,
//         userEmail: req.user.email
//       });

//       const PurchaseOrder = require('../models/PurchaseOrder');
//       const User = require('../models/User');

//       const po = await PurchaseOrder.findById(poId)
//         .populate('supplierId', 'fullName email phone supplierDetails')
//         .populate('items.itemId', 'code description category unitOfMeasure');

//       if (!po) {
//         return res.status(404).json({
//           success: false,
//           message: 'Purchase order not found'
//         });
//       }

//       // Get current user
//       const currentUser = await User.findById(req.user.userId).select('fullName email signature');

//       // Find current approval step
//       const currentStep = po.approvalChain?.find(step => 
//         step.level === po.currentApprovalLevel && 
//         step.approver?.email === currentUser.email &&
//         step.status === 'pending'
//       );

//       if (!currentStep) {
//         return res.status(403).json({
//           success: false,
//           message: 'You are not authorized to approve this purchase order at this stage'
//         });
//       }

//       // Validate decision
//       if (!['approved', 'rejected'].includes(decision)) {
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid decision. Must be "approved" or "rejected"'
//         });
//       }

//       // Update the current approval step
//       currentStep.status = decision;
//       const actionDate = new Date();
//       currentStep.actionDate = actionDate;
//       currentStep.actionTime = actionDate.toTimeString().split(' ')[0];
//       currentStep.comments = comments;

//       if (decision === 'approved') {
//         const signatureBlocks = [
//           {
//             label: 'Supply Chain',
//             signaturePath: null,
//             signedAt: po.supplyChainReview?.reviewDate || null
//           },
//           { label: 'Department Head' },
//           { label: 'Head of Business' },
//           { label: 'Finance' }
//         ];

//         if (po.supplyChainReview?.reviewedBy) {
//           const supplyChainUser = await User.findById(po.supplyChainReview.reviewedBy)
//             .select('signature');
//           signatureBlocks[0].signaturePath = supplyChainUser?.signature?.localPath || null;
//         }

//         const approverEmails = po.approvalChain
//           ?.filter(step => step.status === 'approved' || step.level === currentStep.level)
//           .map(step => step.approver?.email)
//           .filter(Boolean) || [];

//         const approverUsers = approverEmails.length
//           ? await User.find({ email: { $in: approverEmails } }).select('email signature')
//           : [];
//         const approverByEmail = new Map(
//           approverUsers.map(user => [user.email, user])
//         );

//         po.approvalChain?.forEach(step => {
//           const blockIndex = step.level;
//           if (!signatureBlocks[blockIndex]) {
//             return;
//           }

//           if (step.level === currentStep.level) {
//             signatureBlocks[blockIndex].signaturePath = currentUser?.signature?.localPath || null;
//             signatureBlocks[blockIndex].signedAt = actionDate;
//             return;
//           }

//           if (step.status === 'approved') {
//             const approverUser = approverByEmail.get(step.approver?.email);
//             signatureBlocks[blockIndex].signaturePath = approverUser?.signature?.localPath || null;
//             signatureBlocks[blockIndex].signedAt = step.actionDate || step.updatedAt || null;
//           }
//         });

//         const pdfData = {
//           ...buildPurchaseOrderPdfData(po),
//           signatures: signatureBlocks
//         };

//         const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
//         if (!pdfResult.success) {
//           return res.status(500).json({
//             success: false,
//             message: pdfResult.error || 'Failed to generate signed document'
//           });
//         }

//         const signedDocData = await saveFile(
//           {
//             buffer: pdfResult.buffer,
//             originalname: `PO-${po.poNumber}-Level-${currentStep.level}-signed.pdf`,
//             mimetype: 'application/pdf',
//             size: pdfResult.buffer.length
//           },
//           STORAGE_CATEGORIES.SIGNED_DOCUMENTS,
//           `level-${currentStep.level}`,
//           `PO-${po.poNumber}-Level-${currentStep.level}-signed-${Date.now()}.pdf`
//         );

//         currentStep.signedDocument = {
//           publicId: signedDocData.publicId,
//           url: signedDocData.url,
//           localPath: signedDocData.localPath,
//           format: signedDocData.format,
//           resourceType: signedDocData.resourceType,
//           bytes: signedDocData.bytes,
//           originalName: signedDocData.originalName,
//           uploadedAt: signedDocData.uploadedAt
//         };
//       }

//       // Check if this was the last approval level
//       const maxLevel = Math.max(...po.approvalChain.map(step => step.level));
      
//       if (decision === 'approved' && currentStep.level < maxLevel) {
//         // Move to next approval level
//         po.currentApprovalLevel = currentStep.level + 1;
        
//         const nextStep = po.approvalChain.find(step => step.level === po.currentApprovalLevel);
//         if (nextStep) {
//           // Set appropriate status based on next level
//           if (po.currentApprovalLevel === 2) {
//             po.status = 'pending_head_of_business_approval';
//           } else if (po.currentApprovalLevel === 3) {
//             po.status = 'pending_finance_approval';
//           } else {
//             po.status = 'pending_department_approval'; // Fallback
//           }
          
//           nextStep.activatedDate = new Date();
//         }
//       } else if (decision === 'approved' && currentStep.level === maxLevel) {
//         // All approvals complete
//         po.status = 'approved';
//         po.approvalDate = new Date();
//         po.currentApprovalLevel = maxLevel;
//       } else if (decision === 'rejected') {
//         // Rejected at any level
//         po.status = 'rejected';
//         po.rejectionDetails = {
//           rejectedBy: req.user.userId,
//           rejectedAt: new Date(),
//           reason: comments || 'Rejected during approval process',
//           stage: `level_${currentStep.level}`
//         };
//       }

//       // Add activity log with REQUIRED fields
//       po.activities = po.activities || [];
//       po.activities.push({
//         type: decision === 'approved' ? 'updated' : 'cancelled', // Use valid enum values
//         description: comments || `Purchase order ${decision} by ${currentUser.fullName}`,
//         user: currentUser.fullName,
//         timestamp: new Date()
//       });

//       await po.save();

//       // Send notification email (optional)
//       // TODO: Implement email notification

//       res.json({
//         success: true,
//         message: `Purchase order ${decision} successfully`,
//         data: {
//           poNumber: po.poNumber,
//           status: po.status,
//           currentLevel: po.currentApprovalLevel,
//           decision: decision
//         }
//       });

//     } catch (error) {
//       console.error('Approve PO error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to process approval',
//         error: error.message
//       });
//     }
//   }
// );

// // Reject PO (Supervisor)
// router.post('/purchase-orders/:poId/supervisor-reject', 
//   authMiddleware, 
//   requireRoles('supervisor', 'admin'),
//   async (req, res) => {
//     try {
//       const { poId } = req.params;
//       const { reason } = req.body;
//       const PurchaseOrder = require('../models/PurchaseOrder');

//       if (!reason || reason.trim().length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: 'Rejection reason is required'
//         });
//       }

//       const po = await PurchaseOrder.findById(poId);

//       if (!po) {
//         return res.status(404).json({
//           success: false,
//           message: 'Purchase order not found'
//         });
//       }

//       // Verify the supervisor is assigned to this PO
//       if (po.assignedDepartment?.supervisorId?.toString() !== req.user.userId) {
//         return res.status(403).json({
//           success: false,
//           message: 'Unauthorized: You are not the assigned supervisor for this purchase order'
//         });
//       }

//       if (po.status !== 'pending_supervisor_approval') {
//         return res.status(400).json({
//           success: false,
//           message: 'Purchase order is not in pending supervisor approval status'
//         });
//       }

//       po.status = 'rejected';
//       po.supervisorApproval = {
//         rejectedBy: req.user.userId,
//         rejectedAt: new Date(),
//         reason: reason
//       };

//       po.activities.push({
//         action: 'supervisor_rejected',
//         performedBy: req.user.userId,
//         timestamp: new Date(),
//         details: `Purchase order rejected: ${reason}`
//       });

//       await po.save();

//       res.json({
//         success: true,
//         message: 'Purchase order rejected successfully',
//         data: po
//       });

//     } catch (error) {
//       console.error('Supervisor reject PO error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to reject purchase order',
//         error: error.message
//       });
//     }
//   }
// );

// // Validate purchase order IDs for bulk operations
// router.post('/purchase-orders/validate-bulk', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const { poIds } = req.body;

//       if (!poIds || !Array.isArray(poIds) || poIds.length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: 'Purchase order IDs are required'
//         });
//       }

//       if (poIds.length > 50) {
//         return res.status(400).json({
//           success: false,
//           message: 'Cannot process more than 50 purchase orders at once'
//         });
//       }

//       const PurchaseOrder = require('../models/PurchaseOrder');

//       const purchaseOrders = await PurchaseOrder.find({
//         _id: { $in: poIds },
//         buyerId: req.user.userId
//       })
//       .select('poNumber status totalAmount currency supplierDetails.name createdAt');

//       const validPoIds = purchaseOrders.map(po => po._id.toString());
//       const invalidPoIds = poIds.filter(id => !validPoIds.includes(id));

//       res.json({
//         success: true,
//         data: {
//           validPurchaseOrders: purchaseOrders.map(po => ({
//             id: po._id,
//             poNumber: po.poNumber,
//             status: po.status,
//             totalAmount: po.totalAmount,
//             currency: po.currency,
//             supplierName: po.supplierDetails?.name,
//             creationDate: po.createdAt
//           })),
//           invalidPoIds,
//           validCount: validPoIds.length,
//           invalidCount: invalidPoIds.length,
//           totalSelected: poIds.length
//         }
//       });

//     } catch (error) {
//       console.error('Validate bulk POs error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to validate purchase orders',
//         error: error.message
//       });
//     }
//   }
// );

// // Bulk download purchase orders
// router.post('/purchase-orders/bulk-download', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.bulkDownloadPurchaseOrders
// );

// // Download PO for signing
// router.get('/purchase-orders/:poId/download-for-signing', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin'),
//   buyerPurchaseOrderController.downloadPOForSigning
// );

// // Get purchase order details for PDF generation
// router.get('/purchase-orders/:poId/pdf-data', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const { poId } = req.params;
//       const PurchaseOrder = require('../models/PurchaseOrder');
//       const User = require('../models/User');

//       const purchaseOrder = await PurchaseOrder.findById(poId)
//         .populate('supplierId', 'fullName email phone supplierDetails')
//         .populate('requisitionId', 'title requisitionNumber employee')
//         .populate('items.itemId', 'code description category unitOfMeasure');

//       if (!purchaseOrder) {
//         return res.status(404).json({
//           success: false,
//           message: 'Purchase order not found'
//         });
//       }

//       // Authorization check
//       if (purchaseOrder.buyerId.toString() !== req.user.userId) {
//         const user = await User.findById(req.user.userId);
//         if (!['admin', 'supply_chain'].includes(user.role)) {
//           return res.status(403).json({
//             success: false,
//             message: 'Unauthorized access to purchase order'
//           });
//         }
//       }

//       const pdfData = {
//         id: purchaseOrder._id,
//         poNumber: purchaseOrder.poNumber,
//         requisitionId: purchaseOrder.requisitionId?._id,
//         requisitionTitle: purchaseOrder.requisitionId?.title,

//         supplierDetails: {
//           name: purchaseOrder.supplierDetails?.name || 
//                 purchaseOrder.supplierId?.supplierDetails?.companyName || 
//                 purchaseOrder.supplierId?.fullName,
//           email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
//           phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
//           address: purchaseOrder.supplierDetails?.address || 
//                    purchaseOrder.supplierId?.supplierDetails?.address,
//           businessType: purchaseOrder.supplierDetails?.businessType || 
//                         purchaseOrder.supplierId?.supplierDetails?.businessType
//         },

//         creationDate: purchaseOrder.createdAt,
//         expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
//         actualDeliveryDate: purchaseOrder.actualDeliveryDate,
//         status: purchaseOrder.status,
//         totalAmount: purchaseOrder.totalAmount,
//         currency: purchaseOrder.currency,
//         paymentTerms: purchaseOrder.paymentTerms,
//         deliveryAddress: purchaseOrder.deliveryAddress,

//         items: purchaseOrder.items.map(item => ({
//           description: item.description,
//           quantity: item.quantity,
//           unitPrice: item.unitPrice,
//           totalPrice: item.totalPrice || (item.quantity * item.unitPrice),
//           specifications: item.specifications,
//           itemCode: item.itemCode || (item.itemId ? item.itemId.code : ''),
//           category: item.category || (item.itemId ? item.itemId.category : ''),
//           unitOfMeasure: item.unitOfMeasure || (item.itemId ? item.itemId.unitOfMeasure : '')
//         })),

//         specialInstructions: purchaseOrder.specialInstructions,
//         notes: purchaseOrder.notes,
//         progress: purchaseOrder.progress,
//         currentStage: purchaseOrder.currentStage,
//         activities: purchaseOrder.activities
//       };

//       res.json({
//         success: true,
//         data: pdfData
//       });

//     } catch (error) {
//       console.error('Get PDF data error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch purchase order data for PDF',
//         error: error.message
//       });
//     }
//   }
// );

// // Download PDF
// router.get('/purchase-orders/:poId/download-pdf', 
//   authMiddleware, 
//   requireRoles('buyer', 'supply_chain', 'admin', 'supervisor', 'manager', 'finance', 'hr', 'technical', 'hse'),
//   buyerPurchaseOrderController.downloadPurchaseOrderPDF
// );

// // Preview PDF
// router.get('/purchase-orders/:poId/preview-pdf', 
//   authMiddleware, 
//   requireRoles('buyer', 'supply_chain', 'admin', 'supervisor', 'manager', 'finance', 'hr', 'technical', 'hse'),
//   buyerPurchaseOrderController.previewPurchaseOrderPDF
// );

// // Email PDF
// router.post('/purchase-orders/:poId/email-pdf', 
//   authMiddleware, 
//   requireRoles('buyer', 'supply_chain', 'admin', 'supervisor', 'manager', 'finance', 'hr', 'technical', 'hse'),
//   buyerPurchaseOrderController.emailPurchaseOrderPDF
// );

// // Assign PO to department (auto-signed) - CRITICAL: This must come before generic :poId routes
// router.post('/purchase-orders/:poId/assign-department', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin'),
//   buyerPurchaseOrderController.assignPOToDepartment
// );

// // Reject PO
// router.post('/purchase-orders/:poId/reject', 
//   authMiddleware, 
//   requireRoles('supply_chain', 'admin'),
//   buyerPurchaseOrderController.rejectPO
// );

// // Send purchase order to supplier
// router.post('/purchase-orders/:poId/send', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.sendPurchaseOrderToSupplier
// );

// // Cancel purchase order
// router.post('/purchase-orders/:poId/cancel', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.cancelPurchaseOrder
// );

// // =============================================
// // BUYER PURCHASE ORDER ROUTES
// // =============================================

// // Get all purchase orders for buyer
// router.get('/purchase-orders', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.getPurchaseOrders
// );

// // Create purchase order 
// router.post('/purchase-orders', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.createPurchaseOrder
// );

// // Validate items for PO creation
// router.post('/purchase-orders/validate-items', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.validatePOItems
// );

// // Get specific purchase order details
// router.get('/purchase-orders/:poId', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.getPurchaseOrderDetails
// );

// // Update purchase order
// router.put('/purchase-orders/:poId', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.updatePurchaseOrder
// );

// // =============================================
// // QUOTE ROUTES
// // =============================================

// // Create purchase order from quote
// router.post('/quotes/:quoteId/create-purchase-order', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.createPurchaseOrderFromQuote
// );

// // =============================================
// // QUOTATION PDF ROUTES
// // =============================================

// // Download quotation PDF
// router.get('/quotations/:quoteId/download-pdf',
//   authMiddleware,
//   buyerAuthMiddleware,
//   quotationController.downloadQuotationPDF
// );

// // Preview quotation PDF
// router.get('/quotations/:quoteId/preview-pdf',
//   authMiddleware,
//   buyerAuthMiddleware,
//   quotationController.previewQuotationPDF
// );

// // Email quotation PDF
// router.post('/quotations/:quoteId/email-pdf',
//   authMiddleware,
//   buyerAuthMiddleware,
//   quotationController.emailQuotationPDF
// );

// // =============================================
// // DEBIT NOTE ROUTES
// // =============================================

// // Get debit note approvals (specific route first)
// router.get('/debit-note-approvals',
//   authMiddleware,
//   requireRoles('supervisor', 'technical', 'hr', 'finance', 'admin'),
//   async (req, res) => {
//     try {
//       const DebitNote = require('../models/DebitNote');

//       const pendingDebitNotes = await DebitNote.find({
//         'approvalChain.approver.email': req.user.email,
//         'approvalChain.status': 'pending',
//         status: { $in: ['pending_approval'] },
//         $expr: {
//           $let: {
//             vars: {
//               currentStep: {
//                 $arrayElemAt: [
//                   {
//                     $filter: {
//                       input: '$approvalChain',
//                       cond: { $eq: ['$$this.level', '$currentApprovalLevel'] }
//                     }
//                   },
//                   0
//                 ]
//               }
//             },
//             in: { $eq: ['$$currentStep.approver.email', req.user.email] }
//           }
//         }
//       })
//       .populate('purchaseOrderId', 'poNumber totalAmount')
//       .populate('supplierId', 'name email')
//       .populate('createdBy', 'fullName')
//       .sort({ createdAt: -1 });

//       res.json({
//         success: true,
//         data: pendingDebitNotes,
//         count: pendingDebitNotes.length
//       });

//     } catch (error) {
//       console.error('Get pending debit notes error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch pending debit notes',
//         error: error.message
//       });
//     }
//   }
// );

// // Download debit note for approval
// router.get('/debit-note-approvals/:debitNoteId/download-pdf',
//   authMiddleware,
//   requireRoles('supervisor', 'technical', 'hr', 'finance', 'admin'),
//   debitNoteController.downloadDebitNotePDF
// );

// // Process debit note approval
// router.post('/debit-note-approvals/:debitNoteId/process',
//   authMiddleware,
//   requireRoles('supervisor', 'technical', 'hr', 'finance', 'admin'),
//   debitNoteController.processDebitNoteApproval
// );

// // Get all debit notes
// router.get('/debit-notes',
//   authMiddleware,
//   buyerAuthMiddleware,
//   debitNoteController.getDebitNotes
// );

// // Create debit note
// router.post('/debit-notes',
//   authMiddleware,
//   buyerAuthMiddleware,
//   debitNoteController.createDebitNote
// );

// // Get debit note details
// router.get('/debit-notes/:debitNoteId',
//   authMiddleware,
//   buyerAuthMiddleware,
//   debitNoteController.getDebitNoteDetails
// );

// // Download debit note PDF
// router.get('/debit-notes/:debitNoteId/download-pdf',
//   authMiddleware,
//   buyerAuthMiddleware,
//   debitNoteController.downloadDebitNotePDF
// );

// // Preview debit note PDF
// router.get('/debit-notes/:debitNoteId/preview-pdf',
//   authMiddleware,
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const { debitNoteId } = req.params;

//       const debitNote = await require('../models/DebitNote').findById(debitNoteId)
//         .populate('purchaseOrderId', 'poNumber totalAmount')
//         .populate('supplierId', 'name email phone address');

//       if (!debitNote) {
//         return res.status(404).json({ success: false, message: 'Debit note not found' });
//       }

//       const pdfData = {
//         debitNoteNumber: debitNote.debitNoteNumber,
//         poNumber: debitNote.purchaseOrderId?.poNumber,
//         supplierDetails: {
//           name: debitNote.supplierId?.name,
//           email: debitNote.supplierId?.email,
//           phone: debitNote.supplierId?.phone,
//           address: typeof debitNote.supplierId?.address === 'object'
//             ? `${debitNote.supplierId.address.street || ''}, ${debitNote.supplierId.address.city || ''}`
//             : debitNote.supplierId?.address
//         },
//         reason: debitNote.reason,
//         description: debitNote.description,
//         originalAmount: debitNote.originalAmount,
//         debitAmount: debitNote.debitAmount,
//         currency: debitNote.currency,
//         status: debitNote.status,
//         createdAt: debitNote.createdAt,
//         approvalChain: debitNote.approvalChain
//       };

//       const pdfResult = await require('../services/pdfService').generateDebitNotePDF(pdfData);

//       if (!pdfResult.success) {
//         return res.status(500).json({ success: false, message: 'Failed to generate PDF' });
//       }

//       res.setHeader('Content-Type', 'application/pdf');
//       res.setHeader('Content-Disposition', `inline; filename="Debit_Note_${debitNote.debitNoteNumber}_preview.pdf"`);
//       res.send(pdfResult.buffer);

//     } catch (error) {
//       console.error('Preview debit note PDF error:', error);
//       res.status(500).json({ success: false, message: 'Failed to generate PDF preview' });
//     }
//   }
// );

// // Email debit note PDF
// router.post('/debit-notes/:debitNoteId/email-pdf',
//   authMiddleware,
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const { debitNoteId } = req.params;
//       const { emailTo, message = '' } = req.body;

//       const debitNote = await require('../models/DebitNote').findById(debitNoteId)
//         .populate('purchaseOrderId', 'poNumber')
//         .populate('supplierId', 'name email');

//       if (!debitNote) {
//         return res.status(404).json({ success: false, message: 'Debit note not found' });
//       }

//       const pdfData = {
//         debitNoteNumber: debitNote.debitNoteNumber,
//         poNumber: debitNote.purchaseOrderId?.poNumber,
//         supplierDetails: debitNote.supplierDetails,
//         reason: debitNote.reason,
//         description: debitNote.description,
//         originalAmount: debitNote.originalAmount,
//         debitAmount: debitNote.debitAmount,
//         currency: debitNote.currency,
//         status: debitNote.status,
//         createdAt: debitNote.createdAt,
//         approvalChain: debitNote.approvalChain
//       };

//       const pdfResult = await require('../services/pdfService').generateDebitNotePDF(pdfData);

//       if (!pdfResult.success) {
//         return res.status(500).json({ success: false, message: 'Failed to generate PDF' });
//       }

//       const { sendEmail } = require('../services/emailService');

//       await sendEmail({
//         to: emailTo || debitNote.supplierDetails?.email,
//         subject: `Debit Note ${debitNote.debitNoteNumber}`,
//         html: `
//           <div style="font-family: Arial, sans-serif;">
//             <h2>Debit Note Document</h2>
//             <p>Please find attached the debit note document.</p>
//             ${message ? `<p><strong>Message:</strong><br>${message}</p>` : ''}
//             <p>Best regards,<br>GRATO ENGINEERING GLOBAL LTD</p>
//           </div>
//         `,
//         attachments: [{
//           filename: pdfResult.filename,
//           content: pdfResult.buffer,
//           contentType: 'application/pdf'
//         }]
//       });

//       res.json({ success: true, message: `Debit note PDF sent to ${emailTo}` });

//     } catch (error) {
//       console.error('Email debit note PDF error:', error);
//       res.status(500).json({ success: false, message: 'Failed to email PDF' });
//     }
//   }
// );

// // =============================================
// // SUPPLIER ROUTES
// // =============================================

// // Get suppliers for PO creation
// router.get('/suppliers', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerPurchaseOrderController.getSuppliers
// );

// // Get specific supplier details
// router.get('/suppliers/:supplierId', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const { supplierId } = req.params;
//       const Supplier = require('../models/Supplier');

//       const supplier = await Supplier.findById(supplierId)
//         .select('name email phone address businessType categories performance bankDetails documents certifications');

//       if (!supplier) {
//         return res.status(404).json({
//           success: false,
//           message: 'Supplier not found'
//         });
//       }

//       res.json({
//         success: true,
//         data: supplier
//       });

//     } catch (error) {
//       console.error('Get supplier details error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch supplier details',
//         error: error.message
//       });
//     }
//   }
// );

// // =============================================
// // ITEMS ROUTES
// // =============================================

// // Get item categories (specific route first)
// router.get('/items/categories', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const Item = require('../models/Item');
//       const categories = await Item.distinct('category', { isActive: true });

//       res.json({
//         success: true,
//         data: categories.sort()
//       });

//     } catch (error) {
//       console.error('Get item categories error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch item categories',
//         error: error.message
//       });
//     }
//   }
// );

// // Search items for autocomplete
// router.get('/items/search', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const { q, limit = 10 } = req.query;

//       if (!q || q.length < 2) {
//         return res.status(400).json({
//           success: false,
//           message: 'Search query must be at least 2 characters'
//         });
//       }

//       const Item = require('../models/Item');

//       const items = await Item.find({
//         isActive: true,
//         $or: [
//           { description: { $regex: q, $options: 'i' } },
//           { code: { $regex: q, $options: 'i' } }
//         ]
//       })
//       .select('_id code description category unitOfMeasure standardPrice')
//       .limit(parseInt(limit))
//       .sort({ description: 1 });

//       res.json({
//         success: true,
//         data: items
//       });

//     } catch (error) {
//       console.error('Search items error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to search items',
//         error: error.message
//       });
//     }
//   }
// );

// // Get items for PO creation
// router.get('/items', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const { search, category, limit = 50 } = req.query;
//       const Item = require('../models/Item');

//       let query = { isActive: true };

//       if (search) {
//         query.$or = [
//           { description: { $regex: search, $options: 'i' } },
//           { code: { $regex: search, $options: 'i' } },
//           { specifications: { $regex: search, $options: 'i' } }
//         ];
//       }

//       if (category && category !== 'all') {
//         query.category = category;
//       }

//       const items = await Item.find(query)
//         .select('code description category subcategory unitOfMeasure standardPrice specifications')
//         .sort({ category: 1, description: 1 })
//         .limit(parseInt(limit));

//       res.json({
//         success: true,
//         data: items
//       });

//     } catch (error) {
//       console.error('Get items error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch items',
//         error: error.message
//       });
//     }
//   }
// );

// // =============================================
// // PURCHASE REQUISITION ROUTES
// // =============================================

// // Get assigned requisitions for buyer
// router.get('/requisitions', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.getAssignedRequisitions
// );

// // Start sourcing process for requisition
// router.post('/requisitions/:requisitionId/start-sourcing', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.startSourcing
// );

// // Create RFQ for requisition
// router.post('/requisitions/:requisitionId/rfq', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.startSourcing
// );

// // Get RFQ details for requisition
// router.get('/requisitions/:requisitionId/rfq', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.getRFQDetails || ((req, res) => {
//     res.status(501).json({ 
//       success: false, 
//       message: 'RFQ details endpoint not implemented yet' 
//     });
//   })
// );

// // Get quotes for a requisition
// router.get('/requisitions/:requisitionId/quotes', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.getQuotes
// );

// // Evaluate quotes for a requisition
// router.post('/requisitions/:requisitionId/quotes/evaluate', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.evaluateQuotes
// );

// // Select a quote
// router.post('/requisitions/:requisitionId/quotes/:quoteId/select', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.selectQuote
// );

// // Reject a quote
// router.post('/requisitions/:requisitionId/quotes/:quoteId/reject', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.rejectQuote
// );

// // Request clarification on a quote
// router.post('/requisitions/:requisitionId/quotes/:quoteId/clarify', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.requestQuoteClarification
// );

// // Get specific requisition details
// router.get('/requisitions/:requisitionId', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.getRequisitionDetails
// );

// // ✅ NEW: Buyer adds/updates purchase justification
// router.post('/requisitions/:requisitionId/justification',
//   authMiddleware,
//   buyerAuthMiddleware,
//   buyerRequisitionController.updatePurchaseJustification
// );

// // =============================================
// // DELIVERY MANAGEMENT ROUTES
// // =============================================

// // Get deliveries for buyer
// router.get('/deliveries', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerDeliveryController?.getDeliveries || ((req, res) => {
//     res.status(501).json({ 
//       success: false, 
//       message: 'Deliveries endpoint not implemented yet' 
//     });
//   })
// );

// // Confirm delivery receipt
// router.post('/deliveries/:deliveryId/confirm', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerDeliveryController?.confirmDelivery || ((req, res) => {
//     res.status(501).json({ 
//       success: false, 
//       message: 'Confirm delivery endpoint not implemented yet' 
//     });
//   })
// );

// // Report delivery issues
// router.post('/deliveries/:deliveryId/report-issue', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerDeliveryController?.reportDeliveryIssue || ((req, res) => {
//     res.status(501).json({ 
//       success: false, 
//       message: 'Report delivery issue endpoint not implemented yet' 
//     });
//   })
// );

// // =============================================
// // DASHBOARD & ANALYTICS ROUTES
// // =============================================

// // Get buyer dashboard data
// router.get('/dashboard', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   buyerRequisitionController.getBuyerDashboard
// );

// // Get buyer analytics
// router.get('/analytics', 
//   authMiddleware, 
//   buyerAuthMiddleware,
//   async (req, res) => {
//     try {
//       const { period = '30d' } = req.query;
//       const PurchaseOrder = require('../models/PurchaseOrder');
//       const PurchaseRequisition = require('../models/PurchaseRequisition');

//       // Calculate date range based on period
//       const now = new Date();
//       let startDate;

//       switch (period) {
//         case '7d':
//           startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
//           break;
//         case '30d':
//           startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
//           break;
//         case '90d':
//           startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
//           break;
//         default:
//           startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
//       }

//       // Get purchase order analytics
//       const poAnalytics = await PurchaseOrder.aggregate([
//         { 
//           $match: { 
//             buyerId: req.user.userId, 
//             createdAt: { $gte: startDate } 
//           } 
//         },
//         {
//           $group: {
//             _id: '$status',
//             count: { $sum: 1 },
//             totalValue: { $sum: '$totalAmount' }
//           }
//         }
//       ]);

//       // Get requisition analytics
//       const reqAnalytics = await PurchaseRequisition.aggregate([
//         { 
//           $match: { 
//             assignedBuyerId: req.user.userId, 
//             createdAt: { $gte: startDate } 
//           } 
//         },
//         {
//           $group: {
//             _id: '$status',
//             count: { $sum: 1 }
//           }
//         }
//       ]);

//       res.json({
//         success: true,
//         data: {
//           period,
//           purchaseOrders: poAnalytics,
//           requisitions: reqAnalytics,
//           summary: {
//             totalPOs: poAnalytics.reduce((sum, item) => sum + item.count, 0),
//             totalValue: poAnalytics.reduce((sum, item) => sum + item.totalValue, 0),
//             totalRequisitions: reqAnalytics.reduce((sum, item) => sum + item.count, 0)
//           }
//         }
//       });

//     } catch (error) {
//       console.error('Get analytics error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch analytics',
//         error: error.message
//       });
//     }
//   }
// );

// // =============================================
// // PETTY CASH FORM ROUTES
// // =============================================

// // Stats route MUST come before :formId routes
// router.get(
//   '/petty-cash-forms/stats', 
//   authMiddleware,
//   buyerAuthMiddleware,
//   buyerRequisitionController.getPettyCashStats
// );

// // Get all petty cash forms for buyer
// router.get(
//   '/petty-cash-forms', 
//   authMiddleware,
//   buyerAuthMiddleware,
//   buyerRequisitionController.getPettyCashForms
// );

// // Download petty cash form PDF
// router.get(
//   '/petty-cash-forms/:formId/download', 
//   authMiddleware,
//   buyerAuthMiddleware,
//   buyerRequisitionController.downloadPettyCashFormPDF
// );

// // Get specific petty cash form details
// router.get(
//   '/petty-cash-forms/:formId', 
//   authMiddleware,
//   buyerAuthMiddleware,
//   buyerRequisitionController.getPettyCashFormDetails
// );

// // =============================================
// // ERROR HANDLING MIDDLEWARE
// // =============================================

// // Handle PDF-specific errors
// router.use((error, req, res, next) => {
//   // PDF generation errors
//   if (error.name === 'PDFGenerationError') {
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to generate PDF document',
//       error: error.message,
//       details: 'Please try again or contact support if the issue persists'
//     });
//   }

//   // File size errors
//   if (error.name === 'FileSizeError') {
//     return res.status(413).json({
//       success: false,
//       message: 'File size too large for processing',
//       error: error.message
//     });
//   }

//   // ZIP creation errors
//   if (error.name === 'ZipCreationError') {
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to create ZIP archive',
//       error: error.message
//     });
//   }

//   // Email sending errors
//   if (error.name === 'EmailError') {
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to send email with PDF attachment',
//       error: error.message
//     });
//   }

//   next(error);
// });

// module.exports = router;









