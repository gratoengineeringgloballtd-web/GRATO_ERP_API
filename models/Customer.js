const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: String,
  url: String,
  publicId: String,
  size: Number,
  mimetype: String,
  uploadedAt: { type: Date, default: Date.now }
});

const contactPersonSchema = new mongoose.Schema({
  name: String,
  position: String,
  email: String,
  phone: String,
  isPrimary: { type: Boolean, default: false }
});

const CustomerSchema = new mongoose.Schema({
  customerId: { 
    type: String, 
    unique: true,
    default: function() {
      return 'CUST-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    }
  },
  
  // Company Information
  companyName: { type: String, required: true },
  tradingName: String,
  
  // Contact Information
  contactPersons: [contactPersonSchema],
  primaryEmail: { type: String, required: true },
  primaryPhone: { type: String, required: true },
  alternatePhone: String,
  website: String,
  
  // Address Information
  address: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: String,
    country: { type: String, default: 'Cameroon', required: true },
    postalCode: String
  },
  
  billingAddress: {
    street: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
    sameAsPhysical: { type: Boolean, default: true }
  },
  
  // Business Details
  businessType: {
    type: String,
    enum: ['Corporation', 'Limited Company', 'Partnership', 'Sole Proprietorship', 'Government', 'NGO', 'Other'],
    default: 'Limited Company'
  },
  industry: {
    type: String,
    enum: [
      'Telecommunications',
      'Technology',
      'Manufacturing',
      'Construction',
      'Real Estate',
      'Healthcare',
      'Education',
      'Retail',
      'Hospitality',
      'Finance',
      'Government',
      'NGO/Non-Profit',
      'Energy',
      'Transportation',
      'Other'
    ]
  },
  businessRegistrationNumber: String,
  taxIdNumber: { type: String, required: true }, // VAT REG or Tax ID
  establishedYear: Number,
  employeeCount: String,
  
  // Customer Classification
  customerType: {
    type: String,
    enum: ['Enterprise', 'SME', 'Government', 'Individual', 'Partner'],
    default: 'Enterprise'
  },
  customerCategory: {
    type: String,
    enum: ['Platinum', 'Gold', 'Silver', 'Bronze', 'Standard'],
    default: 'Standard'
  },
  
  // Financial Information
  creditLimit: {
    type: Number,
    default: 0
  },
  creditTerms: {
    type: String,
    enum: ['15 days NET', '30 days NET', '45 days NET', '60 days NET', '90 days NET', 'Cash on Delivery', 'Advance Payment'],
    default: '30 days NET'
  },
  paymentTerms: String,
  currency: {
    type: String,
    enum: ['XAF', 'USD', 'EUR', 'GBP'],
    default: 'XAF'
  },
  
  // Bank Details
  bankDetails: {
    bankName: String,
    accountNumber: String,
    accountName: String,
    swiftCode: String,
    iban: String
  },
  
  // Status and Approval
  status: {
    type: String,
    enum: ['pending', 'approved', 'active', 'suspended', 'inactive', 'rejected'],
    default: 'pending'
  },
  
  approvalChain: [{
    level: Number,
    approver: {
      name: String,
      email: String,
      role: String
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    comments: String,
    actionDate: Date,
    assignedDate: { type: Date, default: Date.now }
  }],
  
  currentApprovalLevel: {
    type: Number,
    default: 0
  },
  
  // Documents
  documents: {
    businessRegistrationCertificate: documentSchema,
    taxClearanceCertificate: documentSchema,
    proofOfAddress: documentSchema,
    identificationDocument: documentSchema,
    additionalDocuments: [documentSchema]
  },

  // Purchase Orders
  purchaseOrders: [{
    poNumber: String,
    description: String,
    amount: Number,
    currency: { type: String, default: 'XAF' },
    poDate: Date,
    dueDate: Date,
    paymentTerms: mongoose.Schema.Types.Mixed, // Can be String or Array of payment term objects
    document: documentSchema,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'paid'],
      default: 'pending'
    },
    notes: String
  }],
  
  // Business Metrics
  metrics: {
    totalOrders: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    averageOrderValue: { type: Number, default: 0 },
    lastOrderDate: Date,
    lastPaymentDate: Date
  },
  
  // Preferences
  preferences: {
    preferredCommunicationMethod: {
      type: String,
      enum: ['Email', 'Phone', 'WhatsApp', 'SMS'],
      default: 'Email'
    },
    preferredLanguage: {
      type: String,
      enum: ['English', 'French'],
      default: 'English'
    },
    newsletterSubscription: { type: Boolean, default: false },
    invoiceDeliveryMethod: {
      type: String,
      enum: ['Email', 'Physical', 'Portal'],
      default: 'Email'
    }
  },
  
  // Notes and History
  notes: [{
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
    date: { type: Date, default: Date.now },
    type: {
      type: String,
      enum: ['General', 'Payment', 'Issue', 'Meeting', 'Follow-up'],
      default: 'General'
    }
  }],
  
  statusHistory: [{
    status: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    date: { type: Date, default: Date.now }
  }],
  
  // Onboarding Details
  onboardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  onboardingDate: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvalDate: Date,
  rejectionReason: String,
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectionDate: Date,
  
  // Related Application
  onboardingApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerOnboardingApplication'
  },
  
  // Audit Fields
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
CustomerSchema.index({ customerId: 1 });
CustomerSchema.index({ companyName: 1 });
CustomerSchema.index({ status: 1 });
CustomerSchema.index({ primaryEmail: 1 });
CustomerSchema.index({ taxIdNumber: 1 });
CustomerSchema.index({ 'approvalChain.approver.email': 1, 'approvalChain.status': 1 });

// Pre-save middleware to ensure customerId
CustomerSchema.pre('save', function(next) {
  if (!this.customerId) {
    this.customerId = 'CUST-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
  }
  next();
});

// Instance Methods
CustomerSchema.methods.addNote = function(userId, noteText, noteType = 'General') {
  this.notes.push({
    addedBy: userId,
    note: noteText,
    type: noteType,
    date: new Date()
  });
  return this.save();
};

CustomerSchema.methods.updateStatus = function(newStatus, userId, reason = '') {
  this.statusHistory.push({
    status: this.status,
    changedBy: userId,
    reason: reason,
    date: new Date()
  });
  this.status = newStatus;
  return this.save();
};

CustomerSchema.methods.addPurchaseOrder = function(poData, userId) {
  const po = {
    poNumber: poData.poNumber,
    description: poData.description,
    amount: poData.amount,
    currency: poData.currency || 'XAF',
    poDate: poData.poDate,
    dueDate: poData.dueDate,
    paymentTerms: poData.paymentTerms,
    document: poData.document,
    uploadedBy: userId,
    uploadedAt: new Date(),
    status: 'pending',
    notes: poData.notes
  };
  
  this.purchaseOrders.push(po);
  return this.save();
};

CustomerSchema.methods.updatePOStatus = function(poId, newStatus, notes = '') {
  const po = this.purchaseOrders.id(poId);
  if (po) {
    po.status = newStatus;
    if (notes) po.notes = notes;
  }
  return this.save();
};

CustomerSchema.methods.getPurchaseOrders = function() {
  return this.purchaseOrders || [];
};

CustomerSchema.methods.isApproved = function() {
  return this.status === 'approved' || this.status === 'active';
};

CustomerSchema.methods.getCurrentApprovalStep = function() {
  if (!this.approvalChain || this.approvalChain.length === 0) return null;
  return this.approvalChain.find(step => 
    step.level === this.currentApprovalLevel && step.status === 'pending'
  );
};

CustomerSchema.methods.canUserApprove = function(userEmail) {
  const currentStep = this.getCurrentApprovalStep();
  return currentStep && currentStep.approver.email === userEmail;
};

module.exports = mongoose.model('Customer', CustomerSchema);
