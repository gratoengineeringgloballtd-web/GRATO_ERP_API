const mongoose = require('mongoose');

const analyticLineSchema = new mongoose.Schema({
  analyticAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnalyticAccount', required: true },
  journalEntryId:    { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
  date:              { type: Date, required: true },
  name:              { type: String, trim: true, default: '' },
  amount:            { type: Number, required: true },                  // positive = cost, negative = revenue
  unitAmount:        { type: Number, default: 0 },
  accountCode:       { type: String, trim: true, default: '' },
  sourceType:        { type: String, trim: true, default: '' },
  sourceId:          { type: mongoose.Schema.Types.ObjectId, default: null }
}, { timestamps: true });
 
analyticLineSchema.index({ analyticAccountId: 1, date: -1 });
 
module.exports = mongoose.model('AnalyticLine', analyticLineSchema);
 