/**
 * migrate-departments.js
 * 
 * Run ONCE after deploying the updated model.
 * Fixes any SharePointFolder documents whose `department` field uses the
 * old enum values (e.g. 'Supply Chain') so they pass the new enum validation.
 *
 * Usage:
 *   node scripts/migrate-departments.js
 */


require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/your-db-name';

const VALID_DEPARTMENTS = ['IT', 'Technical', 'Business Development & Supply Chain', 'HR & Admin', 'Finance', 'Company', 'Other'];

// Map every old value that might exist → new canonical value
const REMAP = {
  'Supply Chain':              'Business Development & Supply Chain',
  'Business Development':      'Business Development & Supply Chain',
  'BD & Supply Chain':         'Business Development & Supply Chain',
  'HR':                        'HR & Admin',
  'Human Resources':           'HR & Admin',
  'Admin':                     'HR & Admin',
  'Information Technology':    'IT',
  'Finance & Accounting':      'Finance',
  'General':                   'Other',
  'Management':                'Company'
};

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  const col = mongoose.connection.collection('sharepointfolders');
  const folders = await col.find({}).toArray();
  console.log(`Found ${folders.length} folders`);

  let updated = 0, skipped = 0, manual = [];

  for (const f of folders) {
    if (VALID_DEPARTMENTS.includes(f.department)) { skipped++; continue; }

    const mapped = REMAP[f.department];
    if (mapped) {
      await col.updateOne({ _id: f._id }, { $set: { department: mapped } });
      console.log(`  ✔ "${f.name}": "${f.department}" → "${mapped}"`);
      updated++;
    } else {
      manual.push({ name: f.name, id: f._id, was: f.department });
    }
  }

  console.log(`\n=== Done: ${updated} updated, ${skipped} already valid ===`);
  if (manual.length) {
    console.log(`\n⚠️  ${manual.length} folder(s) need manual attention:`);
    manual.forEach(x => console.log(`   id=${x.id}  name="${x.name}"  department="${x.was}"`));
    console.log('\nAdd entries to REMAP and re-run, or update the documents manually.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });