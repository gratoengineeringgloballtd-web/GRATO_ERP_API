const mongoose = require('mongoose');

const generatorUpdateSchema = new mongoose.Schema({
  updateType: {
    type: String,
    enum: ['status_update', 'new_generator', 'maintenance_update'],
    required: true
  },
  
  // Site reference (from Site model)
  site_id: {
    type: String,
    required: true
  },
  
  // Tower reference (from Tower model with custom string IDs)
  tower_id: {
    type: String,
    ref: 'Tower',
    required: true
  },
  
  existing_generator_id: {
    type: String,
    ref: 'Generator',
    required: function() {
      return this.updateType === 'status_update' || this.updateType === 'maintenance_update';
    }
  },
  
  new_generator_id: {
    type: String,
    required: function() {
      return this.updateType === 'new_generator';
    },
    validate: {
      validator: function(v) {
        // Accept both formats: GEN_ABC_001 or GENABC001
        return !v || /^GEN_?[A-Z]{3}_?\d{3,4}$/.test(v);
      },
      message: 'Generator ID must follow format GEN_ABC_001 or GENABC001'
    }
  },

  // Generator details for new installations
  model: {
    type: String,
    required: function() {
      return this.updateType === 'new_generator';
    }
  },
  
  serial_number: {
    type: String,
    required: function() {
      return this.updateType === 'new_generator';
    }
  },
  
  fuel_capacity: {
    type: Number,
    required: function() {
      return this.updateType === 'new_generator';
    },
    min: 0
  },
  
  power_rating: {
    type: Number,
    required: function() {
      return this.updateType === 'new_generator';
    },
    min: 0
  },
  
  fuel_type: {
    type: String,
    enum: ['diesel', 'gasoline', 'natural_gas', 'hybrid'],
    required: function() {
      return this.updateType === 'new_generator';
    }
  },
  
  installation_date: {
    type: Date,
    required: function() {
      return this.updateType === 'new_generator';
    }
  },
  
  maintenance_interval: {
    type: Number, // in hours
    default: 250
  },
  
  // Current status information
  fuel_level: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  
  power_output: {
    type: Number,
    min: 0,
    default: 0
  },
  
  temperature: {
    type: Number,
    default: 25
  },
  
  runtime: {
    type: Number,
    min: 0,
    default: 0
  },
  
  generator_status: {
    type: String,
    enum: ['running', 'standby', 'maintenance', 'fault', 'out_of_service'],
    required: true,
    default: 'standby'
  },
  
  // Update metadata
  update_reason: {
    type: String,
    required: true,
    maxlength: 500
  },
  
  photos: [{
    url: String,
    description: String,
    uploaded_at: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Approval workflow
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  
  submitted_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  reviewed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  reviewed_at: {
    type: Date
  },
  
  review_comments: {
    type: String,
    maxlength: 1000
  },
  
  // Timestamps
  submitted_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
generatorUpdateSchema.index({ status: 1 });
generatorUpdateSchema.index({ site_id: 1 });
generatorUpdateSchema.index({ tower_id: 1 });
generatorUpdateSchema.index({ submitted_by: 1 });
generatorUpdateSchema.index({ submitted_at: -1 });
generatorUpdateSchema.index({ updateType: 1 });

// Virtual for update age in days
generatorUpdateSchema.virtual('days_pending').get(function() {
  if (this.status !== 'pending') return null;
  return Math.floor((new Date() - this.submitted_at) / (1000 * 60 * 60 * 24));
});

// Virtual for priority (based on age and type)
generatorUpdateSchema.virtual('priority').get(function() {
  if (this.status !== 'pending') return 'n/a';
  
  const daysPending = this.days_pending;
  
  if (this.updateType === 'maintenance_update' || this.generator_status === 'fault') {
    return 'high';
  }
  
  if (daysPending > 7) return 'high';
  if (daysPending > 3) return 'medium';
  return 'low';
});

// Pre-save middleware to normalize generator IDs
generatorUpdateSchema.pre('save', function(next) {
  // Remove underscores from generator IDs if present
  if (this.new_generator_id) {
    this.new_generator_id = this.new_generator_id.replace(/_/g, '');
  }
  if (this.existing_generator_id) {
    this.existing_generator_id = this.existing_generator_id.replace(/_/g, '');
  }
  next();
});

// Instance method to check if update is overdue
generatorUpdateSchema.methods.isOverdue = function() {
  return this.status === 'pending' && this.days_pending > 7;
};

// Static method to get pending updates count
generatorUpdateSchema.statics.getPendingCount = function() {
  return this.countDocuments({ status: 'pending' });
};

// Static method to get updates by site
generatorUpdateSchema.statics.getBySite = function(siteId) {
  return this.find({ site_id: siteId })
    .populate('submitted_by', 'fullName role')
    .populate('reviewed_by', 'fullName role')
    .sort({ submitted_at: -1 });
};

module.exports = mongoose.model('GeneratorUpdate', generatorUpdateSchema);



