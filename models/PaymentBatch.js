const mongoose = require('mongoose');

const paymentBatchSchema = new mongoose.Schema({
  batchNumber:    { type: String, required: true, unique: true },
  type:           { type: String, enum: ['receipt','disbursement'], required: true },
  paymentMethod:  { type: String, enum: ['bank_transfer','cheque','eft'], required: true },
  bankAccount:    { type: String, default: '1010' },
  batchDate:      { type: Date, required: true, default: Date.now },
  paymentIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],
  totalAmount:    { type: Number, default: 0 },
  status:         { type: String, enum: ['draft','validated','sent','done'], default: 'draft' },
  reference:      { type: String, trim: true, default: '' },
  createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
 
module.exports = mongoose.model('PaymentBatch', paymentBatchSchema);