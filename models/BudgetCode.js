const mongoose = require('mongoose');

const budgetCodeSchema = new mongoose.Schema({
  // Basic Information
  code: {
    type: String,
    required: [true, 'Budget code is required'],
    unique: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z0-9\-_]+$/, 'Budget code can only contain uppercase letters, numbers, hyphens and underscores']
  },
  
  name: {
    type: String,
    required: [true, 'Budget name is required'],
    trim: true
  },
  
  description: {
    type: String,
    trim: true
  },

  // Budget Details
  budget: {
    type: Number,
    required: [true, 'Total budget amount is required'],
    min: [0, 'Budget cannot be negative']
  },
  
  used: {
    type: Number,
    default: 0,
    min: [0, 'Used amount cannot be negative']
  },

  department: {
    type: String,
    required: true,
    enum: ['Roll Out', 'Technical Roll Out', 'Operations', 'IT', 'Technical', 'Technical Operations', 'Technical Refurbishment', 'Technical QHSE', 'Finance', 'HR', 'Marketing', 'Supply Chain', 'Facilities', 'Business', 'CEO Office' ]
  },
  
  budgetType: {
    type: String,
    enum: ['OPEX', 'CAPEX', 'PROJECT', 'OPERATIONAL'],
    default: 'OPERATIONAL'
  },
  
  budgetPeriod: {
    type: String,
    required: [true, 'Budget period is required'],
    enum: ['monthly', 'quarterly', 'yearly', 'project']
  },

  // Budget Owner
  budgetOwner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Budget owner is required']
  },

  // Approval Workflow
  status: {
    type: String,
    enum: [
      'pending',
      'pending_departmental_head',
      'pending_head_of_business',
      'pending_finance',
      'active',
      'rejected',
      'suspended',
      'expired'
    ],
    default: 'pending'
  },

  approvalChain: [{
    level: {
      type: Number,
      required: true
    },
    approver: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      role: { type: String, required: true },
      department: { type: String }
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    assignedDate: {
      type: Date,
      default: Date.now
    },
    actionDate: Date,
    actionTime: String,
    comments: String
  }],


  allocations: [{
    requisitionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseRequisition'
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    allocatedDate: {
      type: Date,
      default: Date.now
    },
    allocatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['allocated', 'released', 'spent'],
      default: 'allocated'
    },
    // ✅ NEW: Track actual spending for partial disbursements
    actualSpent: {
      type: Number,
      default: 0,
      min: 0
    },
    // ✅ NEW: Track first disbursement date
    spentAt: {
      type: Date
    },
    // ✅ NEW: Track latest disbursement
    lastDisbursement: {
      type: Date
    },
    // ✅ NEW: Count number of disbursements
    disbursementCount: {
      type: Number,
      default: 0,
      min: 0
    },
    // ✅ NEW: Track returned funds
    balanceReturned: {
      type: Number,
      default: 0,
      min: 0
    },
    // ✅ NEW: Release tracking
    releaseDate: {
      type: Date
    },
    releaseReason: {
      type: String
    }
  }],


  transactions: [{
    type: {
      type: String,
      enum: ['reservation', 'deduction', 'return', 'release'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    requisitionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseRequisition'
    },
    description: {
      type: String
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    balanceBefore: {
      type: Number
    },
    balanceAfter: {
      type: Number
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],

  // Budget Revisions
  budgetRevisions: [{
    previousBudget: {
      type: Number,
      required: true
    },
    requestedBudget: {
      type: Number,
      required: true
    },
    changeAmount: {
      type: Number,
      required: true
    },
    reason: {
      type: String,
      required: true
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    requestDate: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    approvalChain: [{
      level: Number,
      approver: {
        name: String,
        email: String,
        role: String
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      actionDate: Date,
      actionTime: String,
      comments: String
    }],
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvalDate: Date,
    rejectionDate: Date,
    rejectionReason: String
  }],

  // Alert tracking
  criticalAlertSent: {
    type: Boolean,
    default: false
  },
  warningAlertSent: {
    type: Boolean,
    default: false
  },
  lastAlertDate: Date,

  // Performance tracking
  performanceMetrics: {
    averageMonthlySpend: {
      type: Number,
      default: 0
    },
    projectedExhaustionDate: Date,
    lastCalculated: Date
  },

  // Budget History
  budgetHistory: [{
    previousBudget: Number,
    newBudget: Number,
    changeAmount: Number,
    reason: String,
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    changeDate: {
      type: Date,
      default: Date.now
    }
  }],

  // Dates
  startDate: {
    type: Date,
    default: Date.now
  },
  
  endDate: {
    type: Date
  },

  fiscalYear: {
    type: Number,
    required: true,
    default: () => new Date().getFullYear()
  },

  // Status Management
  active: {
    type: Boolean,
    default: true
  },

  // Rejection Details
  rejectionReason: String,
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionDate: Date,

  // Creation & Modification
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  accountingLinks: [{
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
    entryNumber:    { type: String },
    amount:         { type: Number },
    sourceType:     { type: String },
    linkedAt:       { type: Date, default: Date.now }
  }],
}, {
  timestamps: true
});

// Virtual for remaining budget
budgetCodeSchema.virtual('remaining').get(function() {
  return this.budget - this.used;
});

// Virtual for utilization percentage
budgetCodeSchema.virtual('utilizationPercentage').get(function() {
  if (this.budget === 0) return 0;
  return Math.round((this.used / this.budget) * 100);
});

// Virtual for utilization rate (for detailed reporting)
budgetCodeSchema.virtual('utilizationRate').get(function() {
  if (this.budget === 0) return 0;
  return ((this.used / this.budget) * 100).toFixed(2);
});

// Virtual for budget status indicator (renamed from 'status' to avoid conflict)
budgetCodeSchema.virtual('utilizationStatus').get(function() {
  const utilization = this.utilizationPercentage;
  if (utilization >= 95) return 'critical';
  if (utilization >= 80) return 'warning';
  if (utilization >= 60) return 'moderate';
  return 'healthy';
});

// Ensure virtuals are included in JSON output
budgetCodeSchema.set('toJSON', { virtuals: true });
budgetCodeSchema.set('toObject', { virtuals: true });

// Indexes for performance
budgetCodeSchema.index({ code: 1 });
budgetCodeSchema.index({ status: 1 });
budgetCodeSchema.index({ department: 1 });
budgetCodeSchema.index({ budgetType: 1 });
budgetCodeSchema.index({ active: 1 });
budgetCodeSchema.index({ createdBy: 1 });
budgetCodeSchema.index({ 'approvalChain.approver.email': 1 });
budgetCodeSchema.index({ fiscalYear: 1 });

// INSTANCE METHODS

// Method: Check if budget can be allocated
budgetCodeSchema.methods.canAllocate = function(amount) {
  if (!this.active) {
    return false;
  }
  return this.remaining >= amount;
};

budgetCodeSchema.methods.allocateBudget = async function(requisitionId, amount, userId = null) {
  console.warn('⚠️  DEPRECATED: Use reserveBudget() instead of allocateBudget()');
  return this.reserveBudget(requisitionId, amount, userId);
};

// Method: Release allocated budget (e.g., if requisition is cancelled)
budgetCodeSchema.methods.releaseBudget = async function(requisitionId) {
  const allocation = this.allocations.find(
    a => a.requisitionId.toString() === requisitionId.toString() && a.status === 'allocated'
  );

  if (!allocation) {
    throw new Error('No active allocation found for this requisition');
  }

  // Update allocation status
  allocation.status = 'released';

  // Decrease used amount
  this.used -= allocation.amount;

  await this.save();
  return this;
};

// Method: Mark allocation as spent
budgetCodeSchema.methods.markAsSpent = async function(requisitionId) {
  const allocation = this.allocations.find(
    a => a.requisitionId.toString() === requisitionId.toString() && a.status === 'allocated'
  );

  if (!allocation) {
    throw new Error('No active allocation found for this requisition');
  }

  // Update allocation status
  allocation.status = 'spent';

  await this.save();
  return this;
};

// Method: Update budget amount
budgetCodeSchema.methods.updateBudget = async function(newAmount, reason, userId) {
  this.budgetHistory.push({
    previousBudget: this.budget,
    newBudget: newAmount,
    changeAmount: newAmount - this.budget,
    reason,
    changedBy: userId,
    changeDate: new Date()
  });

  this.budget = newAmount;
  this.lastModifiedBy = userId;
  
  await this.save();
  return this;
};

// STATIC METHODS

// Static: Get budget codes with availability for a department
budgetCodeSchema.statics.getAvailableForDepartment = function(department, minAvailable = 0) {
  return this.find({
    department: { $in: [department, 'General'] },
    active: true,
    $expr: { $gte: [{ $subtract: ['$budget', '$used'] }, minAvailable] }
  }).sort({ utilizationPercentage: 1 });
};

// Static: Get budget summary for fiscal year
budgetCodeSchema.statics.getFiscalYearSummary = async function(fiscalYear = new Date().getFullYear()) {
  const summary = await this.aggregate([
    {
      $match: {
        fiscalYear: fiscalYear,
        active: true
      }
    },
    {
      $group: {
        _id: '$department',
        totalBudget: { $sum: '$budget' },
        totalUsed: { $sum: '$used' },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        department: '$_id',
        totalBudget: 1,
        totalUsed: 1,
        remaining: { $subtract: ['$totalBudget', '$totalUsed'] },
        utilizationRate: {
          $multiply: [
            { $divide: ['$totalUsed', '$totalBudget'] },
            100
          ]
        },
        count: 1
      }
    },
    {
      $sort: { utilizationRate: -1 }
    }
  ]);

  return summary;
};

// Static: Get budget codes requiring attention (high utilization)
budgetCodeSchema.statics.getRequiringAttention = async function(threshold = 75) {
  const codes = await this.find({ active: true });
  
  return codes.filter(code => {
    const utilization = (code.used / code.budget) * 100;
    return utilization >= threshold;
  });
};


/**
 * PHASE 1: Reserve budget on approval (don't deduct yet)
 * Creates allocation with 'allocated' status
 */
budgetCodeSchema.methods.reserveBudget = async function(requestId, amount, userId = null) {
  if (amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  if (amount > this.remaining) {
    throw new Error(
      `Insufficient budget. Available: XAF ${this.remaining.toLocaleString()}, Required: XAF ${amount.toLocaleString()}`
    );
  }

  console.log(`\n💰 RESERVING Budget: ${this.code}`);
  console.log(`   Amount: XAF ${amount.toLocaleString()}`);
  console.log(`   Available: XAF ${this.remaining.toLocaleString()}`);

  // ✅ Check if already reserved
  const existingAllocationIndex = this.allocations.findIndex(
    a => a.requisitionId && a.requisitionId.toString() === requestId.toString()
  );

  if (existingAllocationIndex !== -1) {
    const existingAllocation = this.allocations[existingAllocationIndex];
    console.log(`   ⚠️  Existing allocation found: ${existingAllocation.status}`);
    
    // ✅ If it's already allocated with same amount, no need to do anything
    if (existingAllocation.status === 'allocated' && existingAllocation.amount === amount) {
      console.log(`   ℹ️  Already reserved with same amount\n`);
      return this;
    }
    
    // ✅ If it was released or spent, we can update it
    if (existingAllocation.status === 'released' || existingAllocation.status === 'spent') {
      console.log(`   🔄 Updating ${existingAllocation.status} allocation to allocated`);
      
      // Update the existing allocation
      this.allocations[existingAllocationIndex] = {
        requisitionId: requestId,
        amount: amount,
        allocatedBy: userId,
        allocatedDate: new Date(),
        status: 'allocated'
      };
      
      await this.save();
      console.log(`   ✅ Allocation updated successfully\n`);
      return this;
    }
  }

  // ✅ Create new reservation (DON'T update 'used' yet)
  console.log(`   Creating new allocation...`);
  
  this.allocations.push({
    requisitionId: requestId,
    amount: amount,
    allocatedBy: userId,
    allocatedDate: new Date(),
    status: 'allocated' // Reserved, not spent
  });

  await this.save();
  
  console.log(`   ✅ Budget reserved successfully`);
  console.log(`   New remaining: XAF ${this.remaining.toLocaleString()}\n`);
  
  return this;
};



// Replace the deductBudget method in models/BudgetCode.js

/**
 * PHASE 2: Deduct budget on actual disbursement
 * Supports multiple partial disbursements against a single allocation
 */
budgetCodeSchema.methods.deductBudget = async function(requisitionId, amount) {
  console.log(`\n💸 DEDUCTING Budget: ${this.code}`);
  console.log(`   Requisition: ${requisitionId}`);
  console.log(`   Amount to deduct: XAF ${amount.toLocaleString()}`);
  console.log(`   Current Used: XAF ${this.used.toLocaleString()}`);
  console.log(`   Current Remaining: XAF ${this.remaining.toLocaleString()}`);

  // ✅ Find allocation (can be 'allocated' or 'spent')
  const allocation = this.allocations.find(
    a => a.requisitionId?.toString() === requisitionId.toString() && 
         ['allocated', 'spent'].includes(a.status)
  );

  if (!allocation) {
    console.error(`   ❌ No allocation found for requisition ${requisitionId}`);
    throw new Error('No allocation found for this request. Budget may not have been reserved.');
  }

  console.log(`   ✓ Found allocation: XAF ${allocation.amount.toLocaleString()} (Status: ${allocation.status})`);

  // ✅ Track total amount disbursed so far for this allocation
  const previouslyDisbursed = allocation.actualSpent || 0;
  const newTotalDisbursed = previouslyDisbursed + parseFloat(amount);

  console.log(`   Previously disbursed: XAF ${previouslyDisbursed.toLocaleString()}`);
  console.log(`   New total disbursed: XAF ${newTotalDisbursed.toLocaleString()}`);

  // ✅ Check if total deductions would exceed allocated amount
  if (newTotalDisbursed > allocation.amount) {
    console.error(`   ❌ Total deductions (XAF ${newTotalDisbursed.toLocaleString()}) exceed allocated amount (XAF ${allocation.amount.toLocaleString()})`);
    throw new Error(
      `Cannot disburse XAF ${amount.toLocaleString()}. ` +
      `Already disbursed: XAF ${previouslyDisbursed.toLocaleString()}, ` +
      `Allocated: XAF ${allocation.amount.toLocaleString()}, ` +
      `Would exceed by: XAF ${(newTotalDisbursed - allocation.amount).toLocaleString()}`
    );
  }

  // ✅ Validate sufficient budget remaining
  if (this.remaining < parseFloat(amount)) {
    console.error(`   ❌ Insufficient budget. Remaining: XAF ${this.remaining.toLocaleString()}`);
    throw new Error(
      `Insufficient budget in ${this.code}. ` +
      `Available: XAF ${this.remaining.toLocaleString()}, ` +
      `Required: XAF ${amount.toLocaleString()}`
    );
  }

  // ✅ Update allocation tracking
  allocation.actualSpent = newTotalDisbursed;
  allocation.status = 'spent';
  
  if (!allocation.spentAt) {
    allocation.spentAt = new Date(); // First disbursement timestamp
  }
  allocation.lastDisbursement = new Date(); // Track latest disbursement

  // ✅ Update budget totals
  this.used += parseFloat(amount);

  // ✅ Initialize transactions array if needed
  if (!this.transactions) {
    this.transactions = [];
  }

  // ✅ Add transaction record
  this.transactions.push({
    type: 'deduction',
    amount: parseFloat(amount),
    requisitionId: requisitionId,
    description: `Disbursement for ${requisitionId} (${newTotalDisbursed === allocation.amount ? 'Full' : 'Partial'} payment #${allocation.disbursementCount || 1})`,
    performedBy: allocation.allocatedBy,
    balanceBefore: this.remaining + parseFloat(amount),
    balanceAfter: this.remaining,
    timestamp: new Date()
  });

  // ✅ Track disbursement count
  allocation.disbursementCount = (allocation.disbursementCount || 0) + 1;

  await this.save();

  console.log(`   ✅ Budget deducted successfully`);
  console.log(`   Allocation progress: XAF ${allocation.actualSpent.toLocaleString()} / ${allocation.amount.toLocaleString()} (${Math.round((allocation.actualSpent / allocation.amount) * 100)}%)`);
  console.log(`   Total disbursements: ${allocation.disbursementCount}`);
  console.log(`   New Budget Used: XAF ${this.used.toLocaleString()}`);
  console.log(`   New Budget Remaining: XAF ${this.remaining.toLocaleString()}\n`);

  return this;
};



/**
 * PHASE 3: Return unused funds after justification
 * Reduces 'used' field, increases 'remaining' automatically
 */
budgetCodeSchema.methods.returnUnusedFunds = async function(requestId, returnAmount) {
  console.log(`\n💵 RETURNING Unused Funds: ${this.code}`);
  console.log(`   Amount to return: XAF ${returnAmount.toLocaleString()}`);

  if (returnAmount <= 0) {
    console.log(`   ℹ️  No funds to return`);
    return this;
  }

  const allocation = this.allocations.find(
    a => a.requisitionId && a.requisitionId.toString() === requestId.toString() && a.status === 'spent'
  );

  if (!allocation) {
    throw new Error('No spent allocation found for this request');
  }

  // Reduce used amount (increases remaining automatically via virtual)
  this.used -= returnAmount;
  allocation.balanceReturned = returnAmount;
  allocation.actualSpent = (allocation.actualSpent || allocation.amount) - returnAmount;

  await this.save();
  console.log(`   ✅ Funds returned successfully`);
  console.log(`   Total used: XAF ${this.used.toLocaleString()}`);
  console.log(`   Remaining: XAF ${this.remaining.toLocaleString()}\n`);
  
  return this;
};

/**
 * UTILITY: Release stale reservations (approved but not disbursed)
 * Called by scheduled job or manually by finance
 */
budgetCodeSchema.methods.releaseStaleReservations = async function(daysThreshold = 30) {
  console.log(`\n🧹 RELEASING Stale Reservations: ${this.code}`);
  
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - daysThreshold);

  let releasedCount = 0;
  let releasedAmount = 0;

  this.allocations = this.allocations.map(allocation => {
    if (
      allocation.status === 'allocated' &&
      allocation.allocatedDate < thresholdDate
    ) {
      console.log(`   Releasing: ${allocation.requisitionId} - XAF ${allocation.amount.toLocaleString()}`);
      releasedCount++;
      releasedAmount += allocation.amount;
      allocation.status = 'released';
      allocation.releaseDate = new Date();
      allocation.releaseReason = `Auto-released after ${daysThreshold} days`;
    }
    return allocation;
  });

  if (releasedCount > 0) {
    await this.save();
    console.log(`   ✅ Released ${releasedCount} reservation(s), XAF ${releasedAmount.toLocaleString()}\n`);
  } else {
    console.log(`   ℹ️  No stale reservations found\n`);
  }

  return { releasedCount, releasedAmount };
};

/**
 * UTILITY: Manually release a specific reservation
 * Used when request is cancelled or denied
 */
budgetCodeSchema.methods.releaseReservation = async function(requestId, reason = 'Cancelled') {
  console.log(`\n🔓 MANUALLY RELEASING Reservation: ${this.code}`);

  const allocation = this.allocations.find(
    a => a.requisitionId && a.requisitionId.toString() === requestId.toString() && a.status === 'allocated'
  );

  if (!allocation) {
    console.log(`   ⚠️  No active reservation found\n`);
    return this;
  }

  console.log(`   Releasing: XAF ${allocation.amount.toLocaleString()}`);
  allocation.status = 'released';
  allocation.releaseDate = new Date();
  allocation.releaseReason = reason;

  await this.save();
  console.log(`   ✅ Reservation released\n`);
  
  return this;
};


// Request budget increase
budgetCodeSchema.methods.requestBudgetRevision = async function(
  newAmount,
  reason,
  requestedBy
) {
  console.log('\n💰 REQUESTING Budget Revision:', this.code);
  console.log(`   Current: XAF ${this.budget.toLocaleString()}`);
  console.log(`   Requested: XAF ${newAmount.toLocaleString()}`);
  console.log(`   Change: XAF ${(newAmount - this.budget).toLocaleString()}`);

  if (newAmount <= 0) {
    throw new Error('Requested budget must be greater than zero');
  }

  if (newAmount === this.budget) {
    throw new Error('Requested budget is the same as current budget');
  }

  // Get user details
  const User = mongoose.model('User');
  const user = await User.findById(requestedBy);
  
  if (!user) {
    throw new Error('User not found');
  }

  // Generate approval chain for revision
  const { getBudgetCodeApprovalChain } = require('../config/budgetCodeApprovalChain');
  const approvalChain = getBudgetCodeApprovalChain(
    user.fullName,
    this.department,
    'revision'
  );

  const revision = {
    previousBudget: this.budget,
    requestedBudget: newAmount,
    changeAmount: newAmount - this.budget,
    reason,
    requestedBy,
    requestDate: new Date(),
    status: 'pending',
    approvalChain
  };

  this.budgetRevisions.push(revision);
  await this.save();

  console.log(`   ✅ Revision requested, awaiting approval\n`);

  // Send notification to first approver
  const { sendEmail } = require('../services/emailService');
  const firstApprover = approvalChain[0].approver;
  
  await sendEmail({
    to: firstApprover.email,
    subject: `Budget Revision Approval Required: ${this.code}`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Budget Revision Approval Required</h2>
        <p>Dear ${firstApprover.name},</p>
        <p>A budget revision has been requested for budget code <strong>${this.code}</strong>:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Budget Code:</strong> ${this.code} - ${this.name}</p>
          <p><strong>Current Budget:</strong> XAF ${this.budget.toLocaleString()}</p>
          <p><strong>Requested Budget:</strong> XAF ${newAmount.toLocaleString()}</p>
          <p><strong>Change:</strong> XAF ${Math.abs(newAmount - this.budget).toLocaleString()} 
             ${newAmount > this.budget ? '(Increase)' : '(Decrease)'}</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Requested By:</strong> ${user.fullName}</p>
        </div>

        <p style="text-align: center;">
          <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/finance/budget-codes/${this._id}/revisions" 
             style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Review Revision Request
          </a>
        </p>
      </div>
    `
  });

  return this.budgetRevisions[this.budgetRevisions.length - 1];
};

// Approve budget revision
budgetCodeSchema.methods.approveBudgetRevision = async function(
  revisionId,
  approverId,
  comments = ''
) {
  console.log('\n✅ APPROVING Budget Revision:', this.code);

  const revision = this.budgetRevisions.id(revisionId);
  
  if (!revision) {
    throw new Error('Revision not found');
  }

  if (revision.status !== 'pending') {
    throw new Error(`Revision is already ${revision.status}`);
  }

  // Find current approval step
  const currentStep = revision.approvalChain.find(step => step.status === 'pending');
  
  if (!currentStep) {
    throw new Error('No pending approval step found');
  }

  // Get approver details
  const User = mongoose.model('User');
  const approver = await User.findById(approverId);

  if (!approver) {
    throw new Error('Approver not found');
  }

  // Validate approver
  if (approver.email !== currentStep.approver.email) {
    throw new Error('You are not authorized to approve at this level');
  }

  // Update current step
  currentStep.status = 'approved';
  currentStep.actionDate = new Date();
  currentStep.actionTime = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  currentStep.comments = comments;

  console.log(`   Approved by: ${approver.fullName} (Level ${currentStep.level})`);

  // Check if this is the final approval
  const nextStepIndex = revision.approvalChain.findIndex(
    step => step.level === currentStep.level + 1
  );

  if (nextStepIndex === -1) {
    // Final approval - apply the budget change
    console.log('   🎉 Final approval - applying budget change');

    revision.status = 'approved';
    revision.approvedBy = approverId;
    revision.approvalDate = new Date();

    // Add to budget history
    this.budgetHistory.push({
      previousBudget: this.budget,
      newBudget: revision.requestedBudget,
      changeAmount: revision.changeAmount,
      reason: `Budget revision: ${revision.reason}`,
      changedBy: approverId,
      changeDate: new Date()
    });

    // Apply the change
    const oldBudget = this.budget;
    this.budget = revision.requestedBudget;

    console.log(`   Previous: XAF ${oldBudget.toLocaleString()}`);
    console.log(`   New: XAF ${this.budget.toLocaleString()}`);

    await this.save();

    // Notify requester of approval
    const requester = await User.findById(revision.requestedBy);
    const { sendEmail } = require('../services/emailService');
    
    await sendEmail({
      to: requester.email,
      subject: `Budget Revision Approved: ${this.code}`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2 style="color: #52c41a;">Budget Revision Approved</h2>
          <p>Dear ${requester.fullName},</p>
          <p>Your budget revision request has been approved:</p>
          
          <div style="background-color: #f6ffed; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #52c41a;">
            <p><strong>Budget Code:</strong> ${this.code}</p>
            <p><strong>Previous Budget:</strong> XAF ${oldBudget.toLocaleString()}</p>
            <p><strong>New Budget:</strong> XAF ${this.budget.toLocaleString()}</p>
            <p><strong>Change:</strong> XAF ${Math.abs(revision.changeAmount).toLocaleString()} 
               ${revision.changeAmount > 0 ? '(Increase)' : '(Decrease)'}</p>
          </div>

          <p>The budget has been updated and is now effective.</p>
        </div>
      `
    });

    console.log('   ✅ Budget revision completed\n');
  } else {
    // Move to next approval level
    const nextStep = revision.approvalChain[nextStepIndex];
    console.log(`   ⏭️  Moving to next level: ${nextStep.approver.name}`);

    await this.save();

    // Notify next approver
    const { sendEmail } = require('../services/emailService');
    
    await sendEmail({
      to: nextStep.approver.email,
      subject: `Budget Revision Approval Required: ${this.code}`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Budget Revision Approval Required</h2>
          <p>Dear ${nextStep.approver.name},</p>
          <p>A budget revision for <strong>${this.code}</strong> requires your approval:</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Budget Code:</strong> ${this.code} - ${this.name}</p>
            <p><strong>Current Budget:</strong> XAF ${this.budget.toLocaleString()}</p>
            <p><strong>Requested Budget:</strong> XAF ${revision.requestedBudget.toLocaleString()}</p>
            <p><strong>Change:</strong> XAF ${Math.abs(revision.changeAmount).toLocaleString()} 
               ${revision.changeAmount > 0 ? '(Increase)' : '(Decrease)'}</p>
            <p><strong>Reason:</strong> ${revision.reason}</p>
          </div>

          <p><strong>Previous Approval:</strong> ${approver.fullName} (${currentStep.approver.role})</p>
          ${comments ? `<p><strong>Comments:</strong> ${comments}</p>` : ''}

          <p style="text-align: center;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/finance/budget-codes/${this._id}/revisions" 
               style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Review Revision Request
            </a>
          </p>
        </div>
      `
    });

    console.log('   ✅ Moved to next approval level\n');
  }

  return revision;
};


budgetCodeSchema.methods.rejectBudgetRevision = async function(
  revisionId,
  rejectorId,
  rejectionReason
) {
  console.log('\n❌ REJECTING Budget Revision:', this.code);

  const revision = this.budgetRevisions.id(revisionId);
  
  if (!revision) {
    throw new Error('Revision not found');
  }

  if (revision.status !== 'pending') {
    throw new Error(`Revision is already ${revision.status}`);
  }

  // Get rejector details
  const User = mongoose.model('User');
  const rejector = await User.findById(rejectorId);

  if (!rejector) {
    throw new Error('Rejector not found');
  }

  // Find current step and update
  const currentStep = revision.approvalChain.find(step => step.status === 'pending');
  
  if (currentStep) {
    currentStep.status = 'rejected';
    currentStep.actionDate = new Date();
    currentStep.actionTime = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    currentStep.comments = rejectionReason;
  }

  revision.status = 'rejected';
  revision.rejectedBy = rejectorId;
  revision.rejectionDate = new Date();
  revision.rejectionReason = rejectionReason;

  await this.save();

  console.log(`   Rejected by: ${rejector.fullName}`);
  console.log(`   Reason: ${rejectionReason}\n`);

  // Notify requester
  const requester = await User.findById(revision.requestedBy);
  const { sendEmail } = require('../services/emailService');
  
  await sendEmail({
    to: requester.email,
    subject: `Budget Revision Rejected: ${this.code}`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2 style="color: #ff4d4f;">Budget Revision Rejected</h2>
        <p>Dear ${requester.fullName},</p>
        <p>Your budget revision request has been rejected:</p>
        
        <div style="background-color: #fff2f0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ff4d4f;">
          <p><strong>Budget Code:</strong> ${this.code}</p>
          <p><strong>Requested Change:</strong> XAF ${Math.abs(revision.changeAmount).toLocaleString()} 
             ${revision.changeAmount > 0 ? '(Increase)' : '(Decrease)'}</p>
          <p><strong>Rejected By:</strong> ${rejector.fullName}</p>
          <p><strong>Reason:</strong> ${rejectionReason}</p>
        </div>

        <p>You may submit a new revision request with additional justification if needed.</p>
      </div>
    `
  });

  return revision;
};


budgetCodeSchema.methods.updatePerformanceMetrics = async function() {
  const spentAllocations = this.allocations.filter(a => a.status === 'spent');
  
  if (spentAllocations.length === 0) {
    return;
  }

  // Group by month
  const monthlySpend = {};
  spentAllocations.forEach(alloc => {
    const month = new Date(alloc.allocatedDate).toISOString().slice(0, 7);
    if (!monthlySpend[month]) monthlySpend[month] = 0;
    monthlySpend[month] += alloc.amount;
  });

  // Calculate average
  const spendArray = Object.values(monthlySpend);
  const averageMonthlySpend = spendArray.reduce((a, b) => a + b, 0) / spendArray.length;

  this.performanceMetrics.averageMonthlySpend = averageMonthlySpend;

  // Project exhaustion date
  if (averageMonthlySpend > 0 && this.remaining > 0) {
    const monthsRemaining = this.remaining / averageMonthlySpend;
    const exhaustionDate = new Date();
    exhaustionDate.setMonth(exhaustionDate.getMonth() + Math.floor(monthsRemaining));
    this.performanceMetrics.projectedExhaustionDate = exhaustionDate;
  }

  this.performanceMetrics.lastCalculated = new Date();
  await this.save();
};

/**
 * Reset alert flags (called when budget increased or utilization decreases)
 */
budgetCodeSchema.methods.resetAlerts = async function() {
  this.criticalAlertSent = false;
  this.warningAlertSent = false;
  this.lastAlertDate = null;
  await this.save();
};


budgetCodeSchema.statics.getUtilizationReport = async function(filters = {}) {
  const query = { active: true };
  
  if (filters.department) query.department = filters.department;
  if (filters.budgetType) query.budgetType = filters.budgetType;
  if (filters.fiscalYear) query.fiscalYear = filters.fiscalYear;

  const budgetCodes = await this.find(query);

  const report = {
    period: {
      fiscalYear: filters.fiscalYear || new Date().getFullYear(),
      department: filters.department || 'All',
      budgetType: filters.budgetType || 'All'
    },
    summary: {
      totalBudget: 0,
      totalUsed: 0,
      totalRemaining: 0,
      averageUtilization: 0,
      codesCount: budgetCodes.length
    },
    byDepartment: {},
    byBudgetType: {},
    topUtilizers: [],
    underutilized: []
  };

  budgetCodes.forEach(code => {
    // Overall summary
    report.summary.totalBudget += code.budget;
    report.summary.totalUsed += code.used;
    report.summary.totalRemaining += code.remaining;

    // By department
    if (!report.byDepartment[code.department]) {
      report.byDepartment[code.department] = {
        budget: 0,
        used: 0,
        remaining: 0,
        count: 0,
        utilization: 0
      };
    }
    const dept = report.byDepartment[code.department];
    dept.budget += code.budget;
    dept.used += code.used;
    dept.remaining += code.remaining;
    dept.count++;

    // By budget type
    if (!report.byBudgetType[code.budgetType]) {
      report.byBudgetType[code.budgetType] = {
        budget: 0,
        used: 0,
        remaining: 0,
        count: 0,
        utilization: 0
      };
    }
    const type = report.byBudgetType[code.budgetType];
    type.budget += code.budget;
    type.used += code.used;
    type.remaining += code.remaining;
    type.count++;

    // Track high utilizers (>80%)
    if (code.utilizationPercentage >= 80) {
      report.topUtilizers.push({
        code: code.code,
        name: code.name,
        department: code.department,
        utilization: code.utilizationPercentage,
        budget: code.budget,
        used: code.used,
        remaining: code.remaining
      });
    }

    // Track underutilized (<40%)
    if (code.utilizationPercentage < 40) {
      report.underutilized.push({
        code: code.code,
        name: code.name,
        department: code.department,
        utilization: code.utilizationPercentage,
        budget: code.budget,
        used: code.used,
        remaining: code.remaining
      });
    }
  });

  // Calculate averages
  if (report.summary.totalBudget > 0) {
    report.summary.averageUtilization = Math.round(
      (report.summary.totalUsed / report.summary.totalBudget) * 100
    );
  }

  // Calculate department utilizations
  Object.keys(report.byDepartment).forEach(dept => {
    const data = report.byDepartment[dept];
    if (data.budget > 0) {
      data.utilization = Math.round((data.used / data.budget) * 100);
    }
  });

  // Calculate type utilizations
  Object.keys(report.byBudgetType).forEach(type => {
    const data = report.byBudgetType[type];
    if (data.budget > 0) {
      data.utilization = Math.round((data.used / data.budget) * 100);
    }
  });

  // Sort top utilizers
  report.topUtilizers.sort((a, b) => b.utilization - a.utilization);
  report.underutilized.sort((a, b) => a.utilization - b.utilization);

  return report;
};


budgetCodeSchema.methods.getForecast = function() {
  const spentAllocations = this.allocations.filter(a => a.status === 'spent');
  
  if (spentAllocations.length === 0) {
    return {
      currentRemaining: this.remaining,
      averageMonthlyBurn: 0,
      projectedMonths: 999,
      projectedExhaustionDate: null,
      recommendation: 'INSUFFICIENT DATA: No spending history available',
      status: 'unknown'
    };
  }

  // Calculate monthly burn rate
  const monthlySpend = {};
  spentAllocations.forEach(alloc => {
    const month = new Date(alloc.allocatedDate).toISOString().slice(0, 7);
    if (!monthlySpend[month]) monthlySpend[month] = 0;
    monthlySpend[month] += alloc.amount;
  });

  const spendArray = Object.values(monthlySpend);
  const averageMonthlyBurn = spendArray.reduce((a, b) => a + b, 0) / spendArray.length;

  const forecast = {
    currentRemaining: this.remaining,
    averageMonthlyBurn: Math.round(averageMonthlyBurn),
    monthlySpendHistory: monthlySpend,
    totalMonthsTracked: spendArray.length
  };

  if (averageMonthlyBurn > 0 && this.remaining > 0) {
    forecast.projectedMonths = Math.floor(this.remaining / averageMonthlyBurn);
    
    const exhaustionDate = new Date();
    exhaustionDate.setMonth(exhaustionDate.getMonth() + forecast.projectedMonths);
    forecast.projectedExhaustionDate = exhaustionDate;

    // Generate recommendation
    if (forecast.projectedMonths < 2) {
      forecast.recommendation = 'CRITICAL: Request budget increase immediately';
      forecast.status = 'critical';
    } else if (forecast.projectedMonths < 4) {
      forecast.recommendation = 'WARNING: Plan budget increase for next quarter';
      forecast.status = 'warning';
    } else if (forecast.projectedMonths < 8) {
      forecast.recommendation = 'MONITOR: Budget on track but watch closely';
      forecast.status = 'monitor';
    } else {
      forecast.recommendation = 'HEALTHY: Budget sufficient for foreseeable future';
      forecast.status = 'healthy';
    }
  } else if (this.remaining <= 0) {
    forecast.projectedMonths = 0;
    forecast.projectedExhaustionDate = new Date();
    forecast.recommendation = 'EXHAUSTED: Budget fully utilized';
    forecast.status = 'exhausted';
  } else {
    forecast.projectedMonths = 999;
    forecast.projectedExhaustionDate = null;
    forecast.recommendation = 'NO SPENDING: Budget not yet utilized';
    forecast.status = 'unused';
  }

  return forecast;
};


budgetCodeSchema.statics.getDashboardData = async function(filters = {}) {
  const query = { active: true };
  
  if (filters.department) query.department = filters.department;
  if (filters.budgetType) query.budgetType = filters.budgetType;
  if (filters.fiscalYear) query.fiscalYear = filters.fiscalYear;

  const budgetCodes = await this.find(query)
    .populate('budgetOwner', 'fullName email department')
    .populate('createdBy', 'fullName email')
    .sort({ utilizationPercentage: -1 });

  // Calculate summary
  const summary = {
    totalBudget: 0,
    totalUsed: 0,
    totalRemaining: 0,
    totalCodes: budgetCodes.length,
    activeReservations: 0,
    criticalCodes: 0,
    warningCodes: 0,
    healthyCodes: 0,
    overallUtilization: 0
  };

  budgetCodes.forEach(code => {
    summary.totalBudget += code.budget;
    summary.totalUsed += code.used;
    summary.totalRemaining += code.remaining;

    const utilization = code.utilizationPercentage;
    if (utilization >= 90) summary.criticalCodes++;
    else if (utilization >= 75) summary.warningCodes++;
    else summary.healthyCodes++;

    summary.activeReservations += code.allocations.filter(
      a => a.status === 'allocated'
    ).length;
  });

  if (summary.totalBudget > 0) {
    summary.overallUtilization = Math.round(
      (summary.totalUsed / summary.totalBudget) * 100
    );
  }

  // Generate alerts
  const alerts = [];
  budgetCodes.forEach(code => {
    const utilization = code.utilizationPercentage;

    if (utilization >= 90) {
      alerts.push({
        type: 'critical',
        budgetCode: code.code,
        name: code.name,
        message: `${code.name} is ${utilization}% utilized. Immediate action required.`,
        utilization,
        remaining: code.remaining,
        owner: code.budgetOwner
      });
    } else if (utilization >= 75) {
      alerts.push({
        type: 'warning',
        budgetCode: code.code,
        name: code.name,
        message: `${code.name} is ${utilization}% utilized. Monitor closely.`,
        utilization,
        remaining: code.remaining,
        owner: code.budgetOwner
      });
    }

    // Check for stale reservations
    const staleReservations = code.allocations.filter(alloc => {
      if (alloc.status !== 'allocated') return false;
      const daysSince = (Date.now() - alloc.allocatedDate) / (1000 * 60 * 60 * 24);
      return daysSince > 30;
    });

    if (staleReservations.length > 0) {
      alerts.push({
        type: 'info',
        budgetCode: code.code,
        name: code.name,
        message: `${staleReservations.length} stale reservation(s) detected (>30 days).`,
        action: 'Review and release if no longer needed',
        staleCount: staleReservations.length,
        owner: code.budgetOwner
      });
    }
  });

  return {
    summary,
    budgetCodes,
    alerts
  };
};



// Static: Get utilization summary
budgetCodeSchema.statics.getUtilizationSummary = async function() {
  const codes = await this.find({ active: true });
  
  const summary = {
    totalBudget: 0,
    totalUsed: 0,
    totalRemaining: 0,
    byDepartment: {},
    byType: {}
  };

  codes.forEach(code => {
    summary.totalBudget += code.budget;
    summary.totalUsed += code.used;
    summary.totalRemaining += (code.budget - code.used);

    // By department
    if (!summary.byDepartment[code.department]) {
      summary.byDepartment[code.department] = {
        budget: 0,
        used: 0,
        remaining: 0,
        count: 0
      };
    }
    summary.byDepartment[code.department].budget += code.budget;
    summary.byDepartment[code.department].used += code.used;
    summary.byDepartment[code.department].remaining += (code.budget - code.used);
    summary.byDepartment[code.department].count++;

    // By type
    if (!summary.byType[code.budgetType]) {
      summary.byType[code.budgetType] = {
        budget: 0,
        used: 0,
        remaining: 0,
        count: 0
      };
    }
    summary.byType[code.budgetType].budget += code.budget;
    summary.byType[code.budgetType].used += code.used;
    summary.byType[code.budgetType].remaining += (code.budget - code.used);
    summary.byType[code.budgetType].count++;
  });

  summary.overallUtilization = summary.totalBudget > 0 
    ? Math.round((summary.totalUsed / summary.totalBudget) * 100) 
    : 0;

  return summary;
};

// Pre-save middleware to validate dates and amounts
budgetCodeSchema.pre('save', function(next) {
  // Validate dates
  if (this.endDate && this.startDate && this.endDate < this.startDate) {
    return next(new Error('End date cannot be before start date'));
  }
  
  // Validate used amount doesn't exceed budget
  if (this.used > this.budget) {
    return next(new Error('Used amount cannot exceed budget'));
  }
  
  // Ensure allocations have required amount field
  if (this.allocations && this.allocations.length > 0) {
    for (let i = 0; i < this.allocations.length; i++) {
      const allocation = this.allocations[i];
      
      // Check if amount exists and is valid
      if (allocation.amount === undefined || allocation.amount === null) {
        return next(new Error(`Allocation at index ${i} is missing required field: amount`));
      }
      
      // Ensure amount is a number
      if (typeof allocation.amount !== 'number' || isNaN(allocation.amount)) {
        return next(new Error(`Allocation at index ${i} has invalid amount: must be a number`));
      }
      
      // Ensure amount is not negative
      if (allocation.amount < 0) {
        return next(new Error(`Allocation at index ${i} has negative amount`));
      }
    }
  }
  
  next();
});

// Pre-update middleware
budgetCodeSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  if (update.used && update.budget) {
    if (update.used > update.budget) {
      return next(new Error('Used amount cannot exceed budget'));
    }
  }

  next();
});

// Create and export model
const BudgetCode = mongoose.model('BudgetCode', budgetCodeSchema);

module.exports = BudgetCode;