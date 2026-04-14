// models/shared/legalSubSchemas.js
const mongoose = require('mongoose');

const reviewCycleSchema = new mongoose.Schema({
  reviewedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewDate:    { type: Date, default: Date.now },
  outcome:       { type: String, enum: ['approved', 'flagged', 'rejected'], required: true },
  comments:      { type: String, trim: true, default: '' },
  nextReviewDue: { type: Date }
}, { _id: true });

const approvalStepSchema = new mongoose.Schema({
  level: { type: Number, required: true },
  approver: {
    name:       String,
    email:      String,
    role:       String,
    department: String,
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  actionDate: Date,
  comments:   { type: String, trim: true, default: '' }
}, { _id: false });

module.exports = { reviewCycleSchema, approvalStepSchema };