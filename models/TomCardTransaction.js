const mongoose = require('mongoose');

/**
 * TomCardTransaction.js
 * Raw fuel purchase records imported from Tom Card statement (Transactions CSV).
 * One doc per purchase line. Card-to-site mapping is done via TomCardMapping.
 */
const tomCardTransactionSchema = new mongoose.Schema({
  // From CSV
  customer_num:    String,
  customer:        String,
  date:            { type: Date, required: true, index: true },
  hour:            String,
  driver_code:     String,
  registration_num: String,      // truck plate, e.g. "IHS 006"
  card_type:       String,
  card_num:        { type: String, required: true, index: true },
  card_name:       String,
  receipt_num:     String,
  product_code:    String,
  product:         String,       // GAZOLE
  unit_price:      Number,       // CFA per litre
  quantity_l:      { type: Number, required: true },  // litres purchased
  amount_cfa:      Number,
  currency:        String,
  station_num:     String,
  station_name:    String,       // e.g. "TOTALENERGIES EDEA"
  invoice_date:    Date,
  invoice_num:     String,

  // Derived
  cycle_key:       { type: String, index: true },

  // Site linkage (filled when TomCardMapping exists)
  site_id:         { type: String, index: true },
  cluster:         String,
  mapping_confidence: { type: String, enum: ['mapped', 'station_match', 'unlinked'], default: 'unlinked' },

  // Reconciliation
  reconciled:      { type: Boolean, default: false },
  reconciliation_note: String,

  // Upload metadata
  upload_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'TomCardUpload' },
  uploaded_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, collection: 'tomcard_transactions' });

tomCardTransactionSchema.index({ card_num: 1, date: 1 });
tomCardTransactionSchema.index({ cycle_key: 1, site_id: 1 });
tomCardTransactionSchema.index({ station_name: 1 });

// Statics
tomCardTransactionSchema.statics.getCycleTotals = async function (cycle_key) {
  return this.aggregate([
    { $match: { cycle_key } },
    { $group: {
      _id: '$card_num',
      total_liters: { $sum: '$quantity_l' },
      total_cfa:    { $sum: '$amount_cfa' },
      transactions: { $sum: 1 },
    }},
    { $sort: { total_liters: -1 } }
  ]);
};

tomCardTransactionSchema.statics.getStationTotals = async function (cycle_key) {
  return this.aggregate([
    { $match: { cycle_key } },
    { $group: {
      _id: '$station_name',
      total_liters: { $sum: '$quantity_l' },
      total_cfa:    { $sum: '$amount_cfa' },
    }},
  ]);
};

module.exports = mongoose.model('TomCardTransaction', tomCardTransactionSchema);