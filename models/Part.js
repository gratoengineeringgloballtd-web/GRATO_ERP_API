const mongoose = require('mongoose');

const partSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  part_number: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 50
  },
  category: {
    type: String,
    required: true,
    enum: ['filter', 'oil', 'belt', 'electrical', 'fuel', 'cooling', 'engine', 'maintenance', 'other'],
    trim: true
  },
  subcategory: {
    type: String,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  manufacturer: {
    type: String,
    trim: true,
    maxlength: 100
  },
  supplier: {
    name: {
      type: String,
      trim: true,
      maxlength: 100
    },
    contact: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    }
  },
  specifications: {
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
      diameter: Number
    },
    weight: Number,
    material: String,
    color: String,
    model_compatibility: [String], // Array of compatible generator models
    technical_specs: mongoose.Schema.Types.Mixed
  },
  inventory: {
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    min_stock_level: {
      type: Number,
      required: true,
      min: 0,
      default: 10
    },
    max_stock_level: {
      type: Number,
      required: true,
      min: 0,
      default: 100
    },
    reorder_point: {
      type: Number,
      required: true,
      min: 0,
      default: 20
    },
    location: {
      warehouse: String,
      shelf: String,
      bin: String
    }
  },
  pricing: {
    unit_cost: {
      type: Number,
      required: true,
      min: 0
    },
    selling_price: {
      type: Number,
      min: 0
    },
    currency: {
      type: String,
      default: 'XAF',
      enum: ['XAF', 'USD', 'EUR']
    },
    last_purchase_price: Number,
    last_purchase_date: Date
  },
  usage_stats: {
    total_used: {
      type: Number,
      default: 0,
      min: 0
    },
    monthly_usage: {
      type: Number,
      default: 0,
      min: 0
    },
    last_used_date: Date,
    average_monthly_usage: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  maintenance_info: {
    replacement_interval: {
      type: Number, // in hours or days
      min: 0
    },
    shelf_life: {
      type: Number, // in months
      min: 0
    },
    storage_requirements: {
      temperature: {
        min: Number,
        max: Number
      },
      humidity: {
        max: Number
      },
      special_conditions: String
    }
  },
  quality: {
    quality_grade: {
      type: String,
      enum: ['OEM', 'aftermarket', 'generic', 'premium'],
      default: 'aftermarket'
    },
    warranty_period: {
      type: Number, // in months
      default: 12
    },
    certifications: [String],
    test_results: [{
      test_type: String,
      result: String,
      date: Date,
      tester: String
    }]
  },
  status: {
    type: String,
    enum: ['active', 'discontinued', 'obsolete', 'on_order'],
    default: 'active'
  },
  images: [{
    url: String,
    description: String,
    uploaded_date: {
      type: Date,
      default: Date.now
    }
  }],
  documents: [{
    name: String,
    url: String,
    type: {
      type: String,
      enum: ['manual', 'datasheet', 'certificate', 'warranty', 'other']
    },
    uploaded_date: {
      type: Date,
      default: Date.now
    }
  }],
  tags: [{
    type: String,
    trim: true
  }],
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  last_updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
partSchema.index({ part_number: 1 });
partSchema.index({ name: 'text', description: 'text' });
partSchema.index({ category: 1, subcategory: 1 });
partSchema.index({ 'inventory.stock': 1 });
partSchema.index({ status: 1 });
partSchema.index({ 'specifications.model_compatibility': 1 });

// Virtual for stock status
partSchema.virtual('stock_status').get(function() {
  const stock = this.inventory?.stock || 0;
  const minLevel = this.inventory?.min_stock_level || 0;
  const reorderPoint = this.inventory?.reorder_point || 0;
  
  if (stock === 0) return 'out_of_stock';
  if (stock <= minLevel) return 'critical';
  if (stock <= reorderPoint) return 'low';
  return 'adequate';
});

// Virtual for reorder needed
partSchema.virtual('needs_reorder').get(function() {
  const stock = this.inventory?.stock || 0;
  const reorderPoint = this.inventory?.reorder_point || 0;
  return stock <= reorderPoint;
});

// Virtual for estimated stock out date
partSchema.virtual('estimated_stock_out_date').get(function() {
  const stock = this.inventory?.stock || 0;
  const monthlyUsage = this.usage_stats?.average_monthly_usage || 0;
  
  if (monthlyUsage <= 0) return null;
  
  const monthsRemaining = stock / monthlyUsage;
  const stockOutDate = new Date();
  stockOutDate.setMonth(stockOutDate.getMonth() + monthsRemaining);
  
  return stockOutDate;
});

// Pre-save middleware
partSchema.pre('save', function(next) {
  // Auto-calculate reorder point if not set
  if (!this.inventory.reorder_point && this.usage_stats.average_monthly_usage) {
    this.inventory.reorder_point = Math.ceil(this.usage_stats.average_monthly_usage * 1.5);
  }
  
  // Ensure selling price is higher than cost
  if (this.pricing.selling_price && this.pricing.unit_cost) {
    if (this.pricing.selling_price < this.pricing.unit_cost) {
      this.pricing.selling_price = this.pricing.unit_cost * 1.2; // 20% markup minimum
    }
  }
  
  next();
});

// Instance method to update stock
partSchema.methods.updateStock = function(quantity, operation = 'add') {
  if (operation === 'add') {
    this.inventory.stock += quantity;
  } else if (operation === 'subtract') {
    this.inventory.stock = Math.max(0, this.inventory.stock - quantity);
    
    // Update usage stats
    this.usage_stats.total_used += quantity;
    this.usage_stats.last_used_date = new Date();
    this.usage_stats.monthly_usage += quantity;
  }
  
  return this.save();
};

// Instance method to check compatibility
partSchema.methods.isCompatibleWith = function(generatorModel) {
  return this.specifications?.model_compatibility?.includes(generatorModel) || false;
};

// Static method to find parts needing reorder
partSchema.statics.findPartsNeedingReorder = function() {
  return this.find({
    $expr: { $lte: ['$inventory.stock', '$inventory.reorder_point'] },
    status: 'active'
  }).sort({ 'inventory.stock': 1 });
};

// Static method to find parts by category
partSchema.statics.findByCategory = function(category, subcategory = null) {
  const query = { category, status: 'active' };
  if (subcategory) query.subcategory = subcategory;
  return this.find(query).sort({ name: 1 });
};

// Static method to search parts
partSchema.statics.searchParts = function(searchTerm) {
  return this.find({
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { part_number: { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
      { manufacturer: { $regex: searchTerm, $options: 'i' } }
    ],
    status: 'active'
  });
};

module.exports = mongoose.model('Part', partSchema);