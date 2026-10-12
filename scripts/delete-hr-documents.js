/**
 * delete-hr-documents.js
 *
 * Removes specific duplicate/misfiled documents from employee HR profiles
 * (employmentDetails.documents / employmentDetails.customDocuments on the
 * User model), including deleting the file from Cloudinary.
 *
 * Connects straight to MongoDB — no API/auth token needed, same pattern as
 * resume-po-at-rejected-level.js / restart-po-approval-chain.js.
 *
 * ─── SAFETY ───────────────────────────────────────────────────────────
 * By default this is a DRY RUN: it only finds and prints what matches each
 * target below — nothing is deleted. Review the printed matches carefully.
 * Only when you re-run it with --confirm does it actually delete.
 *
 *   node scripts/delete-hr-documents.js            → dry run (lists matches)
 *   node scripts/delete-hr-documents.js --confirm   → actually deletes
 *
 * Run this FROM YOUR BACKEND ROOT (same folder as package.json / .env).
 *
 * ─── TARGETS ──────────────────────────────────────────────────────────
 * Edit this list if you need to adjust who/what is targeted before running.
 * `section` is one of the 10 built-in document fields (nationalId,
 * birthCertificate, bankAttestation, locationPlan, medicalCertificate,
 * criminalRecord, references, academicDiplomas, workCertificates,
 * employmentContract) or 'custom' to search every customDocuments section
 * (e.g. Marriage Certificate, Medical Reimbursement File) for this employee.
 * `matchContains` is matched case-insensitively against the document's name.
 */

const TARGETS = [
  {
    employeeName: 'Berthin DEFFO',
    section: 'custom',
    customKey: 'nationalid', // custom section (lowercase "nationalid"), distinct from the built-in "nationalId" field
    matchContains: 'Mveyguere Moussa'
  },
  {
    employeeName: 'Kevin Minka',
    section: 'custom',
    // Restricted to this exact key: "Advance of salary - Minka Kevin.pdf" also exists
    // correctly filed under customDocuments.advance_of_salary — that copy must stay.
    customKey: 'nationalid',
    matchContains: 'Advance of salary'
  },
  {
    employeeName: 'Bruiline Tsitoh',
    section: 'custom', // already deleted — kept here only as a record; will no-op (no match) on re-run
    matchContains: 'AKONGBO'
  },
  {
    employeeName: 'Bruiline Tsitoh',
    section: 'custom', // already deleted — kept here only as a record; will no-op (no match) on re-run
    matchContains: '20260713'
  }
];

const BUILT_IN_SECTIONS = [
  'nationalId', 'birthCertificate', 'bankAttestation', 'locationPlan',
  'medicalCertificate', 'criminalRecord', 'references', 'academicDiplomas',
  'workCertificates', 'employmentContract'
];

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

async function main() {
  const confirm = process.argv.includes('--confirm');

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not found. Run this from your backend root (same folder as your .env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log(`✅ Connected to MongoDB\n`);
  console.log(confirm ? '⚠️  RUNNING IN DELETE MODE (--confirm)\n' : 'ℹ️  DRY RUN — nothing will be deleted. Re-run with --confirm to actually delete.\n');

  const User = require('../models/User');
  const { deleteFile } = require('../utils/cloudinaryStorage');

  let totalMatched = 0;
  let totalDeleted = 0;

  for (const target of TARGETS) {
    console.log('─'.repeat(70));
    console.log(`Target: "${target.employeeName}" → section "${target.section}" → contains "${target.matchContains}"`);

    const employees = await User.find({
      fullName: { $regex: target.employeeName, $options: 'i' }
    });

    if (employees.length === 0) {
      console.log(`  ❌ No employee found matching "${target.employeeName}". Skipping.`);
      continue;
    }
    if (employees.length > 1) {
      console.log(`  ⚠️  ${employees.length} employees matched "${target.employeeName}" — skipping to avoid acting on the wrong one:`);
      employees.forEach(e => console.log(`     - ${e.fullName} (${e._id}) ${e.email || ''}`));
      continue;
    }

    const employee = employees[0];
    console.log(`  Employee: ${employee.fullName} (${employee._id}) ${employee.email || ''}`);

    const matches = []; // { arrayRef, index, doc, location }

    if (target.section === 'custom') {
      const custom = employee.employmentDetails?.customDocuments || {};
      const keysToSearch = target.customKey ? [target.customKey] : Object.keys(custom);
      for (const key of keysToSearch) {
        const value = custom[key];
        if (!Array.isArray(value)) continue;
        value.forEach((doc, index) => {
          if ((doc.name || '').toLowerCase().includes(target.matchContains.toLowerCase())) {
            matches.push({ arrayRef: value, index, doc, location: `customDocuments.${key}` });
          }
        });
      }
    } else if (BUILT_IN_SECTIONS.includes(target.section)) {
      const arr = employee.employmentDetails?.documents?.[target.section];
      if (Array.isArray(arr)) {
        arr.forEach((doc, index) => {
          if ((doc.name || '').toLowerCase().includes(target.matchContains.toLowerCase())) {
            matches.push({ arrayRef: arr, index, doc, location: `documents.${target.section}` });
          }
        });
      }
    } else {
      console.log(`  ❌ Unknown section "${target.section}". Skipping.`);
      continue;
    }

    if (matches.length === 0) {
      console.log(`  ℹ️  No document matching "${target.matchContains}" found in ${target.section}.`);
      continue;
    }

    matches.forEach(m => {
      console.log(`  📎 MATCH in ${m.location}: "${m.doc.name}" (id: ${m.doc._id}, uploaded: ${m.doc.uploadedAt}, url: ${m.doc.url || '(no url)'})`);
    });
    totalMatched += matches.length;

    if (!confirm) continue;

    // Delete highest index first so earlier indices in the same array stay valid.
    const sorted = [...matches].sort((a, b) => b.index - a.index);
    for (const m of sorted) {
      if (m.doc.url && m.doc.url.startsWith('http')) {
        const result = await deleteFile(m.doc);
        console.log(result.success
          ? `  🗑️  Deleted from Cloudinary: ${m.doc.name}`
          : `  ⚠️  Cloudinary deletion failed for ${m.doc.name}: ${result.error} (continuing — removing from the record anyway)`);
      }
      m.arrayRef.splice(m.index, 1);
      totalDeleted++;
    }

    employee.markModified('employmentDetails');
    await employee.save();
    console.log(`  ✅ Saved ${employee.fullName}'s profile.`);
  }

  console.log('─'.repeat(70));
  console.log(confirm
    ? `\n✅ Done. ${totalDeleted} document(s) deleted.`
    : `\nℹ️  Dry run complete. ${totalMatched} document(s) matched. Re-run with --confirm to delete them.`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
