// models/AuditSchedule.js  — Internal audit scheduler + finding tracker + CAPA
// ─────────────────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');
 
const findingSchema = new mongoose.Schema({
  findingRef:   { type: String, trim: true },
  category:     { type: String, enum: ['major_nc', 'minor_nc', 'observation', 'opportunity'], required: true },
  description:  { type: String, required: true, trim: true },
  evidence:     { type: String, trim: true, default: '' },
  riskLevel:    { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  status:       { type: String, enum: ['open', 'in_progress', 'closed', 'verified'], default: 'open' },
  dueDate:      { type: Date },
  // CAPA — Corrective and Preventive Action
  capa: {
    rootCause:          { type: String, trim: true, default: '' },
    correctiveAction:   { type: String, trim: true, default: '' },
    preventiveAction:   { type: String, trim: true, default: '' },
    actionOwner:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    targetDate:         { type: Date },
    completedDate:      { type: Date },
    verifiedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verificationNotes:  { type: String, trim: true, default: '' },
    status:             { type: String, enum: ['pending', 'in_progress', 'completed', 'verified', 'overdue'], default: 'pending' }
  },
  attachments: [{ name: String, url: String }]
}, { _id: true, timestamps: true });
 
const auditScheduleSchema = new mongoose.Schema({
  auditRef:     { type: String, unique: true, trim: true },
  title:        { type: String, required: true, trim: true },
  auditType:    { type: String, enum: ['internal', 'external', 'surveillance', 'certification', 'regulatory'], required: true },
  scope:        { type: String, trim: true, default: '' },
  standard:     { type: String, trim: true, default: '' },  // e.g. ISO 9001, ISO 14001
  department:   { type: String, trim: true, default: '' },
  module:       { type: String, enum: ['legal', 'contract', 'regulatory', 'intellectual_property', 'hsse', 'general'], default: 'general' },
 
  // Scheduling
  plannedDate:    { type: Date, required: true },
  completedDate:  { type: Date },
  frequency:      { type: String, enum: ['one_off', 'monthly', 'quarterly', 'biannual', 'annual'], default: 'annual' },
  nextAuditDue:   { type: Date },
 
  // Team
  leadAuditor:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auditTeam:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  auditee:        { type: String, trim: true, default: '' },  // department or person being audited
 
  // Status
  status: { type: String, enum: ['planned', 'in_progress', 'completed', 'cancelled', 'overdue'], default: 'planned' },
 
  // Checklist — pre-defined audit questions
  checklist: [{
    item:       { type: String, required: true, trim: true },
    response:   { type: String, enum: ['yes', 'no', 'partial', 'na'], default: 'na' },
    notes:      { type: String, trim: true, default: '' },
    evidence:   { type: String, trim: true, default: '' }
  }],
 
  // Findings and CAPA
  findings:     [findingSchema],
 
  // Summary scores
  totalFindings:  { type: Number, default: 0 },
  majorNCs:       { type: Number, default: 0 },
  minorNCs:       { type: Number, default: 0 },
  observations:   { type: Number, default: 0 },
  overallResult:  { type: String, enum: ['pass', 'conditional_pass', 'fail', 'pending'], default: 'pending' },
 
  // Report
  executiveSummary: { type: String, trim: true, default: '' },
  reportUrl:        { type: String, trim: true, default: '' },
 
  approvalChain:        [approvalStepSchema],
  approvalStatus:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  currentApprovalLevel: { type: Number, default: 1 },
 
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
 
auditScheduleSchema.index({ status: 1, plannedDate: 1 });
auditScheduleSchema.index({ module: 1, auditType: 1 });
 
auditScheduleSchema.pre('save', async function (next) {
  if (this.isNew && !this.auditRef) {
    const Counter = require('./Counter');
    const now    = new Date();
    const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counter = await Counter.findByIdAndUpdate(`AUDIT-${period}`, { $inc: { seq: 1 } }, { upsert: true, new: true });
    this.auditRef = `AUD-${period}-${String(counter.seq).padStart(4, '0')}`;
  }
  // Recalculate finding counts
  if (this.findings) {
    this.totalFindings = this.findings.length;
    this.majorNCs      = this.findings.filter(f => f.category === 'major_nc').length;
    this.minorNCs      = this.findings.filter(f => f.category === 'minor_nc').length;
    this.observations  = this.findings.filter(f => f.category === 'observation').length;
  }
  next();
});
 
module.exports = mongoose.model('AuditSchedule', auditScheduleSchema);
 