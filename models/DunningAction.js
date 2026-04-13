const mongoose = require('mongoose');

const dunningActionSchema = new mongoose.Schema({
  invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  customerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  customerName:  { type: String, trim: true },
  customerEmail: { type: String, trim: true },
  level:         { type: Number, required: true },               // 1=reminder, 2=warning, 3=final
  daysOverdue:   { type: Number, required: true },
  amountDue:     { type: Number, required: true },
  action:        { type: String, enum: ['email','phone','legal'], default: 'email' },
  status:        { type: String, enum: ['pending','sent','responded','ignored'], default: 'pending' },
  sentAt:        { type: Date, default: null },
  responseAt:    { type: Date, default: null },
  notes:         { type: String, trim: true, default: '' },
  sentBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
 
dunningActionSchema.index({ invoiceId: 1 });
dunningActionSchema.index({ status: 1, level: 1 });
 
module.exports = mongoose.model('DunningAction', dunningActionSchema);