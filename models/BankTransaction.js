// models/BankTransaction.js
const mongoose = require('mongoose');

const bankTransactionSchema = new mongoose.Schema({
  accountCode: {
    type: String,
    enum: ['1000', '1010'],
    required: true,
    default: '1010'
  },
  date: { type: Date, required: true },
  description: { type: String, required: true, trim: true },
  amount: { type: Number, required: true },
  type: {
    type: String,
    enum: ['debit', 'credit'],
    required: true
  },
  reference: { type: String, trim: true, default: '' },
  isReconciled: { type: Boolean, default: false },
  matchedEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  matchedPaymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    default: null
  },
  reconciledAt: { type: Date, default: null },
  reconciledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  importBatch: { type: String, trim: true, default: '' }
}, { timestamps: true });

bankTransactionSchema.index({ accountCode: 1, date: -1 });
bankTransactionSchema.index({ isReconciled: 1 });
bankTransactionSchema.index({ importBatch: 1 });

module.exports = mongoose.model('BankTransaction', bankTransactionSchema);