const mongoose = require('mongoose');

const outageSchema = new mongoose.Schema({
  State: String,
  'Tenant Site ID': { 
    type: String, 
    index: true 
  },
  'Site ID': String,
  'IHS Site Name': String,
  'State/District': String,
  'Incident State': String,
  Tenant: { 
    type: String, 
    index: true 
  },
  Priority: { 
    type: String, 
    index: true 
  },
  'Outage Start Time': Date,
  'Outage End Time': Date,
  'Outage Duration': String,
  'Resolution Comments': String,
  'Primary Cause': String,
  'RCA 1': { 
    type: String, 
    index: true 
  },
  'RCA 2': String,
  'RCA 3': String,
  'Parent Tenant Outage': { 
    type: String, 
    index: true 
  },
  'Cascaded Sites': String,
  'Incident Ref': String,
  'Cascaded outage': Boolean,
  'Cascaded Tenant count': Number,
  Number: String,

  // Derived fields for filtering
  isMTN: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  isOCM: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  isParent: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  isChild: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  isAccessPassive: { 
    type: Boolean, 
    default: false, 
    index: true 
  }
}, { 
  timestamps: true 
});

// Indexes for performance
outageSchema.index({ 'RCA 1': 1, isAccessPassive: 1 });
outageSchema.index({ Tenant: 1, isMTN: 1, isOCM: 1 });
outageSchema.index({ 'Parent Tenant Outage': 1, isChild: 1 });

module.exports = mongoose.model('Outage', outageSchema);