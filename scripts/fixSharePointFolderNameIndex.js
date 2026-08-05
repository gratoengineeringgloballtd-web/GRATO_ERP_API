/**
 * fixSharePointFolderNameIndex.js
 *
 * WHY THIS EXISTS
 * ----------------
 * SharePointFolder.name used to have a globally-unique index, which made nested
 * folders impossible in practice - you could never have "Reports" under both
 * Finance and HR, even in different parents. The schema now uses a compound
 * unique index on (parentFolder, name) instead, so siblings must have distinct
 * names but folders in different parents can share a name.
 *
 * Mongoose's autoIndex will create the new compound index automatically on next
 * connect, but it will NOT drop the old single-field unique index on `name` -
 * that has to be done explicitly. Until it's dropped, folder creation will keep
 * failing with a duplicate-key error on `name` alone, even for folders with
 * completely different parents.
 *
 * This script is idempotent - safe to run multiple times, and safe to run even
 * if the old index was already removed (it just logs that there was nothing to do).
 *
 * Usage:
 *   node scripts/fixSharePointFolderNameIndex.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/your-db-name';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  const collection = mongoose.connection.collection('sharepointfolders');
  const indexes = await collection.indexes();

  const staleIndex = indexes.find(
    (idx) => idx.unique && Object.keys(idx.key).length === 1 && idx.key.name === 1
  );

  if (!staleIndex) {
    console.log('No stale single-field unique index on `name` found - nothing to do.');
  } else {
    console.log(`Dropping stale index "${staleIndex.name}" (unique on name alone)...`);
    await collection.dropIndex(staleIndex.name);
    console.log('✅ Dropped.');
  }

  console.log('Ensuring the new compound index (parentFolder + name) exists...');
  await collection.createIndex({ parentFolder: 1, name: 1 }, { unique: true });
  console.log('✅ Compound unique index on (parentFolder, name) is in place.');

  const finalIndexes = await collection.indexes();
  console.log('\nCurrent indexes on sharepointfolders:');
  finalIndexes.forEach((idx) => console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}${idx.unique ? ' (unique)' : ''}`));

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
