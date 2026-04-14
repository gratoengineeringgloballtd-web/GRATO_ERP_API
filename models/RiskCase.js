// models/RiskCase.js
const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

const riskCaseSchema = new mongoose.Schema({
  module: {
    type: String,
    required: true,
    enum: ['legal', 'contract', 'regulatory', 'intellectual_property']
  },
  entityType: { type: String, enum: ['company', 'supplier', 'contract', 'project', 'employee'], default: 'company' },
  entityId:   { type: mongoose.Schema.Types.ObjectId, default: null },

  caseNumber:  { type: String, unique: true, trim: true },
  title:       { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },

  classification: {
    type: String,
    enum: ['pre_outbreak', 'outbreak', 'post_outbreak'],
    default: 'pre_outbreak'
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },

  status: {
    type: String,
    enum: ['open', 'under_review', 'resolved', 'escalated', 'closed'],
    default: 'open'
  },
  resolutionNotes:    { type: String, trim: true, default: '' },
  resolvedAt:         { type: Date, default: null },
  resolvedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  approvalChain:        [approvalStepSchema],
  currentApprovalLevel: { type: Number, default: 1 },

  disciplinaryCaseId: { type: mongoose.Schema.Types.ObjectId, default: null },
  detectedAt:         { type: Date, default: Date.now },
  dueDate:            { type: Date },

  attachments: [{
    name:       String,
    url:        String,
    uploadedAt: { type: Date, default: Date.now }
  }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

riskCaseSchema.index({ module: 1, status: 1 });
riskCaseSchema.index({ classification: 1, severity: 1 });
riskCaseSchema.index({ entityType: 1, entityId: 1 });

riskCaseSchema.pre('save', async function (next) {
  if (this.isNew && !this.caseNumber) {
    const Counter = require('./Counter');
    const now     = new Date();
    const period  = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counter = await Counter.findByIdAndUpdate(
      `RISK-${period}`,
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    this.caseNumber = `RISK-${period}-${String(counter.seq).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('RiskCase', riskCaseSchema);