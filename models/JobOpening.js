const mongoose = require('mongoose');

const JobOpeningSchema = new mongoose.Schema({
  reference: { type: String, unique: true },
  title: { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true },
  headcount: { type: Number, default: 1, min: 1 },
  filled: { type: Number, default: 0, min: 0 },
  employmentType: { type: String, enum: ['permanent', 'fixed_term', 'internship', 'consultant'], default: 'permanent' },
  location: { type: String, trim: true },
  description: { type: String, trim: true },
  requirements: { type: String, trim: true },
  justification: { type: String, trim: true },       // why the post is needed / replaces whom
  salaryMin: { type: Number, min: 0 },
  salaryMax: { type: Number, min: 0 },
  closingDate: Date,
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'open', 'on_hold', 'filled', 'closed', 'rejected'],
    default: 'draft'
  },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rejectionReason: String,
  history: [{
    action: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    comment: String,
    at: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

JobOpeningSchema.index({ status: 1 });

module.exports = mongoose.model('JobOpening', JobOpeningSchema);
