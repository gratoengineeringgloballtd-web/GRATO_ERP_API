const mongoose = require('mongoose');

const powerSystemSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^PS[A-Z]{3}\d{3}$/.test(v);
      },
      message: 'Power System ID must follow format PS_ABC_001'
    }
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  type: {
    type: String,
    enum: ['ups', 'inverter', 'battery_bank', 'rectifier', 'distribution_panel', 'transfer_switch'],
    required: true
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
    enum: ['online', 'offline', 'maintenance', 'fault', 'bypass'],
    default: 'online'
  },
  tower_id: {
    type: String,
    ref: 'Tower',
    required: true
  },
  
  // Technical specifications
  specifications: {
    rated_power: {
      type: Number, // in kVA or kW
      required: true,
      min: 0
    },
    input_voltage: {
      type: Number,
      required: true,
      min: 0
    },
    output_voltage: {
      type: Number,
      required: true,
      min: 0
    },
    frequency: {
      type: Number,
      default: 50
    },
    phases: {
      type: Number,
      enum: [1, 3],
      required: true
    },
    efficiency: {
      type: Number, // percentage
      min: 0,
      max: 100,
      default: 85
    },
    power_factor: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.8
    },
    backup_time: {
      type: Number, // in minutes
      min: 0
    },
    battery_specifications: {
      type: {
        type: String,
        enum: ['lead_acid', 'lithium', 'gel', 'agm', 'nickel_cadmium']
      },
      capacity: Number, // in Ah
      voltage: Number,
      count: Number,
      expected_life: Number // in years
    }
  },
  
  // Current operational statistics
  current_stats: {
    load: {
      percentage: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
      },
      kw: {
        type: Number,
        min: 0,
        default: 0
      }
    },
    input: {
      voltage: {
        l1: { type: Number, default: 220 },
        l2: { type: Number, default: 220 },
        l3: { type: Number, default: 220 }
      },
      frequency: {
        type: Number,
        default: 50
      },
      current: {
        l1: { type: Number, default: 0 },
        l2: { type: Number, default: 0 },
        l3: { type: Number, default: 0 }
      }
    },
    output: {
      voltage: {
        l1: { type: Number, default: 220 },
        l2: { type: Number, default: 220 },
        l3: { type: Number, default: 220 }
      },
      frequency: {
        type: Number,
        default: 50
      },
      current: {
        l1: { type: Number, default: 0 },
        l2: { type: Number, default: 0 },
        l3: { type: Number, default: 0 }
      }
    },
    battery: {
      voltage: {
        type: Number,
        default: 48
      },
      current: {
        type: Number,
        default: 0
      },
      charge_level: {
        type: Number,
        min: 0,
        max: 100,
        default: 100
      },
      temperature: {
        type: Number,
        default: 25
      },
      backup_time_remaining: {
        type: Number, // in minutes
        default: 0
      }
    },
    temperature: {
      internal: {
        type: Number,
        default: 35
      },
      ambient: {
        type: Number,
        default: 25
      }
    },
    alarms: [{
      code: String,
      description: String,
      severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical']
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      acknowledged: {
        type: Boolean,
        default: false
      }
    }]
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
    default: 180
  },
  warranty_expiry: {
    type: Date,
    default: null
  },
  
  // Operational history
  total_runtime: {
    type: Number, // in hours
    default: 0,
    min: 0
  },
  total_energy_processed: {
    type: Number, // in kWh
    default: 0,
    min: 0
  },
  battery_cycles: {
    type: Number,
    default: 0,
    min: 0
  },
  fault_count: {
    type: Number,
    default: 0,
    min: 0
  },
  power_interruptions: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Performance metrics
  performance_metrics: {
    availability: {
      type: Number,
      min: 0,
      max: 100,
      default: 99
    },
    efficiency: {
      type: Number,
      min: 0,
      max: 100,
      default: 85
    },
    battery_health: {
      type: Number,
      min: 0,
      max: 100,
      default: 100
    },
    load_balancing: {
      type: Number,
      min: 0,
      max: 100,
      default: 95
    }
  },
  
  // Alert thresholds
  alert_thresholds: {
    low_battery: {
      type: Number,
      default: 20 // percentage
    },
    high_load: {
      type: Number,
      default: 80 // percentage
    },
    high_temperature: {
      type: Number,
      default: 45 // degrees Celsius
    },
    voltage_deviation: {
      type: Number,
      default: 10 // percentage
    }
  },
  
  // Configuration
  configuration: {
    operating_mode: {
      type: String,
      enum: ['online', 'offline', 'eco', 'bypass'],
      default: 'online'
    },
    transfer_settings: {
      transfer_time: Number, // in ms
      return_time: Number, // in seconds
      sensitivity: {
        type: String,
        enum: ['low', 'medium', 'high']
      }
    },
    battery_settings: {
      float_voltage: Number,
      boost_voltage: Number,
      low_voltage_disconnect: Number,
      test_interval: Number // in days
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
powerSystemSchema.index({ status: 1 });
powerSystemSchema.index({ tower_id: 1 });
powerSystemSchema.index({ type: 1 });
powerSystemSchema.index({ serial_number: 1 });
powerSystemSchema.index({ next_maintenance: 1 });

// Virtual for maintenance status
powerSystemSchema.virtual('maintenance_status').get(function() {
  if (!this.next_maintenance) return 'unknown';
  
  const now = new Date();
  const nextMaintenance = new Date(this.next_maintenance);
  const daysUntilMaintenance = Math.ceil((nextMaintenance - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntilMaintenance < 0) return 'overdue';
  if (daysUntilMaintenance <= 7) return 'due_soon';
  if (daysUntilMaintenance <= 30) return 'scheduled';
  return 'good';
});

// Virtual for health status
powerSystemSchema.virtual('health_status').get(function() {
  const batteryHealth = this.performance_metrics?.battery_health || 100;
  const efficiency = this.performance_metrics?.efficiency || 85;
  const availability = this.performance_metrics?.availability || 99;
  
  const avgHealth = (batteryHealth + efficiency + availability) / 3;
  
  if (avgHealth >= 90) return 'excellent';
  if (avgHealth >= 80) return 'good';
  if (avgHealth >= 70) return 'fair';
  return 'poor';
});

// Pre-save middleware
powerSystemSchema.pre('save', function(next) {
  // Calculate next maintenance date
  if (!this.next_maintenance && this.last_maintenance && this.maintenance_interval) {
    const nextMaintenanceDate = new Date(this.last_maintenance);
    nextMaintenanceDate.setDate(nextMaintenanceDate.getDate() + this.maintenance_interval);
    this.next_maintenance = nextMaintenanceDate;
  }
  
  // Update battery health based on cycles and age
  if (this.battery_cycles && this.specifications?.battery_specifications) {
    const expectedCycles = (this.specifications.battery_specifications.expected_life || 5) * 365;
    const healthPercentage = Math.max(0, 100 - ((this.battery_cycles / expectedCycles) * 100));
    this.performance_metrics = this.performance_metrics || {};
    this.performance_metrics.battery_health = healthPercentage;
  }
  
  next();
});

// Instance method to check if maintenance is due
powerSystemSchema.methods.isMaintenanceDue = function() {
  if (!this.next_maintenance) return false;
  return new Date() >= new Date(this.next_maintenance);
};

// Instance method to check critical status
powerSystemSchema.methods.isCritical = function() {
  const batteryLevel = this.current_stats?.battery?.charge_level || 100;
  const loadPercentage = this.current_stats?.load?.percentage || 0;
  const temperature = this.current_stats?.temperature?.internal || 25;
  
  return this.status === 'fault' ||
         batteryLevel < this.alert_thresholds.low_battery ||
         loadPercentage > this.alert_thresholds.high_load ||
         temperature > this.alert_thresholds.high_temperature ||
         this.current_stats?.alarms?.some(alarm => alarm.severity === 'critical' && !alarm.acknowledged);
};

// Static method to find systems needing maintenance
powerSystemSchema.statics.findMaintenanceNeeded = function() {
  const now = new Date();
  return this.find({
    $or: [
      { next_maintenance: { $lte: now } },
      { status: 'fault' },
      { 'performance_metrics.battery_health': { $lt: 50 } }
    ]
  }).populate('tower_id', 'name location');
};

module.exports = mongoose.model('PowerSystem', powerSystemSchema);