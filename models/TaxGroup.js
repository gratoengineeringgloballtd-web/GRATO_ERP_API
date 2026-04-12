const mongoose = require('mongoose');
 
const taxLineSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  rate:          { type: Number, required: true, min: 0 },          // percentage e.g. 19.25
  taxType:       { type: String, enum: ['vat','wht','other'], default: 'vat' },
  accountCode:   { type: String, required: true, trim: true },      // e.g. "2200"
  isInclusive:   { type: Boolean, default: false },                 // rate inclusive in price?
  sequence:      { type: Number, default: 10 }
}, { _id: false });
 
const taxGroupSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true, unique: true },
  description:   { type: String, trim: true, default: '' },
  taxes:         { type: [taxLineSchema], default: [] },
  isActive:      { type: Boolean, default: true }
}, { timestamps: true });
 
module.exports = mongoose.model('TaxGroup', taxGroupSchema);