// models/ITAuditLog.js
// Every privileged action taken from the IT console is recorded here
// (who, what, on whom, from where). Read-only to everyone except via the
// IT console itself.
const mongoose = require('mongoose');

const itAuditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  performedByName: String,
  performedByRole: String,
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  targetName: String,
  description: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: String
}, { timestamps: true });

itAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ITAuditLog', itAuditLogSchema);
