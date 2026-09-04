/**
 * removeJosephFromApprovalChains.js
 *
 * WHY THIS EXISTS
 * ----------------
 * Joseph Tayou has left the company. His direct reports (10 Field Technicians) now
 * report directly to Pascal Assam - that's already fixed at the source in
 * config/departmentStructure.js, so every NEW approval chain built from now on will
 * correctly skip him and route straight to Pascal.
 *
 * That doesn't touch chains that were already built and saved to the database before
 * this change - those still have Joseph baked in as a named approval step, and any of
 * them still sitting at his step would be stuck forever (nobody can ever act as him
 * again). This script finds and fixes those.
 *
 * WHAT IT DOES
 * ------------
 * For every CashRequest and PurchaseRequisition where Joseph Tayou
 * (joseph.tayou@gratoglobal.com) appears in approvalChain:
 *   - If his step has already been decided (approved/rejected), it's left untouched -
 *     that's real history and shouldn't be rewritten.
 *   - If his step is still 'pending', it's removed entirely and every subsequent step's
 *     `level` is renumbered to close the gap. Since "current step" is determined by
 *     `.find(step => step.status === 'pending')` - the first pending step in array
 *     order - removing his step automatically makes the next one (now Pascal's, for
 *     anyone who used to report to Joseph) immediately actionable.
 *
 * Only ever removes a PENDING Joseph step. Never touches decided ones, and never
 * touches a document where Joseph isn't present at all.
 *
 * Also deactivates Joseph's own User account (isActive: false) by default, since he's
 * left the company - never deletes it, so his historical approvals/records stay intact.
 * Skip this with --skip-deactivate if you're not ready for that yet.
 *
 * Usage:
 *   node scripts/removeJosephFromApprovalChains.js
 *   node scripts/removeJosephFromApprovalChains.js --dry-run
 *   node scripts/removeJosephFromApprovalChains.js --id 6a9057a6adac56921e14bc51
 *   node scripts/removeJosephFromApprovalChains.js --skip-deactivate
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CashRequest = require('../models/CashRequest');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');

const DRY_RUN = process.argv.includes('--dry-run');
const idFlagIndex = process.argv.indexOf('--id');
const ONLY_ID = idFlagIndex !== -1 ? process.argv[idFlagIndex + 1] : null;
const SKIP_DEACTIVATE = process.argv.includes('--skip-deactivate');

const JOSEPH_EMAIL = 'joseph.tayou@gratoglobal.com';

/**
 * Deactivate Joseph's own account, since he's left the company. Never deletes it -
 * his historical approvals/records stay intact, this just prevents login and removes
 * him from active-user lookups going forward.
 */
async function deactivateJoseph() {
  const user = await User.findOne({ email: JOSEPH_EMAIL });
  if (!user) {
    console.log(`\nNo User account found for ${JOSEPH_EMAIL} - nothing to deactivate.`);
    return;
  }
  if (!user.isActive) {
    console.log(`\n${JOSEPH_EMAIL}'s account is already inactive.`);
    return;
  }
  console.log(`\n${DRY_RUN ? '[dry-run] would deactivate' : 'Deactivating'} account: ${user.fullName} (${user.email})`);
  if (!DRY_RUN) {
    user.isActive = false;
    await user.save();
  }
}

/**
 * Remove a pending Joseph step from a single document's approval chain (mutates in
 * place) and renumber subsequent levels. Returns true if a change was made.
 */
function stripJosephFromChain(doc, chainField) {
  const chain = doc[chainField];
  if (!chain || chain.length === 0) return false;

  const josephIndex = chain.findIndex(
    step => step.approver?.email?.toLowerCase() === JOSEPH_EMAIL
  );
  if (josephIndex === -1) return false;

  const josephStep = chain[josephIndex];
  if (josephStep.status !== 'pending') {
    console.log(`  - Joseph's step on ${chainField} is already "${josephStep.status}" - leaving as historical record, not removing.`);
    return false;
  }

  console.log(`  - Removing Joseph's pending step (was level ${josephStep.level}) from ${chainField}`);
  chain.splice(josephIndex, 1);

  // Renumber remaining levels to close the gap (level field is used for display/audit
  // and some role-specific lookups elsewhere in the app - not strictly required for
  // "current step" resolution, which just walks the array in order, but keeping it
  // accurate matters for anything that reads level directly).
  chain.forEach((step, i) => { step.level = i + 1; });

  // The new first step (whoever was right after Joseph) becomes immediately
  // actionable - set its assignedDate if it wasn't already, matching how a step
  // normally gets activated when the chain advances to it.
  if (chain[josephIndex] && !chain[josephIndex].assignedDate) {
    chain[josephIndex].assignedDate = new Date();
  }

  return true;
}

async function processModel(Model, modelName, chainFields) {
  const query = ONLY_ID
    ? { _id: ONLY_ID }
    : { $or: chainFields.map(f => ({ [`${f}.approver.email`]: JOSEPH_EMAIL })) };

  const docs = await Model.find(query);
  console.log(`\n${modelName}: found ${docs.length} document(s) to check`);

  let fixed = 0;
  for (const doc of docs) {
    let changed = false;
    for (const field of chainFields) {
      if (stripJosephFromChain(doc, field)) changed = true;
    }
    if (changed) {
      const label = doc.requisitionNumber || doc.displayId || doc._id;
      console.log(`  ${DRY_RUN ? '[dry-run] would save' : 'Saving'}: ${modelName} ${label}`);
      if (!DRY_RUN) await doc.save();
      fixed++;
    }
  }
  console.log(`${modelName}: ${fixed} document(s) ${DRY_RUN ? 'would be' : 'were'} fixed`);
  return fixed;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN — no writes will be made)' : ''}`);
  if (ONLY_ID) console.log(`Scoped to a single document: ${ONLY_ID}`);

  const cashFixed = await processModel(CashRequest, 'CashRequest', ['approvalChain', 'justificationApprovalChain']);
  const reqFixed = await processModel(PurchaseRequisition, 'PurchaseRequisition', ['approvalChain']);

  if (!SKIP_DEACTIVATE) {
    await deactivateJoseph();
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete' : 'Done'}: ${cashFixed + reqFixed} document(s) total.`);
  if (DRY_RUN) console.log('Re-run without --dry-run to apply.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
