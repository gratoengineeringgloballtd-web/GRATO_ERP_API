const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['bill', 'advance', 'adv-salary', 'cash-sales', 'fund-in', 'make-cheque'],
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  description: String,
  referenceNo: String,
  employee: {
    name: String,
    code: String
  },
  payee: String,
  allocation: String,
  source: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, { timestamps: true });


const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  address: String,
  city: String,
  country: String,
  telephone: String,

  currentBalance: { 
    type: Number,
    default: 0
  },
  currency: { 
    type: String,
    enum: ['XAF', 'USD'],
    default: 'XAF'
  },
  openingBalance: { 
    type: Number,
    default: 0, 
  },
  documents: [{
    filename: String,
    path: String,
    mimetype: String,
    size: Number,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  changeHistory: [{
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    changes: Object
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true 
  }
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);
const Company = mongoose.model('Company', companySchema);

module.exports = { Transaction, Company };