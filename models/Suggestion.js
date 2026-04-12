const mongoose = require('mongoose');

const SuggestionSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() { return !this.isAnonymous; }
  },
  suggestionId: {
    type: String,
    unique: true,
    required: true
  },
  title: {
    type: String,
    required: true,
    minlength: 5,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    minlength: 20,
    maxlength: 2000
  },
  category: {
    type: String,
    enum: [
      'workplace_improvement',
      'technology', 
      'process_improvement',
      'hr_policy',
      'environmental',
      'team_building',
      'cost_saving',
      'safety',
      'customer_service',
      'other'
    ],
    required: true
  },
  priority: {
    type: String,
    enum: ['critical', 'high', 'medium', 'low'],
    required: true
  },
  
  // Submission details
  isAnonymous: {
    type: Boolean,
    default: false
  },
  submittedBy: {
    type: String, // Email for anonymous tracking
    required: true
  },
  department: {
    type: String,
    required: true
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },

  // Impact and benefits
  expectedBenefit: {
    type: String,
    required: true,
    minlength: 10,
    maxlength: 1000
  },
  impactAreas: [{
    type: String,
    enum: [
      'cost_reduction',
      'time_savings', 
      'quality_improvement',
      'employee_satisfaction',
      'customer_satisfaction',
      'efficiency',
      'safety',
      'environmental',
      'innovation',
      'communication',
      'productivity',
      'training'
    ]
  }],
  beneficiaries: [{
    type: String,
    enum: [
      'all_employees',
      'my_department', 
      'specific_department',
      'management',
      'customers',
      'vendors',
      'company',
      'environment'
    ]
  }],
  successMetrics: String,

  // Implementation details
  estimatedCost: {
    type: String,
    enum: ['none', 'very_low', 'low', 'medium', 'high', 'very_high', 'unknown']
  },
  costJustification: String,
  estimatedTimeframe: {
    type: String,
    enum: ['immediate', 'short_term', 'medium_term', 'long_term', 'unknown'],
    required: true
  },
  requiredResources: String,
  implementationSteps: String,
  potentialChallenges: String,

  // Additional information
  similarAttempts: {
    type: String,
    enum: ['no', 'yes', 'unsure']
  },
  previousAttemptDetails: String,
  additionalNotes: String,
  followUpWilling: {
    type: Boolean,
    default: false
  },

  // Status and workflow
  status: {
    type: String,
    enum: [
      'pending',
      'under_review',
      'hr_review',
      'management_review', 
      'approved',
      'rejected',
      'implemented',
      'on_hold'
    ],
    default: 'pending'
  },

  // Community engagement
  votes: {
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    totalVotes: { type: Number, default: 0 },
    voters: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      vote: { type: String, enum: ['up', 'down'] },
      votedAt: { type: Date, default: Date.now }
    }]
  },

  // Comments and discussions
  comments: [{
    id: { type: String, required: true },
    user: { type: String, required: true }, // Can be anonymous or user name
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    comment: { type: String, required: true, maxlength: 500 },
    timestamp: { type: Date, default: Date.now },
    isOfficial: { type: Boolean, default: false },
    isAnonymous: { type: Boolean, default: false }
  }],

  // Review and evaluation
  hrReview: {
    reviewed: { type: Boolean, default: false },
    reviewedBy: String,
    reviewedAt: Date,
    comments: String,
    recommendation: {
      type: String,
      enum: ['approve', 'reject', 'modify', 'investigate']
    },
    feasibilityScore: { type: Number, min: 1, max: 10 },
    hrPriority: {
      type: String,
      enum: ['high', 'medium', 'low', 'future']
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Management review
  managementReview: {
    reviewed: { type: Boolean, default: false },
    reviewedBy: String,
    reviewedAt: Date,
    decision: {
      type: String,
      enum: ['approved', 'rejected', 'on_hold']
    },
    comments: String,
    budgetAllocated: Number,
    implementationTeam: String,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Implementation tracking
  implementation: {
    status: {
      type: String,
      enum: ['planning', 'in_progress', 'testing', 'completed'],
      default: 'planning'
    },
    startDate: Date,
    targetDate: Date,
    completionDate: Date,
    assignedTeam: String,
    budget: Number,
    actualCost: Number,
    progress: { type: Number, min: 0, max: 100, default: 0 },
    milestones: [{
      name: String,
      targetDate: Date,
      completedDate: Date,
      status: { type: String, enum: ['pending', 'completed', 'overdue'] }
    }],
    results: String,
    impactMeasurement: String
  },

  // Recognition and rewards
  recognition: {
    awarded: { type: Boolean, default: false },
    awardType: String,
    awardAmount: Number,
    recognitionDate: Date,
    publicRecognition: { type: Boolean, default: false },
    certificateIssued: { type: Boolean, default: false }
  },

  // Rejection details
  rejectionReason: String,
  rejectionDate: Date,
  canResubmit: { type: Boolean, default: true },

  // Attachments
  attachments: [{
    name: String,
    url: String,
    publicId: String,
    size: Number,
    mimetype: String
  }],

  // Analytics and tracking
  viewCount: { type: Number, default: 0 },
  lastViewedAt: Date,
  trending: { type: Boolean, default: false },
  featured: { type: Boolean, default: false },

  // Tags for better categorization
  tags: [String],

  // Audit trail
  auditLog: [{
    action: String,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    performedAt: { type: Date, default: Date.now },
    details: String,
    previousValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed
  }],

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
SuggestionSchema.index({ employee: 1, status: 1 });
SuggestionSchema.index({ status: 1, createdAt: -1 });
SuggestionSchema.index({ category: 1, priority: 1 });
SuggestionSchema.index({ department: 1 });
SuggestionSchema.index({ 'votes.totalVotes': -1 });
SuggestionSchema.index({ trending: 1, featured: 1 });
SuggestionSchema.index({ submittedAt: -1 });
SuggestionSchema.index({ 'hrReview.reviewed': 1, 'hrReview.recommendation': 1 });

// Virtual for display ID
SuggestionSchema.virtual('displayId').get(function() {
  return this.suggestionId || `SUG-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Virtual for total community score
SuggestionSchema.virtual('communityScore').get(function() {
  if (!this.votes || this.votes.totalVotes === 0) return 0;
  return Math.round((this.votes.upvotes / this.votes.totalVotes) * 100);
});

// Virtual for implementation progress percentage
SuggestionSchema.virtual('implementationProgress').get(function() {
  if (!this.implementation) return 0;
  return this.implementation.progress || 0;
});

// Method to check if user has voted
SuggestionSchema.methods.hasUserVoted = function(userId) {
  if (!this.votes.voters || !userId) return null;
  const vote = this.votes.voters.find(v => v.user && v.user.equals(userId));
  return vote ? vote.vote : null;
};

// Method to add vote
SuggestionSchema.methods.addVote = function(userId, voteType) {
  if (!this.votes.voters) this.votes.voters = [];

  // Remove existing vote if any
  this.votes.voters = this.votes.voters.filter(v => !v.user.equals(userId));
  
  // Update vote counts
  if (voteType === 'up') {
    this.votes.upvotes += 1;
    this.votes.voters.push({ user: userId, vote: 'up' });
  } else if (voteType === 'down') {
    this.votes.downvotes += 1;
    this.votes.voters.push({ user: userId, vote: 'down' });
  }

  this.votes.totalVotes = this.votes.upvotes + this.votes.downvotes;
  
  // Update trending status based on recent votes
  this.updateTrendingStatus();
};

// Method to remove vote
SuggestionSchema.methods.removeVote = function(userId) {
  if (!this.votes.voters) return;

  const existingVote = this.votes.voters.find(v => v.user.equals(userId));
  if (existingVote) {
    if (existingVote.vote === 'up') this.votes.upvotes -= 1;
    if (existingVote.vote === 'down') this.votes.downvotes -= 1;
    
    this.votes.voters = this.votes.voters.filter(v => !v.user.equals(userId));
    this.votes.totalVotes = this.votes.upvotes + this.votes.downvotes;
  }
};

// Method to update trending status
SuggestionSchema.methods.updateTrendingStatus = function() {
  const recentVotes = this.votes.voters.filter(v => {
    const votedAt = new Date(v.votedAt);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return votedAt > dayAgo;
  }).length;

  this.trending = recentVotes >= 5; // Consider trending if 5+ votes in 24 hours
};

// Method to add comment
SuggestionSchema.methods.addComment = function(userId, userName, commentText, isOfficial = false) {
  if (!this.comments) this.comments = [];

  const newComment = {
    id: new mongoose.Types.ObjectId().toString(),
    user: userName,
    userId: userId,
    comment: commentText,
    timestamp: new Date(),
    isOfficial: isOfficial,
    isAnonymous: false
  };

  this.comments.push(newComment);
  return newComment;
};

// Method to get current stage description
SuggestionSchema.methods.getCurrentStage = function() {
  const stageMap = {
    'pending': 'Pending Initial Review',
    'under_review': 'Under Review',
    'hr_review': 'HR Department Review',
    'management_review': 'Management Review',
    'approved': 'Approved for Implementation',
    'rejected': 'Rejected',
    'implemented': 'Successfully Implemented',
    'on_hold': 'On Hold'
  };

  return stageMap[this.status] || 'Unknown Status';
};

// Method to get priority color
SuggestionSchema.methods.getPriorityColor = function() {
  const colorMap = {
    'critical': '#dc3545',
    'high': '#fd7e14', 
    'medium': '#ffc107',
    'low': '#28a745'
  };

  return colorMap[this.priority] || '#6c757d';
};

// Method to get category icon
SuggestionSchema.methods.getCategoryIcon = function() {
  const iconMap = {
    'workplace_improvement': '🏢',
    'technology': '💻',
    'process_improvement': '⚡',
    'hr_policy': '👥',
    'environmental': '🌍',
    'team_building': '🤝',
    'cost_saving': '💰',
    'safety': '🦺',
    'customer_service': '❤️',
    'other': '💡'
  };

  return iconMap[this.category] || '📋';
};

// Method to check if suggestion can be edited
SuggestionSchema.methods.canBeEdited = function() {
  return ['pending', 'under_review'].includes(this.status);
};

// Method to check if suggestion can be voted on
SuggestionSchema.methods.canBeVotedOn = function() {
  return !['rejected'].includes(this.status);
};

// Method to add audit log entry
SuggestionSchema.methods.addAuditLog = function(action, performedBy, details, previousValue = null, newValue = null) {
  if (!this.auditLog) this.auditLog = [];

  this.auditLog.push({
    action,
    performedBy,
    performedAt: new Date(),
    details,
    previousValue,
    newValue
  });
};

// Method to calculate implementation score
SuggestionSchema.methods.getImplementationScore = function() {
  let score = 0;
  
  // Community support (40%)
  if (this.votes.totalVotes > 0) {
    score += (this.votes.upvotes / this.votes.totalVotes) * 40;
  }

  // HR feasibility score (35%)
  if (this.hrReview && this.hrReview.feasibilityScore) {
    score += (this.hrReview.feasibilityScore / 10) * 35;
  }

  // Priority weight (25%)
  const priorityWeights = { critical: 25, high: 20, medium: 15, low: 10 };
  score += priorityWeights[this.priority] || 0;

  return Math.round(score);
};

// Pre-save middleware to update timestamps and generate suggestion ID
SuggestionSchema.pre('save', function(next) {
  this.updatedAt = new Date();

  // Generate suggestion ID if not exists
  if (!this.suggestionId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.suggestionId = `SUG-${year}${month}${day}${random}`;
  }

  next();
});

// Pre-update middleware to update timestamps
SuggestionSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model('Suggestion', SuggestionSchema);


