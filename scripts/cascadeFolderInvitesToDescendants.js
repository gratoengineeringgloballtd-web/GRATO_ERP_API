/**
 * cascadeFolderInvitesToDescendants.js
 *
 * WHY THIS EXISTS
 * ----------------
 * canUserAccessFolder() only ever checked a folder's own accessControl.invitedUsers -
 * never any ancestor folder's. Combined with createFolder() never inheriting the parent's
 * invitedUsers list, this meant inviting someone to a folder never actually granted them
 * access to anything nested inside it - each subfolder needed its own separate invite.
 *
 * Both of those have been fixed going forward (new subfolders now inherit their parent's
 * invited users at creation time, and inviting someone to a folder now cascades to every
 * EXISTING descendant at invite time). Neither fix touches data that's already in the
 * database, though - anyone invited to a folder before this fix shipped still won't have
 * access to that folder's existing subfolders until this script runs once.
 *
 * WHAT IT DOES
 * ------------
 * For every folder that has at least one invited user, finds all of its existing
 * descendants (via the materialized `ancestors` path) and merges the parent's invited
 * users into each descendant's own invitedUsers list:
 *   - If the user is already invited to the descendant with an equal-or-higher
 *     permission, it's left alone.
 *   - If they're invited with a lower permission, it's raised to match the parent.
 *   - If they're not invited at all, they're added with the parent's permission.
 * Blocked users on a descendant are respected - a user explicitly blocked from a specific
 * subfolder stays blocked there even if invited to an ancestor (blockedUsers is checked
 * before invitedUsers in canUserAccessFolder, so this is consistent with that logic).
 *
 * Safe to run multiple times.
 *
 * Usage:
 *   node scripts/cascadeFolderInvitesToDescendants.js
 *   node scripts/cascadeFolderInvitesToDescendants.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { SharePointFolder } = require('../models/SharePoint');

const DRY_RUN = process.argv.includes('--dry-run');
const PERM_RANK = { view: 1, download: 2, upload: 3, edit: 3, manage: 4 };
const rank = (p) => PERM_RANK[p] || 0;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN — no writes will be made)' : ''}\n`);

  const foldersWithInvites = await SharePointFolder.find({
    'accessControl.invitedUsers.0': { $exists: true }
  });

  console.log(`Found ${foldersWithInvites.length} folder(s) with at least one invited user.\n`);

  let descendantsUpdated = 0;
  let usersGrantedOrRaised = 0;

  for (const parent of foldersWithInvites) {
    const invitedUsers = parent.accessControl?.invitedUsers || [];
    if (invitedUsers.length === 0) continue;

    const descendants = await SharePointFolder.find({ ancestors: parent._id });
    if (descendants.length === 0) continue;

    for (const descendant of descendants) {
      const blockedIds = new Set((descendant.accessControl.blockedUsers || []).map(b => String(b.userId)));
      let changed = false;

      for (const inv of invitedUsers) {
        const uid = String(inv.userId);
        if (blockedIds.has(uid)) continue; // respect an explicit block on this specific subfolder

        const existing = descendant.accessControl.invitedUsers.find(e => String(e.userId) === uid);

        if (!existing) {
          console.log(`${DRY_RUN ? '[dry-run] would grant' : 'Granting'} ${uid} "${inv.permission}" on "${descendant.name}" (inherited from "${parent.name}")`);
          if (!DRY_RUN) {
            descendant.accessControl.invitedUsers.push({
              userId: inv.userId,
              permission: inv.permission,
              invitedBy: inv.invitedBy,
              invitedAt: new Date()
            });
          }
          changed = true;
          usersGrantedOrRaised++;
        } else if (rank(inv.permission) > rank(existing.permission)) {
          console.log(`${DRY_RUN ? '[dry-run] would raise' : 'Raising'} ${uid} from "${existing.permission}" to "${inv.permission}" on "${descendant.name}"`);
          if (!DRY_RUN) {
            existing.permission = inv.permission;
            existing.invitedAt = new Date();
          }
          changed = true;
          usersGrantedOrRaised++;
        }
      }

      if (changed) {
        descendantsUpdated++;
        if (!DRY_RUN) await descendant.save();
      }
    }
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete' : 'Migration complete'}: ${descendantsUpdated} folder(s) updated, ${usersGrantedOrRaised} grant(s)/raise(s) applied.`);
  if (DRY_RUN) console.log('Re-run without --dry-run to apply.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
