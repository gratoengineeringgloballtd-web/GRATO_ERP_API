/**
 * Script to test budget code usage calculation
 * 
 * This script tests the new calculateBudgetUsage function to ensure
 * it correctly aggregates usage from:
 * 1. Purchase Requisitions
 * 2. Cash Requests
 * 3. Salary Payments
 */

const mongoose = require('mongoose');
require('dotenv').config();

const BudgetCode = require('../models/BudgetCode');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const CashRequest = require('../models/CashRequest');
const SalaryPayment = require('../models/SalaryPayment');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Connected'))
.catch((err) => console.error('MongoDB Connection Error:', err));

// Helper function to calculate actual budget usage from all sources
const calculateBudgetUsage = async (budgetCodeId) => {
  try {
    let totalUsed = 0;

    // 1. Calculate usage from Purchase Requisitions
    const requisitionStatuses = [
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

    const purchaseRequisitions = await PurchaseRequisition.find({
      budgetCode: budgetCodeId,
      status: { $in: requisitionStatuses }
    }).select('totalCost requisitionNumber status');

    console.log(`\n📝 Purchase Requisitions found: ${purchaseRequisitions.length}`);
    purchaseRequisitions.forEach(req => {
      console.log(`   - ${req.requisitionNumber}: XAF ${req.totalCost?.toLocaleString()} (${req.status})`);
    });

    const requisitionTotal = purchaseRequisitions.reduce((sum, req) => sum + (req.totalCost || 0), 0);
    totalUsed += requisitionTotal;
    console.log(`   Total from requisitions: XAF ${requisitionTotal.toLocaleString()}`);

    // 2. Calculate usage from Cash Requests
    const cashRequestStatuses = [
      'approved',
      'partially_disbursed',
      'fully_disbursed',
      'justification_pending_supervisor',
      'justification_pending_departmental_head',
      'justification_pending_hr',
      'justification_pending_finance',
      'completed'
    ];

    const cashRequests = await CashRequest.find({
      'budgetAllocation.budgetCodeId': budgetCodeId,
      status: { $in: cashRequestStatuses }
    }).select('amountRequested status');

    console.log(`\n💰 Cash Requests found: ${cashRequests.length}`);
    cashRequests.forEach(req => {
      console.log(`   - Request: XAF ${req.amountRequested?.toLocaleString()} (${req.status})`);
    });

    const cashRequestTotal = cashRequests.reduce((sum, req) => sum + (req.amountRequested || 0), 0);
    totalUsed += cashRequestTotal;
    console.log(`   Total from cash requests: XAF ${cashRequestTotal.toLocaleString()}`);

    // 3. Calculate usage from Salary Payments
    const salaryPayments = await SalaryPayment.find({
      'departmentPayments.budgetCode': budgetCodeId,
      status: 'processed'
    }).select('departmentPayments');

    console.log(`\n👥 Salary Payments found: ${salaryPayments.length}`);
    let salaryTotal = 0;
    salaryPayments.forEach(payment => {
      payment.departmentPayments.forEach(dept => {
        if (dept.budgetCode && dept.budgetCode.toString() === budgetCodeId.toString()) {
          salaryTotal += dept.amount || 0;
          console.log(`   - ${dept.department}: XAF ${dept.amount?.toLocaleString()}`);
        }
      });
    });
    totalUsed += salaryTotal;
    console.log(`   Total from salary payments: XAF ${salaryTotal.toLocaleString()}`);

    console.log(`\n✅ TOTAL USAGE: XAF ${totalUsed.toLocaleString()}`);
    return Math.round(totalUsed * 100) / 100;
  } catch (error) {
    console.error('Error calculating budget usage:', error);
    return 0;
  }
};

async function testBudgetUsage() {
  try {
    console.log('===================================');
    console.log('BUDGET CODE USAGE CALCULATION TEST');
    console.log('===================================\n');

    // Get all active budget codes
    const budgetCodes = await BudgetCode.find({ active: true }).limit(5);

    console.log(`Found ${budgetCodes.length} active budget codes to test\n`);

    for (const code of budgetCodes) {
      console.log('\n' + '='.repeat(60));
      console.log(`Budget Code: ${code.code} - ${code.name}`);
      console.log('='.repeat(60));
      console.log(`Total Budget: XAF ${code.budget.toLocaleString()}`);
      console.log(`Stored 'used' value: XAF ${code.used.toLocaleString()}`);

      // Calculate actual usage
      const actualUsed = await calculateBudgetUsage(code._id);

      console.log(`\n📊 COMPARISON:`);
      console.log(`   Stored 'used': XAF ${code.used.toLocaleString()}`);
      console.log(`   Actual usage:  XAF ${actualUsed.toLocaleString()}`);
      console.log(`   Difference:    XAF ${(actualUsed - code.used).toLocaleString()}`);
      
      const utilization = code.budget > 0 ? Math.round((actualUsed / code.budget) * 100) : 0;
      console.log(`   Utilization:   ${utilization}%`);
      
      if (actualUsed !== code.used) {
        console.log(`\n   ⚠️  MISMATCH: The stored 'used' value doesn't match actual usage!`);
      } else {
        console.log(`\n   ✅ VALUES MATCH: Database is in sync`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run the test
testBudgetUsage();
