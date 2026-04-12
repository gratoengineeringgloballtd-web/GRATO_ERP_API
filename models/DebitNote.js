// models/DebitNote.js
const mongoose = require('mongoose');

const debitNoteApprovalStepSchema = new mongoose.Schema({
  level: { type: Number, required: true },
  approver: {
    name: String,
    email: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: String,
    department: String
  },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  decision: { type: String, enum: ['approved', 'rejected'] },
  comments: String,
  actionDate: Date,
  actionTime: String,
  signedDocument: {
    publicId: String,
    url: String,
    uploadedAt: Date
  }
}, { timestamps: true });

const DebitNoteSchema = new mongoose.Schema({
  debitNoteNumber: {
    type: String,
    unique: true
  },
  
  // Links
  purchaseOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder',
    required: true
  },
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Debit Details
  reason: {
    type: String,
    enum: ['shortage', 'damaged_goods', 'pricing_error', 'quality_issue', 'other'],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  
  // Financial
  originalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  debitAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'XAF'
  },
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'approved', 'sent_to_supplier', 'acknowledged', 'rejected'],
    default: 'draft'
  },
  
  // Approval Chain (Department → Finance)
  approvalChain: [debitNoteApprovalStepSchema],
  currentApprovalLevel: { type: Number, default: 0 },
  
  // Dates
  approvalDate: Date,
  sentDate: Date,
  acknowledgedDate: Date,
  
  // Supplier Acknowledgment
  supplierAcknowledgment: {
    acknowledged: { type: Boolean, default: false },
    acknowledgedBy: String,
    acknowledgedDate: Date,
    comments: String
  },
  
  // Supporting Documents
  attachments: [{
    name: String,
    url: String,
    publicId: String,
    uploadedAt: Date
  }],
  
  // Audit
  activities: [{
    type: { type: String, required: true },
    description: String,
    user: String,
    timestamp: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
DebitNoteSchema.index({ debitNoteNumber: 1 });
DebitNoteSchema.index({ purchaseOrderId: 1 });
DebitNoteSchema.index({ supplierId: 1 });
DebitNoteSchema.index({ status: 1 });

// Auto-generate debit note number
DebitNoteSchema.pre('save', async function(next) {
  if (this.isNew && !this.debitNoteNumber) {
    const count = await this.constructor.countDocuments();
    const year = new Date().getFullYear();
    this.debitNoteNumber = `DN-${year}-${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

// Virtual for display
DebitNoteSchema.virtual('displayId').get(function() {
  return this.debitNoteNumber || `DN-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Methods
DebitNoteSchema.methods.addActivity = function(type, description, user) {
  this.activities.push({ type, description, user, timestamp: new Date() });
  return this.save();
};

module.exports = mongoose.model('DebitNote', DebitNoteSchema);