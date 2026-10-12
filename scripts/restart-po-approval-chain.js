/**
 * restart-po-approval-chain.js
 *
 * Rebuilds a Purchase Order's approval chain from Level 1, exactly the way
 * Supply Chain's department assignment does (config/poApprovalChain.js):
 *   Level 1: Department Head
 *   Level 2: Head of Business
 *   Level 3: Finance Officer
 *   Level 4: CEO — included automatically if the PO's total amount is at
 *             or above the CEO approval threshold (config/ceoApprovalConfig.js)
 *
 * Use this when a PO needs to go through approval again from scratch —
 * e.g. its rejection predates the rejectionDetails tracking added later,
 * so there's no reliable record of which level it was rejected at.
 *
 * ─── SETUP ────────────────────────────────────────────────────────────
 * Run this FROM YOUR BACKEND ROOT (same folder as package.json / .env):
 *
 *   node scripts/restart-po-approval-chain.js PO-2026-000047
 *
 * If the PO doesn't already have a department on file (assignedDepartment),
 * or you want to send it to a different one, pass it explicitly:
 *
 *   node scripts/restart-po-approval-chain.js PO-2026-000047 "Technical"
 *
 * (Department name must match one of the keys in config/departmentStructure.js
 * — e.g. "Technical", "IT", "HR & Admin", "Business Development".)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envCandidates = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env')
];
const envPath = envCandidates.find(p => fs.existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

const mongoose = require('mongoose');

async function main() {
  const poArg = process.argv[2];
  const departmentOverride = process.argv[3];

  if (!poArg) {
    console.error('Usage: node scripts/restart-po-approval-chain.js <PO-NUMBER-or-id> [department]');
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not found. Run this from your backend root (same folder as your .env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('✅ Connected to MongoDB\n');

  const PurchaseOrder = require('../models/PurchaseOrder');
  const { getPOApprovalChain } = require('../config/poApprovalChain');

  let po = await PurchaseOrder.findOne({ poNumber: poArg });
  if (!po && mongoose.isValidObjectId(poArg)) {
    po = await PurchaseOrder.findById(poArg);
  }

  if (!po) {
    console.error(`❌ No purchase order found matching "${poArg}"`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const department = departmentOverride || po.assignedDepartment;

  console.log(`Found PO ${po.poNumber} (${po._id})`);
  console.log(`  current status: ${po.status}`);
  console.log(`  total amount: ${po.currency} ${(po.totalAmount || 0).toLocaleString()}`);
  console.log(`  department: ${department || '(none on file)'}`);

  if (!department) {
    console.error('\n❌ This PO has no assignedDepartment on file, and none was given.');
    console.error('   Re-run with the department as a second argument, e.g.:');
    console.error(`   node scripts/restart-po-approval-chain.js ${po.poNumber} "Technical"`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!['sent_to_supplier', 'acknowledged', 'delivered', 'completed'].includes(po.status)) {
    let newChain;
    try {
      newChain = getPOApprovalChain(department, po.totalAmount);
    } catch (chainError) {
      console.error(`\n❌ Could not build approval chain: ${chainError.message}`);
      await mongoose.disconnect();
      process.exit(1);
    }

    po.assignedDepartment = department;
    po.approvalChain = newChain.map((step, index) => ({
      level: step.level,
      approver: { name: step.approver, email: step.email, role: step.role, department: step.department },
      status: 'pending',
      activatedDate: index === 0 ? new Date() : null
    }));
    po.currentApprovalLevel = 1;
    po.status = 'pending_department_approval';
    po.progress = 15;
    po.currentStage = 'created';
    // Clear stale rejection/cancellation flags — this is a fresh run
    // through the chain, not a continuation of the old one.
    po.rejectionDetails = undefined;

    po.activities.push({
      type: 'updated',
      description: `Approval chain manually restarted from Level 1 (${newChain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ')})`,
      user: 'System (repair script)',
      timestamp: new Date()
    });

    await po.save();

    console.log('\n✅ Approval chain rebuilt from Level 1:');
    newChain.forEach(step => {
      console.log(`   L${step.level}: ${step.approver} (${step.role}) — ${step.email}`);
    });
    console.log(`\n✅ Saved. ${po.poNumber} is now status: ${po.status}, awaiting Level 1 (${newChain[0].approver}).`);
  } else {
    console.log(`\nℹ️  This PO's status ("${po.status}") is beyond the approval stage — not restarting its chain.`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
