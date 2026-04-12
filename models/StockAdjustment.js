const mongoose = require('mongoose');

const StockAdjustmentSchema = new mongoose.Schema({
  adjustmentNumber: {
    type: String,
    unique: true,
    required: true
  },
  item: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  adjustmentType: {
    type: String,
    required: true,
    enum: [
      'physical-count',
      'damage',
      'theft',
      'expiry',
      'correction',
      'write-off',
      'found',
      'other'
    ]
  },
  quantityBefore: {
    type: Number,
    required: true,
    min: 0
  },
  quantityAfter: {
    type: Number,
    required: true,
    min: 0
  },
  variance: {
    type: Number,
    required: true
  },
  valueBefore: {
    type: Number,
    default: 0
  },
  valueAfter: {
    type: Number,
    default: 0
  },
  valueVariance: {
    type: Number,
    default: 0
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  detailedNotes: {
    type: String
  },
  
  // Approval workflow
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestedByName: {
    type: String
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedByName: {
    type: String
  },
  approvalDate: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  
  // Physical count details
  physicalCount: {
    countedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    countDate: Date,
    location: String,
    witnesses: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  
  // Supporting documents
  attachments: [{
    filename: String,
    url: String,
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }],
  
  adjustmentDate: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
StockAdjustmentSchema.index({ adjustmentNumber: 1 });
StockAdjustmentSchema.index({ item: 1, adjustmentDate: -1 });
StockAdjustmentSchema.index({ status: 1 });
StockAdjustmentSchema.index({ requestedBy: 1 });

// Pre-save middleware to generate adjustment number
StockAdjustmentSchema.pre('save', async function(next) {
  if (!this.adjustmentNumber) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(now.setHours(0, 0, 0, 0)),
        $lt: new Date(now.setHours(23, 59, 59, 999))
      }
    });
    
    const sequence = String(count + 1).padStart(4, '0');
    this.adjustmentNumber = `ADJ${year}${month}${day}${sequence}`;
  }
  
  // Calculate variance
  this.variance = this.quantityAfter - this.quantityBefore;
  
  next();
});

// Virtual for adjustment type display
StockAdjustmentSchema.virtual('adjustmentTypeDisplay').get(function() {
  return this.adjustmentType.split('-').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
});

module.exports = mongoose.model('StockAdjustment', StockAdjustmentSchema);