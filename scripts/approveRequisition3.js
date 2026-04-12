require('dotenv').config();
const mongoose = require('mongoose');
const PR = require('../models/PurchaseRequisition');
const BC = require('../models/BudgetCode');
const User = require('../models/User');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  try {
    // Find the budget code - HR Opex 2026
    const budgetCode = await BC.findOne({
      $or: [
        { code: /HR.*OPEX/i },
        { name: /HR.*OPEX/i }
      ]
    });

    // Find the requisition
    const requisition = await PR.findOne({ requisitionNumber: 'REQ202601125218' });

    // Find the finance officer
    const financeUser = await User.findOne({ email: 'ranibellmambo@gratoengineering.com' });

    console.log('=== Search Results ===');
    if (budgetCode) {
      console.log('✓ Budget Code Found:', budgetCode.code, '-', budgetCode.name);
      console.log('  Department:', budgetCode.department);
      console.log('  Total Budget: XAF', budgetCode.budget?.toLocaleString());
    } else {
      console.log('✗ Budget code not found');
    }

    if (requisition) {
      console.log('✓ Requisition Found: REQ202601125218');
      console.log('  Status:', requisition.status);
      console.log('  Amount: XAF', requisition.budgetXAF?.toLocaleString());
    } else {
      console.log('✗ Requisition not found');
    }

    if (financeUser) {
      console.log('✓ Finance User Found:', financeUser.name);
    } else {
      console.log('✗ Finance user not found');
    }

    if (!budgetCode || !requisition || !financeUser) {
      console.log('\nCannot proceed with approval - missing required records');
      mongoose.connection.close();
      return;
    }

    // Calculate available budget
    const allReqs = await PR.find({ budgetCode: budgetCode._id, status: 'approved' });
    const CR = require('../models/CashRequest');
    const cashRequests = await CR.find({ budgetCode: budgetCode._id, status: 'approved' });
    
    const usedBudget = allReqs.reduce((sum, r) => sum + (r.budgetXAF || 0), 0) +
                       cashRequests.reduce((sum, c) => sum + (c.amount || 0), 0);
    const availableBudget = budgetCode.budget - usedBudget;

    console.log('\n=== Budget Information ===');
    console.log('Total Budget: XAF', budgetCode.budget?.toLocaleString());
    console.log('Used Budget: XAF', usedBudget.toLocaleString());
    console.log('Available Budget: XAF', availableBudget.toLocaleString());
    console.log('Requisition Amount: XAF', requisition.budgetXAF?.toLocaleString());

    if (availableBudget < requisition.budgetXAF) {
      console.log('\n✗ WARNING: Insufficient budget! Available XAF ' + availableBudget.toLocaleString() + ' < Required XAF ' + requisition.budgetXAF?.toLocaleString());
    }

    // Perform the approval
    console.log('\n=== Performing Approval ===');
    requisition.budgetCode = budgetCode._id;
    requisition.budgetCodeInfo = {
      code: budgetCode.code,
      name: budgetCode.name,
      department: budgetCode.department,
      availableAtSubmission: availableBudget,
      submittedAmount: requisition.budgetXAF
    };
    requisition.financeVerification = {
      budgetAvailable: availableBudget >= requisition.budgetXAF,
      verifiedBudget: requisition.budgetXAF,
      budgetCodeVerified: budgetCode.code,
      availableBudgetAtVerification: availableBudget,
      comments: 'available',
      verifiedBy: financeUser._id,
      verificationDate: new Date(),
      decision: 'approved'
    };
    requisition.status = 'pending_supply_chain_review';

    // Update approval chain
    if (requisition.approvalChain && requisition.approvalChain.length > 0) {
      const financeStep = requisition.approvalChain.find(step => step.role === 'finance');
      if (financeStep) {
        financeStep.status = 'approved';
        financeStep.comments = 'available';
        financeStep.approvedAt = new Date();
        financeStep.approvedBy = financeUser._id;
      }
    }

    await requisition.save();

    console.log('✓ Approval Recorded Successfully');
    console.log('  Status Updated: pending_supervisor → pending_supply_chain_review');
    console.log('  Budget Code: ' + budgetCode.code);
    console.log('  Finance Decision: APPROVED');
    console.log('  Comment: available');

    mongoose.connection.close();
  } catch (e) {
    console.error('Error:', e.message);
    mongoose.connection.close();
  }
});
