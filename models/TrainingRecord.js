const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

// models/TrainingRecord.js  — Training register + certification tracking + competency matrix
// ─────────────────────────────────────────────────────────────────────────────
const certificationSchema = new mongoose.Schema({
  certName:       { type: String, required: true, trim: true },
  issuingBody:    { type: String, trim: true, default: '' },
  certNumber:     { type: String, trim: true, default: '' },
  issuedDate:     { type: Date },
  expiryDate:     { type: Date },
  isExpired:      { type: Boolean, default: false },
  documentUrl:    { type: String, trim: true, default: '' },
  renewalReminderSent: { type: Boolean, default: false }
}, { _id: true });
 
const trainingRecordSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:       { type: String, trim: true },
  department:     { type: String, trim: true },
  role:           { type: String, trim: true },
 
  // Training sessions attended
  trainingSessions: [{
    title:          { type: String, required: true, trim: true },
    trainingType:   { type: String, enum: ['hsse', 'compliance', 'technical', 'leadership', 'regulatory', 'induction', 'other'], required: true },
    provider:       { type: String, trim: true, default: '' },
    deliveryMethod: { type: String, enum: ['classroom', 'online', 'on_the_job', 'external', 'webinar'], default: 'classroom' },
    trainingDate:   { type: Date, required: true },
    durationHours:  { type: Number, default: 0 },
    outcome:        { type: String, enum: ['passed', 'failed', 'attended', 'incomplete'], default: 'attended' },
    score:          { type: Number, default: null },
    expiryDate:     { type: Date },
    documentUrl:    { type: String, trim: true, default: '' },
    mandatory:      { type: Boolean, default: false }
  }],
 
  // Certifications held
  certifications:  [certificationSchema],
 
  // Competency matrix — skills assessed against required level
  competencies: [{
    competency:     { type: String, required: true, trim: true },
    category:       { type: String, enum: ['technical', 'hsse', 'regulatory', 'leadership', 'soft_skills'], default: 'technical' },
    requiredLevel:  { type: Number, min: 1, max: 5, default: 3 },
    currentLevel:   { type: Number, min: 0, max: 5, default: 0 },
    gap:            { type: Number, default: 0 },
    developmentPlan:{ type: String, trim: true, default: '' },
    assessedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assessedAt:     { type: Date }
  }],
 
  // Gap summary
  totalCompetencies:   { type: Number, default: 0 },
  competenciesWithGaps:{ type: Number, default: 0 },
  averageGapScore:     { type: Number, default: 0 },
 
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
 
trainingRecordSchema.index({ userId: 1 });
trainingRecordSchema.index({ department: 1 });
 
trainingRecordSchema.pre('save', function (next) {
  // Recalculate competency gaps
  if (this.competencies && this.competencies.length > 0) {
    this.totalCompetencies = this.competencies.length;
    let gapSum = 0;
    let gapCount = 0;
    this.competencies.forEach(c => {
      c.gap = Math.max(0, c.requiredLevel - c.currentLevel);
      if (c.gap > 0) gapCount++;
      gapSum += c.gap;
    });
    this.competenciesWithGaps = gapCount;
    this.averageGapScore = this.competencies.length > 0 ? Math.round((gapSum / this.competencies.length) * 10) / 10 : 0;
  }
  // Flag expired certifications
  const now = new Date();
  (this.certifications || []).forEach(cert => {
    cert.isExpired = !!(cert.expiryDate && new Date(cert.expiryDate) < now);
  });
  next();
});
 
module.exports = mongoose.model('TrainingRecord', trainingRecordSchema);
 