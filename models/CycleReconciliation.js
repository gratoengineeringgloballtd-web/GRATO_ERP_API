const mongoose = require('mongoose');

/**
 * CycleReconciliation.js
 * 
 * The master per-site-per-cycle KPI record.
 * Produced by the ReconciliationService after every data upload.
 * This is what the dashboard, alerts, and reports read from.
 * 
 * Data triangle:
 *   A) Tom Card purchased liters
 *   B) Field GRATO fuel added (sum of all visits)
 *   C) CMS Refuel detected
 *   D) CMS consumption (Gen RH × CMS rate)
 *   E) Contractual consumption (Final RH × CCPH)
 * 
 * Alert triggers live here as boolean flags.
 */
const cycleReconciliationSchema = new mongoose.Schema({
  site_id:    { type: String, required: true, index: true },
  site_name:  String,
  cluster:    { type: String, index: true },
  region:     String,
  cycle_key:  { type: String, required: true, index: true },
  cycle_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'DieselCycle' },

  // ── Budget baseline ─────────────────────────────────────────────────────────
  dg_kva:        Number,
  ccph:          Number,     // CCPH used for this cycle
  budgeted_rh:   Number,     // from Book11
  budget_liters: Number,     // from Book11
  grid_avail_target: Number, // 0–1 (e.g. 0.75)
  topology:      String,
  is_fueling_site: Boolean,

  // ── Generator assignment ────────────────────────────────────────────────────
  generator_id:      String,
  generator_brand:   String,
  had_mid_cycle_swap: { type: Boolean, default: false },
  swap_segments:     [{
    generator_id:  String,
    ccph:          Number,
    from_date:     Date,
    to_date:       Date,
    rh_in_segment: Number,
    consumption_in_segment: Number,
  }],

  // ── Run Hours (RH) ──────────────────────────────────────────────────────────
  field_rh:          Number,  // From GRATO meter readings (sum)
  cms_rh:            Number,  // From ERS CMS (sum of daily Gen RH)
  final_rh:          Number,  // field_rh if valid, else cms_rh
  faulty_meter_days: Number,  // days where CMS was used as fallback
  rh_variance:       Number,  // cms_rh - field_rh (delta)
  rh_variance_pct:   Number,  // %

  // ── Fuel data ────────────────────────────────────────────────────────────────
  // A: contractual (budget)
  contractual_consumption: Number,  // final_rh × ccph

  // B: CMS
  cms_consumption:   Number,  // sum of FuelConsumption L (W/O Drop) from daily records
  cms_refuel_total:  Number,  // sum of Refuel L from CMS

  // C: Field GRATO
  field_fuel_found:  Number,  // last visit fuel_qty_found
  field_fuel_added:  Number,  // sum of fuel_qty_added across all visits + mobile refuels
  // Split by source, for audit — see reconciliationService.js's FuelConsumption
  // integration. field_fuel_added = the sum of these two.
  field_added_from_grato_visits:   Number,  // from periodic bulk GRATO Excel field visits
  field_added_from_mobile_refuels: Number,  // from the mobile app's live fuel-request → refuel workflow
  field_fuel_left:   Number,  // last visit fuel_qty_left
  field_consumption_actual: Number,  // (found + added - left)
  field_visits_count: Number,

  // D: Tom Card
  tomcard_purchased: Number,  // liters purchased on Tom Card during cycle (if mapped)

  // ── Variances / Reconciliation ───────────────────────────────────────────────
  // Consumption variance: actual vs contractual
  cons_variance:       Number,  // field_consumption_actual - contractual_consumption
  cons_variance_pct:   Number,
  cons_status:         { type: String, enum: ['ok', 'over', 'under', 'unknown'] },

  // Fuel added reconciliation: field vs CMS
  refuel_field_vs_cms_var: Number,  // field_fuel_added - cms_refuel_total
  refuel_status: { type: String, enum: ['ok', 'discrepancy', 'no_cms_data', 'unknown'] },

  // Fuel added vs purchased: field vs Tom Card
  refuel_field_vs_card_var: Number, // field_fuel_added - tomcard_purchased (if mapped)
  card_reconciled: Boolean,

  // Gap/theft detection (from GRATO)
  gap_cph_variation: Number,
  theft_detected:    Boolean,
  theft_liters:      Number,

  // ── Tank / low-fuel threshold ────────────────────────────────────────────────
  tank_capacity_l:        Number,   // site's actual tank capacity, when known
  low_fuel_threshold_l:   Number,   // the liters cutoff actually applied for this site's low_fuel alert
  tank_capacity_missing:  { type: Boolean, default: false }, // true = fell back to the flat-liters default; needs data entry

  // ── Grid availability ─────────────────────────────────────────────────────────
  grid_avail_actual:    Number,  // 0–1, from CMS
  grid_avail_hours:     Number,  // total grid hours in cycle
  zero_grid_max_streak: Number,  // max consecutive hours with 0 grid in cycle
  zero_grid_alert:      { type: Boolean, default: false },  // streak >= 24

  // ── Data completeness ─────────────────────────────────────────────────────────
  has_cms_data:         { type: Boolean, default: false },
  has_grato_data:       { type: Boolean, default: false },
  cms_days_covered:     Number,  // how many days have CMS records
  cms_days_expected:    Number,  // days in cycle
  missing_cms_days:     Number,
  grato_submission_missing: { type: Boolean, default: false },

  // ── Alert flags ──────────────────────────────────────────────────────────────
  alerts: {
    low_fuel:             { type: Boolean, default: false },
    zero_grid_24h:        { type: Boolean, default: false },
    consumption_over_ccph: { type: Boolean, default: false },
    refuel_mismatch:      { type: Boolean, default: false },
    tomcard_mismatch:     { type: Boolean, default: false },
    missing_grato:        { type: Boolean, default: false },
    missing_cms:          { type: Boolean, default: false },
    faulty_meter:         { type: Boolean, default: false },
    theft_suspected:      { type: Boolean, default: false },
    rh_mismatch:          { type: Boolean, default: false },
    missing_tank_capacity: { type: Boolean, default: false },
  },
  alert_count:    Number,  // total alerts for sorting/filtering

  // ── Metadata ─────────────────────────────────────────────────────────────────
  last_reconciled_at: Date,
  reconciliation_version: { type: Number, default: 1 },
  override_notes: String,  // manual admin override reason
  is_manually_reviewed: { type: Boolean, default: false },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewed_at: Date,
}, {
  timestamps: true,
  collection: 'cycle_reconciliations'
});

cycleReconciliationSchema.index({ site_id: 1, cycle_key: 1 }, { unique: true });
cycleReconciliationSchema.index({ cycle_key: 1, cluster: 1 });
cycleReconciliationSchema.index({ cycle_key: 1, alert_count: -1 });
cycleReconciliationSchema.index({ 'alerts.low_fuel': 1 });
cycleReconciliationSchema.index({ 'alerts.zero_grid_24h': 1 });
cycleReconciliationSchema.index({ 'alerts.consumption_over_ccph': 1 });

// ── Statics ───────────────────────────────────────────────────────────────────

cycleReconciliationSchema.statics.getClusterSummary = async function (cycle_key) {
  return this.aggregate([
    { $match: { cycle_key } },
    { $group: {
      _id: '$cluster',
      sites:               { $sum: 1 },
      total_budget_liters: { $sum: '$budget_liters' },
      total_field_rh:      { $sum: '$final_rh' },
      total_contractual:   { $sum: '$contractual_consumption' },
      total_cms_consumed:  { $sum: '$cms_consumption' },
      total_field_added:   { $sum: '$field_fuel_added' },
      total_tomcard:       { $sum: '$tomcard_purchased' },
      avg_cons_variance_pct: { $avg: '$cons_variance_pct' },
      sites_over_ccph:     { $sum: { $cond: ['$alerts.consumption_over_ccph', 1, 0] } },
      sites_low_fuel:      { $sum: { $cond: ['$alerts.low_fuel', 1, 0] } },
      sites_zero_grid:     { $sum: { $cond: ['$alerts.zero_grid_24h', 1, 0] } },
      sites_missing_data:  { $sum: { $cond: [{ $or: ['$alerts.missing_grato', '$alerts.missing_cms'] }, 1, 0] } },
      total_alerts:        { $sum: '$alert_count' },
    }},
    { $sort: { total_alerts: -1 } }
  ]);
};

cycleReconciliationSchema.statics.getAlertSummary = async function (cycle_key) {
  return this.aggregate([
    { $match: { cycle_key } },
    { $group: {
      _id: null,
      low_fuel:             { $sum: { $cond: ['$alerts.low_fuel', 1, 0] } },
      zero_grid_24h:        { $sum: { $cond: ['$alerts.zero_grid_24h', 1, 0] } },
      consumption_over_ccph:{ $sum: { $cond: ['$alerts.consumption_over_ccph', 1, 0] } },
      refuel_mismatch:      { $sum: { $cond: ['$alerts.refuel_mismatch', 1, 0] } },
      tomcard_mismatch:     { $sum: { $cond: ['$alerts.tomcard_mismatch', 1, 0] } },
      missing_grato:        { $sum: { $cond: ['$alerts.missing_grato', 1, 0] } },
      missing_cms:          { $sum: { $cond: ['$alerts.missing_cms', 1, 0] } },
      theft_suspected:      { $sum: { $cond: ['$alerts.theft_suspected', 1, 0] } },
    }}
  ]);
};

module.exports = mongoose.model('CycleReconciliation', cycleReconciliationSchema);