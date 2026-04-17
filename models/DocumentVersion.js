const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

// models/DocumentVersion.js  — Version control for ComplianceDocuments
// ─────────────────────────────────────────────────────────────────────────────
const documentVersionSchema = new mongoose.Schema({
  documentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'ComplianceDocument', required: true },
  versionNumber:   { type: Number, required: true },
  changeSummary:   { type: String, trim: true, default: '' },
  changedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  file: {
    url:          String,
    publicId:     String,
    originalName: String,
    format:       String,
    bytes:        Number
  },
  status:          { type: String, enum: ['draft', 'published', 'superseded'], default: 'published' },
  publishedAt:     { type: Date, default: Date.now }
}, { timestamps: true });
 
documentVersionSchema.index({ documentId: 1, versionNumber: -1 });
 
module.exports = mongoose.model('DocumentVersion', documentVersionSchema);
 