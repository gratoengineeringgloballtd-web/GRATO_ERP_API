const mongoose = require('mongoose');

// ============================================
// DEPARTMENT ENUM — synced with DEPARTMENT_STRUCTURE
// ============================================
const VALID_DEPARTMENTS = [
  'IT',
  'Technical',
  'Business Development & Supply Chain',
  'HR & Admin',
  'Finance',
  'Company',
  'Other'
];

// ============================================
// SHAREPOINT FOLDER SCHEMA
// ============================================
const SharePointFolderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    maxlength: 500
  },
  department: {
    type: String,
    required: true,
    enum: VALID_DEPARTMENTS   // ← FIXED: was ['Company','Finance','HR & Admin','IT','Supply Chain','Technical']
  },

  privacyLevel: {
    type: String,
    enum: ['public', 'department', 'confidential'],
    default: 'department',
    required: true
  },

  // Legacy — kept for backward compat
  isPublic: {
    type: Boolean,
    default: false
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  accessControl: {
    allowedDepartments: [String],
    allowedUsers: [mongoose.Schema.Types.ObjectId],

    invitedUsers: [{
      userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      permission: { type: String, enum: ['view', 'download', 'upload', 'manage'], default: 'download', required: true },
      invitedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      invitedAt:  { type: Date, default: Date.now }
    }],

    blockedUsers: [{
      userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      blockedAt: { type: Date, default: Date.now },
      reason:    String
    }],

    deniedUsers: [mongoose.Schema.Types.ObjectId]
  },

  fileCount:    { type: Number, default: 0 },
  totalSize:    { type: Number, default: 0 },
  lastModified: Date

}, { timestamps: true });

SharePointFolderSchema.index({ department: 1, privacyLevel: 1 });
SharePointFolderSchema.index({ 'accessControl.invitedUsers.userId': 1 });
SharePointFolderSchema.index({ createdBy: 1 });


// ============================================
// FILE COMMENT SCHEMA (embedded)
// ============================================
const FileCommentSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:         { type: String, required: true, maxlength: 2000 },
  versionIndex: { type: Number, default: null },  // optional: pin to a specific version
  isDeleted:    { type: Boolean, default: false }
}, { timestamps: true });


// ============================================
// AUDIT ENTRY SCHEMA (embedded, capped at 500)
// ============================================
const AuditEntrySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'view', 'download',
      'checkout', 'checkin', 'checkout_expired',
      'upload_version',
      'comment', 'comment_delete',
      'collaborator_add', 'collaborator_remove',
      'share', 'access_granted', 'access_revoked'
    ],
    required: true
  },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, default: Date.now },
  meta:      { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });


// ============================================
// SHAREPOINT FILE SCHEMA
// ============================================
const SharePointFileSchema = new mongoose.Schema({
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SharePointFolder',
    required: true
  },
  name:        { type: String, required: true, trim: true, maxlength: 255 },
  description: String,
  mimetype:    String,
  size:        Number,

  // Supports both local disk and Cloudinary
  path:        String,   // local path OR Cloudinary secure_url
  publicId:    String,   // Cloudinary public_id
  storageType: { type: String, enum: ['local', 'cloudinary'], default: 'local' },

  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, default: Date.now },

  // ── Sharing ──────────────────────────────────────────────────────────────
  sharedWith: [{
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    department: String,
    permission: { type: String, enum: ['view', 'download', 'edit'], default: 'download' },
    type:       { type: String, enum: ['user', 'department'] },
    sharedAt:   Date,
    sharedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],

  shareLink: {
    token:       String,
    expiresAt:   Date,
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    accessCount: { type: Number, default: 0 },
    maxAccess:   Number,
    password:    String
  },

  downloads:   { type: Number, default: 0 },
  downloadLog: [{
    userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    downloadedAt: { type: Date, default: Date.now },
    ipAddress:    String
  }],

  tags:     [String],
  category: String,

  // ── Version control ───────────────────────────────────────────────────────
  versions: [{
    versionNumber: Number,
    path:          String,
    publicId:      String,
    size:          Number,
    mimetype:      String,
    uploadedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt:    { type: Date, default: Date.now },
    changeNote:    { type: String, maxlength: 500, default: '' }
  }],

  // ── Check-out / check-in ─────────────────────────────────────────────────
  // null  → file is free to edit
  // set   → locked by that user until expiresAt
  checkout: {
    userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    checkedOutAt: Date,
    expiresAt:    Date,   // auto-expire after 2 h; renewable
    note:         { type: String, maxlength: 300 }
  },

  // ── Named collaborators (people given explicit edit access on this file) ─
  collaborators: [{
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    permission: { type: String, enum: ['view', 'download', 'edit'], default: 'download' },
    addedAt:    { type: Date, default: Date.now },
    addedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],

  // Per-file discussion thread
  comments: [FileCommentSchema],

  // Embedded audit trail — last 500 entries
  auditTrail: {
    type:    [AuditEntrySchema],
    default: []
  },

  isDeleted:  { type: Boolean, default: false },
  deletedAt:  Date,
  deletedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' }

}, { timestamps: true });

// Cap embedded audit trail
SharePointFileSchema.pre('save', function (next) {
  if (this.auditTrail && this.auditTrail.length > 500) {
    this.auditTrail = this.auditTrail.slice(-500);
  }
  next();
});

SharePointFileSchema.index({ folderId: 1, isDeleted: 1 });
SharePointFileSchema.index({ uploadedBy: 1 });
SharePointFileSchema.index({ 'sharedWith.userId': 1 });
SharePointFileSchema.index({ 'shareLink.token': 1 });
SharePointFileSchema.index({ 'checkout.expiresAt': 1 });


// ============================================
// ACTIVITY LOG SCHEMA (global / admin view)
// ============================================
const SharePointActivityLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'upload', 'download', 'delete', 'share', 'view',
      'folder_create', 'folder_update', 'folder_delete',
      'access_granted', 'access_revoked',
      'user_invited', 'user_blocked', 'permission_changed',
      'version_create', 'version_restore',
      'comment_add', 'comment_delete',
      'collaborator_add', 'collaborator_remove',
      'checkout', 'checkin', 'checkout_expired'
    ],
    required: true
  },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileId:       mongoose.Schema.Types.ObjectId,
  folderId:     mongoose.Schema.Types.ObjectId,
  fileName:     String,
  folderName:   String,
  targetUserId: mongoose.Schema.Types.ObjectId,
  permission:   String,
  details:      mongoose.Schema.Types.Mixed,
  timestamp:    { type: Date, default: Date.now, index: true }
});

SharePointActivityLogSchema.index({ userId: 1, timestamp: -1 });
SharePointActivityLogSchema.index({ folderId: 1, timestamp: -1 });
SharePointActivityLogSchema.index({ action: 1, timestamp: -1 });


// ============================================
// EXPORTS
// ============================================
module.exports = {
  SharePointFolder:      mongoose.model('SharePointFolder', SharePointFolderSchema),
  SharePointFile:        mongoose.model('SharePointFile', SharePointFileSchema),
  SharePointActivityLog: mongoose.model('SharePointActivityLog', SharePointActivityLogSchema),
  VALID_DEPARTMENTS
};


