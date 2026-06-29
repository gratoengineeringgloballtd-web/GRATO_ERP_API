const mongoose = require('mongoose');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════
// SignableDocument.js
//
// Core model for the PDF e-signature feature ("DocuSign-style" signing).
//
// Design notes (matching existing app conventions):
//   - Signer identity is SNAPSHOTTED (name/email/role) at chain-build time,
//     same pattern as CashRequest.approvalChain — protects history if a
//     user's role/email changes later.
//   - Strictly sequential: level N+1 is not notified until level N signs.
//     Mirrors pending_supervisor -> pending_departmental_head pattern.
//   - Rejection kills the whole chain (status: 'rejected'); resubmission
//     clones into a NEW document, preserving the rejected one untouched.
//   - Coordinates for signature fields are stored as NORMALIZED FRACTIONS
//     (0-1) of page width/height, not absolute points. This keeps placement
//     consistent regardless of what zoom/DPI the placement UI rendered at,
//     or what page size the final renderer uses.
//   - Admin/IT/CEO bypass mirrors EnhancedProtectedRoute's role bypass.
// ═══════════════════════════════════════════════════════════════════════════

const SIGNER_STATUSES = ['pending', 'signed', 'rejected', 'skipped'];
const DOCUMENT_STATUSES = ['draft', 'pending_signatures', 'completed', 'rejected', 'cancelled'];
const FIELD_TYPES = ['signature', 'initials', 'date', 'text'];

// ── Embedded: a single signer slot in the chain ─────────────────────────────
const SignerSchema = new mongoose.Schema({
  level: { type: Number, required: true }, // 1-indexed, strictly ascending, no gaps

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Snapshot at chain-build time (protects history if user details change later)
  name:       { type: String, required: true },
  email:      { type: String, required: true, lowercase: true, trim: true },
  role:       { type: String, default: '' },        // e.g. "Supervisor", "Departmental Head"
  department: { type: String, default: '' },

  isExtra: { type: Boolean, default: false }, // true = manually inserted by uploader

  status: { type: String, enum: SIGNER_STATUSES, default: 'pending' },

  // No-login signing token (per-signer, per-document)
  accessToken: { type: String, required: true, index: true },
  tokenCreatedAt: { type: Date, default: Date.now },

  notifiedAt:  Date,   // when this signer was first emailed (i.e. became current level)
  signedAt:    Date,
  rejectedAt:  Date,
  rejectionReason: { type: String, maxlength: 1000 },

  // Reminder tracking — mirrors ceoApprovalEscalation pattern
  remindersSent:  { type: Number, default: 0 },
  lastReminderAt: Date,

  // Admin/IT/CEO override trail (force-sign or reassignment)
  forcedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  forcedAt:     Date,
  reassignedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // original signer if reassigned

  ipAddress: String // captured at moment of signing, for audit purposes
}, { _id: true });

// ── Embedded: a single placed field (signature box, date box, etc.) ────────
const FieldSchema = new mongoose.Schema({
  page: { type: Number, required: true, min: 1 },

  // Normalized fractions of page width/height — see header note
  x:      { type: Number, required: true, min: 0, max: 1 },
  y:      { type: Number, required: true, min: 0, max: 1 },
  width:  { type: Number, required: true, min: 0, max: 1 },
  height: { type: Number, required: true, min: 0, max: 1 },

  type: { type: String, enum: FIELD_TYPES, default: 'signature' },

  // Which signer (by level, not by user — survives reassignment) owns this field
  assignedSignerLevel: { type: Number, required: true },

  label: { type: String, default: '' }, // optional uploader-facing label, e.g. "Sign here"
  required: { type: Boolean, default: true },

  // Filled in once the assigned signer completes this field
  value: { type: String, default: null },  // signature image dataURL ref / typed text / ISO date
  filledAt: Date
}, { _id: true });

// ── Embedded: audit trail entry — mirrors SharePointFile's AuditEntrySchema ─
const SignDocAuditSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'created', 'field_added', 'field_removed', 'chain_built', 'submitted',
      'signer_notified', 'reminder_sent', 'signed', 'rejected',
      'completed', 'cancelled', 'forced_sign', 'reassigned',
      'viewed', 'downloaded', 'resubmitted_from', 'resubmitted_as'
    ],
    required: true
  },
  byUser:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null if action by token-holder pre-auth
  byEmail: String,   // snapshot, in case byUser is null (no-login signer)
  timestamp: { type: Date, default: Date.now },
  ipAddress: String,
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

// ── Main schema ──────────────────────────────────────────────────────────────
const SignableDocumentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 255 },
  description: { type: String, maxlength: 1000 },

  initiator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // ── Original uploaded file (stored via SharePoint integration) ───────────
  originalFile: {
    sharepointFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'SharePointFile' },
    name:     { type: String, required: true },
    path:     String,     // local path or Cloudinary URL, denormalized for fast access
    publicId: String,
    storageType: { type: String, enum: ['local', 'cloudinary'], default: 'local' },
    size:     Number,
    pageCount: { type: Number, required: true }
  },

  // ── Final flattened, fully-signed PDF (null until status === 'completed') ─
  finalSignedFile: {
    sharepointFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'SharePointFile' },
    path:     String,
    publicId: String,
    storageType: { type: String, enum: ['local', 'cloudinary'] },
    generatedAt: Date
  },

  status: { type: String, enum: DOCUMENT_STATUSES, default: 'draft' },

  chainMode: { type: String, enum: ['hierarchical', 'custom'], required: true },

  signers: { type: [SignerSchema], default: [] },
  fields:  { type: [FieldSchema], default: [] },

  currentLevel: { type: Number, default: 0 }, // 0 until submitted; then = active signer's level

  // Rejection summary (kept at top level too, for quick querying/filtering)
  rejectedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedAt:        Date,
  rejectionReason:   String,

  // Resubmission lineage
  resubmittedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'SignableDocument' }, // points to the rejected doc this replaces
  resubmittedAs:   { type: mongoose.Schema.Types.ObjectId, ref: 'SignableDocument' }, // points to the new doc, if this one was rejected & replaced

  submittedAt: Date,
  completedAt: Date,
  cancelledAt: Date,

  // Reminder/escalation config — mirrors User.ceoAvailability.autoEscalation
  reminderConfig: {
    reminderAfterDays:  { type: Number, default: 2 },
    escalateAfterDays:  { type: Number, default: 5 }
  },

  auditTrail: { type: [SignDocAuditSchema], default: [] }

}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────────────────────
SignableDocumentSchema.index({ initiator: 1, status: 1 });
SignableDocumentSchema.index({ 'signers.user': 1, 'signers.status': 1 });
SignableDocumentSchema.index({ 'signers.accessToken': 1 });
SignableDocumentSchema.index({ status: 1, currentLevel: 1 });

// ── Cap audit trail like SharePointFile does ─────────────────────────────────
SignableDocumentSchema.pre('save', function (next) {
  if (this.auditTrail && this.auditTrail.length > 500) {
    this.auditTrail = this.auditTrail.slice(-500);
  }
  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════

/** Generate a cryptographically random per-signer access token. */
SignableDocumentSchema.methods.generateSignerToken = function () {
  return crypto.randomBytes(32).toString('hex');
};

/** Returns the signer object currently at the active level, or null. */
SignableDocumentSchema.methods.getCurrentSigner = function () {
  if (this.status !== 'pending_signatures') return null;
  return this.signers.find(s => s.level === this.currentLevel) || null;
};

/** Returns fields belonging to a given signer level. */
SignableDocumentSchema.methods.getFieldsForLevel = function (level) {
  return this.fields.filter(f => f.assignedSignerLevel === level);
};

/**
 * Validate the signer list: levels must be 1..N with no gaps or duplicates,
 * and every field's assignedSignerLevel must reference a real signer level.
 */
SignableDocumentSchema.methods.validateChainIntegrity = function () {
  const levels = this.signers.map(s => s.level).sort((a, b) => a - b);
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] !== i + 1) {
      return { valid: false, error: `Signer levels must be sequential starting at 1 (gap/duplicate at position ${i + 1})` };
    }
  }
  const validLevels = new Set(levels);
  for (const field of this.fields) {
    if (!validLevels.has(field.assignedSignerLevel)) {
      return { valid: false, error: `Field on page ${field.page} assigned to non-existent signer level ${field.assignedSignerLevel}` };
    }
  }
  if (this.fields.length === 0) {
    return { valid: false, error: 'At least one signature field must be placed before submission' };
  }
  return { valid: true };
};

/** Append an audit entry (in-memory; caller still needs to .save()). */
SignableDocumentSchema.methods.addAudit = function (action, { byUser, byEmail, ipAddress, meta } = {}) {
  this.auditTrail.push({ action, byUser, byEmail, ipAddress, meta: meta || {} });
};

/**
 * Advance the chain to the next level after a signature is recorded.
 * Returns { completed: boolean, nextSigner: Signer|null }.
 */
SignableDocumentSchema.methods.advanceToNextLevel = function () {
  const maxLevel = this.signers.reduce((max, s) => Math.max(max, s.level), 0);
  if (this.currentLevel >= maxLevel) {
    this.status = 'completed';
    this.completedAt = new Date();
    return { completed: true, nextSigner: null };
  }
  this.currentLevel += 1;
  const nextSigner = this.signers.find(s => s.level === this.currentLevel);
  return { completed: false, nextSigner };
};

module.exports = mongoose.model('SignableDocument', SignableDocumentSchema);
module.exports.SIGNER_STATUSES = SIGNER_STATUSES;
module.exports.DOCUMENT_STATUSES = DOCUMENT_STATUSES;
module.exports.FIELD_TYPES = FIELD_TYPES;