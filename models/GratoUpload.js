/**
 * GratoUpload_model_fix.js
 * diesel-system/models/GratoUpload.js  — REPLACE ENTIRELY
 *
 * FIX: errors field was [String] but we were storing objects {site,date,error}.
 * Changed to Mixed so both string and object formats are accepted, OR
 * keep [String] and always serialise before saving (via serialiseErrors()).
 *
 * This version uses Mixed for maximum flexibility.
 */
'use strict';

const mongoose = require('mongoose');

const gratoUploadSchema = new mongoose.Schema({
  cycle_key: {
    type:     String,
    required: true,
    index:    true,
  },
  filename: {
    type: String,
  },
  uploaded_by: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  upload_type: {
    type:    String,
    enum:    ['grato_daily_report', 'grato_visit_sheet', 'auto'],
    default: 'grato_daily_report',
  },
  rows_total: {
    type:    Number,
    default: 0,
  },
  rows_imported: {
    type:    Number,
    default: 0,
  },
  rows_skipped: {
    type:    Number,
    default: 0,
  },
  technician_links: {
    type:    Number,
    default: 0,
  },
  generator_swaps: {
    type:    Number,
    default: 0,
  },
  error_count: {
    type:    Number,
    default: 0,
  },
  /**
   * errors: Mixed array — stores either plain strings or
   * serialised {site, date, error} objects.
   * Use serialiseErrors() from gratoImportService_fix.js before storing
   * if your upstream code stores objects.
   */
  errors: {
    type:    [mongoose.Schema.Types.Mixed],
    default: [],
  },
  status: {
    type:    String,
    enum:    ['success', 'partial', 'failed'],
    default: 'success',
  },
}, {
  timestamps: true,
});

gratoUploadSchema.index({ cycle_key: 1, createdAt: -1 });

module.exports = mongoose.model('GratoUpload', gratoUploadSchema);
