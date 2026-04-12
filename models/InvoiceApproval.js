const mongoose = require('mongoose');

const approvalStepSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: [
      'finance_assignment',      
      'supervisor_approval',     
      'department_head_approval', 
      'admin_approval'         
    ],
    required: true
  },
  approver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'rejected'],
    default: 'pending'
  },
  decision: {
    type: String,
    enum: ['assigned', 'approved', 'rejected'],
    required: function() { return this.status === 'completed'; }
  },
  comments: {
    type: String,
    trim: true,
    maxLength: 500
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  rejectionReason: {
    type: String,
    trim: true,
    maxLength: 500
  }
}, {
  _id: false
});

const invoiceApprovalSchema = new mongoose.Schema({
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true,
    unique: true
  },
  
  assignedDepartment: {
    type: String,
    required: true,
    trim: true
  },
  
  currentApprovalLevel: {
    type: String,
    enum: [
      'finance_assignment',
      'supervisor_approval', 
      'department_head_approval',
      'admin_approval',
      'completed',
      'rejected'
    ],
    default: 'finance_assignment'
  },
  
  overallStatus: {
    type: String,
    enum: ['pending', 'in_progress', 'approved', 'rejected', 'processed'],
    default: 'pending'
  },
  
  approvalChain: [approvalStepSchema],
  
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  assignmentTimestamp: {
    type: Date,
    default: Date.now
  },
  
  completedTimestamp: {
    type: Date
  },
  
  // Track required approvers based on company structure
  requiredApprovals: {
    supervisor: {
      required: Boolean,
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    departmentHead: {
      required: Boolean,
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    admin: {
      required: Boolean,
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }
  },
  
  // Metadata for tracking and analytics
  metadata: {
    totalApprovalTime: Number, // in milliseconds
    averageStepTime: Number,
    escalationCount: Number,
    remindersSent: Number
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient queries
invoiceApprovalSchema.index({ assignedDepartment: 1, overallStatus: 1 });
invoiceApprovalSchema.index({ currentApprovalLevel: 1, overallStatus: 1 });
invoiceApprovalSchema.index({ assignmentTimestamp: -1 });
invoiceApprovalSchema.index({ 'approvalChain.approver': 1 });

// Virtual for current pending approver
invoiceApprovalSchema.virtual('currentApprover').get(function() {
  const pendingStep = this.approvalChain.find(step => step.status === 'pending');
  return pendingStep ? pendingStep.approver : null;
});

// Method to get next required approval level
invoiceApprovalSchema.methods.getNextApprovalLevel = function() {
  if (this.requiredApprovals.supervisor.required && 
      !this.approvalChain.some(step => step.level === 'supervisor_approval' && step.status === 'completed')) {
    return 'supervisor_approval';
  }
  
  if (this.requiredApprovals.departmentHead.required && 
      !this.approvalChain.some(step => step.level === 'department_head_approval' && step.status === 'completed')) {
    return 'department_head_approval';
  }
  
  if (this.requiredApprovals.admin.required && 
      !this.approvalChain.some(step => step.level === 'admin_approval' && step.status === 'completed')) {
    return 'admin_approval';
  }
  
  return 'completed';
};

// Method to add approval step
invoiceApprovalSchema.methods.addApprovalStep = function(level, approverId, comments = '') {
  this.approvalChain.push({
    level,
    approver: approverId,
    status: 'pending',
    comments,
    timestamp: new Date()
  });
  
  this.currentApprovalLevel = level;
  this.overallStatus = 'in_progress';
};

// Method to process approval decision
invoiceApprovalSchema.methods.processApprovalDecision = async function(approverId, decision, comments = '', rejectionReason = '') {
  const pendingStep = this.approvalChain.find(
    step => step.status === 'pending' && step.approver.toString() === approverId.toString()
  );
  
  if (!pendingStep) {
    throw new Error('No pending approval found for this user');
  }
  
  pendingStep.status = 'completed';
  pendingStep.decision = decision;
  pendingStep.comments = comments;
  pendingStep.timestamp = new Date();
  
  if (decision === 'rejected') {
    pendingStep.rejectionReason = rejectionReason;
    this.overallStatus = 'rejected';
    this.currentApprovalLevel = 'rejected';
    this.completedTimestamp = new Date();
  } else if (decision === 'approved') {
    const nextLevel = this.getNextApprovalLevel();
    
    if (nextLevel === 'completed') {
      this.overallStatus = 'approved';
      this.currentApprovalLevel = 'completed';
      this.completedTimestamp = new Date();
      
      // Calculate total approval time
      this.metadata = this.metadata || {};
      this.metadata.totalApprovalTime = this.completedTimestamp - this.assignmentTimestamp;
    } else {
      this.currentApprovalLevel = nextLevel;
      // Add next approval step
      let nextApproverId;
      
      switch (nextLevel) {
        case 'supervisor_approval':
          nextApproverId = this.requiredApprovals.supervisor.userId;
          break;
        case 'department_head_approval':
          nextApproverId = this.requiredApprovals.departmentHead.userId;
          break;
        case 'admin_approval':
          nextApproverId = this.requiredApprovals.admin.userId;
          break;
      }
      
      if (nextApproverId) {
        this.addApprovalStep(nextLevel, nextApproverId);
      }
    }
  }
  
  return this.save();
};

module.exports = mongoose.model('InvoiceApproval', invoiceApprovalSchema);