const mongoose = require('mongoose');

const budgetTransferSchema = new mongoose.Schema({
  fromBudgetCode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetCode',
    required: true
  },
  toBudgetCode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetCode',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Transfer amount cannot be negative']
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
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
      role: { type: String, required: true }
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
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalDate: Date,
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionDate: Date,
  rejectionReason: String,
  executedDate: Date
}, {
  timestamps: true
});

// Indexes
budgetTransferSchema.index({ fromBudgetCode: 1 });
budgetTransferSchema.index({ toBudgetCode: 1 });
budgetTransferSchema.index({ requestedBy: 1 });
budgetTransferSchema.index({ status: 1 });
budgetTransferSchema.index({ 'approvalChain.approver.email': 1 });

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Execute approved transfer (move funds between budget codes)
 */
budgetTransferSchema.methods.executeTransfer = async function() {
  console.log('\n💸 EXECUTING Budget Transfer');
  console.log(`   Amount: XAF ${this.amount.toLocaleString()}`);

  if (this.status !== 'approved') {
    throw new Error('Transfer must be approved before execution');
  }

  if (this.executedDate) {
    throw new Error('Transfer has already been executed');
  }

  const BudgetCode = mongoose.model('BudgetCode');
  
  const fromCode = await BudgetCode.findById(this.fromBudgetCode);
  const toCode = await BudgetCode.findById(this.toBudgetCode);

  if (!fromCode || !toCode) {
    throw new Error('One or both budget codes not found');
  }

  console.log(`   From: ${fromCode.code} (${fromCode.name})`);
  console.log(`   To: ${toCode.code} (${toCode.name})`);

  // Validate sufficient budget
  if (fromCode.remaining < this.amount) {
    throw new Error(
      `Insufficient budget in source code. Available: XAF ${fromCode.remaining.toLocaleString()}, Required: XAF ${this.amount.toLocaleString()}`
    );
  }

  // Deduct from source
  fromCode.budget -= this.amount;
  fromCode.budgetHistory.push({
    previousBudget: fromCode.budget + this.amount,
    newBudget: fromCode.budget,
    changeAmount: -this.amount,
    reason: `Transfer to ${toCode.code}: ${this.reason}`,
    changedBy: this.approvedBy,
    changeDate: new Date()
  });

  console.log(`   ${fromCode.code} new budget: XAF ${fromCode.budget.toLocaleString()}`);

  // Add to destination
  toCode.budget += this.amount;
  toCode.budgetHistory.push({
    previousBudget: toCode.budget - this.amount,
    newBudget: toCode.budget,
    changeAmount: this.amount,
    reason: `Transfer from ${fromCode.code}: ${this.reason}`,
    changedBy: this.approvedBy,
    changeDate: new Date()
  });

  console.log(`   ${toCode.code} new budget: XAF ${toCode.budget.toLocaleString()}`);

  // Reset alerts if needed
  await fromCode.resetAlerts();
  await toCode.resetAlerts();

  await fromCode.save();
  await toCode.save();

  this.executedDate = new Date();
  await this.save();

  console.log('   ✅ Transfer executed successfully\n');

  // Send notifications
  const User = mongoose.model('User');
  const requester = await User.findById(this.requestedBy);
  const { sendEmail } = require('../services/emailService');

  await sendEmail({
    to: requester.email,
    subject: `Budget Transfer Completed: ${fromCode.code} → ${toCode.code}`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2 style="color: #52c41a;">Budget Transfer Completed</h2>
        <p>Dear ${requester.fullName},</p>
        <p>Your budget transfer has been successfully executed:</p>
        
        <div style="background-color: #f6ffed; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #52c41a;">
          <p><strong>From:</strong> ${fromCode.code} - ${fromCode.name}</p>
          <p><strong>To:</strong> ${toCode.code} - ${toCode.name}</p>
          <p><strong>Amount:</strong> XAF ${this.amount.toLocaleString()}</p>
          <p><strong>Executed Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <p><strong>New Balances:</strong></p>
        <ul>
          <li>${fromCode.code}: XAF ${fromCode.budget.toLocaleString()}</li>
          <li>${toCode.code}: XAF ${toCode.budget.toLocaleString()}</li>
        </ul>
      </div>
    `
  });

  return { fromCode, toCode };
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Request a budget transfer
 */
budgetTransferSchema.statics.requestTransfer = async function(
  fromCodeId,
  toCodeId,
  amount,
  reason,
  requestedBy
) {
  console.log('\n🔄 REQUESTING Budget Transfer');
  console.log(`   Amount: XAF ${amount.toLocaleString()}`);

  const BudgetCode = mongoose.model('BudgetCode');
  const User = mongoose.model('User');

  const fromCode = await BudgetCode.findById(fromCodeId);
  const toCode = await BudgetCode.findById(toCodeId);
  const requester = await User.findById(requestedBy);

  if (!fromCode) {
    throw new Error('Source budget code not found');
  }

  if (!toCode) {
    throw new Error('Destination budget code not found');
  }

  if (!requester) {
    throw new Error('Requester not found');
  }

  if (fromCodeId.toString() === toCodeId.toString()) {
    throw new Error('Cannot transfer to the same budget code');
  }

  // Validate sufficient budget
  if (fromCode.remaining < amount) {
    throw new Error(
      `Insufficient budget in source code. Available: XAF ${fromCode.remaining.toLocaleString()}, Required: XAF ${amount.toLocaleString()}`
    );
  }

  console.log(`   From: ${fromCode.code} (Available: XAF ${fromCode.remaining.toLocaleString()})`);
  console.log(`   To: ${toCode.code}`);

  // Generate approval chain
  const { getBudgetTransferApprovalChain } = require('../config/budgetCodeApprovalChain');
  const approvalChain = getBudgetTransferApprovalChain(requester, fromCode, toCode);

  const transfer = new this({
    fromBudgetCode: fromCodeId,
    toBudgetCode: toCodeId,
    amount,
    reason,
    requestedBy,
    approvalChain
  });

  await transfer.save();

  console.log('   ✅ Transfer request created, awaiting approval\n');

  // Notify first approver
  const { sendEmail } = require('../services/emailService');
  const firstApprover = approvalChain[0].approver;

  await sendEmail({
    to: firstApprover.email,
    subject: `Budget Transfer Approval Required`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Budget Transfer Approval Required</h2>
        <p>Dear ${firstApprover.name},</p>
        <p>A budget transfer request requires your approval:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>From:</strong> ${fromCode.code} - ${fromCode.name}</p>
          <p><strong>Available:</strong> XAF ${fromCode.remaining.toLocaleString()}</p>
          <p><strong>To:</strong> ${toCode.code} - ${toCode.name}</p>
          <p><strong>Transfer Amount:</strong> XAF ${amount.toLocaleString()}</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Requested By:</strong> ${requester.fullName}</p>
        </div>

        <p style="text-align: center;">
          <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/finance/budget-transfers" 
             style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Review Transfer Request
          </a>
        </p>
      </div>
    `
  });

  return transfer;
};

/**
 * Approve budget transfer at current level
 */
budgetTransferSchema.methods.approveTransfer = async function(approverId, comments = '') {
  console.log('\n✅ APPROVING Budget Transfer');

  if (this.status !== 'pending') {
    throw new Error(`Transfer is already ${this.status}`);
  }

  const User = mongoose.model('User');
  const approver = await User.findById(approverId);

  if (!approver) {
    throw new Error('Approver not found');
  }

  // Find current approval step
  const currentStep = this.approvalChain.find(step => step.status === 'pending');

  if (!currentStep) {
    throw new Error('No pending approval step found');
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

  // Check if final approval
  const nextStepIndex = this.approvalChain.findIndex(
    step => step.level === currentStep.level + 1
  );

  if (nextStepIndex === -1) {
    // Final approval - execute transfer
    console.log('   🎉 Final approval - executing transfer');

    this.status = 'approved';
    this.approvedBy = approverId;
    this.approvalDate = new Date();

    await this.save();

    // Execute the transfer
    await this.executeTransfer();

    console.log('   ✅ Transfer completed\n');
  } else {
    // Move to next approval level
    const nextStep = this.approvalChain[nextStepIndex];
    console.log(`   ⏭️  Moving to next level: ${nextStep.approver.name}`);

    await this.save();

    // Notify next approver
    const BudgetCode = mongoose.model('BudgetCode');
    const fromCode = await BudgetCode.findById(this.fromBudgetCode);
    const toCode = await BudgetCode.findById(this.toBudgetCode);
    const { sendEmail } = require('../services/emailService');

    await sendEmail({
      to: nextStep.approver.email,
      subject: `Budget Transfer Approval Required`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Budget Transfer Approval Required</h2>
          <p>Dear ${nextStep.approver.name},</p>
          <p>A budget transfer request requires your approval:</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>From:</strong> ${fromCode.code} - ${fromCode.name}</p>
            <p><strong>To:</strong> ${toCode.code} - ${toCode.name}</p>
            <p><strong>Amount:</strong> XAF ${this.amount.toLocaleString()}</p>
            <p><strong>Reason:</strong> ${this.reason}</p>
          </div>

          <p><strong>Previous Approval:</strong> ${approver.fullName} (${currentStep.approver.role})</p>
          ${comments ? `<p><strong>Comments:</strong> ${comments}</p>` : ''}

          <p style="text-align: center;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/finance/budget-transfers" 
               style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Review Transfer Request
            </a>
          </p>
        </div>
      `
    });

    console.log('   ✅ Moved to next approval level\n');
  }

  return this;
};

/**
 * Reject budget transfer
 */
budgetTransferSchema.methods.rejectTransfer = async function(rejectorId, rejectionReason) {
  console.log('\n❌ REJECTING Budget Transfer');

  if (this.status !== 'pending') {
    throw new Error(`Transfer is already ${this.status}`);
  }

  const User = mongoose.model('User');
  const rejector = await User.findById(rejectorId);

  if (!rejector) {
    throw new Error('Rejector not found');
  }

  // Find current step and update
  const currentStep = this.approvalChain.find(step => step.status === 'pending');

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

  this.status = 'rejected';
  this.rejectedBy = rejectorId;
  this.rejectionDate = new Date();
  this.rejectionReason = rejectionReason;

  await this.save();

  console.log(`   Rejected by: ${rejector.fullName}`);
  console.log(`   Reason: ${rejectionReason}\n`);

  // Notify requester
  const requester = await User.findById(this.requestedBy);
  const BudgetCode = mongoose.model('BudgetCode');
  const fromCode = await BudgetCode.findById(this.fromBudgetCode);
  const toCode = await BudgetCode.findById(this.toBudgetCode);
  const { sendEmail } = require('../services/emailService');

  await sendEmail({
    to: requester.email,
    subject: `Budget Transfer Rejected`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2 style="color: #ff4d4f;">Budget Transfer Rejected</h2>
        <p>Dear ${requester.fullName},</p>
        <p>Your budget transfer request has been rejected:</p>
        
        <div style="background-color: #fff2f0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ff4d4f;">
          <p><strong>From:</strong> ${fromCode.code} - ${fromCode.name}</p>
          <p><strong>To:</strong> ${toCode.code} - ${toCode.name}</p>
          <p><strong>Amount:</strong> XAF ${this.amount.toLocaleString()}</p>
          <p><strong>Rejected By:</strong> ${rejector.fullName}</p>
          <p><strong>Reason:</strong> ${rejectionReason}</p>
        </div>

        <p>You may submit a new transfer request with additional justification if needed.</p>
      </div>
    `
  });

  return this;
};

/**
 * Get pending transfers for a user
 */
budgetTransferSchema.statics.getPendingForUser = async function(userEmail) {
  return await this.find({
    'approvalChain.approver.email': userEmail,
    'approvalChain.status': 'pending',
    status: 'pending'
  })
    .populate('fromBudgetCode', 'code name department budget used remaining')
    .populate('toBudgetCode', 'code name department budget used remaining')
    .populate('requestedBy', 'fullName email department')
    .sort({ createdAt: -1 });
};

const BudgetTransfer = mongoose.model('BudgetTransfer', budgetTransferSchema);

module.exports = BudgetTransfer;