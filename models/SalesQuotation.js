const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true },
  quantity:    { type: Number, required: true, min: 0.0001 },
  unitPrice:   { type: Number, required: true, min: 0 },
  taxRate:     { type: Number, default: 19.25, min: 0, max: 100 }   // percent
}, { _id: false });

const quotationSchema = new mongoose.Schema({
  quoteNumber:   { type: String, unique: true, index: true },
  lead:          { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
  customer:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  customerName:  { type: String, required: true, trim: true },
  customerEmail: { type: String, trim: true, lowercase: true, default: '' },
  customerAddress: { type: String, trim: true, default: '' },
  subject:       { type: String, required: true, trim: true },
  items:         { type: [itemSchema], validate: [(v) => v.length > 0, 'At least one line item is required'] },
  subtotal:      { type: Number, default: 0 },
  taxAmount:     { type: Number, default: 0 },
  total:         { type: Number, default: 0 },
  currency:      { type: String, default: 'XAF' },
  validUntil:    { type: Date, required: true },
  status:        { type: String, enum: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'invoiced'], default: 'draft', index: true },
  terms:         { type: String, default: 'Payment within 30 days of invoice. Prices in XAF, VAT included where shown.' },
  notes:         { type: String, default: '' },
  owner:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sentAt:        { type: Date, default: null },
  decidedAt:     { type: Date, default: null },
  rejectionReason: { type: String, default: '' },
  invoiceReference: { type: String, default: '' },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

quotationSchema.pre('validate', function (next) {
  const r2 = (v) => Math.round(v * 100) / 100;
  let sub = 0, tax = 0;
  (this.items || []).forEach((i) => {
    const line = i.quantity * i.unitPrice;
    sub += line; tax += line * (i.taxRate || 0) / 100;
  });
  this.subtotal = r2(sub); this.taxAmount = r2(tax); this.total = r2(sub + tax);
  next();
});

module.exports = mongoose.models.SalesQuotation || mongoose.model('SalesQuotation', quotationSchema);
