const mongoose = require('mongoose');

const allowanceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },
  taxable: { type: Boolean, default: true },
  cnpsable: { type: Boolean, default: true }
}, { _id: false });

const deductionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 }
}, { _id: false });

const SalaryProfileSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  baseSalary: { type: Number, required: true, min: 0 },
  allowances: [allowanceSchema],
  fixedDeductions: [deductionSchema],
  exemptCnps: { type: Boolean, default: false },
  exemptTax: { type: Boolean, default: false },
  cnpsNumber: { type: String, trim: true },
  taxPayerNumber: { type: String, trim: true },
  paymentMethod: { type: String, enum: ['bank', 'cash', 'mobile_money'], default: 'bank' },
  bankName: { type: String, trim: true },
  bankAccount: { type: String, trim: true },
  hireDate: Date,
  status: { type: String, enum: ['active', 'suspended', 'terminated'], default: 'active' },
  notes: { type: String, trim: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

SalaryProfileSchema.index({ status: 1 });

module.exports = mongoose.model('SalaryProfile', SalaryProfileSchema);
