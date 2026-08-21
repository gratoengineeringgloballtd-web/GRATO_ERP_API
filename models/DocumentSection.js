const mongoose = require('mongoose');

// Custom document sections for the HR employee document manager. The 10 built-in
// section types (National ID, Birth Certificate, etc.) live directly on the User
// schema and are not stored here - this collection only holds sections added later,
// beyond what was originally included, so they're available company-wide the moment
// they're created rather than being a one-off per employee.
//
// Sections can be nested: a section with isFolder=true is a pure organizational
// container (no documents get uploaded directly to it, it just groups other sections/
// folders underneath it), while isFolder=false is a leaf section that documents are
// actually uploaded into - matching how the SharePoint portal's folder tree works.
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

  // ── Nesting ────────────────────────────────────────────────────────────
  isFolder: {
    type: Boolean,
    default: false
  },
  parentFolder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DocumentSection',
    default: null
  },
  // Materialized path of ancestor folder IDs, root-first - lets us find "everything
  // under this folder" (or check access/depth) with a single indexed query instead of
  // walking parentFolder links recursively, matching the SharePoint folder pattern.
  ancestors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DocumentSection'
  }],
  depth: {
    type: Number,
    default: 0
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

DocumentSectionSchema.index({ parentFolder: 1 });
DocumentSectionSchema.index({ ancestors: 1 });
// Sibling sections/folders under the same parent must have distinct labels, but the
// same label can be reused under a different parent (matches SharePoint's sibling-
// uniqueness rule rather than a system-wide unique label).
DocumentSectionSchema.index({ parentFolder: 1, label: 1 }, { unique: true });

module.exports = mongoose.model('DocumentSection', DocumentSectionSchema);
