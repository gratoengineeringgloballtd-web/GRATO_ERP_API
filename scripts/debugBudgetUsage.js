require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const BudgetCode = require('../models/BudgetCode');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const CashRequest = require('../models/CashRequest');
const SalaryPayment = require('../models/SalaryPayment');

async function debugBudgetUsage() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const budgetCode = 'BUD_OPR2026-OPEX';
    
    // Find the budget code
    const code = await BudgetCode.findOne({ code: budgetCode });
    if (!code) {
      console.log('❌ Budget code not found');
      return;
    }

    console.log(`📊 Budget Code: ${code.code}`);
    console.log(`   Total Budget: XAF ${code.totalBudget?.toLocaleString()}`);
    console.log(`   Stored Used: XAF ${code.used?.toLocaleString()}\n`);

    // Find ALL Purchase Requisitions using this code
    console.log('🔍 ALL Purchase Requisitions:');
    console.log('═══════════════════════════════════════════════');
    const allReqs = await PurchaseRequisition.find({ budgetCode: code._id })
      .populate('employee', 'fullName')
      .select('requisitionNumber title estimatedCost status createdAt employee');
    
    console.log(`Found ${allReqs.length} total requisitions:\n`);
    allReqs.forEach((req, i) => {
      console.log(`${i + 1}. ${req.requisitionNumber}`);
      console.log(`   Title: ${req.title}`);
      console.log(`   Status: ${req.status}`);
      console.log(`   Amount: XAF ${req.estimatedCost?.toLocaleString()}`);
      console.log(`   Employee: ${req.employee?.fullName || 'N/A'}`);
      console.log(`   Date: ${req.createdAt?.toLocaleDateString()}`);
      console.log('');
    });

    // Check which statuses should count
    const countableStatuses = [
      'approved_by_supervisor',
      'approved_by_departmental_head',
      'approved_by_supply_chain',
      'approved_by_finance',
      'pending_head',
      'pending_ceo',
      'approved',
      'assigned_to_buyer',
      'converted_to_po',
      'partially_delivered',
      'fully_delivered',
      'sourcing',
      'justified',
      'justification_pending_supervisor',
      'justification_pending_finance',
      'justification_pending_supply_chain',
      'justification_pending_head',
      'justification_approved'
    ];

    console.log('\n📈 Requisitions that SHOULD be counted:');
    console.log('═══════════════════════════════════════════════');
    const countableReqs = allReqs.filter(req => countableStatuses.includes(req.status));
    console.log(`Found ${countableReqs.length} countable requisitions:\n`);
    
    let totalCountable = 0;
    countableReqs.forEach((req, i) => {
      console.log(`${i + 1}. ${req.requisitionNumber} - ${req.status}`);
      console.log(`   Amount: XAF ${req.estimatedCost?.toLocaleString()}`);
      totalCountable += req.estimatedCost || 0;
      console.log('');
    });

    console.log(`💰 Total from countable requisitions: XAF ${totalCountable.toLocaleString()}\n`);

    // Check Cash Requests
    console.log('💵 Cash Requests:');
    console.log('═══════════════════════════════════════════════');
    const cashReqs = await CashRequest.find({ 'budgetAllocation.budgetCodeId': code._id })
      .populate('employee', 'fullName')
      .select('requestType amountRequested status createdAt employee');
    
    console.log(`Found ${cashReqs.length} cash requests:\n`);
    let cashTotal = 0;
    cashReqs.forEach((req, i) => {
      console.log(`${i + 1}. ${req.requestType}`);
      console.log(`   Status: ${req.status}`);
      console.log(`   Amount: XAF ${req.amountRequested?.toLocaleString()}`);
      console.log(`   Employee: ${req.employee?.fullName || 'N/A'}`);
      cashTotal += req.amountRequested || 0;
      console.log('');
    });

    console.log(`💰 Total from cash requests: XAF ${cashTotal.toLocaleString()}\n`);

    // Check Salary Payments
    console.log('💼 Salary Payments:');
    console.log('═══════════════════════════════════════════════');
    const salaries = await SalaryPayment.find({ 
      'departmentPayments.budgetCode': code._id,
      status: 'processed'
    }).select('paymentPeriod departmentPayments status');
    
    console.log(`Found ${salaries.length} salary payments:\n`);
    let salaryTotal = 0;
    salaries.forEach((payment, i) => {
      payment.departmentPayments.forEach(dept => {
        if (dept.budgetCode && dept.budgetCode.toString() === code._id.toString()) {
          console.log(`${i + 1}. ${payment.paymentPeriod} - ${dept.department}`);
          console.log(`   Amount: XAF ${dept.amount?.toLocaleString()}`);
          salaryTotal += dept.amount || 0;
          console.log('');
        }
      });
    });

    console.log(`💰 Total from salary payments: XAF ${salaryTotal.toLocaleString()}\n`);

    // Final Summary
    console.log('📊 FINAL SUMMARY:');
    console.log('═══════════════════════════════════════════════');
    console.log(`Total Budget:           XAF ${code.totalBudget?.toLocaleString()}`);
    console.log(`Purchase Requisitions:  XAF ${totalCountable.toLocaleString()}`);
    console.log(`Cash Requests:          XAF ${cashTotal.toLocaleString()}`);
    console.log(`Salary Payments:        XAF ${salaryTotal.toLocaleString()}`);
    console.log(`───────────────────────────────────────────────`);
    const grandTotal = totalCountable + cashTotal + salaryTotal;
    console.log(`TOTAL USED:             XAF ${grandTotal.toLocaleString()}`);
    console.log(`REMAINING:              XAF ${(code.totalBudget - grandTotal).toLocaleString()}`);
    console.log(`UTILIZATION:            ${((grandTotal / code.totalBudget) * 100).toFixed(2)}%`);

    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
  }
}

debugBudgetUsage();
