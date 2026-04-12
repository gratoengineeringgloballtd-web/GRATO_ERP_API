/**
 * diagnostic.js — Run once from your project root to diagnose the 404 issue
 * 
 * Usage:
 *   node diagnostic.js
 * 
 * What it does:
 *   1. Connects to MongoDB (reads your existing .env / mongoose config)
 *   2. Finds all purchase requisitions with attachments
 *   3. Checks whether each stored localPath actually exists on disk
 *   4. Searches the uploads directory for the file by publicId/name
 *   5. Prints a clear report and optionally patches stale paths
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

// ── adjust this if your model path differs ──────────────────────────────────
const PurchaseRequisition = require('../models/PurchaseRequisition');
// ────────────────────────────────────────────────────────────────────────────

const UPLOADS_ROOT = path.resolve(__dirname, 'uploads');

/** Recursively walk a directory and return all file paths */
function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else results.push(full);
  }
  return results;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // Build an index of all files in uploads/ keyed by filename
  console.log('📂 Scanning uploads directory:', UPLOADS_ROOT);
  const allFiles = walk(UPLOADS_ROOT);
  const byName = {};
  for (const f of allFiles) byName[path.basename(f)] = f;
  console.log(`   Found ${allFiles.length} file(s) on disk\n`);

  // Fetch requisitions that have at least one attachment
  const docs = await PurchaseRequisition.find({ 'attachments.0': { $exists: true } })
    .select('requisitionNumber attachments')
    .lean();

  console.log(`📋 Found ${docs.length} requisition(s) with attachments\n`);

  let totalAttachments = 0;
  let broken = 0;
  const fixes = []; // { docId, attId, newPath }

  for (const doc of docs) {
    for (const att of doc.attachments) {
      totalAttachments++;
      const stored  = att.localPath || '';
      const exists  = stored && fs.existsSync(stored);

      if (exists) {
        console.log(`  ✅  ${doc.requisitionNumber} | ${att.name}`);
        console.log(`       stored:  ${stored}`);
      } else {
        broken++;
        console.log(`  ❌  ${doc.requisitionNumber} | ${att.name}`);
        console.log(`       stored:  ${stored || '(empty)'}`);
        console.log(`       exists:  false`);

        // Try to locate file by publicId or original name
        const candidates = [att.publicId, att.name].filter(Boolean);
        let found = null;
        for (const c of candidates) {
          if (byName[c]) { found = byName[c]; break; }
        }

        if (found) {
          console.log(`       FOUND:   ${found}  ← can be patched`);
          fixes.push({ docId: doc._id, attId: att._id, newPath: found });
        } else {
          console.log(`       SEARCH:  not found in uploads/`);
        }
      }
      console.log();
    }
  }

  console.log('─'.repeat(60));
  console.log(`Total attachments : ${totalAttachments}`);
  console.log(`Broken paths      : ${broken}`);
  console.log(`Auto-fixable      : ${fixes.length}`);
  console.log('─'.repeat(60));

  // ── Optional: patch stale paths in MongoDB ─────────────────────────────
  if (fixes.length > 0) {
    const answer = process.argv.includes('--fix');
    if (answer) {
      console.log('\n🔧 Applying patches...\n');
      for (const fix of fixes) {
        await PurchaseRequisition.updateOne(
          { _id: fix.docId, 'attachments._id': fix.attId },
          { $set: { 'attachments.$.localPath': fix.newPath } }
        );
        console.log(`  Patched attachment ${fix.attId} → ${fix.newPath}`);
      }
      console.log('\n✅ Done. Re-run without --fix to verify.');
    } else {
      console.log('\nRun with --fix to automatically patch the broken paths in MongoDB:');
      console.log('  node diagnostic.js --fix\n');
    }
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});