// models/StockTransaction.js - UPDATED

const mongoose = require('mongoose');

const StockTransactionSchema = new mongoose.Schema({
  transactionNumber: {
    type: String,
    unique: true,
    sparse: true
    // REMOVED required: true - will be generated in pre-save hook
  },
  transactionType: {
    type: String,
    required: true,
    enum: ['inbound', 'outbound', 'adjustment', 'transfer'],
    index: true
  },
  item: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true,
    index: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  unitPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  transactionDate: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // Stock levels
  stockBefore: {
    type: Number,
    default: 0
  },
  stockAfter: {
    type: Number,
    default: 0
  },
  
  // Inbound specific fields
  poNumber: {
    type: String,
    trim: true
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  supplierName: {
    type: String,
    trim: true
  },
  grnNumber: {
    type: String,
    trim: true
  },
  inspectionStatus: {
    type: String,
    enum: ['not-required', 'pending', 'passed', 'failed'],
    default: 'not-required'
  },
  initialQuantity: {
    type: Number
  },
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Outbound specific fields
  requisitionNumber: {
    type: String,
    trim: true
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  },
  projectName: {
    type: String,
    trim: true
  },
  cluster: {
    type: String,
    trim: true
  },
  siteName: {
    type: String,
    trim: true
  },
  ihsId: {
    type: String,
    trim: true
  },
  siteId: {
    type: String,
    trim: true
  },
  mfrNumber: {
    type: String,
    trim: true
  },
  mfrDate: {
    type: Date
  },
  requestor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  requestorName: {
    type: String,
    trim: true
  },
  deliveryNote: {
    type: String,
    trim: true
  },
  carrier: {
    type: String,
    trim: true
  },
  carrierName: {
    type: String,
    trim: true
  },
  transporter: {
    type: String,
    trim: true
  },
  servedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  servedByName: {
    type: String,
    trim: true
  },
  
  // Transfer specific fields
  fromLocation: {
    type: String,
    trim: true
  },
  toLocation: {
    type: String,
    trim: true
  },
  
  // Common fields
  comment: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled', 'void'],
    default: 'pending',
    index: true
  },
  
  // Audit fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalDate: {
    type: Date
  },
  voidedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  voidedDate: {
    type: Date
  },
  voidReason: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
StockTransactionSchema.index({ item: 1, transactionDate: -1 });
StockTransactionSchema.index({ transactionType: 1, status: 1 });
StockTransactionSchema.index({ project: 1 });
StockTransactionSchema.index({ supplier: 1 });
StockTransactionSchema.index({ createdAt: -1 });
StockTransactionSchema.index({ transactionNumber: 1 }, { unique: true, sparse: true });

// Virtual for transaction value
StockTransactionSchema.virtual('transactionValue').get(function() {
  return this.quantity * this.unitPrice;
});

// IMPROVED: Generate transaction number before saving
StockTransactionSchema.pre('save', async function(next) {
  try {
    // Only generate if new document and no transaction number exists
    if (this.isNew && !this.transactionNumber) {
      const prefix = this.transactionType === 'inbound' ? 'IN' :
                    this.transactionType === 'outbound' ? 'OUT' :
                    this.transactionType === 'adjustment' ? 'ADJ' : 'TRF';
      
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      
      // Use countDocuments instead of findOne for better performance
      const count = await this.constructor.countDocuments({
        transactionType: this.transactionType,
        createdAt: {
          $gte: new Date(date.getFullYear(), date.getMonth(), 1),
          $lt: new Date(date.getFullYear(), date.getMonth() + 1, 1)
        }
      });
      
      const sequence = count + 1;
      this.transactionNumber = `${prefix}-${year}${month}-${sequence.toString().padStart(5, '0')}`;
      
      console.log('Generated transaction number:', this.transactionNumber);
    }
    next();
  } catch (error) {
    console.error('Error generating transaction number:', error);
    // If generation fails, create a simple fallback
    if (this.isNew && !this.transactionNumber) {
      const prefix = this.transactionType?.substring(0, 3).toUpperCase() || 'TXN';
      const timestamp = Date.now().toString().slice(-8);
      this.transactionNumber = `${prefix}-${timestamp}`;
      console.log('Using fallback transaction number:', this.transactionNumber);
    }
    next();
  }
});

// Method to void transaction
StockTransactionSchema.methods.voidTransaction = async function(userId, reason) {
  this.status = 'void';
  this.voidedBy = userId;
  this.voidedDate = new Date();
  this.voidReason = reason;
  return this.save();
};

module.exports = mongoose.model('StockTransaction', StockTransactionSchema);


