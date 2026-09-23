// ─────────────────────────────────────────────────────────────────────────
// PASTE TARGET: models/FuelConsumption.js
// Full replacement. Changes from what you sent:
//
//   1. THE ACTUAL CRASH: `workflow_status` enum was missing
//      'purchase_selected' (introduced when fuel purchases were split out
//      from the per-site refuel flow) — added it.
//   2. `client_id` — idempotency key so a queued offline create/PATCH
//      retried after already succeeding doesn't duplicate or error.
//   3. `fuel_purchase` — ref to the FuelPurchase this refuel draws down.
//   4. `visit_date` / `visit_time` — technician-entered date/time of the
//      actual site visit (may be a prior day for after-the-fact submissions).
//   5. `submitted_at` — true device timestamp captured the instant the
//      technician pressed submit, sent as-is even when the request only
//      reaches the server much later via the offline queue.
//   6. `tank_id` / `tank_type` / `tank_info_override` — lets the technician
//      correct tank info shown on the form when it doesn't match what's
//      actually on site; override carries the full before/after only when
//      something was actually changed.
//
// Everything else — all your existing fields, virtuals, pre-save hook,
// instance/static methods — is untouched, just copied through as-is.
// ─────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

const fuelConsumptionSchema = new mongoose.Schema({

  // ── Offline-sync support ──────────────────────────────────────────────────
  client_id: { type: String, index: true, sparse: true },

  // ── Workflow / Refuel Process Tracking ────────────────────────────────────
  workflow_status: {
    type: String,
    enum: [
      'initiated', 'activated', 'fuel_station', 'purchase_selected', 'checked_in',
      'form_opened', 'form_submitted', 'checked_out',
      'completed', 'cancelled', 'error', 'pending',
      'approved', 'rejected', 'fulfilled'
    ],
    default: 'initiated',
    index: true
  },
  workflow_history: [
    {
      status:    { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      meta:      { type: mongoose.Schema.Types.Mixed }
    }
  ],
  workflow_last_updated: { type: Date },

  refuel_submitted: {
    type: Boolean,
    default: false,
    index: true
  },

  // ── Fuel purchase this refuel draws down ──────────────────────────────────
  fuel_purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'FuelPurchase' },

  // ── Site and Generator Reference ──────────────────────────────────────────
  site_id:         { type: String, required: true, index: true },
  site_name:       String,
  generator_id:    { type: String, ref: 'Generator' },
  generator_model: String,

  // ── Visit timing ──────────────────────────────────────────────────────────
  // visit_date/visit_time: when the technician says they were actually on
  // site (editable — may be a prior day for after-the-fact submissions).
  // submitted_at: the true device timestamp at the moment submit was
  // pressed, captured client-side before any network attempt so it's
  // accurate even if this request only reaches the server much later via
  // the offline sync queue. Distinct from `createdAt` (timestamps option
  // below), which reflects when Mongo actually wrote the document.
  visit_date:   { type: String },
  visit_time:   { type: String },
  submitted_at: { type: Date },

  // ── Tank correction (technician-entered, overriding what was on file) ─────
  tank_id:            { type: String },
  tank_type:           { type: String },
  tank_info_override:  { type: mongoose.Schema.Types.Mixed },

  // ── Date and Period ───────────────────────────────────────────────────────
  record_date: { type: Date, required: true, index: true },
  period: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    default: 'daily'
  },

  // ── Fuel Data ─────────────────────────────────────────────────────────────
  fuel_data: {
    opening_level:      { type: Number, required: true, min: 0 },
    closing_level:      { type: Number, required: true, min: 0 },
    fuel_added:         { type: Number, required: true, min: 0, default: 0 },
    fuel_consumed:      { type: Number, required: true, min: 0 },
    tank_capacity:      { type: Number, required: true, min: 0 },
    fuel_type:          { type: String, enum: ['diesel', 'gasoline', 'natural_gas'], default: 'diesel' },
    tank_length_cm:     { type: Number },
    tank_height_cm:     { type: Number },
    tank_width_cm:      { type: Number },
    tank_observations:  { type: String },
    fuel_sensor_status: { type: String },
    dip_stick_before_cm: { type: Number },
    dip_stick_after_cm:  { type: Number }
  },

  // ── Generator Runtime ─────────────────────────────────────────────────────
  runtime_data: {
    opening_hours:             { type: Number, min: 0 },
    closing_hours:             { type: Number, min: 0 },
    runtime_hours:             { type: Number, min: 0 },
    load_average:              { type: Number, min: 0, max: 100 },
    truck_flow_meter_before_l: { type: Number },
    truck_flow_meter_after_l:  { type: Number },
    truck_plate_number:        { type: String },
    departure_time_min:        { type: Number },
    arrival_time_station:      { type: String },
    arrival_time_site:         { type: String },
    transfer_time_min:         { type: Number },
    quantity_transfer_l:       { type: Number }
  },

  // ── Personnel ─────────────────────────────────────────────────────────────
  fse_name:    { type: String },
  planifier:   { type: String },
  guard_name:  { type: String },
  guard_number: { type: String },
  comments:    { type: String },

  // ── Photos ────────────────────────────────────────────────────────────────
  // photos            – primary documentation (meter reading, tank level, receipt)
  // guard_photos      – security guard verification photos
  // measurement_photos – dip-stick / flow-meter measurement photos
  photos:             [{ type: mongoose.Schema.Types.Mixed }],
  guard_photos:       [{ type: mongoose.Schema.Types.Mixed }],
  measurement_photos: [{ type: mongoose.Schema.Types.Mixed }],

  // ── Calculated Metrics ────────────────────────────────────────────────────
  metrics: {
    consumption_rate:  { type: Number, min: 0 },
    efficiency_rating: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'poor', 'critical'],
      default: 'good'
    },
    cost_estimate:    { type: Number, min: 0 },
    anomaly_detected: { type: Boolean, default: false },
    anomaly_reason:   String
  },

  // ── Fuel Request / Approval ───────────────────────────────────────────────
  request_info: {
    fuel_requested:  { type: Number, min: 0 },
    request_reason:  String,
    request_urgency: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requested_at: Date
  },

  approval_status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'fulfilled'],
    default: 'pending'
  },
  approved_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approved_at:      Date,
  approval_notes:   String,
  rejection_reason: String,

  // ── Delivery Info ─────────────────────────────────────────────────────────
  delivery_info: {
    delivered:          { type: Boolean, default: false },
    delivered_at:       Date,
    delivered_quantity: Number,
    delivered_by:       String,
    delivery_notes:     String
  },

  // ── Source Reference ──────────────────────────────────────────────────────
  source: {
    type: String,
    enum: ['site_visit', 'manual_entry', 'automated', 'fuel_request'],
    default: 'site_visit'
  },
  visit_reference:       String,
  maintenance_reference: { type: mongoose.Schema.Types.ObjectId, ref: 'Maintenance' },

  // ── Personnel (recorded / verified) ──────────────────────────────────────
  recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  verified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // ── Metadata ──────────────────────────────────────────────────────────────
  notes: { type: String, maxlength: 1000 },
  tags:  [String]

}, {
  timestamps: true,
  toJSON:     { virtuals: true },
  toObject:   { virtuals: true }
});

// ── Indexes ───────────────────────────────────────────────────────────────────
fuelConsumptionSchema.index({ site_id: 1, record_date: -1 });
fuelConsumptionSchema.index({ generator_id: 1 });
fuelConsumptionSchema.index({ approval_status: 1 });
fuelConsumptionSchema.index({ refuel_submitted: 1 });
fuelConsumptionSchema.index({ 'request_info.requested_at': -1 });
fuelConsumptionSchema.index({ recorded_by: 1 });

// ── Virtuals ──────────────────────────────────────────────────────────────────
fuelConsumptionSchema.virtual('fuel_percentage_remaining').get(function () {
  const capacity  = this.fuel_data?.tank_capacity || 0;
  const remaining = this.fuel_data?.closing_level  || 0;
  return capacity > 0 ? Math.round((remaining / capacity) * 100) : 0;
});

fuelConsumptionSchema.virtual('needs_refuel').get(function () {
  return this.fuel_percentage_remaining < 25;
});

fuelConsumptionSchema.virtual('days_until_empty').get(function () {
  const consumed  = this.fuel_data?.fuel_consumed   || 0;
  const remaining = this.fuel_data?.closing_level   || 0;
  const runtime   = this.runtime_data?.runtime_hours || 1;
  if (consumed === 0 || runtime === 0) return null;
  const rate           = consumed / runtime;
  const hoursRemaining = remaining / rate;
  return Math.floor(hoursRemaining / 24);
});

// ── Pre-save: Calculate metrics ───────────────────────────────────────────────
fuelConsumptionSchema.pre('save', function (next) {
  if (this.fuel_data.opening_level && this.fuel_data.closing_level && this.fuel_data.fuel_added) {
    const calc = this.fuel_data.opening_level + this.fuel_data.fuel_added - this.fuel_data.closing_level;
    if (!this.fuel_data.fuel_consumed) {
      this.fuel_data.fuel_consumed = Math.max(0, calc);
    }
  }

  if (this.runtime_data?.opening_hours && this.runtime_data?.closing_hours && !this.runtime_data?.runtime_hours) {
    this.runtime_data.runtime_hours = this.runtime_data.closing_hours - this.runtime_data.opening_hours;
  }

  if (this.fuel_data.fuel_consumed && this.runtime_data?.runtime_hours && this.runtime_data.runtime_hours > 0) {
    const rate = this.fuel_data.fuel_consumed / this.runtime_data.runtime_hours;
    this.metrics.consumption_rate = rate;
    if      (rate < 0.25) this.metrics.efficiency_rating = 'excellent';
    else if (rate < 0.30) this.metrics.efficiency_rating = 'good';
    else if (rate < 0.40) this.metrics.efficiency_rating = 'fair';
    else if (rate < 0.50) this.metrics.efficiency_rating = 'poor';
    else {
      this.metrics.efficiency_rating = 'critical';
      this.metrics.anomaly_detected  = true;
      this.metrics.anomaly_reason    = 'Abnormally high fuel consumption rate';
    }
  }

  if (this.fuel_data.fuel_consumed > this.fuel_data.tank_capacity * 0.5) {
    this.metrics.anomaly_detected = true;
    this.metrics.anomaly_reason   = 'Unusually high consumption in single period';
  }

  next();
});

// ── Instance methods ──────────────────────────────────────────────────────────
fuelConsumptionSchema.methods.approveFuelRequest = function (approverId, notes) {
  if (this.approval_status !== 'pending') throw new Error('Can only approve pending requests');
  this.approval_status = 'approved';
  this.approved_by     = approverId;
  this.approved_at     = new Date();
  this.approval_notes  = notes;
  return this.save();
};

fuelConsumptionSchema.methods.rejectFuelRequest = function (approverId, reason) {
  if (this.approval_status !== 'pending') throw new Error('Can only reject pending requests');
  this.approval_status  = 'rejected';
  this.approved_by      = approverId;
  this.approved_at      = new Date();
  this.rejection_reason = reason;
  return this.save();
};

fuelConsumptionSchema.methods.markDelivered = function (deliveredQuantity, deliveredBy, notes) {
  if (this.approval_status !== 'approved') throw new Error('Can only mark approved requests as delivered');
  this.approval_status = 'fulfilled';
  this.delivery_info   = {
    delivered:          true,
    delivered_at:       new Date(),
    delivered_quantity: deliveredQuantity,
    delivered_by:       deliveredBy,
    delivery_notes:     notes
  };
  return this.save();
};

fuelConsumptionSchema.methods.approveRequest = fuelConsumptionSchema.methods.approveFuelRequest;
fuelConsumptionSchema.methods.rejectRequest  = fuelConsumptionSchema.methods.rejectFuelRequest;

// ── Static methods ────────────────────────────────────────────────────────────
fuelConsumptionSchema.statics.getSiteSummary = async function (siteId, startDate, endDate) {
  const records = await this.find({
    site_id:     siteId,
    record_date: { $gte: startDate, $lte: endDate }
  }).sort({ record_date: 1 });

  const totalConsumed      = records.reduce((s, r) => s + (r.fuel_data.fuel_consumed    || 0), 0);
  const totalAdded         = records.reduce((s, r) => s + (r.fuel_data.fuel_added        || 0), 0);
  const totalRuntime       = records.reduce((s, r) => s + (r.runtime_data?.runtime_hours || 0), 0);
  const avgConsumptionRate = totalRuntime > 0 ? totalConsumed / totalRuntime : 0;
  const anomalies          = records.filter(r => r.metrics?.anomaly_detected);

  return {
    site_id:              siteId,
    period:               { start: startDate, end: endDate },
    total_consumed:       totalConsumed,
    total_added:          totalAdded,
    total_runtime_hours:  totalRuntime,
    avg_consumption_rate: avgConsumptionRate,
    record_count:         records.length,
    anomalies:            anomalies.length,
    efficiency_trend:     records.map(r => ({
      date:   r.record_date,
      rate:   r.metrics?.consumption_rate,
      rating: r.metrics?.efficiency_rating
    }))
  };
};

fuelConsumptionSchema.statics.getPendingRequests = function (filters = {}) {
  const query = {
    approval_status: 'pending',
    $or: [
      { 'request_info.fuel_requested': { $gt: 0 } },
      { 'fuel_data.fuel_added':         { $gt: 0 } }
    ]
  };
  if (filters.urgency) query['request_info.request_urgency'] = filters.urgency;
  return this.find(query)
    .populate('request_info.requested_by', 'fullName email')
    .populate('recorded_by', 'fullName')
    .sort({ 'request_info.request_urgency': -1, 'request_info.requested_at': 1, record_date: -1 });
};

fuelConsumptionSchema.statics.getConsumptionTrends = async function (period = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - period);
  return this.aggregate([
    { $match: { record_date: { $gte: startDate } } },
    {
      $group: {
        _id: {
          year:  { $year: '$record_date' },
          month: { $month: '$record_date' },
          day:   { $dayOfMonth: '$record_date' }
        },
        total_consumed: { $sum: '$fuel_data.fuel_consumed' },
        total_runtime:  { $sum: '$runtime_data.runtime_hours' },
        avg_efficiency: { $avg: '$metrics.consumption_rate' },
        record_count:   { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ]);
};

module.exports = mongoose.model('FuelConsumption', fuelConsumptionSchema);






