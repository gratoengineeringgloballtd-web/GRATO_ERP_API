// models/Contract.js - Updated with Supplier Reference

const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  dueDate: Date,
  completionDate: Date,
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'overdue'],
    default: 'pending'
  },
  responsibleParty: {
    type: String,
    enum: ['supplier', 'client', 'both']
  },
  notes: String
}, { timestamps: true });

// const amendmentSchema = new mongoose.Schema({
//   type: {
//     type: String,
//     enum: ['Price Adjustment', 'Scope Change', 'Term Extension', 'Performance Modification', 'Compliance Update', 'General Amendment'],
//     required: true
//   },
//   description: { type: String, required: true },
//   effectiveDate: { type: Date, required: true },
//   financialImpact: {
//     amount: Number,
//     type: {
//       type: String,
//       enum: ['increase', 'decrease', 'neutral']
//     }
//   },
//   documents: [{
//     name: String,
//     url: String,
//     publicId: String,
//     uploadedAt: Date
//   }],
//   createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//   approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//   approvalDate: Date,
//   status: {
//     type: String,
//     enum: ['draft', 'pending_approval', 'approved', 'rejected'],
//     default: 'draft'
//   }
// }, { timestamps: true });


const amendmentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Price Adjustment', 'Scope Change', 'Term Extension', 'Performance Modification', 'Compliance Update', 'General Amendment'],
    required: true
  },
  description: { type: String, required: true },
  effectiveDate: { type: Date, required: true },
  financialImpact: {
    amount: Number,
    type: {
      type: String,
      enum: ['increase', 'decrease', 'neutral']
    }
  },
  documents: [{
    name: String,
    url: String,
    publicId: String,
    localPath: String, 
    uploadedAt: Date
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvalDate: Date,
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'approved', 'rejected'],
    default: 'draft'
  }
}, { timestamps: true });

const ContractSchema = new mongoose.Schema({
  contractNumber: {
    type: String,
    unique: true,
    default: function() {
      return 'CNT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    }
  },
  
  // UNIFIED SUPPLIER REFERENCE
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Basic Information
  title: { type: String, required: true },
  description: String,
  type: {
    type: String,
    enum: ['Supply Agreement', 'Service Agreement', 'Framework Agreement', 'Purchase Order', 'Maintenance Contract', 'Consulting Agreement', 'Lease Agreement', 'Other'],
    required: true
  },
  category: {
    type: String,
    enum: ['IT Equipment', 'Office Supplies', 'Professional Services', 'Maintenance', 'Construction', 'Energy & Environment', 'Transportation', 'Healthcare', 'Other'],
    required: true
  },
  
  // Contract Period
  dates: {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    signedDate: Date,
    effectiveDate: Date
  },
  
  // Financial Details
  financials: {
    totalValue: { type: Number, required: true },
    currency: { type: String, default: 'XAF' },
    paymentTerms: String,
    deliveryTerms: String,
    priceAdjustmentClause: String
  },
  
  // Linked Invoices
  linkedInvoices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupplierInvoice'
  }],
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'active', 'expiring_soon', 'expired', 'terminated', 'renewed', 'suspended'],
    default: 'draft'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  
  // Management
  management: {
    contractManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    department: String,
    reviewCycle: String // e.g., 'Monthly', 'Quarterly', 'Annual'
  },
  
  // Renewal
  renewal: {
    isRenewable: { type: Boolean, default: false },
    autoRenewal: { type: Boolean, default: false },
    renewalNoticePeriod: Number, // days
    renewalHistory: [{
      renewalDate: Date,
      previousEndDate: Date,
      newEndDate: Date,
      renewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }]
  },
  
  // Terms & Conditions
  terms: {
    terminationClause: String,
    penaltyClause: String,
    warrantyTerms: String,
    confidentialityTerms: String,
    disputeResolution: String
  },
  
  // Performance Tracking
  performance: {
    kpis: [{
      metric: String,
      target: String,
      actual: String,
      status: String
    }],
    lastReviewDate: Date,
    nextReviewDate: Date
  },
  
  // Milestones
  milestones: [milestoneSchema],
  
  // Amendments
  amendments: [amendmentSchema],
  
  // Documents
  documents: [{
    name: String,
    type: String,
    url: String,
    publicId: String,
    localPath: String, 
    uploadedAt: Date,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  
  // Notes
  internalNotes: String,
  
  // Audit Trail
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
ContractSchema.index({ supplier: 1, status: 1 });
ContractSchema.index({ contractNumber: 1 });
ContractSchema.index({ 'dates.endDate': 1, status: 1 });

// Virtual for days until expiry
ContractSchema.virtual('daysUntilExpiry').get(function() {
  if (!this.dates.endDate) return null;
  const today = new Date();
  const diffTime = this.dates.endDate - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for invoice totals
ContractSchema.virtual('invoiceTotals').get(function() {
  // This will be populated when needed
  return null;
});

// Methods
ContractSchema.methods.getInvoiceTotal = async function() {
  const SupplierInvoice = mongoose.model('SupplierInvoice');
  const invoices = await SupplierInvoice.find({
    _id: { $in: this.linkedInvoices }
  });
  
  return invoices.reduce((sum, inv) => sum + inv.invoiceAmount, 0);
};

ContractSchema.methods.getRemainingValue = async function() {
  const invoiced = await this.getInvoiceTotal();
  return this.financials.totalValue - invoiced;
};

ContractSchema.methods.linkInvoice = async function(invoiceId) {
  if (!this.linkedInvoices.includes(invoiceId)) {
    this.linkedInvoices.push(invoiceId);
    await this.save();
  }
};

ContractSchema.methods.unlinkInvoice = async function(invoiceId) {
  this.linkedInvoices = this.linkedInvoices.filter(id => id.toString() !== invoiceId.toString());
  await this.save();
};

// Check if contract is expiring soon (30 days)
ContractSchema.methods.checkExpiryStatus = function() {
  const daysLeft = this.daysUntilExpiry;
  if (daysLeft <= 0) {
    this.status = 'expired';
  } else if (daysLeft <= 30 && this.status === 'active') {
    this.status = 'expiring_soon';
  }
};

// Pre-save middleware
ContractSchema.pre('save', function(next) {
  this.checkExpiryStatus();
  next();
});

// Static method to trigger performance evaluation on completion
ContractSchema.statics.triggerPerformanceEvaluation = async function(contractId) {
  const contract = await this.findById(contractId).populate('supplier');
  if (!contract) return;
  
  // Create performance evaluation
  const SupplierPerformance = mongoose.model('SupplierPerformance');
  
  const evaluation = new SupplierPerformance({
    supplier: contract.supplier._id,
    supplierName: contract.supplier.supplierDetails.companyName,
    evaluationPeriod: {
      startDate: contract.dates.startDate,
      endDate: contract.dates.endDate
    },
    status: 'draft',
    remarks: `Auto-generated evaluation for contract ${contract.contractNumber}`,
    // Default values - admin should complete
    onTimeDeliveryRate: 0,
    qualityRating: 0,
    costCompliance: 0,
    responsivenessRating: 0
  });
  
  await evaluation.save();
  console.log(`Performance evaluation created for contract ${contract.contractNumber}`);
};

// Post-save middleware to check for completion
ContractSchema.post('save', async function(doc) {
  if (doc.status === 'expired' || doc.status === 'terminated') {
    // Check if performance evaluation already exists
    const SupplierPerformance = mongoose.model('SupplierPerformance');
    const existingEval = await SupplierPerformance.findOne({
      supplier: doc.supplier,
      'evaluationPeriod.startDate': doc.dates.startDate,
      'evaluationPeriod.endDate': doc.dates.endDate
    });
    
    if (!existingEval) {
      await mongoose.model('Contract').triggerPerformanceEvaluation(doc._id);
    }
  }
});

module.exports = mongoose.model('Contract', ContractSchema);

