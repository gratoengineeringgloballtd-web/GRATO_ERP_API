/**
 * ValidationUpload.js
 * Tracks each upload of the GRATO Validation Template file
 * (Main sheet = per-visit rows, Validation sheet = per-site monthly summary).
 */
'use strict';

const mongoose = require('mongoose');

const validationUploadSchema = new mongoose.Schema({
  filename: { type: String, required: true },

  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Main sheet (per-visit) results
  main_rows_total:    { type: Number, default: 0 },
  main_rows_imported: { type: Number, default: 0 },
  main_rows_skipped:  { type: Number, default: 0 },
  main_technician_links: { type: Number, default: 0 },
  main_generator_swaps:  { type: Number, default: 0 },

  // Validation sheet (per-site summary) results
  validation_rows_total:    { type: Number, default: 0 },
  validation_rows_imported: { type: Number, default: 0 },
  validation_rows_skipped:  { type: Number, default: 0 },
  validation_cycles_touched: [String],  // cycle_keys derived from CURRENT DATE
  site_budgets_updated:      { type: Number, default: 0 },

  error_count: { type: Number, default: 0 },
  errors:      { type: [String], default: [] },  // always plain strings — see serialiseErrors

  status: {
    type:    String,
    enum:    ['success', 'partial', 'failed'],
    default: 'success',
  },
}, {
  timestamps: true,
});

validationUploadSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ValidationUpload', validationUploadSchema);