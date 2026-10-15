const mongoose = require('mongoose');

const RetentionRuleSchema = new mongoose.Schema({
  category: { type: String, required: true, unique: true },
  years: { type: Number, required: true, min: 0 },   // 0 = keep indefinitely
  note: String,
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Starting points only. Legal retention periods must be confirmed by the company's counsel/accountant.
RetentionRuleSchema.statics.DEFAULTS = [
  { category: 'invoice', years: 10, note: 'Accounting records (OHADA commercial/accounting retention)' },
  { category: 'contract', years: 10, note: 'From end of contract' },
  { category: 'payslip', years: 5 },
  { category: 'id_document', years: 5 },
  { category: 'certificate', years: 5 },
  { category: 'licence', years: 5 },
  { category: 'insurance', years: 5 },
  { category: 'medical', years: 5 },
  { category: 'disciplinary', years: 5 },
  { category: 'report', years: 5 },
  { category: 'policy', years: 5 },
  { category: 'letter', years: 3 },
  { category: 'other', years: 3 }
];

module.exports = mongoose.model('RetentionRule', RetentionRuleSchema);
