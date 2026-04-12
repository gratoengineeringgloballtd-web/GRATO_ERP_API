const mongoose = require('mongoose');

const journalLineSchema = new mongoose.Schema({
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  debit: {
    type: Number,
    default: 0,
    min: 0
  },
  credit: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const journalEntrySchema = new mongoose.Schema({
  entryNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  sourceType: {
    type: String,
    enum: ['manual', 'cash_request_disbursement', 'supplier_invoice', 'customer_invoice', 'salary_payment', 'reversal'],
    default: 'manual'
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  lines: {
    type: [journalLineSchema],
    validate: {
      validator: function(lines) {
        return Array.isArray(lines) && lines.length >= 2;
      },
      message: 'Journal entry must contain at least 2 lines'
    }
  },
  totalDebit: {
    type: Number,
    required: true,
    min: 0
  },
  totalCredit: {
    type: Number,
    required: true,
    min: 0
  },
  // status: {
  //   type: String,
  //   enum: ['posted', 'void'],
  //   default: 'posted'
  // },
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isReversal: {
    type: Boolean,
    default: false
  },
  reversalOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  reversalReason: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'posted', 'void'],
    default: 'posted'   // system entries still default to posted
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  submittedAt: { type: Date, default: null },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: { type: Date, default: null },
  reviewComments: { type: String, trim: true, default: '' },
 
}, {
  timestamps: true
});

journalEntrySchema.pre('validate', function(next) {
  const totalDebit = (this.lines || []).reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = (this.lines || []).reduce((sum, line) => sum + (Number(line.credit) || 0), 0);

  this.totalDebit = Number(totalDebit.toFixed(2));
  this.totalCredit = Number(totalCredit.toFixed(2));

  if (this.totalDebit !== this.totalCredit) {
    return next(new Error(`Unbalanced journal entry: debit=${this.totalDebit}, credit=${this.totalCredit}`));
  }

  next();
});

// journalEntrySchema.pre('save', function(next) {
//   if (!this.isNew) {
//     return next(new Error('Journal entries are immutable. Post a reversal entry instead of editing.'));
//   }

//   next();
// });

journalEntrySchema.pre('save', function(next) {
  if (!this.isNew && this.isModified()) {
    const allowedModifiedPaths = [
      'status', 'reviewedBy', 'reviewedAt', 'reviewComments',
      'submittedBy', 'submittedAt'
    ];
    const modified = this.modifiedPaths();
    const illegal = modified.filter(p => !allowedModifiedPaths.includes(p));
    if (illegal.length > 0) {
      return next(new Error('Journal entries are immutable. Only status transitions are allowed.'));
    }
  }
  next();
});

function blockImmutableMutation(next) {
  next(new Error('Journal entries are immutable. Delete/update operations are not allowed. Use reversals.'));
}

journalEntrySchema.pre('findOneAndUpdate', blockImmutableMutation);
journalEntrySchema.pre('updateOne', blockImmutableMutation);
journalEntrySchema.pre('updateMany', blockImmutableMutation);
journalEntrySchema.pre('findOneAndDelete', blockImmutableMutation);
journalEntrySchema.pre('deleteOne', blockImmutableMutation);
journalEntrySchema.pre('deleteMany', blockImmutableMutation);

journalEntrySchema.index({ date: -1, status: 1 });
journalEntrySchema.index({ sourceType: 1, sourceId: 1 });
journalEntrySchema.index({ reversalOf: 1, status: 1 });

module.exports = mongoose.model('JournalEntry', journalEntrySchema);
