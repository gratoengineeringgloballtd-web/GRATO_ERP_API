const mongoose = require('mongoose');

// Accounting register of fixed assets (cost, depreciation schedule, journal links).
// Separate from FixedAsset.js, which tracks physical/IT assets (tags, assignment, maintenance).
const depLineSchema = new mongoose.Schema({
  sequence:  { type: Number, required: true },
  date:      { type: Date, required: true },
  amount:    { type: Number, required: true },
  bookValue: { type: Number, required: true },
  isPosted:  { type: Boolean, default: false },
  entryId:   { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null }
}, { _id: false });

const financialAssetSchema = new mongoose.Schema({
  name:               { type: String, required: true, trim: true },
  description:        { type: String, trim: true, default: '' },
  acquisitionDate:    { type: Date, required: true },
  acquisitionValue:   { type: Number, required: true, min: 0 },
  residualValue:      { type: Number, default: 0, min: 0 },
  usefulLifeMonths:   { type: Number, required: true, min: 1 },
  depreciationMethod: { type: String, enum: ['straight-line', 'declining-balance'], default: 'straight-line' },
  status:             { type: String, enum: ['active', 'fully_depreciated', 'disposed'], default: 'active' },
  accountCodes: {
    assetAccount:        { type: String, default: '244' },
    depreciationAccount: { type: String, default: '681' },
    accumulatedAccount:  { type: String, default: '284' }
  },
  paidFrom:           { type: String, default: '521' },       // credit side of the acquisition entry
  accumulatedDepreciation: { type: Number, default: 0 },
  depreciationLines:  { type: [depLineSchema], default: [] },
  acquisitionEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  createdBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

financialAssetSchema.virtual('currentBookValue').get(function () {
  return Math.round((this.acquisitionValue - this.accumulatedDepreciation) * 100) / 100;
});
financialAssetSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.FinancialAsset || mongoose.model('FinancialAsset', financialAssetSchema);
