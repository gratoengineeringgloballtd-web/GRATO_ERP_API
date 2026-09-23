const mongoose = require('mongoose');

const towerSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^TOWER[A-Z]{3}\d{3}$/.test(v);
      },
      message: 'Tower ID must follow format TOWER_ABC_001'
    }
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  location: {
    address: {
      type: String,
      required: true,
      trim: true
    },
    city: {
      type: String,
      required: true,
      trim: true
    },
    state: {
      type: String,
      required: true,
      trim: true
    },
    country: {
      type: String,
      required: true,
      trim: true,
      default: 'Cameroon'
    },
    postal_code: {
      type: String,
      trim: true
    },
    coordinates: {
      latitude: {
        type: Number,
        required: true,
        min: -90,
        max: 90
      },
      longitude: {
        type: Number,
        required: true,
        min: -180,
        max: 180
      }
    }
  },
  
  // Tower specifications
  specifications: {
    height: {
      type: Number,
      required: true,
      min: 0
    },
    type: {
      type: String,
      enum: ['monopole', 'lattice', 'guyed', 'stealth', 'rooftop'],
      required: true
    },
    foundation_type: {
      type: String,
      enum: ['concrete', 'steel', 'composite'],
      default: 'concrete'
    },
    max_load_capacity: {
      type: Number, // in kg
      required: true,
      min: 0
    },
    wind_rating: {
      type: Number, // in km/h
      required: true,
      min: 0
    }
  },
  
  // Power and electrical info
  power_requirements: {
    total_load: {
      type: Number, // in kW
      required: true,
      min: 0
    },
    critical_load: {
      type: Number, // in kW
      required: true,
      min: 0
    },
    backup_time_required: {
      type: Number, // in hours
      default: 24
    },
    voltage_requirement: {
      type: Number,
      default: 220
    },
    phases: {
      type: Number,
      enum: [1, 3],
      default: 3
    }
  },
  
  // Equipment assignments
  assigned_generators: [{
    generator_id: {
      type: String,
      ref: 'Generator'
    },
    assignment_type: {
      type: String,
      enum: ['primary', 'backup'],
      default: 'primary'
    },
    assigned_date: {
      type: Date,
      default: Date.now
    }
  }],
  
  primary_generator: {
    type: String,
    ref: 'Generator',
    default: null
  },
  backup_generator: {
    type: String,
    ref: 'Generator',
    default: null
  },
  
  ac_units: [{
    type: String,
    ref: 'ACUnit'
  }],
  
  power_systems: [{
    type: String,
    ref: 'PowerSystem'
  }],
  
  // Site information
  site_info: {
    installation_date: {
      type: Date,
      required: true
    },
    commissioning_date: {
      type: Date,
      required: true
    },
    site_access: {
      type: String,
      enum: ['24/7', 'business_hours', 'restricted', 'escort_required'],
      default: '24/7'
    },
    security_level: {
      type: String,
      enum: ['low', 'medium', 'high', 'maximum'],
      default: 'medium'
    },
    environmental_conditions: {
      temperature_range: {
        min: Number,
        max: Number
      },
      humidity_range: {
        min: Number,
        max: Number
      },
      altitude: Number,
      weather_exposure: {
        type: String,
        enum: ['sheltered', 'moderate', 'exposed', 'extreme'],
        default: 'moderate'
      }
    }
  },
  
  // Operational status
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance', 'decommissioned'],
    default: 'active'
  },
  
  operational_stats: {
    uptime: {
      type: Number, // percentage
      min: 0,
      max: 100,
      default: 100
    },
    last_outage: {
      type: Date,
      default: null
    },
    total_outages: {
      type: Number,
      default: 0,
      min: 0
    },
    average_outage_duration: {
      type: Number, // in minutes
      default: 0,
      min: 0
    }
  },
  
  // Maintenance and inspections
  maintenance_schedule: {
    last_inspection: {
      type: Date,
      default: null
    },
    next_inspection: {
      type: Date,
      required: true
    },
    inspection_interval: {
      type: Number, // in days
      default: 90
    },
    maintenance_history: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Maintenance'
    }]
  },
  
  // Relationships
  cluster_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cluster',
    required: true
  },
  assigned_technicians: [{
    technician_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignment_type: {
      type: String,
      enum: ['primary', 'secondary', 'emergency'],
      default: 'primary'
    },
    assigned_date: {
      type: Date,
      default: Date.now
    }
  }],
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Tenants and carriers
  tenants: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['telecom', 'broadcasting', 'government', 'private'],
      required: true
    },
    equipment_count: {
      type: Number,
      default: 0,
      min: 0
    },
    power_consumption: {
      type: Number, // in kW
      default: 0,
      min: 0
    },
    lease_start: Date,
    lease_end: Date,
    contact_info: {
      name: String,
      phone: String,
      email: String
    }
  }],
  
  // Financial information
  financial: {
    installation_cost: {
      type: Number,
      min: 0
    },
    annual_revenue: {
      type: Number,
      min: 0
    },
    operating_costs: {
      fuel: { type: Number, default: 0 },
      maintenance: { type: Number, default: 0 },
      security: { type: Number, default: 0 },
      insurance: { type: Number, default: 0 },
      utilities: { type: Number, default: 0 }
    }
  },
  
  // Alerts and notifications
  alert_settings: {
    power_failure: { type: Boolean, default: true },
    generator_fault: { type: Boolean, default: true },
    fuel_low: { type: Boolean, default: true },
    security_breach: { type: Boolean, default: true },
    maintenance_due: { type: Boolean, default: true }
  },
  
  // Additional metadata
  notes: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  images: [{
    url: String,
    description: String,
    category: {
      type: String,
      enum: ['tower', 'equipment', 'site', 'access', 'documentation']
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
towerSchema.index({ status: 1 });
towerSchema.index({ cluster_id: 1 });
towerSchema.index({ supervisor: 1 });
towerSchema.index({ 'location.city': 1 });
towerSchema.index({ 'location.coordinates': '2dsphere' });
towerSchema.index({ 'maintenance_schedule.next_inspection': 1 });
towerSchema.index({ primary_generator: 1 });
towerSchema.index({ backup_generator: 1 });

// Virtual for total generators
towerSchema.virtual('generator_count').get(function() {
  return this.assigned_generators ? this.assigned_generators.length : 0;
});

// Virtual for power capacity utilization
towerSchema.virtual('power_utilization').get(function() {
  const totalLoad = this.power_requirements?.total_load || 0;
  const tenantLoad = this.tenants?.reduce((sum, tenant) => sum + (tenant.power_consumption || 0), 0) || 0;
  return totalLoad > 0 ? Math.round((tenantLoad / totalLoad) * 100) : 0;
});

// Virtual for maintenance status
towerSchema.virtual('maintenance_status').get(function() {
  if (!this.maintenance_schedule?.next_inspection) return 'unknown';
  
  const now = new Date();
  const nextInspection = new Date(this.maintenance_schedule.next_inspection);
  const daysUntilInspection = Math.ceil((nextInspection - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntilInspection < 0) return 'overdue';
  if (daysUntilInspection <= 7) return 'due_soon';
  if (daysUntilInspection <= 30) return 'scheduled';
  return 'good';
});

// Virtual for location string
towerSchema.virtual('location_string').get(function() {
  const location = this.location;
  return `${location.address}, ${location.city}, ${location.state}, ${location.country}`;
});

// Pre-save middleware
towerSchema.pre('save', function(next) {
  // Calculate next inspection date if not set
  if (!this.maintenance_schedule?.next_inspection && this.maintenance_schedule?.last_inspection) {
    const nextDate = new Date(this.maintenance_schedule.last_inspection);
    nextDate.setDate(nextDate.getDate() + (this.maintenance_schedule.inspection_interval || 90));
    this.maintenance_schedule.next_inspection = nextDate;
  }
  
  // Update power requirements based on tenant consumption
  if (this.tenants && this.tenants.length > 0) {
    const totalTenantPower = this.tenants.reduce((sum, tenant) => sum + (tenant.power_consumption || 0), 0);
    if (totalTenantPower > (this.power_requirements?.total_load || 0)) {
      this.power_requirements = this.power_requirements || {};
      this.power_requirements.total_load = Math.ceil(totalTenantPower * 1.2); // 20% buffer
    }
  }
  
  next();
});

// Instance method to assign generator
towerSchema.methods.assignGenerator = function(generatorId, assignmentType = 'primary') {
  // Remove existing assignment of the same type
  this.assigned_generators = this.assigned_generators.filter(ag => ag.assignment_type !== assignmentType);
  
  // Add new assignment
  this.assigned_generators.push({
    generator_id: generatorId,
    assignment_type: assignmentType,
    assigned_date: new Date()
  });
  
  // Update primary/backup references
  if (assignmentType === 'primary') {
    this.primary_generator = generatorId;
  } else if (assignmentType === 'backup') {
    this.backup_generator = generatorId;
  }
  
  return this.save();
};

// Instance method to remove generator
towerSchema.methods.removeGenerator = function(generatorId) {
  this.assigned_generators = this.assigned_generators.filter(ag => ag.generator_id !== generatorId);
  
  if (this.primary_generator === generatorId) {
    this.primary_generator = null;
  }
  if (this.backup_generator === generatorId) {
    this.backup_generator = null;
  }
  
  return this.save();
};

// Instance method to check if maintenance is due
towerSchema.methods.isMaintenanceDue = function() {
  if (!this.maintenance_schedule?.next_inspection) return false;
  return new Date() >= new Date(this.maintenance_schedule.next_inspection);
};

// Instance method to add tenant
towerSchema.methods.addTenant = function(tenantData) {
  this.tenants.push(tenantData);
  return this.save();
};

// Instance method to remove tenant
towerSchema.methods.removeTenant = function(tenantName) {
  this.tenants = this.tenants.filter(tenant => tenant.name !== tenantName);
  return this.save();
};

// Static method to find towers needing maintenance
towerSchema.statics.findMaintenanceNeeded = function() {
  const now = new Date();
  return this.find({
    'maintenance_schedule.next_inspection': { $lte: now }
  }).populate('cluster_id', 'name')
    .populate('supervisor', 'fullName')
    .populate('primary_generator', 'status current_stats')
    .populate('backup_generator', 'status current_stats');
};

// Static method to find towers by cluster
towerSchema.statics.findByCluster = function(clusterId) {
  return this.find({ cluster_id: clusterId })
    .populate('primary_generator', 'status current_stats')
    .populate('backup_generator', 'status current_stats');
};

// Static method to find towers near location
towerSchema.statics.findNearLocation = function(coordinates, maxDistance = 10000) { // 10km default
  return this.find({
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [coordinates.longitude, coordinates.latitude]
        },
        $maxDistance: maxDistance
      }
    }
  });
};

module.exports = mongoose.model('Tower', towerSchema);