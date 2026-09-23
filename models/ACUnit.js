const mongoose = require('mongoose');

const acUnitSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^AC[A-Z]{3}\d{3}$/.test(v);
      },
      message: 'AC Unit ID must follow format AC_ABC_001'
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
  type: {
    type: String,
    enum: ['split', 'window', 'central', 'portable', 'cassette'],
    required: true
  },
  status: {
    type: String,
    enum: ['running', 'standby', 'maintenance', 'fault', 'out_of_service'],
    default: 'standby'
  },
  tower_id: {
    type: String,
    ref: 'Tower',
    required: true
  },
  
  // Technical specifications
  specifications: {
    cooling_capacity: {
      type: Number, // in BTU/hr
      required: true,
      min: 0
    },
    power_consumption: {
      type: Number, // in watts
      required: true,
      min: 0
    },
    voltage_rating: {
      type: Number,
      required: true,
      min: 0
    },
    current_rating: {
      type: Number, // in amperes
      required: true,
      min: 0
    },
    refrigerant_type: {
      type: String,
      required: true,
      enum: ['R410A', 'R22', 'R134A', 'R32', 'other']
    },
    energy_efficiency: {
      eer: Number, 
      seer: Number, 
      cop: Number 
    },
    airflow_rate: {
      type: Number, // in CFM
      min: 0
    },
    noise_level: {
      type: Number, // in dB
      min: 0
    },
    operating_temperature_range: {
      min: { type: Number, default: 16 },
      max: { type: Number, default: 30 }
    }
  },
  
  // Current operational statistics
  current_stats: {
    temperature: {
      indoor: {
        type: Number,
        default: 25
      },
      outdoor: {
        type: Number,
        default: 30
      },
      setpoint: {
        type: Number,
        default: 22
      }
    },
    humidity: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    },
    power_consumption: {
      type: Number,
      min: 0,
      default: 0
    },
    runtime: {
      type: Number,
      min: 0,
      default: 0
    },
    fan_speed: {
      type: String,
      enum: ['low', 'medium', 'high', 'auto'],
      default: 'auto'
    },
    mode: {
      type: String,
      enum: ['cool', 'heat', 'auto', 'fan', 'dry'],
      default: 'cool'
    },
    filter_status: {
      type: String,
      enum: ['clean', 'dirty', 'needs_replacement'],
      default: 'clean'
    }
  },
  
  // Installation and maintenance
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
    type: Number, // in days
    default: 90
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
  total_energy_consumed: {
    type: Number, // in kWh
    default: 0,
    min: 0
  },
  cycle_count: {
    type: Number,
    default: 0,
    min: 0
  },
  fault_count: {
    type: Number,
    default: 0,
    min: 0
  },
  filter_change_count: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Performance metrics
  performance_metrics: {
    cooling_efficiency: {
      type: Number,
      min: 0,
      max: 100,
      default: 85
    },
    energy_efficiency: {
      type: Number,
      min: 0,
      max: 100,
      default: 80
    },
    temperature_stability: {
      type: Number,
      min: 0,
      max: 100,
      default: 90
    },
    availability: {
      type: Number,
      min: 0,
      max: 100,
      default: 98
    }
  },
  
  // Alert thresholds
  alert_thresholds: {
    high_power_consumption: {
      type: Number,
      default: 150 // % of rated power
    },
    temperature_deviation: {
      type: Number,
      default: 5 // degrees from setpoint
    },
    high_runtime: {
      type: Number,
      default: 20 // hours per day
    },
    filter_replacement_days: {
      type: Number,
      default: 90
    }
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
  
  // Additional metadata
  location_in_tower: {
    type: String,
    trim: true,
    maxlength: 100
  },
  room_served: {
    type: String,
    trim: true,
    maxlength: 100
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  images: [{
    url: String,
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
  _id: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
acUnitSchema.index({ status: 1 });
acUnitSchema.index({ tower_id: 1 });
acUnitSchema.index({ serial_number: 1 });
acUnitSchema.index({ assigned_technician: 1 });
acUnitSchema.index({ next_maintenance: 1 });

// Virtual for maintenance status
acUnitSchema.virtual('maintenance_status').get(function() {
  if (!this.next_maintenance) return 'unknown';
  
  const now = new Date();
  const nextMaintenance = new Date(this.next_maintenance);
  const daysUntilMaintenance = Math.ceil((nextMaintenance - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntilMaintenance < 0) return 'overdue';
  if (daysUntilMaintenance <= 7) return 'due_soon';
  if (daysUntilMaintenance <= 30) return 'scheduled';
  return 'good';
});

// Virtual for efficiency status
acUnitSchema.virtual('efficiency_status').get(function() {
  const efficiency = this.performance_metrics?.cooling_efficiency || 0;
  if (efficiency >= 90) return 'excellent';
  if (efficiency >= 80) return 'good';
  if (efficiency >= 70) return 'fair';
  return 'poor';
});

// Pre-save middleware
acUnitSchema.pre('save', function(next) {
  // Calculate next maintenance date if not set
  if (!this.next_maintenance && this.last_maintenance && this.maintenance_interval) {
    const nextMaintenanceDate = new Date(this.last_maintenance);
    nextMaintenanceDate.setDate(nextMaintenanceDate.getDate() + this.maintenance_interval);
    this.next_maintenance = nextMaintenanceDate;
  }
  
  // Update total runtime
  if (this.isModified('current_stats.runtime')) {
    this.total_runtime = Math.max(this.total_runtime, this.current_stats.runtime);
  }
  
  // Calculate energy consumption
  if (this.current_stats?.power_consumption && this.current_stats?.runtime) {
    this.total_energy_consumed = (this.current_stats.power_consumption * this.total_runtime) / 1000; // kWh
  }
  
  next();
});

// Instance method to check if maintenance is due
acUnitSchema.methods.isMaintenanceDue = function() {
  if (!this.next_maintenance) return false;
  return new Date() >= new Date(this.next_maintenance);
};

// Instance method to check if unit needs attention
acUnitSchema.methods.needsAttention = function() {
  const tempDeviation = Math.abs(
    (this.current_stats?.temperature?.indoor || 25) - 
    (this.current_stats?.temperature?.setpoint || 22)
  );
  
  return this.status === 'fault' ||
         this.current_stats?.filter_status === 'needs_replacement' ||
         tempDeviation > (this.alert_thresholds?.temperature_deviation || 5) ||
         this.isMaintenanceDue();
};

// Static method to find units needing maintenance
acUnitSchema.statics.findMaintenanceNeeded = function() {
  const now = new Date();
  return this.find({
    $or: [
      { next_maintenance: { $lte: now } },
      { status: 'fault' },
      { 'current_stats.filter_status': 'needs_replacement' }
    ]
  }).populate('tower_id', 'name location');
};

module.exports = mongoose.model('ACUnit', acUnitSchema);