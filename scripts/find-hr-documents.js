/**
 * find-hr-documents.js
 *
 * READ-ONLY diagnostic. Helps pin down the exact employee name/spelling and
 * which employee actually owns a given document, before running
 * delete-hr-documents.js. Does not change anything.
 *
 * Run FROM YOUR BACKEND ROOT (same folder as package.json / .env):
 *
 *   node scripts/find-hr-documents.js
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envCandidates = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env')
];
const envPath = envCandidates.find(p => fs.existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

const mongoose = require('mongoose');

// Loosen the name search to single tokens so a mismatched word order or an
// extra/missing middle name still finds the employee.
const NAME_TOKENS = ['Deffo', 'Berthin', 'Minka', 'Kevin'];

// Search every employee's documents (built-in + custom) for a filename
// containing this, to find out who actually owns it.
const DOCUMENT_NAME_SEARCH = 'AKONGBO';

const BUILT_IN_SECTIONS = [
  'nationalId', 'birthCertificate', 'bankAttestation', 'locationPlan',
  'medicalCertificate', 'criminalRecord', 'references', 'academicDiplomas',
  'workCertificates', 'employmentContract'
];

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not found. Run this from your backend root (same folder as your .env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const User = require('../models/User');

  console.log('═══ PART 1: Name lookups ═══');
  for (const token of NAME_TOKENS) {
    const matches = await User.find({ fullName: { $regex: token, $options: 'i' } }).select('fullName email employmentDetails.employeeId');
    console.log(`\n"${token}" →`);
    if (matches.length === 0) {
      console.log('  (no employee found)');
    } else {
      matches.forEach(m => console.log(`  - ${m.fullName}  (${m._id})  ${m.email || ''}  empId:${m.employmentDetails?.employeeId || '-'}`));
    }
  }

  console.log('\n\n═══ PART 2: Who owns a document matching "' + DOCUMENT_NAME_SEARCH + '"? ═══');
  const allEmployees = await User.find({
    $or: [
      { 'employmentDetails.documents': { $exists: true } },
      { 'employmentDetails.customDocuments': { $exists: true } }
    ]
  }).select('fullName email employmentDetails.documents employmentDetails.customDocuments');

  let found = false;
  for (const emp of allEmployees) {
    const docs = emp.employmentDetails?.documents || {};
    for (const section of BUILT_IN_SECTIONS) {
      const arr = docs[section];
      if (!Array.isArray(arr)) continue;
      arr.forEach(d => {
        if ((d.name || '').toLowerCase().includes(DOCUMENT_NAME_SEARCH.toLowerCase())) {
          found = true;
          console.log(`  📎 ${emp.fullName} (${emp._id}) → documents.${section} → "${d.name}" (id: ${d._id}, uploaded: ${d.uploadedAt})`);
        }
      });
    }
    const custom = emp.employmentDetails?.customDocuments || {};
    for (const [key, value] of Object.entries(custom)) {
      if (!Array.isArray(value)) continue;
      value.forEach(d => {
        if ((d.name || '').toLowerCase().includes(DOCUMENT_NAME_SEARCH.toLowerCase())) {
          found = true;
          console.log(`  📎 ${emp.fullName} (${emp._id}) → customDocuments.${key} → "${d.name}" (uploaded: ${d.uploadedAt})`);
        }
      });
    }
  }
  if (!found) console.log('  (no document found matching that name anywhere)');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
