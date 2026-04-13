const mongoose = require('mongoose');

const fiscalYearSchema = new mongoose.Schema({
  year:            { type: Number, required: true, unique: true },
  startDate:       { type: Date, required: true },
  endDate:         { type: Date, required: true },
  status:          { type: String, enum: ['open','locked','closed'], default: 'open' },
  closingEntryId:  { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  retainedEarningsAccount: { type: String, default: '3100' },    // new equity account
  lockedAt:        { type: Date, default: null },
  closedAt:        { type: Date, default: null },
  closedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  notes:           { type: String, trim: true, default: '' }
}, { timestamps: true });
 
module.exports = mongoose.model('FiscalYear', fiscalYearSchema);