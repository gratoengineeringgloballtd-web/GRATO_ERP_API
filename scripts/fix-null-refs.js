/**
 * fix-null-refs.js
 *
 * Finds SharePointFolder documents with null/missing createdBy,
 * null entries in accessControl.invitedUsers/blockedUsers,
 * and optionally assigns a fallback admin userId.
 *
 * Run ONCE:
 *   ADMIN_ID=<your-admin-user-id> node scripts/fix-null-refs.js
 *
 * Without ADMIN_ID it runs in DRY-RUN mode (reports only, no writes).
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI  = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/your-db';
const ADMIN_ID   = process.env.ADMIN_ID;   // ObjectId string of a real admin user
const DRY_RUN    = !ADMIN_ID;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected');
  if (DRY_RUN) console.log('ℹ️  DRY RUN — set ADMIN_ID env var to apply fixes\n');

  const col = mongoose.connection.collection('sharepointfolders');
  const all = await col.find({}).toArray();
  console.log(`Checking ${all.length} folders…\n`);

  let fixed = 0;

  for (const folder of all) {
    const updates = {};
    let dirty = false;

    // 1. Null createdBy
    if (!folder.createdBy) {
      console.log(`⚠️  Folder "${folder.name}" (${folder._id}) has null createdBy`);
      if (!DRY_RUN) {
        updates.createdBy = new mongoose.Types.ObjectId(ADMIN_ID);
        dirty = true;
      }
    }

    // 2. Null entries in invitedUsers
    const invitedUsers = (folder.accessControl?.invitedUsers || []).filter(u => u?.userId != null);
    if (invitedUsers.length !== (folder.accessControl?.invitedUsers || []).length) {
      const removed = (folder.accessControl?.invitedUsers || []).length - invitedUsers.length;
      console.log(`⚠️  Folder "${folder.name}" — removing ${removed} null invitedUsers entry/entries`);
      if (!DRY_RUN) {
        updates['accessControl.invitedUsers'] = invitedUsers;
        dirty = true;
      }
    }

    // 3. Null entries in blockedUsers
    const blockedUsers = (folder.accessControl?.blockedUsers || []).filter(u => u?.userId != null);
    if (blockedUsers.length !== (folder.accessControl?.blockedUsers || []).length) {
      const removed = (folder.accessControl?.blockedUsers || []).length - blockedUsers.length;
      console.log(`⚠️  Folder "${folder.name}" — removing ${removed} null blockedUsers entry/entries`);
      if (!DRY_RUN) {
        updates['accessControl.blockedUsers'] = blockedUsers;
        dirty = true;
      }
    }

    // 4. Null entries in allowedUsers
    const allowedUsers = (folder.accessControl?.allowedUsers || []).filter(u => u != null);
    if (allowedUsers.length !== (folder.accessControl?.allowedUsers || []).length) {
      console.log(`⚠️  Folder "${folder.name}" — removing null allowedUsers entries`);
      if (!DRY_RUN) {
        updates['accessControl.allowedUsers'] = allowedUsers;
        dirty = true;
      }
    }

    if (dirty) {
      await col.updateOne({ _id: folder._id }, { $set: updates });
      console.log(`   ✔ Fixed: ${folder.name}`);
      fixed++;
    }
  }

  // Also clean up SharePointFile collaborators with null userId
  const filecol = mongoose.connection.collection('sharepointfiles');
  const files   = await filecol.find({ 'collaborators.userId': null }).toArray();
  if (files.length > 0) {
    console.log(`\n⚠️  ${files.length} file(s) have null collaborator entries`);
    if (!DRY_RUN) {
      for (const f of files) {
        const clean = (f.collaborators || []).filter(c => c?.userId != null);
        await filecol.updateOne({ _id: f._id }, { $set: { collaborators: clean } });
        console.log(`   ✔ Cleaned collaborators on file: ${f.name}`);
        fixed++;
      }
    }
  }

  console.log(`\n=== Done: ${fixed} documents fixed ===`);
  if (DRY_RUN && fixed === 0) console.log('No issues found — everything looks clean.');
  if (DRY_RUN && fixed > 0)  console.log('Re-run with ADMIN_ID=<id> to apply fixes.');

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });