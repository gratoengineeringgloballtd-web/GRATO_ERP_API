/**
 * backfillFieldVisitRecords.js
 * diesel-system/scripts/backfillFieldVisitRecords.js
 *
 * Populates FieldVisitRecord from every existing Maintenance document with
 * source: 'data_collector_excel' or 'validation_template_main'.
 *
 * Run this ONCE after deploying fieldVisitService.js to backfill historical
 * data. Safe to re-run — already-existing FieldVisitRecord docs (matched
 * by site_id + current_visit_date + source: 'grato_upload') are skipped.
 *
 * USAGE:
 *   node scripts/backfillFieldVisitRecords.js              # dry run
 *   node scripts/backfillFieldVisitRecords.js --confirm     # actually writes
 *   node scripts/backfillFieldVisitRecords.js --confirm --cycle=2026-06
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { backfillFromMaintenance } = require('../services/fieldVisitService');

const CONFIRM  = process.argv.includes('--confirm');
const cycleArg = process.argv.find(a => a.startsWith('--cycle='));
const CYCLE    = cycleArg ? cycleArg.split('=')[1] : null;

async function main() {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
  await mongoose.connect(mongoURI);
  console.log(`✓ Connected\n  Scope: ${CYCLE ? `cycle ${CYCLE}` : 'ALL cycles'}\n`);

  if (!CONFIRM) {
    const Maintenance = require('../models/Maintenance');
    const filter = { source: { $in: ['data_collector_excel', 'validation_template_main'] } };
    if (CYCLE) {
      const DieselCycle = require('../models/DieselCycle');
      const cycleDoc = await DieselCycle.findOne({ cycle_key: CYCLE }).lean();
      if (!cycleDoc) { console.error(`No DieselCycle for ${CYCLE}`); process.exit(1); }
      filter.visit_date = { $gte: cycleDoc.start_date, $lte: cycleDoc.end_date };
    }
    const count = await Maintenance.countDocuments(filter);
    console.log(`DRY RUN: ${count} Maintenance docs would be processed.`);
    console.log('Re-run with --confirm to actually create FieldVisitRecords.');
    await mongoose.disconnect();
    return;
  }

  const result = await backfillFromMaintenance(CYCLE);
  console.log(`\n✓ Done: ${result.created} created, ${result.skipped} skipped (already existed), ${result.errors} errors`);
  await mongoose.disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });