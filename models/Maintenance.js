const mongoose = require('mongoose');

// This model represents both TASKS (assigned work) and VISITS (completed work)
// A record starts as a task assignment and evolves into a visit record
const maintenanceSchema = new mongoose.Schema({
  // Core identification
  maintenance_id: {
    type: String,
    unique: true,
    required: true
  },

  // Required Actions (Scope of Work) - DEPRECATED
  // required_actions: [{
  //   type: String,
  //   enum: ['generator', 'fuel_refill', 'cleaning', 'power_cabinet', 'grid', 'shelter', 'fuel_tank_inspection']
  // }],

  // Site and Visit Reference
  site_id: {
    type: String,
    required: true,
    index: true
  },
  site_name: String,
  visit_reference: {
    type: String, // Links to Site.visit_history[].visit_id when visit is completed
    required: false // Not required until visit is submitted
  },

  source: {
    type: String,
    enum: ['data_collector_excel', 'validation_template_main', 'technician_app', 'manual'],
    index: true,
  },

  // ── Workflow tracking (maintenance-flow) ─────────────────────────────────────
  workflow_status: {
    type: String,
    enum: ['initiated', 'activated', 'checked_in', 'form_opened', 'form_submitted', 'checked_out'],
    default: null
  },
  workflow_history: [{
    status: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  }],
  workflow_last_updated: {
    type: Date,
    default: null
  },

  // Personnel
  technician: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  technician_name: String,
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Visit Details
  visit_type: {
    type: String,
    enum: ['PM', 'END', 'RF', 'PM+END', 'PM+RF', 'RF+END', 'PM+RF+END'],
    required: true
  },
  visit_date: {
    type: Date,
    required: true
  },
  // Site entry/exit tracking (technician clock-in/out per site)
  site_entries: [{
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    site_id: String,
    entry_time: Date,
    exit_time: Date,
    entry_location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    exit_location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    notes: String
  }],
  prev_visit_date: Date,
  hours_on_site: Number,
  sbc: String,

  // Site Metadata
  site_metadata: {
    cluster: String,
    site_priority: String,
    state: String,
    operator: String,
    power_topology: String,
    outdoor_indoor: String
  },

  // Process Tracking
  process_tracking: {
    ongoing_process_num: String,
    pm_end_process_num: String,
    rf_process_num: String
  },

  // Work Details
  work_performed: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  issues_found: {
    DG_Issues: String,
    IPT_BB_Issues: String,
    Issue_of_Aircon: String,
    Issue_of_Solar: String,
    Any_Other_Issue: String,
    Parts_Replaced: String,
    Issues_Corrective_Date: Date
  },

  // Parts Management
  parts_used: [{
    part_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Part'
    },
    part_name: String,
    part_number: String,
    quantity_used: Number,
    technician_notes: String
  }],

  // Generator Information (from visit)
  generators_checked: [{
    generator_number: Number,
    brand: String,
    engine_brand: String,
    serial_number: String,
    maintenance_cycle: String,
    kva: Number,
    dg_age_check: String,
    dg_age: String,
    hour_meter_check: String,
    ch_actuel: Number,
    ch_ancien: Number,
    run_hours: Number,
    cph: Number,
    load_1ph: Number,
    load_2ph: Number,
    load_3ph: Number,
    dc_load: Number,
    comments_cph: String
  }],

  // Combined Stats
  combined_stats: {
    total_run_hour: Number,
    ccph: Number,
    cl: Number,
    pertes: Number,
    dg_vs_hours: String,
    grid_gen_percent: Number,
    reason_grid_gen_percent: String,
    automatization_status: String,
    ch_next_vidange: Number
  },

  // Fuel Information
  fuel_data: {
    fuel_card_number: String,
    tom_card_debit: Number,
    price_per_liter: Number,
    tank_type: { type: String, enum: ['EXT', 'INT'] },
    tank_capacity: Number,
    tank_dimensions: {
      long: Number,
      large: Number,
      hauteur: Number,
      coeficiant: Number
    },
    fond_de_cuve: Number,
    fuel_sq_check: String,
    qte_precedente: Number,
    hauteur_gasoil_trouvee_cm: Number,
    qte_trouvee: Number,
    qte_t_cms: Number,
    qte_ajoutee: Number,
    qte_laissee: Number,
    qte_l_cms: Number,
    qte_consommee: Number
  },

  // Detailed Equipment Checklists (New format)
  equipment_checks: {
    generator_checks: [{
      equipment_id: String,
      battery_status: { type: Boolean, default: null },
      battery_status_comment: String,
      fan_belt_status: { type: Boolean, default: null },
      fan_belt_status_comment: String,
      radiator_status: { type: Boolean, default: null },
      radiator_status_comment: String,
      coolant_status: { type: Boolean, default: null },
      coolant_status_comment: String,
      running_hours: Number,
      running_hours_comment: String,
      fuel_filter_changed: { type: Boolean, default: null },
      fuel_filter_changed_comment: String,
      oil_filter_changed: { type: Boolean, default: null },
      oil_filter_changed_comment: String,
      air_filter_changed: { type: Boolean, default: null },
      air_filter_changed_comment: String,
      oil_level_max: { type: Boolean, default: null },
      oil_level_max_comment: String,
      oil_quality_checked: { type: Boolean, default: null },
      oil_quality_checked_comment: String,
      fuel_leakage_checked: { type: Boolean, default: null },
      fuel_leakage_checked_comment: String,
      alarms_status_checked: { type: Boolean, default: null },
      alarms_status_checked_comment: String,
      electrical_readings: {
        i1: Number, i2: Number, i3: Number,
        v1: Number, v2: Number, v3: Number,
        photos: [String]
      },
      comments: String,
      // Individual check tracking
      status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'] },
      checked_at: Date,
      checked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      submitted_at: Date,
      reviewed_at: Date,
      reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      supervisor_comments: String,
      rejection_reason: String
    }],
    power_cabinet_checks: [{
      type: mongoose.Schema.Types.Mixed, // Flexible storage for tabbed data
      // Individual check tracking
      status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'] },
      checked_at: Date,
      checked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      submitted_at: Date,
      reviewed_at: Date,
      reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      supervisor_comments: String,
      rejection_reason: String
    }],
    grid_checks: {
      status: Boolean,
      status_comment: String,
      breaker_status: Boolean,
      breaker_status_comment: String,
      grid_index: String,
      grid_index_comment: String,
      grid_connected_operational: Boolean,
      grid_connected_operational_comment: String,
      grid_stable: Boolean,
      grid_stable_comment: String,
      meter_photos: [String],
      // Individual check tracking
      check_status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'] },
      checked_at: Date,
      checked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      submitted_at: Date,
      reviewed_at: Date,
      reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      supervisor_comments: String,
      rejection_reason: String
    },
    shelter_checks: {
      status: Boolean,
      status_comment: String,
      door_status: Boolean,
      door_status_comment: String,
      temperature: Number,
      temperature_comment: String,
      controller_status: Boolean,
      controller_status_comment: String,
      ac_type: String,
      internal_filter_cleaned: Boolean,
      internal_filter_cleaned_comment: String,
      outdoor_compressor_cleaned: Boolean,
      outdoor_compressor_cleaned_comment: String,
      high_low_pressure_measured: Boolean,
      high_low_pressure_measured_comment: String,
      temperature_recorded: String,
      temperature_recorded_comment: String,
      amps_measured: Boolean,
      amps_measured_comment: String,
      condenser_evaporator_cleaned: Boolean,
      condenser_evaporator_cleaned_comment: String,
      outdoor_fan_checked: Boolean,
      outdoor_fan_checked_comment: String,
      ac_units: [{
        status: Boolean,
        comments: String
      }],
      // Individual check tracking
      check_status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'] },
      checked_at: Date,
      checked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      submitted_at: Date,
      reviewed_at: Date,
      reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      supervisor_comments: String,
      rejection_reason: String
    },
    cleaning_checks: {
      is_clean: Boolean,
      is_clean_comment: String,
      spillage: Boolean,
      spillage_comment: String,
      security_light: Boolean,
      security_light_comment: String,
      guard_present: Boolean,
      guard_present_comment: String,
      security_box: Boolean,
      security_box_comment: String,
      inside_clean: Boolean,
      inside_clean_comment: String,
      outside_perimeter_clean: Boolean,
      outside_perimeter_clean_comment: String,
      shelter_cleaned: Boolean,
      shelter_cleaned_comment: String,
      outdoor_equipment_cleaned: Boolean,
      outdoor_equipment_cleaned_comment: String,
      air_blower_used: Boolean,
      air_blower_used_comment: String,
      comments: String,
      photos: [String],
      // Individual check tracking
      check_status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'] },
      checked_at: Date,
      checked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      submitted_at: Date,
      reviewed_at: Date,
      reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      supervisor_comments: String,
      rejection_reason: String
    },
    fuel_tank_checks: { // Physical inspection separate from Refueling
      status: Boolean,
      status_comment: String,
      separating_filter: Boolean,
      separating_filter_comment: String,
      water_in_tank: Boolean,
      water_in_tank_comment: String,
      fuel_line: Boolean,
      fuel_line_comment: String,
      is_waterproof: Boolean,
      is_waterproof_comment: String,
      comments: String,
      // Individual check tracking
      check_status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'] },
      checked_at: Date,
      checked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      submitted_at: Date,
      reviewed_at: Date,
      reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      supervisor_comments: String,
      rejection_reason: String
    }
  },

  // PM Check (Legacy)
  pm_checks: {
    belt: String,
    oil_filter: String,
    fuel_filter: String,
    separ_filter: String,
    air_filter: String,
    qty_oil_changed: Number,
    qty_radiator_water: Number,
    dirty_oil: String
  },

  // Power Systems
  power_systems: {
    power_cabinets: [{
      cabinet_number: Number,
      type: String,
      rectifier_type: String,
      num_rectifiers: Number,
      capacity_per_rectifier: Number,
      num_batteries: Number,
      battery_capacity: String,
      battery_autonomy: Number
    }],
    battery_threshold_dg_start: Number
  },

  // Electrical Readings
  electrical_data: {
    earthing_ohm: Number,
    eneo_working: String,
    phase_type: String,
    n_ph1_voltage: Number,
    n_ph2_voltage: Number,
    n_ph3_voltage: Number,
    eneo_meter_number: String,
    eneo_sq_check: String,
    actual_index: Number,
    previous_index: Number,
    consumed_kwa: Number,
    comments_on_grid: String
  },

  // Equipment Checks (Dynamic)
  equipment_checks: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Photos (NEW)
  photos: [{
    url: {
      type: String,
      required: true
    },
    category: {
      type: String,
      enum: ['before', 'during', 'after', 'issue', 'parts', 'general'],
      default: 'general'
    },
    description: String,
    uploaded_at: {
      type: Date,
      default: Date.now
    }
  }],

  // Status Workflow - Unified for both task assignment and visit completion
  // 'pending' = task assigned but not started
  // 'scheduled' = task scheduled for specific date
  // 'in_progress' = technician working on site
  // 'draft' = visit form saved but not submitted
  // 'pending_approval' = visit submitted, awaiting supervisor review
  // 'approved' = visit approved by supervisor
  // 'rejected' = visit rejected, needs revision
  // 'completed' = fully completed and approved visit
  status: {
    type: String,
    enum: ['pending', 'scheduled', 'in_progress', 'draft', 'pending_approval', 'approved', 'rejected', 'completed'],
    default: 'pending',
    index: true
  },

  // Task Assignment Details
  scheduled_date: Date, // When task is scheduled to be performed
  assigned_date: {
    type: Date,
    default: Date.now
  },
  due_date: Date,

  // Draft Management (for visit forms)
  is_draft: {
    type: Boolean,
    default: false
  },
  draft_saved_at: Date,

  // Approval Workflow
  submitted_at: Date,
  reviewed_at: Date,
  reviewed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  review_comments: String,
  rejection_reason: String,

  // Completion
  completed_at: Date,
  completion_notes: String,

  // Edit History (NEW)
  edit_history: [{
    edited_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    edited_at: {
      type: Date,
      default: Date.now
    },
    changes: mongoose.Schema.Types.Mixed, // Stores what changed
    reason: String
  }],

  // Metadata
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical', 'Low', 'Medium', 'High', 'Critical'],
    default: 'medium'
  },
  estimated_duration: Number, // in hours
  actual_duration: Number,

  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
maintenanceSchema.index({ technician: 1, status: 1 });
maintenanceSchema.index({ supervisor: 1, status: 1 });
maintenanceSchema.index({ site_id: 1 });
maintenanceSchema.index({ visit_date: -1 });
maintenanceSchema.index({ submitted_at: -1 });
maintenanceSchema.index({ site_id: 1, visit_date: 1, source: 1 });

// Virtual for days since submission
maintenanceSchema.virtual('days_pending').get(function () {
  if (!this.submitted_at || this.status !== 'pending_approval') return null;
  return Math.floor((Date.now() - this.submitted_at) / (1000 * 60 * 60 * 24));
});

// Virtual for priority score
maintenanceSchema.virtual('priority_score').get(function () {
  const priorityScores = { low: 1, medium: 2, high: 3, critical: 4 };
  const baseScore = priorityScores[this.priority] || 2;
  const urgencyBonus = this.days_pending > 3 ? 1 : 0;
  return baseScore + urgencyBonus;
});

// Pre-save: Generate maintenance_id
maintenanceSchema.pre('save', function (next) {
  if (!this.maintenance_id) {
    this.maintenance_id = `MAINT_${this.site_id}_${Date.now()}`;
  }
  next();
});

// Instance method: Submit for approval
maintenanceSchema.methods.submitForApproval = async function () {
  if (this.status !== 'draft') {
    throw new Error('Can only submit drafts');
  }

  this.status = 'pending_approval';
  this.is_draft = false;
  this.submitted_at = new Date();

  return this.save();
};

// Instance method: Approve
maintenanceSchema.methods.approve = async function (reviewerId, comments) {
  if (this.status !== 'pending_approval') {
    throw new Error('Can only approve pending maintenance');
  }

  this.status = 'approved';
  this.reviewed_by = reviewerId;
  this.reviewed_at = new Date();
  this.review_comments = comments;

  return this.save();
};

// Instance method: Reject
maintenanceSchema.methods.reject = async function (reviewerId, reason) {
  if (this.status !== 'pending_approval') {
    throw new Error('Can only reject pending maintenance');
  }

  this.status = 'rejected';
  this.reviewed_by = reviewerId;
  this.reviewed_at = new Date();
  this.rejection_reason = reason;

  return this.save();
};

// Instance method: Log edit
maintenanceSchema.methods.logEdit = function (userId, changes, reason) {
  this.edit_history.push({
    edited_by: userId,
    edited_at: new Date(),
    changes: changes,
    reason: reason
  });

  return this;
};

// Instance method: Mark complete
maintenanceSchema.methods.markComplete = async function (notes) {
  if (this.status !== 'approved') {
    throw new Error('Can only complete approved maintenance');
  }

  this.status = 'completed';
  this.completed_at = new Date();
  this.completion_notes = notes;

  if (this.submitted_at) {
    this.actual_duration = Math.floor(
      (this.completed_at - this.submitted_at) / (1000 * 60 * 60)
    );
  }

  return this.save();
};

// Static method: Get pending for supervisor
maintenanceSchema.statics.getPendingForSupervisor = function (supervisorId) {
  return this.find({
    supervisor: supervisorId,
    status: 'pending_approval'
  })
    .populate('technician', 'fullName email phone')
    .populate('parts_used.part_id', 'name part_number category')
    .sort({ submitted_at: 1 }); // Oldest first
};

// Static method: Get tasks for technician
maintenanceSchema.statics.getTasksForTechnician = function (technicianId, statusFilter = null) {
  const query = { technician: technicianId };

  if (statusFilter) {
    query.status = statusFilter;
  } else {
    query.status = { $in: ['draft', 'approved', 'in_progress'] };
  }

  return this.find(query)
    .populate('supervisor', 'fullName email phone')
    .sort({ visit_date: -1 });
};

module.exports = mongoose.model('Maintenance', maintenanceSchema);

