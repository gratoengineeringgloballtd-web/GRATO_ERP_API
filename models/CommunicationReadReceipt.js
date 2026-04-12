const mongoose = require('mongoose');

const communicationReadReceiptSchema = new mongoose.Schema({
  communication: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Communication',
    required: true,
    index: true
  },
  
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Tracking data
  readAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  
  // Email open tracking
  emailOpened: {
    type: Boolean,
    default: false
  },
  
  emailOpenedAt: Date,
  
  // Link click tracking
  clickedLinks: [{
    url: String,
    clickedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Device/Browser information (optional)
  userAgent: String,
  
  ipAddress: String,
  
  // Engagement metrics
  timeSpentReading: {
    type: Number, // in seconds
    default: 0
  },
  
  // Mark if user dismissed/archived the message
  dismissed: {
    type: Boolean,
    default: false
  },
  
  dismissedAt: Date
  
}, {
  timestamps: true
});

// Compound index to prevent duplicate read receipts
communicationReadReceiptSchema.index({ communication: 1, user: 1 }, { unique: true });

// Index for analytics queries
communicationReadReceiptSchema.index({ readAt: -1 });
communicationReadReceiptSchema.index({ emailOpened: 1, emailOpenedAt: -1 });

// Static method to get read statistics for a communication
communicationReadReceiptSchema.statics.getReadStats = async function(communicationId) {
  const stats = await this.aggregate([
    { $match: { communication: mongoose.Types.ObjectId(communicationId) } },
    {
      $group: {
        _id: null,
        totalReads: { $sum: 1 },
        emailOpens: { 
          $sum: { $cond: ['$emailOpened', 1, 0] } 
        },
        totalClicks: { 
          $sum: { $size: { $ifNull: ['$clickedLinks', []] } } 
        },
        avgTimeSpent: { 
          $avg: '$timeSpentReading' 
        }
      }
    }
  ]);
  
  return stats[0] || {
    totalReads: 0,
    emailOpens: 0,
    totalClicks: 0,
    avgTimeSpent: 0
  };
};

// Static method to get users who haven't read a communication
communicationReadReceiptSchema.statics.getUnreadUsers = async function(communicationId, recipientUserIds) {
  const readUserIds = await this.distinct('user', { 
    communication: communicationId 
  });
  
  const User = mongoose.model('User');
  return await User.find({
    _id: { $in: recipientUserIds, $nin: readUserIds }
  }).select('email fullName department');
};

// Method to record link click
communicationReadReceiptSchema.methods.recordLinkClick = function(url) {
  this.clickedLinks.push({ url, clickedAt: new Date() });
  return this.save();
};

const CommunicationReadReceipt = mongoose.model('CommunicationReadReceipt', communicationReadReceiptSchema);

module.exports = CommunicationReadReceipt;