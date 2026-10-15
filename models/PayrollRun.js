const mongoose = require('mongoose');

const lineSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  position: String,
  department: String,
  paymentMethod: String,
  bankName: String,
  bankAccount: String,
  cnpsNumber: String,
  adjustments: [{
    label: { type: String, required: true },
    type: { type: String, enum: ['earning', 'deduction'], default: 'earning' },
    amount: { type: Number, required: true, min: 0 }
  }],
  // snapshot of the profile used for the calculation
  profile: {
    baseSalary: Number,
    allowances: [{ name: String, amount: Number, taxable: Boolean, cnpsable: Boolean }],
    fixedDeductions: [{ name: String, amount: Number }],
    exemptCnps: Boolean,
    exemptTax: Boolean
  },
  result: mongoose.Schema.Types.Mixed
}, { _id: true });

const PayrollRunSchema = new mongoose.Schema({
  runNumber: { type: String, unique: true },
  period: {
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true }
  },
  title: String,
  status: {
    type: String,
    enum: ['draft', 'pending_finance', 'pending_ceo', 'approved', 'rejected', 'paid'],
    default: 'draft'
  },
  lines: [lineSchema],
  totals: mongoose.Schema.Types.Mixed,
  ratesSnapshot: mongoose.Schema.Types.Mixed,
  preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  history: [{
    action: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    comment: String,
    at: { type: Date, default: Date.now }
  }],
  rejectionReason: String,
  accrualEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  paymentEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  paidAt: Date,
  paymentAccountCode: String
}, { timestamps: true });

PayrollRunSchema.index({ 'period.year': 1, 'period.month': 1 });
PayrollRunSchema.index({ status: 1 });
PayrollRunSchema.index({ 'lines.employee': 1 });

module.exports = mongoose.model('PayrollRun', PayrollRunSchema);
