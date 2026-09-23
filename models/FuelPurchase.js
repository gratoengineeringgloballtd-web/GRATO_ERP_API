// models/FuelPurchase.js
//
// Represents ONE bulk fuel purchase (e.g. a technician fills up a truck/
// jerry cans at a station). A single purchase can be distributed across
// multiple site refuels over the following days — each site submission
// draws down `remaining_quantity` instead of asking the technician to
// re-capture the purchase photo/quantity every time.

const mongoose = require('mongoose');

const fuelPurchaseSchema = new mongoose.Schema({
  // Stable id generated client-side at creation time. Lets the mobile app
  // resolve this purchase by client_id when it was created while offline
  // and the server-assigned _id wasn't known yet at the time a site
  // refuel referencing it was queued.
  client_id: { type: String, index: true, sparse: true },

  technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  purchase_date: { type: Date, default: Date.now },
  photo: { type: String },

  total_quantity: { type: Number, required: true, min: 0 },
  remaining_quantity: { type: Number, required: true, min: 0 },

  price_per_liter:  Number,
  total_cost:       Number,
  total_cost_xaf:   Number,
  truck_plate_number: String,
  supplier:         String,
  tom_card_number:  String,
  cluster:          String,
  station:          String,
  arrival_time:     Date,
  departure_time:   Date,

  status: {
    type: String,
    enum: ['active', 'depleted', 'cancelled'],
    default: 'active',
  },

  // Audit trail: which sites drew from this purchase, and how much.
  allocations: [{
    site_id: String,
    fuel_consumption_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FuelConsumption' },
    quantity: Number,
    allocated_at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

fuelPurchaseSchema.index({ technician: 1, status: 1, createdAt: -1 });

// Convenience instance method — call after pushing an allocation.
fuelPurchaseSchema.methods.applyAllocation = function (quantity) {
  this.remaining_quantity = Math.max(0, this.remaining_quantity - quantity);
  if (this.remaining_quantity <= 0) {
    this.status = 'depleted';
  }
};

module.exports = mongoose.model('FuelPurchase', fuelPurchaseSchema);

