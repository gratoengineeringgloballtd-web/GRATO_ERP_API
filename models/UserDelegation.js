// ═══════════════════════════════════════════════════════════════════════════
// FILE: models/UserDelegation.js  (NEW FILE)
//
// PURPOSE: Stores all user-to-user delegations in a dedicated collection.
//          One document = one delegation relationship (A delegates to B).
//          A single document can cover multiple process types.
// ═══════════════════════════════════════════════════════════════════════════

const mongoose = require('mongoose');
const { getAllProcessTypeKeys } = require('../config/delegationProcessTypes');

// ─────────────────────────────────────────────────────────────────────────────
// ACTION LOG SUB-SCHEMA
// Records every action B takes under this delegation (submission or approval).
// Provides full audit trail: who did what, on whose behalf, on which request.
// ─────────────────────────────────────────────────────────────────────────────
const actionLogSchema = new mongoose.Schema({
  // 'submitted' | 'approved' | 'rejected' | 'commented'
  action: {
    type:     String,
    required: true,
    trim:     true,
  },

  processType: {
    type: String,
    trim: true,
  },

  // The request/document that was acted on
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
  },

  // Human-readable ID for display (e.g. "REQ-00A1B2")
  requestDisplayId: {
    type: String,
    trim: true,
  },

  // The Mongoose model name (e.g. 'CashRequest')
  requestModel: {
    type: String,
    trim: true,
  },

  // Who performed the action (the delegate = B)
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
    required: true,
  },
  performedByName: {
    type: String,
    trim: true,
  },

  // Whose identity was used / who the action is on behalf of (the delegator = A)
  onBehalfOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
    required: true,
  },
  onBehalfOfName: {
    type: String,
    trim: true,
  },

  timestamp: {
    type:    Date,
    default: Date.now,
  },

  note: {
    type: String,
    trim: true,
  },
}, { _id: true });


// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCHEMA
// ─────────────────────────────────────────────────────────────────────────────
const UserDelegationSchema = new mongoose.Schema({

  // ── WHO IS DELEGATING (the principal — user A) ─────────────────────────────
  delegatorId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  delegatorEmail: {
    type:     String,
    required: true,
    trim:     true,
    lowercase: true,
  },
  delegatorName: {
    type:     String,
    required: true,
    trim:     true,
  },

  // ── WHO IS RECEIVING THE DELEGATION (the delegate — user B) ───────────────
  delegateId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  delegateEmail: {
    type:     String,
    required: true,
    trim:     true,
    lowercase: true,
  },
  delegateName: {
    type:     String,
    required: true,
    trim:     true,
  },

  // ── SCOPE ─────────────────────────────────────────────────────────────────
  // 'all'       → every process type is delegated
  // 'selective' → only processTypes[] entries are delegated
  scope: {
    type:     String,
    enum:     ['all', 'selective'],
    required: true,
    default:  'selective',
  },

  // List of process type keys (from delegationProcessTypes.js).
  // Ignored when scope === 'all' (treated as all types).
  processTypes: {
    type: [String],
    default: [],
    validate: {
      validator: function (arr) {
        if (this.scope === 'all') return true;
        const valid = getAllProcessTypeKeys();
        return arr.every((t) => valid.includes(t));
      },
      message: 'One or more invalid process types',
    },
  },

  // ── STATUS ─────────────────────────────────────────────────────────────────
  status: {
    type:    String,
    enum:    ['active', 'paused', 'revoked', 'expired'],
    default: 'active',
  },

  // ── DATE RANGE ─────────────────────────────────────────────────────────────
  startDate: {
    type:    Date,
    default: Date.now,
  },

  // null = indefinite (until manually revoked)
  endDate: {
    type:    Date,
    default: null,
  },

  // ── REASON / NOTES ─────────────────────────────────────────────────────────
  reason: {
    type: String,
    trim: true,
  },

  // ── AUDIT ──────────────────────────────────────────────────────────────────
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
  },

  revokedAt: {
    type: Date,
  },
  revokedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
  },
  revokedReason: {
    type: String,
    trim: true,
  },

  // Snapshot of how many requests were transferred when delegation was activated
  transferSummary: {
    transferredAt:    Date,
    totalTransferred: { type: Number, default: 0 },
    byType: [
      {
        processType:  String,
        transferred:  Number,
      },
    ],
  },

  // ── ACTION LOG (capped — last 200 actions) ─────────────────────────────────
  actionLog: {
    type:    [actionLogSchema],
    default: [],
  },

}, {
  timestamps: true,
  toJSON:     { virtuals: true },
  toObject:   { virtuals: true },
});


// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────
UserDelegationSchema.index({ delegatorId: 1, status: 1 });
UserDelegationSchema.index({ delegateId:  1, status: 1 });
UserDelegationSchema.index({ delegatorEmail: 1, status: 1 });
UserDelegationSchema.index({ delegateEmail:  1, status: 1 });
UserDelegationSchema.index({ status: 1, endDate: 1 });


// ─────────────────────────────────────────────────────────────────────────────
// VIRTUALS
// ─────────────────────────────────────────────────────────────────────────────

/** True if this delegation is currently in effect. */
UserDelegationSchema.virtual('isActive').get(function () {
  if (this.status !== 'active') return false;
  const now = new Date();
  if (this.startDate && this.startDate > now) return false;
  if (this.endDate   && this.endDate   < now) return false;
  return true;
});

/** Human-readable list of delegated type labels. */
UserDelegationSchema.virtual('processTypeLabels').get(function () {
  if (this.scope === 'all') return ['All processes'];
  const { DELEGATION_PROCESS_TYPES } = require('../config/delegationProcessTypes');
  return this.processTypes.map(
    (t) => DELEGATION_PROCESS_TYPES[t]?.label || t
  );
});


// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE METHODS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if this delegation covers the given process type.
 */
UserDelegationSchema.methods.coversProcessType = function (processType) {
  if (!this.isActive) return false;
  if (this.scope === 'all') return true;
  return this.processTypes.includes(processType);
};

/**
 * Returns the full list of covered process type keys.
 */
UserDelegationSchema.methods.getCoveredTypes = function () {
  if (this.scope === 'all') return getAllProcessTypeKeys();
  return [...this.processTypes];
};

/**
 * Append an entry to the action log (capped at 200 entries).
 */
UserDelegationSchema.methods.logAction = async function (entry) {
  this.actionLog.push(entry);
  // Keep last 200 entries
  if (this.actionLog.length > 200) {
    this.actionLog = this.actionLog.slice(-200);
  }
  await this.save();
};


// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find all active delegations where `email` is the DELEGATOR (outgoing).
 */
UserDelegationSchema.statics.findOutgoing = function (email) {
  return this.find({
    delegatorEmail: email.toLowerCase(),
    status:         'active',
    $or: [
      { endDate: null },
      { endDate: { $gt: new Date() } },
    ],
  }).populate('delegateId', 'fullName email position department role');
};

/**
 * Find all active delegations where `email` is the DELEGATE (incoming).
 */
UserDelegationSchema.statics.findIncoming = function (email) {
  return this.find({
    delegateEmail: email.toLowerCase(),
    status:        'active',
    $or: [
      { endDate: null },
      { endDate: { $gt: new Date() } },
    ],
  }).populate('delegatorId', 'fullName email position department role');
};

/**
 * Check if `delegateEmail` is an active delegate for `delegatorEmail`
 * for the given `processType`.  Returns the delegation doc or null.
 */
UserDelegationSchema.statics.findActiveDelegation = async function (
  delegatorEmail,
  delegateEmail,
  processType
) {
  const delegations = await this.find({
    delegatorEmail: delegatorEmail.toLowerCase(),
    delegateEmail:  delegateEmail.toLowerCase(),
    status:         'active',
    $or: [
      { endDate: null },
      { endDate: { $gt: new Date() } },
    ],
  });

  return delegations.find((d) => d.coversProcessType(processType)) || null;
};

/**
 * Auto-expire delegations whose endDate has passed.
 * Called by a cron job or at startup.
 */
UserDelegationSchema.statics.expireOverdue = async function () {
  const result = await this.updateMany(
    {
      status:  'active',
      endDate: { $lt: new Date(), $ne: null },
    },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount;
};


// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOK
// Auto-expire if endDate has passed when the doc is loaded and re-saved.
// ─────────────────────────────────────────────────────────────────────────────
UserDelegationSchema.pre('save', function (next) {
  if (
    this.status === 'active' &&
    this.endDate &&
    new Date(this.endDate) < new Date()
  ) {
    this.status = 'expired';
  }
  next();
});


module.exports = mongoose.model('UserDelegation', UserDelegationSchema);