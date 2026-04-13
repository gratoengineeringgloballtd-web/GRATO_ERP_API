const mongoose = require('mongoose');

// ── models/Budget.js ─────────────────────────────────────────────────────────
const budgetLineSchema = new mongoose.Schema({
  accountCode:       { type: String, required: true, trim: true },
  analyticAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnalyticAccount', default: null },
  plannedAmount:     { type: Number, required: true },
  sequence:          { type: Number, default: 10 }
}, { _id: false });
 
const budgetSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  fiscalYear: { type: Number, required: true },
  startDate:  { type: Date, required: true },
  endDate:    { type: Date, required: true },
  status:     { type: String, enum: ['draft','confirmed','done'], default: 'draft' },
  lines:      { type: [budgetLineSchema], default: [] },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
 
module.exports = mongoose.model('Budget', budgetSchema);
 
