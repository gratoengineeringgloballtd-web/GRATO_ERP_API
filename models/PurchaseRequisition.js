// models/PurchaseRequisition.js
const mongoose = require('mongoose');

const PurchaseRequisitionSchema = new mongoose.Schema({
  requisitionNumber: {
    type: String,
    required: true,
    unique: true
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true
  },
  // itemCategory: {
  //   type: String,
  //   enum: ['IT', 'Office Supplies', 'Hardware', 'all', 'Other'],
  //   default: 'all'
  // },
  // itemCategory: {
  //   type: String,
  //   enum: [
  //     'IT Accessories',
  //     'Office Supplies',
  //     'Equipment',
  //     'Consumables',
  //     'Software',
  //     'Hardware',
  //     'Furniture',
  //     'Safety Equipment',
  //     'Maintenance Supplies',
  //     'Other',
  //     'all'
  //   ],
  //   default: 'all'
  // },
  itemCategory: {
    type: String,
    enum: [
      'IT Accessories',
      'Office Supplies',
      'Equipment',
      'Consumables',
      'Software',
      'Hardware',
      'Furniture',
      'Civil Works',
      'Security',
      'Rollout',
      'Safety Equipment',
      'Maintenance Supplies',
      'Personal Accessories',
      'Spares',
      'Expense',
      'Other',
      'all'
    ],
    default: 'all'
  },
  budgetXAF: {
    type: Number,
    min: 0
  },
  
  budgetCode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetCode',
    required: true,
    index: true
  },
  
  budgetCodeInfo: {
    code: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    department: String,
    budgetType: String,
    availableAtSubmission: {
      type: Number,
      required: true,
      min: 0
    },
    submittedAmount: {
      type: Number,
      required: true,
      min: 0
    }
  },
  
  budgetHolder: String,
  urgency: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  deliveryLocation: {
    type: String,
    required: true
  },
  expectedDate: {
    type: Date,
    required: true
  },
  justificationOfPurchase: {
    type: String,
    // ✅ UPDATED: Now optional - will be provided by assigned buyer
    required: false,
    minlength: 20
  },
  justificationOfPreferredSupplier: String,

  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  },

  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  preferredSupplier: {
    type: String
  },

  items: [{
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true
    },
    code: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    customDescription: {
      type: String,
      default: ''
    },
    category: {
      type: String,
      required: true
    },
    subcategory: String,
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    measuringUnit: {
      type: String,
      required: true
    },
    estimatedPrice: {
      type: Number,
      default: 0,
      min: 0
    },
    customUnitPrice: {
      type: Number,
      default: 0,
      min: 0
    },
    projectName: String
  }],

  attachments: [{
    name: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    publicId: {
      type: String,
      required: true
    },
    localPath: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    mimetype: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],

  status: {
    type: String,
    enum: [
      'draft',
      'pending_supervisor',
      'pending_finance_verification',
      'pending_supply_chain_review',
      'pending_buyer_assignment',
      'pending_head_approval',
      'approved',
      'partially_disbursed',  
      'fully_disbursed',
      'rejected',
      'supply_chain_approved',
      'supply_chain_rejected',
      'in_procurement',
      'procurement_complete',
      'delivered',
      'justification_pending_supervisor',
      'justification_pending_finance',
      'justification_pending_supply_chain',
      'justification_pending_head',
      'justification_rejected',
      'justification_approved',
      'completed',
      'pending_clarification',
      'pending_cancellation',
      'cancelled'
    ],
    default: 'pending_supervisor'
  },

  approvalChain: [{
    level: {
      type: Number,
      required: true
    },
    approver: {
      name: {
        type: String,
        required: true,
        trim: true
      },
      email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
      },
      role: {
        type: String,
        required: true,
        trim: true
      },
      department: {
        type: String,
        required: true,
        trim: true
      }
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'needs_clarification', 'clarification_provided'],
      default: 'pending'
    },
    comments: {
      type: String,
      default: ''
    },
    clarificationRequest: {
      requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      requesterName: String,
      requesterRole: String,
      message: String,
      requestedAt: Date
    },
    clarificationResponse: {
      message: String,
      respondedAt: Date
    },
    actionDate: Date,
    actionTime: String,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedDate: {
      type: Date,
      default: null
    }
  }],

  financeVerification: {
    budgetAvailable: Boolean,
    verifiedBudget: Number,
    budgetCodeVerified: String,
    budgetCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BudgetCode'
    },
    availableBudgetAtVerification: Number,
    comments: String,
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    verificationDate: Date,
    decision: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    }
  },

  supplyChainReview: {
    decision: {
      type: String,
      enum: ['pending', 'approve', 'reject'],
      default: 'pending'
    },
    sourcingType: {
      type: String,
      enum: ['direct_purchase', 'quotation_required', 'tender_process', 'framework_agreement']
    },
    purchaseTypeAssigned: {
      type: String,
      enum: ['opex', 'capex', 'standard', 'emergency']
    },
    assignedBuyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    buyerAssignmentDate: Date,
    buyerAssignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    
    estimatedCost: Number,
    budgetAssignedBySupplyChain: {
      type: Boolean,
      default: false
    },
    assignedBudget: {
      type: Number,
      min: 0
    },
    previousBudget: {
      type: Number,
      min: 0
    },
    budgetAssignmentReason: String,
    budgetAssignedAt: Date,
    
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  headApproval: {
    decision: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    businessDecisions: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },

  paymentMethod: {
    type: String,
    enum: ['bank', 'cash'],
    default: 'cash'
  },

  purchaseType: {
    type: String,
    enum: ['opex', 'capex', 'standard', 'emergency'],
    default: 'standard'
  },

  pettyCashForm: {
    generated: {
      type: Boolean,
      default: false
    },
    formNumber: String,
    generatedDate: Date,
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending_disbursement', 'disbursed', 'receipts_submitted', 'completed'],
      default: 'pending_disbursement'
    },
    changeReturned: {
      type: Number,
      default: 0
    },
    receipts: [{
      name: String,
      url: String,
      publicId: String,
      localPath: String,
      uploadedAt: Date,
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    downloadHistory: [{
      downloadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      downloadedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },

  // ✅ SINGLE disbursements definition with ALL fields including acknowledgment
  disbursements: [{
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    date: {
      type: Date,
      default: Date.now
    },
    disbursedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    notes: String,
    disbursementNumber: {
      type: Number,
      required: true
    },
    
    // Acknowledgment fields
    acknowledged: {
      type: Boolean,
      default: false
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    acknowledgmentDate: Date,
    acknowledgmentNotes: String,
    acknowledgmentMethod: {
      type: String,
      enum: ['cash', 'bank_transfer', 'cheque', 'mobile_money'],
      default: 'cash'
    }
  }],
  
  totalDisbursed: {
    type: Number,
    default: 0,
    min: 0
  },
  
  remainingBalance: {
    type: Number,
    min: 0
  },

  procurementDetails: {
    procurementDate: Date,
    assignedOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    vendors: [{
      name: String,
      quotationReceived: Boolean,
      amount: Number
    }],
    selectedVendor: String,
    finalCost: Number,
    deliveryDate: Date,
    deliveryStatus: {
      type: String,
      enum: ['pending', 'in_transit', 'delivered', 'delayed'],
      default: 'pending'
    }
  },

  justification: {
    actualExpenses: [{
      description: {
        type: String,
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      category: {
        type: String,
        required: true
      },
      date: {
        type: Date,
        default: Date.now
      }
    }],
    totalSpent: {
      type: Number,
      min: 0
    },
    changeReturned: {
      type: Number,
      default: 0,
      min: 0
    },
    justificationSummary: String,
    receipts: [{
      name: String,
      publicId: String,
      url: String,
      localPath: String,
      size: Number,
      mimetype: String,
      uploadedAt: Date,
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    submittedDate: Date,
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: [
        'pending_supervisor',
        'pending_finance',
        'pending_supply_chain',
        'pending_head',
        'approved',
        'rejected'
      ],
      default: 'pending_supervisor'
    },
    supervisorReview: {
      decision: {
        type: String,
        enum: ['approved', 'rejected']
      },
      comments: String,
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reviewedDate: Date
    },
    financeReview: {
      decision: {
        type: String,
        enum: ['approved', 'rejected']
      },
      comments: String,
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reviewedDate: Date
    },
    supplyChainReview: {
      decision: {
        type: String,
        enum: ['approved', 'rejected']
      },
      comments: String,
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reviewedDate: Date
    },
    headReview: {
      decision: {
        type: String,
        enum: ['approved', 'rejected']
      },
      comments: String,
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reviewedDate: Date
    }
  },

  // ✅ NEW: Clarification Requests - tracks requests for more information
  clarificationRequests: [{
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    requesterName: String,
    requesterRole: String,
    requesterLevel: Number,
    requestedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    recipientName: String,
    recipientRole: String,
    recipientLevel: Number,
    message: String,
    requestedAt: {
      type: Date,
      default: Date.now
    },
    response: String,
    respondedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'responded'],
      default: 'pending'
    }
  }],

  // ✅ NEW: Rejection History - preserves all rejection details for audit trail
  rejectionHistory: [{
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    rejectorName: String,
    rejectorRole: String,
    rejectionDate: {
      type: Date,
      required: true,
      default: Date.now
    },
    rejectionReason: String,
    approvalLevel: String,
    previousStatus: String,
    approvalChainSnapshot: [{
      level: Number,
      approver: {
        name: String,
        email: String,
        role: String
      },
      status: String,
      comments: String,
      actionDate: Date
    }],
    resubmitted: {
      type: Boolean,
      default: false
    },
    resubmittedDate: Date,
    resubmissionNotes: String
  }],

  cancellationRequest: {
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String,
    requestedAt: Date,
    previousStatus: String,
    approvalChain: [{
      level: Number,
      approver: {
        name: String,
        email: String,
        role: String,
        department: String
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      comments: String,
      actionDate: Date,
      decidedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    finalDecision: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    finalizedAt: Date
  },

  // ✅ NEW: Tracks if this is a resubmission
  isResubmission: {
    type: Boolean,
    default: false
  },

  resubmissionCount: {
    type: Number,
    default: 0
  },

  lastResubmittedDate: Date,

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

// Indexes
PurchaseRequisitionSchema.index({ employee: 1, status: 1 });
PurchaseRequisitionSchema.index({ requisitionNumber: 1 });
PurchaseRequisitionSchema.index({ 'approvalChain.approver.email': 1 });
PurchaseRequisitionSchema.index({ status: 1, createdAt: -1 });
PurchaseRequisitionSchema.index({ 'supplyChainReview.assignedBuyer': 1 });
PurchaseRequisitionSchema.index({ project: 1 });
PurchaseRequisitionSchema.index({ supplierId: 1 });
PurchaseRequisitionSchema.index({ budgetCode: 1 });
PurchaseRequisitionSchema.index({ 'budgetCodeInfo.code': 1 });
PurchaseRequisitionSchema.index({ 'financeVerification.decision': 1 });

// Virtuals
PurchaseRequisitionSchema.virtual('isFinanceVerified').get(function() {
  return this.financeVerification?.decision === 'approved';
});

PurchaseRequisitionSchema.virtual('budgetStatusAtSubmission').get(function() {
  if (!this.budgetCodeInfo) return null;
  
  const utilizationRate = this.budgetCodeInfo.availableAtSubmission > 0
    ? Math.round((this.budgetCodeInfo.submittedAmount / this.budgetCodeInfo.availableAtSubmission) * 100)
    : 0;
  
  return {
    code: this.budgetCodeInfo.code,
    name: this.budgetCodeInfo.name,
    available: this.budgetCodeInfo.availableAtSubmission,
    requested: this.budgetCodeInfo.submittedAmount,
    remainingAfter: this.budgetCodeInfo.availableAtSubmission - this.budgetCodeInfo.submittedAmount,
    utilizationRate: utilizationRate
  };
});

PurchaseRequisitionSchema.virtual('hasBudgetAssignment').get(function() {
  return this.supplyChainReview?.budgetAssignedBySupplyChain || false;
});

PurchaseRequisitionSchema.virtual('budgetAssignmentInfo').get(function() {
  if (!this.supplyChainReview?.budgetAssignedBySupplyChain) {
    return {
      assigned: false,
      source: 'employee'
    };
  }

  return {
    assigned: true,
    source: 'supply_chain',
    assignedBudget: this.supplyChainReview.assignedBudget,
    previousBudget: this.supplyChainReview.previousBudget,
    assignedAt: this.supplyChainReview.budgetAssignedAt,
    reason: this.supplyChainReview.budgetAssignmentReason
  };
});

PurchaseRequisitionSchema.virtual('displayId').get(function() {
  return `REQ-${this.requisitionNumber}`;
});

// Methods
PurchaseRequisitionSchema.methods.getFinalBudget = function() {
  if (this.supplyChainReview?.budgetAssignedBySupplyChain && this.supplyChainReview.assignedBudget) {
    return this.supplyChainReview.assignedBudget;
  }
  return this.budgetXAF || 0;
};

PurchaseRequisitionSchema.methods.validateBudgetAvailability = async function() {
  const BudgetCode = require('./BudgetCode');
  const budgetCode = await BudgetCode.findById(this.budgetCode);
  
  if (!budgetCode) {
    return {
      valid: false,
      message: 'Budget code no longer exists'
    };
  }
  
  if (!budgetCode.active || budgetCode.status !== 'active') {
    return {
      valid: false,
      message: 'Budget code is no longer active'
    };
  }
  
  const available = budgetCode.budget - budgetCode.used;
  const required = this.budgetXAF || 0;
  
  if (available < required) {
    return {
      valid: false,
      message: `Insufficient budget. Available: XAF ${available.toLocaleString()}, Required: XAF ${required.toLocaleString()}`,
      available,
      required
    };
  }
  
  return {
    valid: true,
    available,
    required,
    remainingAfter: available - required
  };
};

PurchaseRequisitionSchema.methods.needsBudgetAssignment = function() {
  return !this.budgetXAF || this.budgetXAF === 0;
};

PurchaseRequisitionSchema.methods.generatePettyCashFormNumber = async function() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  
  const count = await this.constructor.countDocuments({
    'pettyCashForm.generated': true,
    'pettyCashForm.generatedDate': {
      $gte: new Date(year, date.getMonth(), 1),
      $lt: new Date(year, date.getMonth() + 1, 1)
    }
  });
  
  const formNumber = `PCF-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  
  this.pettyCashForm = {
    ...this.pettyCashForm,
    generated: true,
    formNumber: formNumber,
    generatedDate: new Date(),
    status: 'pending_disbursement'
  };
  
  return formNumber;
};

PurchaseRequisitionSchema.methods.getCurrentApprover = function() {
  if (!this.approvalChain || this.approvalChain.length === 0) return null;
  return this.approvalChain.find(step => step.status === 'pending');
};

PurchaseRequisitionSchema.methods.canUserApprove = function(userEmail) {
  const currentStep = this.getCurrentApprover();
  if (!currentStep) return false;
  
  return currentStep.approver.email.toLowerCase() === userEmail.toLowerCase();
};

// Pre-save middleware
PurchaseRequisitionSchema.pre('save', function(next) {
  if (this.supplyChainReview?.budgetAssignedBySupplyChain && 
      this.supplyChainReview.assignedBudget) {
    this.budgetXAF = this.supplyChainReview.assignedBudget;
  }
  
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('PurchaseRequisition', PurchaseRequisitionSchema);




