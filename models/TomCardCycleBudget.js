/**
 * TomCardCycleBudget.js
 *
 * The cycle-opening Tom Card aggregate — uploaded once at the start of
 * every cycle from the finance/vendor file (columns: New SBC, Cluster,
 * Vendor, Card Number, New Card Number, Diesel Budget (L), Diesel Budget
 * Amount XAF, Initial % Recharge Amount (fraction + computed value),
 * Actual Card Limit, Strategic Tank Usage, New limit on <date>).
 *
 * Distinct from TomCardMapping (models/TomCardMapping.js), which is the
 * permanent, admin-managed card→cluster/site mapping that persists across
 * cycles. This collection is the CYCLE-SPECIFIC budget/limit ceiling for
 * each card — it changes every cycle, and cards are sometimes reissued
 * with a new number mid-relationship (hence both card_number_old and
 * card_number are tracked).
 *
 * card_number is always the ACTIVE number for this cycle — i.e. the "New
 * Card Number" column when present and different, otherwise the original
 * "Card Number". This is the number technicians should see/select in the
 * mobile fuel-purchase card picker for transactions during this cycle.
 */
const mongoose = require('mongoose');

const tomCardCycleBudgetSchema = new mongoose.Schema({
  cycle_key:        { type: String, required: true, index: true },

  sbc:               String,  // 'New SBC' column — the operating company code (e.g. 'GRATO')
  cluster:           { type: String, required: true, index: true },
  vendor:            String,  // 'TOTAL' / 'TRADEX' / etc.

  card_number:       { type: String, required: true, index: true }, // ACTIVE number for this cycle (new, if reissued)
  card_number_old:   String,  // previous number, kept for cross-reference if the card was reissued this cycle
  was_reissued:      { type: Boolean, default: false }, // true when card_number differs from card_number_old

  budget_liters:     Number,  // 'Diesel Budget (L)' for this cycle
  budget_xaf:        Number,  // 'Diesel Budget Amount XAF' for this cycle
  recharge_pct:      Number,  // 'Initial % Recharge Amount' fraction, e.g. 0.8
  recharge_amount_xaf: Number, // the computed initial recharge (budget_xaf * recharge_pct, or as given in file)
  card_limit_xaf:    Number,  // 'Actual Card Limit' / 'New limit on <date>' — the card's spending ceiling this cycle

  // Implied per-liter rate for THIS card/cluster this cycle
  // (budget_xaf / budget_liters) — meaningfully more accurate than the
  // flat 828 XAF/L fleet default the fuel-purchase form otherwise falls
  // back to, since different clusters/vendors can be on different
  // negotiated rates.
  implied_xaf_per_liter: Number,

  upload_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'TomCardCycleBudgetUpload' },
}, { timestamps: true });

// One budget row per card per cycle — re-uploading the same cycle's file
// updates in place rather than duplicating.
tomCardCycleBudgetSchema.index({ cycle_key: 1, card_number: 1 }, { unique: true });

const TomCardCycleBudget = mongoose.model('TomCardCycleBudget', tomCardCycleBudgetSchema);

// ── Upload tracking (same pattern as every other upload type) ────────────────
const tomCardCycleBudgetUploadSchema = new mongoose.Schema({
  filename:      String,
  cycle_key:     { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  rows_total:    Number,
  rows_imported: Number,
  cards_reissued: Number, // how many cards changed number this cycle — worth surfacing prominently
  errors:        [String],
  warnings:      [String],
  uploaded_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  processed_at:  Date,
}, { timestamps: true });

const TomCardCycleBudgetUpload = mongoose.model('TomCardCycleBudgetUpload', tomCardCycleBudgetUploadSchema);

module.exports = { TomCardCycleBudget, TomCardCycleBudgetUpload };
