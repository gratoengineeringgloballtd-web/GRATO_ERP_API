const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

// models/WhistleblowingCase.js  — Anonymous reporting with confidentiality controls
// ─────────────────────────────────────────────────────────────────────────────
const whistleblowingCaseSchema = new mongoose.Schema({
  caseRef:      { type: String, unique: true, trim: true },
 
  // Reporter (kept anonymous — no user linkage)
  reporterToken: { type: String, trim: true },  // random token reporter can use to check status
  reporterDepartment: { type: String, trim: true, default: '' },  // optional, self-reported
 
  // Allegation
  category: {
    type: String,
    required: true,
    enum: ['fraud', 'bribery_corruption', 'harassment', 'discrimination', 'health_safety', 'environmental', 'data_misuse', 'financial_misconduct', 'conflict_of_interest', 'other']
  },
  description:      { type: String, required: true, trim: true },
  allegationDate:   { type: Date },             // when did the alleged conduct occur
  allegedParties:   [{ type: String, trim: true }],  // no IDs — text only to protect anonymity
  isAnonymous:      { type: Boolean, default: true },
  contactPreference:{ type: String, enum: ['none', 'email_only', 'phone'], default: 'none' },
  contactDetail:    { type: String, trim: true, default: '' },  // encrypted or blank
 
  // Case management
  investigatorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Access is restricted — only assigned investigator and compliance lead can view details
  restrictedAccess: { type: Boolean, default: true },
  authorisedViewers:[{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
 
  status: {
    type: String,
    enum: ['received', 'under_assessment', 'under_investigation', 'action_taken', 'closed_substantiated', 'closed_unsubstantiated', 'closed_inconclusive'],
    default: 'received'
  },
 
  // Investigation log (visible only to authorised viewers)
  investigationLog: [{
    logDate:      { type: Date, default: Date.now },
    entry:        { type: String, trim: true },
    addedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
 
  // Outcome
  outcome:          { type: String, trim: true, default: '' },
  disciplinaryAction: { type: Boolean, default: false },
  regulatoryReferral: { type: Boolean, default: false },
  closedAt:         { type: Date },
 
  // Response to reporter (via token — keeps anonymity)
  reporterUpdates: [{
    updateDate: { type: Date, default: Date.now },
    message:    { type: String, trim: true }
  }],
 
  attachments: [{ name: String, url: String }],
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });
 
whistleblowingCaseSchema.index({ status: 1, createdAt: -1 });
whistleblowingCaseSchema.index({ reporterToken: 1 });
 
whistleblowingCaseSchema.pre('save', async function (next) {
  if (this.isNew && !this.caseRef) {
    const Counter = require('./Counter');
    const now    = new Date();
    const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counter = await Counter.findByIdAndUpdate(`WB-${period}`, { $inc: { seq: 1 } }, { upsert: true, new: true });
    this.caseRef = `WB-${period}-${String(counter.seq).padStart(4, '0')}`;
    // Generate anonymous reporter token
    if (!this.reporterToken) {
      this.reporterToken = Math.random().toString(36).substring(2, 12).toUpperCase();
    }
  }
  next();
});
 
module.exports = mongoose.model('WhistleblowingCase', whistleblowingCaseSchema);
 