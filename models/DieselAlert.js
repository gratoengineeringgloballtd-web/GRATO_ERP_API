const mongoose = require('mongoose');

/**
 * DieselAlert.js
 * Every triggered alert (from reconciliation engine or daily CMS processing)
 * creates a DieselAlert. These power the in-app notification centre
 * and trigger emails.
 */
const dieselAlertSchema = new mongoose.Schema({
  // ── Classification ──────────────────────────────────────────────────────────
  alert_type: {
    type: String,
    required: true,
    enum: [
      'LOW_FUEL',
      'ZERO_GRID_24H',
      'CONSUMPTION_OVER_CCPH',
      'REFUEL_MISMATCH_CMS',
      'REFUEL_MISMATCH_TOMCARD',
      'MISSING_GRATO',
      'MISSING_CMS',
      'FAULTY_METER',
      'THEFT_SUSPECTED',
      'RH_MISMATCH',
      'GENERATOR_MOVED',
      'CYCLE_CLOSED',
      'DATA_IMPORTED',
      'IMPORT_ERROR',
      'MISSING_TANK_CAPACITY',
    ],
    index: true,
  },
  severity: {
    type: String,
    enum: ['critical', 'high', 'medium', 'low', 'info'],
    default: 'medium',
    index: true,
  },

  // ── Context ─────────────────────────────────────────────────────────────────
  site_id:   { type: String, index: true },
  site_name: String,
  cluster:   String,
  region:    String,
  cycle_key: { type: String, index: true },

  // ── Message ─────────────────────────────────────────────────────────────────
  title:   { type: String, required: true },
  message: { type: String, required: true },
  data:    { type: mongoose.Schema.Types.Mixed }, // any context: variances, values, etc.

  // ── Status ──────────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['open', 'acknowledged', 'resolved', 'dismissed'],
    default: 'open',
    index: true,
  },
  acknowledged_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acknowledged_at: Date,
  resolved_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolved_at:     Date,
  resolution_note: String,

  // ── Notification state ───────────────────────────────────────────────────────
  email_sent:   { type: Boolean, default: false },
  email_sent_at: Date,
  email_recipients: [String],

  // In-app: which users have READ this alert
  read_by: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Deduplication: don't create same alert twice for same site+cycle+type
  dedup_key: { type: String, index: true, sparse: true },
  // format: `${alert_type}:${site_id}:${cycle_key}`
}, {
  timestamps: true,
  collection: 'diesel_alerts'
});

dieselAlertSchema.index({ cycle_key: 1, status: 1, severity: 1 });
dieselAlertSchema.index({ site_id: 1, cycle_key: 1, alert_type: 1 });
dieselAlertSchema.index({ dedup_key: 1 }, { unique: true, sparse: true });

// ── Statics ───────────────────────────────────────────────────────────────────

/**
 * BUG FIX: "Updating the path 'status' would create a conflict at 'status'"
 *
 * Root cause: callers (alertService.processAlerts, fireSystemAlert) pass
 * `status: 'open'` inside `payload`. The old implementation spread the
 * entire payload into `$set` AND always set `status: 'open'` again inside
 * `$setOnInsert`. When `payload.status` is present, MongoDB sees the same
 * field path targeted by two different update operators in one operation
 * and rejects the whole update — so EVERY upsertAlert() call that included
 * a `status` field failed (not just IMPORT_ERROR; the reconciliation engine's
 * alertDefs all pass `status: 'open'` too, so this was failing silently
 * there as well, swallowed by alertService's per-alert try/catch).
 *
 * Fix: never let `status` exist in both operators in the same call.
 *   - Destructure `status` out of payload before building `$set`/`$setOnInsert`.
 *   - If the caller explicitly passed a status, apply it via `$set` only
 *     (so it still updates existing docs, e.g. re-opening a resolved alert).
 *   - If the caller didn't pass one, default it via `$setOnInsert` only
 *     (so new alerts still default to 'open' without colliding with `$set`).
 *   - email_sent keeps the same treatment as before (defaulted on insert
 *     only) since it's not part of the conflicting payload field.
 */
dieselAlertSchema.statics.upsertAlert = async function (payload) {
  const { status, ...rest } = payload;
  const dedup_key = `${payload.alert_type}:${payload.site_id || 'global'}:${payload.cycle_key || 'none'}`;

  const setFields = { ...rest, dedup_key };
  const setOnInsertFields = { email_sent: false };

  if (status !== undefined) {
    // Caller explicitly wants this status — apply on both insert and update
    // via $set only, so it never collides with $setOnInsert.
    setFields.status = status;
  } else {
    // No explicit status from caller — only default it for brand-new docs.
    setOnInsertFields.status = 'open';
  }

  return this.findOneAndUpdate(
    { dedup_key },
    { $set: setFields, $setOnInsert: setOnInsertFields },
    { upsert: true, new: true }
  );
};

dieselAlertSchema.statics.getOpenForUser = function (userId) {
  return this.find({ status: { $in: ['open', 'acknowledged'] } })
    .sort({ severity: 1, createdAt: -1 })
    .limit(100);
};

dieselAlertSchema.statics.getUnreadCount = async function (userId) {
  return this.countDocuments({
    status: { $in: ['open', 'acknowledged'] },
    read_by: { $ne: userId }
  });
};

module.exports = mongoose.model('DieselAlert', dieselAlertSchema);

