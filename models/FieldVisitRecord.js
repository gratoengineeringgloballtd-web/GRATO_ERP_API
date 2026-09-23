/**
 * FieldVisitRecord.js
 * 
 * One record per technician field visit to a site.
 * Source: GRATO Main sheet (uploaded per cycle) or direct app entry.
 * 
 * This is the ground truth for:
 *  - Generator meter readings (prev/current → field RH)
 *  - Fuel found / added / left
 *  - Load readings (1ph, 2ph, 3ph amps)
 *  - DC Load variation
 *  - CCPH override if generator was swapped
 * 
 * Multiple visits per site per cycle are normal and expected.
 * The reconciliation engine aggregates them per cycle.
 */
const mongoose = require('mongoose');

const fieldVisitRecordSchema = new mongoose.Schema({
  // ── Identity ────────────────────────────────────────────────────────────────
  site_id:       { type: String, required: true, index: true },
  site_name:     String,
  cluster:       String,
  region:        String,
  sbc:           String,  // "GRATO"
  customer_id:   String,  // "T867", "LIT_291"
  access_ticket: String,  // IHSREF/...

  cycle_key:  { type: String, required: true, index: true },
  cycle_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'DieselCycle' },

  // ── Visit window ────────────────────────────────────────────────────────────
  prev_visit_date:    Date,   // Date of Last Visit
  current_visit_date: { type: Date, required: true, index: true }, // Date of Current Visit
  nbr_days:           Number, // (current - prev) in days

  // Which cycle boundary does this visit belong to?
  // A visit straddling 26th → attributed to the cycle that contains current_visit_date
  visit_cycle_attribution: String, // cycle_key of the CURRENT visit date

  // ── Generator data ───────────────────────────────────────────────────────────
  generator_id:       String,  // Link to GeneratorAssignmentLedger
  generator_brand:    String,  // MIKANO, IPT TRION, etc.
  dg_kva:             Number,  // Generator capacity at time of visit
  ccph:               { type: Number, required: true }, // CCPH at time of visit

  // Meter readings
  prev_meter:         mongoose.Schema.Types.Mixed,  // Number or "FAULTY"
  current_meter:      mongoose.Schema.Types.Mixed,  // Number or "FAULTY"
  meter_is_faulty:    { type: Boolean, default: false },
  
  // RH derived from meter (null if FAULTY → use CMS fallback)
  field_rh:           Number,  // current_meter - prev_meter (when both valid)
  cms_rh_fallback:    Number,  // Populated by reconciliation engine if meter FAULTY
  final_rh:           Number,  // = field_rh if valid, else cms_rh_fallback

  rh_per_day:         Number,  // final_rh / nbr_days
  generator_status:   String,  // "ok", "PROB"
  generator_comment:  String,

  // ── Fuel data ────────────────────────────────────────────────────────────────
  tank_type:              String,   // INT, EXT
  fuel_qty_previously:    Number,   // QTY OF FUEL PREVIOUSLY LEFT (from last visit record)
  fuel_qty_found:         Number,   // QTY OF FUEL FOUND on arrival
  fuel_qty_added:         Number,   // Fuel Qty Added (L) — field truth
  fuel_qty_left:          Number,   // QTY OF FUEL LEFT after this visit
  
  // Calculated
  fuel_consumption:       Number,   // = final_rh × ccph (contractual)
  qty_consumed_actual:    Number,   // Qty Consumed (L) — actual (found + added - left)
  gap_cph_variation:      Number,   // Gap CPH Variation — difference
  theft_l:                Number,   // Theft flag (L)

  // ── Load measurements ────────────────────────────────────────────────────────
  gen_ac_load_1ph: Number,   // Amps
  gen_ac_load_2ph: Number,
  gen_ac_load_3ph: Number,
  dc_load_variation: Number,
  load_comment:      String,

  // ── Power cabinet info ───────────────────────────────────────────────────────
  pwc1_nb_rectifier:        Number,
  pwc1_rectifier_capacity:  Number,
  pwc2_nb_rectifier:        Number,
  pwc2_rectifier_capacity:  Number,
  pwc_comment:              String,

  // ── Topology ─────────────────────────────────────────────────────────────────
  visit_topology:      String,  // as found during visit
  functional_topology: String,  // Grid-Gen, Gen Only, etc.
  site_topology:       String,

  // ── Special flags ────────────────────────────────────────────────────────────
  is_edo_site:         Boolean,  // EDO Site?

  // ── Submission info ──────────────────────────────────────────────────────────
  source: {
    type: String,
    enum: ['grato_upload', 'app_entry', 'manual_import'],
    default: 'grato_upload'
  },
  submitted_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  grato_upload_id: { type: mongoose.Schema.Types.ObjectId, ref: 'GratoUpload' },
  row_number:      Number,  // Row in the source GRATO file (for debugging)

  // ── Reconciliation status ────────────────────────────────────────────────────
  reconciliation_status: {
    type: String,
    enum: ['pending', 'reconciled', 'flagged', 'overridden'],
    default: 'pending'
  },
  reconciled_at: Date,
}, {
  timestamps: true,
  collection: 'field_visit_records'
});

fieldVisitRecordSchema.index({ site_id: 1, current_visit_date: -1 });
fieldVisitRecordSchema.index({ cycle_key: 1, cluster: 1 });
fieldVisitRecordSchema.index({ reconciliation_status: 1 });

/**
 * Get all visits for a site in a cycle, ordered by visit date.
 */
fieldVisitRecordSchema.statics.getVisitsForCycle = function (site_id, cycle_key) {
  return this.find({ site_id, cycle_key }).sort({ current_visit_date: 1 });
};

/**
 * Get aggregated fuel added for a site in a cycle.
 * (sum of all fuel_qty_added across visits in cycle)
 */
fieldVisitRecordSchema.statics.getCycleFuelAdded = async function (site_id, cycle_key) {
  const result = await this.aggregate([
    { $match: { site_id, cycle_key } },
    {
      $group: {
        _id: null,
        total_fuel_added: { $sum: '$fuel_qty_added' },
        total_field_rh:   { $sum: '$final_rh' },
        total_consumption: { $sum: '$fuel_consumption' },
        visit_count:      { $sum: 1 },
      }
    }
  ]);
  return result[0] || { total_fuel_added: 0, total_field_rh: 0, total_consumption: 0, visit_count: 0 };
};

module.exports = mongoose.model('FieldVisitRecord', fieldVisitRecordSchema);