/**
 * scripts/diagnose-sharepoint-file.js
 *
 * Prints the raw stored record for a SharePointFile so a download 404 can be
 * diagnosed with certainty instead of guessed at.
 *
 * Background: uploadFile()/bulkUploadFiles() in sharepointController.js used to
 * assume disk storage (file.path/file.filename), which are always undefined under
 * the memoryStorage() multer config this app actually uses. That bug has been fixed,
 * but it means any file uploaded BEFORE the fix was deployed has a DB record with
 * storageType: 'local' and an empty/undefined path - metadata only, no real content
 * anywhere. downloadFile() correctly 404s on those, because there's genuinely nothing
 * to serve. This script tells you which situation you're in for a specific file.
 *
 * Usage:
 *   node scripts/diagnose-sharepoint-file.js <fileId>
 *   node scripts/diagnose-sharepoint-file.js 69d662c37c4b66e1e49cd21c
 */

require('dotenv').config();
const mongoose = require('mongoose');
require('../models/User'); // must be required before populate('uploadedBy') can resolve the ref
const { SharePointFile, SharePointFolder } = require('../models/SharePoint');

const fileId = process.argv[2];

if (!fileId) {
  console.error('Usage: node scripts/diagnose-sharepoint-file.js <fileId>');
  process.exit(1);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  if (!mongoose.Types.ObjectId.isValid(fileId)) {
    console.error(`❌ "${fileId}" is not a valid ObjectId.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const file = await SharePointFile.findById(fileId).populate('uploadedBy', 'fullName email');

  if (!file) {
    console.log(`❌ No SharePointFile document exists with _id ${fileId}.`);
    console.log('   This means the file record itself is gone (deleted, wrong id copied from the UI,');
    console.log('   or it was never a file id — e.g. a folder id used by mistake).');

    const asFolder = await SharePointFolder.findById(fileId).catch(() => null);
    if (asFolder) {
      console.log(`\n   ⚠️  This ID DOES match a SharePointFolder ("${asFolder.name}") instead — the`);
      console.log('       frontend is likely passing a folder id where a file id was expected.');
    }
    await mongoose.disconnect();
    return;
  }

  console.log('📄 File record found:');
  console.log(`   name         : ${file.name}`);
  console.log(`   _id          : ${file._id}`);
  console.log(`   folderId     : ${file.folderId}`);
  console.log(`   isDeleted    : ${file.isDeleted}`);
  console.log(`   storageType  : ${file.storageType}`);
  console.log(`   path         : ${file.path || '(empty)'}`);
  console.log(`   publicId     : ${file.publicId || '(empty)'}`);
  console.log(`   size         : ${file.size} bytes`);
  console.log(`   mimetype     : ${file.mimetype}`);
  console.log(`   uploadedBy   : ${file.uploadedBy?.fullName || file.uploadedBy} (${file.uploadedBy?.email || ''})`);
  console.log(`   uploadedAt   : ${file.uploadedAt}`);

  console.log('\n── Verdict ──────────────────────────────────────────────');
  if (file.isDeleted) {
    console.log('🟡 This file is marked as deleted (isDeleted: true) — that alone explains the 404,');
    console.log('   downloadFile() checks for this before anything else.');
  } else if (file.storageType === 'cloudinary' && file.path?.startsWith('http')) {
    console.log('🟢 This record looks correct — storageType is "cloudinary" and path is a real URL.');
    console.log('   If download still 404s with this record in place, the bug is NOT the one we fixed;');
    console.log('   something else is wrong (check server logs for the actual error, or verify the');
    console.log('   deployed backend actually has the sharepointController.js fix from this session).');
  } else {
    console.log('🔴 This file predates the storage fix: storageType is "local" and there is no usable');
    console.log('   path/URL. Its content was never actually uploaded anywhere - this is expected to');
    console.log('   404, and there is no way to recover the original bytes through the app. The file');
    console.log('   needs to be deleted and re-uploaded now that uploadFile()/bulkUploadFiles() actually');
    console.log('   persist content to Cloudinary.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
