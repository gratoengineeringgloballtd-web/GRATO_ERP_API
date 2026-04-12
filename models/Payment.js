// models/Payment.js
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  paymentNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  type: {
    type: String,
    enum: ['receipt', 'disbursement'],
    required: true
  },
  // For receipts — customer invoice being paid
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null
  },
  // For disbursements — supplier invoice being paid
  supplierInvoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupplierInvoice',
    default: null
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null
  },
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    default: null
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  paymentDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'cash', 'cheque', 'mobile_money'],
    required: true
  },
  bankAccount: {
    type: String,
    enum: ['1000', '1010'],  // Cash on Hand or Bank Account
    default: '1010'
  },
  reference: {
    type: String,
    trim: true,
    default: ''
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  accountingAudit: {
    isPosted: { type: Boolean, default: false },
    postedAt: Date,
    entryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
    entryNumber: String,
    sourceType: String
  }
}, { timestamps: true });

paymentSchema.index({ type: 1, paymentDate: -1 });
paymentSchema.index({ invoiceId: 1 });
paymentSchema.index({ supplierInvoiceId: 1 });

module.exports = mongoose.model('Payment', paymentSchema);