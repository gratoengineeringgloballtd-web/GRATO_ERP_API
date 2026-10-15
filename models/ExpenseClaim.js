const mongoose = require('mongoose');

const CATEGORIES = ['transport', 'accommodation', 'meals', 'per_diem', 'fuel', 'communication', 'supplies', 'training', 'other'];

const itemSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  category: { type: String, enum: CATEGORIES, required: true },
  description: { type: String, trim: true, required: true },
  days: { type: Number, min: 0 },   // per diem only
  rate: { type: Number, min: 0 },   // per diem only, entered on the claim
  amount: { type: Number, required: true, min: 0 }
}, { _id: true });

const ExpenseClaimSchema = new mongoose.Schema({
  claimNumber: { type: String, unique: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employeeName: String,
  employeeEmail: String,
  department: String,
  type: { type: String, enum: ['expense', 'mission'], default: 'expense' },
  title: { type: String, required: true, trim: true },
  mission: {
    destination: String,
    purpose: String,
    startDate: Date,
    endDate: Date
  },
  items: [itemSchema],
  total: { type: Number, default: 0 },

  // Cash already given to the employee for this claim (advance or card spend to reconcile)
  advance: {
    reference: { type: String, trim: true },
    amount: { type: Number, default: 0, min: 0 }
  },
  reimbursementDue: { type: Number, default: 0 },   // company owes employee
  surplusDue: { type: Number, default: 0 },         // employee owes company
  reimbursementPaid: { type: Boolean, default: false },
  surplusReturned: { type: Boolean, default: false },

  receipts: [{
    name: String, url: String, publicId: String, size: Number, mimetype: String,
    uploadedAt: { type: Date, default: Date.now }
  }],

  status: {
    type: String,
    enum: ['draft', 'pending_manager', 'pending_finance', 'approved', 'rejected', 'settled'],
    default: 'draft'
  },
  manager: { email: String, name: String },
  rejectionReason: String,
  rejectedAtStage: String,

  history: [{
    action: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    comment: String,
    at: { type: Date, default: Date.now }
  }],

  accrualEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  paymentEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  surplusEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' }
}, { timestamps: true });

ExpenseClaimSchema.index({ employee: 1, createdAt: -1 });
ExpenseClaimSchema.index({ status: 1 });
ExpenseClaimSchema.index({ 'manager.email': 1, status: 1 });

ExpenseClaimSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model('ExpenseClaim', ExpenseClaimSchema);
