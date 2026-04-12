const mongoose = require('mongoose');

const MaintenanceHistorySchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  maintenanceType: {
    type: String,
    enum: ['routine', 'repair', 'inspection', 'upgrade', 'calibration'],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  cost: {
    type: Number,
    default: 0,
    min: 0
  },
  performedBy: {
    type: String,
    required: true
  },
  vendor: {
    type: String
  },
  nextServiceDue: {
    type: Date
  },
  attachments: [{
    filename: String,
    url: String
  }]
}, { _id: true });

const AssignmentHistorySchema = new mongoose.Schema({
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedToName: {
    type: String
  },
  department: {
    type: String
  },
  location: {
    type: String
  },
  assignmentDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  returnDate: {
    type: Date
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String
  },
  acknowledgmentDate: {
    type: Date
  },
  acknowledgmentSignature: {
    type: String
  }
}, { _id: true });

const FixedAssetSchema = new mongoose.Schema({
  assetTag: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    match: /^[0-9]{4}$/
  },
  barcode: {
    type: String,
    unique: true
  },
  qrCode: {
    type: String
  },
  item: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  
  // Asset Identification
  assetName: {
    type: String,
    required: true
  },
  assetDescription: {
    type: String
  },
  serialNumber: {
    type: String
  },
  modelNumber: {
    type: String
  },
  manufacturer: {
    type: String
  },
  
  // Acquisition Details
  acquisitionDate: {
    type: Date,
    required: true
  },
  acquisitionCost: {
    type: Number,
    required: true,
    min: 0
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  supplierName: {
    type: String
  },
  poNumber: {
    type: String
  },
  invoiceNumber: {
    type: String
  },
  warrantyExpiry: {
    type: Date
  },
  
  // Depreciation
  depreciationMethod: {
    type: String,
    enum: ['straight-line', 'declining-balance', 'none'],
    default: 'straight-line'
  },
  usefulLifeYears: {
    type: Number,
    min: 1,
    default: 5
  },
  salvageValue: {
    type: Number,
    default: 0,
    min: 0
  },
  depreciationStartDate: {
    type: Date
  },
  
  // Current Assignment
  currentAssignment: {
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedToName: String,
    assignedDepartment: String,
    assignedLocation: String,
    assignmentDate: Date
  },
  assignmentHistory: [AssignmentHistorySchema],
  
  // Condition & Status
  condition: {
    type: String,
    enum: ['excellent', 'good', 'fair', 'poor', 'damaged'],
    default: 'good'
  },
  status: {
    type: String,
    enum: ['active', 'in-use', 'in-maintenance', 'in-storage', 'retired', 'disposed', 'lost', 'stolen'],
    default: 'active'
  },
  
  // Inspection & Maintenance
  lastInspectionDate: {
    type: Date
  },
  nextInspectionDue: {
    type: Date
  },
  inspectionFrequencyMonths: {
    type: Number,
    default: 12
  },
  maintenanceHistory: [MaintenanceHistorySchema],
  
  // Disposal
  disposalDate: {
    type: Date
  },
  disposalMethod: {
    type: String,
    enum: ['sale', 'donation', 'scrap', 'write-off', 'trade-in']
  },
  disposalReason: {
    type: String
  },
  disposalValue: {
    type: Number,
    min: 0
  },
  disposalApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Location tracking
  physicalLocation: {
    building: String,
    floor: String,
    room: String,
    notes: String
  },
  
  // Images and documents
  images: [{
    url: String,
    caption: String,
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }],
  documents: [{
    filename: String,
    url: String,
    documentType: {
      type: String,
      enum: ['invoice', 'warranty', 'manual', 'certificate', 'other']
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Metadata
  notes: {
    type: String
  },
  tags: [{
    type: String
  }],
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  accountCodes: {
    assetAccount:        { type: String, default: '1500' },
    depreciationAccount: { type: String, default: '5400' },
    accumulatedAccount:  { type: String, default: '1510' },
    disposalGainAccount: { type: String, default: '4100' },
    disposalLossAccount: { type: String, default: '5300' }
  },
  depreciationLines: [{
    sequence:  { type: Number, required: true },
    date:      { type: Date,   required: true },
    amount:    { type: Number, required: true },
    bookValue: { type: Number, required: true },
    isPosted:  { type: Boolean, default: false },
    entryId:   { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null }
  }],
  accountingAudit: {
    acquisitionEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    acquisitionPosted:  { type: Boolean, default: false },
    disposalEntryId:    { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    disposalPosted:     { type: Boolean, default: false }
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
FixedAssetSchema.index({ assetTag: 1 });
FixedAssetSchema.index({ barcode: 1 });
FixedAssetSchema.index({ item: 1 });
FixedAssetSchema.index({ 'currentAssignment.assignedTo': 1 });
FixedAssetSchema.index({ status: 1 });
FixedAssetSchema.index({ condition: 1 });
FixedAssetSchema.index({ nextInspectionDue: 1 });

// Virtuals
FixedAssetSchema.virtual('currentBookValue').get(function() {
  if (!this.acquisitionDate || !this.acquisitionCost) return 0;
  
  const years = (Date.now() - this.acquisitionDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const annualDepreciation = (this.acquisitionCost - this.salvageValue) / this.usefulLifeYears;
  const accumulated = Math.min(annualDepreciation * years, this.acquisitionCost - this.salvageValue);
  
  return Math.max(0, this.acquisitionCost - accumulated);
});

FixedAssetSchema.virtual('accumulatedDepreciation').get(function() {
  if (!this.acquisitionDate || !this.acquisitionCost) return 0;
  
  const years = (Date.now() - this.acquisitionDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const annualDepreciation = (this.acquisitionCost - this.salvageValue) / this.usefulLifeYears;
  
  return Math.min(annualDepreciation * years, this.acquisitionCost - this.salvageValue);
});

FixedAssetSchema.virtual('isOverdue').get(function() {
  return this.nextInspectionDue && this.nextInspectionDue < new Date();
});

FixedAssetSchema.virtual('totalMaintenanceCost').get(function() {
  return this.maintenanceHistory.reduce((sum, m) => sum + (m.cost || 0), 0);
});

// Methods
FixedAssetSchema.methods.assign = function(userId, userName, department, location, assignedBy, notes) {
  // Archive current assignment
  if (this.currentAssignment.assignedTo) {
    const history = {
      ...this.currentAssignment,
      returnDate: new Date()
    };
    this.assignmentHistory.push(history);
  }
  
  // Set new assignment
  this.currentAssignment = {
    assignedTo: userId,
    assignedToName: userName,
    assignedDepartment: department,
    assignedLocation: location,
    assignmentDate: new Date()
  };
  
  this.assignmentHistory.push({
    assignedTo: userId,
    assignedToName: userName,
    department: department,
    location: location,
    assignmentDate: new Date(),
    assignedBy: assignedBy,
    notes: notes
  });
  
  this.status = 'in-use';
  return this.save();
};

FixedAssetSchema.methods.addMaintenance = function(maintenanceData) {
  this.maintenanceHistory.push(maintenanceData);
  this.lastInspectionDate = maintenanceData.date;
  
  if (maintenanceData.nextServiceDue) {
    this.nextInspectionDue = maintenanceData.nextServiceDue;
  }
  
  return this.save();
};

FixedAssetSchema.methods.dispose = function(disposalData, approvedBy) {
  this.status = 'disposed';
  this.disposalDate = disposalData.disposalDate || new Date();
  this.disposalMethod = disposalData.disposalMethod;
  this.disposalReason = disposalData.disposalReason;
  this.disposalValue = disposalData.disposalValue;
  this.disposalApprovedBy = approvedBy;
  
  // Return from current assignment
  if (this.currentAssignment.assignedTo) {
    this.currentAssignment.returnDate = new Date();
  }
  
  return this.save();
};

module.exports = mongoose.model('FixedAsset', FixedAssetSchema);