// ── models/CreditNote.js ─────────────────────────────────────────────────────
const creditNoteSchema = new mongoose.Schema({
  creditNoteNumber: { type: String, required: true, unique: true, trim: true },
  type:             { type: String, enum: ['customer','supplier'], required: true },
  // for customer credit notes
  invoiceId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
  customerId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  customerDetails:  { name: String, email: String },
  // for supplier credit notes
  supplierInvoiceId:{ type: mongoose.Schema.Types.ObjectId, ref: 'SupplierInvoice', default: null },
  supplierId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplierDetails:  { name: String, email: String },
  amount:           { type: Number, required: true, min: 0.01 },
  taxAmount:        { type: Number, default: 0 },
  reason:           { type: String, required: true, trim: true },
  creditNoteDate:   { type: Date, required: true, default: Date.now },
  status:           { type: String, enum: ['draft','posted','reconciled'], default: 'draft' },
  reconciled:       { type: Boolean, default: false },
  reconciledInvoiceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  accountingAudit: {
    isPosted:    { type: Boolean, default: false },
    postedAt:    Date,
    entryId:     { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    entryNumber: String,
    sourceType:  String
  }
}, { timestamps: true });
 
module.exports = mongoose.model('CreditNote', creditNoteSchema);