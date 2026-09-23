/**
 * findStaleCeoEscalations.js
 *
 * WHY THIS EXISTS
 * ----------------
 * The CEO approval threshold was recently fixed: cash_request had a duplicate-key bug
 * meaning the real threshold in effect was only 2,000 XAF (not the intended 500,000),
 * and purchase_requisition's threshold was raised from 100,000 to match the 500,000
 * policy. Every NEW request built after that fix correctly reflects the new threshold -
 * but requests that were already pending before the fix may still have a CEO step baked
 * into their approval chain from when the old, much lower threshold applied.
 *
 * This script finds those: still-pending requests, under the NEW 500,000 threshold,
 * that nonetheless have a CEO step somewhere in their approval chain. It does not
 * change anything by default - it's a visibility tool so you can decide what to do with
 * each one (leave it if CEO has already acted, or remove the step if it's still
 * pending and shouldn't require CEO under the corrected policy).
 *
 * WHAT COUNTS AS A MATCH
 * -----------------------
 *   - The request's overall status is still some 'pending_*' state (not yet fully
 *     approved, rejected, denied, disbursed, or completed).
 *   - Its approval chain includes a step where the approver's role mentions "CEO".
 *   - Its amount (amountRequested for cash requests, estimatedCost for purchase
 *     requisitions) is strictly below 500,000 XAF - i.e. it would NOT have gotten a
 *     CEO step at all under the corrected threshold.
 *
 * For each match, the report also shows whether the CEO step itself has already been
 * acted on (approved/rejected) or is still pending - since that changes what "fixing"
 * it would actually mean in practice.
 *
 * OPTIONAL FIX MODE (--fix)
 * --------------------------
 * When run with --fix, for every match where the CEO step is STILL PENDING (CEO hasn't
 * acted on it yet), the script removes that CEO step from the chain, renumbers the
 * remaining levels, and - if the CEO step was the current (first pending) step -
 * advances the request's status to 'approved'/'completed' as appropriate, since with
 * the CEO step gone there's nothing left pending. Never touches a request where CEO has
 * already approved or rejected - that's real history and shouldn't be rewritten.
 *
 * Usage:
 *   node scripts/findStaleCeoEscalations.js
 *   node scripts/findStaleCeoEscalations.js --fix
 *   node scripts/findStaleCeoEscalations.js --fix --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CashRequest = require('../models/CashRequest');
const PurchaseRequisition = require('../models/PurchaseRequisition');

const NEW_CEO_THRESHOLD = 500_000;
const FIX_MODE = process.argv.includes('--fix');
const DRY_RUN = process.argv.includes('--dry-run');

function isCeoStep(step) {
  return (step.approver?.role || '').toUpperCase().includes('CEO');
}

function formatAmount(n) {
  return `XAF ${Number(n || 0).toLocaleString()}`;
}

/**
 * Remove a still-pending CEO step from a chain, renumber the rest, and return the
 * status the request should move to if the CEO step was the current (first pending)
 * step - otherwise returns null (nothing else needs to change).
 */
function removeCeoStepAndGetNewStatus(chain, approvedTerminalStatus) {
  const ceoIndex = chain.findIndex(isCeoStep);
  if (ceoIndex === -1) return { chain, newStatus: null };

  const wasFirstPending = chain.findIndex(s => s.status === 'pending') === ceoIndex;
  chain.splice(ceoIndex, 1);
  chain.forEach((step, i) => { step.level = i + 1; });

  const stillPending = chain.some(s => s.status === 'pending');
  const newStatus = wasFirstPending && !stillPending ? approvedTerminalStatus : null;

  return { chain, newStatus };
}

async function checkCashRequests() {
  console.log('\n' + '='.repeat(70));
  console.log('CASH REQUESTS');
  console.log('='.repeat(70));

  const candidates = await CashRequest.find({
    status: { $regex: /^pending_/ },
    'approvalChain.approver.role': { $regex: /CEO/i }
  }).populate('employee', 'fullName email department');

  const matches = candidates.filter(r => (r.amountRequested || 0) < NEW_CEO_THRESHOLD);

  console.log(`Found ${matches.length} pending cash request(s) with a CEO step, under XAF ${NEW_CEO_THRESHOLD.toLocaleString()}:\n`);

  let fixed = 0;
  for (const r of matches) {
    const ceoStep = r.approvalChain.find(isCeoStep);
    console.log(`  - ${r.displayId || r._id} | ${r.employee?.fullName || 'Unknown'} | ${r.requestType} | ${formatAmount(r.amountRequested)} | CEO step: ${ceoStep.status}`);

    if (FIX_MODE && ceoStep.status === 'pending') {
      const { chain, newStatus } = removeCeoStepAndGetNewStatus(r.approvalChain, 'approved');
      console.log(`      ${DRY_RUN ? '[dry-run] would remove' : 'Removing'} CEO step${newStatus ? `, advancing status to '${newStatus}'` : ''}`);
      if (!DRY_RUN) {
        r.approvalChain = chain;
        if (newStatus) r.status = newStatus;
        await r.save();
      }
      fixed++;
    } else if (FIX_MODE && ceoStep.status !== 'pending') {
      console.log(`      Skipped - CEO already ${ceoStep.status} this, that's real history and won't be changed`);
    }
  }

  return { total: matches.length, fixed };
}

async function checkPurchaseRequisitions() {
  console.log('\n' + '='.repeat(70));
  console.log('PURCHASE REQUISITIONS');
  console.log('='.repeat(70));

  const candidates = await PurchaseRequisition.find({
    status: { $regex: /^pending_/ },
    'approvalChain.approver.role': { $regex: /CEO/i }
  }).populate('employee', 'fullName email department');

  const matches = candidates.filter(r => (r.estimatedCost || 0) < NEW_CEO_THRESHOLD);

  console.log(`Found ${matches.length} pending requisition(s) with a CEO step, under XAF ${NEW_CEO_THRESHOLD.toLocaleString()}:\n`);

  let fixed = 0;
  for (const r of matches) {
    const ceoStep = r.approvalChain.find(isCeoStep);
    console.log(`  - ${r.requisitionNumber || r._id} | ${r.employee?.fullName || 'Unknown'} | ${r.title || ''} | ${formatAmount(r.estimatedCost)} | CEO step: ${ceoStep.status}`);

    if (FIX_MODE && ceoStep.status === 'pending') {
      const { chain, newStatus } = removeCeoStepAndGetNewStatus(r.approvalChain, 'approved');
      console.log(`      ${DRY_RUN ? '[dry-run] would remove' : 'Removing'} CEO step${newStatus ? `, advancing status to '${newStatus}'` : ''}`);
      if (!DRY_RUN) {
        r.approvalChain = chain;
        if (newStatus) r.status = newStatus;
        await r.save();
      }
      fixed++;
    } else if (FIX_MODE && ceoStep.status !== 'pending') {
      console.log(`      Skipped - CEO already ${ceoStep.status} this, that's real history and won't be changed`);
    }
  }

  return { total: matches.length, fixed };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB${FIX_MODE ? (DRY_RUN ? ' (FIX MODE, DRY RUN — no writes will be made)' : ' (FIX MODE — will remove still-pending CEO steps)') : ' (report only — pass --fix to also correct these)'}`);

  const cashResult = await checkCashRequests();
  const reqResult = await checkPurchaseRequisitions();

  console.log('\n' + '='.repeat(70));
  console.log(`TOTAL: ${cashResult.total + reqResult.total} stale CEO escalation(s) found across both systems.`);
  if (FIX_MODE) {
    console.log(`${cashResult.fixed + reqResult.fixed} ${DRY_RUN ? 'would be' : 'were'} fixed (still-pending CEO steps only). Anything already decided by CEO was left untouched.`);
  } else {
    console.log('Re-run with --fix to remove still-pending CEO steps from these (add --dry-run to preview first).');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
