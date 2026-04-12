const mongoose = require('mongoose');

const departmentPaymentSchema = new mongoose.Schema({
  department: {
    type: String,
    required: true,
    enum: [
      'CEO Office',
      'Technical',
      'Business Development & Supply Chain',
      'HR & Admin',
      'IT'
    ]
  },
  budgetCode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetCode',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  notes: {
    type: String,
    trim: true
  }
});

const SalaryPaymentSchema = new mongoose.Schema({
  paymentPeriod: {
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true }
  },
  
  departmentPayments: [departmentPaymentSchema],
  
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  
  description: {
    type: String,
    trim: true
  },
  
  supportingDocuments: [{
    name: String,
    url: String,
    publicId: String,
    size: Number,
    mimetype: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  status: {
    type: String,
    enum: ['draft', 'processed', 'cancelled'],
    default: 'processed'
  },
  
  processedAt: {
    type: Date,
    default: Date.now
  },

  accountingAudit: {
    isPosted: {
      type: Boolean,
      default: false
    },
    postedAt: Date,
    entryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry'
    },
    entryNumber: String,
    sourceType: {
      type: String,
      default: 'salary_payment'
    }
  }
}, {
  timestamps: true
});

// Index for querying
SalaryPaymentSchema.index({ 'paymentPeriod.year': 1, 'paymentPeriod.month': 1 });
SalaryPaymentSchema.index({ submittedBy: 1 });
SalaryPaymentSchema.index({ status: 1 });

module.exports = mongoose.model('SalaryPayment', SalaryPaymentSchema);