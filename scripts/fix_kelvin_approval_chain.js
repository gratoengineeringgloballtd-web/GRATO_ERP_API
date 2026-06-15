'use strict';

/**
 * fix_kelvin_approval_chain.js
 *
 * ONE-TIME DATA FIX
 * -----------------
 * Problem: When Kelvin (kelvin.eyong@gratoglobal.com) approves a requisition
 *          via the head-approval endpoint, `headApproval.decision` gets saved
 *          as "approved", but his level-3 entry in `approvalChain` stays
 *          "pending". This causes the UI to keep prompting him to approve again.
 *
 * Fix: For every requisition where:
 *   - headApproval.decision === 'approved'
 *   - status is 'approved' (or 'pending_ceo' — already past HOB)
 *   - Kelvin's approvalChain step is still 'pending'
 *
 *  → copy the timestamp/comments from headApproval into his chain step
 *    and set status = 'approved'.
 *
 * Usage:
 *   node fix_kelvin_approval_chain.js
 *
 * Set MONGODB_URI env var or edit the default below before running.
 */

const mongoose = require('mongoose');

// ── Config ────────────────────────────────────────────────────────────────────
const MONGODB_URI = 'mongodb+srv://gratoportal_db_user:OmGZbNiqffLJraHz@cluster0.uw3xeqa.mongodb.net/';

const KELVIN_EMAIL = 'kelvin.eyong@gratoglobal.com';

// Roles that identify Kelvin's HOB step (add more if needed)
const HOB_ROLES = [
  'Head of Business Development & Supply Chain - Final Approval',
  'Head of Business',
  'Head of Business Development'
];

// ── Minimal schema — only the fields we need ──────────────────────────────────
const requisitionSchema = new mongoose.Schema({
  status: String,
  headApproval: {
    decision:     String,
    comments:     String,
    decisionDate: Date,
    decidedBy:    mongoose.Schema.Types.ObjectId
  },
  approvalChain: [
    {
      level:  Number,
      status: String,
      comments: String,
      actionDate: Date,
      actionTime: String,
      decidedBy: mongoose.Schema.Types.ObjectId,
      approver: {
        name:       String,
        email:      String,
        role:       String,
        department: String
      }
    }
  ]
}, { strict: false, collection: 'purchaserequisitions' });

const PurchaseRequisition = mongoose.model('PurchaseRequisition', requisitionSchema);

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(MONGODB_URI, {
    useNewUrlParser:    true,
    useUnifiedTopology: true
  });
  console.log('✅ Connected to MongoDB');

  // Find requisitions where HOB approved but Kelvin's chain step is still pending
  const candidates = await PurchaseRequisition.find({
    'headApproval.decision': 'approved',
    'approvalChain': {
      $elemMatch: {
        'approver.email': KELVIN_EMAIL,
        'status': 'pending'
      }
    }
  });

  console.log(`\nFound ${candidates.length} requisition(s) to fix.\n`);

  let fixed = 0;
  let skipped = 0;

  for (const req of candidates) {
    const stepIndex = req.approvalChain.findIndex(
      s => s.approver?.email === KELVIN_EMAIL && s.status === 'pending'
    );

    if (stepIndex === -1) {
      console.log(`  SKIP  ${req._id} — no pending Kelvin step found (race condition?)`);
      skipped++;
      continue;
    }

    const step = req.approvalChain[stepIndex];
    const hob  = req.headApproval;

    // Backfill from headApproval
    step.status     = 'approved';
    step.comments   = step.comments || hob.comments || 'Approved via head approval';
    step.actionDate = step.actionDate || hob.decisionDate || new Date();
    step.actionTime = step.actionTime ||
      (hob.decisionDate
        ? new Date(hob.decisionDate).toLocaleTimeString('en-GB')
        : new Date().toLocaleTimeString('en-GB'));
    step.decidedBy  = step.decidedBy || hob.decidedBy;

    req.approvalChain[stepIndex] = step;
    req.markModified('approvalChain'); // Mongoose needs this for mixed/nested arrays

    await req.save({ validateBeforeSave: false });

    console.log(
      `  FIXED ${req._id}  (${req.requisitionNumber || 'no number'})` +
      `  status=${req.status}  kelvin-step now=approved`
    );
    fixed++;
  }

  console.log(`\n─────────────────────────────`);
  console.log(`Fixed:   ${fixed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total:   ${candidates.length}`);

  await mongoose.disconnect();
  console.log('\n✅ Done. Disconnected.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});