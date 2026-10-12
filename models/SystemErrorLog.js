// models/SystemErrorLog.js
// Server-side 5xx responses captured by middlewares/errorCapture.js so IT can
// see what is failing without reading the server terminal. Auto-expires.
const mongoose = require('mongoose');

const systemErrorLogSchema = new mongoose.Schema({
  method: String,
  url: String,
  status: Number,
  message: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userEmail: String,
  userRole: String,
  durationMs: Number
}, { timestamps: { createdAt: true, updatedAt: false } });

systemErrorLogSchema.index({ createdAt: -1 });
// Keep 30 days of errors.
systemErrorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('SystemErrorLog', systemErrorLogSchema);
