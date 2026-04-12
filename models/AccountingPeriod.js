const mongoose = require('mongoose');

const accountingPeriodSchema = new mongoose.Schema({
  year: {
    type: Number,
    required: true,
    min: 2000,
    max: 3000
  },
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open'
  },
  closedAt: {
    type: Date,
    default: null
  },
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

accountingPeriodSchema.index({ year: 1, month: 1 }, { unique: true });
accountingPeriodSchema.index({ status: 1, year: 1, month: 1 });

module.exports = mongoose.model('AccountingPeriod', accountingPeriodSchema);
