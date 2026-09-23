/**
 * GeneratorAssignmentLedger.js
 * 
 * IMMUTABLE ledger of every generator-to-site assignment.
 * Solves the mid-cycle generator swap problem:
 *   - Each row is one "slot" during which a specific generator was at a site
 *   - When a swap happens, the current row's end_date is set, a new row begins
 *   - Consumption calculations query: "which generator was at site X between T1 and T2?"
 *   - CCPH for the period is taken from this record, not from SiteBudget
 * 
 * This is append-only. Records are never deleted; swaps create new records.
 */
const mongoose = require('mongoose');

const generatorAssignmentLedgerSchema = new mongoose.Schema({
  // The site
  site_id:   { type: String, required: true, index: true },
  site_name: String,
  cluster:   String,
  region:    String,

  // The generator at this site during this window
  generator_id:    { type: String, required: true, index: true }, // e.g. "GEN_BNB_001"
  generator_brand: String,   // MIKANO, IPT TRION, etc.
  dg_kva:          Number,   // KVA at time of assignment (immutable for this slot)
  ccph:            Number,   // CCPH for this generator at this site (from SiteBudget at assignment time)

  // Assignment window
  assigned_at:   { type: Date, required: true },
  removed_at:    { type: Date, default: null },  // null = currently assigned
  is_active:     { type: Boolean, default: true, index: true },

  // What triggered this assignment/removal
  assigned_reason: String,   // "initial setup", "replacement", "transfer from IHS_DLA_003"
  removed_reason:  String,   // "transferred to IHS_BNB_007", "fault", "maintenance"

  // Which cycles overlap this assignment window
  // Populated automatically when assignment is created/closed
  cycles_affected: [String],  // ["2026-04", "2026-05"]

  // Reference to the GeneratorUpdate record that created this ledger entry
  generator_update_ref: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneratorUpdate' },

  // Who recorded this
  recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  removed_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
  // Strict mode off so we can store extra metadata if needed
});

generatorAssignmentLedgerSchema.index({ site_id: 1, is_active: 1 });
generatorAssignmentLedgerSchema.index({ generator_id: 1, is_active: 1 });
generatorAssignmentLedgerSchema.index({ assigned_at: 1, removed_at: 1 });

/**
 * Get the active generator at a site on a given date.
 * Returns null if no assignment found (data gap).
 */
generatorAssignmentLedgerSchema.statics.getAssignmentAt = function (site_id, date = new Date()) {
  return this.findOne({
    site_id,
    assigned_at: { $lte: date },
    $or: [
      { removed_at: null },
      { removed_at: { $gte: date } },
    ],
  }).sort({ assigned_at: -1 });
};

/**
 * Get all assignment segments for a site within a date range.
 * Used for pro-rated CCPH calculations when there was a mid-cycle swap.
 */
generatorAssignmentLedgerSchema.statics.getSegmentsForPeriod = function (site_id, start, end) {
  return this.find({
    site_id,
    assigned_at: { $lt: end },
    $or: [
      { removed_at: null },
      { removed_at: { $gt: start } },
    ],
  }).sort({ assigned_at: 1 });
};

/**
 * Close the current active assignment for a site (called when supervisor logs a swap).
 */
generatorAssignmentLedgerSchema.statics.closeActiveAssignment = async function (site_id, removed_at, removed_by, removed_reason) {
  return this.findOneAndUpdate(
    { site_id, is_active: true },
    {
      removed_at,
      removed_by,
      removed_reason,
      is_active: false,
    },
    { new: true }
  );
};

module.exports = mongoose.model('GeneratorAssignmentLedger', generatorAssignmentLedgerSchema);