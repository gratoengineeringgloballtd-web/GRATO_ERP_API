const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PurchaseOrder = require('../models/PurchaseOrder');
const Quote = require('../models/Quote');
const User = require('../models/User');
const Supplier = require('../models/Supplier');
const Item = require('../models/Item');
const pdfService = require('../services/pdfService');
const archiver = require('archiver');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const RFQ = require('../models/RFQ');
const { saveFile, STORAGE_CATEGORIES } = require('../utils/localFileStorage');
const { buildPurchaseOrderPdfData } = require('../services/purchaseOrderPdfData');
const { sendEmail } = require('../services/emailService');

// ─────────────────────────────────────────────────────────────────────────────
// Multer config for justification document uploads
// ─────────────────────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../uploads/tender-justifications');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const _storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `TJ-${Date.now()}-${safe}`);
  }
});

const _fileFilter = (req, file, cb) => {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPEG, and PNG files are accepted for justification documents'), false);
  }
};

/**
 * Apply as middleware on POST /purchase-orders route BEFORE the controller.
 * Handles both multipart (file upload) and falls through for JSON bodies.
 */
const tenderJustificationUpload = multer({
  storage: _storage,
  fileFilter: _fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
}).single('justificationDocument');

// ─────────────────────────────────────────────────────────────────────────────
// Shared PO builder — used by both creation paths
// ─────────────────────────────────────────────────────────────────────────────
async function _buildAndSavePO({
  user,
  supplierDetails,
  items,
  totalAmount,
  currency,
  taxApplicable,
  taxRate,
  deliveryAddress,
  expectedDeliveryDate,
  paymentTerms,
  specialInstructions,
  notes,
  tenderId,
  tenderNumber,
  createdWithoutTender,
  tenderJustification
}) {
  const now = new Date();
  const year = now.getFullYear();
  const count = await PurchaseOrder.countDocuments();
  const poNumber = `PO-${year}-${String(count + 1).padStart(6, '0')}`;

  const processedItems = (items || []).map(item => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    return {
      description: item.description,
      quantity: qty,
      unitPrice: price,
      totalPrice: Number(item.totalPrice) || qty * price,
      unitOfMeasure: item.unitOfMeasure || 'Units',
      category: item.category || '',
      specifications: item.specifications || '',
      ...(item.itemId ? { itemId: item.itemId } : {})
    };
  });

  const subtotal = processedItems.reduce((s, i) => s + (i.totalPrice || 0), 0);
  const calcTaxAmount = taxApplicable && taxRate > 0 ? subtotal * (taxRate / 100) : 0;
  const calcTotal = subtotal + calcTaxAmount;

  const po = new PurchaseOrder({
    poNumber,
    status: 'pending_supply_chain_assignment',
    createdBy: user._id,
    buyerId: user._id,

    supplierDetails: {
      name: supplierDetails.name || '',
      email: supplierDetails.email || '',
      phone: supplierDetails.phone || '',
      address: supplierDetails.address || '',
      isExternal: supplierDetails.isExternal || false,
      ...(supplierDetails.id ? { id: supplierDetails.id } : {})
    },

    items: processedItems,
    subtotalAmount: subtotal,
    totalAmount: totalAmount || calcTotal,
    taxAmount: calcTaxAmount,
    currency: currency || 'XAF',
    taxApplicable: !!taxApplicable,
    taxRate: taxRate || 19.25,

    deliveryAddress: deliveryAddress || '',
    expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null,
    paymentTerms: paymentTerms || '30 days',
    specialInstructions: specialInstructions || '',
    notes: notes || '',

    creationDate: now,
    progress: 5,
    currentStage: 'created',

    // Tender linkage
    ...(tenderId ? { tenderId, tenderNumber } : {}),
    createdWithoutTender: !!createdWithoutTender,
    tenderJustification: tenderJustification || null,

    activities: [{
      type: 'created',
      description: createdWithoutTender
        ? `Purchase order created without tender — justification: "${tenderJustification?.documentName}"`
        : `Purchase order created${tenderNumber ? ` against tender ${tenderNumber}` : ''}`,
      user: user.fullName || user.email,
      timestamp: now
    }]
  });

  await po.save();
  return po;
}

// ─────────────────────────────────────────────────────────────────────────────
// getSuppliers
// ─────────────────────────────────────────────────────────────────────────────
const getSuppliers = async (req, res) => {
  try {
    const { search, category, page = 1, limit = 50 } = req.query;

    let query = {
      status: 'approved',
      'approvalStatus.status': 'approved'
    };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } }
      ];
    }

    if (category && category !== 'all') {
      query.categories = category;
    }

    const suppliers = await Supplier.find(query)
      .select('name email phone address businessType categories performance bankDetails')
      .sort({ name: 1, 'performance.overallRating': -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Supplier.countDocuments(query);

    res.json({
      success: true,
      data: suppliers,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: suppliers.length,
        totalRecords: total
      }
    });
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch suppliers', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// validatePOItems
// ─────────────────────────────────────────────────────────────────────────────
const validatePOItems = async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Items array is required' });
    }

    const itemValidations = await Promise.all(
      items.map(async (item) => {
        try {
          if (item.itemId) {
            const dbItem = await Item.findById(item.itemId);
            if (!dbItem || !dbItem.isActive) {
              return { valid: false, error: 'Item not found or inactive in database', item };
            }
            return {
              valid: true,
              dbItem,
              item: {
                ...item,
                description: dbItem.description,
                category: dbItem.category,
                unitOfMeasure: dbItem.unitOfMeasure,
                standardPrice: dbItem.standardPrice
              }
            };
          } else {
            if (!item.description || !item.quantity || !item.unitPrice) {
              return {
                valid: false,
                error: 'Description, quantity, and unit price are required for manual items',
                item
              };
            }
            return { valid: true, item: { ...item, totalPrice: item.quantity * item.unitPrice } };
          }
        } catch (error) {
          return { valid: false, error: error.message, item };
        }
      })
    );

    const validItems = itemValidations.filter(v => v.valid).map(v => v.item);
    const invalidItems = itemValidations.filter(v => !v.valid);

    res.json({
      success: true,
      data: {
        validItems,
        invalidItems,
        validCount: validItems.length,
        invalidCount: invalidItems.length,
        totalAmount: validItems.reduce(
          (sum, item) => sum + (item.totalPrice || item.quantity * item.unitPrice),
          0
        )
      }
    });
  } catch (error) {
    console.error('Validate PO items error:', error);
    res.status(500).json({ success: false, message: 'Failed to validate items', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// createPurchaseOrder  (Path A: with tender | Path B: without tender)
// ─────────────────────────────────────────────────────────────────────────────
const createPurchaseOrder = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    // Body fields arrive as strings when sent via FormData — parse JSON blobs
    const body = req.body;
    const parseField = (f) => {
      if (typeof f === 'string') {
        try { return JSON.parse(f); } catch { return f; }
      }
      return f;
    };

    const tenderId           = body.tenderId           || null;
    const documentName       = body.documentName       || null;
    const justificationNote  = body.justificationNote  || null;
    const items              = parseField(body.items)  || [];
    const supplierDetails    = parseField(body.supplierDetails) || {};
    const totalAmount        = Number(body.totalAmount) || 0;
    const currency           = body.currency           || 'XAF';
    const taxApplicable      = body.taxApplicable === 'true' || body.taxApplicable === true;
    const taxRate            = Number(body.taxRate)    || 19.25;
    const deliveryAddress    = body.deliveryAddress    || '';
    const expectedDeliveryDate = body.expectedDeliveryDate || null;
    const paymentTerms       = body.paymentTerms       || '';
    const specialInstructions = body.specialInstructions || '';
    const notes              = body.notes              || '';

    const hasFile = !!req.file;

    // ── Path A: with tender ────────────────────────────────────────────────
    if (tenderId) {
      const Tender = require('../models/Tender');
      const tender = await Tender.findById(tenderId);
      if (!tender) {
        return res.status(404).json({ success: false, message: `Tender ${tenderId} not found` });
      }
      if (!['approved', 'awarded'].includes(tender.status)) {
        return res.status(400).json({
          success: false,
          message: `Tender ${tender.tenderNumber} is not approved or awarded (status: ${tender.status})`
        });
      }

      const po = await _buildAndSavePO({
        user, supplierDetails, items, totalAmount, currency,
        taxApplicable, taxRate, deliveryAddress, expectedDeliveryDate,
        paymentTerms, specialInstructions, notes,
        tenderId,
        tenderNumber: tender.tenderNumber,
        createdWithoutTender: false,
        tenderJustification: null
      });

      const budgetCodeId = body.budgetCodeId;
      if (budgetCodeId) {
        try {
          const BudgetCode = require('../models/BudgetCode');
          await BudgetCode.findByIdAndUpdate(budgetCodeId, {
            $inc: { used: po.totalAmount }
          });
        } catch (budgetErr) {
          console.warn('PO created but budget code update failed:', budgetErr.message);
        }
      }

      tender.purchaseOrderId = po._id;
      await tender.save();

      return res.status(201).json({
        success: true,
        message: 'Purchase order created successfully',
        data: po
      });
    }

    // ── Path B: without tender — justification required ────────────────────
    if (!documentName || !documentName.trim()) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
      return res.status(400).json({
        success: false,
        message: 'Document name is required when creating a PO without a tender'
      });
    }
    if (!justificationNote || !justificationNote.trim()) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
      return res.status(400).json({
        success: false,
        message: 'Justification note is required when creating a PO without a tender'
      });
    }
    if (!hasFile) {
      return res.status(400).json({
        success: false,
        message: 'A signed justification document (PDF or image) must be uploaded when creating a PO without a tender'
      });
    }

    // Persist the uploaded file via storage utility
    let signedDocData;
    try {
      signedDocData = await saveFile(
        {
          buffer: fs.readFileSync(req.file.path),
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size
        },
        STORAGE_CATEGORIES.SIGNED_DOCUMENTS || 'signed-documents',
        'tender-justification',
        `TJ-${Date.now()}-${req.file.originalname}`
      );
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    } catch (fileErr) {
      console.error('File save error:', fileErr);
      // Fallback: serve straight from the upload dir
      signedDocData = {
        url: `/uploads/tender-justifications/${req.file.filename}`,
        localPath: req.file.path,
        originalName: req.file.originalname,
        uploadedAt: new Date()
      };
    }

    const tenderJustification = {
      documentName: documentName.trim(),
      justificationNote: justificationNote.trim(),
      signedDocument: {
        url: signedDocData.url,
        localPath: signedDocData.localPath,
        originalName: signedDocData.originalName || req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedAt: new Date()
      },
      submittedBy: req.user.userId,
      submittedAt: new Date()
    };

    const po = await _buildAndSavePO({
      user, supplierDetails, items, totalAmount, currency,
      taxApplicable, taxRate, deliveryAddress, expectedDeliveryDate,
      paymentTerms, specialInstructions, notes,
      tenderId: null,
      tenderNumber: null,
      createdWithoutTender: true,
      tenderJustification
    });

    return res.status(201).json({
      success: true,
      message: 'Purchase order created with justification (no tender)',
      data: po
    });

  } catch (err) {
    console.error('createPurchaseOrder error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({ success: false, message: 'Failed to create purchase order', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// createPurchaseOrderFromQuote
// ─────────────────────────────────────────────────────────────────────────────
const createPurchaseOrderFromQuote = async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { deliveryAddress, expectedDeliveryDate, paymentTerms, specialInstructions, termsAndConditions } = req.body;

    const quote = await Quote.findById(quoteId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('requisitionId', 'title deliveryLocation employee')
      .populate('rfqId', 'title buyerId');

    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (quote.status !== 'selected') {
      return res.status(400).json({ success: false, message: 'Quote must be selected before creating purchase order' });
    }
    if (quote.rfqId.buyerId.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to quote' });
    }

    const existingPO = await PurchaseOrder.findOne({ quoteId: quote._id });
    if (existingPO) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order already exists for this quote',
        data: { poNumber: existingPO.poNumber }
      });
    }

    const now = new Date();
    const year = now.getFullYear();
    const count = await PurchaseOrder.countDocuments();
    const poNumber = `PO-${year}-${String(count + 1).padStart(6, '0')}`;

    const purchaseOrder = new PurchaseOrder({
      poNumber,
      quoteId: quote._id,
      requisitionId: quote.requisitionId._id,
      supplierId: quote.supplierId._id,
      buyerId: req.user.userId,
      items: quote.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice || item.quantity * item.unitPrice,
        specifications: item.specifications
      })),
      totalAmount: quote.totalAmount,
      currency: quote.currency || 'XAF',
      deliveryAddress: deliveryAddress || quote.requisitionId.deliveryLocation,
      expectedDeliveryDate: expectedDeliveryDate
        ? new Date(expectedDeliveryDate)
        : new Date(Date.now() + (quote.deliveryTime?.value || 14) * 86400000),
      paymentTerms: paymentTerms || quote.paymentTerms || '30 days',
      specialInstructions,
      termsAndConditions,
      status: 'draft',
      progress: 5,
      currentStage: 'created',
      activities: [{
        type: 'created',
        description: 'Purchase order created from selected quote',
        user: req.user.fullName || 'Buyer',
        timestamp: now
      }],
      supplierDetails: {
        name: quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName,
        email: quote.supplierId.email,
        phone: quote.supplierId.phone,
        address: quote.supplierId.supplierDetails?.address
      },
      createdBy: req.user.userId
    });

    await purchaseOrder.save();

    quote.status = 'purchase_order_created';
    quote.purchaseOrderId = purchaseOrder._id;
    await quote.save();

    const requisition = await PurchaseRequisition.findById(quote.requisitionId._id);
    if (requisition) {
      requisition.status = 'procurement_complete';
      if (!requisition.procurementDetails) requisition.procurementDetails = {};
      requisition.procurementDetails.purchaseOrderId = purchaseOrder._id;
      requisition.procurementDetails.finalCost = quote.totalAmount;
      await requisition.save();
    }

    res.json({
      success: true,
      message: 'Purchase order created successfully',
      data: {
        purchaseOrder: {
          id: purchaseOrder._id,
          poNumber: purchaseOrder.poNumber,
          totalAmount: purchaseOrder.totalAmount,
          status: purchaseOrder.status,
          supplierName: purchaseOrder.supplierDetails.name,
          creationDate: purchaseOrder.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Create PO from quote error:', error);
    res.status(500).json({ success: false, message: 'Failed to create purchase order', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getPurchaseOrders
// ─────────────────────────────────────────────────────────────────────────────
const getPurchaseOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;

    let query = { buyerId: req.user.userId };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { poNumber: { $regex: search, $options: 'i' } },
        { 'supplierDetails.name': { $regex: search, $options: 'i' } }
      ];
    }

    const purchaseOrders = await PurchaseOrder.find(query)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('requisitionId', 'title requisitionNumber employee')
      .populate('quoteId', 'quoteNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await PurchaseOrder.countDocuments(query);

    const transformedPOs = purchaseOrders.map(po => ({
      id: po._id,
      poNumber: po.poNumber,
      requisitionId: po.requisitionId?.requisitionNumber || po.requisitionId?._id,
      supplierId: po.supplierId?._id,
      supplierName: po.supplierDetails?.name || po.supplierId?.supplierDetails?.companyName || po.supplierId?.fullName,
      supplierEmail: po.supplierDetails?.email || po.supplierId?.email,
      supplierPhone: po.supplierDetails?.phone || po.supplierId?.phone,
      creationDate: po.createdAt,
      expectedDeliveryDate: po.expectedDeliveryDate,
      status: po.status,
      totalAmount: po.totalAmount,
      currency: po.currency,
      paymentTerms: po.paymentTerms,
      deliveryAddress: po.deliveryAddress,
      progress: po.progress,
      currentStage: po.currentStage,
      items: po.items,
      activities: po.activities,
      deliveryTracking: po.deliveryTracking,
      specialInstructions: po.specialInstructions,
      notes: po.notes,
      tenderNumber: po.tenderNumber,
      createdWithoutTender: po.createdWithoutTender,
      tenderJustification: po.tenderJustification
    }));

    res.json({
      success: true,
      data: transformedPOs,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: transformedPOs.length,
        totalRecords: total
      }
    });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch purchase orders', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getPurchaseOrderDetails
// ─────────────────────────────────────────────────────────────────────────────
const getPurchaseOrderDetails = async (req, res) => {
  try {
    const { poId } = req.params;

    const purchaseOrder = await PurchaseOrder.findById(poId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('requisitionId', 'title requisitionNumber employee')
      .populate('quoteId', 'quoteNumber')
      .populate('createdBy', 'fullName')
      .populate('lastModifiedBy', 'fullName');

    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });

    if (purchaseOrder.buyerId.toString() !== req.user.userId) {
      const user = await User.findById(req.user.userId);
      if (!['admin', 'supply_chain'].includes(user.role)) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to purchase order' });
      }
    }

    res.json({
      success: true,
      data: {
        purchaseOrder: {
          id: purchaseOrder._id,
          poNumber: purchaseOrder.poNumber,
          requisitionId: purchaseOrder.requisitionId?._id,
          requisitionTitle: purchaseOrder.requisitionId?.title,
          supplierId: purchaseOrder.supplierId?._id,
          supplierName: purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.supplierDetails?.companyName || purchaseOrder.supplierId?.fullName,
          supplierEmail: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
          supplierPhone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
          creationDate: purchaseOrder.createdAt,
          expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
          actualDeliveryDate: purchaseOrder.actualDeliveryDate,
          status: purchaseOrder.status,
          totalAmount: purchaseOrder.totalAmount,
          currency: purchaseOrder.currency,
          paymentTerms: purchaseOrder.paymentTerms,
          deliveryAddress: purchaseOrder.deliveryAddress,
          deliveryTerms: purchaseOrder.deliveryTerms,
          progress: purchaseOrder.progress,
          currentStage: purchaseOrder.currentStage,
          items: purchaseOrder.items,
          activities: purchaseOrder.activities,
          deliveryTracking: purchaseOrder.deliveryTracking,
          notes: purchaseOrder.notes,
          internalNotes: purchaseOrder.internalNotes,
          attachments: purchaseOrder.attachments,
          specialInstructions: purchaseOrder.specialInstructions,
          termsAndConditions: purchaseOrder.termsAndConditions,
          performanceMetrics: purchaseOrder.performanceMetrics,
          createdBy: purchaseOrder.createdBy?.fullName,
          lastModifiedBy: purchaseOrder.lastModifiedBy?.fullName,
          lastModifiedDate: purchaseOrder.lastModifiedDate,
          tenderNumber: purchaseOrder.tenderNumber,
          createdWithoutTender: purchaseOrder.createdWithoutTender,
          tenderJustification: purchaseOrder.tenderJustification
        }
      }
    });
  } catch (error) {
    console.error('Get PO details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch purchase order details', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// updatePurchaseOrder
// ─────────────────────────────────────────────────────────────────────────────
const updatePurchaseOrder = async (req, res) => {
  try {
    const { poId } = req.params;
    const updates = req.body;

    const purchaseOrder = await PurchaseOrder.findById(poId);
    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });

    if (purchaseOrder.buyerId.toString() !== req.user.userId) {
      const user = await User.findById(req.user.userId);
      if (!['admin', 'supply_chain'].includes(user.role)) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to purchase order' });
      }
    }

    // Handle send-to-supply-chain status transition
    if (updates.status === 'pending_supply_chain_assignment' && purchaseOrder.status === 'draft') {
      purchaseOrder.status = 'pending_supply_chain_assignment';
      purchaseOrder.sentDate = new Date();
      purchaseOrder.activities.push({
        type: 'sent',
        description: 'Purchase order sent to Supply Chain for assignment',
        user: req.user.fullName || 'Buyer',
        timestamp: new Date()
      });
      await purchaseOrder.save();
      return res.json({
        success: true,
        message: 'Purchase order sent to Supply Chain successfully',
        data: { purchaseOrder: { id: purchaseOrder._id, poNumber: purchaseOrder.poNumber, status: purchaseOrder.status, sentDate: purchaseOrder.sentDate } }
      });
    }

    if (['sent_to_supplier', 'acknowledged', 'delivered', 'completed', 'cancelled'].includes(purchaseOrder.status)) {
      return res.status(400).json({ success: false, message: 'Cannot update purchase order in current status' });
    }

    const allowedUpdates = [
      'expectedDeliveryDate', 'deliveryAddress', 'paymentTerms',
      'specialInstructions', 'notes', 'internalNotes',
      'currency', 'taxApplicable', 'taxRate', 'items'
    ];

    Object.keys(updates).forEach(key => {
      if (!allowedUpdates.includes(key)) return;
      if (key === 'expectedDeliveryDate' && updates[key]) {
        purchaseOrder[key] = new Date(updates[key]);
      } else if (key === 'items' && Array.isArray(updates[key])) {
        purchaseOrder.items = updates[key].map(item => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.quantity * item.unitPrice,
          specifications: item.specifications || '',
          unitOfMeasure: item.unitOfMeasure || 'Units',
          category: item.category || '',
          ...(item.itemId && { itemId: item.itemId })
        }));
      } else {
        purchaseOrder[key] = updates[key];
      }
    });

    if (updates.items) {
      const subtotal = purchaseOrder.items.reduce((s, i) => s + (i.totalPrice || 0), 0);
      if (purchaseOrder.taxApplicable && purchaseOrder.taxRate > 0) {
        purchaseOrder.taxAmount = subtotal * (purchaseOrder.taxRate / 100);
        purchaseOrder.totalAmount = subtotal + purchaseOrder.taxAmount;
      } else {
        purchaseOrder.taxAmount = 0;
        purchaseOrder.totalAmount = subtotal;
      }
    }

    purchaseOrder.lastModifiedBy = req.user.userId;
    purchaseOrder.lastModifiedDate = new Date();
    purchaseOrder.activities.push({
      type: 'updated',
      description: 'Purchase order updated',
      user: req.user.fullName || 'Buyer',
      timestamp: new Date()
    });

    await purchaseOrder.save();

    res.json({
      success: true,
      message: 'Purchase order updated successfully',
      data: {
        purchaseOrder: {
          id: purchaseOrder._id,
          poNumber: purchaseOrder.poNumber,
          status: purchaseOrder.status,
          totalAmount: purchaseOrder.totalAmount,
          lastModifiedDate: purchaseOrder.lastModifiedDate
        }
      }
    });
  } catch (error) {
    console.error('Update PO error:', error);
    res.status(500).json({ success: false, message: 'Failed to update purchase order', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// sendPurchaseOrderToSupplier
// ─────────────────────────────────────────────────────────────────────────────
const sendPurchaseOrderToSupplier = async (req, res) => {
  try {
    const { poId } = req.params;
    const { message } = req.body;

    const purchaseOrder = await PurchaseOrder.findById(poId)
      .populate('supplierId', 'fullName email supplierDetails')
      .populate('requisitionId', 'title');

    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });

    if (purchaseOrder.buyerId.toString() !== req.user.userId) {
      const u = await User.findById(req.user.userId);
      if (!['admin', 'supply_chain'].includes(u.role)) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to purchase order' });
      }
    }

    if (!['draft', 'approved'].includes(purchaseOrder.status)) {
      return res.status(400).json({ success: false, message: 'Purchase order has already been sent or is not in sendable status' });
    }

    const user = await User.findById(req.user.userId);
    const supplierEmail = purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email;
    const supplierName = purchaseOrder.supplierDetails?.name ||
      purchaseOrder.supplierId?.supplierDetails?.companyName ||
      purchaseOrder.supplierId?.fullName;

    try {
      await sendEmail({
        to: supplierEmail,
        subject: `Purchase Order - ${purchaseOrder.poNumber}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
            <h2 style="color:#1890ff;">Purchase Order</h2>
            <p>Dear ${supplierName},</p>
            <p>Please find below the official purchase order:</p>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td><strong>PO Number:</strong></td><td>${purchaseOrder.poNumber}</td></tr>
              <tr><td><strong>Amount:</strong></td><td>${purchaseOrder.currency} ${purchaseOrder.totalAmount.toLocaleString()}</td></tr>
              <tr><td><strong>Expected Delivery:</strong></td><td>${new Date(purchaseOrder.expectedDeliveryDate).toLocaleDateString('en-GB')}</td></tr>
              <tr><td><strong>Payment Terms:</strong></td><td>${purchaseOrder.paymentTerms}</td></tr>
            </table>
            ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
            <p>Best regards,<br>${user.fullName}<br>Procurement Team</p>
          </div>`
      });

      purchaseOrder.status = 'sent_to_supplier';
      purchaseOrder.sentDate = new Date();
      purchaseOrder.progress = 25;
      purchaseOrder.currentStage = 'supplier_acknowledgment';
      purchaseOrder.activities.push({ type: 'sent', description: 'Purchase order sent to supplier', user: user.fullName || 'Buyer', timestamp: new Date() });
      await purchaseOrder.save();
    } catch (emailError) {
      console.error('Failed to send PO to supplier:', emailError);
      return res.status(500).json({ success: false, message: 'Failed to send purchase order to supplier' });
    }

    res.json({ success: true, message: 'Purchase order sent to supplier successfully', data: { purchaseOrder: { id: purchaseOrder._id, poNumber: purchaseOrder.poNumber, status: purchaseOrder.status, sentDate: purchaseOrder.sentDate } } });
  } catch (error) {
    console.error('Send PO error:', error);
    res.status(500).json({ success: false, message: 'Failed to send purchase order', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// cancelPurchaseOrder
// ─────────────────────────────────────────────────────────────────────────────
const cancelPurchaseOrder = async (req, res) => {
  try {
    const { poId } = req.params;
    const { cancellationReason } = req.body;

    const purchaseOrder = await PurchaseOrder.findById(poId)
      .populate('supplierId', 'fullName email supplierDetails');

    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });

    if (purchaseOrder.buyerId.toString() !== req.user.userId) {
      const u = await User.findById(req.user.userId);
      if (!['admin', 'supply_chain'].includes(u.role)) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to purchase order' });
      }
    }

    if (['completed', 'delivered'].includes(purchaseOrder.status)) {
      return res.status(400).json({ success: false, message: 'Cannot cancel completed or delivered purchase order' });
    }

    purchaseOrder.status = 'cancelled';
    purchaseOrder.cancellationReason = cancellationReason;
    purchaseOrder.cancelledDate = new Date();

    const user = await User.findById(req.user.userId);
    purchaseOrder.activities.push({ type: 'cancelled', description: `Purchase order cancelled: ${cancellationReason}`, user: user.fullName || 'Buyer', timestamp: new Date() });
    await purchaseOrder.save();

    if (purchaseOrder.sentDate) {
      try {
        const supplierEmail = purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email;
        const supplierName = purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.supplierDetails?.companyName || purchaseOrder.supplierId?.fullName;
        await sendEmail({
          to: supplierEmail,
          subject: `Purchase Order Cancelled - ${purchaseOrder.poNumber}`,
          html: `<p>Dear ${supplierName},</p><p>PO ${purchaseOrder.poNumber} has been cancelled.</p><p><strong>Reason:</strong> ${cancellationReason}</p><p>Please do not proceed with any deliveries.</p>`
        });
      } catch (emailError) {
        console.error('Cancellation email error:', emailError);
      }
    }

    res.json({ success: true, message: 'Purchase order cancelled successfully', data: { purchaseOrder: { id: purchaseOrder._id, poNumber: purchaseOrder.poNumber, status: purchaseOrder.status, cancelledDate: purchaseOrder.cancelledDate } } });
  } catch (error) {
    console.error('Cancel PO error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel purchase order', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF helpers
// ─────────────────────────────────────────────────────────────────────────────
const canAccessPurchaseOrderPdf = (purchaseOrder, reqUser) => {
  if (!purchaseOrder || !reqUser) return false;
  if (purchaseOrder.buyerId?.toString() === reqUser.userId) return true;
  if (['admin', 'supply_chain'].includes(reqUser.role)) return true;
  const approverEmail = reqUser.email?.toLowerCase();
  if (approverEmail) {
    return purchaseOrder.approvalChain?.some(step => step?.approver?.email?.toLowerCase() === approverEmail) || false;
  }
  return false;
};

const buildPurchaseOrderSignatureBlocks = async (purchaseOrder) => {
  const signatureBlocks = [
    { label: 'Supply Chain' },
    { label: 'Department Head' },
    { label: 'Head of Business' },
    { label: 'Finance' }
  ];

  if (!purchaseOrder) return signatureBlocks;

  if (purchaseOrder.supplyChainReview?.reviewedBy) {
    const scUser = await User.findById(purchaseOrder.supplyChainReview.reviewedBy).select('signature');
    signatureBlocks[0].signaturePath = scUser?.signature?.localPath || null;
    signatureBlocks[0].signedAt = purchaseOrder.supplyChainReview.reviewDate || null;
  }

  const approvedSteps = (purchaseOrder.approvalChain || []).filter(step => step?.status === 'approved');
  const approverEmails = approvedSteps.map(step => step?.approver?.email).filter(Boolean);

  if (approverEmails.length) {
    const approverUsers = await User.find({ email: { $in: approverEmails } }).select('email signature');
    const approverByEmail = new Map(approverUsers.map(u => [u.email, u]));
    approvedSteps.forEach(step => {
      const blockIndex = step.level;
      if (!signatureBlocks[blockIndex]) return;
      const approverUser = approverByEmail.get(step?.approver?.email);
      signatureBlocks[blockIndex].signaturePath = approverUser?.signature?.localPath || null;
      signatureBlocks[blockIndex].signedAt = step.actionDate || step.updatedAt || null;
    });
  }

  return signatureBlocks;
};

// ─────────────────────────────────────────────────────────────────────────────
// downloadPurchaseOrderPDF
// ─────────────────────────────────────────────────────────────────────────────
const downloadPurchaseOrderPDF = async (req, res) => {
  try {
    const { poId } = req.params;

    const purchaseOrder = await PurchaseOrder.findById(poId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('requisitionId', 'title requisitionNumber employee')
      .populate('quoteId', 'quoteNumber')
      .populate('createdBy', 'fullName')
      .populate('items.itemId', 'code description category unitOfMeasure');

    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (!canAccessPurchaseOrderPdf(purchaseOrder, req.user)) return res.status(403).json({ success: false, message: 'Unauthorized access to purchase order' });

    const safeNumber = (v, d = 0) => { const n = Number(v); return isNaN(n) ? d : n; };

    const taxApplicable = Boolean(purchaseOrder.taxApplicable);
    const taxRate = safeNumber(purchaseOrder.taxRate, 0);
    const totalAmount = safeNumber(purchaseOrder.totalAmount, 0);
    const taxAmount = safeNumber(purchaseOrder.taxAmount, 0);
    let subtotalAmount = safeNumber(purchaseOrder.subtotalAmount, 0);
    if (subtotalAmount === 0 && totalAmount > 0) {
      subtotalAmount = taxApplicable && taxRate > 0 ? totalAmount - taxAmount : totalAmount;
    }

    const pdfData = {
      ...buildPurchaseOrderPdfData(purchaseOrder),
      supplierDetails: {
        name: purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.supplierDetails?.companyName || purchaseOrder.supplierId?.fullName,
        email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
        phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
        address: purchaseOrder.supplierDetails?.address || purchaseOrder.supplierId?.supplierDetails?.address,
        businessType: purchaseOrder.supplierDetails?.businessType || purchaseOrder.supplierId?.supplierDetails?.businessType
      },
      totalAmount,
      subtotalAmount,
      taxApplicable,
      taxRate,
      taxAmount,
      items: (purchaseOrder.items || []).map(item => {
        const qty = safeNumber(item.quantity);
        const price = safeNumber(item.unitPrice);
        return {
          description: item.description || 'No description',
          quantity: qty,
          unitPrice: price,
          totalPrice: safeNumber(item.totalPrice, qty * price),
          discount: safeNumber(item.discount, 0),
          specifications: item.specifications,
          itemCode: item.itemCode || item.itemId?.code || '',
          category: item.category || item.itemId?.category || '',
          unitOfMeasure: item.unitOfMeasure || item.itemId?.unitOfMeasure || 'Units'
        };
      })
    };

    pdfData.signatures = await buildPurchaseOrderSignatureBlocks(purchaseOrder);

    const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
    if (!pdfResult.success) return res.status(500).json({ success: false, message: 'Failed to generate PDF', error: pdfResult.error });

    const filename = `PO_${purchaseOrder.poNumber}_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfResult.buffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(pdfResult.buffer);
  } catch (error) {
    console.error('Download PO PDF error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate PDF download', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// previewPurchaseOrderPDF
// ─────────────────────────────────────────────────────────────────────────────
const previewPurchaseOrderPDF = async (req, res) => {
  try {
    const { poId } = req.params;

    const purchaseOrder = await PurchaseOrder.findById(poId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('requisitionId', 'title requisitionNumber employee')
      .populate('items.itemId', 'code description category unitOfMeasure');

    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (!canAccessPurchaseOrderPdf(purchaseOrder, req.user)) return res.status(403).json({ success: false, message: 'Unauthorized access to purchase order' });

    const pdfData = {
      ...buildPurchaseOrderPdfData(purchaseOrder),
      supplierDetails: {
        name: purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.supplierDetails?.companyName || purchaseOrder.supplierId?.fullName,
        email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
        phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
        address: purchaseOrder.supplierDetails?.address
      },
      items: purchaseOrder.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice || item.quantity * item.unitPrice,
        specifications: item.specifications,
        itemCode: item.itemCode,
        category: item.category,
        unitOfMeasure: item.unitOfMeasure
      }))
    };

    pdfData.signatures = await buildPurchaseOrderSignatureBlocks(purchaseOrder);

    const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
    if (!pdfResult.success) return res.status(500).json({ success: false, message: 'Failed to generate PDF preview', error: pdfResult.error });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="PO_${purchaseOrder.poNumber}_preview.pdf"`);
    res.setHeader('Content-Length', pdfResult.buffer.length);
    res.send(pdfResult.buffer);
  } catch (error) {
    console.error('Preview PO PDF error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate PDF preview', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// emailPurchaseOrderPDF
// ─────────────────────────────────────────────────────────────────────────────
const emailPurchaseOrderPDF = async (req, res) => {
  try {
    const { poId } = req.params;
    const { emailTo, emailType = 'supplier', message = '' } = req.body;

    const purchaseOrder = await PurchaseOrder.findById(poId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('requisitionId', 'title requisitionNumber employee')
      .populate('items.itemId', 'code description category unitOfMeasure');

    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (!canAccessPurchaseOrderPdf(purchaseOrder, req.user)) return res.status(403).json({ success: false, message: 'Unauthorized access to purchase order' });

    const pdfData = {
      ...buildPurchaseOrderPdfData(purchaseOrder),
      supplierDetails: {
        name: purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.fullName,
        email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
        phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
        address: purchaseOrder.supplierDetails?.address
      },
      items: purchaseOrder.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice || item.quantity * item.unitPrice,
        specifications: item.specifications
      }))
    };

    pdfData.signatures = await buildPurchaseOrderSignatureBlocks(purchaseOrder);

    const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
    if (!pdfResult.success) return res.status(500).json({ success: false, message: 'Failed to generate PDF for email', error: pdfResult.error });

    const user = await User.findById(req.user.userId);
    const recipientEmail = emailTo || purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email;
    const recipientName = emailType === 'supplier' ? (purchaseOrder.supplierDetails?.name || 'Supplier') : 'Team';

    const emailResult = await sendEmail({
      to: recipientEmail,
      subject: `Purchase Order ${purchaseOrder.poNumber} - PDF Document`,
      html: `
        <div style="font-family:Arial,sans-serif;">
          <h2>Purchase Order Document</h2>
          <p>Dear ${recipientName},</p>
          <p>Please find attached the PDF document for Purchase Order ${purchaseOrder.poNumber}.</p>
          <p><strong>Amount:</strong> ${purchaseOrder.currency} ${purchaseOrder.totalAmount.toLocaleString()}</p>
          <p><strong>Expected Delivery:</strong> ${new Date(purchaseOrder.expectedDeliveryDate).toLocaleDateString('en-GB')}</p>
          ${message ? `<p>${message}</p>` : ''}
          <p>Best regards,<br>${user.fullName}<br>Procurement Team</p>
        </div>`,
      attachments: [{ filename: pdfResult.filename, content: pdfResult.buffer, contentType: 'application/pdf' }]
    });

    if (!emailResult.success) return res.status(500).json({ success: false, message: 'Failed to send email with PDF attachment', error: emailResult.error });

    res.json({ success: true, message: `Purchase order PDF sent successfully to ${recipientEmail}`, data: { poNumber: purchaseOrder.poNumber, sentTo: recipientEmail, filename: pdfResult.filename } });
  } catch (error) {
    console.error('Email PO PDF error:', error);
    res.status(500).json({ success: false, message: 'Failed to email PDF', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// bulkDownloadPurchaseOrders
// ─────────────────────────────────────────────────────────────────────────────
const bulkDownloadPurchaseOrders = async (req, res) => {
  try {
    const { poIds } = req.body;

    if (!poIds || !Array.isArray(poIds) || poIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Purchase order IDs are required' });
    }
    if (poIds.length > 50) {
      return res.status(400).json({ success: false, message: 'Cannot download more than 50 purchase orders at once' });
    }

    const purchaseOrders = await PurchaseOrder.find({ _id: { $in: poIds }, buyerId: req.user.userId })
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('requisitionId', 'title requisitionNumber')
      .populate('items.itemId', 'code description category unitOfMeasure');

    if (purchaseOrders.length === 0) return res.status(404).json({ success: false, message: 'No valid purchase orders found' });

    const pdfResults = await Promise.all(
      purchaseOrders.map(async po => {
        const pdfData = {
          ...buildPurchaseOrderPdfData(po),
          supplierDetails: {
            name: po.supplierDetails?.name || po.supplierId?.fullName,
            email: po.supplierDetails?.email || po.supplierId?.email,
            phone: po.supplierDetails?.phone || po.supplierId?.phone,
            address: po.supplierDetails?.address
          },
          items: po.items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice || item.quantity * item.unitPrice,
            specifications: item.specifications
          }))
        };
        const result = await pdfService.generatePurchaseOrderPDF(pdfData);
        return { poNumber: po.poNumber, filename: `PO_${po.poNumber}.pdf`, buffer: result.success ? result.buffer : null, success: result.success };
      })
    );

    const successfulPDFs = pdfResults.filter(p => p.success && p.buffer);
    if (successfulPDFs.length === 0) return res.status(500).json({ success: false, message: 'Failed to generate any PDFs' });

    const zipFilename = `Purchase_Orders_${new Date().toISOString().split('T')[0]}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => {
      console.error('ZIP error:', err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to create ZIP file' });
    });
    archive.pipe(res);
    successfulPDFs.forEach(pdf => archive.append(pdf.buffer, { name: pdf.filename }));
    await archive.finalize();
  } catch (error) {
    console.error('Bulk download error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to create bulk download', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getSupplyChainPendingPOs
// ─────────────────────────────────────────────────────────────────────────────
const getSupplyChainPendingPOs = async (req, res) => {
  try {
    const purchaseOrders = await PurchaseOrder.find({ status: { $in: ['draft', 'pending_supply_chain_assignment'] } })
      .populate('supplierId', 'name email phone address businessType')
      .populate('buyerId', 'fullName email')
      .sort({ createdAt: -1 });

    const transformedPOs = purchaseOrders.map(po => ({
      id: po._id,
      poNumber: po.poNumber,
      supplierName: po.supplierDetails?.name || 'Unknown Supplier',
      supplierEmail: po.supplierDetails?.email || '',
      supplierPhone: po.supplierDetails?.phone || '',
      totalAmount: po.totalAmount,
      currency: po.currency,
      items: po.items,
      creationDate: po.createdAt,
      expectedDeliveryDate: po.expectedDeliveryDate,
      paymentTerms: po.paymentTerms,
      deliveryAddress: po.deliveryAddress,
      buyerName: po.buyerId?.fullName,
      buyerEmail: po.buyerId?.email,
      status: po.status,
      progress: po.progress,
      currentStage: po.currentStage,
      activities: po.activities
    }));

    res.json({ success: true, data: transformedPOs });
  } catch (error) {
    console.error('Get SC pending POs error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pending purchase orders', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getSupplyChainPOStats
// ─────────────────────────────────────────────────────────────────────────────
const getSupplyChainPOStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [pendingAssignment, assignedToday, rejectedToday, inApprovalChain] = await Promise.all([
      PurchaseOrder.countDocuments({ status: { $in: ['draft', 'pending_supply_chain_assignment'] } }),
      PurchaseOrder.countDocuments({ status: { $in: ['pending_department_approval', 'pending_head_of_business_approval', 'pending_finance_approval'] }, assignmentDate: { $gte: today } }),
      PurchaseOrder.countDocuments({ status: 'rejected', 'supplyChainReview.reviewDate': { $gte: today } }),
      PurchaseOrder.countDocuments({ status: { $in: ['pending_department_approval', 'pending_head_of_business_approval', 'pending_finance_approval'] } })
    ]);

    res.json({ success: true, data: { pendingAssignment, assignedToday, rejectedToday, inApprovalChain } });
  } catch (error) {
    console.error('Get SC stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// downloadPOForSigning
// ─────────────────────────────────────────────────────────────────────────────
const downloadPOForSigning = async (req, res) => {
  try {
    const { poId } = req.params;

    const purchaseOrder = await PurchaseOrder.findById(poId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('requisitionId', 'title requisitionNumber')
      .populate('items.itemId', 'code description category unitOfMeasure');

    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });

    const pdfData = {
      ...buildPurchaseOrderPdfData(purchaseOrder),
      supplierDetails: {
        name: purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.fullName,
        email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
        phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
        address: purchaseOrder.supplierDetails?.address
      },
      items: purchaseOrder.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice || item.quantity * item.unitPrice,
        specifications: item.specifications
      }))
    };

    const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
    if (!pdfResult.success) return res.status(500).json({ success: false, message: 'Failed to generate PDF' });

    const base64 = pdfResult.buffer.toString('base64');
    res.json({ success: true, data: { url: `data:application/pdf;base64,${base64}`, fileName: `PO_${purchaseOrder.poNumber}.pdf` } });
  } catch (error) {
    console.error('Download PO for signing error:', error);
    res.status(500).json({ success: false, message: 'Failed to download purchase order', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// assignPOToDepartment
// ─────────────────────────────────────────────────────────────────────────────
const assignPOToDepartment = async (req, res) => {
  try {
    const { poId } = req.params;
    const { department, comments } = req.body;

    if (!department) return res.status(400).json({ success: false, message: 'Department selection is required' });

    const purchaseOrder = await PurchaseOrder.findById(poId);
    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (!['draft', 'pending_supply_chain_assignment'].includes(purchaseOrder.status)) {
      return res.status(400).json({ success: false, message: `PO cannot be assigned from status: ${purchaseOrder.status}` });
    }

    const supplyChainUser = await User.findById(req.user.userId).select('fullName signature email');
    const reviewDate = new Date();

    const signatureBlocks = [
      { label: 'Supply Chain', signaturePath: supplyChainUser?.signature?.localPath || null, signedAt: reviewDate },
      { label: 'Department Head' },
      { label: 'Head of Business' },
      { label: 'Finance' }
    ];

    const pdfData = { ...buildPurchaseOrderPdfData(purchaseOrder), signatures: signatureBlocks };
    const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
    if (!pdfResult.success) return res.status(500).json({ success: false, message: pdfResult.error || 'Failed to generate signed document' });

    const signedDocData = await saveFile(
      { buffer: pdfResult.buffer, originalname: `PO-${purchaseOrder.poNumber}-SC-signed.pdf`, mimetype: 'application/pdf', size: pdfResult.buffer.length },
      STORAGE_CATEGORIES.SIGNED_DOCUMENTS,
      'supply-chain',
      `PO-${purchaseOrder.poNumber}-SC-signed-${Date.now()}.pdf`
    );

    const { getPOApprovalChain } = require('../config/poApprovalChain');
    const approvalChain = getPOApprovalChain(department);
    if (!approvalChain || approvalChain.length !== 3) {
      return res.status(500).json({ success: false, message: `Failed to create approval chain for ${department}` });
    }

    purchaseOrder.status = 'pending_department_approval';
    purchaseOrder.assignedDepartment = department;
    purchaseOrder.assignedBy = req.user.userId;
    purchaseOrder.assignmentDate = new Date();
    purchaseOrder.assignmentTime = new Date().toTimeString().split(' ')[0];
    purchaseOrder.progress = 30;
    purchaseOrder.currentStage = 'created';

    purchaseOrder.supplyChainReview = {
      reviewedBy: req.user.userId,
      reviewDate,
      reviewTime: reviewDate.toTimeString().split(' ')[0],
      action: 'assigned',
      comments: comments || `Assigned to ${department} department`,
      signedDocument: { url: signedDocData.url, localPath: signedDocData.localPath, originalName: signedDocData.originalName, uploadedAt: signedDocData.uploadedAt }
    };

    purchaseOrder.approvalChain = approvalChain.map((step, index) => ({
      level: step.level,
      approver: { name: step.approver, email: step.email, role: step.role, department: step.department },
      status: 'pending',
      activatedDate: index === 0 ? new Date() : null
    }));

    purchaseOrder.currentApprovalLevel = 1;
    purchaseOrder.activities.push({ type: 'updated', description: `Purchase order assigned to ${department} by Supply Chain`, user: req.user.fullName, timestamp: new Date() });

    await purchaseOrder.save();

    try {
      const firstApprover = purchaseOrder.approvalChain[0];
      await sendEmail({
        to: firstApprover.approver.email,
        subject: `Purchase Order Approval Required - ${purchaseOrder.poNumber}`,
        html: `<p>Dear ${firstApprover.approver.name},</p><p>PO ${purchaseOrder.poNumber} (${purchaseOrder.currency} ${purchaseOrder.totalAmount.toLocaleString()}) requires your approval as Department Head.</p><p>Please log in to review and approve.</p>`
      });
    } catch (emailError) {
      console.error('Failed to send approval notification:', emailError);
    }

    res.json({ success: true, message: 'Purchase order assigned successfully', data: { poNumber: purchaseOrder.poNumber, assignedTo: department, currentApprover: purchaseOrder.approvalChain[0].approver.name, status: purchaseOrder.status } });
  } catch (error) {
    console.error('Assign PO error:', error);
    res.status(500).json({ success: false, message: 'Failed to assign purchase order', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// rejectPO
// ─────────────────────────────────────────────────────────────────────────────
const rejectPO = async (req, res) => {
  try {
    const { poId } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason || rejectionReason.trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Rejection reason must be at least 10 characters' });
    }

    const purchaseOrder = await PurchaseOrder.findById(poId).populate('buyerId', 'fullName email');
    if (!purchaseOrder) return res.status(404).json({ success: false, message: 'Purchase order not found' });

    purchaseOrder.status = 'rejected';
    purchaseOrder.rejectionDetails = { rejectedBy: req.user.userId, rejectedAt: new Date(), reason: rejectionReason, stage: 'supply_chain' };
    purchaseOrder.activities.push({ type: 'cancelled', description: `Rejected by Supply Chain: ${rejectionReason}`, user: req.user.fullName, timestamp: new Date() });
    await purchaseOrder.save();

    try {
      await sendEmail({
        to: purchaseOrder.buyerId.email,
        subject: `Purchase Order ${purchaseOrder.poNumber} - Rejected`,
        html: `<p>Dear ${purchaseOrder.buyerId.fullName},</p><p>PO ${purchaseOrder.poNumber} was rejected by Supply Chain.</p><p><strong>Reason:</strong> ${rejectionReason}</p><p>Please revise and resubmit.</p>`
      });
    } catch (emailError) {
      console.error('Rejection email error:', emailError);
    }

    res.json({ success: true, message: 'Purchase order rejected successfully' });
  } catch (error) {
    console.error('Reject PO error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject purchase order', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  tenderJustificationUpload,   // ← exported for use in routes
  getSuppliers,
  validatePOItems,
  createPurchaseOrder,
  createPurchaseOrderFromQuote,
  getPurchaseOrders,
  getPurchaseOrderDetails,
  updatePurchaseOrder,
  sendPurchaseOrderToSupplier,
  cancelPurchaseOrder,
  downloadPurchaseOrderPDF,
  previewPurchaseOrderPDF,
  emailPurchaseOrderPDF,
  bulkDownloadPurchaseOrders,
  getSupplyChainPendingPOs,
  getSupplyChainPOStats,
  downloadPOForSigning,
  assignPOToDepartment,
  rejectPO
};












// const PurchaseOrder = require('../models/PurchaseOrder');
// const Quote = require('../models/Quote');
// const User = require('../models/User');
// const Supplier = require('../models/Supplier'); 
// const Item = require('../models/Item');
// const pdfService = require('../services/pdfService'); 
// const archiver = require('archiver');
// const PurchaseRequisition = require('../models/PurchaseRequisition');
// const RFQ = require('../models/RFQ');
// const { saveFile, STORAGE_CATEGORIES } = require('../utils/localFileStorage');
// const { buildPurchaseOrderPdfData } = require('../services/purchaseOrderPdfData');
// const { sendEmail } = require('../services/emailService');

// const getSuppliers = async (req, res) => {
//   try {
//     const { search, category, page = 1, limit = 50 } = req.query;

//     let query = { 
//       status: 'approved', 
//       'approvalStatus.status': 'approved' 
//     };

//     // Add search filters
//     if (search) {
//       query.$or = [
//         { name: { $regex: search, $options: 'i' } },
//         { email: { $regex: search, $options: 'i' } },
//         { 'address.city': { $regex: search, $options: 'i' } }
//       ];
//     }

//     // Add category filter
//     if (category && category !== 'all') {
//       query.categories = category;
//     }

//     console.log('Supplier query:', JSON.stringify(query, null, 2));

//     const suppliers = await Supplier.find(query)
//       .select('name email phone address businessType categories performance bankDetails')
//       .sort({ name: 1, 'performance.overallRating': -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit);

//     const total = await Supplier.countDocuments(query);

//     console.log(`Found ${suppliers.length} suppliers out of ${total} total`);

//     res.json({
//       success: true,
//       data: suppliers,
//       pagination: {
//         current: parseInt(page),
//         total: Math.ceil(total / limit),
//         count: suppliers.length,
//         totalRecords: total
//       }
//     });

//   } catch (error) {
//     console.error('Get suppliers error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch suppliers',
//       error: error.message
//     });
//   }
// };

// // Validate and get items for PO creation
// const validatePOItems = async (req, res) => {
//   try {
//     const { items } = req.body;

//     if (!items || !Array.isArray(items) || items.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Items array is required'
//       });
//     }

//     // Extract item IDs and validate each item
//     const itemValidations = await Promise.all(
//       items.map(async (item) => {
//         try {
//           // If itemId is provided, validate against database
//           if (item.itemId) {
//             const dbItem = await Item.findById(item.itemId);
//             if (!dbItem || !dbItem.isActive) {
//               return {
//                 valid: false,
//                 error: 'Item not found or inactive in database',
//                 item
//               };
//             }

//             return {
//               valid: true,
//               dbItem,
//               item: {
//                 ...item,
//                 description: dbItem.description,
//                 category: dbItem.category,
//                 unitOfMeasure: dbItem.unitOfMeasure,
//                 standardPrice: dbItem.standardPrice
//               }
//             };
//           } else {
//             // Manual item entry - validate required fields
//             if (!item.description || !item.quantity || !item.unitPrice) {
//               return {
//                 valid: false,
//                 error: 'Description, quantity, and unit price are required for manual items',
//                 item
//               };
//             }

//             return {
//               valid: true,
//               item: {
//                 ...item,
//                 totalPrice: item.quantity * item.unitPrice
//               }
//             };
//           }
//         } catch (error) {
//           return {
//             valid: false,
//             error: error.message,
//             item
//           };
//         }
//       })
//     );

//     const validItems = itemValidations.filter(v => v.valid).map(v => v.item);
//     const invalidItems = itemValidations.filter(v => !v.valid);

//     res.json({
//       success: true,
//       data: {
//         validItems,
//         invalidItems,
//         validCount: validItems.length,
//         invalidCount: invalidItems.length,
//         totalAmount: validItems.reduce((sum, item) => sum + (item.totalPrice || (item.quantity * item.unitPrice)), 0)
//       }
//     });

//   } catch (error) {
//     console.error('Validate PO items error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to validate items',
//       error: error.message
//     });
//   }
// };

// // Create purchase order independently
// const createPurchaseOrder = async (req, res) => {
//   try {
//     const {
//       supplierDetails,
//       items,
//       totalAmount,
//       currency = 'XAF',
//       taxApplicable = false,
//       taxRate = 19.2,
//       deliveryAddress,
//       expectedDeliveryDate,
//       paymentTerms,
//       specialInstructions,
//       notes
//     } = req.body;

//     console.log('Creating PO with data:', {
//       supplierType: supplierDetails?.isExternal ? 'External' : 'Registered',
//       supplierId: supplierDetails?.id,
//       supplierName: supplierDetails?.name,
//       supplierEmail: supplierDetails?.email,
//       itemsCount: items?.length,
//       totalAmount
//     });

//     // Validation
//     if (!supplierDetails || !supplierDetails.name || !supplierDetails.email) {
//       return res.status(400).json({
//         success: false,
//         message: 'Supplier details (name and email) are required'
//       });
//     }

//     // For external suppliers, we don't need a supplierId, but for registered suppliers we do
//     if (!supplierDetails.isExternal && !supplierDetails.id) {
//       return res.status(400).json({
//         success: false,
//         message: 'Registered supplier must have an ID'
//       });
//     }

//     if (!items || items.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'At least one item is required'
//       });
//     }

//     if (!deliveryAddress || !expectedDeliveryDate || !paymentTerms) {
//       return res.status(400).json({
//         success: false,
//         message: 'Delivery address, expected delivery date, and payment terms are required'
//       });
//     }

//     // Validate supplier exists (only for registered suppliers)
//     let supplier = null;
//     let supplierUser = null;
//     if (!supplierDetails.isExternal) {
//       supplier = await Supplier.findById(supplierDetails.id);
//       if (!supplier) {
//         supplierUser = await User.findOne({ _id: supplierDetails.id, role: 'supplier' });
//         if (!supplierUser) {
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid supplier selected - supplier not found in database'
//           });
//         }

//         if (supplierUser.supplierStatus?.accountStatus !== 'approved' || !supplierUser.isActive) {
//           return res.status(400).json({
//             success: false,
//             message: 'Selected supplier is not approved for orders'
//           });
//         }
//       } else if (supplier.status !== 'approved') {
//         return res.status(400).json({
//           success: false,
//           message: 'Selected supplier is not approved for orders'
//         });
//       }
//     }

//     // Validate and process items
//     let calculatedSubtotal = 0;
//     const processedItems = await Promise.all(
//       items.map(async (item, index) => {
//         if (!item.description || !item.quantity || item.quantity <= 0 || !item.unitPrice || item.unitPrice <= 0) {
//           throw new Error(`Item ${index + 1}: Description, valid quantity, and unit price are required`);
//         }

//         const itemTotal = item.quantity * item.unitPrice;
//         calculatedSubtotal += itemTotal;

//         // If itemId is provided, fetch additional details from database
//         let itemDetails = {
//           description: item.description,
//           quantity: item.quantity,
//           unitPrice: item.unitPrice,
//           totalPrice: itemTotal,
//           specifications: item.specifications || ''
//         };

//         if (item.itemId) {
//           const dbItem = await Item.findById(item.itemId);
//           if (dbItem) {
//             itemDetails = {
//               ...itemDetails,
//               itemId: item.itemId,
//               itemCode: dbItem.code,
//               category: dbItem.category,
//               unitOfMeasure: dbItem.unitOfMeasure
//             };
//           }
//         }

//         return itemDetails;
//       })
//     );


//     // Calculate tax
//     let calculatedTaxAmount = 0;
//     let calculatedTotal = calculatedSubtotal;

//     if (taxApplicable && taxRate > 0) {
//       calculatedTaxAmount = calculatedSubtotal * (taxRate / 100);
//       calculatedTotal = calculatedSubtotal + calculatedTaxAmount;
//     }

//     console.log('Purchase Order Calculations:', {
//       subtotal: calculatedSubtotal,
//       taxRate: taxRate,
//       taxAmount: calculatedTaxAmount,
//       total: calculatedTotal
//     });



//     // Validate dates (allow same-day delivery)
//     const deliveryDate = new Date(expectedDeliveryDate);
//     const todayStart = new Date();
//     todayStart.setHours(0, 0, 0, 0);

//     if (deliveryDate < todayStart) {
//       return res.status(400).json({
//         success: false,
//         message: 'Expected delivery date cannot be in the past'
//       });
//     }

//     // Generate PO number
//     const now = new Date();
//     const year = now.getFullYear();
//     const count = await PurchaseOrder.countDocuments();
//     const poNumber = `PO-${year}-${String(count + 1).padStart(6, '0')}`;

//     const supplierSnapshot = supplier ? {
//       name: supplier.name,
//       email: supplier.email,
//       phone: supplier.phone,
//       address: typeof supplier.address === 'object'
//         ? `${supplier.address.street || ''}, ${supplier.address.city || ''}, ${supplier.address.state || ''}`.trim()
//         : supplier.address || '',
//       businessType: supplier.businessType,
//       registrationNumber: supplier.registrationNumber,
//       taxId: supplier.taxId
//     } : supplierUser ? {
//       name: supplierUser.supplierDetails?.companyName || supplierUser.fullName || supplierDetails.name,
//       email: supplierUser.email || supplierDetails.email,
//       phone: supplierUser.phoneNumber || supplierUser.supplierDetails?.phoneNumber || supplierDetails.phone || '',
//       address: supplierUser.supplierDetails?.address
//         ? `${supplierUser.supplierDetails.address.street || ''}, ${supplierUser.supplierDetails.address.city || ''}, ${supplierUser.supplierDetails.address.state || ''}`.trim()
//         : (supplierDetails.address || ''),
//       businessType: supplierUser.supplierDetails?.businessType || supplierDetails.businessType,
//       registrationNumber: supplierUser.supplierDetails?.businessRegistrationNumber || null,
//       taxId: supplierUser.supplierDetails?.taxIdNumber || null
//     } : {
//       name: supplierDetails.name,
//       email: supplierDetails.email,
//       phone: supplierDetails.phone || '',
//       address: supplierDetails.address || '',
//       businessType: supplierDetails.businessType || 'External Supplier',
//       registrationNumber: null,
//       taxId: null
//     };

//     // Create purchase order with proper supplier reference
//     const purchaseOrder = new PurchaseOrder({
//       poNumber,
//       supplierId: supplier?._id || null, // Use Supplier model ID when available
//       buyerId: req.user.userId,

//       // // Order details
//       // items: processedItems,
//       // totalAmount: calculatedTotal,
//       // currency,
//       // taxApplicable,
//       // taxRate,

//       items: processedItems,
//       subtotalAmount: calculatedSubtotal,
//       totalAmount: calculatedTotal, 
//       taxAmount: calculatedTaxAmount,
//       currency,
//       taxApplicable,
//       taxRate,

//       // Delivery and payment
//       deliveryAddress,
//       expectedDeliveryDate: deliveryDate,
//       paymentTerms,

//       // Additional details
//       specialInstructions,
//       notes,

//       // Status
//       status: 'draft',
//       progress: 5,
//       currentStage: 'created',

//       // Activities
//       activities: [{
//         type: 'created',
//         description: 'Purchase order created',
//         user: req.user.fullName || 'Buyer',
//         timestamp: new Date()
//       }],

//       // Supplier details snapshot
//       supplierDetails: supplierSnapshot,

//       createdBy: req.user.userId
//     });

//     await purchaseOrder.save();

//     console.log('Created purchase order:', {
//       id: purchaseOrder._id,
//       poNumber: purchaseOrder.poNumber,
//       supplierId: purchaseOrder.supplierId,
//       totalAmount: purchaseOrder.totalAmount
//     });

//     res.json({
//       success: true,
//       message: 'Purchase order created successfully',
//       data: {
//         purchaseOrder: {
//           id: purchaseOrder._id,
//           poNumber: purchaseOrder.poNumber,
//           totalAmount: purchaseOrder.totalAmount,
//           currency: purchaseOrder.currency,
//           status: purchaseOrder.status,
//           supplierName: purchaseOrder.supplierDetails.name,
//           creationDate: purchaseOrder.createdAt,
//           expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
//           items: purchaseOrder.items
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Create purchase order error:', error);
//     res.status(500).json({
//       success: false,
//       message: error.message || 'Failed to create purchase order',
//       error: error.message
//     });
//   }
// };


// // Create purchase order from selected quote
// const createPurchaseOrderFromQuote = async (req, res) => {
//   try {
//     const { quoteId } = req.params;
//     const {
//       deliveryAddress,
//       expectedDeliveryDate,
//       paymentTerms,
//       specialInstructions,
//       termsAndConditions
//     } = req.body;

//     const quote = await Quote.findById(quoteId)
//       .populate('supplierId', 'fullName email phone supplierDetails')
//       .populate('requisitionId', 'title deliveryLocation employee')
//       .populate('rfqId', 'title buyerId');

//     if (!quote) {
//       return res.status(404).json({
//         success: false,
//         message: 'Quote not found'
//       });
//     }

//     // Verify quote is selected
//     if (quote.status !== 'selected') {
//       return res.status(400).json({
//         success: false,
//         message: 'Quote must be selected before creating purchase order'
//       });
//     }

//     // Verify buyer owns the RFQ for this quote
//     if (quote.rfqId.buyerId.toString() !== req.user.userId) {
//       return res.status(403).json({
//         success: false,
//         message: 'Unauthorized access to quote'
//       });
//     }

//     // Check if PO already exists for this quote
//     const existingPO = await PurchaseOrder.findOne({ quoteId: quote._id });
//     if (existingPO) {
//       return res.status(400).json({
//         success: false,
//         message: 'Purchase order already exists for this quote',
//         data: { poNumber: existingPO.poNumber }
//       });
//     }

//     // Generate PO number
//     const now = new Date();
//     const year = now.getFullYear();
//     const count = await PurchaseOrder.countDocuments();
//     const poNumber = `PO-${year}-${String(count + 1).padStart(6, '0')}`;

//     // Create purchase order
//     const purchaseOrder = new PurchaseOrder({
//       poNumber,
//       quoteId: quote._id,
//       requisitionId: quote.requisitionId._id,
//       supplierId: quote.supplierId._id,
//       buyerId: req.user.userId,

//       // Order details
//       items: quote.items.map(item => ({
//         description: item.description,
//         quantity: item.quantity,
//         unitPrice: item.unitPrice,
//         totalPrice: item.totalPrice || (item.quantity * item.unitPrice),
//         specifications: item.specifications
//       })),

//       totalAmount: quote.totalAmount,
//       currency: quote.currency || 'XAF',

//       // Delivery and payment
//       deliveryAddress: deliveryAddress || quote.requisitionId.deliveryLocation,
//       expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : new Date(Date.now() + (quote.deliveryTime?.value || 14) * 24 * 60 * 60 * 1000),
//       paymentTerms: paymentTerms || quote.paymentTerms || '30 days',

//       // Additional details
//       specialInstructions,
//       termsAndConditions,

//       // Status
//       status: 'draft',
//       progress: 5,
//       currentStage: 'created',

//       // Activities
//       activities: [{
//         type: 'created',
//         description: 'Purchase order created from selected quote',
//         user: req.user.fullName || 'Buyer',
//         timestamp: new Date()
//       }],

//       // Supplier details (snapshot)
//       supplierDetails: {
//         name: quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName,
//         email: quote.supplierId.email,
//         phone: quote.supplierId.phone,
//         address: quote.supplierId.supplierDetails?.address
//       },

//       createdBy: req.user.userId
//     });

//     await purchaseOrder.save();

//     // Update quote status
//     quote.status = 'purchase_order_created';
//     quote.purchaseOrderId = purchaseOrder._id;
//     await quote.save();

//     // Update requisition status
//     const requisition = await PurchaseRequisition.findById(quote.requisitionId._id);
//     if (requisition) {
//       requisition.status = 'procurement_complete';
//       if (!requisition.procurementDetails) {
//         requisition.procurementDetails = {};
//       }
//       requisition.procurementDetails.purchaseOrderId = purchaseOrder._id;
//       requisition.procurementDetails.finalCost = quote.totalAmount;
//       await requisition.save();
//     }

//     res.json({
//       success: true,
//       message: 'Purchase order created successfully',
//       data: {
//         purchaseOrder: {
//           id: purchaseOrder._id,
//           poNumber: purchaseOrder.poNumber,
//           totalAmount: purchaseOrder.totalAmount,
//           status: purchaseOrder.status,
//           supplierName: purchaseOrder.supplierDetails.name,
//           creationDate: purchaseOrder.createdAt
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Create purchase order error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create purchase order',
//       error: error.message
//     });
//   }
// };

// // Get purchase orders for buyer
// const getPurchaseOrders = async (req, res) => {
//   try {
//     const { status, page = 1, limit = 20, search } = req.query;

//     let query = { buyerId: req.user.userId };

//     if (status) {
//       query.status = status;
//     }

//     if (search) {
//       query.$or = [
//         { poNumber: { $regex: search, $options: 'i' } },
//         { 'supplierDetails.name': { $regex: search, $options: 'i' } }
//       ];
//     }

//     const purchaseOrders = await PurchaseOrder.find(query)
//       .populate('supplierId', 'fullName email phone supplierDetails')
//       .populate('requisitionId', 'title requisitionNumber employee')
//       .populate('quoteId', 'quoteNumber')
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit);

//     const total = await PurchaseOrder.countDocuments(query);

//     // Transform to frontend format
//     const transformedPOs = purchaseOrders.map(po => ({
//       id: po._id,
//       poNumber: po.poNumber,
//       requisitionId: po.requisitionId?.requisitionNumber || po.requisitionId?._id,
//       supplierId: po.supplierId?._id,
//       supplierName: po.supplierDetails?.name || po.supplierId?.supplierDetails?.companyName || po.supplierId?.fullName,
//       supplierEmail: po.supplierDetails?.email || po.supplierId?.email,
//       supplierPhone: po.supplierDetails?.phone || po.supplierId?.phone,
//       creationDate: po.createdAt,
//       expectedDeliveryDate: po.expectedDeliveryDate,
//       status: po.status,
//       totalAmount: po.totalAmount,
//       currency: po.currency,
//       paymentTerms: po.paymentTerms,
//       deliveryAddress: po.deliveryAddress,
//       progress: po.progress,
//       currentStage: po.currentStage,
//       items: po.items,
//       activities: po.activities,
//       deliveryTracking: po.deliveryTracking,
//       specialInstructions: po.specialInstructions,
//       notes: po.notes
//     }));

//     res.json({
//       success: true,
//       data: transformedPOs,
//       pagination: {
//         current: parseInt(page),
//         total: Math.ceil(total / limit),
//         count: transformedPOs.length,
//         totalRecords: total
//       }
//     });

//   } catch (error) {
//     console.error('Get purchase orders error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch purchase orders',
//       error: error.message
//     });
//   }
// };

// // Get purchase order details
// const getPurchaseOrderDetails = async (req, res) => {
//   try {
//     const { poId } = req.params;

//     const purchaseOrder = await PurchaseOrder.findById(poId)
//       .populate('supplierId', 'fullName email phone supplierDetails')
//       .populate('requisitionId', 'title requisitionNumber employee')
//       .populate('quoteId', 'quoteNumber')
//       .populate('createdBy', 'fullName')
//       .populate('lastModifiedBy', 'fullName');

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     // Verify buyer owns this purchase order
//     if (purchaseOrder.buyerId.toString() !== req.user.userId) {
//       const user = await User.findById(req.user.userId);
//       // Allow supply chain and admin users to view
//       if (!['admin', 'supply_chain'].includes(user.role)) {
//         return res.status(403).json({
//           success: false,
//           message: 'Unauthorized access to purchase order'
//         });
//       }
//     }

//     res.json({
//       success: true,
//       data: {
//         purchaseOrder: {
//           id: purchaseOrder._id,
//           poNumber: purchaseOrder.poNumber,
//           requisitionId: purchaseOrder.requisitionId?._id,
//           requisitionTitle: purchaseOrder.requisitionId?.title,
//           supplierId: purchaseOrder.supplierId?._id,
//           supplierName: purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.supplierDetails?.companyName || purchaseOrder.supplierId?.fullName,
//           supplierEmail: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
//           supplierPhone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
//           creationDate: purchaseOrder.createdAt,
//           expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
//           actualDeliveryDate: purchaseOrder.actualDeliveryDate,
//           status: purchaseOrder.status,
//           totalAmount: purchaseOrder.totalAmount,
//           currency: purchaseOrder.currency,
//           paymentTerms: purchaseOrder.paymentTerms,
//           deliveryAddress: purchaseOrder.deliveryAddress,
//           deliveryTerms: purchaseOrder.deliveryTerms,
//           progress: purchaseOrder.progress,
//           currentStage: purchaseOrder.currentStage,
//           items: purchaseOrder.items,
//           activities: purchaseOrder.activities,
//           deliveryTracking: purchaseOrder.deliveryTracking,
//           notes: purchaseOrder.notes,
//           internalNotes: purchaseOrder.internalNotes,
//           attachments: purchaseOrder.attachments,
//           specialInstructions: purchaseOrder.specialInstructions,
//           termsAndConditions: purchaseOrder.termsAndConditions,
//           performanceMetrics: purchaseOrder.performanceMetrics,
//           createdBy: purchaseOrder.createdBy?.fullName,
//           lastModifiedBy: purchaseOrder.lastModifiedBy?.fullName,
//           lastModifiedDate: purchaseOrder.lastModifiedDate
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Get purchase order details error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch purchase order details',
//       error: error.message
//     });
//   }
// };


// const updatePurchaseOrder = async (req, res) => {
//   try {
//     const { poId } = req.params;
//     const updates = req.body;

//     const purchaseOrder = await PurchaseOrder.findById(poId);

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     // Verify buyer owns this purchase order
//     if (purchaseOrder.buyerId.toString() !== req.user.userId) {
//       const user = await User.findById(req.user.userId);
//       if (!['admin', 'supply_chain'].includes(user.role)) {
//         return res.status(403).json({
//           success: false,
//           message: 'Unauthorized access to purchase order'
//         });
//       }
//     }

//     // UPDATED: Allow status updates to send to Supply Chain
//     if (updates.status === 'pending_supply_chain_assignment' && purchaseOrder.status === 'draft') {
//       purchaseOrder.status = 'pending_supply_chain_assignment';
//       purchaseOrder.sentDate = new Date();
      
//       purchaseOrder.activities.push({
//         type: 'sent',
//         description: 'Purchase order sent to Supply Chain for assignment',
//         user: req.user.fullName || 'Buyer',
//         timestamp: new Date()
//       });
      
//       await purchaseOrder.save();
      
//       return res.json({
//         success: true,
//         message: 'Purchase order sent to Supply Chain successfully',
//         data: {
//           purchaseOrder: {
//             id: purchaseOrder._id,
//             poNumber: purchaseOrder.poNumber,
//             status: purchaseOrder.status,
//             sentDate: purchaseOrder.sentDate
//           }
//         }
//       });
//     }

//     // Don't allow updates to sent or completed purchase orders (except status change above)
//     if (['sent_to_supplier', 'acknowledged', 'delivered', 'completed', 'cancelled'].includes(purchaseOrder.status)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot update purchase order in current status'
//       });
//     }

//     // Update purchase order
//     const allowedUpdates = [
//       'expectedDeliveryDate',
//       'deliveryAddress',
//       'paymentTerms',
//       'specialInstructions',
//       'notes',
//       'internalNotes',
//       'currency',
//       'taxApplicable',
//       'taxRate',
//       'items'
//     ];

//     Object.keys(updates).forEach(key => {
//       if (allowedUpdates.includes(key)) {
//         if (key === 'expectedDeliveryDate' && updates[key]) {
//           purchaseOrder[key] = new Date(updates[key]);
//         } else if (key === 'items' && Array.isArray(updates[key])) {
//           // Handle items update
//           purchaseOrder.items = updates[key].map(item => ({
//             description: item.description,
//             quantity: item.quantity,
//             unitPrice: item.unitPrice,
//             totalPrice: item.quantity * item.unitPrice,
//             specifications: item.specifications || '',
//             unitOfMeasure: item.unitOfMeasure || 'Units',
//             category: item.category || '',
//             ...(item.itemId && { itemId: item.itemId })
//           }));
//         } else {
//           purchaseOrder[key] = updates[key];
//         }
//       }
//     });

//     // Recalculate total if items changed
//     if (updates.items) {
//       const subtotal = purchaseOrder.items.reduce((sum, item) => 
//         sum + (item.totalPrice || 0), 0
//       );
      
//       if (purchaseOrder.taxApplicable && purchaseOrder.taxRate > 0) {
//         const taxAmount = subtotal * (purchaseOrder.taxRate / 100);
//         purchaseOrder.taxAmount = taxAmount;
//         purchaseOrder.totalAmount = subtotal + taxAmount;
//       } else {
//         purchaseOrder.taxAmount = 0;
//         purchaseOrder.totalAmount = subtotal;
//       }
//     }

//     purchaseOrder.lastModifiedBy = req.user.userId;
//     purchaseOrder.lastModifiedDate = new Date();

//     // Add activity
//     purchaseOrder.activities.push({
//       type: 'updated',
//       description: 'Purchase order updated',
//       user: req.user.fullName || 'Buyer',
//       timestamp: new Date()
//     });

//     await purchaseOrder.save();

//     res.json({
//       success: true,
//       message: 'Purchase order updated successfully',
//       data: {
//         purchaseOrder: {
//           id: purchaseOrder._id,
//           poNumber: purchaseOrder.poNumber,
//           status: purchaseOrder.status,
//           totalAmount: purchaseOrder.totalAmount,
//           lastModifiedDate: purchaseOrder.lastModifiedDate
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Update purchase order error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update purchase order',
//       error: error.message
//     });
//   }
// };

// // Send purchase order to supplier
// const sendPurchaseOrderToSupplier = async (req, res) => {
//   try {
//     const { poId } = req.params;
//     const { message } = req.body;

//     const purchaseOrder = await PurchaseOrder.findById(poId)
//       .populate('supplierId', 'fullName email supplierDetails')
//       .populate('requisitionId', 'title');

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     // Verify buyer owns this purchase order
//     if (purchaseOrder.buyerId.toString() !== req.user.userId) {
//       const user = await User.findById(req.user.userId);
//       if (!['admin', 'supply_chain'].includes(user.role)) {
//         return res.status(403).json({
//           success: false,
//           message: 'Unauthorized access to purchase order'
//         });
//       }
//     }

//     // Only allow sending draft or approved purchase orders
//     if (!['draft', 'approved'].includes(purchaseOrder.status)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Purchase order has already been sent or is not in sendable status'
//       });
//     }

//     // Get user details for email
//     const user = await User.findById(req.user.userId);

//     // Send email to supplier
//     try {
//       const supplierEmail = purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email;
//       const supplierName = purchaseOrder.supplierDetails?.name || 
//                           purchaseOrder.supplierId?.supplierDetails?.companyName || 
//                           purchaseOrder.supplierId?.fullName;

//       await sendEmail({
//         to: supplierEmail,
//         subject: `Purchase Order - ${purchaseOrder.poNumber}`,
//         html: `
//           <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
//             <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
//               <h2 style="color: #1890ff; margin-top: 0;">Purchase Order</h2>
//               <p>Dear ${supplierName},</p>
//               <p>Please find below the official purchase order:</p>

//               <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
//                 <h3>Order Details</h3>
//                 <table style="width: 100%; border-collapse: collapse;">
//                   <tr>
//                     <td style="padding: 8px 0; font-weight: bold;">PO Number:</td>
//                     <td style="padding: 8px 0;">${purchaseOrder.poNumber}</td>
//                   </tr>
//                   ${purchaseOrder.requisitionId?.title ? `
//                   <tr>
//                     <td style="padding: 8px 0; font-weight: bold;">Project:</td>
//                     <td style="padding: 8px 0;">${purchaseOrder.requisitionId.title}</td>
//                   </tr>
//                   ` : ''}
//                   <tr>
//                     <td style="padding: 8px 0; font-weight: bold;">Total Amount:</td>
//                     <td style="padding: 8px 0; color: #1890ff; font-weight: bold; font-size: 18px;">
//                       ${purchaseOrder.currency} ${purchaseOrder.totalAmount.toLocaleString()}
//                     </td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; font-weight: bold;">Expected Delivery:</td>
//                     <td style="padding: 8px 0;">${new Date(purchaseOrder.expectedDeliveryDate).toLocaleDateString('en-GB')}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; font-weight: bold;">Payment Terms:</td>
//                     <td style="padding: 8px 0;">${purchaseOrder.paymentTerms}</td>
//                   </tr>
//                 </table>
//               </div>

//               <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
//                 <h3>Items Ordered</h3>
//                 <table border="1" style="border-collapse: collapse; width: 100%; border: 1px solid #ddd;">
//                   <thead>
//                     <tr style="background-color: #f5f5f5;">
//                       <th style="padding: 10px; text-align: left;">Description</th>
//                       <th style="padding: 10px; text-align: center;">Quantity</th>
//                       <th style="padding: 10px; text-align: right;">Unit Price</th>
//                       <th style="padding: 10px; text-align: right;">Total</th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     ${purchaseOrder.items.map(item => `
//                       <tr>
//                         <td style="padding: 10px; border-bottom: 1px solid #eee;">
//                           ${item.description}
//                           ${item.specifications ? `<br><small style="color: #666;">${item.specifications}</small>` : ''}
//                         </td>
//                         <td style="padding: 10px; text-align: center; border-bottom: 1px solid #eee;">${item.quantity}</td>
//                         <td style="padding: 10px; text-align: right; border-bottom: 1px solid #eee;">
//                           ${purchaseOrder.currency} ${item.unitPrice.toLocaleString()}
//                         </td>
//                         <td style="padding: 10px; text-align: right; border-bottom: 1px solid #eee;">
//                           ${purchaseOrder.currency} ${item.totalPrice.toLocaleString()}
//                         </td>
//                       </tr>
//                     `).join('')}
//                   </tbody>
//                   <tfoot>
//                     <tr style="background-color: #f5f5f5; font-weight: bold;">
//                       <td colspan="3" style="padding: 10px; text-align: right;">Total Amount:</td>
//                       <td style="padding: 10px; text-align: right; color: #1890ff;">
//                         ${purchaseOrder.currency} ${purchaseOrder.totalAmount.toLocaleString()}
//                       </td>
//                     </tr>
//                   </tfoot>
//                 </table>
//               </div>

//               <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 20px 0;">
//                 <h4 style="margin-top: 0; color: #faad14;">Delivery Instructions</h4>
//                 <p><strong>Delivery Address:</strong><br>${purchaseOrder.deliveryAddress}</p>
//                 <p><strong>Expected Delivery Date:</strong> ${new Date(purchaseOrder.expectedDeliveryDate).toLocaleDateString('en-GB')}</p>
//                 ${purchaseOrder.specialInstructions ? `<p><strong>Special Instructions:</strong><br>${purchaseOrder.specialInstructions}</p>` : ''}
//               </div>

//               ${message ? `
//               <div style="background-color: #f6ffed; padding: 15px; border-radius: 8px; margin: 20px 0;">
//                 <h4 style="margin-top: 0; color: #52c41a;">Additional Message</h4>
//                 <p>${message}</p>
//               </div>
//               ` : ''}

//               <div style="margin: 20px 0; padding: 15px; background-color: white; border-radius: 8px;">
//                 <p><strong>Next Steps:</strong></p>
//                 <ul>
//                   <li>Please confirm receipt of this purchase order</li>
//                   <li>Provide updated delivery timeline if different from expected date</li>
//                   <li>Notify us immediately of any issues or concerns</li>
//                   <li>Send delivery confirmation with tracking details when items are dispatched</li>
//                 </ul>
//               </div>

//               <p>Thank you for your service. We look forward to a successful delivery.</p>
//               <p>Best regards,<br>${user.fullName}<br>Procurement Team</p>
//             </div>
//           </div>
//         `
//       });

//       // Update purchase order status
//       purchaseOrder.status = 'sent_to_supplier';
//       purchaseOrder.sentDate = new Date();
//       purchaseOrder.progress = 25;
//       purchaseOrder.currentStage = 'supplier_acknowledgment';

//       purchaseOrder.activities.push({
//         type: 'sent',
//         description: 'Purchase order sent to supplier',
//         user: user.fullName || 'Buyer',
//         timestamp: new Date()
//       });

//       await purchaseOrder.save();

//     } catch (emailError) {
//       console.error('Failed to send purchase order to supplier:', emailError);
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to send purchase order to supplier'
//       });
//     }

//     res.json({
//       success: true,
//       message: 'Purchase order sent to supplier successfully',
//       data: {
//         purchaseOrder: {
//           id: purchaseOrder._id,
//           poNumber: purchaseOrder.poNumber,
//           status: purchaseOrder.status,
//           sentDate: purchaseOrder.sentDate
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Send purchase order error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to send purchase order',
//       error: error.message
//     });
//   }
// };

// // Cancel purchase order
// const cancelPurchaseOrder = async (req, res) => {
//   try {
//     const { poId } = req.params;
//     const { cancellationReason } = req.body;

//     const purchaseOrder = await PurchaseOrder.findById(poId)
//       .populate('supplierId', 'fullName email supplierDetails');

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     // Verify buyer owns this purchase order
//     if (purchaseOrder.buyerId.toString() !== req.user.userId) {
//       const user = await User.findById(req.user.userId);
//       if (!['admin', 'supply_chain'].includes(user.role)) {
//         return res.status(403).json({
//           success: false,
//           message: 'Unauthorized access to purchase order'
//         });
//       }
//     }

//     // Don't allow cancellation of completed or delivered orders
//     if (['completed', 'delivered'].includes(purchaseOrder.status)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot cancel completed or delivered purchase order'
//       });
//     }

//     // Update purchase order status
//     purchaseOrder.status = 'cancelled';
//     purchaseOrder.cancellationReason = cancellationReason;
//     purchaseOrder.cancelledDate = new Date();

//     const user = await User.findById(req.user.userId);
//     purchaseOrder.activities.push({
//       type: 'cancelled',
//       description: `Purchase order cancelled: ${cancellationReason}`,
//       user: user.fullName || 'Buyer',
//       timestamp: new Date()
//     });

//     await purchaseOrder.save();

//     // Notify supplier if order was already sent
//     if (purchaseOrder.sentDate) {
//       try {
//         const supplierEmail = purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email;
//         const supplierName = purchaseOrder.supplierDetails?.name || 
//                             purchaseOrder.supplierId?.supplierDetails?.companyName || 
//                             purchaseOrder.supplierId?.fullName;

//         await sendEmail({
//           to: supplierEmail,
//           subject: `Purchase Order Cancelled - ${purchaseOrder.poNumber}`,
//           html: `
//             <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//               <div style="background-color: #fff2f0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff4d4f;">
//                 <h2 style="color: #ff4d4f; margin-top: 0;">Purchase Order Cancellation</h2>
//                 <p>Dear ${supplierName},</p>
//                 <p>We regret to inform you that Purchase Order ${purchaseOrder.poNumber} has been cancelled.</p>

//                 <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
//                   <p><strong>PO Number:</strong> ${purchaseOrder.poNumber}</p>
//                   <p><strong>Original Amount:</strong> ${purchaseOrder.currency} ${purchaseOrder.totalAmount.toLocaleString()}</p>
//                   <p><strong>Cancellation Date:</strong> ${new Date().toLocaleDateString('en-GB')}</p>
//                   ${cancellationReason ? `<p><strong>Reason:</strong> ${cancellationReason}</p>` : ''}
//                 </div>

//                 <p>Please disregard this purchase order and do not proceed with any deliveries.</p>
//                 <p>We apologize for any inconvenience this may cause and appreciate your understanding.</p>

//                 <p>Best regards,<br>${user.fullName}<br>Procurement Team</p>
//               </div>
//             </div>
//           `
//         });
//       } catch (emailError) {
//         console.error('Failed to notify supplier of cancellation:', emailError);
//       }
//     }

//     res.json({
//       success: true,
//       message: 'Purchase order cancelled successfully',
//       data: {
//         purchaseOrder: {
//           id: purchaseOrder._id,
//           poNumber: purchaseOrder.poNumber,
//           status: purchaseOrder.status,
//           cancelledDate: purchaseOrder.cancelledDate
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Cancel purchase order error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to cancel purchase order',
//       error: error.message
//     });
//   }
// };

// const canAccessPurchaseOrderPdf = (purchaseOrder, reqUser) => {
//   if (!purchaseOrder || !reqUser) {
//     return false;
//   }

//   if (purchaseOrder.buyerId?.toString() === reqUser.userId) {
//     return true;
//   }

//   if (['admin', 'supply_chain'].includes(reqUser.role)) {
//     return true;
//   }

//   const approverEmail = reqUser.email?.toLowerCase();
//   if (approverEmail) {
//     const isApprover = purchaseOrder.approvalChain?.some(step =>
//       step?.approver?.email?.toLowerCase() === approverEmail
//     );
//     if (isApprover) {
//       return true;
//     }
//   }

//   return false;
// };

// const buildPurchaseOrderSignatureBlocks = async (purchaseOrder) => {
//   const signatureBlocks = [
//     { label: 'Supply Chain' },
//     { label: 'Department Head' },
//     { label: 'Head of Business' },
//     { label: 'Finance' }
//   ];

//   if (!purchaseOrder) {
//     return signatureBlocks;
//   }

//   if (purchaseOrder.supplyChainReview?.reviewedBy) {
//     const supplyChainUser = await User.findById(purchaseOrder.supplyChainReview.reviewedBy)
//       .select('signature');
//     signatureBlocks[0].signaturePath = supplyChainUser?.signature?.localPath || null;
//     signatureBlocks[0].signedAt = purchaseOrder.supplyChainReview.reviewDate || null;
//   }

//   const approvedSteps = (purchaseOrder.approvalChain || [])
//     .filter(step => step?.status === 'approved');

//   const approverEmails = approvedSteps
//     .map(step => step?.approver?.email)
//     .filter(Boolean);

//   if (approverEmails.length) {
//     const approverUsers = await User.find({ email: { $in: approverEmails } })
//       .select('email signature');
//     const approverByEmail = new Map(approverUsers.map(user => [user.email, user]));

//     approvedSteps.forEach(step => {
//       const blockIndex = step.level;
//       if (!signatureBlocks[blockIndex]) {
//         return;
//       }

//       const approverUser = approverByEmail.get(step?.approver?.email);
//       signatureBlocks[blockIndex].signaturePath = approverUser?.signature?.localPath || null;
//       signatureBlocks[blockIndex].signedAt = step.actionDate || step.updatedAt || null;
//     });
//   }

//   return signatureBlocks;
// };

// // Download purchase order as PDF
// const downloadPurchaseOrderPDF = async (req, res) => {
//   try {
//     const { poId } = req.params;

//     console.log(`Generating PDF for PO: ${poId}`);

//     const purchaseOrder = await PurchaseOrder.findById(poId)
//       .populate('supplierId', 'fullName email phone supplierDetails')
//       .populate('requisitionId', 'title requisitionNumber employee')
//       .populate('quoteId', 'quoteNumber')
//       .populate('createdBy', 'fullName')
//       .populate('items.itemId', 'code description category unitOfMeasure');

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     if (!canAccessPurchaseOrderPdf(purchaseOrder, req.user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Unauthorized access to purchase order'
//       });
//     }

//     // Helper function to safely convert to number
//     const safeNumber = (value, defaultValue = 0) => {
//       if (value === null || value === undefined || value === '') {
//         return defaultValue;
//       }
//       const num = Number(value);
//       return isNaN(num) ? defaultValue : num;
//     };

//     // Calculate tax information if not present
//     const taxApplicable = Boolean(purchaseOrder.taxApplicable);
//     const taxRate = safeNumber(purchaseOrder.taxRate, 0);
//     const totalAmount = safeNumber(purchaseOrder.totalAmount, 0);
//     const taxAmount = safeNumber(purchaseOrder.taxAmount, 0);
    
//     // Calculate subtotal if not present
//     let subtotalAmount = safeNumber(purchaseOrder.subtotalAmount, 0);
//     if (subtotalAmount === 0 && totalAmount > 0) {
//       if (taxApplicable && taxRate > 0) {
//         // If tax is applied, subtract tax from total to get subtotal
//         subtotalAmount = totalAmount - taxAmount;
//       } else {
//         // If no tax, subtotal equals total
//         subtotalAmount = totalAmount;
//       }
//     }

//     // Prepare data for PDF generation with all required tax fields
//     const pdfData = {
//       id: purchaseOrder._id,
//       poNumber: purchaseOrder.poNumber,
//       requisitionId: purchaseOrder.requisitionId?._id,
//       requisitionTitle: purchaseOrder.requisitionId?.title,

//       // Supplier details from multiple sources
//       supplierDetails: {
//         name: purchaseOrder.supplierDetails?.name || 
//               purchaseOrder.supplierId?.supplierDetails?.companyName || 
//               purchaseOrder.supplierId?.fullName,
//         email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
//         phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
//         address: purchaseOrder.supplierDetails?.address || 
//                  purchaseOrder.supplierId?.supplierDetails?.address,
//         businessType: purchaseOrder.supplierDetails?.businessType || 
//                       purchaseOrder.supplierId?.supplierDetails?.businessType
//       },

//       // Order details with safe number conversion
//       creationDate: purchaseOrder.createdAt,
//       expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
//       actualDeliveryDate: purchaseOrder.actualDeliveryDate,
//       status: purchaseOrder.status,
      
//       // Financial details with proper tax handling
//       totalAmount: totalAmount,
//       subtotalAmount: subtotalAmount,
//       taxApplicable: taxApplicable,
//       taxRate: taxRate,
//       taxAmount: taxAmount,
//       currency: purchaseOrder.currency || 'XAF',
      
//       paymentTerms: purchaseOrder.paymentTerms,
//       deliveryAddress: purchaseOrder.deliveryAddress,
//       deliveryTerms: purchaseOrder.deliveryTerms,

//       // Items with enhanced details and safe number conversion
//       items: (purchaseOrder.items || []).map(item => {
//         const quantity = safeNumber(item.quantity, 0);
//         const unitPrice = safeNumber(item.unitPrice, 0);
//         const totalPrice = safeNumber(item.totalPrice, quantity * unitPrice);
//         const discount = safeNumber(item.discount, 0);

//         return {
//           description: item.description || 'No description',
//           quantity: quantity,
//           unitPrice: unitPrice,
//           totalPrice: totalPrice,
//           discount: discount,
//           specifications: item.specifications,
//           itemCode: item.itemCode || (item.itemId ? item.itemId.code : ''),
//           category: item.category || (item.itemId ? item.itemId.category : ''),
//           unitOfMeasure: item.unitOfMeasure || (item.itemId ? item.itemId.unitOfMeasure : 'Units')
//         };
//       }),

//       // Additional details
//       specialInstructions: purchaseOrder.specialInstructions || '',
//       notes: purchaseOrder.notes || '',
//       termsAndConditions: purchaseOrder.termsAndConditions || '',

//       // Progress and activities
//       progress: purchaseOrder.progress,
//       currentStage: purchaseOrder.currentStage,
//       activities: purchaseOrder.activities || [],

//       // Legacy compatibility
//       supplierName: purchaseOrder.supplierDetails?.name || 
//                    purchaseOrder.supplierId?.supplierDetails?.companyName || 
//                    purchaseOrder.supplierId?.fullName || 'Unknown Supplier',
//       supplierEmail: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email || '',
//       supplierPhone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone || ''
//     };

//     console.log('PDF Data prepared with tax info:', {
//       poNumber: pdfData.poNumber,
//       supplierName: pdfData.supplierDetails.name,
//       itemsCount: pdfData.items.length,
//       totalAmount: pdfData.totalAmount,
//       subtotalAmount: pdfData.subtotalAmount,
//       taxApplicable: pdfData.taxApplicable,
//       taxRate: pdfData.taxRate,
//       taxAmount: pdfData.taxAmount,
//       itemsWithNumbers: pdfData.items.map(item => ({
//         description: item.description,
//         quantity: item.quantity,
//         unitPrice: item.unitPrice,
//         totalPrice: item.totalPrice
//       }))
//     });

//     // Validate critical data before PDF generation
//     if (!pdfData.poNumber) {
//       return res.status(400).json({
//         success: false,
//         message: 'Purchase order number is missing'
//       });
//     }

//     if (!pdfData.supplierDetails.name && !pdfData.supplierName) {
//       return res.status(400).json({
//         success: false,
//         message: 'Supplier information is missing'
//       });
//     }

//     if (!Array.isArray(pdfData.items) || pdfData.items.length === 0) {
//       console.warn('No items found in purchase order, creating empty items array');
//       pdfData.items = [{
//         description: 'No items specified',
//         quantity: 0,
//         unitPrice: 0,
//         totalPrice: 0,
//         discount: 0,
//         unitOfMeasure: 'Units'
//       }];
//     }

//     pdfData.signatures = await buildPurchaseOrderSignatureBlocks(purchaseOrder);

//     // Generate PDF
//     const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);

//     if (!pdfResult.success) {
//       console.error('PDF generation failed:', pdfResult.error);
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to generate PDF',
//         error: pdfResult.error
//       });
//     }

//     console.log('PDF generated successfully:', pdfResult.filename);

//     // Set response headers for PDF download
//     const filename = `PO_${purchaseOrder.poNumber}_${new Date().toISOString().split('T')[0]}.pdf`;

//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
//     res.setHeader('Content-Length', pdfResult.buffer.length);
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Pragma', 'no-cache');
//     res.setHeader('Expires', '0');

//     // Send the PDF buffer
//     res.send(pdfResult.buffer);

//     console.log(`PDF download completed for PO: ${purchaseOrder.poNumber}`);

//   } catch (error) {
//     console.error('Download purchase order PDF error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to generate PDF download',
//       error: error.message
//     });
//   }
// };

// // Preview purchase order as PDF (inline viewing)
// const previewPurchaseOrderPDF = async (req, res) => {
//   try {
//     const { poId } = req.params;

//     const purchaseOrder = await PurchaseOrder.findById(poId)
//       .populate('supplierId', 'fullName email phone supplierDetails')
//       .populate('requisitionId', 'title requisitionNumber employee')
//       .populate('items.itemId', 'code description category unitOfMeasure');

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     if (!canAccessPurchaseOrderPdf(purchaseOrder, req.user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Unauthorized access to purchase order'
//       });
//     }

//     // Prepare data (same as download function)
//     const pdfData = {
//       id: purchaseOrder._id,
//       poNumber: purchaseOrder.poNumber,
//       requisitionTitle: purchaseOrder.requisitionId?.title,
//       supplierDetails: {
//         name: purchaseOrder.supplierDetails?.name || 
//               purchaseOrder.supplierId?.supplierDetails?.companyName || 
//               purchaseOrder.supplierId?.fullName,
//         email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
//         phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
//         address: purchaseOrder.supplierDetails?.address,
//         businessType: purchaseOrder.supplierDetails?.businessType
//       },
//       creationDate: purchaseOrder.createdAt,
//       expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
//       status: purchaseOrder.status,
//       totalAmount: purchaseOrder.totalAmount,
//       currency: purchaseOrder.currency,
//       paymentTerms: purchaseOrder.paymentTerms,
//       deliveryAddress: purchaseOrder.deliveryAddress,
//       items: purchaseOrder.items.map(item => ({
//         description: item.description,
//         quantity: item.quantity,
//         unitPrice: item.unitPrice,
//         totalPrice: item.totalPrice || (item.quantity * item.unitPrice),
//         specifications: item.specifications,
//         itemCode: item.itemCode,
//         category: item.category,
//         unitOfMeasure: item.unitOfMeasure
//       })),
//       specialInstructions: purchaseOrder.specialInstructions,
//       notes: purchaseOrder.notes
//     };

//     pdfData.signatures = await buildPurchaseOrderSignatureBlocks(purchaseOrder);

//     // Generate PDF
//     const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);

//     if (!pdfResult.success) {
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to generate PDF preview',
//         error: pdfResult.error
//       });
//     }

//     // Set headers for inline viewing
//     const filename = `PO_${purchaseOrder.poNumber}_preview.pdf`;

//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
//     res.setHeader('Content-Length', pdfResult.buffer.length);

//     // Send PDF for inline viewing
//     res.send(pdfResult.buffer);

//   } catch (error) {
//     console.error('Preview purchase order PDF error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to generate PDF preview',
//       error: error.message
//     });
//   }
// };

// // Generate and email PDF to supplier or internal team
// const emailPurchaseOrderPDF = async (req, res) => {
//   try {
//     const { poId } = req.params;
//     const { emailTo, emailType = 'supplier', message = '' } = req.body;

//     const purchaseOrder = await PurchaseOrder.findById(poId)
//       .populate('supplierId', 'fullName email phone supplierDetails')
//       .populate('requisitionId', 'title requisitionNumber employee')
//       .populate('items.itemId', 'code description category unitOfMeasure');

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     if (!canAccessPurchaseOrderPdf(purchaseOrder, req.user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Unauthorized access to purchase order'
//       });
//     }

//     // Prepare PDF data
//     const pdfData = {
//       poNumber: purchaseOrder.poNumber,
//       supplierDetails: {
//         name: purchaseOrder.supplierDetails?.name || 
//               purchaseOrder.supplierId?.fullName,
//         email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
//         phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
//         address: purchaseOrder.supplierDetails?.address
//       },
//       creationDate: purchaseOrder.createdAt,
//       expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
//       status: purchaseOrder.status,
//       totalAmount: purchaseOrder.totalAmount,
//       currency: purchaseOrder.currency,
//       paymentTerms: purchaseOrder.paymentTerms,
//       deliveryAddress: purchaseOrder.deliveryAddress,
//       items: purchaseOrder.items.map(item => ({
//         description: item.description,
//         quantity: item.quantity,
//         unitPrice: item.unitPrice,
//         totalPrice: item.totalPrice || (item.quantity * item.unitPrice),
//         specifications: item.specifications
//       })),
//       specialInstructions: purchaseOrder.specialInstructions
//     };

//     pdfData.signatures = await buildPurchaseOrderSignatureBlocks(purchaseOrder);

//     // Generate PDF
//     const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);

//     if (!pdfResult.success) {
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to generate PDF for email',
//         error: pdfResult.error
//       });
//     }

//     // Get user details
//     const user = await User.findById(req.user.userId);

//     // Determine recipient
//     const recipientEmail = emailTo || purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email;
//     const recipientName = emailType === 'supplier' ? 
//       purchaseOrder.supplierDetails?.name : 
//       'Team';

//     // Send email with PDF attachment
//     const emailResult = await sendEmail({
//       to: recipientEmail,
//       subject: `Purchase Order ${purchaseOrder.poNumber} - PDF Document`,
//       html: `
//         <div style="font-family: Arial, sans-serif;">
//           <h2>Purchase Order Document</h2>
//           <p>Dear ${recipientName},</p>
//           <p>Please find attached the PDF document for Purchase Order ${purchaseOrder.poNumber}.</p>

//           <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px;">
//             <p><strong>PO Number:</strong> ${purchaseOrder.poNumber}</p>
//             <p><strong>Total Amount:</strong> ${purchaseOrder.currency} ${purchaseOrder.totalAmount.toLocaleString()}</p>
//             <p><strong>Expected Delivery:</strong> ${new Date(purchaseOrder.expectedDeliveryDate).toLocaleDateString('en-GB')}</p>
//           </div>

//           ${message ? `<p><strong>Additional Message:</strong></p><p>${message}</p>` : ''}

//           <p>Best regards,<br>${user.fullName}<br>Procurement Team</p>
//         </div>
//       `,
//       attachments: [{
//         filename: pdfResult.filename,
//         content: pdfResult.buffer,
//         contentType: 'application/pdf'
//       }]
//     });

//     if (!emailResult.success) {
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to send email with PDF attachment',
//         error: emailResult.error
//       });
//     }

//     res.json({
//       success: true,
//       message: `Purchase order PDF sent successfully to ${recipientEmail}`,
//       data: {
//         poNumber: purchaseOrder.poNumber,
//         sentTo: recipientEmail,
//         filename: pdfResult.filename
//       }
//     });

//   } catch (error) {
//     console.error('Email purchase order PDF error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to email PDF',
//       error: error.message
//     });
//   }
// };

// // Bulk download multiple POs as ZIP file
// const bulkDownloadPurchaseOrders = async (req, res) => {
//   try {
//     const { poIds } = req.body;

//     if (!poIds || !Array.isArray(poIds) || poIds.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Purchase order IDs are required'
//       });
//     }

//     if (poIds.length > 50) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot download more than 50 purchase orders at once'
//       });
//     }

//     const purchaseOrders = await PurchaseOrder.find({
//       _id: { $in: poIds },
//       buyerId: req.user.userId
//     })
//     .populate('supplierId', 'fullName email phone supplierDetails')
//     .populate('requisitionId', 'title requisitionNumber')
//     .populate('items.itemId', 'code description category unitOfMeasure');

//     if (purchaseOrders.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'No valid purchase orders found'
//       });
//     }

//     // Generate PDFs for all orders
//     const pdfPromises = purchaseOrders.map(async (po) => {
//       const pdfData = {
//         poNumber: po.poNumber,
//         supplierDetails: {
//           name: po.supplierDetails?.name || po.supplierId?.fullName,
//           email: po.supplierDetails?.email || po.supplierId?.email,
//           phone: po.supplierDetails?.phone || po.supplierId?.phone,
//           address: po.supplierDetails?.address
//         },
//         creationDate: po.createdAt,
//         expectedDeliveryDate: po.expectedDeliveryDate,
//         status: po.status,
//         totalAmount: po.totalAmount,
//         currency: po.currency,
//         paymentTerms: po.paymentTerms,
//         deliveryAddress: po.deliveryAddress,
//         items: po.items.map(item => ({
//           description: item.description,
//           quantity: item.quantity,
//           unitPrice: item.unitPrice,
//           totalPrice: item.totalPrice || (item.quantity * item.unitPrice),
//           specifications: item.specifications
//         })),
//         specialInstructions: po.specialInstructions
//       };

//       const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
//       return {
//         poNumber: po.poNumber,
//         filename: `PO_${po.poNumber}.pdf`,
//         buffer: pdfResult.success ? pdfResult.buffer : null,
//         success: pdfResult.success
//       };
//     });

//     const pdfResults = await Promise.all(pdfPromises);
//     const successfulPDFs = pdfResults.filter(pdf => pdf.success && pdf.buffer);

//     if (successfulPDFs.length === 0) {
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to generate any PDFs'
//       });
//     }

//     // Create ZIP file
//     const zipFilename = `Purchase_Orders_${new Date().toISOString().split('T')[0]}.zip`;

//     res.setHeader('Content-Type', 'application/zip');
//     res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

//     const archive = archiver('zip', { zlib: { level: 9 } });

//     archive.on('error', (err) => {
//       console.error('ZIP creation error:', err);
//       if (!res.headersSent) {
//         res.status(500).json({
//           success: false,
//           message: 'Failed to create ZIP file'
//         });
//       }
//     });

//     archive.pipe(res);

//     // Add each PDF to the ZIP
//     successfulPDFs.forEach(pdf => {
//       archive.append(pdf.buffer, { name: pdf.filename });
//     });

//     await archive.finalize();

//   } catch (error) {
//     console.error('Bulk download error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to create bulk download',
//         error: error.message
//       });
//     }
//   }
// };


// // Get pending POs for Supply Chain assignment
// const getSupplyChainPendingPOs = async (req, res) => {
//   try {
//     console.log('=== FETCHING SUPPLY CHAIN PENDING POS ===');
    
//     // Get POs that are draft or pending supply chain assignment
//     const purchaseOrders = await PurchaseOrder.find({
//       status: { 
//         $in: ['draft', 'pending_supply_chain_assignment'] 
//       }
//     })
//     .populate('supplierId', 'name email phone address businessType')
//     .populate('buyerId', 'fullName email')
//     .sort({ createdAt: -1 });

//     console.log(`Found ${purchaseOrders.length} purchase orders for Supply Chain`);
    
//     if (purchaseOrders.length > 0) {
//       console.log('Sample PO statuses:', purchaseOrders.slice(0, 3).map(po => ({
//         poNumber: po.poNumber,
//         status: po.status,
//         supplier: po.supplierDetails?.name
//       })));
//     }

//     const transformedPOs = purchaseOrders.map(po => {
//       console.log(`Transforming PO ${po.poNumber}:`, {
//         status: po.status,
//         supplierName: po.supplierDetails?.name,
//         items: po.items?.length
//       });
      
//       return {
//         id: po._id,
//         poNumber: po.poNumber,
//         supplierName: po.supplierDetails?.name || 'Unknown Supplier',
//         supplierEmail: po.supplierDetails?.email || '',
//         supplierPhone: po.supplierDetails?.phone || '',
//         totalAmount: po.totalAmount,
//         currency: po.currency,
//         items: po.items,
//         creationDate: po.createdAt,
//         expectedDeliveryDate: po.expectedDeliveryDate,
//         paymentTerms: po.paymentTerms,
//         deliveryAddress: po.deliveryAddress,
//         buyerName: po.buyerId?.fullName,
//         buyerEmail: po.buyerId?.email,
//         status: po.status,
//         progress: po.progress,
//         currentStage: po.currentStage,
//         activities: po.activities
//       };
//     });

//     console.log(`Returning ${transformedPOs.length} transformed POs`);

//     res.json({
//       success: true,
//       data: transformedPOs
//     });

//   } catch (error) {
//     console.error('Get SC pending POs error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch pending purchase orders',
//       error: error.message
//     });
//   }
// };

// // Add after handleSendPOToSupplier function

// const handleSendToSupplyChain = async (po) => {
//   Modal.confirm({
//     title: 'Send to Supply Chain',
//     content: `Are you sure you want to send PO ${po.poNumber} to Supply Chain for assignment?`,
//     okText: 'Yes, Send',
//     cancelText: 'Cancel',
//     onOk: async () => {
//       try {
//         setLoading(true);
        
//         const response = await buyerRequisitionAPI.sendPurchaseOrderToSupplier(po.id, {
//           message: 'Sending to Supply Chain for department assignment'
//         });
        
//         if (response.success) {
//           message.success('Purchase order sent to Supply Chain successfully!');
          
//           notification.success({
//             message: 'PO Sent to Supply Chain',
//             description: `Purchase order ${po.poNumber} has been sent to Supply Chain for review and department assignment.`,
//             duration: 5
//           });
          
//           await loadPurchaseOrders();
//         } else {
//           message.error(response.message || 'Failed to send purchase order');
//         }
//       } catch (error) {
//         console.error('Error sending PO to Supply Chain:', error);
//         message.error('Failed to send purchase order to Supply Chain');
//       } finally {
//         setLoading(false);
//       }
//     }
//   });
// };


// // Get Supply Chain PO statistics
// const getSupplyChainPOStats = async (req, res) => {
//   try {
//     console.log('=== FETCHING SUPPLY CHAIN STATS ===');
    
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const [pendingAssignment, assignedToday, rejectedToday, inApprovalChain] = await Promise.all([
//       // Count POs waiting for assignment
//       PurchaseOrder.countDocuments({
//         status: { 
//           $in: ['draft', 'pending_supply_chain_assignment'] 
//         }
//       }),
      
//       // Count POs assigned today
//       PurchaseOrder.countDocuments({
//         status: { 
//           $in: ['pending_department_approval', 'pending_head_of_business_approval', 'pending_finance_approval'] 
//         },
//         assignmentDate: { $gte: today }
//       }),
      
//       // Count POs rejected by SC today
//       PurchaseOrder.countDocuments({
//         status: 'rejected',
//         'supplyChainReview.reviewDate': { $gte: today }
//       }),
      
//       // Count POs currently in approval chain
//       PurchaseOrder.countDocuments({
//         status: { 
//           $in: ['pending_department_approval', 'pending_head_of_business_approval', 'pending_finance_approval'] 
//         }
//       })
//     ]);

//     console.log('Supply Chain Stats:', {
//       pendingAssignment,
//       assignedToday,
//       rejectedToday,
//       inApprovalChain
//     });

//     res.json({
//       success: true,
//       data: {
//         pendingAssignment,
//         assignedToday,
//         rejectedToday,
//         inApprovalChain
//       }
//     });

//   } catch (error) {
//     console.error('Get SC stats error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch statistics',
//       error: error.message
//     });
//   }
// };

// // Download PO for signing
// const downloadPOForSigning = async (req, res) => {
//   try {
//     const { poId } = req.params;

//     const purchaseOrder = await PurchaseOrder.findById(poId)
//       .populate('supplierId', 'fullName email phone supplierDetails')
//       .populate('requisitionId', 'title requisitionNumber')
//       .populate('items.itemId', 'code description category unitOfMeasure');

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     // Generate PDF
//     const pdfData = {
//       poNumber: purchaseOrder.poNumber,
//       supplierDetails: {
//         name: purchaseOrder.supplierDetails?.name || purchaseOrder.supplierId?.fullName,
//         email: purchaseOrder.supplierDetails?.email || purchaseOrder.supplierId?.email,
//         phone: purchaseOrder.supplierDetails?.phone || purchaseOrder.supplierId?.phone,
//         address: purchaseOrder.supplierDetails?.address
//       },
//       creationDate: purchaseOrder.createdAt,
//       expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
//       status: purchaseOrder.status,
//       totalAmount: purchaseOrder.totalAmount,
//       subtotalAmount: purchaseOrder.subtotalAmount,
//       taxAmount: purchaseOrder.taxAmount,
//       taxApplicable: purchaseOrder.taxApplicable,
//       taxRate: purchaseOrder.taxRate,
//       currency: purchaseOrder.currency,
//       paymentTerms: purchaseOrder.paymentTerms,
//       deliveryAddress: purchaseOrder.deliveryAddress,
//       items: purchaseOrder.items.map(item => ({
//         description: item.description,
//         quantity: item.quantity,
//         unitPrice: item.unitPrice,
//         totalPrice: item.totalPrice || (item.quantity * item.unitPrice),
//         specifications: item.specifications
//       })),
//       specialInstructions: purchaseOrder.specialInstructions
//     };

//     const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);

//     if (!pdfResult.success) {
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to generate PDF'
//       });
//     }

//     // Return blob URL for frontend download
//     const base64 = pdfResult.buffer.toString('base64');
//     const dataUrl = `data:application/pdf;base64,${base64}`;

//     res.json({
//       success: true,
//       data: {
//         url: dataUrl,
//         fileName: `PO_${purchaseOrder.poNumber}.pdf`
//       }
//     });

//   } catch (error) {
//     console.error('Download PO for signing error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to download purchase order',
//       error: error.message
//     });
//   }
// };

// // Assign PO to department with signed document
// const assignPOToDepartment = async (req, res) => {
//   try {
//     const { poId } = req.params;
//     const { department, comments } = req.body;

//     console.log('Assignment request:', {
//       poId,
//       department
//     });

//     if (!department) {
//       return res.status(400).json({
//         success: false,
//         message: 'Department selection is required'
//       });
//     }

//     const purchaseOrder = await PurchaseOrder.findById(poId);

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     // Check if PO can be assigned
//     if (!['draft', 'pending_supply_chain_assignment'].includes(purchaseOrder.status)) {
//       return res.status(400).json({
//         success: false,
//         message: `PO cannot be assigned from status: ${purchaseOrder.status}`
//       });
//     }

//     const supplyChainUser = await User.findById(req.user.userId).select('fullName signature email');
//     const reviewDate = new Date();

//     const signatureBlocks = [
//       {
//         label: 'Supply Chain',
//         signaturePath: supplyChainUser?.signature?.localPath || null,
//         signedAt: reviewDate
//       },
//       { label: 'Department Head' },
//       { label: 'Head of Business' },
//       { label: 'Finance' }
//     ];

//     const pdfData = {
//       ...buildPurchaseOrderPdfData(purchaseOrder),
//       signatures: signatureBlocks
//     };

//     const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
//     if (!pdfResult.success) {
//       return res.status(500).json({
//         success: false,
//         message: pdfResult.error || 'Failed to generate signed document'
//       });
//     }

//     const signedDocData = await saveFile(
//       {
//         buffer: pdfResult.buffer,
//         originalname: `PO-${purchaseOrder.poNumber}-SC-signed.pdf`,
//         mimetype: 'application/pdf',
//         size: pdfResult.buffer.length
//       },
//       STORAGE_CATEGORIES.SIGNED_DOCUMENTS,
//       'supply-chain',
//       `PO-${purchaseOrder.poNumber}-SC-signed-${Date.now()}.pdf`
//     );

//     // Get department head info
//     const { getPOApprovalChain } = require('../config/poApprovalChain');
//     const approvalChain = getPOApprovalChain(department);
    
//     if (!approvalChain || approvalChain.length !== 3) {
//       return res.status(500).json({
//         success: false,
//         message: `Failed to create approval chain for ${department}`
//       });
//     }

//     // Update PO with correct enum values from the schema
//     purchaseOrder.status = 'pending_department_approval'; // This matches the schema enum
//     purchaseOrder.assignedDepartment = department;
//     purchaseOrder.assignedBy = req.user.userId;
//     purchaseOrder.assignmentDate = new Date();
//     purchaseOrder.assignmentTime = new Date().toTimeString().split(' ')[0];
//     purchaseOrder.progress = 30;
//     purchaseOrder.currentStage = 'created'; // Keep it as 'created' which is valid in schema

//     // Supply Chain review (auto-approved by assignment)
//     purchaseOrder.supplyChainReview = {
//       reviewedBy: req.user.userId,
//       reviewDate: reviewDate,
//       reviewTime: reviewDate.toTimeString().split(' ')[0],
//       action: 'assigned',
//       comments: comments || `Assigned to ${department} department`,
//       signedDocument: {
//         url: signedDocData.url,
//         localPath: signedDocData.localPath,
//         originalName: signedDocData.originalName,
//         uploadedAt: signedDocData.uploadedAt
//       }
//     };

//     // Create 3-level approval chain
//     purchaseOrder.approvalChain = approvalChain.map((step, index) => ({
//       level: step.level,
//       approver: {
//         name: step.approver,
//         email: step.email,
//         role: step.role,
//         department: step.department
//       },
//       status: 'pending',
//       activatedDate: index === 0 ? new Date() : null // Only activate first level
//     }));

//     purchaseOrder.currentApprovalLevel = 1;

//     // Add activity with valid enum value
//     purchaseOrder.activities.push({
//       type: 'updated', // Use 'updated' instead of 'assigned' (valid enum value)
//       description: `Purchase order assigned to ${department} by Supply Chain`,
//       user: req.user.fullName,
//       timestamp: new Date()
//     });

//     await purchaseOrder.save();

//     // Send notification to first approver (Department Head)
//     try {
//       const firstApprover = purchaseOrder.approvalChain[0];
      
//       await sendEmail({
//         to: firstApprover.approver.email,
//         subject: `Purchase Order Approval Required - ${purchaseOrder.poNumber}`,
//         html: `
//           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//             <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
//               <h2>Purchase Order Approval Required</h2>
//               <p>Dear ${firstApprover.approver.name},</p>
//               <p>A purchase order has been assigned to your department and requires your approval.</p>
              
//               <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
//                 <h3>PO Details</h3>
//                 <table style="width: 100%; border-collapse: collapse;">
//                   <tr><td style="padding: 8px 0;"><strong>PO Number:</strong></td><td>${purchaseOrder.poNumber}</td></tr>
//                   <tr><td style="padding: 8px 0;"><strong>Supplier:</strong></td><td>${purchaseOrder.supplierDetails?.name}</td></tr>
//                   <tr><td style="padding: 8px 0;"><strong>Amount:</strong></td><td>${purchaseOrder.currency} ${purchaseOrder.totalAmount.toLocaleString()}</td></tr>
//                   <tr><td style="padding: 8px 0;"><strong>Department:</strong></td><td>${department}</td></tr>
//                   <tr><td style="padding: 8px 0;"><strong>Approval Level:</strong></td><td>Level 1 - Department Head</td></tr>
//                 </table>
//               </div>
              
//               <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px; margin: 15px 0;">
//                 <p><strong>Document Signature:</strong></p>
//                 <p>Supply Chain has signed this PO. Your approval will automatically add your signature.</p>
//               </div>
              
//               <div style="text-align: center; margin: 30px 0;">
//                 <a href="${process.env.CLIENT_URL}/supervisor/po-approvals?approve=${purchaseOrder._id}" 
//                    style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
//                   Review & Sign PO
//                 </a>
//               </div>
              
//               <p style="color: #666; font-size: 12px; margin-top: 20px;">
//                 This is an automated notification from the Purchase Order Management System.
//               </p>
//             </div>
//           </div>
//         `
//       });
      
//       console.log(`Email notification sent to ${firstApprover.approver.email}`);
//     } catch (emailError) {
//       console.error('Failed to send email notification:', emailError);
//       // Don't fail the assignment if email fails
//     }

//     res.json({
//       success: true,
//       message: 'Purchase order assigned successfully',
//       data: {
//         poNumber: purchaseOrder.poNumber,
//         assignedTo: department,
//         currentApprover: purchaseOrder.approvalChain[0].approver.name,
//         status: purchaseOrder.status
//       }
//     });

//   } catch (error) {
//     console.error('Assign PO error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to assign purchase order',
//       error: error.message
//     });
//   }
// };



// // Reject PO
// const rejectPO = async (req, res) => {
//   try {
//     const { poId } = req.params;
//     const { rejectionReason } = req.body;

//     if (!rejectionReason || rejectionReason.trim().length < 10) {
//       return res.status(400).json({
//         success: false,
//         message: 'Rejection reason must be at least 10 characters'
//       });
//     }

//     const purchaseOrder = await PurchaseOrder.findById(poId)
//       .populate('buyerId', 'fullName email');

//     if (!purchaseOrder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Purchase order not found'
//       });
//     }

//     purchaseOrder.status = 'rejected';
//     purchaseOrder.rejectionDetails = {
//       rejectedBy: req.user.userId,
//       rejectedAt: new Date(),
//       reason: rejectionReason,
//       stage: 'supply_chain'
//     };

//     purchaseOrder.activities.push({
//       type: 'rejected',
//       description: `Rejected by Supply Chain: ${rejectionReason}`,
//       user: req.user.fullName,
//       timestamp: new Date()
//     });

//     await purchaseOrder.save();

//     // Notify buyer
//     try {
//       await sendEmail({
//         to: purchaseOrder.buyerId.email,
//         subject: `Purchase Order ${purchaseOrder.poNumber} - Rejected`,
//         html: `
//           <h2>Purchase Order Rejected</h2>
//           <p>Dear ${purchaseOrder.buyerId.fullName},</p>
//           <p>Your purchase order has been rejected by Supply Chain.</p>
//           <p><strong>PO Number:</strong> ${purchaseOrder.poNumber}</p>
//           <p><strong>Reason:</strong> ${rejectionReason}</p>
//           <p>Please revise and resubmit.</p>
//         `
//       });
//     } catch (emailError) {
//       console.error('Email error:', emailError);
//     }

//     res.json({
//       success: true,
//       message: 'Purchase order rejected successfully'
//     });

//   } catch (error) {
//     console.error('Reject PO error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to reject purchase order',
//       error: error.message
//     });
//   }
// };


// module.exports = {
//   getSuppliers,
//   validatePOItems,
//   createPurchaseOrder,
//   createPurchaseOrderFromQuote,
//   getPurchaseOrders,
//   getPurchaseOrderDetails,
//   updatePurchaseOrder,
//   sendPurchaseOrderToSupplier,
//   cancelPurchaseOrder,
//   downloadPurchaseOrderPDF,
//   previewPurchaseOrderPDF,
//   emailPurchaseOrderPDF,
//   bulkDownloadPurchaseOrders,
//   getSupplyChainPendingPOs,
//   getSupplyChainPOStats,
//   downloadPOForSigning,
//   assignPOToDepartment,
//   rejectPO
// };




