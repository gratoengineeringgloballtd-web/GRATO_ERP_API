/**
 * migrateDocumentsToArrays.js
 *
 * WHY THIS EXISTS
 * ----------------
 * Employee documents (National ID, Birth Certificate, Bank Attestation, Location Plan,
 * Medical Certificate, Criminal Record, Employment Contract) used to be stored as a single
 * embedded object per type - uploading a new one silently replaced (and deleted) whatever
 * was there before. That's been changed to an append-only array for every document type,
 * so nothing already on file is ever lost, and users can add as many documents as needed
 * over time without ever being able to delete one.
 *
 * That schema change means any EXISTING employee record that already has one of these
 * document types populated has data in the OLD shape (a single object), which no longer
 * matches the schema (which now expects an array for every type). This script finds every
 * such record and wraps the existing single document in a one-element array, so no data
 * is lost and every employee's document history reads correctly going forward.
 *
 * Safe to run multiple times - already-migrated (array) fields are left untouched.
 *
 * Usage:
 *   node scripts/migrateDocumentsToArrays.js
 *   node scripts/migrateDocumentsToArrays.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const DRY_RUN = process.argv.includes('--dry-run');

const DOCUMENT_FIELDS = [
  'nationalId', 'birthCertificate', 'bankAttestation', 'locationPlan',
  'medicalCertificate', 'criminalRecord', 'employmentContract'
  // references / academicDiplomas / workCertificates were already arrays - nothing to migrate there.
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN — no writes will be made)' : ''}\n`);

  // Read via the raw collection, not the Mongoose model, so we can inspect documents that
  // no longer match the current schema (the model would try to cast them on read and fail).
  const collection = mongoose.connection.collection('users');

  const candidates = await collection.find({
    'employmentDetails.documents': { $exists: true }
  }).toArray();

  console.log(`Found ${candidates.length} user(s) with employmentDetails.documents set.\n`);

  let migratedUsers = 0;
  let migratedFields = 0;

  for (const user of candidates) {
    const docs = user.employmentDetails?.documents;
    if (!docs) continue;

    const update = {};
    let needsUpdate = false;

    for (const field of DOCUMENT_FIELDS) {
      const value = docs[field];
      if (value && !Array.isArray(value)) {
        // Old shape: a single embedded object. Wrap it in an array, preserving all its data.
        update[`employmentDetails.documents.${field}`] = [value];
        needsUpdate = true;
        migratedFields++;
      }
      // If value is already an array, missing, or null/empty - nothing to do.
    }

    if (needsUpdate) {
      console.log(`${DRY_RUN ? '[dry-run] would update' : 'Updating'} ${user.email || user._id}: ${Object.keys(update).length} field(s)`);
      if (!DRY_RUN) {
        await collection.updateOne({ _id: user._id }, { $set: update });
      }
      migratedUsers++;
    }
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete' : 'Migration complete'}: ${migratedUsers} user(s), ${migratedFields} field(s) converted.`);
  if (DRY_RUN) console.log('Re-run without --dry-run to apply.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
