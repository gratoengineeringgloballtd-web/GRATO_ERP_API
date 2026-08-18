const mongoose = require('mongoose');

// Custom document sections for the HR employee document manager. The 10 built-in
// section types (National ID, Birth Certificate, etc.) live directly on the User
// schema and are not stored here - this collection only holds sections added later,
// beyond what was originally included, so they're available company-wide the moment
// they're created rather than being a one-off per employee.
const DocumentSectionSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[a-z0-9_]+$/, 'Key may only contain lowercase letters, numbers, and underscores']
  },
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 300
  },
  required: {
    type: Boolean,
    default: false
  },
  // Multiple documents were already the norm for every section this session (append-only,
  // never replaced) - kept here for forward compatibility in case that ever changes again.
  multiple: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('DocumentSection', DocumentSectionSchema);
