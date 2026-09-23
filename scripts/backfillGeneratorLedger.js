/**
 * backfillGeneratorLedger.js  (v2)
 * diesel-system/scripts/backfillGeneratorLedger.js
 *
 * Seeds GeneratorAssignmentLedger from the most recent Maintenance record
 * per site that has actual generator data in generators_checked[0].
 *
 * V2 FIX: The original $match used $ne: null on generators_checked fields,
 * which returns true even for documents where generators_checked is an empty
 * array [] — because MongoDB's dot-notation $exists/$ne on an array field
 * matches the field's existence, not its elements. The aggregate now filters
 * on { $gt: [{ $size: '$generators_checked' }, 0] } first, ensuring only
 * documents with at least one real generator subdocument are processed.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

const Maintenance               = require('../models/Maintenance');
const GeneratorAssignmentLedger = require('../models/GeneratorAssignmentLedger');
const SiteBudget                = require('../models/SiteBudget');
const DieselCycle               = require('../models/DieselCycle');

const CONFIRM = process.argv.includes('--confirm');

async function confirmPrompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

async function main() {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
  await mongoose.connect(mongoURI);
  console.log(`✓ Connected\n`);

  // Get latest Maintenance doc per site where generators_checked is a
  // non-empty array AND the first element has at least a brand or kva.
  // Uses aggregate so we can filter on array size before grouping.
  const latestPerSite = await Maintenance.aggregate([
    {
      $match: {
        // Only docs where generators_checked has at least 1 element
        $expr: { $gt: [{ $size: { $ifNull: ['$generators_checked', []] } }, 0] },
      },
    },
    {
      // Further filter: first element must have brand or kva (not just an
      // empty subdoc placeholder inserted by old app code)
      $match: {
        $or: [
          { 'generators_checked.0.brand': { $type: 'string' } },
          { 'generators_checked.0.kva':   { $type: 'number' } },
        ],
      },
    },
    { $sort: { visit_date: -1 } },
    {
      $group: {
        _id:         '$site_id',
        site_name:   { $first: '$site_name' },
        cluster:     { $first: '$site_metadata.cluster' },
        region:      { $first: '$site_metadata.state' },
        visit_date:  { $first: '$visit_date' },
        generator:   { $first: { $arrayElemAt: ['$generators_checked', 0] } },
        recorded_by: { $first: '$created_by' },
      },
    },
  ]);

  console.log(`Found ${latestPerSite.length} sites with real generator data in Maintenance.\n`);

  if (latestPerSite.length === 0) {
    console.log('No sites found. Check that GRATO data has been imported with source: data_collector_excel.');
    await mongoose.disconnect();
    return;
  }

  // Which sites already have a ledger entry — skip those
  const siteIds = latestPerSite.map(s => s._id);
  const existingLedgerSiteIds = new Set(
    await GeneratorAssignmentLedger.distinct('site_id', { site_id: { $in: siteIds } })
  );

  const toSeed = latestPerSite.filter(s => !existingLedgerSiteIds.has(s._id));
  const skippedExisting = latestPerSite.length - toSeed.length;

  console.log(`  ${skippedExisting} site(s) already have a ledger entry — left untouched.`);
  console.log(`  ${toSeed.length} site(s) will get a new seeded entry.\n`);

  if (toSeed.length === 0) {
    console.log('Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log('Preview (first 5):');
  for (const s of toSeed.slice(0, 5)) {
    console.log(
      `  ${s._id} (${s.site_name || '?'}) -> ` +
      `brand=${s.generator.brand || '?'} ` +
      `serial=${s.generator.serial_number || '?'} ` +
      `kva=${s.generator.kva ?? '?'} ` +
      `as of ${s.visit_date?.toISOString().slice(0, 10)}`
    );
  }
  console.log('');

  if (!CONFIRM) {
    console.log(`DRY RUN: ${toSeed.length} GeneratorAssignmentLedger entries would be created.`);
    console.log('Re-run with --confirm to actually create them:');
    console.log('  node scripts/backfillGeneratorLedger.js --confirm');
    await mongoose.disconnect();
    return;
  }

  const answer = await confirmPrompt(
    `\nType "SEED" (all caps) to create ${toSeed.length} entries: `
  );
  if (answer !== 'seed') {
    console.log('Aborted — no changes made.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n── Seeding ──────────────────────────────────────────────────────');
  let created = 0, skippedNoInfo = 0, errors = 0;

  for (const s of toSeed) {
    try {
      const gen = s.generator;
      if (!gen.brand && !gen.kva) { skippedNoInfo++; continue; }

      const assignedAt = s.visit_date || new Date();
      const cycleKey   = DieselCycle.getCycleKeyForDate(assignedAt);
      const budget     = await SiteBudget.findOne({ site_id: s._id, cycle_key: cycleKey }).lean();

      const generatorId = gen.serial_number
        || `UNKNOWN_${s._id}_${assignedAt.getTime()}`;

      await GeneratorAssignmentLedger.create({
        site_id:         s._id,
        site_name:       s.site_name,
        cluster:         s.cluster,
        region:          s.region,
        generator_id:    generatorId,
        generator_brand: gen.brand   || null,
        dg_kva:          gen.kva     ?? budget?.dg_kva ?? null,
        ccph:            budget?.ccph || null,
        assigned_at:     assignedAt,
        is_active:       true,
        assigned_reason: 'Backfilled from most recent GRATO visit (backfillGeneratorLedger.js)',
        cycles_affected: [cycleKey],
        recorded_by:     s.recorded_by,
      });
      created++;
    } catch (err) {
      errors++;
      console.error(`  ✗ ${s._id}: ${err.message}`);
    }
  }

  console.log(`\n✓ Done. ${created} entries created, ${skippedNoInfo} skipped (no usable info), ${errors} errors.`);
  console.log('After this, re-run reconciliation for the relevant cycle(s) to see generator data appear.');
  await mongoose.disconnect();
}

main().catch(err => { console.error('✗ Fatal:', err); process.exit(1); });












// /**
//  * backfillGeneratorLedger.js
//  * diesel-system/scripts/backfillGeneratorLedger.js
//  *
//  * WHY THIS EXISTS:
//  * GeneratorAssignmentLedger is populated ONLY through generatorSwapService.js's
//  * assignGenerator()/swapGenerator(), called manually via the Generator Ledger
//  * page. None of the five Excel importers (CMS, GRATO, Validation, Book11,
//  * Tom Card) ever write to it — by design, it's meant to be the authoritative,
//  * manually-curated record of which physical generator serial number is at
//  * which site. Since that page has never been used for this dataset, the
//  * ledger is empty for every site, which is why reconciliationService.js's
//  * `activeGen` always resolves to null and the dashboard shows "Generator: —"
//  * everywhere — that's a correct reflection of an empty collection, not a
//  * fetch bug.
//  *
//  * This script seeds a STARTING POINT so the dashboard isn't blank, by
//  * creating one active GeneratorAssignmentLedger entry per site from that
//  * site's MOST RECENT Maintenance.generators_checked[0] data (brand, serial
//  * number, KVA) — the same generator detail already captured on every GRATO/
//  * Validation visit. This is a reasonable inference (whatever generator was
//  * recorded on the last visit is presumably still there), NOT a substitute
//  * for actually using the Generator Ledger page going forward — once this
//  * backfill runs, real swaps should be recorded via assignGenerator/
//  * swapGenerator (or the Generator Ledger UI) so the ledger stays accurate
//  * over time. This script is meant to run ONCE, to remove the "everything
//  * shows — forever because nobody manually entered 249 sites" cold-start
//  * problem.
//  *
//  * SAFETY:
//  *  - Only creates a ledger entry for a site if one doesn't already exist
//  *    (checks for ANY existing entry — active or not — to avoid creating a
//  *    duplicate "initial" entry on top of real assignment history someone
//  *    may have already started entering).
//  *  - Skips sites where the most recent Maintenance record has no usable
//  *    generator info (no serial_number AND no brand) — there's nothing
//  *    meaningful to seed.
//  *  - assigned_at is backdated to that visit's visit_date, not "now" — so
//  *    the ledger's timeline reflects when we actually have evidence of that
//  *    generator, not the moment this script happened to run.
//  *  - ccph is pulled from SiteBudget for the cycle that visit_date falls in,
//  *    same as assignGenerator() does normally, so contractual-consumption
//  *    math has a real CCPH to work with rather than null.
//  *
//  * USAGE:
//  *   node scripts/backfillGeneratorLedger.js              # dry run, no writes
//  *   node scripts/backfillGeneratorLedger.js --confirm     # actually writes
//  */

// 'use strict';

// require('dotenv').config();
// const mongoose = require('mongoose');
// const readline = require('readline');

// const Maintenance               = require('../models/Maintenance');
// const GeneratorAssignmentLedger = require('../models/GeneratorAssignmentLedger');
// const SiteBudget                = require('../models/SiteBudget');
// const DieselCycle               = require('../models/DieselCycle');

// const CONFIRM = process.argv.includes('--confirm');

// async function confirmPrompt(question) {
//   const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
//   return new Promise(resolve => {
//     rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
//   });
// }

// async function main() {
//   const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
//   await mongoose.connect(mongoURI);
//   console.log(`✓ Connected to ${mongoURI}\n`);

//   // One record per site: the most recent visit with usable generator info.
//   // Sorted desc by visit_date so $first in the group gives the latest.
//   const latestPerSite = await Maintenance.aggregate([
//     {
//       $match: {
//         'generators_checked.0': { $exists: true },
//         $or: [
//           { 'generators_checked.0.serial_number': { $ne: null } },
//           { 'generators_checked.0.brand': { $ne: null } },
//         ],
//       },
//     },
//     { $sort: { visit_date: -1 } },
//     {
//       $group: {
//         _id: '$site_id',
//         site_name:    { $first: '$site_name' },
//         cluster:      { $first: '$site_metadata.cluster' },
//         region:       { $first: '$site_metadata.state' },
//         visit_date:   { $first: '$visit_date' },
//         generator:    { $first: { $arrayElemAt: ['$generators_checked', 0] } },
//         recorded_by:  { $first: '$created_by' },
//       },
//     },
//   ]);

//   console.log(`Found ${latestPerSite.length} sites with at least one Maintenance record carrying generator info.\n`);

//   // Find which of these sites ALREADY have a ledger entry (any status) —
//   // skip those entirely so we never duplicate or interfere with real data
//   // someone may have started entering manually.
//   const siteIds = latestPerSite.map(s => s._id);
//   const existingLedgerSiteIds = new Set(
//     await GeneratorAssignmentLedger.distinct('site_id', { site_id: { $in: siteIds } })
//   );

//   const toSeed = latestPerSite.filter(s => !existingLedgerSiteIds.has(s._id));
//   const skippedExisting = latestPerSite.length - toSeed.length;

//   console.log(`  ${skippedExisting} site(s) already have a ledger entry — left untouched.`);
//   console.log(`  ${toSeed.length} site(s) will get a new seeded entry.\n`);

//   if (toSeed.length === 0) {
//     console.log('Nothing to do.');
//     await mongoose.disconnect();
//     return;
//   }

//   // Preview a handful so it's obvious what's about to happen before confirming.
//   console.log('Preview (first 5):');
//   for (const s of toSeed.slice(0, 5)) {
//     console.log(
//       `  ${s._id} (${s.site_name || '?'}) -> ` +
//       `brand=${s.generator.brand || '?'} serial=${s.generator.serial_number || '?'} ` +
//       `kva=${s.generator.kva ?? '?'} as of ${s.visit_date?.toISOString().slice(0, 10)}`
//     );
//   }
//   console.log('');

//   if (!CONFIRM) {
//     console.log(`This was a DRY RUN. ${toSeed.length} ledger entries would be created.`);
//     console.log('Re-run with --confirm to actually create them:');
//     console.log('  node scripts/backfillGeneratorLedger.js --confirm');
//     await mongoose.disconnect();
//     return;
//   }

//   const answer = await confirmPrompt(
//     `\nType "SEED" (all caps) to create ${toSeed.length} GeneratorAssignmentLedger entries: `
//   );
//   if (answer !== 'seed') {
//     console.log('Aborted — no changes made.');
//     await mongoose.disconnect();
//     return;
//   }

//   console.log('\n── Seeding ──────────────────────────────────────────────────────');
//   let created = 0, skippedNoGenInfo = 0, errors = 0;

//   for (const s of toSeed) {
//     try {
//       const gen = s.generator;
//       if (!gen.serial_number && !gen.brand) { skippedNoGenInfo++; continue; }

//       const assignedAt = s.visit_date || new Date();
//       const cycleKey   = DieselCycle.getCycleKeyForDate(assignedAt);
//       const budget     = await SiteBudget.findOne({ site_id: s._id, cycle_key: cycleKey }).lean();

//       // generator_id has no dedicated "serial number" concept distinct from
//       // brand in the GRATO sheet's data — use serial_number if present,
//       // otherwise fall back to a synthetic id so the required field is
//       // never left empty (GeneratorAssignmentLedger.generator_id is required).
//       const generatorId = gen.serial_number || `UNKNOWN_${s._id}_${assignedAt.getTime()}`;

//       await GeneratorAssignmentLedger.create({
//         site_id:    s._id,
//         site_name:  s.site_name,
//         cluster:    s.cluster,
//         region:     s.region,
//         generator_id:    generatorId,
//         generator_brand: gen.brand || null,
//         dg_kva:          gen.kva ?? budget?.dg_kva ?? null,
//         ccph:            budget?.ccph || null,
//         assigned_at:     assignedAt,
//         is_active:       true,
//         assigned_reason: 'Backfilled from most recent GRATO/Validation visit (backfillGeneratorLedger.js)',
//         cycles_affected: [cycleKey],
//         recorded_by:     s.recorded_by,
//       });
//       created++;
//     } catch (err) {
//       errors++;
//       console.error(`  ✗ ${s._id}: ${err.message}`);
//     }
//   }

//   console.log(`\n✓ Done. ${created} ledger entries created, ${skippedNoGenInfo} skipped (no usable generator info), ${errors} errors.`);
//   console.log('Going forward, record real generator swaps via the Generator Ledger page (assignGenerator/swapGenerator) so this stays accurate.');

//   await mongoose.disconnect();
// }

// main().catch(err => {
//   console.error('✗ Fatal error:', err);
//   process.exit(1);
// });