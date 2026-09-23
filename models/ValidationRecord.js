/**
 * ValidationRecord.js
 *
 * One record per site per cycle, imported from the "Validation" sheet of
 * the GRATO Validation Template file. This is the monthly, data-entry
 * validated summary — distinct from Maintenance (per-visit GRATO records)
 * and CmsDailyRecord (per-day CMS telemetry).
 *
 * Key uses:
 *  1. Final DG CPH is the AUTHORITATIVE contractual consumption rate for
 *     the site — used instead of the static CPH_TABLE lookup. The import
 *     service also pushes this (and Final DG KVA) into SiteBudget so the
 *     existing reconciliation engine picks it up automatically.
 *  2. Final RH / CMS RH / CMS Vs Field give a second, independently
 *     validated cross-check against the GRATO field RH and CMS RH already
 *     used in reconciliationService.js.
 *  3. Access Ticket links a site's outage/incident reference for the cycle.
 *  4. Management Amount / COST PER LTRS / Management fee rate support
 *     billing reconciliation.
 */
const mongoose = require('mongoose');

const validationRecordSchema = new mongoose.Schema({
  // Identification
  site_id:     { type: String, required: true, index: true }, // I.H.S SITE ID — clean, no M/O suffix
  cycle_key:   { type: String, required: true, index: true },  // derived from CURRENT DATE
  access_ticket: String,        // null/omitted when sheet value was 0
  state:       String,
  site_name:   String,
  customer_id: String,          // "Customer ID" col — e.g. T2015 / LIT_519 (alt site id)
  sbc:         String,
  sbc_region:  String,          // "SBC/Region" — e.g. "GRATO - Littoral"
  cluster:     String,
  topology:    String,          // "DR Topology" — Grid Gen / Gen Only / Hybrid Gen / etc.
  site_supervisor: String,

  // Visit window for this validation row
  prev_date:    Date,
  current_date: Date,

  // Generator meter readings (may be 'FAULTY' in source — sanitised to null)
  prev_meter:    Number,
  current_meter: Number,
  prev_meter_raw:    String,    // audit trail of original value if non-numeric
  current_meter_raw: String,

  // Generator KVA — SBC-recorded vs validated/resolved
  sbc_dg_kva:   Number,
  final_dg_kva: Number,         // AUTHORITATIVE — pushed to SiteBudget.dg_kva
  dg_check:     Boolean,        // true = SBC and validated KVA agreed
  dg_comment:   String,         // e.g. "Use IHS DG KVA" when they disagreed

  // Run hours
  sbc_rh:   Number,
  final_rh: Number,             // AUTHORITATIVE field RH for the cycle
  cms_rh:   Number,              // null when source was '#N/A'
  cms_vs_field:         Number,
  cms_vs_field_comment: String,

  // Fuel
  total_fuel_added_reported: Number,  // "Total QTY OF FUEL ADDED"
  service_desk_recording:    Number,
  fuel_added_var:             Number, // "Var"
  qty_fuel_previously: Number,
  qty_fuel_found:      Number,
  qty_fuel_added:      Number,
  qty_fuel_left:       Number,

  // CCPH / consumption — AUTHORITATIVE values
  final_dg_cph: { type: Number, required: true }, // AUTHORITATIVE — pushed to SiteBudget.ccph
  sbc_cons:     Number,
  final_cons:   Number,
  cons_var:     Number,

  // Comments
  all_comment:    String,
  sbc_comment:    String,
  final_comment:  String,

  // Billing (cycle-wide constants in source file, stored per-row for audit)
  cost_per_liter:       Number,  // "COST PER LTRS"
  management_fee_rate:  Number,  // e.g. 0.1
  management_amount:    Number,  // RECOMPUTED: final_cons * cost_per_liter * management_fee_rate

  // Upload metadata
  upload_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'ValidationUpload' },
  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source_filename: String,
  source_row:      Number,   // row number in the sheet, for audit/debugging

}, {
  timestamps: true,
  collection: 'validation_records',
});

validationRecordSchema.index({ site_id: 1, cycle_key: 1 }, { unique: true });
validationRecordSchema.index({ cycle_key: 1 });

/**
 * Get all validation records for a cycle, sorted by site.
 */
validationRecordSchema.statics.getForCycle = function (cycle_key) {
  return this.find({ cycle_key }).sort({ site_id: 1 }).lean();
};

/**
 * Cycle-level totals (fuel, consumption, management amount).
 */
validationRecordSchema.statics.getCycleTotals = async function (cycle_key) {
  const result = await this.aggregate([
    { $match: { cycle_key } },
    { $group: {
      _id: null,
      sites:               { $sum: 1 },
      total_final_rh:      { $sum: '$final_rh' },
      total_cms_rh:        { $sum: '$cms_rh' },
      total_fuel_added:    { $sum: '$qty_fuel_added' },
      total_final_cons:    { $sum: '$final_cons' },
      total_sbc_cons:      { $sum: '$sbc_cons' },
      total_management_amount: { $sum: '$management_amount' },
      dg_check_mismatches: { $sum: { $cond: ['$dg_check', 0, 1] } },
    } },
  ]);
  return result[0] || {
    sites: 0, total_final_rh: 0, total_cms_rh: 0, total_fuel_added: 0,
    total_final_cons: 0, total_sbc_cons: 0, total_management_amount: 0,
    dg_check_mismatches: 0,
  };
};

module.exports = mongoose.model('ValidationRecord', validationRecordSchema);