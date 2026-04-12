const mongoose = require('mongoose');

const InventorySchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
    // No unique or index here; handled by compound index below
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  subcategory: {
    type: String,
    trim: true
  },
  // unitOfMeasure: {
  //   type: String,
  //   required: true,
  //   enum: ['Pieces', 'Sets', 'Boxes', 'Packs', 'Units', 'Kg', 'Litres', 'Meters', 'Pairs', 'Each', 'Reams']
  // },
  unitOfMeasure: {
    type: String,
    required: true,
    enum: [
      'Pieces', 'Sets', 'Boxes', 'Packs', 'Units', 'Kg', 'Litres', 
      'Meters', 'Pairs', 'Each', 'Reams',
      // Add these variants:
      'EACH', 'LTR', 'LITRE', 'LITER', 'KG', 'PCS', 'PC', 'PIECE',
      'SET', 'BOX', 'PACK', 'UNIT', 'METER', 'METRE', 'PAIR', 'REAM'
    ]
  },
  itemType: {
    type: String,
    required: true,
    enum: ['asset', 'liability', 'expense'],
    default: 'expense'
  },
  imageUrl: {
    type: String,
    trim: true
  },
  
  // Stock Management Fields
  stockQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  minimumStock: {
    type: Number,
    default: 0,
    min: 0
  },
  maximumStock: {
    type: Number,
    default: null
  },
  reorderPoint: {
    type: Number,
    default: 0,
    min: 0
  },
  location: {
    type: String,
    default: 'Main Warehouse'
  },
  binLocation: {
    type: String
  },
  batchTracking: {
    type: Boolean,
    default: false
  },
  serialTracking: {
    type: Boolean,
    default: false
  },
  lastStockUpdate: {
    type: Date,
    default: Date.now
  },
  
  // Pricing
  standardPrice: {
    type: Number,
    min: 0
  },
  averageCost: {
    type: Number,
    default: 0,
    min: 0
  },
  
  supplier: String,
  specifications: String,
  
  // Fixed Asset Fields
  isFixedAsset: {
    type: Boolean,
    default: false
  },
  assetTag: {
    type: String,
    sparse: true,
    unique: true
  },
  assetDetails: {
    acquisitionDate: Date,
    acquisitionCost: Number,
    depreciationMethod: {
      type: String,
      enum: ['straight-line', 'declining-balance', 'none']
    },
    usefulLifeYears: Number,
    salvageValue: Number,
    currentBookValue: Number,
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedLocation: String,
    condition: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'poor']
    },
    lastMaintenanceDate: Date,
    nextMaintenanceDue: Date
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemRequest'
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


// Indexes for better query performance
InventorySchema.index({ category: 1, isActive: 1 });
InventorySchema.index({ description: 'text', specifications: 'text' });
InventorySchema.index({ isActive: 1 });
InventorySchema.index({ assetTag: 1 }, { sparse: true });
InventorySchema.index({ stockQuantity: 1 });
InventorySchema.index({ 'assetDetails.assignedTo': 1 });
InventorySchema.index({ code: 1, createdAt: 1 });
// Compound unique index for code, supplier, and standardPrice
InventorySchema.index({ code: 1, supplier: 1, standardPrice: 1 }, { unique: true, sparse: true });

// Virtual for display code
InventorySchema.virtual('displayCode').get(function() {
  return this.code || `ITM-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Virtual for stock value
InventorySchema.virtual('stockValue').get(function() {
  return this.stockQuantity * (this.averageCost || this.standardPrice || 0);
});

// Virtual for reorder needed
InventorySchema.virtual('needsReorder').get(function() {
  return this.stockQuantity <= this.reorderPoint;
});

// Virtual for current depreciation (if fixed asset)
InventorySchema.virtual('accumulatedDepreciation').get(function() {
  if (!this.isFixedAsset || !this.assetDetails?.acquisitionDate) return 0;
  
  const years = (Date.now() - this.assetDetails.acquisitionDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const annualDepreciation = (this.assetDetails.acquisitionCost - (this.assetDetails.salvageValue || 0)) / 
                             (this.assetDetails.usefulLifeYears || 1);
  
  return Math.min(annualDepreciation * years, this.assetDetails.acquisitionCost - (this.assetDetails.salvageValue || 0));
});

// Method to update stock quantity
InventorySchema.methods.updateStock = function(quantity, type = 'add') {
  if (type === 'add') {
    this.stockQuantity += quantity;
  } else if (type === 'subtract') {
    this.stockQuantity = Math.max(0, this.stockQuantity - quantity);
  } else if (type === 'set') {
    this.stockQuantity = quantity;
  }
  this.lastStockUpdate = new Date();
  return this.save();
};

// Method to calculate current book value
InventorySchema.methods.calculateBookValue = function() {
  if (!this.isFixedAsset || !this.assetDetails?.acquisitionCost) return 0;
  return this.assetDetails.acquisitionCost - this.accumulatedDepreciation;
};

module.exports = mongoose.model('Inventory', InventorySchema);






