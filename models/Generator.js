const mongoose = require('mongoose');

const generatorSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^GEN_?[A-Z]{3}_?\d{3,4}$/.test(v);
      },
      message: 'Generator ID must follow format GEN_ABC_001'
    }
  },
  model: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  manufacturer: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  serial_number: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 100
  },
  status: {
    type: String,
    enum: ['running', 'standby', 'maintenance', 'fault', 'out_of_service'],
    default: 'standby'
  },
  tower_id: {
    type: String,
    ref: 'Tower',
    default: null
  },
  
  // Technical specifications
  specifications: {
    fuel_type: {
      type: String,
      enum: ['diesel', 'gasoline', 'natural_gas', 'hybrid'],
      required: true
    },
    fuel_capacity: {
      type: Number,
      required: true,
      min: 0
    },
    power_rating: {
      type: Number,
      required: true,
      min: 0
    },
    voltage_output: {
      type: Number,
      default: 220
    },
    frequency: {
      type: Number,
      default: 50
    },
    engine_type: {
      type: String,
      trim: true
    },
    cooling_system: {
      type: String,
      enum: ['air', 'liquid', 'hybrid'],
      default: 'liquid'
    },
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
      weight: Number
    },
    operating_temperature: {
      min: { type: Number, default: -10 },
      max: { type: Number, default: 50 }
    }
  },
  
  // Current operational statistics
  current_stats: {
    fuel: {
      type: Number,
      min: 0,
      max: 100,
      default: 100
    },
    power: {
      type: Number,
      min: 0,
      default: 0
    },
    runtime: {
      type: Number,
      min: 0,
      default: 0
    },
    temperature: {
      type: Number,
      default: 25
    },
    voltage: {
      type: Number,
      default: 220
    },
    current: {
      type: Number,
      default: 0
    },
    frequency: {
      type: Number,
      default: 50
    },
    oil_pressure: {
      type: Number,
      min: 0,
      default: 0
    },
    coolant_temperature: {
      type: Number,
      default: 25
    },
    battery_voltage: {
      type: Number,
      default: 12
    }
  },
  
  // Installation and maintenance info
  installation_date: {
    type: Date,
    required: true,
    default: Date.now
  },
  last_maintenance: {
    type: Date,
    default: null
  },
  next_maintenance: {
    type: Date,
    default: null
  },
  maintenance_interval: {
    type: Number, // in hours
    default: 250
  },
  warranty_expiry: {
    type: Date,
    default: null
  },
  
  // Operational history
  total_runtime: {
    type: Number,
    default: 0,
    min: 0
  },
  total_fuel_consumed: {
    type: Number,
    default: 0,
    min: 0
  },
  start_count: {
    type: Number,
    default: 0,
    min: 0
  },
  fault_count: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Relationships
  maintenance_history: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Maintenance'
  }],
  assigned_technician: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Location and assignment history
  assignment_history: [{
    tower_id: {
      type: String,
      ref: 'Tower'
    },
    assigned_date: {
      type: Date,
      default: Date.now
    },
    removed_date: Date,
    assigned_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String
  }],
  
  // Performance metrics
  performance_metrics: {
    availability: {
      type: Number,
      min: 0,
      max: 100,
      default: 100
    },
    efficiency: {
      type: Number,
      min: 0,
      max: 100,
      default: 85
    },
    mtbf: { // Mean Time Between Failures (hours)
      type: Number,
      default: 2000
    },
    mttr: { // Mean Time To Repair (hours)
      type: Number,
      default: 4
    }
  },
  
  // Alert thresholds
  alert_thresholds: {
    low_fuel: {
      type: Number,
      min: 0,
      max: 100,
      default: 20
    },
    high_temperature: {
      type: Number,
      default: 90
    },
    low_oil_pressure: {
      type: Number,
      default: 10
    },
    high_runtime: {
      type: Number,
      default: 200 // hours before maintenance
    }
  },
  
  // Additional metadata
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  tags: [{
    type: String,
    trim: true
  }],
  images: [{
    type: String, // URL to image
    description: String,
    uploaded_date: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Audit fields
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
  _id: false, // Disable auto _id since we're using custom string IDs
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
generatorSchema.index({ status: 1 });
generatorSchema.index({ tower_id: 1 });
generatorSchema.index({ model: 1 });
generatorSchema.index({ serial_number: 1 });
generatorSchema.index({ assigned_technician: 1 });
generatorSchema.index({ next_maintenance: 1 });
generatorSchema.index({ 'current_stats.fuel': 1 });

// Virtual for fuel percentage status
generatorSchema.virtual('fuel_status').get(function() {
  const fuel = this.current_stats?.fuel || 0;
  if (fuel < 20) return 'critical';
  if (fuel < 50) return 'low';
  if (fuel < 80) return 'medium';
  return 'high';
});

// Virtual for maintenance status
generatorSchema.virtual('maintenance_status').get(function() {
  if (!this.next_maintenance) return 'unknown';
  
  const now = new Date();
  const nextMaintenance = new Date(this.next_maintenance);
  const daysUntilMaintenance = Math.ceil((nextMaintenance - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntilMaintenance < 0) return 'overdue';
  if (daysUntilMaintenance <= 7) return 'due_soon';
  if (daysUntilMaintenance <= 30) return 'scheduled';
  return 'good';
});

// Virtual for operational status
generatorSchema.virtual('operational_status').get(function() {
  const availability = this.performance_metrics?.availability || 0;
  if (availability >= 95) return 'excellent';
  if (availability >= 85) return 'good';
  if (availability >= 70) return 'fair';
  return 'poor';
});

// Virtual for assignment status
generatorSchema.virtual('assignment_status').get(function() {
  return this.tower_id ? 'assigned' : 'unassigned';
});

// Pre-save middleware
generatorSchema.pre('save', function(next) {
  // Calculate next maintenance date if not set
  if (!this.next_maintenance && this.last_maintenance && this.maintenance_interval) {
    const nextMaintenanceDate = new Date(this.last_maintenance);
    nextMaintenanceDate.setHours(nextMaintenanceDate.getHours() + this.maintenance_interval);
    this.next_maintenance = nextMaintenanceDate;
  }
  
  // Update total runtime if current runtime changed
  if (this.isModified('current_stats.runtime')) {
    this.total_runtime = Math.max(this.total_runtime, this.current_stats.runtime);
  }
  
  // Auto-calculate efficiency based on fuel consumption and power output
  if (this.current_stats?.fuel && this.current_stats?.power) {
    const fuelEfficiency = this.current_stats.power / (100 - this.current_stats.fuel + 1);
    this.performance_metrics = this.performance_metrics || {};
    this.performance_metrics.efficiency = Math.min(100, Math.max(0, fuelEfficiency * 20));
  }
  
  next();
});

// Instance method to check if maintenance is due
generatorSchema.methods.isMaintenanceDue = function() {
  if (!this.next_maintenance) return false;
  return new Date() >= new Date(this.next_maintenance);
};

// Instance method to check if generator is in critical state
generatorSchema.methods.isCritical = function() {
  const fuel = this.current_stats?.fuel || 0;
  const temperature = this.current_stats?.temperature || 0;
  const oilPressure = this.current_stats?.oil_pressure || 0;
  
  return fuel < this.alert_thresholds.low_fuel ||
         temperature > this.alert_thresholds.high_temperature ||
         oilPressure < this.alert_thresholds.low_oil_pressure ||
         this.status === 'fault';
};

// Instance method to assign to tower
generatorSchema.methods.assignToTower = function(towerId, assignedBy, reason = 'Assignment') {
  // Add to assignment history
  this.assignment_history.push({
    tower_id: towerId,
    assigned_date: new Date(),
    assigned_by: assignedBy,
    reason: reason
  });
  
  this.tower_id = towerId;
  return this.save();
};

// Instance method to unassign from tower
generatorSchema.methods.unassignFromTower = function(assignedBy, reason = 'Unassignment') {
  // Update the last assignment history entry
  if (this.assignment_history.length > 0) {
    const lastAssignment = this.assignment_history[this.assignment_history.length - 1];
    if (!lastAssignment.removed_date) {
      lastAssignment.removed_date = new Date();
      lastAssignment.reason = reason;
    }
  }
  
  this.tower_id = null;
  return this.save();
};

// Instance method to update stats
generatorSchema.methods.updateStats = function(newStats) {
  Object.assign(this.current_stats, newStats);
  return this.save();
};

// Static method to find generators needing maintenance
generatorSchema.statics.findMaintenanceNeeded = function() {
  const now = new Date();
  return this.find({
    $or: [
      { next_maintenance: { $lte: now } },
      { status: 'fault' },
      { 'current_stats.fuel': { $lt: 20 } }
    ]
  }).populate('tower_id', 'name location');
};

// Static method to find available generators
generatorSchema.statics.findAvailable = function() {
  return this.find({
    tower_id: null,
    status: { $in: ['standby', 'running'] }
  });
};

module.exports = mongoose.model('Generator', generatorSchema);






