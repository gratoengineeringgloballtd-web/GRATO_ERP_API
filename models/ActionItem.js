const mongoose = require('mongoose');

const actionItemSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  priority: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM',
    required: true
  },
  status: {
    type: String,
    enum: [
      'Not Started', 
      'Pending Approval', 
      'In Progress', 
      'Pending L1 Grading',          // NEW: Level 1 approval
      'Pending L2 Review',            // NEW: Level 2 approval
      'Pending L3 Final Approval',    // NEW: Level 3 approval
      'Pending Completion Approval',  // KEEP: For backward compatibility
      'Completed', 
      'On Hold', 
      'Rejected'
    ],
    default: 'Not Started'
  },
  dueDate: {
    type: Date,
    required: true
  },
  
  // Can be linked to either milestone or sub-milestone
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null
  },
  milestoneId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  subMilestoneId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  
  // Task weight (for milestone/sub-milestone contribution)
  taskWeight: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  // Multi-assignee support with three-level approval chain
  assignedTo: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    completionStatus: {
      type: String,
      enum: ['pending', 'submitted', 'approved', 'rejected'],
      default: 'pending'
    },
    completionDocuments: [{
      name: String,
      url: String,
      publicId: String,
      localPath: String,
      size: Number,
      mimetype: String,
      uploadedAt: Date
    }],
    completionNotes: String,
    submittedAt: Date,
    approvedAt: Date,
    rejectedAt: Date,
    rejectionReason: String,
    
    // Individual grading per assignee
    completionGrade: {
      score: {
        type: Number,
        min: 1.0,
        max: 5.0
      },
      effectiveScore: {
        type: Number,
        default: null
      },
      qualityNotes: String,
      gradedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      gradedAt: Date
    },
    
    // NEW: Three-level approval chain per assignee
    completionApprovalChain: [{
      level: {
        type: Number,
        enum: [1, 2, 3],
        required: true
      },
      approver: {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        name: String,
        email: String,
        role: String // 'immediate_supervisor', 'supervisor_supervisor', 'project_creator'
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'skipped'],
        default: 'pending'
      },
      grade: {
        type: Number,
        min: 1.0,
        max: 5.0,
        default: null
      },
      comments: String,
      reviewedAt: Date
    }]
  }],
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Supervisor who will approve/grade the task
  supervisor: {
    name: String,
    email: String,
    department: String
  },
  
  // Creation approval workflow
  creationApproval: {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvalDate: Date,
    comments: String
  },
  
  // KPI Linking
  linkedKPIs: [{
    kpiDocId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuarterlyKPI',
      required: true
    },
    kpiIndex: {
      type: Number,
      required: true
    },
    kpiTitle: String,
    kpiWeight: Number,
    contributionToKPI: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    }
  }],
  
  // Overall task completion grade
  completionGrade: {
    score: {
      type: Number,
      min: 1.0,
      max: 5.0
    },
    qualityNotes: String,
    gradedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    gradedAt: Date
  },
  
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  completedAt: Date,
  
  notes: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  
  // Activity log with new actions
  activityLog: [{
    action: {
      type: String,
      enum: [
        'created',
        'creation_approved',
        'creation_rejected',
        'updated',
        'status_changed',
        'progress_updated',
        'assignee_added',
        'assignee_removed',
        'submitted_for_completion',
        'l1_graded',              // NEW
        'l2_reviewed',            // NEW
        'l3_approved',            // NEW
        'completion_approved',
        'completion_rejected',
        'assignee_approved',
        'reassigned',
        'completed'
      ]
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
actionItemSchema.index({ status: 1 });
actionItemSchema.index({ priority: 1 });
actionItemSchema.index({ dueDate: 1 });
actionItemSchema.index({ 'assignedTo.user': 1 });
actionItemSchema.index({ createdBy: 1 });
actionItemSchema.index({ projectId: 1 });
actionItemSchema.index({ milestoneId: 1 });
actionItemSchema.index({ subMilestoneId: 1 });
actionItemSchema.index({ 'supervisor.email': 1 });
actionItemSchema.index({ createdAt: -1 });
actionItemSchema.index({ 'assignedTo.completionApprovalChain.approver.userId': 1 }); 

// Virtual for checking if overdue
actionItemSchema.virtual('isOverdue').get(function() {
  if (this.status === 'Completed') return false;
  return new Date() > this.dueDate;
});

// Virtual for display ID
actionItemSchema.virtual('displayId').get(function() {
  return `TASK-${this._id.toString().slice(-6).toUpperCase()}`;
});

// NEW: Method to update KPI achievements with decimal support
actionItemSchema.methods.updateKPIAchievements = async function(assigneeUserId, grade) {
  const QuarterlyKPI = mongoose.model('QuarterlyKPI');

  for (const linkedKPI of this.linkedKPIs) {
    const kpiDoc = await QuarterlyKPI.findById(linkedKPI.kpiDocId);
    if (!kpiDoc) continue;

    const kpi = kpiDoc.kpis[linkedKPI.kpiIndex];
    if (!kpi) continue;

    // Calculate contribution: (grade/5.0) × (kpiWeight/100) × 100
    const contribution = parseFloat((((grade / 5.0) * (linkedKPI.kpiWeight / 100)) * 100).toFixed(2));
    
    kpi.achievement = (kpi.achievement || 0) + contribution;
    kpi.achievement = Math.min(100, parseFloat(kpi.achievement.toFixed(2)));

    linkedKPI.contributionToKPI = contribution;

    await kpiDoc.save();
  }
};

// NEW: Method to update milestone progress
actionItemSchema.methods.updateMilestoneProgress = async function() {
  if (!this.milestoneId) return;

  const Project = mongoose.model('Project');
  const project = await Project.findOne({ 'milestones._id': this.milestoneId });
  
  if (!project) return;

  await project.recalculateMilestoneProgress(this.milestoneId);
  await project.save();
};


actionItemSchema.methods.approveCompletionForAssignee = async function(userId, assigneeId, grade, qualityNotes, comments) {
  const assignee = this.assignedTo.find(a => a.user.equals(assigneeId));
  if (!assignee) {
    throw new Error('Assignee not found');
  }

  // ✅ Check if already graded
  if (assignee.completionGrade && assignee.completionGrade.score) {
    throw new Error('This completion has already been graded');
  }

  // Calculate effective score with decimal precision
  const effectiveScore = parseFloat(((grade / 5.0) * this.taskWeight).toFixed(2));

  assignee.completionStatus = 'approved';
  assignee.approvedAt = new Date();
  assignee.completionGrade = {
    score: parseFloat(grade.toFixed(1)),
    effectiveScore: effectiveScore,
    qualityNotes: qualityNotes || '',
    gradedBy: userId,
    gradedAt: new Date()
  };

  this.logActivity('l1_graded', userId, 
    `L1 graded with ${grade.toFixed(1)}/5.0 (Effective: ${effectiveScore}%)`);

  // Check if all assignees have been approved
  const allApproved = this.assignedTo.every(a => a.completionStatus === 'approved');
  
  if (allApproved) {
    this.status = 'Completed';
    this.completedBy = userId;
    this.completedAt = new Date();
    this.progress = 100;

    // Calculate overall grade (average of all assignees)
    const totalGrade = this.assignedTo.reduce((sum, a) => sum + (a.completionGrade?.score || 0), 0);
    const avgGrade = totalGrade / this.assignedTo.length;

    this.completionGrade = {
      score: parseFloat(avgGrade.toFixed(1)),
      qualityNotes: qualityNotes || '',
      gradedBy: userId,
      gradedAt: new Date()
    };

    this.logActivity('completed', userId, 
      `All assignees approved with average grade ${avgGrade.toFixed(1)}/5.0`);

    // Update KPIs and milestone
    await this.updateKPIAchievements(assigneeId, grade);
    if (this.milestoneId) {
      await this.updateMilestoneProgress();
    }
  }
};


// UPDATED: Method for three-level approval - Level 1 grading
// actionItemSchema.methods.approveCompletionForAssignee = async function(userId, assigneeId, grade, qualityNotes, comments) {
//   const assignee = this.assignedTo.find(a => a.user.equals(assigneeId));
//   if (!assignee) {
//     throw new Error('Assignee not found');
//   }

//   // Calculate effective score with decimal precision
//   const effectiveScore = parseFloat(((grade / 5.0) * this.taskWeight).toFixed(2));

//   assignee.completionStatus = 'approved';
//   assignee.approvedAt = new Date();
//   assignee.completionGrade = {
//     score: parseFloat(grade.toFixed(1)),
//     effectiveScore: effectiveScore,
//     qualityNotes: qualityNotes || '',
//     gradedBy: userId,
//     gradedAt: new Date()
//   };

//   // Update Level 1 in approval chain
//   if (assignee.completionApprovalChain && assignee.completionApprovalChain.length > 0) {
//     const l1 = assignee.completionApprovalChain.find(a => a.level === 1);
//     if (l1) {
//       l1.status = 'approved';
//       l1.grade = parseFloat(grade.toFixed(1));
//       l1.comments = qualityNotes || comments;
//       l1.reviewedAt = new Date();
//     }
//   }

//   this.logActivity('l1_graded', userId, 
//     `L1 graded with ${grade.toFixed(1)}/5.0 (Effective: ${effectiveScore}%)`);

//   // Check if all assignees have been approved
//   const allApproved = this.assignedTo.every(a => a.completionStatus === 'approved');
  
//   if (allApproved) {
//     this.status = 'Completed';
//     this.completedBy = userId;
//     this.completedAt = new Date();
//     this.progress = 100;

//     // Calculate overall grade (average of all assignees)
//     const totalGrade = this.assignedTo.reduce((sum, a) => sum + (a.completionGrade?.score || 0), 0);
//     const avgGrade = totalGrade / this.assignedTo.length;

//     this.completionGrade = {
//       score: parseFloat(avgGrade.toFixed(1)),
//       qualityNotes: qualityNotes || '',
//       gradedBy: userId,
//       gradedAt: new Date()
//     };

//     this.logActivity('completed', userId, 
//       `All assignees approved with average grade ${avgGrade.toFixed(1)}/5.0`);

//     // Update KPIs and milestone
//     await this.updateKPIAchievements(assigneeId, grade);
//     if (this.milestoneId) {
//       await this.updateMilestoneProgress();
//     }
//   } else {
//     // Check next approval level
//     const nextApprover = this.getNextPendingApprover(assignee.completionApprovalChain);
//     if (nextApprover) {
//       if (nextApprover.level === 2) {
//         this.status = 'Pending L2 Review';
//       } else if (nextApprover.level === 3) {
//         this.status = 'Pending L3 Final Approval';
//       }
//     }
//   }
// };

// UPDATED: Rejection method
actionItemSchema.methods.rejectCompletionForAssignee = function(userId, assigneeId, comments) {
  const assignee = this.assignedTo.find(a => a.user.equals(assigneeId));
  if (!assignee) {
    throw new Error('Assignee not found');
  }

  assignee.completionStatus = 'rejected';
  assignee.rejectedAt = new Date();
  assignee.rejectionReason = comments;
  
  // Clear previous submission
  assignee.completionDocuments = [];
  assignee.completionNotes = '';
  assignee.submittedAt = null;

  // Reset approval chain
  if (assignee.completionApprovalChain) {
    assignee.completionApprovalChain.forEach(approval => {
      if (approval.status === 'pending' || approval.status === 'approved') {
        approval.status = 'pending';
        approval.comments = null;
        approval.reviewedAt = null;
      }
    });
  }

  this.status = 'In Progress';
  
  this.logActivity('completion_rejected', userId, 
    `Completion rejected for assignee: ${comments}`);
};

// NEW: Helper method to get next pending approver
actionItemSchema.methods.getNextPendingApprover = function(approvalChain) {
  if (!approvalChain || approvalChain.length === 0) return null;
  
  for (const approval of approvalChain) {
    if (approval.status === 'pending') {
      return approval;
    }
  }
  
  return null;
};

// Method to log activity
actionItemSchema.methods.logActivity = function(action, userId, details, oldValue = null, newValue = null) {
  this.activityLog.push({
    action,
    performedBy: userId,
    timestamp: new Date(),
    details,
    oldValue,
    newValue
  });
};

// Method to update status
actionItemSchema.methods.updateStatus = function(newStatus, userId, notes = '') {
  const oldStatus = this.status;
  
  if (oldStatus === newStatus) return;
  
  this.status = newStatus;
  
  const statusMessage = `Status changed from "${oldStatus}" to "${newStatus}"${notes ? ': ' + notes : ''}`;
  this.logActivity('status_changed', userId, statusMessage, oldStatus, newStatus);
  
  if (newStatus === 'Completed') {
    this.progress = 100;
    this.completedAt = new Date();
    this.completedBy = userId;
  } else if (newStatus === 'In Progress' && oldStatus === 'Not Started') {
    if (this.progress === 0) {
      this.progress = 10;
    }
  }
};

// Method to update progress
actionItemSchema.methods.updateProgress = function(newProgress, userId) {
  const oldProgress = this.progress;
  this.progress = newProgress;
  
  if (newProgress !== oldProgress) {
    this.logActivity('progress_updated', userId, 
      `Progress updated from ${oldProgress}% to ${newProgress}%`,
      oldProgress, newProgress);
  }
  
  // Auto-update status based on progress
  if (newProgress === 0 && this.status !== 'Not Started' && this.status !== 'Pending Approval') {
    this.status = 'Not Started';
  } else if (newProgress > 0 && newProgress < 100 && this.status === 'Not Started') {
    this.status = 'In Progress';
  } else if (newProgress === 100 && !['Completed', 'Pending L1 Grading', 'Pending L2 Review', 'Pending L3 Final Approval'].includes(this.status)) {
    this.status = 'Pending L1 Grading';
  }
};

// Static method to get tasks by sub-milestone
actionItemSchema.statics.getBySubMilestone = function(subMilestoneId) {
  return this.find({ subMilestoneId })
    .populate('assignedTo.user', 'fullName email department')
    .populate('createdBy', 'fullName email')
    .populate('linkedKPIs.kpiDocId')
    .sort({ dueDate: 1, priority: -1 });
};

const ActionItem = mongoose.model('ActionItem', actionItemSchema);

module.exports = ActionItem;


