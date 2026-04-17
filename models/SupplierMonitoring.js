const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

// models/SupplierMonitoring.js  — Ongoing supplier compliance monitoring + sanctions
// ─────────────────────────────────────────────────────────────────────────────
const supplierMonitoringSchema = new mongoose.Schema({
  supplierId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  supplierName:    { type: String, trim: true, required: true },
 
  // Sanctions & blacklist check
  sanctionsCheckDate:   { type: Date },
  sanctionsCheckResult: { type: String, enum: ['clear', 'flagged', 'not_checked'], default: 'not_checked' },
  sanctionsCheckSource: { type: String, trim: true, default: '' },  // e.g. UN, OFAC, EU
  sanctionsNotes:       { type: String, trim: true, default: '' },
  isBlacklisted:        { type: Boolean, default: false },
  blacklistReason:      { type: String, trim: true, default: '' },
 
  // Performance compliance scoring (from existing SDD + contract data)
  complianceScore:      { type: Number, default: 0 },   // 0-100
  lastScoredAt:         { type: Date },
  scoreHistory: [{
    score:      { type: Number },
    scoredAt:   { type: Date, default: Date.now },
    trigger:    { type: String, trim: true, default: '' }
  }],
 
  // Re-assessment triggers
  reassessmentTriggers: [{
    trigger:    { type: String, enum: ['annual_review', 'contract_renewal', 'incident', 'score_drop', 'regulatory_change', 'manual'], required: true },
    triggeredAt:{ type: Date, default: Date.now },
    triggeredBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes:      { type: String, trim: true, default: '' },
    sddRequired:{ type: Boolean, default: false },
    sddCompleted:{ type: Boolean, default: false }
  }],
 
  // Ongoing monitoring alerts
  alerts: [{
    alertType:  { type: String, enum: ['expiring_cert', 'score_drop', 'sanctions_flag', 'overdue_sdd', 'contract_breach'], required: true },
    message:    { type: String, trim: true },
    severity:   { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    createdAt:  { type: Date, default: Date.now },
    resolved:   { type: Boolean, default: false },
    resolvedAt: { type: Date }
  }],
 
  // Next scheduled review
  nextReviewDue:   { type: Date },
  reviewFrequencyDays: { type: Number, default: 365 },
 
  status: { type: String, enum: ['active', 'under_review', 'suspended', 'terminated'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
 
supplierMonitoringSchema.index({ supplierId: 1 });
supplierMonitoringSchema.index({ isBlacklisted: 1, sanctionsCheckResult: 1 });
supplierMonitoringSchema.index({ nextReviewDue: 1, status: 1 });
 
module.exports = mongoose.model('SupplierMonitoring', supplierMonitoringSchema);
 