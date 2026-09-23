const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
  No: {
    type: Number,
    required: false
  },
  Region: {
    type: String,
    required: false,
    trim: true
  },
  TENANT_ID: {
    type: String,
    required: false,
    trim: true
  },
  IHS_ID: {
    type: String,
    required: false,
    trim: true
  },
  MTN_ID: {
    type: String,
    required: false,
    trim: true
  },
  OCM_ID: {
    type: String,
    required: false,
    trim: true
  },
  OCM_Priority: {
    type: String,
    required: false,
    trim: true
  },
  MTN_Priority: {
    type: String,
    required: false,
    trim: true
  },
  GRATO_Cluster: {
    type: String,
    required: false,
    trim: true
  },
  cluster: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cluster',
    required: false,
    index: true
  },
  Site_Name: {
    type: String,
    required: false,
    trim: true,
    default: 'Unnamed site'
  },
  IHS_ID_SITE: {
    type: String,
    unique: true,
    trim: true,
    index: true
  },
  Latitude: {
    type: Number,
    required: false,
    validate: {
      validator: function (v) {
        return v === null || v === undefined || (v >= -90 && v <= 90);
      },
      message: 'Latitude must be between -90 and 90 degrees'
    }
  },
  Longitude: {
    type: Number,
    required: false,
    validate: {
      validator: function (v) {
        return v === null || v === undefined || (v >= -180 && v <= 180);
      },
      message: 'Longitude must be between -180 and 180 degrees'
    }
  },
  // Radius (meters) within which a technician's GPS position is considered
  // "at this site" for the mobile check-in verification feature. Defaults
  // to 150m — wide enough to allow for realistic GPS drift and a site's
  // physical footprint (access road, compound, tower base) without being
  // so wide it'd accept a technician who's genuinely at a different site
  // down the road.
  Geofence_Radius_M: {
    type: Number,
    required: false,
    default: 150,
    min: 20,
  },
  Sites_Type: {
    type: String,
    required: false,
    trim: true
  },
  Tenants_Count: {
    type: Number,
    required: false,
    min: 0
  },
  Sites_Priority: {
    type: String,
    required: false,
    trim: true
  },
  Sites_Configuration_Outdoor_Indoor: {
    type: String,
    required: false,
    trim: true
  },
  Sites_Power_Topology: {
    type: String,
    required: false,
    trim: true
  },
  Company_in_charge_of_Security: {
    type: String,
    required: false,
    trim: true
  },
  Proposed_SBCs_Distribution: {
    type: String,
    required: false,
    trim: true
  },
  IHS_supervisor_name: {
    type: String,
    required: false,
    trim: true
  },
  IHS_sup_for_hand_over: {
    type: String,
    required: false,
    trim: true
  },
  IHS_phone_number: {
    type: String,
    required: false,
    trim: true
  },
  Technician_Name: {
    type: String,
    required: false,
    trim: true
  },
  Technician_Contact: {
    type: String,
    required: false,
    trim: true
  },
  Email_Address_SBC_Field_Engineer: {
    type: String,
    required: false,
    trim: true,
    lowercase: true,
    validate: {
      validator: function (v) {
        return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Invalid email format'
    }
  },
  Email_Address_SBC_Regional_Manager: {
    type: String,
    required: false,
    trim: true,
    lowercase: true,
    validate: {
      validator: function (v) {
        return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Invalid email format'
    }
  },
  SBC_Head_of_Operations: {
    type: String,
    required: false,
    trim: true
  },
  SBC_Head_of_Operations_contact: {
    type: String,
    required: false,
    trim: true
  },
  Email_Address_SBC_Head_of_Operations: {
    type: String,
    required: false,
    trim: true,
    lowercase: true,
    validate: {
      validator: function (v) {
        return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Invalid email format'
    }
  },
  Email_Address_SBC_OPS_Head: {
    type: String,
    required: false,
    trim: true,
    lowercase: true,
    validate: {
      validator: function (v) {
        return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Invalid email format'
    }
  },
  SBC_Supervisor: {
    type: String,
    required: false,
    trim: true
  },
  SBC_Supervisor_contact: {
    type: String,
    required: false,
    trim: true
  },
  MTN_Detail: {
    type: String,
    required: false,
    trim: true
  },
  OCM_Detail: {
    type: String,
    required: false,
    trim: true
  },
  MTN_NAME: {
    type: String,
    required: false,
    trim: true
  },
  OCM_NAME: {
    type: String,
    required: false,
    trim: true
  },

  // EXISTING GENERATOR ASSIGNMENT FIELDS
  Current_Generators: [{
    type: String,
    ref: 'Generator',
    validate: {
      validator: function (generators) {
        return generators.length <= 2;
      },
      message: 'A site can have maximum 2 generators'
    }
  }],
  Primary_Generator: {
    type: String,
    ref: 'Generator'
  },
  Secondary_Generator: {
    type: String,
    ref: 'Generator'
  },
  Generator_Assignment_History: [{
    generator_id: {
      type: String,
      ref: 'Generator'
    },
    assigned_date: {
      type: Date,
      default: Date.now
    },
    removed_date: Date,
    assignment_type: {
      type: String,
      enum: ['primary', 'secondary'],
      default: 'primary'
    },
    assigned_by: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['active', 'removed', 'replaced'],
      default: 'active'
    }
  }],
  Last_Generator_Update: {
    update_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GeneratorUpdate'
    },
    update_date: Date,
    update_type: String,
    updated_by: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User'
    }
  },

  // NEW TECHNICIAN VISIT FIELDS FROM EXCEL
  // Visit Information
  Actual_Date_Visit: {
    type: Date,
    required: false
  },
  Previous_Date_Visit: {
    type: Date,
    required: false
  },
  Time_Passed: {
    type: Number, // Days between visits
    required: false
  },
  Type_of_Visit: {
    type: String,
    enum: ['PM', 'END', 'RF', 'PM+END', 'PM+RF', 'RF+END', 'PM+RF+END'],
    required: false
  },

  // Power Topology (New field - different from Sites_Power_Topology)
  Actual_Power_Topology: {
    type: String,
    required: false,
    trim: true
  },

  // Electrical Information
  Earthing_OHM: {
    type: Number,
    required: false,
    min: 0
  },
  ENEO_Working: {
    type: String,
    enum: ['YES', 'NO', 'yes', 'no'],
    required: false
  },
  Phase_Type: {
    type: String,
    enum: ['TRI', 'Mono', 'single', 'three'],
    required: false
  },
  N_PH1_Voltage: {
    type: Number,
    required: false
  },
  N_PH2_Voltage: {
    type: Number,
    required: false
  },
  N_PH3_Voltage: {
    type: Number,
    required: false
  },

  // ENEO Meter Information
  ENEO_Meter_Number: {
    type: String,
    required: false,
    trim: true
  },
  ENEO_SQ_Check: {
    type: String,
    enum: ['ok', 'OK', 'PROB'],
    required: false
  },
  Actual_Index: {
    type: Number,
    required: false
  },
  Previous_Index: {
    type: Number,
    required: false
  },
  Consumed_KWA: {
    type: Number,
    required: false
  },
  Comments_on_Grid: {
    type: String,
    required: false,
    trim: true
  },
  Grid_Availability: {
    type: String,
    required: false,
    trim: true
  },

  // Fuel Tank Information
  Type_de_Tank: {
    type: String,
    enum: ['INT', 'EXT', 'underground', 'surface', 'mobile'],
    required: false
  },
  Tank_Capacity_1: {
    type: Number,
    required: false,
    min: 0
  },
  Tank_Length: {
    type: Number,
    required: false,
    min: 0
  },
  Tank_Width: {
    type: Number,
    required: false,
    min: 0
  },
  Tank_Height: {
    type: Number,
    required: false,
    min: 0
  },
  Tank_Bottom: {
    type: Number,
    required: false,
    min: 0
  },
  Fuel_SQ_Check: {
    type: String,
    enum: ['ok', 'OK', 'PROB'],
    required: false
  },
  Previous_Fuel_Quantity: {
    type: Number,
    required: false,
    min: 0
  },
  Height_Found_CM_1: {
    type: Number,
    required: false,
    min: 0
  },
  Height_Found_CM_2: {
    type: Number,
    required: false,
    min: 0
  },
  Fuel_Quantity_Found: {
    type: Number,
    required: false,
    min: 0
  },
  // Provenance for Fuel_Quantity_Found — it can now be set either by a
  // technician's field visit (GRATO import) or by the daily tank
  // telemetry feed (services/tankLevelImportService.js), which is
  // higher-frequency and doesn't go stale between visits. Knowing which
  // source last wrote it matters for trust/debugging.
  Fuel_Level_Source: {
    type: String,
    enum: ['field_visit', 'tank_telemetry', null],
    default: null,
  },
  Fuel_Level_Updated_At: {
    type: Date,
    default: null,
  },
  Fuel_Quantity_Added: {
    type: Number,
    required: false,
    min: 0
  },
  Fuel_Quantity_Consumed: {
    type: Number,
    required: false,
    min: 0
  },

  // Generator Information (Enhanced)
  Number_of_Generators: {
    type: Number,
    required: false,
    min: 0,
    max: 2
  },

  // Generator Details Array (for multiple generators)
  Generators_Details: [{
    generator_number: {
      type: Number,
      required: true,
      min: 1,
      max: 2
    },
    brand: {
      type: String,
      required: false,
      trim: true
    },
    serial_number: {
      type: String,
      required: false,
      trim: true
    },
    maintenance_cycle: {
      type: Number,
      required: false,
      min: 0
    },
    kva: {
      type: Number,
      required: false,
      min: 0
    },
    dg_age: {
      type: Number,
      required: false,
      min: 0
    },
    actual_running_hours: {
      type: Number,
      required: false,
      min: 0
    },
    last_running_hours: {
      type: Number,
      required: false,
      min: 0
    },
    run_hours: {
      type: Number,
      required: false,
      min: 0
    },
    cph: {
      type: String,
      required: false,
      trim: true
    },
    load_1ph: {
      type: Number,
      required: false,
      min: 0
    },
    load_2ph: {
      type: Number,
      required: false,
      min: 0
    },
    load_3ph: {
      type: Number,
      required: false,
      min: 0
    },
    dc_load: {
      type: Number,
      required: false,
      min: 0
    }
  }],

  // Generator Checks
  DG_Age_Check: {
    type: String,
    enum: ['PROB', 'ok'],
    required: false
  },
  Hour_Meter_Check: {
    type: String,
    enum: ['PROB', 'ok'],
    required: false
  },
  Total_Run_Hours_All_Generators: {
    type: Number,
    required: false,
    min: 0
  },
  DG_vs_Hours: {
    type: Number,
    required: false
  },
  Grid_Gen_Percentage: {
    type: Number,
    required: false,
    min: 0,
    max: 100
  },
  Automatization_Status: {
    type: String,
    enum: ['OK', 'NOK'],
    required: false
  },
  CH_Next_Vidange: {
    type: Number,
    required: false,
    min: 0
  },

  // Parts Used During Visit (Integrated with Parts Database)
  Parts_Used_During_Visit: [{
    part_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Part',
      required: true
    },
    part_name: {
      type: String,
      required: true,
      trim: true
    },
    part_number: {
      type: String,
      required: false,
      trim: true
    },
    quantity_used: {
      type: Number,
      required: true,
      min: 0
    },
    category: {
      type: String,
      required: false,
      trim: true
    },
    replaced_date: {
      type: Date,
      default: Date.now
    },
    technician_notes: {
      type: String,
      required: false,
      trim: true
    }
  }],

  // Legacy Parts Fields (for backward compatibility and manual entry)
  Legacy_Parts_Used: {
    Belt: {
      type: Number,
      required: false,
      min: 0
    },
    Oil_Filter: {
      type: Number,
      required: false,
      min: 0
    },
    Fuel_Filter: {
      type: Number,
      required: false,
      min: 0
    },
    Separ_Filter: {
      type: Number,
      required: false,
      min: 0
    },
    Air_Filter: {
      type: Number,
      required: false,
      min: 0
    },
    Qty_of_Oil_Changed: {
      type: Number,
      required: false,
      min: 0
    },
    Qty_of_Radiator_Water: {
      type: Number,
      required: false,
      min: 0
    },
    Dirty_Oil: {
      type: Number,
      required: false,
      min: 0
    }
  },

  // Issues Found During Visit
  Issues_Found: {
    DG_Issues: {
      type: String,
      required: false,
      trim: true
    },
    IPT_BB_Issues: {
      type: String,
      required: false,
      trim: true
    },
    Issue_of_Aircon: {
      type: String,
      required: false,
      trim: true
    },
    Issue_of_Solar: {
      type: String,
      required: false,
      trim: true
    },
    Any_Other_Issue: {
      type: String,
      required: false,
      trim: true
    }
  },

  Parts_Replaced: {
    type: String,
    required: false,
    trim: true
  },

  // Power Cabinet and Equipment
  Power_Cab_1_Type: {
    type: String,
    required: false,
    trim: true
  },

  // Solar Information (Enriched)
  Solar_System: {
    installed: String, // Yes/No
    cabinet_manufacturer: String,
    controller_manufacturer: String,
    controller_type: String,
    converters_functional: Number,
    converters_faulty: Number,
    converters_empty: Number,
    controller_capacity: Number, // W
    
    panel_manufacturer: String,
    panel_count: Number,
    panel_unit_capacity: Number, // W
    panel_voltage: Number, // V
    panel_broken_count: Number,
    total_capacity: Number, // kW
    
    combiner_box_count: Number,
    combiner_box_voltage: Number,
    lightning_protection: String
  },

  // Air Conditioning (Enriched)
  AC_System: {
    count: Number,
    units: [{
      brand: String,
      type: { type: String }, // 'type' is reserved, so we must nest it
      capacity: String, // BTU or KW
      gas_type: String,
      remote_status: String,
      issue: String,
      status: String
    }]
  },

  // Load Measurements (Enriched)
  Load_Readings: {
    phase_1_amps: Number,
    phase_2_amps: Number,
    phase_3_amps: Number,
    
    // Client Loads
    mtn_load_amps: Number,
    ocm_load_amps: Number,
    camtel_load_amps: Number,
    
    site_dc_load_amps: Number,
    ac_non_telco_load_amps: Number,
    avg_load_on_dg_kw: Number
  },

  // Security Detail (Enriched)
  Security_Detail: {
    company_name: String,
    guards: [{
      name: String,
      phone: String
    }],
    incident_history: String
  },

  // Rectifier Information (Enhanced for multiple rectifiers)
  Rectifiers: [{
    type: {
      type: String,
      required: false,
      trim: true
    },
    number_of_rectifiers: {
      type: Number,
      required: false,
      min: 0
    },
    capacity_of_one_rectifier: {
      type: Number,
      required: false,
      min: 0
    }
  }],

  // Battery Information (Enhanced for multiple batteries)
  Batteries: [{
    number_of_batteries: {
      type: Number,
      required: false,
      min: 0
    },
    battery_capacity: {
      type: String,
      required: false,
      trim: true
    },
    battery_autonomy: {
      type: Number,
      required: false,
      min: 0
    },
    battery_threshold_to_start_dg: {
      type: Number,
      required: false,
      min: 0
    }
  }],

  // System Status
  Alarm_Cable_Status: {
    type: String,
    required: false,
    trim: true
  },

  // Visit Comments
  Visit_Comments: {
    type: String,
    required: false,
    trim: true
  },

  visit_history: [{
    visit_id: {
      type: String,
      required: true
    },
    Actual_Date_Visit: {
      type: Date,
      required: true
    },
    Previous_Date_Visit: Date,
    Time_Passed: Number,
    Type_of_Visit: {
      type: String,
      enum: ['PM', 'END', 'RF', 'PM+END', 'PM+RF', 'RF+END', 'PM+RF+END'],
      required: true
    },
    Technician_Name: String,
    technician_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // Electrical Information
    Earthing_OHM: Number,
    ENEO_Working: String,
    Phase_Type: String,
    N_PH1_Voltage: Number,
    N_PH2_Voltage: Number,
    N_PH3_Voltage: Number,
    ENEO_Meter_Number: String,
    ENEO_SQ_Check: String,
    Actual_Index: Number,
    Previous_Index: Number,
    Consumed_KWA: Number,
    Comments_on_Grid: String,

    // Fuel Information
    Type_de_Tank: String,
    Tank_Capacity_1: Number,
    Fuel_SQ_Check: String,
    Tank_Length: Number,
    Tank_Width: Number,
    Tank_Height: Number,
    Previous_Fuel_Quantity: Number,
    Fuel_Quantity_Found: Number,
    Height_Found_CM_1: Number,
    Fuel_Quantity_Added: Number,
    Fuel_Quantity_Consumed: Number,

    // Generator Information
    Generators_Details: [mongoose.Schema.Types.Mixed],
    Number_of_Generators: Number,
    DG_Age_Check: String,
    Hour_Meter_Check: String,
    Automatization_Status: String,

    // Equipment
    Power_Cab_1_Type: String,
    Alarm_Cable_Status: String,
    Rectifiers: [mongoose.Schema.Types.Mixed],
    Batteries: [mongoose.Schema.Types.Mixed],

    // Parts and Issues
    Parts_Used_During_Visit: [{
      part_id: mongoose.Schema.Types.ObjectId,
      part_name: String,
      quantity_used: Number,
      technician_notes: String
    }],
    Issues_Found: {
      DG_Issues: String,
      IPT_BB_Issues: String,
      Issue_of_Aircon: String,
      Issue_of_Solar: String,
      Any_Other_Issue: String
    },

    // Documentation
    Parts_Replaced: String,
    Visit_Comments: String,
    photos: [{
      url: String,
      category: {
        type: String,
        default: 'general'
      },
      description: String,
      uploaded_at: {
        type: Date,
        default: Date.now
      }
    }],

    // Metadata
    submission_date: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['submitted', 'reviewed', 'approved', 'rejected'],
      default: 'submitted'
    },
    submitted_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    review_date: Date,
    review_comments: String
  }],

  // Maintenance Tracking
  Last_Maintenance: {
    date: {
      type: Date,
      required: false
    },
    type: {
      type: String,
      enum: ['PM', 'Corrective', 'Emergency'],
      required: false
    },
    technician: {
      type: String,
      required: false,
      trim: true
    },
    parts_replaced: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Part'
    }],
    next_due_date: {
      type: Date,
      required: false
    }
  },

  // Visit Statistics
  Visit_Stats: {
    total_visits: {
      type: Number,
      default: 0
    },
    last_pm_visit: {
      type: Date,
      required: false
    },
    last_emergency_visit: {
      type: Date,
      required: false
    },
    average_visit_interval: {
      type: Number, // in days
      required: false
    },
    total_parts_replaced: {
      type: Number,
      default: 0
    }
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// EXISTING INDEXES
siteSchema.index({ IHS_ID_SITE: 1 });
siteSchema.index({ Site_Name: 1 });
siteSchema.index({ Region: 1 });
siteSchema.index({ Current_Generators: 1 });
siteSchema.index({ Primary_Generator: 1 });

// NEW INDEXES FOR VISIT TRACKING
siteSchema.index({ Actual_Date_Visit: -1 });
siteSchema.index({ Type_of_Visit: 1 });
siteSchema.index({ Technician_Name: 1 });
siteSchema.index({ 'Parts_Used_During_Visit.part_id': 1 });

siteSchema.index({ cluster: 1 });
siteSchema.index({ GRATO_Cluster: 1 });

// EXISTING VIRTUALS
siteSchema.virtual('generator_count').get(function () {
  return this.Current_Generators ? this.Current_Generators.length : 0;
});

// NEW VIRTUALS
siteSchema.virtual('days_since_last_visit').get(function () {
  if (!this.Actual_Date_Visit) return null;
  const today = new Date();
  const lastVisit = new Date(this.Actual_Date_Visit);
  return Math.floor((today - lastVisit) / (1000 * 60 * 60 * 24));
});

siteSchema.virtual('needs_visit').get(function () {
  const daysSinceLastVisit = this.days_since_last_visit;
  return daysSinceLastVisit === null || daysSinceLastVisit > 90; // 90 days threshold
});

siteSchema.virtual('total_parts_used_current_visit').get(function () {
  if (!this.Parts_Used_During_Visit) return 0;
  return this.Parts_Used_During_Visit.reduce((total, part) => total + part.quantity_used, 0);
});


siteSchema.pre('save', function (next) {
  if (this.ENEO_Working) {
    this.ENEO_Working = this.ENEO_Working.toUpperCase();
  }

  // Normalize Phase_Type
  if (this.Phase_Type) {
    const phaseMap = {
      'single': 'Mono',
      'three': 'TRI',
      'mono': 'Mono',
      'tri': 'TRI'
    };
    this.Phase_Type = phaseMap[this.Phase_Type.toLowerCase()] || this.Phase_Type;
  }

  // Normalize ENEO_SQ_Check
  if (this.ENEO_SQ_Check) {
    this.ENEO_SQ_Check = this.ENEO_SQ_Check.toLowerCase() === 'ok' ? 'ok' : 'PROB';
  }

  // Normalize Type_de_Tank
  if (this.Type_de_Tank) {
    const tankMap = {
      'underground': 'INT',
      'surface': 'EXT',
      'int': 'INT',
      'ext': 'EXT'
    };
    this.Type_de_Tank = tankMap[this.Type_de_Tank.toLowerCase()] || this.Type_de_Tank;
  }

  // Normalize Fuel_SQ_Check
  if (this.Fuel_SQ_Check) {
    this.Fuel_SQ_Check = this.Fuel_SQ_Check.toLowerCase() === 'ok' ? 'ok' : 'PROB';
  }

  next();
});

// EXISTING INSTANCE METHODS
siteSchema.methods.assignGenerator = function (generatorId, assignmentType = 'primary', assignedBy = null) {
  if (!this.Current_Generators) this.Current_Generators = [];
  if (!this.Generator_Assignment_History) this.Generator_Assignment_History = [];

  if (this.Current_Generators.includes(generatorId)) {
    throw new Error('Generator is already assigned to this site');
  }

  if (this.Current_Generators.length >= 2) {
    throw new Error('Site already has maximum number of generators (2)');
  }

  this.Current_Generators.push(generatorId);

  if (assignmentType === 'primary' || this.Current_Generators.length === 1) {
    this.Primary_Generator = generatorId;
  } else {
    this.Secondary_Generator = generatorId;
  }

  this.Generator_Assignment_History.push({
    generator_id: generatorId,
    assigned_date: new Date(),
    assignment_type: assignmentType,
    assigned_by: assignedBy,
    status: 'active'
  });

  return this;
};

siteSchema.methods.removeGenerator = function (generatorId, removedBy = null) {
  if (!this.Current_Generators) return this;

  this.Current_Generators = this.Current_Generators.filter(id => id !== generatorId);

  if (this.Primary_Generator === generatorId) {
    this.Primary_Generator = this.Current_Generators[0] || null;
  }
  if (this.Secondary_Generator === generatorId) {
    this.Secondary_Generator = this.Current_Generators[1] || null;
  }

  const historyEntry = this.Generator_Assignment_History.find(
    entry => entry.generator_id === generatorId && entry.status === 'active'
  );
  if (historyEntry) {
    historyEntry.removed_date = new Date();
    historyEntry.status = 'removed';
  }

  return this;
};

siteSchema.methods.replaceGenerator = function (oldGeneratorId, newGeneratorId, assignedBy = null) {
  const assignmentType = this.Primary_Generator === oldGeneratorId ? 'primary' : 'secondary';

  this.removeGenerator(oldGeneratorId, assignedBy);

  const historyEntry = this.Generator_Assignment_History.find(
    entry => entry.generator_id === oldGeneratorId && entry.status === 'removed'
  );
  if (historyEntry) {
    historyEntry.status = 'replaced';
  }

  this.assignGenerator(newGeneratorId, assignmentType, assignedBy);

  return this;
};

// NEW INSTANCE METHODS FOR VISIT MANAGEMENT
siteSchema.methods.recordVisit = function (visitData, technicianName) {
  // Add to visit history
  if (!this.Visit_History) this.Visit_History = [];

  const visitRecord = {
    visit_date: visitData.visit_date || new Date(),
    visit_type: visitData.visit_type,
    technician_name: technicianName,
    parts_used: visitData.parts_used || [],
    issues_found: visitData.issues_found,
    actions_taken: visitData.actions_taken,
    visit_duration: visitData.visit_duration,
    visit_notes: visitData.visit_notes
  };

  this.Visit_History.push(visitRecord);

  // Update current visit fields
  this.Previous_Date_Visit = this.Actual_Date_Visit;
  this.Actual_Date_Visit = visitRecord.visit_date;
  this.Type_of_Visit = visitRecord.visit_type;
  this.Technician_Name = technicianName;

  return this;
};

siteSchema.methods.addPartsUsed = function (partsArray) {
  if (!this.Parts_Used_During_Visit) this.Parts_Used_During_Visit = [];

  partsArray.forEach(part => {
    this.Parts_Used_During_Visit.push({
      part_id: part.part_id,
      part_name: part.part_name,
      part_number: part.part_number,
      quantity_used: part.quantity_used,
      category: part.category,
      technician_notes: part.technician_notes
    });
  });

  return this;
};

siteSchema.methods.getVisitSummary = function () {
  const summary = {
    site_id: this.IHS_ID_SITE,
    site_name: this.Site_Name,
    last_visit: this.Actual_Date_Visit,
    days_since_last_visit: this.days_since_last_visit,
    needs_visit: this.needs_visit,
    total_visits: this.Visit_Stats?.total_visits || 0,
    total_parts_used: this.Visit_Stats?.total_parts_replaced || 0,
    current_issues: []
  };

  // Collect current issues
  if (this.Issues_Found) {
    Object.entries(this.Issues_Found).forEach(([key, value]) => {
      if (value && value.trim()) {
        summary.current_issues.push({
          type: key.replace(/_/g, ' '),
          description: value
        });
      }
    });
  }

  return summary;
};

siteSchema.methods.calculateNextMaintenanceDue = function () {
  if (!this.Generators_Details || this.Generators_Details.length === 0) {
    return null;
  }

  // Find the generator with the highest maintenance cycle
  const maintenanceCycles = this.Generators_Details
    .map(gen => gen.maintenance_cycle)
    .filter(cycle => cycle && cycle > 0);

  if (maintenanceCycles.length === 0) {
    return null;
  }

  const shortestCycle = Math.min(...maintenanceCycles);

  if (this.Actual_Date_Visit) {
    const nextDueDate = new Date(this.Actual_Date_Visit);
    nextDueDate.setDate(nextDueDate.getDate() + shortestCycle);
    return nextDueDate;
  }

  return null;
};

siteSchema.methods.checkForAnomalies = function () {
  const anomalies = [];

  // Check ENEO SQ
  if (this.ENEO_SQ_Check === 'PROB') {
    anomalies.push({
      type: 'ENEO_CHECK',
      message: 'ENEO meter check failed',
      severity: 'high'
    });
  }

  // Check Fuel SQ
  if (this.Fuel_SQ_Check === 'PROB') {
    anomalies.push({
      type: 'FUEL_CHECK',
      message: 'Fuel quantity check failed',
      severity: 'high'
    });
  }

  // Check DG Age
  if (this.DG_Age_Check === 'PROB') {
    anomalies.push({
      type: 'DG_AGE',
      message: 'Generator age check failed',
      severity: 'medium'
    });
  }

  // Check Hour Meter
  if (this.Hour_Meter_Check === 'PROB') {
    anomalies.push({
      type: 'HOUR_METER',
      message: 'Hour meter check failed',
      severity: 'medium'
    });
  }

  // Check Automatization
  if (this.Automatization_Status === 'NOK') {
    anomalies.push({
      type: 'AUTOMATIZATION',
      message: 'Generator automatization not working',
      severity: 'high'
    });
  }

  // Check if visit is overdue
  if (this.days_since_last_visit && this.days_since_last_visit > 90) {
    anomalies.push({
      type: 'OVERDUE_VISIT',
      message: `Visit overdue by ${this.days_since_last_visit - 90} days`,
      severity: 'medium'
    });
  }

  return anomalies;
};

module.exports = mongoose.model('Site', siteSchema);
