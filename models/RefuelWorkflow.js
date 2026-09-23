const mongoose = require('mongoose');

const StatusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  meta: { type: mongoose.Schema.Types.Mixed }, // Optional: device, notes, etc.
});

const RefuelWorkflowSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  status: { type: String, required: true }, // e.g., 'activated', 'checked-in', 'form_opened', 'form_submitted', 'checked-out'
  history: [StatusHistorySchema],
}, { timestamps: true });

module.exports = mongoose.model('RefuelWorkflow', RefuelWorkflowSchema);