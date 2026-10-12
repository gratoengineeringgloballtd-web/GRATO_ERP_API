/**
 * find-hr-documents-2.js — READ-ONLY. Finds exactly where the
 * "Mveyguere Moussa" and "Advance of salary" files actually live on
 * Berthin DEFFO's and Kevin Minka's profiles (built-in fields AND every
 * customDocuments section). Nothing is changed.
 *
 * Run FROM YOUR BACKEND ROOT:
 *   node scripts/find-hr-documents-2.js
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envCandidates = [path.join(process.cwd(), '.env'), path.join(__dirname, '.env')];
const envPath = envCandidates.find(p => fs.existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

const mongoose = require('mongoose');

const BUILT_IN_SECTIONS = [
  'nationalId', 'birthCertificate', 'bankAttestation', 'locationPlan',
  'medicalCertificate', 'criminalRecord', 'references', 'academicDiplomas',
  'workCertificates', 'employmentContract'
];

const LOOKUPS = [
  { employeeName: 'Berthin DEFFO', search: 'Mveyguere' },
  { employeeName: 'Kevin Minka', search: 'Advance of salary' }
];

function dumpAll(label, docsField, customField) {
  console.log(`\n  --- All documents on file for ${label} ---`);
  let any = false;
  for (const section of BUILT_IN_SECTIONS) {
    const arr = docsField?.[section];
    if (Array.isArray(arr) && arr.length > 0) {
      any = true;
      arr.forEach(d => console.log(`    documents.${section}: "${d.name}"`));
    }
  }
  for (const [key, value] of Object.entries(customField || {})) {
    if (Array.isArray(value) && value.length > 0) {
      any = true;
      value.forEach(d => console.log(`    customDocuments.${key}: "${d.name}"`));
    }
  }
  if (!any) console.log('    (no documents at all on this profile)');
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not found. Run this from your backend root.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const User = require('../models/User');

  for (const lookup of LOOKUPS) {
    console.log('\n' + '═'.repeat(70));
    console.log(`Employee: ${lookup.employeeName} — searching for "${lookup.search}"`);

    const employee = await User.findOne({ fullName: { $regex: lookup.employeeName, $options: 'i' } });
    if (!employee) {
      console.log('  ❌ Employee not found.');
      continue;
    }

    const docsField = employee.employmentDetails?.documents || {};
    const customField = employee.employmentDetails?.customDocuments || {};

    let found = false;
    for (const section of BUILT_IN_SECTIONS) {
      const arr = docsField[section];
      if (!Array.isArray(arr)) continue;
      arr.forEach(d => {
        if ((d.name || '').toLowerCase().includes(lookup.search.toLowerCase())) {
          found = true;
          console.log(`  📎 FOUND in documents.${section}: "${d.name}"`);
        }
      });
    }
    for (const [key, value] of Object.entries(customField)) {
      if (!Array.isArray(value)) continue;
      value.forEach(d => {
        if ((d.name || '').toLowerCase().includes(lookup.search.toLowerCase())) {
          found = true;
          console.log(`  📎 FOUND in customDocuments.${key}: "${d.name}"`);
        }
      });
    }
    if (!found) {
      console.log(`  ℹ️  Not found anywhere matching "${lookup.search}". Here is everything actually on file for this employee:`);
      dumpAll(lookup.employeeName, docsField, customField);
    }
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
