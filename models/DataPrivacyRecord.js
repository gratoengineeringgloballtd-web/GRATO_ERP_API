const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');


// models/DataPrivacyRecord.js  — GDPR/NDPA: processing register, DPIA, breaches, SARs
// ─────────────────────────────────────────────────────────────────────────────
const dataProcessingSchema = new mongoose.Schema({
  processingRef:    { type: String, unique: true, trim: true },
  processingActivity: { type: String, required: true, trim: true },
  purpose:          { type: String, required: true, trim: true },
  legalBasis: {
    type: String,
    required: true,
    enum: ['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests']
  },
  dataCategories:   [{ type: String, trim: true }],  // personal, special category, etc.
  dataSubjects:     [{ type: String, trim: true }],  // employees, customers, etc.
  recipients:       [{ type: String, trim: true }],  // third parties data is shared with
  retentionPeriod:  { type: String, trim: true, default: '' },
  thirdCountryTransfer: { type: Boolean, default: false },
  transferSafeguards:   { type: String, trim: true, default: '' },
  dpiaRequired:     { type: Boolean, default: false },
  dpiaRef:          { type: String, trim: true, default: '' },
  owner:            { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status:           { type: String, enum: ['active', 'under_review', 'discontinued'], default: 'active' },
  lastReviewed:     { type: Date },
  nextReview:       { type: Date },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true, timestamps: true });
 
const dpiaSchema = new mongoose.Schema({
  dpiaRef:          { type: String, unique: true, trim: true },
  processingRef:    { type: String, trim: true },
  title:            { type: String, required: true, trim: true },
  description:      { type: String, trim: true, default: '' },
  risksIdentified:  [{ risk: String, likelihood: String, impact: String, mitigation: String }],
  necessityTest:    { type: String, trim: true, default: '' },
  proportionalityTest: { type: String, trim: true, default: '' },
  dpoConsulted:     { type: Boolean, default: false },
  supervisoryAuthorityConsulted: { type: Boolean, default: false },
  outcome:          { type: String, enum: ['approved', 'approved_with_conditions', 'rejected', 'pending'], default: 'pending' },
  conditions:       { type: String, trim: true, default: '' },
  reviewedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt:       { type: Date },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true, timestamps: true });
 
const dataBreachSchema = new mongoose.Schema({
  breachRef:        { type: String, unique: true, trim: true },
  title:            { type: String, required: true, trim: true },
  description:      { type: String, required: true, trim: true },
  discoveredAt:     { type: Date, required: true },
  occurredAt:       { type: Date },
  dataCategories:   [{ type: String, trim: true }],
  estimatedSubjects:{ type: Number, default: 0 },
  breachType:       { type: String, enum: ['confidentiality', 'integrity', 'availability'], required: true },
  severity:         { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
  // 72-hour notification clock
  notificationRequired: { type: Boolean, default: false },
  notificationDeadline: { type: Date },
  notifiedAuthority:    { type: Boolean, default: false },
  notifiedAt:           { type: Date },
  authorityRef:         { type: String, trim: true, default: '' },
  // Subject notification
  subjectsNotified:     { type: Boolean, default: false },
  subjectsNotifiedAt:   { type: Date },
  containmentActions:   [{ type: String, trim: true }],
  status:               { type: String, enum: ['open', 'contained', 'notified', 'closed'], default: 'open' },
  closedAt:             { type: Date },
  createdBy:            { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true, timestamps: true });
 
const sarSchema = new mongoose.Schema({
  sarRef:           { type: String, unique: true, trim: true },
  requestType:      { type: String, enum: ['access', 'rectification', 'erasure', 'portability', 'restriction', 'objection'], required: true },
  subjectName:      { type: String, trim: true },
  subjectEmail:     { type: String, trim: true },
  receivedAt:       { type: Date, required: true, default: Date.now },
  // Legal deadline: 30 days (extendable to 90)
  deadline:         { type: Date },
  extended:         { type: Boolean, default: false },
  extensionReason:  { type: String, trim: true, default: '' },
  identityVerified: { type: Boolean, default: false },
  assignedTo:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  responseNotes:    { type: String, trim: true, default: '' },
  status:           { type: String, enum: ['received', 'in_progress', 'completed', 'refused'], default: 'received' },
  completedAt:      { type: Date },
  refusalReason:    { type: String, trim: true, default: '' },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true, timestamps: true });
 
const dataPrivacyRecordSchema = new mongoose.Schema({
  // Processing register
  processingActivities: [dataProcessingSchema],
  // DPIAs
  dpias:               [dpiaSchema],
  // Breaches
  breaches:            [dataBreachSchema],
  // Subject access requests
  sars:                [sarSchema],
  // DPO
  dpoName:             { type: String, trim: true, default: '' },
  dpoEmail:            { type: String, trim: true, default: '' },
  // Organisation
  organisationName:    { type: String, trim: true, default: 'Grato Engineering' },
  lastUpdatedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
 
module.exports = mongoose.model('DataPrivacyRecord', dataPrivacyRecordSchema);
 