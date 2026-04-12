const mongoose = require('mongoose');

const InventoryInstanceSchema = new mongoose.Schema({
  // Link to parent inventory item (catalog-level)
  inventoryItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true,
    index: true
  },
  
  // Unique identifiers
  instanceId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  assetTag: {
    type: String,
    unique: true,
    sparse: true, // ✅ ALREADY HAS sparse: true - GOOD!
    index: true,
    uppercase: true,
    trim: true
  },
  barcode: {
    type: String,
    unique: true,
    sparse: true, // ✅ MAKE SURE THIS IS HERE!
    index: true,
    trim: true
  },
  serialNumber: {
    type: String,
    trim: true,
    index: true
  },
  
  // Physical details
  condition: {
    type: String,
    enum: ['new', 'excellent', 'good', 'fair', 'poor', 'damaged'],
    default: 'new'
  },
  location: {
    type: String,
    default: 'Main Warehouse',
    trim: true
  },
  binLocation: {
    type: String,
    trim: true
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['available', 'in-use', 'maintenance', 'damaged', 'disposed', 'lost'],
    default: 'available',
    index: true
  },
  
  // Assignment
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedDate: {
    type: Date
  },
  assignedProject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  },
  
  // Acquisition details
  acquisitionDate: {
    type: Date,
    default: Date.now
  },
  acquisitionCost: {
    type: Number,
    min: 0
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  poNumber: {
    type: String,
    trim: true
  },
  
  // Warranty information
  warrantyExpiry: {
    type: Date
  },
  warrantyProvider: {
    type: String,
    trim: true
  },
  
  // Maintenance
  lastMaintenanceDate: {
    type: Date
  },
  nextMaintenanceDue: {
    type: Date
  },
  maintenanceNotes: {
    type: String,
    trim: true
  },
  
  // Image
  imageUrl: {
    type: String,
    trim: true
  },
  imagePublicId: {
    type: String,
    trim: true
  },
  
  // Notes
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  
  // Audit fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes - CRITICAL: Make sure sparse is set for nullable unique fields
InventoryInstanceSchema.index({ inventoryItem: 1, status: 1 });
InventoryInstanceSchema.index({ assignedTo: 1 });
InventoryInstanceSchema.index({ status: 1, condition: 1 });
InventoryInstanceSchema.index({ location: 1 });

// Explicitly define sparse unique indexes
InventoryInstanceSchema.index({ assetTag: 1 }, { unique: true, sparse: true });
InventoryInstanceSchema.index({ barcode: 1 }, { unique: true, sparse: true });

// Virtual for item details
InventoryInstanceSchema.virtual('itemDetails', {
  ref: 'Inventory',
  localField: 'inventoryItem',
  foreignField: '_id',
  justOne: true
});

// Method to assign instance to user/project
InventoryInstanceSchema.methods.assignTo = function(userId, projectId = null) {
  this.assignedTo = userId;
  this.assignedProject = projectId;
  this.assignedDate = new Date();
  this.status = 'in-use';
  return this.save();
};

// Method to unassign instance
InventoryInstanceSchema.methods.unassign = function() {
  this.assignedTo = null;
  this.assignedProject = null;
  this.assignedDate = null;
  this.status = 'available';
  return this.save();
};

module.exports = mongoose.model('InventoryInstance', InventoryInstanceSchema);



