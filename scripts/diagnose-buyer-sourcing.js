/**
 * scripts/diagnose-buyer-sourcing.js
 *
 * Traces a specific requisition through every check the buyer-sourcing pipeline
 * applies, so a "buyer can't see it / can't start sourcing" report can be pinned
 * down to the exact failing check instead of guessed at.
 *
 * Usage:
 *   node scripts/diagnose-buyer-sourcing.js <requisitionNumber>
 *   node scripts/diagnose-buyer-sourcing.js REQ202608059427
 */

require('dotenv').config();
const mongoose = require('mongoose');
require('../models/User'); // must be required before populate() can resolve refs
const PurchaseRequisition = require('../models/PurchaseRequisition');
const BudgetCode = require('../models/BudgetCode');

const requisitionNumber = process.argv[2];

if (!requisitionNumber) {
  console.error('Usage: node scripts/diagnose-buyer-sourcing.js <requisitionNumber>');
  process.exit(1);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const req = await PurchaseRequisition.findOne({ requisitionNumber })
    .populate('supplyChainReview.assignedBuyer', 'fullName email role departmentRole')
    .populate('employee', 'fullName email');

  if (!req) {
    console.log(`❌ No requisition found with number "${requisitionNumber}".`);
    await mongoose.disconnect();
    return;
  }

  console.log('📋 Requisition:');
  console.log(`   number         : ${req.requisitionNumber}`);
  console.log(`   title          : ${req.title}`);
  console.log(`   status         : ${req.status}`);
  console.log(`   budgetXAF      : ${req.budgetXAF}`);
  console.log(`   budgetCode     : ${req.budgetCode}`);
  console.log(`   assignedBuyer  : ${req.supplyChainReview?.assignedBuyer ? `${req.supplyChainReview.assignedBuyer.fullName} (${req.supplyChainReview.assignedBuyer.email})` : '❌ NONE ASSIGNED'}`);
  console.log(`   headApproval   : ${JSON.stringify(req.headApproval)}`);
  console.log(`   ceoApproval    : ${JSON.stringify(req.ceoApproval)}`);

  console.log('\n── Check 1: Is the buyer actually assigned? ──────────────');
  if (!req.supplyChainReview?.assignedBuyer) {
    console.log('🔴 FAIL — no buyer is assigned on this requisition (supplyChainReview.assignedBuyer is empty).');
    console.log('   getAssignedRequisitions filters by this field, so an unassigned PR will never show up');
    console.log('   for ANY buyer, no matter what its status is. Assign a buyer via the supply-chain');
    console.log('   "assign buyer" action first.');
  } else {
    const buyerRole = req.supplyChainReview.assignedBuyer.role;
    const buyerDeptRole = req.supplyChainReview.assignedBuyer.departmentRole;
    console.log(`🟢 Buyer is assigned: ${req.supplyChainReview.assignedBuyer.email}`);
    if (buyerRole !== 'buyer' && buyerDeptRole !== 'buyer') {
      console.log(`🔴 BUT this user's role is "${buyerRole}" / departmentRole "${buyerDeptRole}", neither of which is`);
      console.log('   "buyer". getAssignedRequisitions only scopes results to assignedBuyer for users whose');
      console.log('   role OR departmentRole is literally "buyer" — anyone else gets a 403, or (if they\'re');
      console.log('   supply_chain/admin) a totally different, broader query that doesn\'t filter by this');
      console.log('   specific assignment at all.');
    }
  }

  console.log('\n── Check 2: Does the status map to a sourcing-visible state? ─');
  const READY_STATUSES = ['approved', 'pending_head_approval'];
  if (READY_STATUSES.includes(req.status)) {
    console.log(`🟢 status "${req.status}" is in the ready-for-sourcing set (${READY_STATUSES.join(', ')}).`);
  } else if (req.status.startsWith('pending_') || req.status.startsWith('justification_pending')) {
    console.log(`🟡 status "${req.status}" means this PR simply hasn't finished approval yet — it is not`);
    console.log('   expected to be actionable by the buyer at this stage. This is likely correct behavior,');
    console.log('   not a bug, unless you expected this specific PR to already be fully approved.');
  } else {
    console.log(`🔴 status "${req.status}" is NOT in the ready-for-sourcing set and is not a normal pending`);
    console.log('   state either — this is the actual problem if you expected the buyer to act on it now.');
  }

  console.log('\n── Check 3: Budget reservation (only relevant once status = approved) ─');
  if (req.status === 'approved' || ['in_procurement', 'partially_disbursed', 'fully_disbursed', 'completed'].includes(req.status)) {
    if (!req.budgetCode) {
      console.log('🟡 No budgetCode on this requisition — reservation step was skipped entirely (this is fine,');
      console.log('   reservation is a no-op when there is no budget code to reserve against).');
    } else {
      const bc = await BudgetCode.findById(req.budgetCode);
      if (!bc) {
        console.log(`🔴 budgetCode ${req.budgetCode} does not resolve to a real BudgetCode document — reservation`);
        console.log('   would have been silently skipped with a console warning, not blocked. Approval should');
        console.log('   still have gone through.');
      } else {
        const allocation = (bc.allocations || []).find(a => a.requisitionId?.toString() === req._id.toString());
        console.log(`   BudgetCode "${bc.code}": budget=${bc.budget}, used=${bc.used}, remaining=${bc.remaining}`);
        if (allocation) {
          console.log(`🟢 Reservation found: status="${allocation.status}", amount=${allocation.amount}`);
        } else {
          console.log('🔴 No allocation entry found for this requisition on its budget code, even though the');
          console.log('   PR reached "approved". This would only happen if the reservation call threw and was');
          console.log('   caught by the outer error handler, which would have returned a 400 to whoever clicked');
          console.log('   approve — meaning the approval click likely showed an error, not a success message.');
          console.log('   Worth asking the approver whether they actually saw a success confirmation.');
        }
      }
    }
  } else {
    console.log('   (skipped — requisition has not reached "approved" yet)');
  }

  console.log('\n── Raw approval chain ─────────────────────────────────────');
  (req.approvalChain || []).forEach((step, i) => {
    console.log(`   [${i}] level ${step.level} — ${step.approver.name} (${step.approver.role}) — ${step.status}${step.actionDate ? ` @ ${step.actionDate.toISOString()}` : ''}`);
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
