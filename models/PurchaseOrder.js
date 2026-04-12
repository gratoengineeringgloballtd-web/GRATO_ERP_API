const mongoose = require('mongoose');


const purchaseOrderApprovalStepSchema = new mongoose.Schema({
  level: {
    type: Number,
    required: true
  },
  approver: {
    name: String,
    email: String,
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: String,
    department: String
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  decision: {
    type: String,
    enum: ['approved', 'rejected']
  },
  comments: {
    type: String,
    trim: true
  },
  // Document signing tracking
  signedDocument: {
    publicId: String,
    url: String,
    localPath: String,
    format: String,
    resourceType: String,
    bytes: Number,
    originalName: String,
    uploadedAt: Date
  },
  documentDownloaded: {
    type: Boolean,
    default: false
  },
  downloadedAt: Date,
  actionDate: Date,
  actionTime: String,
  activatedDate: Date,
  notificationSent: {
    type: Boolean,
    default: false
  },
  notificationSentAt: Date
}, {
  timestamps: true
});


const TenderJustificationSchema = new mongoose.Schema({
  // Name/title the buyer gives to the manually-signed document
  documentName: {
    type:     String,
    required: true,
    trim:     true
  },
  // Compulsory explanation of why no tender was raised
  justificationNote: {
    type:     String,
    required: true,
    trim:     true
  },
  // Uploaded signed document (scanned PDF / image)
  signedDocument: {
    url:          String,   // public/CDN URL
    localPath:    String,   // server filesystem path (for PDF generation)
    originalName: String,   // original filename from upload
    mimeType:     String,
    size:         Number,
    uploadedAt:   { type: Date, default: Date.now }
  },
  submittedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedAt:   { type: Date, default: Date.now }
}, { _id: false });

const PurchaseOrderSchema = new mongoose.Schema({
  poNumber: {
    type: String,
    unique: true,
    required: true
  },
  requisitionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequisition'
  },

  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier', 
    required: false 
  },

  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'XAF'
  },

  tenderJustification: {
    type:    TenderJustificationSchema,
    default: null
  },
  // Flag for quick querying
  createdWithoutTender: {
    type:    Boolean,
    default: false
  },

  status: {
    type: String,
    enum: [
      'draft',
      'pending_supply_chain_assignment',  
      'pending_department_approval',      
      'pending_head_of_business_approval', 
      'pending_finance_approval',         
      'approved',
      'sent_to_supplier',
      'acknowledged',
      'in_production',
      'ready_for_shipment',
      'in_transit',
      'delivered',
      'completed',
      'cancelled',
      'rejected',
      'on_hold'
    ],
    default: 'draft'
  },

  // NEW: Supply Chain Review
  supplyChainReview: {
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewDate: Date,
    reviewTime: String,
    action: {
      type: String,
      enum: ['assigned', 'rejected']
    },
    comments: String,
    rejectionReason: String,
    signedDocument: {
      publicId: String,
      url: String,
      localPath: String,
      format: String,
      resourceType: String,
      bytes: Number,
      originalName: String,
      uploadedAt: Date
    }
  },

  // NEW: 3-level approval chain (Dept Head → Head of Business → Finance)
  approvalChain: [purchaseOrderApprovalStepSchema],

  currentApprovalLevel: {
    type: Number,
    default: 0
  },

  // Timeline
  creationDate: {
    type: Date,
    default: Date.now
  },
  approvalDate: Date,
  sentDate: Date,
  acknowledgedDate: Date,
  expectedDeliveryDate: {
    type: Date,
    required: true
  },
  actualDeliveryDate: Date,

  // Terms and Conditions
  paymentTerms: {
    type: String,
    required: true,
    enum: ['15 days', '30 days', '45 days', '60 days', 'Cash on delivery', 'Advance payment']
  },
  deliveryTerms: String,
  deliveryAddress: {
    type: String,
    required: true
  },

  items: [{
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: false
    },

    itemCode: String,

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

    // Optional item details
    specifications: String,
    partNumber: String,
    category: String,
    unitOfMeasure: String,

    isFromDatabase: {
      type: Boolean,
      default: false
    }
  }],

  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  currentStage: {
    type: String,
    enum: [
      'created',
      'supplier_acknowledgment',
      'in_production',
      'in_transit',
      'completed'
    ],
    default: 'created'
  },

  // Activities Log
  activities: [{
    type: {
      type: String,
      enum: ['created', 'sent', 'acknowledged', 'updated', 'shipped', 'delivered', 'cancelled', 'approved', 'rejected'],
      required: true
    },
    description: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    user: String
  }],

  // Delivery Tracking
  deliveryTracking: {
    status: {
      type: String,
      enum: ['pending', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'],
      default: 'pending'
    },
    trackingNumber: String,
    carrier: String,
    estimatedDelivery: Date,
    deliveredDate: Date,
    updates: [{
      status: String,
      description: String,
      location: String,
      timestamp: Date
    }]
  },

  // Approval Workflow
  approvalRequired: {
    type: Boolean,
    default: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalComments: String,

  // Additional Information
  notes: String,
  internalNotes: String,
  specialInstructions: String,
  termsAndConditions: String,

  // File attachments
  attachments: [{
    name: String,
    url: String,
    publicId: String,
    size: Number,
    mimetype: String
  }],

  // Quote reference (if created from quote)
  quoteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quote',
    required: false 
  },

  // ENHANCED: Supplier details snapshot from Supplier model
  supplierDetails: {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    phone: String,
    address: String,
    businessType: String,
    registrationNumber: String,
    taxId: String,

    // Performance snapshot at time of PO creation
    performanceSnapshot: {
      overallRating: Number,
      totalOrders: Number,
      onTimeDeliveryRate: Number,
      lastOrderDate: Date
    }
  },

  // Performance Metrics
  performanceMetrics: {
    onTimeDelivery: Boolean,
    qualityRating: {
      type: Number,
      min: 1,
      max: 5
    },
    supplierRating: {
      type: Number,
      min: 1,
      max: 5
    },
    costVariance: Number,
    deliveryVariance: Number
  },

  // Financial Information
  budgetAllocated: Number,
  actualCost: Number,
  costSavings: Number,

  // Integration metadata
  integrationData: {
    sourceSystem: {
      type: String,
      enum: ['manual', 'requisition', 'quote', 'catalog'],
      default: 'manual'
    },

    // Track which items came from database
    itemsFromDatabase: {
      type: Number,
      default: 0
    },
    manualItems: {
      type: Number,
      default: 0
    },

    // Validation flags
    supplierValidated: {
      type: Boolean,
      default: false
    },
    itemsValidated: {
      type: Boolean,
      default: false
    }
  },

  // Tax Information
  taxApplicable: {
    type: Boolean,
    default: false
  },
  taxRate: {
    type: Number,
    default: 19.25, // Default 19.25% to match template
    min: 0,
    max: 100
  },
  currency: {
    type: String,
    enum: ['FCFA', 'XAF', 'USD', 'EUR'],
    default: 'FCFA'
  },
  totalAmount: {
    type: Number,
    default: 0,
    min: 0
  },

  // Audit Trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastModifiedDate: {
    type: Date,
    default: Date.now
  },

  // Cancellation details
  cancellationReason: String,
  cancelledDate: Date,
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
PurchaseOrderSchema.index({ poNumber: 1 });
PurchaseOrderSchema.index({ requisitionId: 1 });
PurchaseOrderSchema.index({ supplierId: 1 }); // Updated for Supplier model
PurchaseOrderSchema.index({ buyerId: 1 });
PurchaseOrderSchema.index({ status: 1 });
PurchaseOrderSchema.index({ creationDate: -1 });
PurchaseOrderSchema.index({ expectedDeliveryDate: 1 });
PurchaseOrderSchema.index({ 'integrationData.sourceSystem': 1 });

// Compound indexes
PurchaseOrderSchema.index({ supplierId: 1, status: 1 });
PurchaseOrderSchema.index({ buyerId: 1, status: 1 });
PurchaseOrderSchema.index({ status: 1, expectedDeliveryDate: 1 });

// Virtual for display ID
PurchaseOrderSchema.virtual('displayId').get(function() {
  return this.poNumber || `PO-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Virtual for items breakdown
PurchaseOrderSchema.virtual('itemsBreakdown').get(function() {
  const fromDatabase = this.items.filter(item => item.itemId).length;
  const manual = this.items.length - fromDatabase;

  return {
    total: this.items.length,
    fromDatabase,
    manual,
    databasePercentage: this.items.length > 0 ? Math.round((fromDatabase / this.items.length) * 100) : 0
  };
});

// Virtual for supplier performance at creation
PurchaseOrderSchema.virtual('supplierPerformanceAtCreation').get(function() {
  return this.supplierDetails.performanceSnapshot || null;
});


PurchaseOrderSchema.pre('save', function(next) {
  // Recalculate item totals and overall totals with tax
  if (this.items && this.items.length > 0) {
    // First, ensure each item has correct totalPrice
    this.items.forEach(item => {
      if (item.quantity && item.unitPrice) {
        item.totalPrice = item.quantity * item.unitPrice;
      }
    });

    // Calculate subtotal from all items
    const subtotal = this.items.reduce((sum, item) => {
      return sum + (item.totalPrice || 0);
    }, 0);

    // Store subtotal
    this.subtotalAmount = subtotal;

    // Calculate and apply tax if applicable
    if (this.taxApplicable && this.taxRate > 0) {
      const taxAmount = subtotal * (this.taxRate / 100);
      this.taxAmount = taxAmount;
      this.totalAmount = subtotal + taxAmount;
    } else {
      // No tax applicable
      this.taxAmount = 0;
      this.totalAmount = subtotal;
    }

    console.log(`Tax calculation for ${this.poNumber || 'New PO'}:`);
    console.log(`  Subtotal: ${subtotal}`);
    console.log(`  Tax Rate: ${this.taxRate}%`);
    console.log(`  Tax Amount: ${this.taxAmount}`);
    console.log(`  Total: ${this.totalAmount}`);
  }

  next();
});

// Method to add activity
PurchaseOrderSchema.methods.addActivity = function(type, description, user) {
  this.activities.push({
    type,
    description,
    user: user || 'System',
    timestamp: new Date()
  });
  return this.save();
};

// Method to update status and progress
PurchaseOrderSchema.methods.updateStatus = function(newStatus, user) {
  const oldStatus = this.status;
  this.status = newStatus;

  // Update progress based on status
  const progressMap = {
    'draft': 5,
    'pending_approval': 10,
    'approved': 15,
    'sent_to_supplier': 25,
    'acknowledged': 35,
    'in_production': 50,
    'ready_for_shipment': 70,
    'in_transit': 85,
    'delivered': 95,
    'completed': 100,
    'cancelled': 0,
    'on_hold': this.progress
  };

  this.progress = progressMap[newStatus] || this.progress;

  // Update current stage
  const stageMap = {
    'draft': 'created',
    'pending_approval': 'created',
    'approved': 'created',
    'sent_to_supplier': 'supplier_acknowledgment',
    'acknowledged': 'supplier_acknowledgment',
    'in_production': 'in_production',
    'ready_for_shipment': 'in_production',
    'in_transit': 'in_transit',
    'delivered': 'completed',
    'completed': 'completed'
  };

  this.currentStage = stageMap[newStatus] || this.currentStage;

  // Add activity log
  this.addActivity('updated', `Status changed from ${oldStatus} to ${newStatus}`, user);

  return this;
};

// Method to populate supplier performance snapshot
PurchaseOrderSchema.methods.captureSupplierPerformance = async function() {
  try {
    const Supplier = require('./Supplier');
    const supplier = await Supplier.findById(this.supplierId);

    if (supplier && supplier.performance) {
      this.supplierDetails.performanceSnapshot = {
        overallRating: supplier.performance.overallRating,
        totalOrders: supplier.performance.totalOrders,
        onTimeDeliveryRate: supplier.onTimeDeliveryRate,
        lastOrderDate: supplier.performance.lastOrderDate
      };
    }

    return this.save();
  } catch (error) {
    console.error('Error capturing supplier performance:', error);
  }
};

// Method to validate items against database
PurchaseOrderSchema.methods.validateItems = async function() {
  try {
    const Item = require('./Item');
    let validationResults = {
      valid: true,
      errors: [],
      warnings: []
    };

    for (let item of this.items) {
      if (item.itemId) {
        const dbItem = await Item.findById(item.itemId);
        if (!dbItem) {
          validationResults.valid = false;
          validationResults.errors.push(`Item ${item.description}: Referenced database item not found`);
        } else if (!dbItem.isActive) {
          validationResults.valid = false;
          validationResults.errors.push(`Item ${item.description}: Referenced database item is inactive`);
        } else {
          // Mark as validated and from database
          item.isFromDatabase = true;
          item.itemCode = dbItem.code;
          if (!item.category) item.category = dbItem.category;
          if (!item.unitOfMeasure) item.unitOfMeasure = dbItem.unitOfMeasure;
        }
      }
    }

    this.integrationData.itemsValidated = validationResults.valid;
    return validationResults;
  } catch (error) {
    console.error('Error validating items:', error);
    return {
      valid: false,
      errors: ['Error validating items against database'],
      warnings: []
    };
  }
};

// Method to calculate delivery performance
PurchaseOrderSchema.methods.calculateDeliveryPerformance = function() {
  if (this.actualDeliveryDate && this.expectedDeliveryDate) {
    const expected = new Date(this.expectedDeliveryDate);
    const actual = new Date(this.actualDeliveryDate);
    const diffTime = actual - expected;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    this.performanceMetrics = this.performanceMetrics || {};
    this.performanceMetrics.onTimeDelivery = diffDays <= 0;
    this.performanceMetrics.deliveryVariance = diffDays;

    return {
      onTime: diffDays <= 0,
      variance: diffDays,
      status: diffDays <= 0 ? 'On Time' : `${diffDays} days late`
    };
  }
  return null;
};

// Static method to get purchase orders by buyer with supplier population
PurchaseOrderSchema.statics.getByBuyer = function(buyerId, options = {}) {
  const query = { buyerId };

  if (options.status) {
    query.status = options.status;
  }

  if (options.supplierId) {
    query.supplierId = options.supplierId;
  }

  return this.find(query)
    .populate('requisitionId', 'title department employee')
    .populate('supplierId', 'name email phone address performance') // Updated to populate Supplier
    .populate('buyerId', 'fullName email')
    .populate('items.itemId', 'code description category unitOfMeasure') // Populate item details
    .sort({ creationDate: -1 });
};

// Static method to get dashboard stats with supplier integration
PurchaseOrderSchema.statics.getBuyerStats = async function(buyerId) {
  const stats = await this.aggregate([
    { $match: { buyerId: mongoose.Types.ObjectId(buyerId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        totalValue: { $sum: '$totalAmount' },
        active: {
          $sum: {
            $cond: [
              { $in: ['$status', ['approved', 'sent_to_supplier', 'acknowledged', 'in_production', 'in_transit']] },
              1,
              0
            ]
          }
        },
        completed: {
          $sum: {
            $cond: [{ $eq: ['$status', 'completed'] }, 1, 0]
          }
        },
        cancelled: {
          $sum: {
            $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0]
          }
        },
        avgDeliveryTime: { $avg: '$performanceMetrics.deliveryVariance' },
        onTimeDeliveries: {
          $sum: {
            $cond: [{ $eq: ['$performanceMetrics.onTimeDelivery', true] }, 1, 0]
          }
        },
        // Integration stats
        totalItemsFromDatabase: { $sum: '$integrationData.itemsFromDatabase' },
        totalManualItems: { $sum: '$integrationData.manualItems' }
      }
    }
  ]);

  return stats[0] || {
    total: 0,
    totalValue: 0,
    active: 0,
    completed: 0,
    cancelled: 0,
    avgDeliveryTime: 0,
    onTimeDeliveries: 0,
    totalItemsFromDatabase: 0,
    totalManualItems: 0
  };
};


// Add virtuals
PurchaseOrderSchema.virtual('currentApprovalStep').get(function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain)) return null;
  return this.approvalChain.find(step => 
    step.level === this.currentApprovalLevel && step.status === 'pending'
  );
});

PurchaseOrderSchema.virtual('approvalProgress').get(function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain) || this.approvalChain.length === 0) return 0;
  const approvedSteps = this.approvalChain.filter(step => step.status === 'approved').length;
  return Math.round((approvedSteps / this.approvalChain.length) * 100);
});


// Assign by Supply Chain (creates approval chain)
PurchaseOrderSchema.methods.assignBySupplyChain = function(department, assignedByUserId, comments) {
  const { getPOApprovalChain } = require('../config/poApprovalChain');
  
  if (!['draft', 'pending_supply_chain_assignment'].includes(this.status)) {
    throw new Error('PO has already been assigned or is not in a valid status for assignment');
  }
  
  console.log(`\n=== ASSIGNING PO BY SUPPLY CHAIN ===`);
  console.log(`PO: ${this.poNumber}`);
  console.log(`Department: ${department}`);
  
  this.assignedDepartment = department;
  this.assignedBy = assignedByUserId;
  this.assignmentDate = new Date();
  this.assignmentTime = new Date().toTimeString().split(' ')[0];
  this.status = 'pending_department_approval'; // Valid enum value
  
  // Supply Chain review (auto-approved by assignment)
  this.supplyChainReview = {
    reviewedBy: assignedByUserId,
    reviewDate: new Date(),
    reviewTime: new Date().toTimeString().split(' ')[0],
    action: 'assigned',
    comments: comments || `Assigned to ${department} department`
  };
  
  // Create 3-level approval chain
  const chain = getPOApprovalChain(department);
  
  if (!chain || chain.length !== 3) {
    throw new Error(`Failed to create complete approval chain for ${department}`);
  }
  
  this.approvalChain = chain.map((step, index) => ({
    level: step.level,
    approver: {
      name: step.approver,
      email: step.email,
      role: step.role,
      department: step.department
    },
    status: 'pending',
    activatedDate: index === 0 ? new Date() : null
  }));

  this.currentApprovalLevel = 1;
  
  console.log(`✅ PO ${this.poNumber} assigned to ${department}`);
  console.log(`First approver: ${this.approvalChain[0]?.approver.name}`);
};

// Reject by Supply Chain
PurchaseOrderSchema.methods.rejectBySupplyChain = function(rejectedByUserId, rejectionReason) {
  if (this.status !== 'pending_supply_chain_assignment') {
    throw new Error('PO can only be rejected at supply chain assignment stage');
  }
  
  this.status = 'rejected';
  this.supplyChainReview = {
    reviewedBy: rejectedByUserId,
    reviewDate: new Date(),
    reviewTime: new Date().toTimeString().split(' ')[0],
    action: 'rejected',
    rejectionReason: rejectionReason
  };
  
  console.log(`PO ${this.poNumber} rejected by Supply Chain`);
};

// Process approval step
PurchaseOrderSchema.methods.processApprovalStep = function(approverEmail, decision, comments, userId) {
  const currentStep = this.approvalChain.find(step => 
    step.level === this.currentApprovalLevel && 
    step.approver.email === approverEmail && 
    step.status === 'pending'
  );

  if (!currentStep) {
    throw new Error(`Not authorized to approve at level ${this.currentApprovalLevel}`);
  }

  currentStep.status = decision === 'approved' ? 'approved' : 'rejected';
  currentStep.decision = decision;
  currentStep.comments = comments;
  currentStep.actionDate = new Date();
  currentStep.actionTime = new Date().toTimeString().split(' ')[0];
  currentStep.approver.userId = userId;

  if (decision === 'rejected') {
    this.status = 'rejected';
    this.currentApprovalLevel = 0;
  } else {
    const nextLevel = this.currentApprovalLevel + 1;
    const nextStep = this.approvalChain.find(step => step.level === nextLevel);
    
    if (nextStep) {
      this.currentApprovalLevel = nextLevel;
      nextStep.activatedDate = new Date();
      nextStep.notificationSent = false;
      
      if (nextLevel === 2) {
        this.status = 'pending_head_of_business_approval';
      } else if (nextLevel === 3) {
        this.status = 'pending_finance_approval';
      }
    } else {
      // All approvals complete
      this.status = 'approved';
      this.approvalDate = new Date();
      this.currentApprovalLevel = 0;
    }
  }

  return currentStep;
};

// Get current approver
PurchaseOrderSchema.methods.getCurrentApprover = function() {
  if (this.currentApprovalLevel === 0 || !this.approvalChain) return null;
  return this.approvalChain.find(step => step.level === this.currentApprovalLevel);
};

// Check if user can approve
PurchaseOrderSchema.methods.canUserApprove = function(userEmail) {
  const currentStep = this.getCurrentApprover();
  return currentStep && currentStep.approver.email === userEmail;
};

// Get approval history
PurchaseOrderSchema.methods.getApprovalHistory = function() {
  if (!this.approvalChain) return [];
  return this.approvalChain
    .filter(step => step.status !== 'pending')
    .sort((a, b) => a.level - b.level);
};

// Static methods

// Get POs pending supply chain assignment
PurchaseOrderSchema.statics.getPendingSupplyChainAssignment = function() {
  return this.find({
    status: 'pending_supply_chain_assignment'
  }).populate('buyerId', 'fullName email')
    .populate('supplierId', 'name email')
    .sort({ createdAt: 1 });
};

// Get pending POs for approver
PurchaseOrderSchema.statics.getPendingForApprover = function(approverEmail) {
  return this.find({
    'approvalChain.approver.email': approverEmail,
    'approvalChain.status': 'pending',
    status: { 
      $in: [
        'pending_department_approval', 
        'pending_head_of_business_approval',
        'pending_finance_approval'
      ] 
    },
    $expr: {
      $let: {
        vars: {
          currentStep: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$approvalChain',
                  cond: { $eq: ['$$this.level', '$currentApprovalLevel'] }
                }
              },
              0
            ]
          }
        },
        in: { $eq: ['$$currentStep.approver.email', approverEmail] }
      }
    }
  }).populate('buyerId', 'fullName email')
    .populate('supplierId', 'name email')
    .sort({ assignmentDate: -1 });
};

// Send notification to current approver
PurchaseOrderSchema.methods.notifyCurrentApprover = async function() {
  const currentStep = this.getCurrentApprover();
  if (!currentStep || currentStep.notificationSent) return;
  
  const { sendEmail } = require('../services/emailService');
  
  try {
    await sendEmail({
      to: currentStep.approver.email,
      subject: `Purchase Order Approval Required - ${this.poNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2>Purchase Order Approval Required</h2>
            <p>Dear ${currentStep.approver.name},</p>
            <p>A purchase order requires your approval at Level ${currentStep.level}.</p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>PO Details</h3>
              <table style="width: 100%;">
                <tr><td><strong>PO Number:</strong></td><td>${this.poNumber}</td></tr>
                <tr><td><strong>Supplier:</strong></td><td>${this.supplierDetails?.name || this.supplierName}</td></tr>
                <tr><td><strong>Amount:</strong></td><td>${this.currency} ${this.totalAmount.toLocaleString()}</td></tr>
                <tr><td><strong>Department:</strong></td><td>${this.assignedDepartment}</td></tr>
                <tr><td><strong>Approval Level:</strong></td><td>Level ${currentStep.level}</td></tr>
              </table>
            </div>
            
            <div style="background-color: #ffe7ba; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <p><strong>⚠️ Document Signing Required:</strong></p>
              <ol>
                <li>Download the PO document</li>
                <li>Sign manually (print or digital signature)</li>
                <li>Upload the signed document when approving</li>
              </ol>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/supervisor/po-approvals?approve=${this._id}" 
                 style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px;">
                Review & Sign PO
              </a>
            </div>
          </div>
        </div>
      `
    });
    
    currentStep.notificationSent = true;
    currentStep.notificationSentAt = new Date();
    await this.save();
    
  } catch (error) {
    console.error('Failed to send PO notification:', error);
  }
};

// Post-save middleware
PurchaseOrderSchema.post('save', async function() {
  if (['pending_department_approval', 'pending_head_of_business_approval', 'pending_finance_approval'].includes(this.status)) {
    if (this.currentApprovalLevel > 0 && this.approvalChain.length > 0) {
      const currentStep = this.getCurrentApprover();
      if (currentStep && !currentStep.notificationSent) {
        setTimeout(() => {
          this.notifyCurrentApprover().catch(err => 
            console.error('Failed to send PO notification:', err)
          );
        }, 1000);
      }
    }
  }
});

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);


