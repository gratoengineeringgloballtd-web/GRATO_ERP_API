/**
 * CmsUpload.js
 * Tracks each daily CMS file upload.
 * Allows auditing, re-processing, and detecting missing upload days.
 */
const mongoose = require('mongoose');

const cmsUploadSchema = new mongoose.Schema({
  filename:           { type: String, required: true },
  original_filename:  String,
  file_path:          String,  // path on disk after upload

  // What date range does this file cover?
  data_date:          { type: Date, required: true },   // The "Day" value in the ERS file
  cycle_key:          { type: String, required: true },

  // Processing results
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'partial'],
    default: 'pending'
  },
  sites_in_file:      Number,
  sites_processed:    Number,
  sites_skipped:      Number,    // duplicates / already exists for that date
  errors:             [String],
  warnings:           [String],  // e.g. site in file but not in DB

  // Metadata
  uploaded_by:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  processed_at:       Date,
  processing_time_ms: Number,

  // Reconciliation triggered after upload?
  reconciliation_triggered: { type: Boolean, default: false },
  reconciliation_completed: { type: Boolean, default: false },
}, { timestamps: true });

cmsUploadSchema.index({ data_date: 1 }, { unique: true }); // one upload per day
cmsUploadSchema.index({ cycle_key: 1 });
cmsUploadSchema.index({ status: 1 });

module.exports = mongoose.model('CmsUpload', cmsUploadSchema);