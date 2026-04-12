const mongoose = require('mongoose');

const QuarterlyEvaluationSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quarter: {
    type: String,
    required: true,
    match: /^Q[1-4]-\d{4}$/
  },
  year: {
    type: Number,
    required: true
  },
  period: {
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    }
  },
  
  // KPI Reference
  quarterlyKPI: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuarterlyKPI'
  },
  
  // Task Performance (70%)
  taskMetrics: {
    totalTasks: {
      type: Number,
      default: 0
    },
    completedTasks: {
      type: Number,
      default: 0
    },
    averageCompletionGrade: {
      type: Number,
      default: 0
    },
    kpiAchievement: [{
      kpiTitle: String,
      kpiWeight: Number,
      tasksCompleted: Number,
      averageGrade: Number,
      achievedScore: Number,
      weightedScore: Number
    }],
    taskPerformanceScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    }
  },
  
  // Behavioral Performance (30%)
  behavioralEvaluation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BehavioralEvaluation'
  },
  behavioralScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  // Final Score
  finalScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  grade: {
    type: String,
    enum: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F', 'N/A'],
    default: 'N/A'
  },
  performanceLevel: {
    type: String,
    enum: ['Outstanding', 'Exceeds Expectations', 'Meets Expectations', 'Needs Improvement', 'Unsatisfactory', 'N/A'],
    default: 'N/A'
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['draft', 'calculated', 'submitted', 'approved', 'acknowledged'],
    default: 'draft'
  },
  calculatedAt: Date,
  submittedAt: Date,
  approvedAt: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  acknowledgedAt: Date,
  
  // Comments
  supervisorComments: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  employeeComments: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  
  // Metadata
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
QuarterlyEvaluationSchema.index({ employee: 1, quarter: 1 }, { unique: true });
QuarterlyEvaluationSchema.index({ supervisor: 1 });
QuarterlyEvaluationSchema.index({ status: 1 });
QuarterlyEvaluationSchema.index({ quarter: 1 });

// Calculate final score and grade
QuarterlyEvaluationSchema.methods.calculateFinalScore = function() {
  const taskWeight = 0.7;
  const behavioralWeight = 0.3;
  
  this.finalScore = (this.taskMetrics.taskPerformanceScore * taskWeight) + 
                    (this.behavioralScore * behavioralWeight);
  
  // Assign grade based on final score
  if (this.finalScore >= 95) {
    this.grade = 'A+';
    this.performanceLevel = 'Outstanding';
  } else if (this.finalScore >= 90) {
    this.grade = 'A';
    this.performanceLevel = 'Outstanding';
  } else if (this.finalScore >= 85) {
    this.grade = 'B+';
    this.performanceLevel = 'Exceeds Expectations';
  } else if (this.finalScore >= 80) {
    this.grade = 'B';
    this.performanceLevel = 'Exceeds Expectations';
  } else if (this.finalScore >= 75) {
    this.grade = 'C+';
    this.performanceLevel = 'Meets Expectations';
  } else if (this.finalScore >= 70) {
    this.grade = 'C';
    this.performanceLevel = 'Meets Expectations';
  } else if (this.finalScore >= 60) {
    this.grade = 'D';
    this.performanceLevel = 'Needs Improvement';
  } else {
    this.grade = 'F';
    this.performanceLevel = 'Unsatisfactory';
  }
  
  this.status = 'calculated';
  this.calculatedAt = new Date();
};

QuarterlyEvaluationSchema.methods.submit = function() {
  if (this.status !== 'calculated') {
    throw new Error('Evaluation must be calculated before submission');
  }
  this.status = 'submitted';
  this.submittedAt = new Date();
};

QuarterlyEvaluationSchema.methods.approve = function(userId, comments) {
  this.status = 'approved';
  this.approvedAt = new Date();
  this.approvedBy = userId;
  if (comments) {
    this.supervisorComments = comments;
  }
};

QuarterlyEvaluationSchema.methods.acknowledge = function(comments) {
  this.status = 'acknowledged';
  this.acknowledgedAt = new Date();
  if (comments) {
    this.employeeComments = comments;
  }
};

module.exports = mongoose.model('QuarterlyEvaluation', QuarterlyEvaluationSchema);