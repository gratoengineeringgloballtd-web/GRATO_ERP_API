// models/IntellectualProperty.js
const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

const trustEntitySchema = new mongoose.Schema({
  entityType:         { type: String, enum: ['supplier', 'employee', 'third_party', 'government'], required: true },
  entityId:           { type: mongoose.Schema.Types.ObjectId, default: null },
  entityName:         { type: String, required: true, trim: true },
  businessAreas:      [{ type: String, trim: true }],
  contractId:         { type: mongoose.Schema.Types.ObjectId, ref: 'ContractRecord', default: null },
  contractStatus:     { type: String, trim: true, default: '' },
  disciplinaryStatus: { type: String, trim: true, default: '' },
  notes:              { type: String, trim: true, default: '' }
}, { _id: true });

const intellectualPropertySchema = new mongoose.Schema({
  ipType: {
    type: String,
    required: true,
    enum: ['trademark', 'patent', 'copyright', 'trade_secret']
  },
  name:               { type: String, required: true, trim: true },
  description:        { type: String, trim: true, default: '' },
  registrationNumber: { type: String, trim: true, default: '' },
  registrationDate:   { type: Date },
  expiryDate:         { type: Date },
  jurisdiction:       { type: String, trim: true, default: '' },

  businessAreas: [{ type: String, trim: true }],
  trustEntities: [trustEntitySchema],

  monitoringStatus: {
    type: String,
    enum: ['active', 'at_risk', 'infringement_detected', 'in_litigation'],
    default: 'active'
  },

  litigations: [{
    description: { type: String, required: true },
    filedDate:   { type: Date },
    status:      { type: String, enum: ['pending', 'active', 'settled', 'dismissed'], default: 'pending' },
    outcome:     { type: String, trim: true, default: '' },
    attachments: [{ name: String, url: String }]
  }],

  projectTaskId: { type: mongoose.Schema.Types.ObjectId, default: null },
  documents:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'ComplianceDocument' }],

  agreementDocuments: [{
    name:       String,
    url:        String,
    uploadedAt: { type: Date, default: Date.now }
  }],

  status:    { type: String, enum: ['registered', 'pending', 'expired', 'abandoned'], default: 'registered' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

intellectualPropertySchema.index({ ipType: 1, status: 1 });
intellectualPropertySchema.index({ expiryDate: 1 });

module.exports = mongoose.model('IntellectualProperty', intellectualPropertySchema);