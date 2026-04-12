const mongoose = require('mongoose');

const CashRequestSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // ✅ NEW: Version control for approval flow
  approvalChainVersion: {
    type: Number,
    default: 2,  // Version 1 = old (4 levels), Version 2 = new (6 levels with HR)
    required: true
  },
  
  requestType: {
    type: String,
    enum: [
      'travel', 
      'office-supplies', 
      'client-entertainment', 
      'emergency', 
      'project-materials', 
      'training', 
      'expense',
      'accommodation',      
      'perdiem',           
      'utility',   
      'internet',          
      'staff-transportation', 
      'staff-entertainment',  
      'toll-gates',        
      'office-items',
      'mission',      
      'other'
    ],
    required: true
  },
  
  requestMode: {
    type: String,
    enum: ['advance', 'reimbursement'],
    default: 'advance',
    required: true
  },
  
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
    notes: {
      type: String,
      default: ''
    },
    disbursementNumber: {
      type: Number, 
      required: true
    },
    acknowledged: {
      type: Boolean,
      default: false
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    acknowledgmentDate: {
      type: Date
    },
    acknowledgmentNotes: {
      type: String,
      default: ''
    }
  }],

  totalDisbursed: {
    type: Number,
    default: 0,
    min: 0
  },

  remainingBalance: {
    type: Number,
    default: 0,
    min: 0
  },

  amountRequested: {
    type: Number,
    required: true,
    min: [0, 'Amount must be greater than 0'],
    validate: {
      validator: function(value) {
        if (this.requestMode === 'reimbursement') {
          return value <= 100000;
        }
        return value > 0 && value <= 999999999;
      },
      message: function(props) {
        if (props.instance.requestMode === 'reimbursement') {
          return `Reimbursement amount cannot exceed XAF 100,000. Requested: XAF ${props.value.toLocaleString()}`;
        }
        return `Amount must be between XAF 1 and XAF 999,999,999. Requested: XAF ${props.value.toLocaleString()}`;
      }
    }
  },

  // New fields for reimbursement scenario
  advanceReceived: {
    type: Number,
    min: 0,
    default: 0,
    required: function() { return this.requestMode === 'reimbursement'; }
  },
  amountSpent: {
    type: Number,
    min: 0,
    default: 0,
    required: function() { return this.requestMode === 'reimbursement'; }
  },
  
  amountApproved: {
    type: Number,
    min: 0
  },
  
  purpose: {
    type: String,
    required: false,
    trim: true
  },
  
  businessJustification: {
    type: String,
    required: false,
    default: ''
  },
  
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    required: true
  },
  
  requiredDate: {
    type: Date,
    required: true
  },
  
  projectCode: String,

  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null
  },

  budgetAllocation: {
    budgetCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BudgetCode'
    },
    budgetCode: {
      type: String
    },
    allocatedAmount: {
      type: Number,
      min: 0
    },
    actualSpent: {
      type: Number,
      min: 0,
      default: 0
    },
    balanceReturned: {
      type: Number,
      min: 0,
      default: 0
    },
    allocationStatus: {
      type: String,
      enum: ['pending', 'reserved', 'allocated', 'spent', 'released', 'refunded'],  // ✅ UPDATED
      default: 'pending'
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedAt: {
      type: Date
    }
  },

  approvalChain: [{
    level: {
      type: Number,
      required: true
    },
    approver: {
      name: { 
        type: String, 
        required: [true, 'Approver name is required'],
        trim: true
      },
      email: { 
        type: String, 
        required: [true, 'Approver email is required'],
        trim: true,
        lowercase: true,
        validate: {
          validator: function(v) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
          },
          message: props => `${props.value} is not a valid email address!`
        }
      },
      role: { 
        type: String, 
        required: [true, 'Approver role is required'],
        trim: true
      },
      department: { 
        type: String, 
        required: [true, 'Approver department is required'],
        trim: true
      }
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    comments: {
      type: String,
      default: ''
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

  justificationApprovalChain: [{
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
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    comments: String,
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

  status: {
    type: String,
    enum: [
      'pending_supervisor',           
      'pending_departmental_head',     
      'pending_hr',                           // ✅ NEW
      'pending_finance',              
      'pending_head_of_business',             // ✅ NEW (moved Finance before this)
      'approved',                     
      'denied',
      'partially_disbursed',          
      'fully_disbursed',              
      'justification_pending_supervisor',
      'justification_pending_departmental_head',
      'justification_pending_hr',             // ✅ NEW
      'justification_pending_finance',
      'justification_rejected_supervisor',
      'justification_rejected_departmental_head',
      'justification_rejected_hr',            // ✅ NEW
      'justification_rejected_finance',
      'completed'
    ],
    default: 'pending_supervisor'
  },

  // Legacy fields maintained for backward compatibility
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  supervisorDecision: {
    decision: String,
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  financeDecision: {
    decision: String,
    comments: String,
    decisionDate: Date
  },
  financeOfficer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  disbursementDetails: {
    date: Date,
    amount: Number,
    disbursedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  justification: {
    amountSpent: {
      type: Number,
      min: 0
    },
    balanceReturned: {
      type: Number,
      min: 0
    },
    details: String,
    documents: [{
      name: String,
      url: String,
      publicId: String,
      localPath: String,
      size: Number,
      mimetype: String,
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }],
    justificationDate: Date,
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    itemizedBreakdown: [{
      description: {
        type: String,
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      category: String
    }]
  },

  justificationApproval: {
    submittedDate: Date,
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  attachments: [{
    name: String,
    url: String,
    publicId: String,
    localPath: String, 
    size: Number,
    mimetype: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],

  itemizedBreakdown: [{
    description: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    category: String 
  }],

  pdfDownloadHistory: [{
    downloadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    downloadedAt: {
      type: Date,
      default: Date.now
    },
    filename: String
  }],

  reimbursementDetails: {
    amountSpent: {
      type: Number,
      min: 0
    },
    receiptDocuments: [{
      name: String,
      url: String,
      publicId: String,
      size: Number,
      mimetype: String,
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }],
    itemizedBreakdown: [{
      description: {
        type: String,
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      category: String,
      receiptReference: String
    }],
    submittedDate: {
      type: Date,
      default: Date.now
    },
    receiptVerified: {
      type: Boolean,
      default: false
    }
  },

  editHistory: [{
    editedAt: {
      type: Date,
      default: Date.now
    },
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    changes: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    reason: {
      type: String,
      default: ''
    },
    previousStatus: String,
    editNumber: Number
  }],

  isEdited: {
    type: Boolean,
    default: false
  },

  totalEdits: {
    type: Number,
    default: 0
  },

  originalValues: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  accountingAudit: {
    isPosted: {
      type: Boolean,
      default: false
    },
    postedAt: Date,
    entryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry'
    },
    entryNumber: String,
    sourceType: {
      type: String,
      default: 'cash_request_disbursement'
    }
  },

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
CashRequestSchema.index({ employee: 1, status: 1 });
CashRequestSchema.index({ 'approvalChain.approver.email': 1, 'approvalChain.status': 1 });
CashRequestSchema.index({ status: 1, createdAt: -1 });
CashRequestSchema.index({ approvalChainVersion: 1 });  // ✅ NEW

// Virtuals
CashRequestSchema.virtual('displayId').get(function() {
  return `REQ-${this._id.toString().slice(-6).toUpperCase()}`;
});

CashRequestSchema.virtual('disbursementProgress').get(function() {
  if (!this.amountApproved || this.amountApproved === 0) return 0;
  return Math.round((this.totalDisbursed / this.amountApproved) * 100);
});

// Methods
CashRequestSchema.methods.getCurrentApprovalStep = function() {
  if (!this.approvalChain || this.approvalChain.length === 0) return null;
  return this.approvalChain.find(step => step.status === 'pending');
};

CashRequestSchema.methods.getApprovalProgress = function() {
  if (!this.approvalChain || this.approvalChain.length === 0) return 0;
  const approvedSteps = this.approvalChain.filter(step => step.status === 'approved').length;
  return Math.round((approvedSteps / this.approvalChain.length) * 100);
};

// Statics
CashRequestSchema.statics.checkMonthlyReimbursementLimit = async function(employeeId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const count = await this.countDocuments({
    employee: employeeId,
    requestMode: 'reimbursement',
    createdAt: { $gte: startOfMonth },
    status: { $ne: 'denied' }
  });

  return {
    count,
    limit: 5,
    remaining: Math.max(0, 5 - count),
    canSubmit: count < 5
  };
};

module.exports = mongoose.model('CashRequest', CashRequestSchema);



