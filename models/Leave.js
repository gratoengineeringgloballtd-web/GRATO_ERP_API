const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const leaveSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Leave Classification
  leaveCategory: {
    type: String,
    enum: [
      'medical',        
      'vacation',         
      'emergency',      
      'family',         
      'bereavement',    
      'study'         
    ],
    required: true
  },

  leaveType: {
    type: String,
    enum: [
      // Medical leaves
      'sick_leave',
      'medical_appointment', 
      'medical_procedure',
      'recovery_leave',
      
      // Vacation/Personal leaves
      'annual_leave',
      
      // Emergency/Bereavement
      'emergency_leave',
      'bereavement_leave',
      'funeral_leave',
      'disaster_leave',
      
      // Study/Development
      'study_leave',
      'training_leave',
      'conference_leave',
      'examination_leave',
      
      // Other
      'other'
    ],
    required: true
  },

  // Leave Details
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  totalDays: {
    type: Number,
    required: true,
    min: 0.5
  },
  isPartialDay: {
    type: Boolean,
    default: false
  },
  partialStartTime: String,
  partialEndTime: String,

  // Priority and Urgency
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  priority: {
    type: String,
    enum: ['routine', 'important', 'urgent', 'critical'],
    default: 'routine'
  },

  // Leave Details
  reason: {
    type: String,
    required: true,
    minlength: 10
  },
  description: {
    type: String,
    maxlength: 1000
  },

  // Supporting Documents (UNIVERSAL - for all leave types)
  supportingDocuments: [{
    name: String,
    url: String,
    publicId: String,
    size: Number,
    mimetype: String,
    uploadedAt: Date,
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending'
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    verificationDate: Date
  }],

  // Emergency Contact
  emergencyContact: {
    name: String,
    phone: String,
    relationship: {
      type: String,
      enum: ['spouse', 'parent', 'sibling', 'child', 'friend', 'other']
    },
    address: String
  },

  // Work Coverage
  workCoverage: String,
  delegatedTo: [{
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    responsibilities: String,
    contactInfo: String
  }],
  returnToWorkPlan: String,
  additionalNotes: String,

  // Leave Status
  status: {
    type: String,
    enum: [
      'draft',
      'pending_supervisor',
      'pending_departmental_head',
      'pending_head_of_business',
      'pending_hr_approval',
      'pending_documents', 
      'approved',
      'rejected',
      'cancelled',
      'completed',
      'in_progress'
    ],
    default: 'draft'
  },

  // Approval Workflow
  approvalChain: [{
    level: {
      type: Number,
      required: true
    },
    approver: {
      name: { 
        type: String, 
        required: true 
      },
      email: { 
        type: String, 
        required: true 
      },
      role: { 
        type: String, 
        required: true 
      },
      department: { 
        type: String, 
        required: true 
      },
      userId: {  
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'bypassed', 'escalated'],
      default: 'pending'
    },
    comments: String,
    assignedDate: Date,
    actionDate: Date,
    actionTime: String,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    bypassedBy: {
      name: String,
      email: String,
      role: String,
      userId: mongoose.Schema.Types.ObjectId
    },
    bypassDate: Date,
    bypassReason: String,
    escalatedBy: {
      name: String,
      email: String,
      role: String,
      userId: mongoose.Schema.Types.ObjectId
    },
    escalatedDate: Date,
    escalationReason: String,
    isEscalated: {
      type: Boolean,
      default: false
    },
    escalatedFrom: String,
    isEmergencyOverride: {
      type: Boolean,
      default: false
    },
    isDirectApproval: {
      type: Boolean,
      default: false
    }
  }],

  // Decision Records
  supervisorDecision: {
    decision: {
      type: String,
      enum: ['approved', 'rejected']
    },
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  departmentHeadDecision: {
    decision: {
      type: String,
      enum: ['approved', 'rejected']
    },
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  presidentDecision: {
    decision: {
      type: String,
      enum: ['approved', 'rejected']
    },
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // HR Review (FINAL APPROVAL with enhanced checks)
  hrReview: {
    decision: {
      type: String,
      enum: ['approved', 'rejected', 'request_documents']
    },
    comments: String,
    
    // Leave balance verification
    leaveBalanceChecked: {
      type: Boolean,
      default: false
    },
    balanceCheckResult: {
      sufficient: Boolean,
      availableDays: Number,
      requestedDays: Number
    },
    
    // Policy compliance
    policyCompliant: {
      type: Boolean,
      default: true
    },
    policyIssues: [String],
    
    // Document requests
    documentsRequested: {
      type: Boolean,
      default: false
    },
    requestedDocuments: [String],
    documentsRequestDate: Date,
    
    // Payroll notification
    payrollNotified: {
      type: Boolean,
      default: false
    },
    payrollNotificationDate: Date,
    
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewNotes: String
  },

  // Leave Balance Impact
  leaveBalance: {
    previousBalance: Number,
    daysDeducted: Number,
    remainingBalance: Number,
    balanceType: {
      type: String,
      enum: ['vacation', 'medical', 'personal', 'emergency', 'family', 'bereavement', 'study', 'unpaid'],
      default: 'vacation'
    },
    balanceYear: Number
  },

  // Tracking Information
  submittedBy: String,
  submittedAt: Date,
  lastModified: Date,

  // System Information
  leaveNumber: {
    type: String,
    unique: true
  },
  fiscalYear: Number

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
leaveSchema.index({ employee: 1, createdAt: -1 });
leaveSchema.index({ status: 1 });
leaveSchema.index({ leaveCategory: 1, leaveType: 1 });
leaveSchema.index({ startDate: 1, endDate: 1 });
leaveSchema.index({ 'approvalChain.approver.email': 1 });
leaveSchema.index({ fiscalYear: 1 });
leaveSchema.index({ leaveNumber: 1 });

// Virtual for display ID
leaveSchema.virtual('displayId').get(function() {
  const categoryCode = {
    'medical': 'MED',
    'vacation': 'VAC', 
    'emergency': 'EMG',
    'family': 'FAM',
    'bereavement': 'BER',
    'study': 'STU'
  };
  
  const code = categoryCode[this.leaveCategory] || 'LEA';
  return `${code}-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Static method to calculate leave balance
leaveSchema.statics.calculateLeaveBalance = async function(employeeId, leaveCategory = 'vacation', fiscalYear = new Date().getFullYear()) {
  const defaultBalances = {
    'vacation': 21,
    'medical': 10,
    'personal': 5,
    'emergency': 3,
    'family': 12,
    'bereavement': 5,
    'study': 10,
    'maternity': 90,
    'paternity': 14,
    'compensatory': 0,
    'sabbatical': 0,
    'unpaid': 0
  };

  const totalDays = defaultBalances[leaveCategory] || 0;

  const usedLeaves = await this.find({
    employee: employeeId,
    leaveCategory: leaveCategory,
    status: { $in: ['approved', 'completed', 'in_progress'] },
    fiscalYear: fiscalYear
  });

  const pendingLeaves = await this.find({
    employee: employeeId,
    leaveCategory: leaveCategory,
    status: { 
      $in: [
        'pending_supervisor', 
        'pending_departmental_head', 
        'pending_head_of_business', 
        'pending_hr_approval'
      ] 
    },
    fiscalYear: fiscalYear
  });

  const usedDays = usedLeaves.reduce((sum, leave) => sum + leave.totalDays, 0);
  const pendingDays = pendingLeaves.reduce((sum, leave) => sum + leave.totalDays, 0);

  return {
    category: leaveCategory,
    totalDays,
    usedDays,
    pendingDays,
    remainingDays: totalDays - usedDays - pendingDays,
    fiscalYear: fiscalYear
  };
};

// Static method to calculate all leave balances
leaveSchema.statics.calculateAllLeaveBalances = async function(employeeId, fiscalYear = new Date().getFullYear()) {
  const categories = ['vacation', 'medical', 'personal', 'emergency', 'family', 'bereavement', 'study', 'maternity', 'paternity'];
  const balances = {};
  
  for (const category of categories) {
    balances[category] = await this.calculateLeaveBalance(employeeId, category, fiscalYear);
  }
  
  return balances;
};

// Add pagination plugin
leaveSchema.plugin(mongoosePaginate);

// Pre-save middleware to generate leave number
leaveSchema.pre('save', async function(next) {
  if (this.isNew && !this.leaveNumber) {
    const currentYear = new Date().getFullYear();
    const categoryCode = {
      'medical': 'MED',
      'vacation': 'VAC',
      'personal': 'PTO',
      'emergency': 'EMG',
      'family': 'FAM',
      'bereavement': 'BER',
      'study': 'STU',
      'maternity': 'MAT',
      'paternity': 'PAT',
      'compensatory': 'CMP',
      'sabbatical': 'SAB',
      'unpaid': 'UNP'
    };
    
    const code = categoryCode[this.leaveCategory] || 'LEA';
    const count = await this.constructor.countDocuments({
      leaveCategory: this.leaveCategory,
      fiscalYear: currentYear
    });
    
    this.leaveNumber = `${code}${currentYear}${String(count + 1).padStart(4, '0')}`;
    this.fiscalYear = currentYear;
  }
  
  this.lastModified = new Date();
  next();
});

module.exports = mongoose.model('Leave', leaveSchema);


