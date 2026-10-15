const mongoose = require('mongoose');

const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const DEFAULT_PROBABILITY = { new: 10, qualified: 30, proposal: 50, negotiation: 70, won: 100, lost: 0 };

const leadSchema = new mongoose.Schema({
  leadNumber:   { type: String, unique: true, index: true },
  company:      { type: String, required: true, trim: true },
  contactName:  { type: String, trim: true, default: '' },
  email:        { type: String, trim: true, lowercase: true, default: '' },
  phone:        { type: String, trim: true, default: '' },
  source:       { type: String, enum: ['referral', 'website', 'tender', 'cold_call', 'event', 'existing_customer', 'other'], default: 'other' },
  industry:     { type: String, trim: true, default: '' },
  description:  { type: String, trim: true, default: '' },
  estimatedValue: { type: Number, default: 0, min: 0 },    // XAF
  stage:        { type: String, enum: STAGES, default: 'new', index: true },
  probability:  { type: Number, min: 0, max: 100, default: 10 },
  expectedCloseDate: { type: Date, default: null },
  nextFollowUp: { type: Date, default: null },
  owner:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  customer:     { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  lostReason:   { type: String, trim: true, default: '' },
  wonAt:        { type: Date, default: null },
  closedAt:     { type: Date, default: null },
  stageHistory: [{ _id: false, stage: String, at: { type: Date, default: Date.now }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

leadSchema.index({ company: 'text', contactName: 'text', email: 'text' });

module.exports = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
module.exports.STAGES = STAGES;
module.exports.DEFAULT_PROBABILITY = DEFAULT_PROBABILITY;
