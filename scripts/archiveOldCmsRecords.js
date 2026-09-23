/**
 * archiveOldCmsRecords.js
 * PowerGen_API/scripts/archiveOldCmsRecords.js
 *
 * Moves CmsDailyRecord documents older than ARCHIVE_MONTHS months
 * to a separate CmsDailyRecordArchive collection.
 * Run monthly via cron or manually.
 *
 * USAGE:
 *   node scripts/archiveOldCmsRecords.js               # archive records older than 6 months
 *   node scripts/archiveOldCmsRecords.js --months 3    # archive older than 3 months
 *   node scripts/archiveOldCmsRecords.js --dry-run     # preview only
 */
'use strict';
require('dotenv').config();
const mongoose = require('mongoose');

const isDryRun = process.argv.includes('--dry-run');
const monthsIdx = process.argv.indexOf('--months');
const ARCHIVE_MONTHS = monthsIdx > -1 ? parseInt(process.argv[monthsIdx + 1]) : 6;

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_MONTHS);
  console.log('Archiving CmsDailyRecords older than:', cutoff.toDateString());
  console.log('Mode:', isDryRun ? 'DRY RUN' : 'LIVE');

  const count = await db.collection('cmsdailyrecords').countDocuments({ record_date: { $lt: cutoff } });
  console.log('Records to archive:', count);

  if (!isDryRun && count > 0) {
    // Batch move: read → write to archive → delete from hot
    const BATCH = 1000;
    let archived = 0;
    while (archived < count) {
      const batch = await db.collection('cmsdailyrecords')
        .find({ record_date: { $lt: cutoff } })
        .limit(BATCH).toArray();
      if (!batch.length) break;
      await db.collection('cmsdailyrecords_archive').insertMany(batch, { ordered: false });
      const ids = batch.map(d => d._id);
      await db.collection('cmsdailyrecords').deleteMany({ _id: { $in: ids } });
      archived += batch.length;
      console.log('Archived:', archived, '/', count);
    }
    console.log('Done. Run a MongoDB index rebuild on cmsdailyrecords for best performance.');
  } else if (isDryRun) {
    console.log('DRY RUN — no data moved.');
  }
  await mongoose.disconnect();
  process.exit(0);
}
run().catch(err => { console.error(err); process.exit(1); });
