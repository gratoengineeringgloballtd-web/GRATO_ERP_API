'use strict';
// models/EngineeringIncidentReport.js
// ─────────────────────────────────────────────────────────────────────────────
// Separate model for the Grato Engineering Incident Report form.
// Accessible ONLY to Technical department employees.
// Approval chain: Submitter → Pascal (Reviewed By) → Didier (Approved By)
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

// ── Approval step sub-schema ──────────────────────────────────────────────────
const approvalStepSchema = new mongoose.Schema({
  level:        { type: Number, required: true },
  role:         { type: String, required: true }, // 'prepared_by' | 'reviewed_by' | 'approved_by'
  label:        { type: String, required: true }, // 'Prepared By' | 'Reviewed By' | 'Approved By'
  approver: {
    name:       { type: String, required: true },
    email:      { type: String, required: true },
    designation:{ type: String, default: '' },
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  status:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  comments:     { type: String, default: '' },
  actionDate:   { type: Date, default: null },
  actionTime:   { type: String, default: '' },
  signatureUrl: { type: String, default: '' },     // Cloudinary URL or local path
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

  // Section 1 — Incident Description
  incidentId:    { type: String, default: '' },
  title:         { type: String, required: true, trim: true },
  reportedDateTime:   { type: Date, required: true },
  incidentStartDateTime: { type: Date, required: true },
  resolutionDateTime: { type: Date },
  duration:      { type: String, default: '' },   // e.g. "3 hours 20 minutes"

  severity: {
    type: String,
    enum: ['P1 / Critical', 'P2 / High', 'P3 / Medium', 'P4 / Low'],
    required: true
  },

  incidentTypes: [{
    type: String,
    enum: ['Network Outage', 'Hardware Failure', 'Software Bug', 'Security Breach',
           'Power Failure', 'Human Error', 'Other']
  }],

  affectedSiteLocation:    { type: String, required: true },
  affectedServices:        { type: String, required: true },  // free-text list

  slaStatus: {
    type: String,
    enum: ['Within SLA', 'Outside SLA (OSLA)'],
    required: true
  },

  changeId:               { type: String, default: 'N/A' },
  existingProblemId:      { type: String, default: 'N/A' },

  incidentStatus: {
    type: String,
    enum: ['Open', 'In Progress', 'Resolved', 'Closed'],
    required: true
  },

  detailsNarrative:       { type: String, required: true },
  resolutionSummary:      { type: String, default: '' },

  // Section 2 — Business Impact
  impactLevel: {
    type: String,
    enum: ['Critical (Revenue Loss)', 'High (Major Disruption)', 'Medium (Partial Outage)', 'Low (Minor Degradation)'],
    required: true
  },
  impactAffectedServices:  { type: String, required: true },
  numberOfUsersAffected:   { type: String, default: '' },

  financialImpact: {
    type: String,
    enum: ['None', 'Minor', 'Significant', 'Severe — quantify below'],
    required: true
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

  impactDescription:       { type: String, default: '' },

  // Section 3 — Sequence of Activities
  // Stored as structured array OR raw text
  activityLog:             { type: String, required: true },
  // parsed version (optional enrichment)
  activityLogEntries: [{
    date:        { type: String, default: '' },
    time:        { type: String, default: '' },
    action:      { type: String, default: '' },
    responsible: { type: String, default: '' }
  }],

  // Section 4 — Preliminary Findings
  initialObservation:      { type: String, required: true },
  systemsChecked:          { type: String, default: '' },

  testsPerformed: [{
    type: String,
    enum: ['Ping Test', 'Reboot', 'Hardware Swap', 'Remote Diagnostics', 'On-site Inspection', 'Other']
  }],

  initialConclusion: [{
    type: String,
    enum: ['Hardware', 'Software', 'Configuration', 'Human Error', 'External (Power / Infrastructure)', 'Unknown']
  }],

  detailedFindings:        { type: String, required: true },

  // Section 5 — Root Cause
  rcaMethod: {
    type: String,
    enum: ['5-Why Analysis', 'Fishbone (Ishikawa) Diagram', 'Fault Tree Analysis', 'Other'],
    default: ''
  },

  rootCauseCategories: [{
    type: String,
    enum: ['Hardware', 'Software', 'Process / Procedure', 'Human Factor', 'Environmental', 'Third-Party / Vendor']
  }],

  contributingFactors:     { type: String, default: '' },
  rootCauseConfirmedBy:    { type: String, required: true },
  rootCauseDescription:    { type: String, required: true },

  // Section 6 — Key Challenges
  logisticsChallenges:     { type: String, enum: ['Yes', 'No'], required: true },
  securityAccessIssues:    { type: String, enum: ['Yes', 'No'], required: true },
  sparePartsAvailability:  { type: String, enum: ['Yes — delayed', 'No issues'], required: true },
  communicationIssues:     { type: String, enum: ['Yes', 'No'], required: true },
  vendorDelays:            { type: String, enum: ['Yes', 'No'], required: true },
  challengeDetails:        { type: String, default: '' },

  // Section 7 — Recommendations / Actions
  // Raw text (pipe-separated) OR structured
  recommendationText:      { type: String, required: true },
  actionItems:             [actionItemSchema],
  additionalRecommendations: { type: String, default: '' },

  // Section 8 — Photo Evidence & Attachments
  attachments:             [attachmentSchema],
  evidenceDescriptions: [{
    index:       { type: Number },
    description: { type: String, default: '' }
  }],
  additionalAttachmentTypes: [{
    type: String,
    enum: [
      'Network / Topology Diagram', 'Alarm Screenshots', 'Configuration Backup Files',
      'Equipment Replacement Records', 'Vendor / Supplier Reports',
      'Change Request Documentation', 'SLA / Penalty Calculation Sheet',
      'Post-Incident Review (PIR) Report', 'Other'
    ]
  }],
  otherAttachmentsSpec:    { type: String, default: '' },

  // Section 9 — Approvals & Sign-Off (stored in approvalChain below)

  // ── Approval workflow ─────────────────────────────────────────────────────
  approvalChain:          [approvalStepSchema],
  currentApprovalLevel:   { type: Number, default: 1 },

  overallStatus: {
    type: String,
    enum: [
      'draft',
      'submitted',             // submitted, awaiting Pascal
      'pending_review',        // Pascal's turn
      'pending_approval',      // Didier's turn
      'approved',              // fully signed off
      'rejected'
    ],
    default: 'draft'
  },

  reportStatus: {
    type: String,
    enum: ['Draft — awaiting review', 'Under Review', 'Approved — final', 'Rejected — revision required'],
    default: 'Draft — awaiting review'
  },

  approverComments:       { type: String, default: '' },

  // ── Submitter info ────────────────────────────────────────────────────────
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  preparedByName:         { type: String, required: true },
  preparedByDesignation:  { type: String, default: '' },
  preparedByDate:         { type: Date },

  reviewedByName:         { type: String, default: '' },
  reviewedByDesignation:  { type: String, default: '' },
  reviewedByDate:         { type: Date },

  approvedByName:         { type: String, default: '' },
  approvedByDesignation:  { type: String, default: '' },
  approvedByDate:         { type: Date },

  // ── Sharing ───────────────────────────────────────────────────────────────
  publicShareToken:       { type: String, default: null, index: true },
  publicShareExpiresAt:   { type: Date, default: null },

  // ── Soft delete ───────────────────────────────────────────────────────────
  isDeleted:              { type: Boolean, default: false },
  deletedAt:              { type: Date },

  // ── Notifications tracking ────────────────────────────────────────────────
  notificationsSent: {
    pascal:    { sent: Boolean, sentAt: Date, email: String },
    didier:    { sent: Boolean, sentAt: Date, email: String },
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
        const now    = new Date();
        const yr     = now.getFullYear();
        const mo     = String(now.getMonth() + 1).padStart(2, '0');
        const dy     = String(now.getDate()).padStart(2, '0');
        const rnd    = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
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










// 'use strict';
// // models/EngineeringIncidentReport.js
// // ─────────────────────────────────────────────────────────────────────────────
// // Separate model for the Grato Engineering Incident Report form.
// // Accessible ONLY to Technical department employees.
// // Approval chain: Submitter → Pascal (Reviewed By) → Didier (Approved By) → Bechem (HSE)
// // ─────────────────────────────────────────────────────────────────────────────

// const mongoose = require('mongoose');

// // ── Approval step sub-schema ──────────────────────────────────────────────────
// const approvalStepSchema = new mongoose.Schema({
//   level:        { type: Number, required: true },
//   role:         { type: String, required: true }, // 'prepared_by' | 'reviewed_by' | 'approved_by' | 'hse'
//   label:        { type: String, required: true }, // 'Prepared By' | 'Reviewed By' | 'Approved By' | 'HSE Coordinator'
//   approver: {
//     name:       { type: String, required: true },
//     email:      { type: String, required: true },
//     designation:{ type: String, default: '' },
//     userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
//   },
//   status:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
//   comments:     { type: String, default: '' },
//   actionDate:   { type: Date, default: null },
//   actionTime:   { type: String, default: '' },
//   signatureUrl: { type: String, default: '' },     // Cloudinary URL or local path
//   assignedDate: { type: Date, default: null }
// }, { _id: true });

// // ── Corrective / Preventive action item ──────────────────────────────────────
// const actionItemSchema = new mongoose.Schema({
//   action:     { type: String, required: true },
//   owner:      { type: String, default: '' },
//   targetDate: { type: String, default: '' },
//   status:     { type: String, enum: ['Open', 'Done', 'In Progress'], default: 'Open' }
// }, { _id: true });

// // ── Photo / attachment ────────────────────────────────────────────────────────
// const attachmentSchema = new mongoose.Schema({
//   name:        { type: String, required: true },
//   url:         { type: String, required: true },
//   publicId:    { type: String, default: '' },
//   mimetype:    { type: String, default: '' },
//   size:        { type: Number, default: 0 },
//   description: { type: String, default: '' },
//   uploadedAt:  { type: Date, default: Date.now }
// }, { _id: true });

// // ── Main schema ───────────────────────────────────────────────────────────────
// const engineeringIncidentReportSchema = new mongoose.Schema({

//   // Report identification
//   reportNumber:  { type: String, unique: true, sparse: true },

//   // Section 1 — Incident Description
//   incidentId:    { type: String, default: '' },
//   title:         { type: String, required: true, trim: true },
//   reportedDateTime:   { type: Date, required: true },
//   incidentStartDateTime: { type: Date, required: true },
//   resolutionDateTime: { type: Date },
//   duration:      { type: String, default: '' },   // e.g. "3 hours 20 minutes"

//   severity: {
//     type: String,
//     enum: ['P1 / Critical', 'P2 / High', 'P3 / Medium', 'P4 / Low'],
//     required: true
//   },

//   incidentTypes: [{
//     type: String,
//     enum: ['Network Outage', 'Hardware Failure', 'Software Bug', 'Security Breach',
//            'Power Failure', 'Human Error', 'Other']
//   }],

//   affectedSiteLocation:    { type: String, required: true },
//   affectedServices:        { type: String, required: true },  // free-text list

//   slaStatus: {
//     type: String,
//     enum: ['Within SLA', 'Outside SLA (OSLA)'],
//     required: true
//   },

//   changeId:               { type: String, default: 'N/A' },
//   existingProblemId:      { type: String, default: 'N/A' },

//   incidentStatus: {
//     type: String,
//     enum: ['Open', 'In Progress', 'Resolved', 'Closed'],
//     required: true
//   },

//   detailsNarrative:       { type: String, required: true },
//   resolutionSummary:      { type: String, default: '' },

//   // Section 2 — Business Impact
//   impactLevel: {
//     type: String,
//     enum: ['Critical (Revenue Loss)', 'High (Major Disruption)', 'Medium (Partial Outage)', 'Low (Minor Degradation)'],
//     required: true
//   },
//   impactAffectedServices:  { type: String, required: true },
//   numberOfUsersAffected:   { type: String, default: '' },

//   financialImpact: {
//     type: String,
//     enum: ['None', 'Minor', 'Significant', 'Severe — quantify below'],
//     required: true
//   },

//   regulatoryImpact: {
//     type: String,
//     enum: ['Yes — described below', 'No'],
//     required: true
//   },

//   reputationalRisk: {
//     type: String,
//     enum: ['High', 'Medium', 'Low', 'None'],
//     required: true
//   },

//   impactDescription:       { type: String, default: '' },

//   // Section 3 — Sequence of Activities
//   // Stored as structured array OR raw text
//   activityLog:             { type: String, required: true },
//   // parsed version (optional enrichment)
//   activityLogEntries: [{
//     date:        { type: String, default: '' },
//     time:        { type: String, default: '' },
//     action:      { type: String, default: '' },
//     responsible: { type: String, default: '' }
//   }],

//   // Section 4 — Preliminary Findings
//   initialObservation:      { type: String, required: true },
//   systemsChecked:          { type: String, default: '' },

//   testsPerformed: [{
//     type: String,
//     enum: ['Ping Test', 'Reboot', 'Hardware Swap', 'Remote Diagnostics', 'On-site Inspection', 'Other']
//   }],

//   initialConclusion: [{
//     type: String,
//     enum: ['Hardware', 'Software', 'Configuration', 'Human Error', 'External (Power / Infrastructure)', 'Unknown']
//   }],

//   detailedFindings:        { type: String, required: true },

//   // Section 5 — Root Cause
//   rcaMethod: {
//     type: String,
//     enum: ['5-Why Analysis', 'Fishbone (Ishikawa) Diagram', 'Fault Tree Analysis', 'Other'],
//     default: ''
//   },

//   rootCauseCategories: [{
//     type: String,
//     enum: ['Hardware', 'Software', 'Process / Procedure', 'Human Factor', 'Environmental', 'Third-Party / Vendor']
//   }],

//   contributingFactors:     { type: String, default: '' },
//   rootCauseConfirmedBy:    { type: String, required: true },
//   rootCauseDescription:    { type: String, required: true },

//   // Section 6 — Key Challenges
//   logisticsChallenges:     { type: String, enum: ['Yes', 'No'], required: true },
//   securityAccessIssues:    { type: String, enum: ['Yes', 'No'], required: true },
//   sparePartsAvailability:  { type: String, enum: ['Yes — delayed', 'No issues'], required: true },
//   communicationIssues:     { type: String, enum: ['Yes', 'No'], required: true },
//   vendorDelays:            { type: String, enum: ['Yes', 'No'], required: true },
//   challengeDetails:        { type: String, default: '' },

//   // Section 7 — Recommendations / Actions
//   // Raw text (pipe-separated) OR structured
//   recommendationText:      { type: String, required: true },
//   actionItems:             [actionItemSchema],
//   additionalRecommendations: { type: String, default: '' },

//   // Section 8 — Photo Evidence & Attachments
//   attachments:             [attachmentSchema],
//   evidenceDescriptions: [{
//     index:       { type: Number },
//     description: { type: String, default: '' }
//   }],
//   additionalAttachmentTypes: [{
//     type: String,
//     enum: [
//       'Network / Topology Diagram', 'Alarm Screenshots', 'Configuration Backup Files',
//       'Equipment Replacement Records', 'Vendor / Supplier Reports',
//       'Change Request Documentation', 'SLA / Penalty Calculation Sheet',
//       'Post-Incident Review (PIR) Report', 'Other'
//     ]
//   }],
//   otherAttachmentsSpec:    { type: String, default: '' },

//   // Section 9 — Approvals & Sign-Off (stored in approvalChain below)

//   // ── Approval workflow ─────────────────────────────────────────────────────
//   approvalChain:          [approvalStepSchema],
//   currentApprovalLevel:   { type: Number, default: 1 },

//   overallStatus: {
//     type: String,
//     enum: [
//       'draft',
//       'submitted',             // submitted, awaiting Pascal
//       'pending_review',        // Pascal's turn
//       'pending_approval',      // Didier's turn
//       'pending_hse',           // Bechem's turn
//       'approved',              // fully signed off
//       'rejected'
//     ],
//     default: 'draft'
//   },

//   reportStatus: {
//     type: String,
//     enum: ['Draft — awaiting review', 'Under Review', 'Approved — final', 'Rejected — revision required'],
//     default: 'Draft — awaiting review'
//   },

//   approverComments:       { type: String, default: '' },

//   // ── Submitter info ────────────────────────────────────────────────────────
//   submittedBy: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true
//   },

//   preparedByName:         { type: String, required: true },
//   preparedByDesignation:  { type: String, default: '' },
//   preparedByDate:         { type: Date },

//   reviewedByName:         { type: String, default: '' },
//   reviewedByDesignation:  { type: String, default: '' },
//   reviewedByDate:         { type: Date },

//   approvedByName:         { type: String, default: '' },
//   approvedByDesignation:  { type: String, default: '' },
//   approvedByDate:         { type: Date },

//   // ── Sharing ───────────────────────────────────────────────────────────────
//   publicShareToken:       { type: String, default: null, index: true },
//   publicShareExpiresAt:   { type: Date, default: null },

//   // ── Soft delete ───────────────────────────────────────────────────────────
//   isDeleted:              { type: Boolean, default: false },
//   deletedAt:              { type: Date },

//   // ── Notifications tracking ────────────────────────────────────────────────
//   notificationsSent: {
//     pascal:  { sent: Boolean, sentAt: Date, email: String },
//     didier:  { sent: Boolean, sentAt: Date, email: String },
//     bechem:  { sent: Boolean, sentAt: Date, email: String },
//     submitter: { sent: Boolean, sentAt: Date, email: String }
//   }

// }, {
//   timestamps: true,
//   toJSON:     { virtuals: true },
//   toObject:   { virtuals: true }
// });

// // ── Indexes ───────────────────────────────────────────────────────────────────
// engineeringIncidentReportSchema.index({ submittedBy: 1, overallStatus: 1 });
// engineeringIncidentReportSchema.index({ overallStatus: 1, createdAt: -1 });
// engineeringIncidentReportSchema.index({ severity: 1 });
// engineeringIncidentReportSchema.index({ publicShareToken: 1 });
// engineeringIncidentReportSchema.index({ 'approvalChain.approver.email': 1, 'approvalChain.status': 1 });

// // ── Pre-save: generate reportNumber ──────────────────────────────────────────
// engineeringIncidentReportSchema.pre('save', async function (next) {
//   try {
//     if (!this.reportNumber) {
//       let attempts = 0;
//       while (attempts < 10) {
//         const now    = new Date();
//         const yr     = now.getFullYear();
//         const mo     = String(now.getMonth() + 1).padStart(2, '0');
//         const dy     = String(now.getDate()).padStart(2, '0');
//         const rnd    = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
//         const candidate = `EIR${yr}${mo}${dy}-${rnd}`;
//         const exists = await this.constructor.findOne({ reportNumber: candidate, _id: { $ne: this._id } });
//         if (!exists) { this.reportNumber = candidate; break; }
//         attempts++;
//       }
//     }
//     next();
//   } catch (err) { next(err); }
// });

// // ── Virtual ───────────────────────────────────────────────────────────────────
// engineeringIncidentReportSchema.virtual('displayId').get(function () {
//   return this.reportNumber || `EIR-${this._id.toString().slice(-6).toUpperCase()}`;
// });

// module.exports = mongoose.model('EngineeringIncidentReport', engineeringIncidentReportSchema);


