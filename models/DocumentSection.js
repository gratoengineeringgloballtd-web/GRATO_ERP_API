const mongoose = require('mongoose');

// Custom document sections for the HR employee document manager. The 10 built-in
// section types (National ID, Birth Certificate, etc.) live directly on the User
// schema and are not stored here - this collection only holds sections added later,
// beyond what was originally included.
//
// Sections can be nested: a section with isFolder=true is a pure organizational
// container (no documents get uploaded directly to it, it just groups other sections/
// folders underneath it), while isFolder=false is a leaf section that documents are
// actually uploaded into - matching how the SharePoint portal's folder tree works.
//
// Scope controls visibility:
//   - 'global' sections (the default set, seeded once) are available company-wide -
//     every employee's document manager shows them.
//   - 'personal' sections are tied to one specific employee (employeeId) and only ever
//     appear in that one employee's document manager - nobody else sees them.
const DocumentSectionSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
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

  // ── Visibility scope ──────────────────────────────────────────────────
  scope: {
    type: String,
    enum: ['global', 'personal'],
    default: 'global'
  },
  // Only set (and only meaningful) when scope === 'personal' - the one employee this
  // section belongs to and is visible for.
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
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
DocumentSectionSchema.index({ scope: 1, employeeId: 1 });
// Key uniqueness is scoped by employeeId rather than global: two global sections (both
// employeeId: null) still can't share a key, but two different employees can each have
// a personal section with the same key without colliding.
DocumentSectionSchema.index({ key: 1, employeeId: 1 }, { unique: true });
// Same idea for sibling label uniqueness under a given parent - scoped per employee for
// personal sections, company-wide for global ones (employeeId: null on both sides).
DocumentSectionSchema.index({ parentFolder: 1, label: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model('DocumentSection', DocumentSectionSchema);
