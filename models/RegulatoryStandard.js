// models/RegulatoryStandard.js
const mongoose = require('mongoose');
const { reviewCycleSchema, approvalStepSchema } = require('./shared/legalSubSchemas');

const disclosureSchema = new mongoose.Schema({
  disclosureType: {
    type: String,
    enum: ['detected_risk', 'notification', 'penalty', 'litigation', 'employee_outburst'],
    required: true
  },
  description: { type: String, required: true, trim: true },
  amount:      { type: Number, default: 0 },
  authority:   { type: String, trim: true, default: '' },
  dueDate:     { type: Date },
  status:      { type: String, enum: ['open', 'resolved', 'appealed'], default: 'open' },
  resolvedAt:  { type: Date },
  attachments: [{ name: String, url: String }],
  createdAt:   { type: Date, default: Date.now }
}, { _id: true });

const regulatoryStandardSchema = new mongoose.Schema({
  regulatoryArea: {
    type: String,
    required: true,
    enum: ['financials', 'data_protection', 'health_safety_security', 'anti_money_laundering', 'environmental', 'other']
  },
  regulatoryBody:  { type: String, required: true, trim: true },
  standardName:    { type: String, required: true, trim: true },
  description:     { type: String, trim: true, default: '' },
  jurisdiction:    { type: String, enum: ['state', 'national', 'international'], default: 'national' },
  referenceCode:   { type: String, trim: true, default: '' },

  complianceStatus: {
    type: String,
    enum: ['compliant', 'non_compliant', 'under_review', 'not_applicable'],
    default: 'under_review'
  },

  reviewFrequencyDays: { type: Number, default: 180 },
  lastReviewDate:      { type: Date },
  nextReviewDue:       { type: Date },
  reviewCycles:        [reviewCycleSchema],

  approvalChain:        [approvalStepSchema],
  approvalStatus:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  currentApprovalLevel: { type: Number, default: 1 },

  disclosures: [disclosureSchema],
  riskCases:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'RiskCase' }],
  documents:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'ComplianceDocument' }],

  isActive:  { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

regulatoryStandardSchema.index({ regulatoryArea: 1, complianceStatus: 1 });
regulatoryStandardSchema.index({ nextReviewDue: 1 });

module.exports = mongoose.model('RegulatoryStandard', regulatoryStandardSchema);