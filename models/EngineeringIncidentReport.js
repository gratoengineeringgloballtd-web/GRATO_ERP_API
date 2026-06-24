'use strict';
// models/EngineeringIncidentReport.js
// ─────────────────────────────────────────────────────────────────────────────
// Separate model for the Grato Engineering Incident Report form.
// Accessible ONLY to Technical department employees.
// Approval chain: Submitter → Pascal (Reviewed By) → Didier (Approved By)
//                           → Kelvin (Final Approval)
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

// ── Approval step sub-schema ──────────────────────────────────────────────────
const approvalStepSchema = new mongoose.Schema({
  level:        { type: Number, required: true },
  role:         { type: String, required: true }, // 'reviewed_by' | 'approved_by' | 'final_approved_by'
  label:        { type: String, required: true }, // 'Reviewed By' | 'Approved By' | 'Final Approval'
  approver: {
    name:        { type: String, required: true },
    email:       { type: String, required: true },
    designation: { type: String, default: '' },
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  status:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  comments:     { type: String, default: '' },
  actionDate:   { type: Date, default: null },
  actionTime:   { type: String, default: '' },
  signatureUrl: { type: String, default: '' },
  assignedDate: { type: Date, default: null }
}, { _id: true });

// ── Corrective / Preventive action item ──────────────────────────────────────
const actionItemSchema = new mongoose.Schema({
  action:     { type: String, required: true },
  owner:      { type: String, default: '' },
  targetDate: { type: String, default: '' },
  status:     { type: String, enum: ['Open', 'Done', 'In Progress'], default: 'Open' }
}, { _id: true });

// ── Photo / attachment ────────────────────────────────────────────────────────
const attachmentSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  url:         { type: String, required: true },
  publicId:    { type: String, default: '' },
  mimetype:    { type: String, default: '' },
  size:        { type: Number, default: 0 },
  description: { type: String, default: '' },
  uploadedAt:  { type: Date, default: Date.now }
}, { _id: true });

// ── Main schema ───────────────────────────────────────────────────────────────
const engineeringIncidentReportSchema = new mongoose.Schema({

  // Report identification
  reportNumber:  { type: String, unique: true, sparse: true },

  // ── Section 1 — Incident Description ────────────────────────────────────
  incidentId:    { type: String, default: '' },
  title:         { type: String, required: true, trim: true },
  reportedDateTime:      { type: Date, required: true },
  incidentStartDateTime: { type: Date, required: true },
  resolutionDateTime:    { type: Date },
  duration:      { type: String, default: '' },

  severity: {
    type: String,
    enum: ['P1 / Critical', 'P2 / High', 'P3 / Medium', 'P4 / Low'],
    required: true
  },

  incidentTypes: [{
    type: String,
    enum: [
      'Grid Outage',
      'Generator Failure',
      'Fuel Shortage / Diesel Runout',
      'ATS / AMF Failure',
      'Rectifier Failure',
      'Power Cabinet Issue',
      'Battery Failure',
      'Theft',
      'Fire / Burned Equipment',
      'Lightning / Weather Damage',
      'Planned / Maintenance Activity',
      'Cascade Passive',
      'Landlord / Access Issue',
      'Vendor / Third-Party Delay',
      'Software / Configuration Error',
      'Other'
    ]
  }],

  affectedSiteLocation: { type: String, required: true },
  affectedServices:     { type: String, required: true },

  slaStatus: {
    type: String,
    enum: ['Within SLA', 'Outside SLA (OSLA)'],
    required: true
  },

  changeId:          { type: String, default: 'N/A' },
  existingProblemId: { type: String, default: 'N/A' },

  incidentStatus: {
    type: String,
    enum: ['Open', 'In Progress', 'Resolved', 'Closed'],
    required: true
  },

  detailsNarrative:  { type: String, required: true },
  resolutionSummary: { type: String, default: '' },

  // ── Section 2 — Business Impact ─────────────────────────────────────────
  impactLevel: {
    type: String,
    enum: [
      'Critical (Revenue Loss)',
      'High (Major Disruption)',
      'Medium (Partial Outage)',
      'Low (Minor Degradation)'
    ],
    required: true
  },
  impactAffectedServices: { type: String, default: '' },
  numberOfSitesAffected:  { type: String, default: '' },

  financialImpact: {
    type: String,
    enum: ['None', 'Minor', 'Significant', 'Severe — quantify below', ''],
    default: ''
  },

  regulatoryImpact: {
    type: String,
    enum: ['Yes — described below', 'No'],
    required: true
  },

  reputationalRisk: {
    type: String,
    enum: ['High', 'Medium', 'Low', 'None'],
    required: true
  },

  impactDescription: { type: String, default: '' },

  // ── Section 3 — Sequence of Activities ──────────────────────────────────
  activityLog:     { type: String, required: true },
  activityLogEntries: [{
    date:        { type: String, default: '' },
    time:        { type: String, default: '' },
    action:      { type: String, default: '' },
    responsible: { type: String, default: '' }
  }],

  // ── Section 4 — Preliminary Findings ────────────────────────────────────
  initialObservation: { type: String, required: true },
  systemsChecked:     { type: String, default: '' },

  testsPerformed: [{
    type: String,
    enum: [
      'Generator Manual Start Test',
      'ATS / AMF Bypass Test',
      'Fuel Level Check',
      'Oil Level Check',
      'Coolant / Water Level Check',
      'Battery Voltage Check',
      'Rectifier Reset / Module Check',
      'Grid Voltage / Phase Check',
      'Control Panel / Card Reset',
      'Load Measurement (KVA / Amperage)',
      'Visual Inspection (On-site)',
      'Remote Diagnostics (NOC)',
      'Reboot / Power Reset',
      'Cable / Wiring Inspection',
      'Fuel Line / Pump Check',
      'Other'
    ]
  }],

  initialConclusion: [{
    type: String,
    enum: [
      'Grid Outage — External',
      'Grid Bad Voltage / Phase Issue',
      'Generator Overload',
      'Generator Mechanical Fault',
      'Generator Control / Card Fault',
      'Fuel Shortage',
      'ATS / AMF Fault',
      'Battery / Backup Failure',
      'Rectifier Fault',
      'Power Cabinet Issue',
      'Theft',
      'Fire / Physical Damage',
      'Lightning / Weather Related',
      'Cascade from Parent Site',
      'Planned Activity',
      'Human Error',
      'Unknown — Investigation Ongoing'
    ]
  }],

  detailedFindings: { type: String, required: true },

  // ── Section 5 — Root Cause ───────────────────────────────────────────────
  rcaMethod: {
    type: String,
    enum: ['5-Why Analysis', 'Fishbone (Ishikawa) Diagram', 'Fault Tree Analysis', 'Other', ''],
    default: ''
  },

  rootCauseCategories: [{
    type: String,
    enum: [
      'External Grid Failure',
      'Generator Mechanical Fault',
      'Generator Electrical Fault',
      'Fuel / Diesel Supply Issue',
      'ATS / Control Panel Fault',
      'Battery / Backup Degradation',
      'Rectifier / Power Equipment Fault',
      'Physical Damage (Fire / Lightning)',
      'Theft / Vandalism',
      'Cascade / Dependency Failure',
      'Process / Maintenance Gap',
      'Human Factor',
      'Third-Party / Vendor Failure',
      'Environmental / Infrastructure',
      'Unknown'
    ]
  }],

  contributingFactors:    { type: String, default: '' },
  rootCauseConfirmedBy:   { type: String, required: true },
  rootCauseDescription:   { type: String, required: true },

  // ── Section 6 — Key Challenges ───────────────────────────────────────────
  logisticsChallenges:    { type: String, enum: ['Yes', 'No'], required: true },
  securityAccessIssues:   { type: String, enum: ['Yes', 'No'], required: true },
  sparePartsAvailability: { type: String, enum: ['Yes — delayed', 'No issues'], required: true },
  communicationIssues:    { type: String, enum: ['Yes', 'No'], required: true },
  vendorDelays:           { type: String, enum: ['Yes', 'No'], required: true },
  challengeDetails:       { type: String, default: '' },

  // ── Section 7 — Recommendations / Actions ───────────────────────────────
  recommendationText:        { type: String, required: true },
  actionItems:               [actionItemSchema],
  additionalRecommendations: { type: String, default: '' },

  // ── Section 8 — Photo Evidence & Attachments ────────────────────────────
  attachments: [attachmentSchema],
  evidenceDescriptions: [{
    index:       { type: Number },
    description: { type: String, default: '' }
  }],
  additionalAttachmentTypes: [{
    type: String,
    enum: [
      'Network / Topology Diagram',
      'Alarm Screenshots',
      'Configuration Backup Files',
      'Equipment Replacement Records',
      'Vendor / Supplier Reports',
      'Change Request Documentation',
      'SLA / Penalty Calculation Sheet',
      'Post-Incident Review (PIR) Report',
      'Other'
    ]
  }],
  otherAttachmentsSpec: { type: String, default: '' },

  // ── Approval workflow ────────────────────────────────────────────────────
  approvalChain:        [approvalStepSchema],
  currentApprovalLevel: { type: Number, default: 1 },

  overallStatus: {
    type: String,
    enum: [
      'draft',
      'submitted',
      'pending_review',         // Level 1 — Pascal's turn
      'pending_approval',       // Level 2 — Didier's turn
      'pending_final_approval', // Level 3 — Kelvin's turn
      'approved',               // Fully signed off
      'rejected'
    ],
    default: 'draft'
  },

  reportStatus: {
    type: String,
    enum: [
      'Draft — awaiting review',
      'Under Review',
      'Pending Final Approval',
      'Approved — final',
      'Rejected — revision required'
    ],
    default: 'Draft — awaiting review'
  },

  approverComments: { type: String, default: '' },

  // ── Submitter info ───────────────────────────────────────────────────────
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  preparedByName:        { type: String, required: true },
  preparedByDesignation: { type: String, default: '' },
  preparedByDate:        { type: Date },

  // Level 1 — Pascal
  reviewedByName:        { type: String, default: '' },
  reviewedByDesignation: { type: String, default: '' },
  reviewedByDate:        { type: Date },

  // Level 2 — Didier
  approvedByName:        { type: String, default: '' },
  approvedByDesignation: { type: String, default: '' },
  approvedByDate:        { type: Date },

  // Level 3 — Kelvin
  finalApprovedByName:        { type: String, default: '' },
  finalApprovedByDesignation: { type: String, default: '' },
  finalApprovedByDate:        { type: Date },

  // ── Sharing ──────────────────────────────────────────────────────────────
  publicShareToken:    { type: String, default: null, index: true },
  publicShareExpiresAt:{ type: Date, default: null },

  // ── Soft delete ──────────────────────────────────────────────────────────
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },

  // ── Notifications tracking ───────────────────────────────────────────────
  notificationsSent: {
    pascal:    { sent: Boolean, sentAt: Date, email: String },
    didier:    { sent: Boolean, sentAt: Date, email: String },
    kelvin:    { sent: Boolean, sentAt: Date, email: String },
    submitter: { sent: Boolean, sentAt: Date, email: String }
  }

}, {
  timestamps: true,
  toJSON:     { virtuals: true },
  toObject:   { virtuals: true }
});

// ── Indexes ───────────────────────────────────────────────────────────────────
engineeringIncidentReportSchema.index({ submittedBy: 1, overallStatus: 1 });
engineeringIncidentReportSchema.index({ overallStatus: 1, createdAt: -1 });
engineeringIncidentReportSchema.index({ severity: 1 });
engineeringIncidentReportSchema.index({ publicShareToken: 1 });
engineeringIncidentReportSchema.index({ 'approvalChain.approver.email': 1, 'approvalChain.status': 1 });

// ── Pre-save: generate reportNumber ──────────────────────────────────────────
engineeringIncidentReportSchema.pre('save', async function (next) {
  try {
    if (!this.reportNumber) {
      let attempts = 0;
      while (attempts < 10) {
        const now  = new Date();
        const yr   = now.getFullYear();
        const mo   = String(now.getMonth() + 1).padStart(2, '0');
        const dy   = String(now.getDate()).padStart(2, '0');
        const rnd  = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const candidate = `EIR${yr}${mo}${dy}-${rnd}`;
        const exists = await this.constructor.findOne({ reportNumber: candidate, _id: { $ne: this._id } });
        if (!exists) { this.reportNumber = candidate; break; }
        attempts++;
      }
    }
    next();
  } catch (err) { next(err); }
});

// ── Virtual ───────────────────────────────────────────────────────────────────
engineeringIncidentReportSchema.virtual('displayId').get(function () {
  return this.reportNumber || `EIR-${this._id.toString().slice(-6).toUpperCase()}`;
});

module.exports = mongoose.model('EngineeringIncidentReport', engineeringIncidentReportSchema);




