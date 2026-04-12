const mongoose = require('mongoose');

// Sub-schema for KPI items with full tracking capabilities
const kpiSchema = new mongoose.Schema({
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
  weight: { 
    type: Number, 
    required: true, 
    min: 1, 
    max: 100 
  },
  measurement: { 
    type: String, 
    required: true,
    trim: true
  },
  target: { 
    type: String, 
    required: true,
    trim: true
  },
  
  // Track actual achievement progress (0-100%)
  progress: { 
    type: Number, 
    default: 0, 
    min: 0, 
    max: 100 
  },
  
  // Achievement score for final evaluation
  achievement: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  // Task and sub-milestone contributions
  taskContributions: [{
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ActionItem'
    },
    subMilestoneId: {
      type: mongoose.Schema.Types.ObjectId,
      // Reference to sub-milestone ID (stored in Project.milestones.subMilestones)
    },
    contributionScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Approval tracking
  status: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected', 'not_started', 'in_progress', 'completed', 'at_risk'],
    default: 'draft'
  },
  
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectionReason: String,
  
  notes: String
}, { _id: true, timestamps: true });

// Main Quarterly KPI Schema
const QuarterlyKPISchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quarter: {
    type: String,
    required: true,
    // ✅ REMOVED: strict regex validation
    // match: /^Q[1-4]-\d{4}$/,
    default: function() {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const q = Math.ceil(month / 3);
      return `Q${q}-${year}`;
    }
  },
  year: {
    type: Number,
    required: true,
    default: function() {
      return new Date().getFullYear();
    }
  },
  
  // Use the integrated kpiSchema
  kpis: [kpiSchema],
  
  totalWeight: {
    type: Number,
    required: true,
    default: 0
  },
  
  approvalStatus: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected'],
    default: 'draft'
  },
  
  submittedAt: Date,
  
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectionReason: String,
  
  supervisor: {
    name: String,
    email: String,
    department: String
  }
}, {
  timestamps: true
});

// Indexes
QuarterlyKPISchema.index({ employee: 1, quarter: 1, year: 1 }, { unique: true });
QuarterlyKPISchema.index({ approvalStatus: 1 });
QuarterlyKPISchema.index({ 'supervisor.email': 1 });
QuarterlyKPISchema.index({ 'kpis.status': 1 });

// Virtual for overall achievement (weighted average)
QuarterlyKPISchema.virtual('overallAchievement').get(function() {
  if (!this.kpis || this.kpis.length === 0) return 0;

  const totalWeight = this.kpis.reduce((sum, kpi) => sum + kpi.weight, 0);
  if (totalWeight === 0) return 0;

  const weightedAchievement = this.kpis.reduce((sum, kpi) => {
    return sum + ((kpi.achievement || 0) * kpi.weight / 100);
  }, 0);

  return Math.round(weightedAchievement);
});

// Virtual for overall progress (weighted average)
QuarterlyKPISchema.virtual('overallProgress').get(function() {
  if (!this.kpis || this.kpis.length === 0) return 0;

  const totalWeight = this.kpis.reduce((sum, kpi) => sum + kpi.weight, 0);
  if (totalWeight === 0) return 0;

  const weightedProgress = this.kpis.reduce((sum, kpi) => {
    return sum + ((kpi.progress || 0) * kpi.weight / 100);
  }, 0);

  return Math.round(weightedProgress);
});

// Calculate total weight and update KPI statuses before saving
QuarterlyKPISchema.pre('save', function(next) {
  // Calculate total weight
  this.totalWeight = this.kpis.reduce((sum, kpi) => sum + kpi.weight, 0);
  
  // Auto-update individual KPI status based on progress
  this.kpis.forEach(kpi => {
    if (kpi.status !== 'draft' && kpi.status !== 'pending' && 
        kpi.status !== 'approved' && kpi.status !== 'rejected') {
      if (kpi.progress === 0) {
        kpi.status = 'not_started';
      } else if (kpi.progress === 100) {
        kpi.status = 'completed';
      } else if (kpi.progress < 50) {
        kpi.status = 'at_risk';
      } else {
        kpi.status = 'in_progress';
      }
    }
  });
  
  next();
});

// Methods
QuarterlyKPISchema.methods.submitForApproval = function() {
  if (this.totalWeight !== 100) {
    throw new Error('Total KPI weight must equal 100%');
  }
  if (this.kpis.length < 3) {
    throw new Error('Minimum 3 KPIs required');
  }
  
  this.approvalStatus = 'pending';
  this.submittedAt = new Date();
  
  this.kpis.forEach(kpi => {
    if (kpi.status === 'draft') {
      kpi.status = 'pending';
    }
  });
  
  return this.save();
};

QuarterlyKPISchema.methods.approve = function(userId) {
  this.approvalStatus = 'approved';
  this.approvedBy = userId;
  this.approvedAt = new Date();
  
  this.kpis.forEach(kpi => {
    if (kpi.status === 'pending') {
      kpi.status = 'approved';
      kpi.approvedBy = userId;
      kpi.approvedAt = new Date();
    }
  });
  
  return this.save();
};

QuarterlyKPISchema.methods.reject = function(userId, reason) {
  this.approvalStatus = 'rejected';
  this.approvedBy = userId;
  this.approvedAt = new Date();
  this.rejectionReason = reason;
  
  this.kpis.forEach(kpi => {
    if (kpi.status === 'pending') {
      kpi.status = 'rejected';
    }
  });
  
  return this.save();
};

// Method to update KPI progress based on task/sub-milestone contributions
QuarterlyKPISchema.methods.updateKPIProgress = function(kpiId) {
  const kpi = this.kpis.id(kpiId);
  
  if (!kpi || !kpi.taskContributions || kpi.taskContributions.length === 0) {
    return;
  }
  
  // Calculate average contribution score
  const totalScore = kpi.taskContributions.reduce((sum, contrib) => {
    return sum + (contrib.contributionScore || 0);
  }, 0);
  
  kpi.progress = Math.min(100, Math.round(totalScore / kpi.taskContributions.length));
  
  return this.save();
};

// Method to add task/sub-milestone contribution to a KPI
QuarterlyKPISchema.methods.addContribution = function(kpiId, contribution) {
  const kpi = this.kpis.id(kpiId);
  
  if (!kpi) {
    throw new Error('KPI not found');
  }
  
  // Check if contribution already exists
  const existingIndex = kpi.taskContributions.findIndex(c => 
    (c.taskId && c.taskId.toString() === contribution.taskId?.toString()) ||
    (c.subMilestoneId && c.subMilestoneId.toString() === contribution.subMilestoneId?.toString())
  );
  
  if (existingIndex >= 0) {
    // Update existing contribution
    kpi.taskContributions[existingIndex] = {
      ...kpi.taskContributions[existingIndex],
      ...contribution,
      lastUpdated: new Date()
    };
  } else {
    // Add new contribution
    kpi.taskContributions.push({
      ...contribution,
      lastUpdated: new Date()
    });
  }
  
  return this.updateKPIProgress(kpiId);
};

// Enable virtuals in JSON output
QuarterlyKPISchema.set('toJSON', { virtuals: true });
QuarterlyKPISchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('QuarterlyKPI', QuarterlyKPISchema);






