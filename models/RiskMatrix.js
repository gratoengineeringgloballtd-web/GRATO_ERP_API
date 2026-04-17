const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');


// models/RiskMatrix.js  — Risk register with heat map scoring and appetite rules
// ─────────────────────────────────────────────────────────────────────────────
const riskMatrixSchema = new mongoose.Schema({
  riskRef:        { type: String, unique: true, trim: true },
  title:          { type: String, required: true, trim: true },
  description:    { type: String, trim: true, default: '' },
  category:       { type: String, enum: ['strategic', 'operational', 'financial', 'compliance', 'reputational', 'hsse', 'technology', 'third_party'], required: true },
  owner:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  module:         { type: String, enum: ['legal', 'contract', 'regulatory', 'intellectual_property', 'hsse', 'general'], default: 'general' },
 
  // Inherent risk (before controls)
  inherentLikelihood:  { type: Number, min: 1, max: 5, required: true },
  inherentImpact:      { type: Number, min: 1, max: 5, required: true },
  inherentScore:       { type: Number, default: 0 },  // likelihood × impact
  inherentRating:      { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
 
  // Controls in place
  controls: [{
    description:     { type: String, required: true, trim: true },
    controlType:     { type: String, enum: ['preventive', 'detective', 'corrective'], default: 'preventive' },
    effectiveness:   { type: String, enum: ['effective', 'partially_effective', 'ineffective'], default: 'partially_effective' },
    owner:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  }],
 
  // Residual risk (after controls)
  residualLikelihood:  { type: Number, min: 1, max: 5 },
  residualImpact:      { type: Number, min: 1, max: 5 },
  residualScore:       { type: Number, default: 0 },
  residualRating:      { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
 
  // Risk appetite — is residual within tolerance?
  riskAppetite:        { type: String, enum: ['averse', 'minimal', 'cautious', 'open', 'hungry'], default: 'cautious' },
  withinAppetite:      { type: Boolean, default: true },
  appetiteBreachReason:{ type: String, trim: true, default: '' },
 
  // Treatment
  treatment:           { type: String, enum: ['accept', 'avoid', 'transfer', 'mitigate'], default: 'mitigate' },
  treatmentPlan:       { type: String, trim: true, default: '' },
  treatmentDueDate:    { type: Date },
  treatmentStatus:     { type: String, enum: ['not_started', 'in_progress', 'completed'], default: 'not_started' },
 
  // Review
  lastReviewDate:      { type: Date },
  nextReviewDue:       { type: Date },
  reviewFrequencyDays: { type: Number, default: 90 },
 
  status: { type: String, enum: ['open', 'under_treatment', 'accepted', 'closed'], default: 'open' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
 
riskMatrixSchema.index({ category: 1, residualRating: 1 });
riskMatrixSchema.index({ owner: 1, status: 1 });
 
const RATING_THRESHOLDS = { low: 4, medium: 9, high: 16, critical: 25 };
function scoreToRating(score) {
  if (score <= 4)  return 'low';
  if (score <= 9)  return 'medium';
  if (score <= 16) return 'high';
  return 'critical';
}
 
riskMatrixSchema.pre('save', async function (next) {
  if (this.isNew && !this.riskRef) {
    const Counter = require('./Counter');
    const year   = new Date().getFullYear();
    const counter = await Counter.findByIdAndUpdate(`RM-${year}`, { $inc: { seq: 1 } }, { upsert: true, new: true });
    this.riskRef = `RM-${year}-${String(counter.seq).padStart(4, '0')}`;
  }
  this.inherentScore  = (this.inherentLikelihood || 1) * (this.inherentImpact || 1);
  this.inherentRating = scoreToRating(this.inherentScore);
  if (this.residualLikelihood && this.residualImpact) {
    this.residualScore  = this.residualLikelihood * this.residualImpact;
    this.residualRating = scoreToRating(this.residualScore);
  }
  // Check appetite — cautious appetite = max residual 'medium'
  const appetiteMaxScore = { averse: 4, minimal: 4, cautious: 9, open: 16, hungry: 25 };
  const maxAllowed = appetiteMaxScore[this.riskAppetite] || 9;
  this.withinAppetite = (this.residualScore || this.inherentScore) <= maxAllowed;
  next();
});
 
module.exports = mongoose.model('RiskMatrix', riskMatrixSchema);
 