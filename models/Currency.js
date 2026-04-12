const mongoose = require('mongoose');

const currencySchema = new mongoose.Schema({
  code:          { type: String, required: true, unique: true, uppercase: true, trim: true }, // USD, EUR, XAF
  name:          { type: String, required: true, trim: true },
  symbol:        { type: String, required: true, trim: true },
  rateToBase:    { type: Number, required: true, default: 1 },      // 1 unit of this = X base currency
  isBase:        { type: Boolean, default: false },
  isActive:      { type: Boolean, default: true },
  decimalPlaces: { type: Number, default: 2 },
  updatedAt:     { type: Date, default: Date.now }
}, { timestamps: true });
 
module.exports = mongoose.model('Currency', currencySchema);