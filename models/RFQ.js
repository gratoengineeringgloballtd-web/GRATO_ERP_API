const mongoose = require('mongoose');

const RFQSchema = new mongoose.Schema({
  // Basic Information
  rfqNumber: {
    type: String,
    unique: true,
    required: true
  },
  requisitionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequisition',
    required: true
  },
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  
  // Timeline
  issueDate: {
    type: Date,
    default: Date.now
  },
  responseDeadline: {
    type: Date,
    required: true
  },
  expectedDeliveryDate: Date,
  
  // Status
  status: {
    type: String,
    enum: [
      'draft',
      'sent',
      'responses_pending',
      'responses_received',
      'evaluation_complete',
      'awarded',
      'cancelled'
    ],
    default: 'draft'
  },
  
  // Suppliers Invited
  invitedSuppliers: [{
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true
    },
    invitedDate: {
      type: Date,
      default: Date.now
    },
    responseStatus: {
      type: String,
      enum: ['pending', 'responded', 'declined', 'no_response'],
      default: 'pending'
    },
    responseDate: Date,
    remindersSent: {
      type: Number,
      default: 0
    },
    lastReminderDate: Date
  }],
  
  // RFQ Details
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
    unit: String,
    specifications: String,
    requiredDeliveryDate: Date
  }],
  
  // Terms and Requirements
  paymentTerms: String,
  deliveryLocation: String,
  specialRequirements: String,
  evaluationCriteria: {
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
    }
  },
  
  // Attachments
  attachments: [{
    name: String,
    url: String,
    publicId: String,
    size: Number,
    mimetype: String
  }],
  
  // Response Summary
  responseSummary: {
    totalInvited: {
      type: Number,
      default: 0
    },
    totalResponded: {
      type: Number,
      default: 0
    },
    totalDeclined: {
      type: Number,
      default: 0
    },
    noResponse: {
      type: Number,
      default: 0
    },
    responseRate: {
      type: Number,
      default: 0
    }
  },
  
  // Winner Information
  selectedQuote: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quote'
  },
  awardDate: Date,
  awardReason: String,
  
  // Audit Trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
RFQSchema.index({ rfqNumber: 1 });
RFQSchema.index({ requisitionId: 1 });
RFQSchema.index({ buyerId: 1 });
RFQSchema.index({ status: 1 });
RFQSchema.index({ responseDeadline: 1 });

// Pre-save middleware to generate RFQ number
RFQSchema.pre('save', function(next) {
  if (!this.rfqNumber) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.rfqNumber = `RFQ-${year}${month}${day}-${random}`;
  }
  
  // Update response summary
  this.responseSummary.totalInvited = this.invitedSuppliers.length;
  this.responseSummary.totalResponded = this.invitedSuppliers.filter(s => s.responseStatus === 'responded').length;
  this.responseSummary.totalDeclined = this.invitedSuppliers.filter(s => s.responseStatus === 'declined').length;
  this.responseSummary.noResponse = this.invitedSuppliers.filter(s => s.responseStatus === 'no_response').length;
  this.responseSummary.responseRate = this.responseSummary.totalInvited > 0 ? 
    (this.responseSummary.totalResponded / this.responseSummary.totalInvited) * 100 : 0;
  
  next();
});

// Method to add suppliers
RFQSchema.methods.addSuppliers = function(supplierIds) {
  const newSuppliers = supplierIds.filter(id => 
    !this.invitedSuppliers.some(s => s.supplierId.equals(id))
  ).map(id => ({
    supplierId: id,
    invitedDate: new Date(),
    responseStatus: 'pending'
  }));
  
  this.invitedSuppliers.push(...newSuppliers);
  return this.save();
};

// Method to update supplier response status
RFQSchema.methods.updateSupplierResponse = function(supplierId, status, responseDate = new Date()) {
  const supplier = this.invitedSuppliers.find(s => s.supplierId.equals(supplierId));
  if (supplier) {
    supplier.responseStatus = status;
    supplier.responseDate = responseDate;
    
    // Update overall status if all suppliers have responded
    const allResponded = this.invitedSuppliers.every(s => 
      ['responded', 'declined', 'no_response'].includes(s.responseStatus)
    );
    
    if (allResponded && this.status === 'responses_pending') {
      this.status = 'responses_received';
    }
  }
  
  return this.save();
};

// Method to send reminders
RFQSchema.methods.sendReminder = function(supplierId) {
  const supplier = this.invitedSuppliers.find(s => s.supplierId.equals(supplierId));
  if (supplier && supplier.responseStatus === 'pending') {
    supplier.remindersSent += 1;
    supplier.lastReminderDate = new Date();
  }
  
  return this.save();
};

// Static method to get overdue RFQs
RFQSchema.statics.getOverdueRFQs = function() {
  return this.find({
    responseDeadline: { $lt: new Date() },
    status: { $in: ['sent', 'responses_pending'] }
  }).populate('buyerId', 'fullName email')
    .populate('invitedSuppliers.supplierId', 'name email');
};

module.exports = mongoose.model('RFQ', RFQSchema);




