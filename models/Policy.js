const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

// models/Policy.js  — Policy register + staff acknowledgement + version control
// ─────────────────────────────────────────────────────────────────────────────
const policyAcknowledgementSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:       { type: String, trim: true },
  acknowledgedAt: { type: Date, default: Date.now },
  version:        { type: Number, required: true },
  ipAddress:      { type: String, trim: true, default: '' }
}, { _id: true });
 
const policyVersionSchema = new mongoose.Schema({
  versionNumber:    { type: Number, required: true },
  content:          { type: String, trim: true, default: '' },   // full text or URL
  documentUrl:      { type: String, trim: true, default: '' },
  changeSummary:    { type: String, trim: true, default: '' },
  publishedAt:      { type: Date },
  publishedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status:           { type: String, enum: ['draft', 'published', 'superseded'], default: 'draft' }
}, { _id: true });
 
const policySchema = new mongoose.Schema({
  policyRef:    { type: String, unique: true, trim: true },
  title:        { type: String, required: true, trim: true },
  category: {
    type: String,
    required: true,
    enum: ['hsse', 'hr', 'data_protection', 'anti_bribery', 'financial', 'environmental', 'quality', 'information_security', 'code_of_conduct', 'other']
  },
  owner:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ownerDepartment: { type: String, trim: true, default: '' },
  description:  { type: String, trim: true, default: '' },
  scope:        { type: String, trim: true, default: '' },   // who it applies to
 
  // Version history
  versions:       [policyVersionSchema],
  currentVersion: { type: Number, default: 1 },
 
  // Review schedule
  reviewFrequencyDays:  { type: Number, default: 365 },
  lastReviewDate:       { type: Date },
  nextReviewDue:        { type: Date },
 
  // Mandatory read — who must sign off
  mandatoryFor:     { type: String, enum: ['all_staff', 'management', 'specific_roles', 'specific_departments'], default: 'all_staff' },
  mandatoryRoles:   [{ type: String, trim: true }],
  mandatoryDepts:   [{ type: String, trim: true }],
 
  // Acknowledgements
  acknowledgements: [policyAcknowledgementSchema],
 
  // Coverage metrics (computed)
  totalRequired:    { type: Number, default: 0 },
  totalAcknowledged:{ type: Number, default: 0 },
  coveragePct:      { type: Number, default: 0 },
 
  status: { type: String, enum: ['draft', 'active', 'under_review', 'retired'], default: 'draft' },
 
  approvalChain:        [approvalStepSchema],
  approvalStatus:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  currentApprovalLevel: { type: Number, default: 1 },
 
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tags:      [{ type: String, trim: true }]
}, { timestamps: true });
 
policySchema.index({ category: 1, status: 1 });
policySchema.index({ nextReviewDue: 1 });
 
policySchema.pre('save', async function (next) {
  if (this.isNew && !this.policyRef) {
    const Counter = require('./Counter');
    const year   = new Date().getFullYear();
    const counter = await Counter.findByIdAndUpdate(`POL-${year}`, { $inc: { seq: 1 } }, { upsert: true, new: true });
    this.policyRef = `POL-${year}-${String(counter.seq).padStart(3, '0')}`;
  }
  // Update coverage %
  if (this.totalRequired > 0) {
    this.totalAcknowledged = this.acknowledgements.length;
    this.coveragePct = Math.round((this.totalAcknowledged / this.totalRequired) * 100);
  }
  next();
});
 
module.exports = mongoose.model('Policy', policySchema);
 
 