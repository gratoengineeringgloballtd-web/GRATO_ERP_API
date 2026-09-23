/**
 * SiteBudgetUpload.js
 * Tracks each upload of the Book11 Budget file.
 */
'use strict';

const mongoose = require('mongoose');

const siteBudgetUploadSchema = new mongoose.Schema({
  cycle_key: { type: String, required: true, index: true },
  filename:  { type: String, required: true },

  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  rows_total:    { type: Number, default: 0 },
  rows_imported: { type: Number, default: 0 },
  rows_updated:  { type: Number, default: 0 },
  rows_skipped:  { type: Number, default: 0 },

  error_count: { type: Number, default: 0 },
  errors:      { type: [String], default: [] },
  warnings:    { type: [String], default: [] },

  // Surfaced from siteBudgetImportService.js's header-month cross-check —
  // e.g. { days: "June-26", rh: "June-26", budget: "May-26" }. Lets the
  // upload-history UI flag at a glance which uploads had a label mismatch
  // worth double-checking.
  month_labels_detected: { type: mongoose.Schema.Types.Mixed },

  status: {
    type:    String,
    enum:    ['success', 'partial', 'failed'],
    default: 'success',
  },
}, {
  timestamps: true,
});

siteBudgetUploadSchema.index({ cycle_key: 1, createdAt: -1 });

module.exports = mongoose.model('SiteBudgetUpload', siteBudgetUploadSchema);