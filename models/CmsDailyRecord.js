/**
 * CmsDailyRecord.js
 * 
 * One record per site per day, imported from the ERS/CMS extraction file.
 * The CMS file is uploaded daily and this model stores each day's telemetry.
 * 
 * Key uses:
 *  1. Fallback Gen RH when field meter is FAULTY
 *  2. Grid availability monitoring → 0% grid for 24+ consecutive hours alert
 *  3. Fuel level validation against field-reported levels
 *  4. Refuel L from CMS vs field-recorded fuel added reconciliation
 *  5. Consumption rate cross-check vs CCPH
 */
const mongoose = require('mongoose');

const cmsDailyRecordSchema = new mongoose.Schema({
  // Identification
  site_id:          { type: String, required: true, index: true },
  site_name_cms:    String,   // SiteName as it appears in ERS
  record_date:      { type: Date, required: true, index: true },
  cycle_key:        { type: String, required: true, index: true },
  region:           String,
  power_topology:   String,   // Grid-Gen, Gen Only, Gen-Lithium, Solar-Gen-Lithium, etc.
  project_status:   String,   // SLA GRATO, etc.

  // ── Generator runtime ──────────────────────────────────────────────────────
  gen_rh:                 { type: Number, default: 0 },   // Gen RH (cumulative in period)
  gen_kwh:                { type: Number, default: 0 },
  generator_working_h:    { type: Number, default: 0 },

  // ── Grid ───────────────────────────────────────────────────────────────────
  grid_rh:                { type: Number, default: 0 },
  grid_kwh:               { type: Number, default: 0 },
  grid_availability_hr:   { type: Number, default: 0 },   // Key: 0 = no grid

  // ── Battery / Solar ────────────────────────────────────────────────────────
  site_on_battery_rh:     Number,
  battery_charge_kwh:     Number,
  battery_discharge_kwh:  Number,
  solar_rh:               Number,
  solar_kwh:              Number,
  solar_with_bb_rh:       Number,
  solar_with_grid_rh:     Number,
  solar_with_gen_rh:      Number,

  // ── Power totals ───────────────────────────────────────────────────────────
  total_power_rh:         Number,
  total_power_kwh:        Number,
  total_hours:            Number,   // = 24 for a full day

  // ── Availability ───────────────────────────────────────────────────────────
  site_down_h:            Number,
  no_comm_h:              Number,
  network_availability_h: Number,

  // ── Load ───────────────────────────────────────────────────────────────────
  avg_tenants_kw:         Number,
  avg_total_dc_kw:        Number,
  pue:                    Number,
  pue_status:             String,   // "Normal", "Abnormal"

  // ── Fuel (from CMS sensors) ────────────────────────────────────────────────
  fuel_consumption_with_drop:      Number,  // FuelConsumption L (W Drop)
  fuel_consumption_without_drop:   Number,  // FuelConsumption L (W/O Drop) ← PRIMARY
  fuel_drop_l:                     Number,  // Fuel Drop L (sensor artifact drops)
  refuel_l:                        { type: Number, default: 0 }, // Refuel L detected by CMS
  fuel_consumption_rate:           Number,  // L/h (W/O Drop)
  fuel_level_l:                    Number,  // Current tank level per CMS

  // ── Upload metadata ────────────────────────────────────────────────────────
  upload_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'CmsUpload' },
  uploaded_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source_filename:  String,

  // ── Derived / computed flags ───────────────────────────────────────────────
  // Set by the reconciliation engine after processing
  zero_grid_flag:   { type: Boolean, default: false },  // grid_availability_hr == 0
  consecutive_zero_grid_hours: { type: Number, default: 0 }, // running count

}, {
  timestamps: true,
  collection: 'cms_daily_records'
});

cmsDailyRecordSchema.index({ site_id: 1, record_date: -1 });
cmsDailyRecordSchema.index({ cycle_key: 1, zero_grid_flag: 1 });
cmsDailyRecordSchema.index({ upload_id: 1 });

/**
 * Get cumulative Gen RH for a site within a cycle date range.
 * Sum of gen_rh across all daily records in the window.
 */
cmsDailyRecordSchema.statics.getCycleGenRH = async function (site_id, start_date, end_date) {
  const result = await this.aggregate([
    { $match: { site_id, record_date: { $gte: start_date, $lte: end_date } } },
    { $group: { _id: null, total_gen_rh: { $sum: '$gen_rh' }, days: { $sum: 1 } } }
  ]);
  return result[0] || { total_gen_rh: 0, days: 0 };
};

/**
 * Get cumulative CMS fuel consumption for a site in a cycle.
 */
cmsDailyRecordSchema.statics.getCycleFuelStats = async function (site_id, start_date, end_date) {
  const result = await this.aggregate([
    { $match: { site_id, record_date: { $gte: start_date, $lte: end_date } } },
    {
      $group: {
        _id: null,
        total_consumed: { $sum: '$fuel_consumption_without_drop' },
        total_refuel:   { $sum: '$refuel_l' },
        avg_rate:       { $avg: '$fuel_consumption_rate' },
        days_data:      { $sum: 1 },
        days_zero_grid: { $sum: { $cond: ['$zero_grid_flag', 1, 0] } },
      }
    }
  ]);
  return result[0] || { total_consumed: 0, total_refuel: 0, avg_rate: 0, days_data: 0, days_zero_grid: 0 };
};

/**
 * Find consecutive zero-grid sites (for 24hr alert).
 * Returns sites with consecutive_zero_grid_hours >= 24.
 */
cmsDailyRecordSchema.statics.getZeroGridAlerts = function () {
  return this.find({ consecutive_zero_grid_hours: { $gte: 24 } })
    .sort({ consecutive_zero_grid_hours: -1 });
};

module.exports = mongoose.model('CmsDailyRecord', cmsDailyRecordSchema);