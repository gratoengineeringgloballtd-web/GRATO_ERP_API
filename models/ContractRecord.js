// models/ContractRecord.js
const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

const serviceLevelSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  metric:      { type: String, trim: true },
  target:      { type: String, trim: true },
  penalty:     { type: String, trim: true, default: '' }
}, { _id: true });

const contractTaskSchema = new mongoose.Schema({
  title:          { type: String, required: true, trim: true },
  description:    { type: String, trim: true, default: '' },
  serviceLevelId: { type: mongoose.Schema.Types.ObjectId, default: null },
  projectTaskId:  { type: mongoose.Schema.Types.ObjectId, default: null },
  dueDate:        { type: Date },
  status:         { type: String, enum: ['pending', 'in_progress', 'completed', 'overdue'], default: 'pending' },
  completedAt:    { type: Date, default: null },
  completedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { _id: true });

const contractRecordSchema = new mongoose.Schema({
  supplierId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  projectId:     { type: mongoose.Schema.Types.ObjectId, default: null },
  invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },

  contractNumber: { type: String, required: true, unique: true, trim: true },
  contractName:   { type: String, required: true, trim: true },
  contractType:   {
    type: String,
    enum: ['service', 'supply', 'framework', 'project', 'consultancy', 'other'],
    default: 'service'
  },
  description:    { type: String, trim: true, default: '' },

  counterpartyName:  { type: String, trim: true },
  counterpartyEmail: { type: String, trim: true },

  approvedCost:    { type: Number, default: 0 },
  executionCost:   { type: Number, default: 0 },
  approvedRevenue: { type: Number, default: 0 },
  actualRevenue:   { type: Number, default: 0 },

  startDate:   { type: Date, required: true },
  endDate:     { type: Date },
  renewalDate: { type: Date },

  status: {
    type: String,
    enum: ['draft', 'active', 'under_review', 'terminated', 'expired', 'renewed'],
    default: 'draft'
  },

  serviceLevels:  [serviceLevelSchema],
  contractTasks:  [contractTaskSchema],

  complianceStatus: {
    type: String,
    enum: ['compliant', 'minor_breach', 'major_breach', 'terminated_for_cause'],
    default: 'compliant'
  },
  periodicReviewDays: { type: Number, default: 90 },
  lastReviewDate:     { type: Date },
  nextReviewDue:      { type: Date },

  documents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ComplianceDocument' }],
  riskCases: [{ type: mongoose.Schema.Types.ObjectId, ref: 'RiskCase' }],

  approvalChain:        [approvalStepSchema],
  approvalStatus:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  currentApprovalLevel: { type: Number, default: 1 },

  terminationDate:     { type: Date, default: null },
  terminationReason:   { type: String, trim: true, default: '' },
  terminationNoticeId: { type: mongoose.Schema.Types.ObjectId, default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tags:      [{ type: String, trim: true }]
}, { timestamps: true });

contractRecordSchema.virtual('profitability').get(function () {
  return (this.actualRevenue || 0) - (this.executionCost || 0);
});

contractRecordSchema.virtual('profitabilityMargin').get(function () {
  if (!this.actualRevenue || this.actualRevenue === 0) return 0;
  return Math.round(((this.actualRevenue - this.executionCost) / this.actualRevenue) * 100);
});

contractRecordSchema.set('toJSON',   { virtuals: true });
contractRecordSchema.set('toObject', { virtuals: true });

contractRecordSchema.index({ status: 1, nextReviewDue: 1 });
contractRecordSchema.index({ supplierId: 1 });
contractRecordSchema.index({ projectId: 1 });

module.exports = mongoose.model('ContractRecord', contractRecordSchema);