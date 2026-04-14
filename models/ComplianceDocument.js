// models/ComplianceDocument.js
const mongoose = require('mongoose');
const { reviewCycleSchema, approvalStepSchema } = require('./shared/legalSubSchemas');

const complianceDocumentSchema = new mongoose.Schema({
  module: {
    type: String,
    required: true,
    enum: ['legal', 'contract', 'regulatory', 'intellectual_property', 'sdd']
  },
  entityType: { type: String, enum: ['company', 'supplier', 'contract', 'project'], default: 'company' },
  entityId:   { type: mongoose.Schema.Types.ObjectId, default: null },

  documentType:    { type: String, required: true, trim: true },
  name:            { type: String, required: true, trim: true },
  description:     { type: String, trim: true, default: '' },
  referenceNumber: { type: String, trim: true, default: '' },

  file: {
    publicId:     String,
    url:          String,
    originalName: String,
    format:       String,
    bytes:        Number
  },

  issueDate:   { type: Date },
  expiryDate:  { type: Date },
  isExpired:   { type: Boolean, default: false },

  reviewFrequencyDays: { type: Number, default: 365 },
  lastReviewDate:      { type: Date },
  nextReviewDue:       { type: Date },
  reviewCycles:        [reviewCycleSchema],

  approvalChain:        [approvalStepSchema],
  approvalStatus:       { type: String, enum: ['pending', 'approved', 'rejected', 'under_review'], default: 'pending' },
  currentApprovalLevel: { type: Number, default: 1 },

  status:        { type: String, enum: ['active', 'expired', 'pending_renewal', 'archived'], default: 'active' },
  standardsBody: { type: String, trim: true, default: '' },
  standardsRef:  { type: String, trim: true, default: '' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tags:      [{ type: String, trim: true }]
}, { timestamps: true });

complianceDocumentSchema.index({ module: 1, entityType: 1, entityId: 1 });
complianceDocumentSchema.index({ expiryDate: 1, status: 1 });
complianceDocumentSchema.index({ nextReviewDue: 1 });

complianceDocumentSchema.pre('save', function (next) {
  if (this.expiryDate && new Date(this.expiryDate) < new Date()) {
    this.isExpired = true;
    this.status = 'expired';
  }
  next();
});

module.exports = mongoose.model('ComplianceDocument', complianceDocumentSchema);