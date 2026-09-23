/**
 * SiteBudget.js
 * Stores per-site contracted/budgeted parameters for each cycle.
 * Source: Book11 Budget file uploaded at cycle start.
 * 
 * These values define the CONTRACTUAL baseline. When a generator is swapped
 * mid-cycle, a new SiteBudgetOverride record captures the change so CCPH
 * is prorated correctly for each segment of the cycle.
 */
const mongoose = require('mongoose');

const siteBudgetSchema = new mongoose.Schema({
  site_id:    { type: String, required: true, index: true }, // IHS_BNB_013
  cycle_key:  { type: String, required: true, index: true }, // "2026-05"
  cycle_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'DieselCycle' },

  // Site identity (from Book11)
  site_name:  String,
  cluster:    String,
  region:     String,
  topology:   String,   // "Grid Gen", "Gen Only", "Hybrid Gen", etc.
  is_fueling_site: { type: Boolean, default: false }, // "Fueling Sites (Yes/No)"

  // Generator parameters
  dg_kva:     { type: Number, required: true },  // Actual DG KVA
  ccph:       { type: Number, required: true },  // Genset CPH (L/h)

  // Cycle targets
  days_in_cycle:        Number,
  budgeted_rh:          Number,  // RH June-26 - planned generator run hours
  rh_per_day:           Number,  // Genset RH/Day
  final_grid_availability: Number, // 0.0 – 1.0 (e.g. 0.75 = 75%)
  budget_liters:        Number,
  budget_xaf:           Number,   // budget_liters × xaf_per_liter (per-site rate)
  xaf_per_liter:        { type: Number, default: 828 }, // per-site XAF/L rate (varies by vendor/cluster)
  liters_used:          { type: Number, default: 0 },   // running total from approved FuelRequests
  budget_liters_approved_ihs: Number,   // Col AE — IHS-approved budget (L)
  budget_xaf_approved_ihs:    Number,   // Col AF — IHS-approved budget (FCFA)

  // Tom Card tracking (from Book11)
  card_number:          String,   // Tom Card number for this cluster/site
  fuel_vendor:          String,   // TOTAL or TRADEX

  // Site visit tracking
  site_priority:        String,
  last_visit_date:      Date,
  last_visit_stock_l:   Number,
  tank_bottom_l:        Number,
  dg_kva_actual:        Number,   // Actual DG KVA (Col H)  // May-26 Diesel Budget

  // PATCH: XAF equivalent computed from budget_liters × 828

  // DC Load info
  dc_load_amps:         Number,
  site_load_kw:         Number,

  // Hybrid/battery expectation (for solar/lithium sites)
  hybrid_expectation_hrs: Number,

  // Who imported this
  imported_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  imported_at: { type: Date, default: Date.now },
  source_file: String,

  // ── Balance / deficit tracking ─────────────────────────────────────────────
  // liters_committed = total approved-not-yet-refueled
  // liters_used      = total actually added (from refuel form submission)
  // liters_balance_returned = returned balance from partial fills
  liters_committed:         { type: Number, default: 0 }, // approved but not yet refueled
  liters_balance_returned:  { type: Number, default: 0 }, // returned partial-fill balances
  deficit_liters:           { type: Number, default: 0 }, // amount approved beyond budget
  in_deficit:               { type: Boolean, default: false },

  // ── Tom Card transfer ledger ────────────────────────────────────────────────
  // Transfers IN from other cards/clusters (adds to effective capacity)
  // Transfers OUT to other clusters (reduces available balance)
  transfers_in:  [{ from_cluster: String, from_card: String, liters: Number, at: Date, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, note: String }],
  transfers_out: [{ to_cluster:   String, to_card:   String, liters: Number, at: Date, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, note: String }],
}, { timestamps: true });

siteBudgetSchema.index({ site_id: 1, cycle_key: 1 }, { unique: true });

siteBudgetSchema.pre('save', function (next) {
  if (this.budget_liters != null) {
    this.budget_xaf = Math.round(this.budget_liters * (this.xaf_per_liter || 828));
  }
  next();
});


// ── Virtuals ───────────────────────────────────────────────────────────────────
siteBudgetSchema.virtual('effective_budget_liters').get(function () {
  const base      = this.budget_liters || 0;
  const xfIn      = (this.transfers_in  || []).reduce((s, t) => s + t.liters, 0);
  const xfOut     = (this.transfers_out || []).reduce((s, t) => s + t.liters, 0);
  const returned  = this.liters_balance_returned || 0;
  return base + xfIn - xfOut + returned;
});

siteBudgetSchema.virtual('liters_remaining').get(function () {
  const eff = this.effective_budget_liters;
  return Math.max(-(this.deficit_liters || 0), eff - (this.liters_used || 0));
});

siteBudgetSchema.virtual('utilisation_pct').get(function () {
  const eff = this.effective_budget_liters;
  if (!eff) return 0;
  return Math.round(((this.liters_used || 0) / eff) * 100);
});

siteBudgetSchema.set('toJSON', { virtuals: true });
siteBudgetSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('SiteBudget', siteBudgetSchema);