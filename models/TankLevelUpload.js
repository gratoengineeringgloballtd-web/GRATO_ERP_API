/**
 * TankLevelUpload.js
 * Tracks each daily tank-level CSV upload — same pattern as
 * CmsUpload/GratoUpload/SiteBudgetUpload.
 */
const mongoose = require('mongoose');

const tankLevelUploadSchema = new mongoose.Schema({
  filename:       String,
  reading_date:   { type: String, required: true }, // YYYY-MM-DD this file represents
  cycle_key:      String,

  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },

  rows_total:     Number,
  sites_ok:       Number,
  sites_sensor_error: Number,
  sites_skipped:  Number, // rows referencing a site_id not found in Site collection
  errors:         [String],
  warnings:       [String],

  uploaded_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  processed_at:   Date,
}, { timestamps: true });

module.exports = mongoose.model('TankLevelUpload', tankLevelUploadSchema);
