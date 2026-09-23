const mongoose = require('mongoose');

const partRequestSchema = new mongoose.Schema({
  request_id: {
    type: String,
    required: true,
    unique: true,
    default: () => `REQ_${Date.now()}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`
  },
  technician: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    part: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Part',
      required: true
    },
    part_name: String, // Snapshot in case part is deleted
    part_number: String,
    quantity: {
      type: Number,
      required: true,
      min: 1
    }
  }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'fulfilled', 'cancelled'],
    default: 'pending'
  },
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  photos: [{
    type: String // URLs to uploaded images of the issue
  }],
  notes: {
    type: String,
    trim: true
  },
  site: {
    type: String, // Optional: if request is for a specific site
    trim: true
  },
  supervisor_approval: {
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approved_at: Date,
    comments: String
  },
  fulfillment_details: {
    fulfilled_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    fulfilled_at: Date,
    tracking_number: String
  }
}, {
  timestamps: true
});

// Indexes
partRequestSchema.index({ technician: 1, status: 1 });
partRequestSchema.index({ status: 1 });

module.exports = mongoose.model('PartRequest', partRequestSchema);
