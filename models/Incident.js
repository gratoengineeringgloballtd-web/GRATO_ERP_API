const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

// models/Incident.js  — Incident reporting + RCA + near-miss + corrective actions
// ─────────────────────────────────────────────────────────────────────────────
const incidentSchema = new mongoose.Schema({
  incidentRef:  { type: String, unique: true, trim: true },
  title:        { type: String, required: true, trim: true },
  incidentType: {
    type: String,
    required: true,
    enum: ['accident', 'near_miss', 'environmental', 'security_breach', 'data_breach', 'property_damage', 'regulatory_breach', 'conduct', 'other']
  },
  category:     { type: String, enum: ['hsse', 'legal', 'regulatory', 'financial', 'reputational', 'operational'], default: 'operational' },
  severity:     { type: String, enum: ['low', 'medium', 'high', 'critical', 'fatality'], required: true },
  description:  { type: String, required: true, trim: true },
 
  // Who, where, when
  occurredAt:   { type: Date, required: true },
  location:     { type: String, trim: true, default: '' },
  reportedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reportedByName: { type: String, trim: true, default: '' },
  involvedParties: [{ type: String, trim: true }],
 
  // Injuries / losses
  injuries:     { type: Boolean, default: false },
  injuryDetails:{ type: String, trim: true, default: '' },
  estimatedLoss:{ type: Number, default: 0 },
 
  // Investigation
  investigationStatus: { type: String, enum: ['not_started', 'in_progress', 'completed'], default: 'not_started' },
  investigatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  investigationStartDate: { type: Date },
  investigationEndDate:   { type: Date },
 
  // Root cause analysis (5-Whys / Fishbone)
  rootCauseAnalysis: {
    method:      { type: String, enum: ['five_whys', 'fishbone', 'fault_tree', 'other'], default: 'five_whys' },
    whys:        [{ why: String, answer: String }],
    rootCauses:  [{ type: String, trim: true }],
    contributingFactors: [{ type: String, trim: true }]
  },
 
  // Corrective actions
  correctiveActions: [{
    description:  { type: String, required: true, trim: true },
    assignedTo:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    dueDate:      { type: Date },
    completedDate:{ type: Date },
    status:       { type: String, enum: ['open', 'in_progress', 'completed', 'overdue'], default: 'open' },
    verifiedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  }],
 
  // Regulatory notification required?
  regulatoryNotificationRequired: { type: Boolean, default: false },
  regulatoryNotificationSent:     { type: Boolean, default: false },
  regulatoryNotificationDate:     { type: Date },
  regulatoryBody:                 { type: String, trim: true, default: '' },
 
  // Attachments
  attachments: [{ name: String, url: String }],
 
  status:    { type: String, enum: ['open', 'under_investigation', 'action_pending', 'closed', 'archived'], default: 'open' },
  closedAt:  { type: Date },
  closedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  closureNotes: { type: String, trim: true, default: '' },
 
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
 
incidentSchema.index({ incidentType: 1, severity: 1 });
incidentSchema.index({ status: 1, occurredAt: -1 });
 
incidentSchema.pre('save', async function (next) {
  if (this.isNew && !this.incidentRef) {
    const Counter = require('./Counter');
    const now    = new Date();
    const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counter = await Counter.findByIdAndUpdate(`INC-${period}`, { $inc: { seq: 1 } }, { upsert: true, new: true });
    this.incidentRef = `INC-${period}-${String(counter.seq).padStart(4, '0')}`;
  }
  next();
});
 
module.exports = mongoose.model('Incident', incidentSchema);
 
 