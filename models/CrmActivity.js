const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  type:         { type: String, enum: ['call', 'meeting', 'email', 'note', 'task'], default: 'note' },
  subject:      { type: String, required: true, trim: true },
  notes:        { type: String, trim: true, default: '' },
  activityDate: { type: Date, default: Date.now },
  dueDate:      { type: Date, default: null },     // for tasks / follow-ups
  done:         { type: Boolean, default: false },
  doneAt:       { type: Date, default: null },
  lead:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
  customer:     { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
  owner:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }
}, { timestamps: true });

activitySchema.index({ done: 1, dueDate: 1 });

module.exports = mongoose.models.CrmActivity || mongoose.model('CrmActivity', activitySchema);
