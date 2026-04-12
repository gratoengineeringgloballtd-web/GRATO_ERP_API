// server/models/ProjectPlan.js

const mongoose = require('mongoose');

const approvalChainItemSchema = new mongoose.Schema({
  level: {
    type: Number,
    required: true
  },
  approver: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  assignedDate: {
    type: Date,
    default: Date.now
  },
  approvalDate: Date,
  comments: String,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { _id: false });

const projectPlanSchema = new mongoose.Schema({
  projectName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  week: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true,
    index: true
  },
  responsible: {
    type: String,
    required: true
  },
  objectives: {
    type: String,
    required: true
  },
  priorityLevel: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    required: true,
    index: true
  },
  startDate: {
    type: Date,
    required: true,
    index: true
  },
  deadline: {
    type: Date,
    required: true,
    index: true
  },
  estimatedDuration: {
    type: String
  },
  amountNeeded: {
    type: Number,
    required: true,
    min: 0
  },
  projectProgress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  completionItems: [{
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId()
    },
    description: {
      type: String,
      required: true
    },
    isCompleted: {
      type: Boolean,
      default: false
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    completedDate: Date,
    notes: String
  }],
  status: {
    type: String,
    enum: [
      'Draft', 
      'Submitted', 
      'Pending Project Coordinator Approval',
      'Pending Supply Chain Coordinator Approval',
      'Pending Head of Business Approval',
      'Approved', 
      'In Progress', 
      'On Hold', 
      'Completed', 
      'Cancelled',
      'Rejected'
    ],
    default: 'Draft',
    index: true
  },
  accountingAudit: {
    isPosted: {
      type: Boolean,
      default: false
    },
    postedAt: Date,
    entryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry'
    },
    entryNumber: String,
    sourceType: {
      type: String,
      default: 'project_plan_completion'
    }
  },
  issuesAndConcerns: {
    type: String
  },
  attachments: [{
    filename: String,
    url: String,
    uploadDate: Date,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  // Approval Chain
  approvalChain: [approvalChainItemSchema],
  currentApprovalLevel: {
    type: Number,
    default: 0
  },
  
  // Tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  submittedDate: Date,
  finalApprovalDate: Date,
  
  // Rejection tracking
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedDate: Date,
  rejectionReason: String,
  rejectionLevel: Number,
  
  // History
  statusHistory: [{
    status: String,
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    comments: String
  }]
}, {
  timestamps: true
});

// Compound indexes for better query performance
projectPlanSchema.index({ createdBy: 1, status: 1 });
projectPlanSchema.index({ department: 1, status: 1 });
projectPlanSchema.index({ startDate: 1, deadline: 1 });
projectPlanSchema.index({ status: 1, currentApprovalLevel: 1 });
projectPlanSchema.index({ 'approvalChain.email': 1, 'approvalChain.status': 1 });

// Method to add status history
projectPlanSchema.methods.addStatusHistory = function(status, userId, comments = '') {
  this.statusHistory.push({
    status,
    changedBy: userId,
    changedAt: new Date(),
    comments
  });
};

// Method to get current approver
projectPlanSchema.methods.getCurrentApprover = function() {
  if (!this.approvalChain || this.approvalChain.length === 0) {
    return null;
  }
  
  const pendingApproval = this.approvalChain.find(item => item.status === 'pending');
  return pendingApproval || null;
};

// Method to check if user can approve
projectPlanSchema.methods.canUserApprove = function(userEmail) {
  const currentApprover = this.getCurrentApprover();
  return currentApprover && currentApprover.email === userEmail;
};

// Method to check if fully approved
projectPlanSchema.methods.isFullyApproved = function() {
  if (!this.approvalChain || this.approvalChain.length === 0) {
    return false;
  }
  
  return this.approvalChain.every(item => item.status === 'approved');
};

// Virtual for approval progress
projectPlanSchema.virtual('approvalProgress').get(function() {
  if (!this.approvalChain || this.approvalChain.length === 0) {
    return 0;
  }
  
  const approvedCount = this.approvalChain.filter(item => item.status === 'approved').length;
  return Math.round((approvedCount / this.approvalChain.length) * 100);
});

// Ensure virtuals are included in JSON
projectPlanSchema.set('toJSON', { virtuals: true });
projectPlanSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ProjectPlan', projectPlanSchema);









// const mongoose = require('mongoose');

// const projectPlanSchema = new mongoose.Schema({
//   projectName: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   week: {
//     type: String,
//     required: true
//   },
//   description: {
//     type: String,
//     required: true
//   },
//   department: {
//     type: String,
//     required: true
//   },
//   responsible: {
//     type: String,
//     required: true
//   },
//   objectives: {
//     type: String,
//     required: true
//   },
//   priorityLevel: {
//     type: String,
//     enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
//     required: true
//   },
//   startDate: {
//     type: Date,
//     required: true
//   },
//   deadline: {
//     type: Date,
//     required: true
//   },
//   estimatedDuration: {
//     type: String
//   },
//   amountNeeded: {
//     type: Number,
//     required: true,
//     min: 0
//   },
//   projectProgress: {
//     type: Number,
//     default: 0,
//     min: 0,
//     max: 100
//   },
//   status: {
//     type: String,
//     enum: ['Draft', 'Submitted', 'Approved', 'In Progress', 'On Hold', 'Completed', 'Cancelled'],
//     default: 'Draft'
//   },
//   issuesAndConcerns: {
//     type: String
//   },
//   attachments: [{
//     filename: String,
//     url: String,
//     uploadDate: Date
//   }],
//   createdBy: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true
//   },
//   approvedBy: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   },
//   approvalDate: Date,
//   approvalComments: String
// }, {
//   timestamps: true
// });

// // Indexes for better query performance
// projectPlanSchema.index({ createdBy: 1, status: 1 });
// projectPlanSchema.index({ department: 1 });
// projectPlanSchema.index({ startDate: 1, deadline: 1 });

// module.exports = mongoose.model('ProjectPlan', projectPlanSchema);