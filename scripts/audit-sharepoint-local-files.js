/**
 * scripts/audit-sharepoint-local-files.js
 *
 * Lists every SharePointFile whose storageType is still 'local' - i.e. every file
 * whose content lives (or lived) only as a transient local/temp path rather than in
 * Cloudinary, and will therefore 404 on download. Run this to see the full scope of
 * the problem instead of finding out one broken link at a time.
 *
 * Usage:
 *   node scripts/audit-sharepoint-local-files.js
 *   node scripts/audit-sharepoint-local-files.js --csv          (also writes a CSV report)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('../models/User'); // must be required before populate('uploadedBy')
const { SharePointFile, SharePointFolder } = require('../models/SharePoint');

const WRITE_CSV = process.argv.includes('--csv');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const localFiles = await SharePointFile.find({ storageType: 'local', isDeleted: false })
    .populate('uploadedBy', 'fullName email')
    .sort({ uploadedAt: 1 });

  const totalFiles = await SharePointFile.countDocuments({ isDeleted: false });

  if (localFiles.length === 0) {
    console.log(`✅ No affected files found. All ${totalFiles} active SharePoint file(s) are on Cloudinary.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`🔴 ${localFiles.length} of ${totalFiles} active SharePoint file(s) are unrecoverable (storageType: 'local'):\n`);

  const folderCache = new Map();
  const rows = [];

  for (const file of localFiles) {
    let folderName = folderCache.get(file.folderId?.toString());
    if (folderName === undefined) {
      const folder = await SharePointFolder.findById(file.folderId).select('name department');
      folderName = folder ? `${folder.department} / ${folder.name}` : '(folder deleted)';
      folderCache.set(file.folderId?.toString(), folderName);
    }

    const row = {
      name: file.name,
      folder: folderName,
      uploadedBy: file.uploadedBy?.fullName || 'Unknown',
      uploadedByEmail: file.uploadedBy?.email || '',
      uploadedAt: file.uploadedAt?.toISOString().split('T')[0] || '',
      sizeKB: Math.round((file.size || 0) / 1024),
      fileId: file._id.toString()
    };
    rows.push(row);

    console.log(`  - "${row.name}" in ${row.folder}`);
    console.log(`      uploaded by ${row.uploadedBy} (${row.uploadedByEmail}) on ${row.uploadedAt}, ${row.sizeKB} KB`);
    console.log(`      _id: ${row.fileId}`);
  }

  // Group by uploader so you know who to ask to re-upload
  const byUploader = {};
  rows.forEach(r => {
    byUploader[r.uploadedByEmail || 'unknown'] = (byUploader[r.uploadedByEmail || 'unknown'] || 0) + 1;
  });

  console.log('\n── Summary by uploader ──────────────────────────────────');
  Object.entries(byUploader)
    .sort((a, b) => b[1] - a[1])
    .forEach(([email, count]) => console.log(`  ${count.toString().padStart(3)}  ${email}`));

  if (WRITE_CSV) {
    const csvPath = path.resolve(__dirname, `../affected-sharepoint-files-${Date.now()}.csv`);
    const header = 'name,folder,uploadedBy,uploadedByEmail,uploadedAt,sizeKB,fileId\n';
    const body = rows.map(r =>
      [r.name, r.folder, r.uploadedBy, r.uploadedByEmail, r.uploadedAt, r.sizeKB, r.fileId]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    ).join('\n');
    fs.writeFileSync(csvPath, header + body);
    console.log(`\n📄 CSV report written to: ${csvPath}`);
  }

  console.log('\nNote: this only lists what\'s recoverable through the app - none of it is. Options are:');
  console.log('  1. Notify each uploader above to re-upload their file(s) now that uploads persist correctly.');
  console.log('  2. If you still have access to the original machine(s)/temp folders these were uploaded from,');
  console.log('     the files may still physically exist there and could be re-uploaded manually.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
