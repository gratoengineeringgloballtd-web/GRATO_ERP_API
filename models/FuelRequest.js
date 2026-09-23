/**
 * FuelRequest.js
 *
 * Tracks the full lifecycle of a fuel request:
 *   request → Minka → Pascal → Didier → Finance → HOB → CEO
 *   → scheduled → FuelPurchase → FuelConsumption (refuel)
 *
 * One record per request. When fully approved, the assigned refueler
 * sees this site on their mobile dashboard with the approved quantity.
 * When the refuel happens, fuel_consumption_id links to the actual record.
 *
 * Budget tracking:
 *   SiteBudget.budget_liters  ← allocated at cycle start
 *   FuelRequest.liters_requested ← what was asked for
 *   FuelRequest.liters_approved  ← what was approved (may differ)
 *   FuelConsumption.fuel_data.fuel_added ← what was actually added
 *
 * Pricing: see config/fuelPricing.js — this used to hardcode
 * "1 liter = 828 XAF" locally (and identically in two other files), which
 * silently ignored SiteBudget.xaf_per_liter's per-site override. The
 * pre-save hook below now looks up the real site+cycle rate; the flat
 * 828 XAF constant is kept only as the documented fleet-wide fallback.
 */

'use strict';

const mongoose = require('mongoose');
const { DEFAULT_FUEL_PRICE_PER_LITER, getFuelPricePerLiter } = require('../config/fuelPricing');

const fuelRequestSchema = new mongoose.Schema({

  // ── Identity ───────────────────────────────────────────────────────────────
  client_id: { type: String, index: true, sparse: true }, // offline idempotency

  // ── Site ───────────────────────────────────────────────────────────────────
  site_id:   { type: String, required: true, index: true },
  site_name: { type: String },
  cluster:   { type: String },
  region:    { type: String },

  // ── Cycle ──────────────────────────────────────────────────────────────────
  cycle_key: { type: String, required: true, index: true }, // e.g. "2026-07"

  // ── Requested quantities ───────────────────────────────────────────────────
  liters_requested: { type: Number, required: true, min: 1 },
  liters_approved:  { type: Number, min: 0 }, // set by Finance when approving
  xaf_requested:    { type: Number },         // liters_requested × fuel_price_per_liter_applied
  xaf_approved:     { type: Number },         // liters_approved  × fuel_price_per_liter_applied
  // The actual XAF/L rate applied when this request was last saved — looked
  // up from SiteBudget.xaf_per_liter for (site_id, cycle_key), falling back
  // to the fleet default. Persisted (not just computed) so Finance can see
  // exactly what rate produced xaf_requested/xaf_approved on audit, even if
  // the site's rate changes later.
  fuel_price_per_liter_applied: { type: Number },

  // ── Current tank state at request time ────────────────────────────────────
  current_fuel_level: { type: Number, min: 0 },
  tank_capacity:      { type: Number, min: 0 },
  fuel_percentage_at_request: { type: Number, min: 0, max: 100 },

  // ── Reason & urgency ──────────────────────────────────────────────────────
  request_reason:  { type: String, required: true },
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  },

  // ── Who raised the request ────────────────────────────────────────────────
  requested_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requested_at:   { type: Date, default: Date.now },
  request_source: {
    type: String,
    enum: ['web', 'mobile'],
    default: 'web',
  },

  // ── Approval chain ────────────────────────────────────────────────────────
  // Structure mirrors CashRequest.approvalChain exactly so the same
  // supervisor approval UI works for both systems.
  approvalChain: [{
    level: { type: Number, required: true },
    approver: {
      name:       { type: String, required: true },
      email:      { type: String, required: true, lowercase: true },
      role:       { type: String, required: true },
      department: { type: String, required: true },
    },
    status:      { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled', 'pending_l1', 'pending_l2', 'pending_l3', 'pending_l4', 'pending_l5', 'pending_l6', 'scheduled', 'purchase_made', 'refueled', 'completed', 'denied'], default: 'pending' },
    comments:    { type: String, default: '' },
    actionDate:  { type: Date },
    actionTime:  { type: String },
    decidedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedDate:{ type: Date, default: null },
  }],

  // ── Overall status ────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: [
      // Approval progression
      'pending_diesel_coordinator',   // Minka
      'pending_operations_manager',   // Pascal
      'pending_technical_director',   // Didier
      'pending_finance',
      'pending_head_of_business',
      'pending_ceo',
      // Terminal approval states
      'approved',   // fully approved, site now scheduled for refueler
      'denied',
      // Execution states (post-approval)
      'scheduled',       // assigned refueler can see it
      'purchase_made',   // refueler has bought fuel (FuelPurchase created)
      'partially_refueled', // some fuel delivered, but not the full approved amount — a follow-up delivery is still expected
      'refueled',        // site has been refueled (FuelConsumption created)
      'completed',       // closed out
    ],
    default: 'pending_diesel_coordinator',
    index: true,
  },

  // ── Assignment (set when approved) ────────────────────────────────────────
  assigned_to:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // refueler
  assigned_at:  { type: Date },
  scheduled_date: { type: Date }, // when the refuel should happen

  // ── Finance approval details ───────────────────────────────────────────────
  finance_decision: {
    decision:     { type: String, enum: ['approved', 'rejected'] },
    comments:     { type: String },
    approved_liters: { type: Number },
    decision_date: { type: Date },
    decided_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },

  // ── Budget linkage ─────────────────────────────────────────────────────────
  site_budget_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SiteBudget' },
  // Snapshot of budget state at request time (for audit)
  budget_snapshot: {
    budget_liters_total: { type: Number },
    budget_liters_used:  { type: Number },
    budget_liters_remaining: { type: Number },
  },

  // ── Execution linkage ──────────────────────────────────────────────────────
  fuel_purchase_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'FuelPurchase' },
  fuel_consumption_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'FuelConsumption' },
  liters_actually_added: { type: Number, min: 0 }, // from FuelConsumption (what was physically added) — now CUMULATIVE across all deliveries if the request was fulfilled in multiple partial trips
  // Full audit trail of every individual delivery against this request —
  // a request can be fulfilled across more than one trip (e.g. a
  // technician uses leftover fuel from an existing purchase first, then
  // returns later with a fresh purchase to complete the remainder). Each
  // entry is one physical delivery event.
  deliveries: [{
    liters_added:        { type: Number, required: true, min: 0 },
    delivered_at:        { type: Date, default: Date.now },
    fuel_consumption_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FuelConsumption' },
    fuel_purchase_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'FuelPurchase' },
    delivered_by:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    was_final_delivery:  { type: Boolean, default: true }, // true = this trip completed the request (tank full or fully delivered); false = more still expected
  }],

  // ── Tom Card purchase details ──────────────────────────────────────────────
  // Entered by refueler on the refueling form at point of purchase
  tom_card_number:      { type: String },   // card used to purchase fuel
  tom_card_station:     { type: String },   // station name
  tom_card_receipt_num: { type: String },   // receipt/transaction number
  tom_card_unit_price:  { type: Number },   // XAF per litre at station
  tom_card_total_cfa:   { type: Number },   // total cost at station
  tomcard_transaction_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TomCardTransaction' }, // auto-matched

  // ── Balance tracking (partial fill handling) ───────────────────────────────
  // When approved=50L but only 30L added, the remaining 20L returns to budget
  // but is tracked here for audit, reconciliation, and potential reuse.
  liters_balance_returned: { type: Number, default: 0 },  // approved - actually_added
  balance_return_reason:   { type: String },               // e.g. "Tank full — 20L returned"
  balance_returned_at:     { type: Date },
  balance_reused_in:       { type: mongoose.Schema.Types.ObjectId, ref: 'FuelRequest' }, // if balance applied to another request

  // ── Deficit tracking (budget exceeded) ────────────────────────────────────
  // When there is no budget left but refueling still needed — approved into deficit
  in_deficit:           { type: Boolean, default: false },
  deficit_liters:       { type: Number, default: 0 },     // amount beyond budget
  deficit_resolved_at:  { type: Date },
  deficit_resolved_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deficit_resolution:   { type: String, enum: ['budget_added', 'transfer_in', 'written_off', null] },
  deficit_notes:        { type: String },

  // ── Tom Card transfer tracking ─────────────────────────────────────────────
  // When fuel is transferred from one card/cluster to cover this request
  card_transfer_from:   { type: String },   // source card number
  card_transfer_cluster:{ type: String },   // source cluster name
  card_transfer_liters: { type: Number },   // amount transferred
  card_transfer_at:     { type: Date },
  card_transfer_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // ── Refuel count alert ─────────────────────────────────────────────────────
  // How many times this site has been refueled in this cycle.
  // Alert fires when > 3.
  cycle_refuel_count: { type: Number, default: 0 },
  auto_generated:        { type: Boolean, default: false },
  // ── Cancellation ────────────────────────────────────────────────────────────
  cancellation_reason:  { type: String },
  cancelled_at:         { type: Date },
  cancelled_by:         { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  over_refuel_alert_sent: { type: Boolean, default: false },

  // ── Disbursement (set by Finance after full approval) ──────────────────────
  disbursed_at: { type: Date },
  disbursement: {
    reference_number: { type: String },
    actual_xaf:       { type: Number },
    payment_method: {
      type: String,
      enum: ['bank_transfer', 'cash', 'tom_card', 'mobile_money', 'cheque'],
      default: 'bank_transfer',
    },
    disbursed_by: { type: String },
    disbursed_at: { type: Date },
  },

  // ── Emergency override (admin / HOB / CEO bypass) ────────────────────────────
  emergency_override: {
    overridden_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    overrider_name:  { type: String },
    overrider_role:  { type: String },
    override_reason: { type: String },
    overridden_at:   { type: Date },
    skipped_levels:  [{ type: Number }],
  },

  // ── Notifications sent ─────────────────────────────────────────────────────
  notifications_sent: [{
    to:        { type: String },
    subject:   { type: String },
    sent_at:   { type: Date, default: Date.now },
    type:      { type: String },
    success:   { type: Boolean },
  }],

}, {
  timestamps: true,
  toJSON:   { virtuals: true },
  toObject: { virtuals: true },
});

// ── Indexes ────────────────────────────────────────────────────────────────────
fuelRequestSchema.index({ site_id: 1, cycle_key: 1 });
fuelRequestSchema.index({ assigned_to: 1, status: 1 });
fuelRequestSchema.index({ 'approvalChain.approver.email': 1, 'approvalChain.status': 1 });
fuelRequestSchema.index({ status: 1, createdAt: -1 });

// ── Virtuals ───────────────────────────────────────────────────────────────────
fuelRequestSchema.virtual('displayId').get(function () {
  return `FUEL-${this._id.toString().slice(-6).toUpperCase()}`;
});

fuelRequestSchema.virtual('is_fully_approved').get(function () {
  return this.status === 'approved' || ['scheduled','purchase_made','partially_refueled','refueled','completed'].includes(this.status);
});

fuelRequestSchema.virtual('approval_progress_pct').get(function () {
  if (!this.approvalChain?.length) return 0;
  const done = this.approvalChain.filter(s => s.status === 'approved').length;
  return Math.round((done / this.approvalChain.length) * 100);
});

// ── Pre-save: compute XAF values ───────────────────────────────────────────────
// Now uses the site+cycle's real fuel rate (SiteBudget.xaf_per_liter) when
// available, instead of always applying the flat 828 XAF fleet default —
// see config/fuelPricing.js for why this matters. The lookup is wrapped so
// a pricing-service hiccup degrades to the old flat-rate behavior rather
// than blocking the save outright.
fuelRequestSchema.pre('save', async function (next) {
  let rate = DEFAULT_FUEL_PRICE_PER_LITER;
  try {
    rate = await getFuelPricePerLiter(this.site_id, this.cycle_key);
  } catch (_) { /* fall back to default — never block a save on a pricing lookup */ }

  this.fuel_price_per_liter_applied = rate;
  this.xaf_requested = Math.round((this.liters_requested || 0) * rate);
  if (this.liters_approved != null) {
    this.xaf_approved = Math.round(this.liters_approved * rate);
  }
  next();
});

// ── Static: count refuels for a site in a cycle ────────────────────────────────
fuelRequestSchema.statics.countCycleRefuels = async function (site_id, cycle_key) {
  return this.countDocuments({
    site_id,
    cycle_key,
    status: { $in: ['refueled', 'completed'] },
  });
};

// ── Static: pending approvals for a given approver email ──────────────────────
fuelRequestSchema.statics.pendingForApprover = function (email) {
  return this.find({
    'approvalChain': {
      $elemMatch: {
        'approver.email': email.toLowerCase(),
        'status': 'pending',
      },
    },
    status: { $nin: ['approved', 'denied', 'refueled', 'completed'] },
  });
};

module.exports = mongoose.model('FuelRequest', fuelRequestSchema);
// Kept for backward compatibility with any other file importing
// FuelRequest.FUEL_PRICE_PER_LITER directly — now points at the single
// centralized default in config/fuelPricing.js instead of a re-declared
// local constant that could drift out of sync.
module.exports.FUEL_PRICE_PER_LITER = DEFAULT_FUEL_PRICE_PER_LITER;
