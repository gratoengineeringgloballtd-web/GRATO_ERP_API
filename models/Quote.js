const mongoose = require('mongoose');

const QuoteSchema = new mongoose.Schema({
  quoteNumber: {
    type: String,
    unique: true,
  },
  requisitionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequisition',
    required: true
  },
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rfqId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RFQ',
    required: true
  },
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Quote Details
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'XAF'
  },

  // Timeline
  submissionDate: {
    type: Date,
    default: Date.now
  },
  validUntil: {
    type: Date,
    required: true
  },
  responseTime: Number, // in hours

  // Status Management
  status: {
    type: String,
    enum: [
      'received',
      'under_review',
      'evaluated',
      'selected',
      'rejected',
      'expired',
      'clarification_requested',
      'clarification_received'
    ],
    default: 'received'
  },

  // Supplier Information
  supplierDetails: {
    name: String,
    email: String,
    phone: String,
    contactPerson: String,
    address: String
  },

  // Quote Items
  items: [{
    description: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0
    },
    specifications: String,
    partNumber: String,
    warranty: String,
    leadTime: String,
    availability: {
      type: String,
      default: 'Available'
    }
  }],

  // Terms and Conditions
  paymentTerms: {
    type: String,
    default: '30 days'
  },
  deliveryTerms: {
    type: String,
    default: 'Standard delivery'
  },
  deliveryTime: {
    value: {
      type: Number,
      default: 7
    },
    unit: {
      type: String,
      enum: ['days', 'weeks', 'months'],
      default: 'days'
    }
  },
  warranty: String,

  // Evaluation
  evaluation: {
    evaluated: {
      type: Boolean,
      default: false
    },
    evaluatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    evaluationDate: Date,

    // Scoring (0-100)
    qualityScore: {
      type: Number,
      min: 0,
      max: 100
    },
    costScore: {
      type: Number,
      min: 0,
      max: 100
    },
    deliveryScore: {
      type: Number,
      min: 0,
      max: 100
    },
    technicalScore: {
      type: Number,
      min: 0,
      max: 100
    },

    totalScore: {
      type: Number,
      min: 0,
      max: 100
    },

    weights: {
      quality: {
        type: Number,
        default: 40
      },
      cost: {
        type: Number,
        default: 35
      },
      delivery: {
        type: Number,
        default: 25
      },
      technical: {
        type: Number,
        default: 0
      }
    },

    // Comments and notes
    notes: String,
    strengths: [String],
    weaknesses: [String],
    recommendations: String
  },

  // Comparison Metrics
  comparisonMetrics: {
    priceRank: Number,
    deliveryRank: Number,
    qualityRank: Number,
    overallRank: Number,
    priceVarianceFromAverage: Number,
    deliveryVarianceFromAverage: Number
  },

  // Clarifications
  clarifications: [{
    question: {
      type: String,
      required: true
    },
    response: String,
    requestDate: {
      type: Date,
      default: Date.now
    },
    responseDate: Date,
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'responded'],
      default: 'pending'
    }
  }],

  // Decision Information
  decision: {
    status: {
      type: String,
      enum: ['pending', 'selected', 'rejected', 'alternative']
    },
    reason: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    alternativeAction: String
  },

  // Attachments and Documents
  attachments: [{
    name: String,
    url: String,
    publicId: String,
    size: Number,
    mimetype: String,
    category: {
      type: String,
      enum: ['quote_document', 'technical_specs', 'certificate', 'brochure', 'other'],
      default: 'other'
    }
  }],

  // Supplier Notes and Comments
  supplierNotes: String,
  internalNotes: String,

  // Performance Indicators
  responseTimeScore: Number,
  completenessScore: Number,
  professionalismScore: Number,

  // Risk Assessment
  riskAssessment: {
    supplierRisk: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    deliveryRisk: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    qualityRisk: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    financialRisk: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    overallRisk: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    riskNotes: String
  },

  // Audit Trail
  activityLog: [{
    action: {
      type: String,
      enum: ['received', 'evaluated', 'clarification_requested', 'selected', 'rejected'],
      required: true
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
    comments: String
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
QuoteSchema.index({ quoteNumber: 1 });
QuoteSchema.index({ requisitionId: 1 });
QuoteSchema.index({ supplierId: 1 });
QuoteSchema.index({ rfqId: 1 });
QuoteSchema.index({ buyerId: 1 });
QuoteSchema.index({ status: 1 });
QuoteSchema.index({ validUntil: 1 });
QuoteSchema.index({ 'evaluation.totalScore': -1 });
QuoteSchema.index({ submissionDate: -1 });

// Compound indexes
QuoteSchema.index({ rfqId: 1, supplierId: 1 }, { unique: true });
QuoteSchema.index({ status: 1, submissionDate: -1 });

// Virtual for display ID
QuoteSchema.virtual('displayId').get(function() {
  return this.quoteNumber || `QUO-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Virtual for days until expiry
QuoteSchema.virtual('daysUntilExpiry').get(function() {
  const now = new Date();
  const expiry = new Date(this.validUntil);
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for is expired
QuoteSchema.virtual('isExpired').get(function() {
  return new Date() > new Date(this.validUntil);
});

// FIXED: Pre-save middleware to generate quote number
QuoteSchema.pre('save', async function(next) {
  try {
    // Generate quote number if not exists
    if (!this.quoteNumber) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      
      // Get count of quotes today for sequential numbering
      const startOfDay = new Date(year, now.getMonth(), now.getDate());
      const endOfDay = new Date(year, now.getMonth(), now.getDate() + 1);
      
      const dailyCount = await this.constructor.countDocuments({
        createdAt: { $gte: startOfDay, $lt: endOfDay }
      });
      
      const sequence = String(dailyCount + 1).padStart(3, '0');
      this.quoteNumber = `QUO-${year}${month}${day}-${sequence}`;
      
      // Ensure uniqueness by checking if it already exists
      let counter = 1;
      let finalQuoteNumber = this.quoteNumber;
      
      while (await this.constructor.findOne({ quoteNumber: finalQuoteNumber })) {
        counter++;
        const newSequence = String(dailyCount + counter).padStart(3, '0');
        finalQuoteNumber = `QUO-${year}${month}${day}-${newSequence}`;
      }
      
      this.quoteNumber = finalQuoteNumber;
      console.log('Generated quote number:', this.quoteNumber);
    }

    // Validate items have consistent pricing
    if (this.items && this.items.length > 0) {
      this.items.forEach(item => {
        // Ensure totalPrice matches unitPrice * quantity
        if (item.unitPrice && item.quantity) {
          const calculatedTotal = item.unitPrice * item.quantity;
          if (Math.abs(item.totalPrice - calculatedTotal) > 0.01) {
            item.totalPrice = calculatedTotal;
          }
        }
      });

      // Recalculate total amount
      const calculatedTotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
      if (Math.abs(this.totalAmount - calculatedTotal) > 0.01) {
        this.totalAmount = calculatedTotal;
      }
    }

    // Update status based on expiry
    if (this.isExpired && this.status === 'received') {
      this.status = 'expired';
    }

    next();
  } catch (error) {
    console.error('Quote pre-save error:', error);
    next(error);
  }
});

// Method to add activity log
QuoteSchema.methods.addActivity = function(action, performedBy, details, comments) {
  this.activityLog.push({
    action,
    performedBy,
    details,
    comments,
    timestamp: new Date()
  });
  return this.save();
};

// Method to calculate total evaluation score
QuoteSchema.methods.calculateTotalScore = function() {
  if (!this.evaluation.evaluated) return 0;

  const weights = this.evaluation.weights;
  const totalWeight = weights.quality + weights.cost + weights.delivery + weights.technical;

  if (totalWeight === 0) return 0;

  const weightedScore = 
    (this.evaluation.qualityScore * weights.quality +
     this.evaluation.costScore * weights.cost +
     this.evaluation.deliveryScore * weights.delivery +
     this.evaluation.technicalScore * weights.technical) / totalWeight;

  this.evaluation.totalScore = Math.round(weightedScore * 100) / 100;
  return this.evaluation.totalScore;
};

// Method to evaluate quote
QuoteSchema.methods.evaluate = function(evaluationData, evaluatedBy) {
  this.evaluation = {
    ...this.evaluation,
    ...evaluationData,
    evaluated: true,
    evaluatedBy,
    evaluationDate: new Date()
  };

  // Calculate total score
  this.calculateTotalScore();

  // Update status
  this.status = 'evaluated';

  // Add activity log
  this.addActivity('evaluated', evaluatedBy, 'Quote evaluation completed', evaluationData.notes);

  return this;
};

// Method to select quote
QuoteSchema.methods.select = function(reason, decidedBy) {
  this.decision = {
    status: 'selected',
    reason,
    decisionDate: new Date(),
    decidedBy
  };
  this.status = 'selected';

  // Add activity log
  this.addActivity('selected', decidedBy, 'Quote selected for purchase order', reason);

  return this.save();
};

// Method to reject quote
QuoteSchema.methods.reject = function(reason, decidedBy) {
  this.decision = {
    status: 'rejected',
    reason,
    decisionDate: new Date(),
    decidedBy
  };
  this.status = 'rejected';

  // Add activity log
  this.addActivity('rejected', decidedBy, 'Quote rejected', reason);

  return this.save();
};

// Static method to get quotes for a requisition
QuoteSchema.statics.getByRequisition = function(requisitionId) {
  return this.find({ requisitionId })
    .populate('supplierId', 'fullName email phone supplierDetails')
    .populate('evaluation.evaluatedBy', 'fullName')
    .sort({ submissionDate: -1 });
};

// Static method to get quotes for an RFQ
QuoteSchema.statics.getByRFQ = function(rfqId) {
  return this.find({ rfqId })
    .populate('supplierId', 'fullName email phone supplierDetails')
    .populate('evaluation.evaluatedBy', 'fullName')
    .sort({ submissionDate: -1 });
};

// Static method to get buyer's quotes
QuoteSchema.statics.getByBuyer = function(buyerId, options = {}) {
  const query = { buyerId };

  if (options.status) {
    query.status = options.status;
  }

  if (options.supplierId) {
    query.supplierId = options.supplierId;
  }

  return this.find(query)
    .populate('requisitionId', 'title department')
    .populate('supplierId', 'fullName email phone supplierDetails')
    .populate('evaluation.evaluatedBy', 'fullName')
    .sort({ submissionDate: -1 });
};

// Static method to calculate comparison metrics
QuoteSchema.statics.calculateComparisonMetrics = async function(rfqId) {
  const quotes = await this.find({ 
    rfqId, 
    status: { $in: ['evaluated', 'selected', 'rejected'] }
  }).sort({ 'evaluation.totalScore': -1 });

  if (quotes.length === 0) return;

  // Calculate ranks and averages
  const prices = quotes.map(q => q.totalAmount).filter(p => p > 0);
  const deliveryTimes = quotes.map(q => q.deliveryTime?.value || 0).filter(d => d > 0);

  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const avgDeliveryTime = deliveryTimes.length > 0 ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length : 0;

  // Update each quote with comparison metrics
  const updatePromises = quotes.map(async (quote, index) => {
    quote.comparisonMetrics = {
      priceRank: quotes.sort((a, b) => a.totalAmount - b.totalAmount).findIndex(q => q._id.equals(quote._id)) + 1,
      deliveryRank: quotes.sort((a, b) => (a.deliveryTime?.value || 999) - (b.deliveryTime?.value || 999)).findIndex(q => q._id.equals(quote._id)) + 1,
      qualityRank: quotes.sort((a, b) => (b.evaluation.qualityScore || 0) - (a.evaluation.qualityScore || 0)).findIndex(q => q._id.equals(quote._id)) + 1,
      overallRank: index + 1,
      priceVarianceFromAverage: avgPrice > 0 ? ((quote.totalAmount - avgPrice) / avgPrice) * 100 : 0,
      deliveryVarianceFromAverage: avgDeliveryTime > 0 ? ((quote.deliveryTime?.value || 0) - avgDeliveryTime) / avgDeliveryTime * 100 : 0
    };
    return quote.save();
  });

  await Promise.all(updatePromises);
  return quotes;
};

// Static method to get dashboard statistics
QuoteSchema.statics.getBuyerStats = async function(buyerId) {
  const stats = await this.aggregate([
    { $match: { buyerId: new mongoose.Types.ObjectId(buyerId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        received: {
          $sum: { $cond: [{ $eq: ['$status', 'received'] }, 1, 0] }
        },
        evaluated: {
          $sum: { $cond: [{ $eq: ['$status', 'evaluated'] }, 1, 0] }
        },
        selected: {
          $sum: { $cond: [{ $eq: ['$status', 'selected'] }, 1, 0] }
        },
        expired: {
          $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] }
        },
        avgTotalScore: { $avg: '$evaluation.totalScore' },
        avgResponseTime: { $avg: '$responseTime' },
        totalValue: { $sum: '$totalAmount' }
      }
    }
  ]);

  return stats[0] || {
    total: 0,
    received: 0,
    evaluated: 0,
    selected: 0,
    expired: 0,
    avgTotalScore: 0,
    avgResponseTime: 0,
    totalValue: 0
  };
};

module.exports = mongoose.model('Quote', QuoteSchema);




