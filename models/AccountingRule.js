const mongoose = require('mongoose');

const ruleLineSchema = new mongoose.Schema({
  side: {
    type: String,
    enum: ['debit', 'credit'],
    required: true
  },
  accountCode: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  amountSource: {
    type: String,
    enum: ['gross', 'net', 'tax', 'fixed', 'field'],
    default: 'gross'
  },
  fieldPath: {
    type: String,
    trim: true,
    default: ''
  },
  fixedAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  optional: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const accountingRuleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  documentType: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  sourceType: {
    type: String,
    trim: true,
    default: ''
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  priority: {
    type: Number,
    default: 100
  },
  isActive: {
    type: Boolean,
    default: true
  },
  taxConfig: {
    enabled: {
      type: Boolean,
      default: false
    },
    defaultRate: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  lines: {
    type: [ruleLineSchema],
    validate: {
      validator: function(lines) {
        if (!Array.isArray(lines) || lines.length < 2) return false;
        const hasDebit = lines.some((line) => line.side === 'debit');
        const hasCredit = lines.some((line) => line.side === 'credit');
        return hasDebit && hasCredit;
      },
      message: 'Rule must include at least one debit and one credit line'
    }
  }
}, {
  timestamps: true
});

accountingRuleSchema.index({ documentType: 1, sourceType: 1, isActive: 1, priority: 1 });

module.exports = mongoose.model('AccountingRule', accountingRuleSchema);
