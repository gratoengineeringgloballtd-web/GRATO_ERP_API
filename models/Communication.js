const mongoose = require('mongoose');

const communicationSchema = new mongoose.Schema({
  // Basic Information
  title: {
    type: String,
    required: [true, 'Communication title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  
  content: {
    type: String,
    required: [true, 'Communication content is required']
  },
  
  // Message Classification
  messageType: {
    type: String,
    enum: ['announcement', 'policy', 'emergency', 'newsletter', 'general', 'training', 'event'],
    default: 'general',
    required: true
  },
  
  priority: {
    type: String,
    enum: ['normal', 'important', 'urgent'],
    default: 'normal',
    required: true
  },
  
  // Sender Information
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Recipient Configuration
  recipients: {
    targetType: {
      type: String,
      enum: ['all', 'department', 'role', 'custom', 'group'],
      required: true,
      default: 'all'
    },
    
    // Department-based targeting
    departments: [{
      type: String,
      enum: ['Finance', 'HR', 'IT', 'Supply Chain', 'Technical', 'Company']
    }],
    
    // Role-based targeting
    roles: [{
      type: String,
      enum: ['employee', 'supervisor', 'finance', 'hr', 'it', 'supply_chain', 'buyer', 'admin']
    }],
    
    // Custom user targeting
    users: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    
    // Calculated total recipients
    totalCount: {
      type: Number,
      default: 0
    },
    
    // Excluded users (opt-outs)
    excludedUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  
  // Delivery Configuration
  deliveryMethod: {
    email: {
      type: Boolean,
      default: true
    },
    inApp: {
      type: Boolean,
      default: false
    }
  },
  
  // Attachments
  attachments: [{
    filename: {
      type: String,
      required: true
    },
    originalName: String,
    path: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    mimetype: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Scheduling & Status
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'],
    default: 'draft',
    required: true
  },
  
  scheduledFor: {
    type: Date,
    default: null
  },
  
  sentAt: {
    type: Date,
    default: null
  },
  
  // Delivery Statistics
  deliveryStats: {
    emailsSent: {
      type: Number,
      default: 0
    },
    emailsFailed: {
      type: Number,
      default: 0
    },
    inAppDelivered: {
      type: Number,
      default: 0
    },
    readCount: {
      type: Number,
      default: 0
    },
    clickCount: {
      type: Number,
      default: 0
    },
    bounced: {
      type: Number,
      default: 0
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  
  // Template Configuration
  isTemplate: {
    type: Boolean,
    default: false
  },
  
  templateName: String,
  
  // Metadata
  tags: [{
    type: String,
    trim: true
  }],
  
  // Approval Workflow (if needed for sensitive communications)
  requiresApproval: {
    type: Boolean,
    default: false
  },
  
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  approvedAt: Date,
  
  // Audit Trail
  editHistory: [{
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    editedAt: {
      type: Date,
      default: Date.now
    },
    changes: String
  }],
  
  // Expiry (for time-sensitive communications)
  expiresAt: Date,
  
  isExpired: {
    type: Boolean,
    default: false
  }
  
}, {
  timestamps: true
});

// Indexes for performance
communicationSchema.index({ status: 1, scheduledFor: 1 });
communicationSchema.index({ sender: 1, createdAt: -1 });
communicationSchema.index({ messageType: 1, priority: 1 });
communicationSchema.index({ 'recipients.targetType': 1 });
communicationSchema.index({ sentAt: -1 });
communicationSchema.index({ tags: 1 });

// Virtual for read rate
communicationSchema.virtual('readRate').get(function() {
  if (this.recipients.totalCount === 0) return 0;
  return ((this.deliveryStats.readCount / this.recipients.totalCount) * 100).toFixed(2);
});

// Virtual for delivery success rate
communicationSchema.virtual('deliverySuccessRate').get(function() {
  const totalAttempted = this.deliveryStats.emailsSent + this.deliveryStats.emailsFailed;
  if (totalAttempted === 0) return 0;
  return ((this.deliveryStats.emailsSent / totalAttempted) * 100).toFixed(2);
});

// Pre-save middleware to update expiry status
communicationSchema.pre('save', function(next) {
  if (this.expiresAt && new Date() > this.expiresAt) {
    this.isExpired = true;
  }
  next();
});

// Method to calculate recipient count
communicationSchema.methods.calculateRecipientCount = async function() {
  const User = mongoose.model('User');
  let query = { isActive: true };
  
  // Exclude opted-out users
  if (this.recipients.excludedUsers?.length > 0) {
    query._id = { $nin: this.recipients.excludedUsers };
  }
  
  switch (this.recipients.targetType) {
    case 'all':
      this.recipients.totalCount = await User.countDocuments(query);
      break;
      
    case 'department':
      if (this.recipients.departments?.length > 0) {
        query.department = { $in: this.recipients.departments };
        this.recipients.totalCount = await User.countDocuments(query);
      }
      break;
      
    case 'role':
      if (this.recipients.roles?.length > 0) {
        query.role = { $in: this.recipients.roles };
        this.recipients.totalCount = await User.countDocuments(query);
      }
      break;
      
    case 'custom':
      this.recipients.totalCount = this.recipients.users?.length || 0;
      break;
      
    default:
      this.recipients.totalCount = 0;
  }
  
  return this.recipients.totalCount;
};

// Method to get recipient list
communicationSchema.methods.getRecipientList = async function() {
  const User = mongoose.model('User');
  let query = { isActive: true };
  
  // Exclude opted-out users
  if (this.recipients.excludedUsers?.length > 0) {
    query._id = { $nin: this.recipients.excludedUsers };
  }
  
  switch (this.recipients.targetType) {
    case 'all':
      return await User.find(query).select('email fullName department role');
      
    case 'department':
      if (this.recipients.departments?.length > 0) {
        query.department = { $in: this.recipients.departments };
        return await User.find(query).select('email fullName department role');
      }
      break;
      
    case 'role':
      if (this.recipients.roles?.length > 0) {
        query.role = { $in: this.recipients.roles };
        return await User.find(query).select('email fullName department role');
      }
      break;
      
    case 'custom':
      if (this.recipients.users?.length > 0) {
        query._id = { $in: this.recipients.users };
        return await User.find(query).select('email fullName department role');
      }
      break;
  }
  
  return [];
};

// Method to mark as template
communicationSchema.methods.saveAsTemplate = function(templateName) {
  this.isTemplate = true;
  this.templateName = templateName;
  this.status = 'draft';
  return this.save();
};

// Static method to get dashboard statistics
communicationSchema.statics.getDashboardStats = async function(filters = {}) {
  const stats = await this.aggregate([
    { $match: { status: 'sent', ...filters } },
    {
      $group: {
        _id: null,
        totalSent: { $sum: 1 },
        totalRecipients: { $sum: '$recipients.totalCount' },
        totalEmailsSent: { $sum: '$deliveryStats.emailsSent' },
        totalEmailsFailed: { $sum: '$deliveryStats.emailsFailed' },
        totalReads: { $sum: '$deliveryStats.readCount' },
        avgReadRate: { 
          $avg: { 
            $multiply: [
              { $divide: ['$deliveryStats.readCount', '$recipients.totalCount'] },
              100
            ]
          }
        }
      }
    }
  ]);
  
  const byType = await this.aggregate([
    { $match: { status: 'sent', ...filters } },
    {
      $group: {
        _id: '$messageType',
        count: { $sum: 1 },
        totalRecipients: { $sum: '$recipients.totalCount' }
      }
    }
  ]);
  
  const byPriority = await this.aggregate([
    { $match: { status: 'sent', ...filters } },
    {
      $group: {
        _id: '$priority',
        count: { $sum: 1 }
      }
    }
  ]);
  
  return {
    overall: stats[0] || {
      totalSent: 0,
      totalRecipients: 0,
      totalEmailsSent: 0,
      totalEmailsFailed: 0,
      totalReads: 0,
      avgReadRate: 0
    },
    byType,
    byPriority
  };
};

const Communication = mongoose.model('Communication', communicationSchema);

module.exports = Communication;