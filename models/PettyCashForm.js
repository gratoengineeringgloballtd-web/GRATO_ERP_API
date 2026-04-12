const mongoose = require('mongoose');

const PettyCashFormSchema = new mongoose.Schema({
  // Link to original requisition
  requisitionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequisition',
    required: true
  },
  
  // Form number (auto-generated)
  formNumber: {
    type: String,
    unique: true,
    required: true
  },
  
  // Employee who made the request
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Copy all requisition details
  title: String,
  department: String,
  itemCategory: String,
  amountRequested: Number,
  purpose: String,
  businessJustification: String,
  urgency: String,
  deliveryLocation: String,
  expectedDate: Date,
  
  // Copy all items from requisition
  items: [{
    itemId: mongoose.Schema.Types.ObjectId,
    code: String,
    description: String,
    category: String,
    quantity: Number,
    measuringUnit: String,
    estimatedPrice: Number
  }],
  
  // Copy approval chain from requisition
  approvalChain: [{
    level: Number,
    approver: {
      name: String,
      email: String,
      role: String,
      department: String
    },
    status: String,
    comments: String,
    actionDate: Date,
    actionTime: String
  }],
  
  // Budget allocation
  budgetAllocation: {
    budgetCode: String,
    budgetCodeId: mongoose.Schema.Types.ObjectId,
    allocatedAmount: Number,
    allocationStatus: String
  },
  
  // Status is always 'approved' since requisition was approved
  status: {
    type: String,
    default: 'approved'
  },
  
  // Assigned buyer
  assignedBuyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Download tracking (simple)
  downloads: [{
    downloadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    downloadDate: Date
  }],
  
  // Generation metadata
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Auto-generate form number
PettyCashFormSchema.pre('save', async function(next) {
  if (this.isNew && !this.formNumber) {
    const count = await this.constructor.countDocuments();
    const year = new Date().getFullYear();
    this.formNumber = `PCF-${year}-${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

module.exports = mongoose.model('PettyCashForm', PettyCashFormSchema);