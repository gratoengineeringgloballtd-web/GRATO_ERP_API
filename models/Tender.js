// models/Tender.js
const mongoose = require('mongoose');

const TenderItemSchema = new mongoose.Schema({
  description:     { type: String, required: true },
  quantity:        { type: Number, default: 1,   min: 0 },
  unitPrice:       { type: Number, default: 0,   min: 0 },
  totalAmount:     { type: Number, default: 0,   min: 0 },
  negotiatedTotal: { type: Number, default: 0,   min: 0 }
}, { _id: false });

const TenderSupplierQuoteSchema = new mongoose.Schema({
  supplierId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  supplierName:         { type: String, required: true },
  supplierEmail:        String,
  items:                [TenderItemSchema],
  grandTotal:           { type: Number, default: 0, min: 0 },
  negotiatedGrandTotal: { type: Number, default: 0, min: 0 },
  deliveryTerms:        String,
  paymentTerms:         String,
  warranty:             String,
  notes:                String
}, { _id: false });

// ── Approval step (mirrors PO approval chain shape) ──────────────────────────
const TenderApprovalStepSchema = new mongoose.Schema({
  level: { type: Number, required: true },
  approver: {
    name:       { type: String, required: true },
    email:      { type: String, required: true },
    role:       String,
    department: String
  },
  status: {
    type:    String,
    enum:    ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  comments:     { type: String, default: '' },
  actionDate:   Date,
  actionTime:   String,
  decidedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Snapshot of the approver's signature path at the moment they signed
  signaturePath: String,
  activatedDate: Date,
  notificationSent: { type: Boolean, default: false }
}, { timestamps: true });

const TenderSchema = new mongoose.Schema({
  tenderNumber: { type: String, unique: true, required: true },

  source: {
    type:     String,
    enum:     ['rfq', 'manual'],
    required: true,
    default:  'manual'
  },
  rfqId:        { type: mongoose.Schema.Types.ObjectId, ref: 'RFQ' },
  requisitionId:{ type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequisition' },

  // ── Header ─────────────────────────────────────────────────────────────────
  title:               { type: String, required: true, trim: true },
  itemCategory:        { type: String, trim: true },
  date:                { type: Date,   default: Date.now },
  requiredDate:        Date,

  // ── Requester ──────────────────────────────────────────────────────────────
  requesterName:       { type: String, required: true, trim: true },
  requesterDepartment: { type: String, trim: true },
  commercialTerms:     { type: String, trim: true },

  // ── Supplier comparison ───────────────────────────────────────────────────
  supplierQuotes: [TenderSupplierQuoteSchema],

  // ── Common terms ──────────────────────────────────────────────────────────
  deliveryTerms: String,
  paymentTerms:  String,
  warranty:      String,

  // ── Award ─────────────────────────────────────────────────────────────────
  awardedSupplierId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  awardedSupplierName: String,
  budget:        { type: Number, default: 0, min: 0 },
  costSavings:   { type: Number, default: 0, min: 0 },
  costAvoidance: { type: Number, default: 0, min: 0 },

  // ── Recommendations ───────────────────────────────────────────────────────
  technicalRecommendation:   { type: String, trim: true },
  procurementRecommendation: { type: String, trim: true },

  // ── Workflow ──────────────────────────────────────────────────────────────
  status: {
    type:    String,
    enum:    ['draft', 'pending_approval', 'approved', 'rejected', 'awarded'],
    default: 'draft'
  },

  // ── 3-level approval chain (same structure as PO) ─────────────────────────
  approvalChain:        [TenderApprovalStepSchema],
  currentApprovalLevel: { type: Number, default: 0 },

  // ── Linked PO ─────────────────────────────────────────────────────────────
  purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },

  // ── Audit ─────────────────────────────────────────────────────────────────
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, {
  timestamps: true,
  toJSON:   { virtuals: true },
  toObject: { virtuals: true }
});

// ── Indexes ───────────────────────────────────────────────────────────────────
TenderSchema.index({ tenderNumber: 1 });
TenderSchema.index({ createdBy: 1, status: 1 });
TenderSchema.index({ status: 1, createdAt: -1 });
TenderSchema.index({ rfqId: 1 });
TenderSchema.index({ requisitionId: 1 });
TenderSchema.index({ 'approvalChain.approver.email': 1 });

// ── Virtuals ──────────────────────────────────────────────────────────────────
TenderSchema.virtual('supplierCount').get(function () {
  return (this.supplierQuotes || []).length;
});

TenderSchema.virtual('lowestNegotiatedOffer').get(function () {
  if (!this.supplierQuotes || this.supplierQuotes.length === 0) return 0;
  const vals = this.supplierQuotes.map(sq => sq.negotiatedGrandTotal || 0).filter(v => v > 0);
  return vals.length ? Math.min(...vals) : 0;
});

// ── Helpers ───────────────────────────────────────────────────────────────────
TenderSchema.methods.getCurrentApprover = function () {
  if (!this.approvalChain || this.currentApprovalLevel === 0) return null;
  return this.approvalChain.find(
    step => step.level === this.currentApprovalLevel && step.status === 'pending'
  ) || null;
};

TenderSchema.methods.canUserApprove = function (userEmail) {
  const step = this.getCurrentApprover();
  return step && step.approver.email.toLowerCase() === userEmail.toLowerCase();
};

module.exports = mongoose.model('Tender', TenderSchema);