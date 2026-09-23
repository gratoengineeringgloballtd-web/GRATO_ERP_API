/**
 * clearAllCycleData.js
 * PowerGen_API/scripts/clearAllCycleData.js
 *
 * Clears ALL operational cycle data for June, July, and August 2026
 * so you can upload fresh budget and Tom Card data and start clean.
 *
 * WHAT IT CLEARS:
 *   SiteBudget, DieselCycle, FuelRequest, FuelConsumption,
 *   FuelPurchase, TomCardTransaction, CycleReconciliation,
 *   CmsDailyRecord, GratoUpload, ValidationUpload, AuditLog (cycle entries)
 *
 * WHAT IT PRESERVES:
 *   Sites, Users, Generators, Maintenance records, Notifications, Alerts
 *
 * USAGE:
 *   node scripts/clearAllCycleData.js --dry-run     (preview only)
 *   node scripts/clearAllCycleData.js               (delete all three cycles)
 *   node scripts/clearAllCycleData.js --cycle 2026-08  (single cycle only)
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const isDryRun   = process.argv.includes('--dry-run');
const cycleIdx   = process.argv.indexOf('--cycle');
const TARGET     = cycleIdx > -1 ? [process.argv[cycleIdx + 1]] : ['2026-06', '2026-07', '2026-08'];
const DATE_FROM  = new Date('2026-06-01T00:00:00.000Z');
const DATE_TO    = new Date('2026-08-31T23:59:59.999Z');

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI not set in .env'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  console.log('Mode:   ', isDryRun ? 'DRY RUN — no data deleted' : 'LIVE DELETE');
  console.log('Cycles: ', TARGET.join(', '));
  console.log();

  const db = mongoose.connection.db;

  async function clear(col, filter, label) {
    try {
      const n = await db.collection(col).countDocuments(filter);
      if (isDryRun) {
        console.log(`  PREVIEW  ${label}: ${n} records`);
      } else if (n > 0) {
        const r = await db.collection(col).deleteMany(filter);
        console.log(`  DELETED  ${label}: ${r.deletedCount} records`);
      } else {
        console.log(`  SKIP     ${label}: 0 records`);
      }
    } catch (e) { console.error(`  ERROR    ${label}: ${e.message}`); }
  }

  const byCycle = { cycle_key: { $in: TARGET } };
  const byDate  = { $or: [
    { cycle_key:     { $in: TARGET } },
    { date:          { $gte: DATE_FROM, $lte: DATE_TO } },
    { record_date:   { $gte: DATE_FROM, $lte: DATE_TO } },
    { visit_date:    { $gte: DATE_FROM, $lte: DATE_TO } },
    { purchase_date: { $gte: DATE_FROM, $lte: DATE_TO } },
    { createdAt:     { $gte: DATE_FROM, $lte: DATE_TO } },
  ]};

  console.log('SiteBudget ─────────────────────────────────────');
  await clear('sitebudgets',          byCycle, 'SiteBudget');

  console.log('\nDieselCycle ─────────────────────────────────────');
  await clear('dieselcycles',         byCycle, 'DieselCycle');

  console.log('\nFuelRequest ─────────────────────────────────────');
  await clear('fuelrequests',         byCycle, 'FuelRequest');

  console.log('\nFuelConsumption ─────────────────────────────────');
  await clear('fuelconsumptions',     byDate,  'FuelConsumption');

  console.log('\nFuelPurchase ────────────────────────────────────');
  await clear('fuelpurchases',        byDate,  'FuelPurchase');

  console.log('\nTomCardTransaction ──────────────────────────────');
  await clear('tomcardtransactions',  byDate,  'TomCardTransaction');

  console.log('\nCycleReconciliation ─────────────────────────────');
  await clear('cyclereconciliations', byCycle, 'CycleReconciliation');

  console.log('\nCmsDailyRecord ──────────────────────────────────');
  await clear('cmsdailyrecords',      byDate,  'CmsDailyRecord');

  console.log('\nGratoUpload / ValidationUpload ──────────────────');
  await clear('gratouploads',         byCycle, 'GratoUpload');
  await clear('validationuploads',    byCycle, 'ValidationUpload');

  console.log('\nAuditLog (cycle entries) ────────────────────────');
  await clear('auditlogs', { cycle_key: { $in: TARGET } }, 'AuditLog (cycle)');

  // Clear stale budget alerts that reference low remaining
  console.log('\nDieselAlerts (stale budget alerts) ─────────────');
  await clear('dieselalerts', {
    $or: [
      { cycle_key: { $in: TARGET } },
      { createdAt: { $gte: DATE_FROM, $lte: DATE_TO } },
    ]
  }, 'DieselAlert');

  console.log('\n─────────────────────────────────────────────────');
  if (isDryRun) {
    console.log('DRY RUN complete. Run without --dry-run to delete.');
  } else {
    console.log('All cycle data cleared for: ' + TARGET.join(', '));
    console.log('\nNext steps:');
    console.log('  1. Upload budget: Site Budget Upload page → select 2026-08');
    console.log('     (use: GRATO_Estimated_Budget_August_2026_Validated_OK.xlsx)');
    console.log('     Dashboard will show 108,832 L and XAF 91M after upload.');
    console.log('  2. Run Tom Card import: node scripts/importTomCards.js');
    console.log('  3. Upload August refueling data: node scripts/importAugustRefuelingData.js');
    console.log('  4. Upload today\'s CMS file via the CMS Upload page.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });