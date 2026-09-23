const mongoose = require('mongoose');

const clusterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 100
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    maxlength: 10
  },
  region: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  
  // Geographic information
  coverage_area: {
    center: {
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
    },
    radius: {
      type: Number, // in kilometers
      required: true,
      min: 0,
      default: 50
    },
    boundaries: [{
      latitude: Number,
      longitude: Number
    }]
  },
  
  // Administrative information
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // required: true
  },
  backup_supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assigned_technicians: [{
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    assigned_date: {
      type: Date,
      default: Date.now
    },
    role: {
      type: String,
      enum: ['primary', 'secondary', 'specialist'],
      default: 'primary'
    },
    specializations: [{
      type: String,
      enum: ['generator', 'ac_unit', 'power_system', 'maintenance']
    }]
  }],
  
  // Operational statistics
  stats: {
    total_towers: {
      type: Number,
      default: 0,
      min: 0
    },
    active_towers: {
      type: Number,
      default: 0,
      min: 0
    },
    total_generators: {
      type: Number,
      default: 0,
      min: 0
    },
    operational_generators: {
      type: Number,
      default: 0,
      min: 0
    },
    total_ac_units: {
      type: Number,
      default: 0,
      min: 0
    },
    total_power_systems: {
      type: Number,
      default: 0,
      min: 0
    },
    pending_maintenance: {
      type: Number,
      default: 0,
      min: 0
    },
    active_alerts: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // Performance metrics
  performance: {
    average_uptime: {
      type: Number, // percentage
      min: 0,
      max: 100,
      default: 99
    },
    average_response_time: {
      type: Number, // in hours
      min: 0,
      default: 2
    },
    maintenance_completion_rate: {
      type: Number, // percentage
      min: 0,
      max: 100,
      default: 95
    },
    customer_satisfaction: {
      type: Number, // rating out of 5
      min: 0,
      max: 5,
      default: 4.5
    }
  },
  
  // Contact and logistics
  contact_info: {
    office_address: {
      type: String,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    emergency_contact: {
      name: String,
      phone: String,
      email: String
    }
  },
  
  // Operational settings
  settings: {
    working_hours: {
      start: {
        type: String,
        default: '08:00'
      },
      end: {
        type: String,
        default: '17:00'
      },
      timezone: {
        type: String,
        default: 'Africa/Douala'
      }
    },
    emergency_response: {
      enabled: {
        type: Boolean,
        default: true
      },
      max_response_time: {
        type: Number, // in hours
        default: 4
      }
    },
    maintenance_windows: [{
      day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      start_time: String,
      end_time: String,
      type: {
        type: String,
        enum: ['routine', 'emergency', 'both'],
        default: 'routine'
      }
    }]
  },
  
  // Status and health
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance'],
    default: 'active'
  },
  health_score: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  
  // Financial information
  budget: {
    annual_budget: {
      type: Number,
      min: 0
    },
    spent_to_date: {
      type: Number,
      min: 0,
      default: 0
    },
    maintenance_budget: {
      type: Number,
      min: 0
    },
    emergency_fund: {
      type: Number,
      min: 0
    }
  },
  
  // Additional metadata
  tags: [{
    type: String,
    trim: true
  }],
  notes: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  
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
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
clusterSchema.index({ code: 1 });
clusterSchema.index({ region: 1 });
clusterSchema.index({ supervisor: 1 });
clusterSchema.index({ status: 1 });
clusterSchema.index({ 'coverage_area.center': '2dsphere' });

// Virtual for technician count
clusterSchema.virtual('technician_count').get(function() {
  return this.assigned_technicians ? this.assigned_technicians.length : 0;
});

// Virtual for utilization rate
clusterSchema.virtual('utilization_rate').get(function() {
  const totalCapacity = this.stats?.total_towers || 0;
  const activeCapacity = this.stats?.active_towers || 0;
  return totalCapacity > 0 ? Math.round((activeCapacity / totalCapacity) * 100) : 0;
});

// Virtual for workload distribution
clusterSchema.virtual('workload_per_technician').get(function() {
  const totalWork = (this.stats?.pending_maintenance || 0) + (this.stats?.active_alerts || 0);
  const technicianCount = this.technician_count;
  return technicianCount > 0 ? Math.round(totalWork / technicianCount) : 0;
});

// Pre-save middleware to update stats
clusterSchema.pre('save', async function(next) {
  // Auto-calculate health score based on performance metrics
  if (this.performance) {
    const metrics = [
      this.performance.average_uptime || 0,
      this.performance.maintenance_completion_rate || 0,
      (this.performance.customer_satisfaction || 0) * 20, // Convert 5-point scale to 100
      100 - ((this.performance.average_response_time || 2) * 10) // Lower response time = higher score
    ];
    this.health_score = Math.max(0, Math.min(100, metrics.reduce((a, b) => a + b) / 4));
  }
  
  next();
});

// Instance method to add technician
clusterSchema.methods.addTechnician = function(technicianId, role = 'primary', specializations = []) {
  // Check if technician is already assigned
  const existingAssignment = this.assigned_technicians.find(
    assignment => assignment.technician.toString() === technicianId.toString()
  );
  
  if (existingAssignment) {
    throw new Error('Technician is already assigned to this cluster');
  }
  
  this.assigned_technicians.push({
    technician: technicianId,
    assigned_date: new Date(),
    role: role,
    specializations: specializations
  });
  
  return this.save();
};

// Instance method to remove technician
clusterSchema.methods.removeTechnician = function(technicianId) {
  this.assigned_technicians = this.assigned_technicians.filter(
    assignment => assignment.technician.toString() !== technicianId.toString()
  );
  
  return this.save();
};

// Instance method to update stats
clusterSchema.methods.updateStats = async function() {
  try {
    // Get tower statistics
    const towers = await mongoose.model('Tower').find({ cluster_id: this._id });
    this.stats.total_towers = towers.length;
    this.stats.active_towers = towers.filter(t => t.status === 'active').length;
    
    // Get generator statistics
    const generators = await mongoose.model('Generator').find({
      tower_id: { $in: towers.map(t => t._id) }
    });
    this.stats.total_generators = generators.length;
    this.stats.operational_generators = generators.filter(g => 
      g.status === 'running' || g.status === 'standby'
    ).length;
    
    // Get maintenance statistics
    const pendingMaintenance = await mongoose.model('Maintenance').countDocuments({
      tower: { $in: towers.map(t => t._id) },
      status: { $in: ['scheduled', 'in_progress'] }
    });
    this.stats.pending_maintenance = pendingMaintenance;
    
    return this.save();
  } catch (error) {
    console.error('Error updating cluster stats:', error);
    throw error;
  }
};

// Static method to find clusters by region
clusterSchema.statics.findByRegion = function(region) {
  return this.find({ region: new RegExp(region, 'i'), status: 'active' })
    .populate('supervisor', 'fullName')
    .populate('assigned_technicians.technician', 'fullName specializations');
};

// Static method to find nearby clusters
clusterSchema.statics.findNearLocation = function(coordinates, maxDistance = 100000) { // 100km default
  return this.find({
    'coverage_area.center': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [coordinates.longitude, coordinates.latitude]
        },
        $maxDistance: maxDistance
      }
    },
    status: 'active'
  });
};

module.exports = mongoose.model('Cluster', clusterSchema);