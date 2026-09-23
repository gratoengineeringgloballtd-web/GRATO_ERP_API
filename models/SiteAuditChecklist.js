const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    category: {
      type: String,
      enum: ['general', 'site', 'equipment', 'issue', 'before', 'after'],
      default: 'general'
    },
    description: { type: String, default: '' },
    uploaded_at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const siteAuditChecklistSchema = new mongoose.Schema(
  {
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Site',
      required: true,
      index: true
    },
    site_name: { type: String, trim: true },
    site_code: { type: String, trim: true },
    region: { type: String, trim: true },
    sub_region: { type: String, trim: true },
    access_ref: { type: String, trim: true },
    time_in: { type: String, trim: true },
    time_out: { type: String, trim: true },

    status: {
      type: String,
      enum: ['draft', 'submitted'],
      default: 'draft',
      index: true
    },

    janitorial: {
      inside_clean: { type: Boolean, default: null },
      outside_perimeter_clean: { type: Boolean, default: null },
      shelter_cleaned: { type: Boolean, default: null },
      outdoor_equipment_cleaned: { type: Boolean, default: null },
      air_blower_used: { type: Boolean, default: null }
    },

    fumigation: {
      rat_mice_signs_checked: { type: Boolean, default: null },
      chemicals_applied: { type: Boolean, default: null }
    },

    generator: {
      capacity: { type: String, trim: true },
      generator_brand: { type: String, trim: true },
      engine_brand: { type: String, trim: true },
      alternator_brand: { type: String, trim: true },
      controller_brand: { type: String, trim: true },
      running_hours: { type: String, trim: true },
      clean_inside_outside: { type: Boolean, default: null },
      fuel_filter_changed: { type: Boolean, default: null },
      oil_filter_changed: { type: Boolean, default: null },
      air_filter_changed: { type: Boolean, default: null },
      oil_leakage_checked: { type: Boolean, default: null },
      oil_level_max: { type: Boolean, default: null },
      oil_quality_checked: { type: Boolean, default: null },
      radiator_status_checked: { type: Boolean, default: null },
      fan_belt_checked: { type: Boolean, default: null },
      thermostat_checked: { type: Boolean, default: null },
      radiator_hoses_checked: { type: Boolean, default: null },
      coolant_level_checked: { type: Boolean, default: null },
      water_pump_checked: { type: Boolean, default: null },
      fuel_leakage_checked: { type: Boolean, default: null },
      fuel_piping_status_checked: { type: Boolean, default: null },
      water_separator_filter_checked: { type: Boolean, default: null },
      battery_and_charger_checked: { type: Boolean, default: null },
      dc_charge_alternator_belt_checked: { type: Boolean, default: null },
      kick_starter_checked: { type: Boolean, default: null },
      controller_status_checked: { type: Boolean, default: null },
      alarms_status_checked: { type: Boolean, default: null },
      temp_oil_sensors_checked: { type: Boolean, default: null },
      exhaust_system_checked: { type: Boolean, default: null },
      silencer_checked: { type: Boolean, default: null }
    },

    ats_system: {
      loose_connections_checked: { type: Boolean, default: null },
      components_checked: { type: Boolean, default: null },
      test_functioning_done: { type: Boolean, default: null }
    },

    grid: {
      grid_index: { type: String, trim: true },
      grid_connected_operational: { type: Boolean, default: null },
      grid_stable: { type: Boolean, default: null }
    },

    avr: {
      physical_status_ok: { type: Boolean, default: null },
      input_output_measured: { type: Boolean, default: null }
    },

    fuel_tank: {
      capacity_height_cm: { type: String, trim: true },
      capacity_width_cm: { type: String, trim: true },
      capacity_depth_cm: { type: String, trim: true },
      quantity_found: { type: String, trim: true },
      quantity_refueled: { type: String, trim: true },
      cap_closed_attached: { type: Boolean, default: null },
      water_separator_filter_changed: { type: Boolean, default: null },
      fuel_pipes_leak_checked: { type: Boolean, default: null },
      connected_to_earthing: { type: Boolean, default: null },
      fuel_certificate_issued: { type: Boolean, default: null }
    },

    air_conditioning: {
      ac_type: { type: String, trim: true },
      internal_filter_cleaned: { type: Boolean, default: null },
      outdoor_compressor_cleaned: { type: Boolean, default: null },
      high_low_pressure_measured: { type: Boolean, default: null },
      temperature_recorded: { type: String, trim: true },
      amps_measured: { type: Boolean, default: null },
      condenser_evaporator_cleaned: { type: Boolean, default: null },
      outdoor_fan_checked: { type: Boolean, default: null }
    },

    canopy: {
      rust_checked: { type: Boolean, default: null },
      lighting_sockets_working: { type: Boolean, default: null },
      roofing_sheets_good: { type: Boolean, default: null },
      connected_to_earthing: { type: Boolean, default: null },
      structure_stable: { type: Boolean, default: null },
      foundation_no_cracks: { type: Boolean, default: null },
      foundation_cracks_rectified: { type: Boolean, default: null }
    },

    cable_tray: {
      rust_checked: { type: Boolean, default: null },
      fixed_firmly: { type: Boolean, default: null },
      cable_section_checked: { type: Boolean, default: null },
      connected_to_earthing: { type: Boolean, default: null },
      cables_tightened: { type: Boolean, default: null },
      cables_have_lugs: { type: Boolean, default: null }
    },

    fence: {
      fence_type: { type: String, trim: true },
      rust_checked: { type: Boolean, default: null },
      no_anomaly_access: { type: Boolean, default: null },
      gate_locking_operational: { type: Boolean, default: null },
      razor_wire_available: { type: Boolean, default: null },
      connected_to_earthing: { type: Boolean, default: null }
    },

    power_rectifiers: {
      modules_found: { type: String, trim: true },
      modules_missing: { type: String, trim: true },
      rectifier_type_capacity: { type: String, trim: true },
      breakers_checked: { type: Boolean, default: null },
      output_voltage: { type: String, trim: true },
      cabling_status_good: { type: Boolean, default: null }
    },

    power_batteries: {
      batteries_count: { type: String, trim: true },
      unit_battery_capacity: { type: String, trim: true },
      output_checked: { type: Boolean, default: null },
      autonomy_test_done: { type: Boolean, default: null },
      autonomy_estimated: { type: String, trim: true }
    },

    cooling_system_cabinet: {
      temperature_checked: { type: Boolean, default: null },
      water_accumulation_signs: { type: Boolean, default: null }
    },

    solar_batteries: {
      batteries_count: { type: String, trim: true },
      unit_capacity: { type: String, trim: true },
      output_checked: { type: Boolean, default: null },
      autonomy_test_done: { type: Boolean, default: null },
      autonomy_estimated: { type: String, trim: true }
    },

    solar_panels: {
      output_checked_before_clean: { type: Boolean, default: null },
      panels_cleaned: { type: Boolean, default: null },
      connections_checked: { type: Boolean, default: null }
    },

    earthing_system: {
      earth_resistance_measured: { type: Boolean, default: null },
      earth_resistance_value: { type: String, trim: true },
      less_than_5_ohms: { type: Boolean, default: null },
      action_if_above_5: { type: String, trim: true }
    },

    alarms_system: {
      temp_sensor_ok: { type: Boolean, default: null },
      power_sensor_ok: { type: Boolean, default: null },
      gate_lock_sensor_ok: { type: Boolean, default: null },
      fuel_sensor_ok: { type: Boolean, default: null },
      fuel_tank_sensors_ok: { type: Boolean, default: null },
      external_alarms_wired: { type: Boolean, default: null },
      alarms_reporting: { type: Boolean, default: null },
      alarms_not_reporting_reason: { type: String, trim: true }
    },

    signatures: {
      subcontractor_signature: { type: String, trim: true },
      audit_technician_signature: { type: String, trim: true },
      regional_manager_signature: { type: String, trim: true }
    },

    photos: [photoSchema],
    section_notes: {
      type: Map,
      of: String,
      default: {}
    },
    section_scores: {
      type: Map,
      of: Number,
      default: {}
    },
    total_score: { type: Number, default: 0 },
    notes: { type: String, trim: true },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

siteAuditChecklistSchema.index({ site: 1, createdAt: -1 });

module.exports = mongoose.model('SiteAuditChecklist', siteAuditChecklistSchema);
