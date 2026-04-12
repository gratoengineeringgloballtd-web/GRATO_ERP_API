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

const CustomerOnboardingApplicationSchema = new mongoose.Schema({
  applicationId: { 
    type: String, 
    unique: true,
    default: function() {
      return 'CAPP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
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
    country: { type: String, default: 'Cameroon' },
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
    enum: ['Corporation', 'Limited Company', 'Partnership', 'Sole Proprietorship', 'Government', 'NGO', 'Other']
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
  taxIdNumber: { type: String, required: true },
  establishedYear: Number,
  employeeCount: String,
  
  // Customer Classification
  customerType: {
    type: String,
    enum: ['Enterprise', 'SME', 'Government', 'Individual', 'Partner'],
    default: 'Enterprise'
  },
  
  // Financial Information
  requestedCreditLimit: Number,
  requestedCreditTerms: {
    type: String,
    enum: ['15 days NET', '30 days NET', '45 days NET', '60 days NET', '90 days NET', 'Cash on Delivery', 'Advance Payment'],
    default: '30 days NET'
  },
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
  
  // Status
  status: {
    type: String,
    enum: ['pending_review', 'under_review', 'approved', 'rejected', 'clarification_needed'],
    default: 'pending_review'
  },
  
  // Documents
  documents: {
    businessRegistrationCertificate: documentSchema,
    taxClearanceCertificate: documentSchema,
    proofOfAddress: documentSchema,
    identificationDocument: documentSchema,
    additionalDocuments: [documentSchema]
  },
  
  // Submission Info
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedAt: { type: Date, default: Date.now },
  
  // Review History
  reviewHistory: [{
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: String,
    comments: String,
    reviewedAt: { type: Date, default: Date.now }
  }],
  
  // Notes
  internalNotes: String,
  
  // Linked Customer (after approval)
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }
  
}, { timestamps: true });

// Pre-save middleware to ensure applicationId
CustomerOnboardingApplicationSchema.pre('save', function(next) {
  if (!this.applicationId) {
    this.applicationId = 'CAPP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  }
  next();
});

// Indexes
CustomerOnboardingApplicationSchema.index({ applicationId: 1 });
CustomerOnboardingApplicationSchema.index({ status: 1 });
CustomerOnboardingApplicationSchema.index({ primaryEmail: 1 });
CustomerOnboardingApplicationSchema.index({ submittedBy: 1 });

module.exports = mongoose.model('CustomerOnboardingApplication', CustomerOnboardingApplicationSchema);
