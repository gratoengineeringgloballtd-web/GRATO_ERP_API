/**
 * resume-po-at-rejected-level.js
 *
 * One-off repair script for Purchase Orders that got dropped to 'draft'
 * by editing a rejected PO BEFORE the level-aware resume fix was applied
 * to controllers/buyerPurchaseOrderController.js. (The earlier version of
 * that fix always reset a rejected PO to 'draft'; the corrected version
 * resumes it at the exact level/stage it was rejected at instead.)
 *
 * This script does NOT touch your live route/controller code — it directly
 * repairs a PO document already stuck in 'draft' with leftover
 * rejectionDetails, using the same level/stage mapping the fixed
 * controller now uses. Safe to re-run: it only acts on a PO that is
 * currently 'draft' AND still has a resolvable rejectionDetails.stage.
 *
 * ─── SETUP ────────────────────────────────────────────────────────────
 * Run this FROM YOUR BACKEND ROOT (same folder as package.json / server.js
 * — e.g. C:\Users\user\ERP GRATO\GRATO_ERP_API), so its requires resolve:
 *
 *   node resume-po-at-rejected-level.js PO-2026-000047
 *
 * or by Mongo _id:
 *
 *   node resume-po-at-rejected-level.js 69c6cd863b15d1d2414e0622
 *
 * To just LIST every PO that looks like it was affected, without changing
 * anything:
 *
 *   node resume-po-at-rejected-level.js --scan
 *
 * It reads your DB connection from MONGO_URI in your .env, same as the
 * running server.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Try the current working directory first (wherever you ran `node` from —
// normally your backend root), then fall back to this script's own folder.
const envCandidates = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env')
];
const envPath = envCandidates.find(p => fs.existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

const mongoose = require('mongoose');

// Mirrors config/poApprovalChain.js — Level 1: Department Head,
// 2: Head of Business, 3: Finance Officer, 4: CEO (conditional).
const PO_LEVEL_STATUS = {
  1: 'pending_department_approval',
  2: 'pending_head_of_business_approval',
  3: 'pending_finance_approval',
  4: 'pending_ceo_approval'
};
const PO_LEVEL_PROGRESS = { 1: 15, 2: 20, 3: 25, 4: 28 };
const PO_LEVEL_ROLE = {
  1: 'Department Head',
  2: 'Head of Business',
  3: 'Finance Officer',
  4: 'CEO'
};

async function main() {
  const arg = process.argv[2];

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not found. Run this script from your backend root (same folder as your .env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('✅ Connected to MongoDB\n');

  const PurchaseOrder = require('../models/PurchaseOrder');

  if (!arg || arg === '--scan') {
    // Read-only report: every draft PO that still carries rejectionDetails
    // with a resolvable stage — these are the candidates that were likely
    // reset to Draft by the earlier version of the fix.
    const candidates = await PurchaseOrder.find({
      status: 'draft',
      'rejectionDetails.stage': { $exists: true, $ne: null }
    }).select('poNumber status rejectionDetails currentApprovalLevel lastModifiedDate');

    if (candidates.length === 0) {
      console.log('No draft POs with leftover rejection info found. Nothing to fix.');
    } else {
      console.log(`Found ${candidates.length} candidate PO(s):\n`);
      candidates.forEach(po => {
        console.log(`  ${po.poNumber}  (${po._id})`);
        console.log(`    stage: ${po.rejectionDetails?.stage}   reason: "${po.rejectionDetails?.reason || ''}"`);
        console.log(`    last modified: ${po.lastModifiedDate}\n`);
      });
      console.log('Run again with a PO number or _id to fix one, e.g.:');
      console.log(`  node resume-po-at-rejected-level.js ${candidates[0].poNumber}`);
    }
    await mongoose.disconnect();
    return;
  }

  // Find by poNumber first, then fall back to _id
  let po = await PurchaseOrder.findOne({ poNumber: arg });
  if (!po && mongoose.isValidObjectId(arg)) {
    po = await PurchaseOrder.findById(arg);
  }

  if (!po) {
    console.error(`❌ No purchase order found matching "${arg}"`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found PO ${po.poNumber} (${po._id})`);
  console.log(`  current status: ${po.status}`);
  console.log(`  rejectionDetails:`, po.rejectionDetails);

  if (po.status !== 'draft') {
    console.log(`\nℹ️  This PO is not in 'draft' — nothing to fix (its status is already "${po.status}").`);
    await mongoose.disconnect();
    return;
  }

  const stage = po.rejectionDetails?.stage;
  if (!stage) {
    console.log('\nℹ️  This PO has no recorded rejection stage — I can\'t tell where to resume it. Leaving it untouched.');
    await mongoose.disconnect();
    return;
  }

  const levelMatch = typeof stage === 'string' ? stage.match(/^level_(\d+)$/) : null;
  const priorReason = po.rejectionDetails?.reason;
  const reasonSuffix = priorReason ? ` (was rejected: "${priorReason}")` : '';

  if (stage === 'supply_chain') {
    po.status = 'pending_supply_chain_assignment';
    po.progress = 8;
    po.activities.push({
      type: 'updated',
      description: `Manually resumed after being incorrectly reset to Draft${reasonSuffix} — sent back to Supply Chain for review`,
      user: 'System (repair script)',
      timestamp: new Date()
    });
    console.log('\n✅ Resuming at Supply Chain review stage.');
  } else if (levelMatch) {
    const level = parseInt(levelMatch[1], 10);
    const step = po.approvalChain?.find(s => s.level === level);
    if (!step) {
      console.log(`\n❌ Could not find approval-chain step for level ${level} on this PO. Leaving it untouched — please check manually.`);
      await mongoose.disconnect();
      return;
    }
    step.status = 'pending';
    step.actionDate = null;
    step.actionTime = null;
    step.comments = '';
    po.currentApprovalLevel = level;
    po.status = PO_LEVEL_STATUS[level] || po.status;
    po.progress = PO_LEVEL_PROGRESS[level] ?? po.progress;
    const roleLabel = PO_LEVEL_ROLE[level] || step.approver?.role || `Level ${level}`;
    po.activities.push({
      type: 'updated',
      description: `Manually resumed after being incorrectly reset to Draft${reasonSuffix} — restored to Level ${level} (${roleLabel}) for approval`,
      user: 'System (repair script)',
      timestamp: new Date()
    });
    console.log(`\n✅ Resuming at Level ${level} (${roleLabel}). Earlier approved levels are untouched.`);
  } else {
    console.log(`\nℹ️  Unrecognized rejection stage "${stage}" — leaving this PO untouched. Please check manually.`);
    await mongoose.disconnect();
    return;
  }

  await po.save();
  console.log(`\n✅ Saved. ${po.poNumber} is now status: ${po.status}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});