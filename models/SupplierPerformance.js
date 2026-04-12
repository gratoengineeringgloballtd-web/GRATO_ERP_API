const mongoose = require('mongoose');

const SupplierPerformanceSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  supplierName: {
    type: String,
    required: true
  },
  evaluationPeriod: {
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    }
  },
  
  // Performance Metrics (0-100 scale)
  onTimeDeliveryRate: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  qualityRating: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  costCompliance: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  responsivenessRating: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  
  // Calculated overall score
  overallScore: {
    type: Number,
    min: 0,
    max: 100
  },
  
  // Detailed Metrics
  metrics: {
    totalOrders: {
      type: Number,
      default: 0,
      min: 0
    },
    onTimeDeliveries: {
      type: Number,
      default: 0,
      min: 0
    },
    lateDeliveries: {
      type: Number,
      default: 0,
      min: 0
    },
    qualityIssues: {
      type: Number,
      default: 0,
      min: 0
    },
    priceVariances: {
      type: Number,
      default: 0
    },
    averageResponseTimeHours: {
      type: Number,
      default: 0,
      min: 0
    },
    totalValueDelivered: {
      type: Number,
      default: 0,
      min: 0
    },
    defectRate: {
      type: Number,
      default: 0,
      min: 0
    },
    returnRate: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // Specific Issues/Incidents
  incidents: [{
    date: {
      type: Date,
      required: true
    },
    type: {
      type: String,
      enum: ['late-delivery', 'quality-issue', 'price-variance', 'communication-issue', 'other'],
      required: true
    },
    description: {
      type: String,
      required: true
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    resolved: {
      type: Boolean,
      default: false
    },
    resolutionDate: Date,
    resolutionNotes: String
  }],
  
  // Strengths and Weaknesses
  strengths: [{
    type: String
  }],
  weaknesses: [{
    type: String
  }],
  improvementAreas: [{
    type: String
  }],
  
  // Recommendations
  recommendation: {
    type: String,
    enum: ['preferred', 'approved', 'conditional', 'not-recommended', 'blacklisted'],
    default: 'approved'
  },
  
  remarks: {
    type: String
  },
  
  // Evaluation metadata
  evaluatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  evaluatorName: {
    type: String
  },
  evaluationDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewDate: Date,
  
  // Action items
  actionItems: [{
    action: {
      type: String,
      required: true
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    dueDate: Date,
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed'],
      default: 'pending'
    },
    completionDate: Date,
    notes: String
  }],
  
  status: {
    type: String,
    enum: ['draft', 'submitted', 'reviewed', 'archived'],
    default: 'draft'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
SupplierPerformanceSchema.index({ supplier: 1, 'evaluationPeriod.startDate': -1 });
SupplierPerformanceSchema.index({ overallScore: -1 });
SupplierPerformanceSchema.index({ recommendation: 1 });
SupplierPerformanceSchema.index({ status: 1 });

// Pre-save middleware to calculate overall score
SupplierPerformanceSchema.pre('save', function(next) {
  // Calculate overall score as average of all ratings
  this.overallScore = (
    this.onTimeDeliveryRate +
    this.qualityRating +
    this.costCompliance +
    this.responsivenessRating
  ) / 4;
  
  // Calculate rates if metrics are provided
  if (this.metrics.totalOrders > 0) {
    this.onTimeDeliveryRate = (this.metrics.onTimeDeliveries / this.metrics.totalOrders) * 100;
  }
  
  next();
});

// Virtual for performance grade
SupplierPerformanceSchema.virtual('performanceGrade').get(function() {
  if (this.overallScore >= 90) return 'A';
  if (this.overallScore >= 80) return 'B';
  if (this.overallScore >= 70) return 'C';
  if (this.overallScore >= 60) return 'D';
  return 'F';
});

// Virtual for risk level
SupplierPerformanceSchema.virtual('riskLevel').get(function() {
  const criticalIncidents = this.incidents.filter(i => i.severity === 'critical' && !i.resolved).length;
  const highIncidents = this.incidents.filter(i => i.severity === 'high' && !i.resolved).length;
  
  if (criticalIncidents > 0 || this.overallScore < 60) return 'high';
  if (highIncidents > 2 || this.overallScore < 70) return 'medium';
  return 'low';
});

module.exports = mongoose.model('SupplierPerformance', SupplierPerformanceSchema);