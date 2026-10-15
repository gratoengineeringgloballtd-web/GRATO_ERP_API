const mongoose = require('mongoose');
const { DEFAULT_RATES } = require('../services/payrollEngine');

const bracketSchema = new mongoose.Schema({
  upTo: { type: Number, default: null },
  rate: { type: Number, required: true, min: 0 }
}, { _id: false });

const PayrollRateSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  cnpsCeiling: { type: Number, default: DEFAULT_RATES.cnpsCeiling },
  employeePensionRate: { type: Number, default: DEFAULT_RATES.employeePensionRate },
  employerPensionRate: { type: Number, default: DEFAULT_RATES.employerPensionRate },
  familyAllowanceRate: { type: Number, default: DEFAULT_RATES.familyAllowanceRate },
  workAccidentRate: { type: Number, default: DEFAULT_RATES.workAccidentRate },
  cfcEmployeeRate: { type: Number, default: DEFAULT_RATES.cfcEmployeeRate },
  cfcEmployerRate: { type: Number, default: DEFAULT_RATES.cfcEmployerRate },
  fneEmployerRate: { type: Number, default: DEFAULT_RATES.fneEmployerRate },
  cacRate: { type: Number, default: DEFAULT_RATES.cacRate },
  professionalAbatementRate: { type: Number, default: DEFAULT_RATES.professionalAbatementRate },
  annualFixedAbatement: { type: Number, default: DEFAULT_RATES.annualFixedAbatement },
  irppBrackets: { type: [bracketSchema], default: () => DEFAULT_RATES.irppBrackets.map((b) => ({ ...b })) },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('PayrollRate', PayrollRateSchema);
