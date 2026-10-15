const mongoose = require('mongoose');

// Field-level history of who changed what on important records.
const recordChangeSchema = new mongoose.Schema({
  model:       { type: String, required: true, index: true },
  recordId:    { type: String, default: null },
  recordLabel: { type: String, default: '' },
  action:      { type: String, enum: ['create', 'update', 'delete', 'export'], required: true },
  changes: [{
    _id: false,
    field: String,
    old: mongoose.Schema.Types.Mixed,
    new: mongoose.Schema.Types.Mixed,
    masked: { type: Boolean, default: false }
  }],
  actor: {
    system: Boolean, id: String, name: String, email: String, role: String,
    impersonatedBy: String, ip: String, method: String, path: String
  },
  at: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

recordChangeSchema.index({ model: 1, recordId: 1, at: -1 });
recordChangeSchema.index({ 'actor.id': 1, at: -1 });

// Append-only.
const block = function (next) { next(new Error('Audit records are append-only')); };
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany'].forEach((h) => recordChangeSchema.pre(h, block));

module.exports = mongoose.models.RecordChange || mongoose.model('RecordChange', recordChangeSchema);
