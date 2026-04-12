const mongoose = require('mongoose');

const BehavioralEvaluationSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  evaluator: {
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
  criteria: [{
    name: {
      type: String,
      required: true,
      enum: [
        'Attendance & Punctuality',
        'Teamwork & Collaboration',
        'Communication Skills',
        'Initiative & Proactivity',
        'Professionalism',
        'Adaptability',
        'Problem Solving',
        'Time Management',
        'Quality of Work',
        'Leadership'
      ]
    },
    score: {
      type: Number,
      required: true,
      min: 1.0,  
      max: 5.0   
    },
    comments: {
      type: String,
      trim: true,
      maxlength: 500
    }
  }],
  overallComments: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  overallBehavioralScore: {
    type: Number,
    min: 0,
    max: 100
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'acknowledged'],
    default: 'draft'
  },
  submittedAt: Date,
  acknowledgedAt: Date,
  acknowledgedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
BehavioralEvaluationSchema.index({ employee: 1, quarter: 1 }, { unique: true });
BehavioralEvaluationSchema.index({ evaluator: 1 });
BehavioralEvaluationSchema.index({ status: 1 });

// Calculate overall score before saving
BehavioralEvaluationSchema.pre('save', function(next) {
  if (this.criteria && this.criteria.length > 0) {
    const totalScore = this.criteria.reduce((sum, criterion) => sum + criterion.score, 0);
    const maxScore = this.criteria.length * 5;
    this.overallBehavioralScore = (totalScore / maxScore) * 100;
  }
  next();
});

// Methods
BehavioralEvaluationSchema.methods.submit = function() {
  if (!this.criteria || this.criteria.length < 5) {
    throw new Error('At least 5 criteria must be evaluated');
  }
  this.status = 'submitted';
  this.submittedAt = new Date();
};

BehavioralEvaluationSchema.methods.acknowledge = function(userId) {
  this.status = 'acknowledged';
  this.acknowledgedAt = new Date();
  this.acknowledgedBy = userId;
};

module.exports = mongoose.model('BehavioralEvaluation', BehavioralEvaluationSchema);