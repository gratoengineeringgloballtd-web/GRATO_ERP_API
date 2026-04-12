const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'task_created',
      'task_updated',
      'task_assigned',
      'task_completed',
      'task_cancelled',
      'payment_received',
      'payment_sent',
      'new_message',
      'rating_received',
      'system_notification'
    ]
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  data: {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task'
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment'
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    additionalData: mongoose.Schema.Types.Mixed
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  expireAt: {
    type: Date
  },
  deliveryStatus: {
    socket: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending'
    },
    push: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending'
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 }); 

// Pre-save middleware to set expiration
notificationSchema.pre('save', function(next) {
  if (!this.expireAt) {
    // Set default expiration to 30 days
    this.expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  next();
});

module.exports = mongoose.model('Notification', notificationSchema);