const mongoose = require('mongoose');

/**
 * TomCardMapping.js
 * Maps each Tom Card number to the cluster/site it serves.
 * Since this data is not yet available, mapping is admin-configurable
 * and defaults to station-based geographic hints.
 */
const tomCardMappingSchema = new mongoose.Schema({
  card_num:     { type: String, required: true, unique: true },
  card_label:   String,   // human label e.g. "Edea Truck 1"
  cluster:      String,   // primary cluster this card serves
  site_ids:     [String], // specific sites (optional, finer grained)
  station_hint: String,   // fuel station name this card is used at most
  truck_plate:  String,
  driver_name:  String,
  is_active:    { type: Boolean, default: true },
  notes:        String,
  created_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updated_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/**
 * TomCardUpload.js (embedded as separate export)
 * Tracks each Tom Card statement CSV upload.
 */
const tomCardUploadSchema = new mongoose.Schema({
  filename:         String,
  original_filename: String,
  cycle_key:        { type: String, required: true },
  date_range_start: Date,
  date_range_end:   Date,
  status:           { type: String, enum: ['pending','processing','completed','failed'], default: 'pending' },
  rows_in_file:     Number,
  rows_imported:    Number,
  rows_duplicate:   Number,
  total_liters:     Number,
  total_amount_cfa: Number,
  errors:           [String],
  uploaded_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  processed_at:     Date,
}, { timestamps: true });

const TomCardMapping = mongoose.model('TomCardMapping', tomCardMappingSchema);
const TomCardUpload  = mongoose.model('TomCardUpload',  tomCardUploadSchema);

module.exports = { TomCardMapping, TomCardUpload };