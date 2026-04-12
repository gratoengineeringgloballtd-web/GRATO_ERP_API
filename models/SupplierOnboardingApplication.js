const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: String,
  url: String,
  publicId: String,
  size: Number,
  mimetype: String,
  uploadedAt: { type: Date, default: Date.now }
});

const SupplierOnboardingApplicationSchema = new mongoose.Schema({
  applicationId: { 
    type: String, 
    unique: true,
    default: function() {
      return 'APP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    }
  },
  companyName: { type: String, required: true },
  contactName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    postalCode: String
  },
  businessRegistrationNumber: { type: String },
  taxIdNumber: { type: String },
  bankDetails: {
    bankName: String,
    accountName: String,
    accountNumber: String,
    routingNumber: String
  },
  supplierType: {
    type: String,
    enum: ['General', 'Supply Chain', 'HR/Admin', 'Operations', 'HSE', 'Refurbishment', 'Civil Works', 'Rollout', 'Security', 'IT', 'Generator Maintenance'],
    default: 'General'
  },
  status: {
    type: String,
    enum: ['pending_review', 'under_review', 'approved', 'rejected', 'clarification_needed'],
    default: 'pending_review'
  },
  documents: {
    businessRegistrationCertificate: documentSchema,
    taxClearanceCertificate: documentSchema,
    bankStatement: documentSchema,
    insuranceCertificate: documentSchema,
    additionalDocuments: [documentSchema]
  },
  submittedAt: { type: Date, default: Date.now },
  reviewHistory: [{
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: String,
    comments: String,
    reviewedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

// Pre-save middleware to ensure applicationId is always set
SupplierOnboardingApplicationSchema.pre('save', function(next) {
  if (!this.applicationId) {
    this.applicationId = 'APP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('SupplierOnboardingApplication', SupplierOnboardingApplicationSchema);



