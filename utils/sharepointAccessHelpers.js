/**
 * sharepointAccessHelpers.js
 *
 * Rules:
 *  - 'Company' folders are visible and accessible to ALL employees
 *  - Department folders are visible/accessible to members of that department
 *  - Public folders are visible/accessible to everyone
 *  - Confidential folders are ONLY visible to explicitly invited users + creator + admin
 *  - Blocked users are denied regardless of anything else
 *  - Invited users get their explicit permission level on any folder type
 */

// ─── Safe string comparison (handles ObjectId, populated objects, strings) ─────
const safeStr = (val) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val._id) return val._id.toString();
    if (val.id)  return val.id.toString();
    return val.toString();
  }
  return String(val);
};

const sameId = (a, b) => safeStr(a) === safeStr(b) && safeStr(a) !== '';

// ─── isFolderVisibleToUser ─────────────────────────────────────────────────────
/**
 * Should this folder appear in the sidebar/folder list for this user?
 *
 * Visible when ANY of:
 *   1. User is admin
 *   2. User created the folder
 *   3. Folder is 'Company' department (default for everyone)
 *   4. Folder department matches user's department
 *   5. Folder is public (privacyLevel === 'public')
 *   6. User is explicitly invited (covers confidential folders)
 *   7. User's department is in folder.accessControl.allowedDepartments
 */
const isFolderVisibleToUser = (folder, user) => {
  if (!folder || !user) return false;

  const userId = safeStr(user._id);
  const ac     = folder.accessControl || {};
  const level  = folder.privacyLevel || (folder.isPublic ? 'public' : 'department');

  // 1. Admin sees everything
  if (user.role === 'admin') return true;

  // 2. Creator always sees their own folder
  if (safeStr(folder.createdBy) === userId) return true;

  // For confidential folders ONLY invited users (+ creator/admin above) can even see it
  if (level === 'confidential') {
    return (ac.invitedUsers || []).some(inv => safeStr(inv?.userId) === userId);
  }

  // 3. 'Company' department → visible to all employees
  if (folder.department === 'Company') return true;

  // 4. User's own department
  if (folder.department && user.department && folder.department === user.department) return true;

  // 5. Public folders
  if (level === 'public' || folder.isPublic) return true;

  // 6. Explicitly invited
  if ((ac.invitedUsers || []).some(inv => safeStr(inv?.userId) === userId)) return true;

  // 7. User's department is in allowedDepartments
  if (user.department && (ac.allowedDepartments || []).includes(user.department)) return true;

  return false;
};

// ─── canUserAccessFolder ───────────────────────────────────────────────────────
/**
 * Can the user actually open this folder and see its files?
 * Returns { canAccess: boolean, permission: string, reason: string }
 *
 * Permission hierarchy: none < view < download < upload < manage
 */
const canUserAccessFolder = (folder, user) => {
  if (!folder || !user) {
    return { canAccess: false, permission: 'none', reason: 'Missing folder or user' };
  }

  const userId = safeStr(user._id);
  const ac     = folder.accessControl || {};
  const level  = folder.privacyLevel || (folder.isPublic ? 'public' : 'department');

  // ── 1. Blocked → always deny ─────────────────────────────────────────────
  const isBlocked = (ac.blockedUsers || []).some(b => safeStr(b?.userId) === userId);
  if (isBlocked) {
    return { canAccess: false, permission: 'none', reason: 'User is blocked from this folder' };
  }

  // ── 2. Creator → full manage ──────────────────────────────────────────────
  if (safeStr(folder.createdBy) === userId) {
    return { canAccess: true, permission: 'manage', reason: 'Folder creator' };
  }

  // ── 3. Admin → full manage ────────────────────────────────────────────────
  if (user.role === 'admin') {
    return { canAccess: true, permission: 'manage', reason: 'Administrator' };
  }

  // ── 4. Explicit invitation → use their assigned permission ────────────────
  const invitation = (ac.invitedUsers || []).find(inv => safeStr(inv?.userId) === userId);
  if (invitation) {
    return {
      canAccess:  true,
      permission: invitation.permission || 'download',
      reason:     'Explicitly invited'
    };
  }

  // ── 5. Confidential → only invited (already checked above) ────────────────
  if (level === 'confidential') {
    return { canAccess: false, permission: 'none', reason: 'Confidential — invitation required' };
  }

  // ── 6. 'Company' department → all employees get download access ───────────
  if (folder.department === 'Company') {
    return { canAccess: true, permission: 'download', reason: 'Company-wide folder' };
  }

  // ── 7. Public folder → download for everyone ──────────────────────────────
  if (level === 'public' || folder.isPublic) {
    return { canAccess: true, permission: 'download', reason: 'Public folder' };
  }

  // ── 8. Same department → upload permission ────────────────────────────────
  if (folder.department && user.department && folder.department === user.department) {
    return { canAccess: true, permission: 'upload', reason: 'Same department' };
  }

  // ── 9. User's department is in allowedDepartments → download ─────────────
  if (user.department && (ac.allowedDepartments || []).includes(user.department)) {
    return { canAccess: true, permission: 'download', reason: 'Allowed department' };
  }

  // ── 10. Legacy allowedUsers list ──────────────────────────────────────────
  if ((ac.allowedUsers || []).some(uid => safeStr(uid) === userId)) {
    return { canAccess: true, permission: 'download', reason: 'Allowed user (legacy)' };
  }

  return { canAccess: false, permission: 'none', reason: 'No access permissions' };
};

// ─── Convenience wrappers ─────────────────────────────────────────────────────

const PERM_RANK = { none: 0, view: 1, download: 2, upload: 3, edit: 3, manage: 4 };

const permissionAtLeast = (permission, required) =>
  (PERM_RANK[permission] || 0) >= (PERM_RANK[required] || 0);

const canUserPerformAction = (folder, user, action) => {
  const { canAccess, permission } = canUserAccessFolder(folder, user);
  if (!canAccess) return false;

  switch (action) {
    case 'view':     return permissionAtLeast(permission, 'view');
    case 'download': return permissionAtLeast(permission, 'download');
    case 'upload':   return permissionAtLeast(permission, 'upload');
    case 'manage':   return permissionAtLeast(permission, 'manage');
    case 'invite':   return permissionAtLeast(permission, 'manage');
    case 'share':    return permissionAtLeast(permission, 'upload');
    default:         return false;
  }
};

const canUserUploadToFolder  = (folder, user) => canUserPerformAction(folder, user, 'upload');
const canUserManageFolder    = (folder, user) => canUserPerformAction(folder, user, 'manage');
const canUserInviteToFolder  = (folder, user) => canUserManageFolder(folder, user);

const canUserDeleteFolder = (folder, user) => {
  if (!folder || !user) return false;
  return sameId(folder.createdBy, user._id) || user.role === 'admin';
};

const canUserBlockFromFolder = (folder, user) => {
  if (!folder || !user) return false;
  return sameId(folder.createdBy, user._id) || user.role === 'admin';
};

const getUserFolderPermission = (folder, user) =>
  canUserAccessFolder(folder, user).permission;

// ─── canUserAccessFile ────────────────────────────────────────────────────────
const canUserAccessFile = async (file, user, SharePointFolder) => {
  if (!file) return { canAccess: false, permission: 'none', reason: 'File not found' };

  const folder = await SharePointFolder.findById(file.folderId);
  if (!folder)  return { canAccess: false, permission: 'none', reason: 'Parent folder not found' };

  const folderAccess = canUserAccessFolder(folder, user);
  if (folderAccess.canAccess) return folderAccess;

  // File explicitly shared with this user?
  const userId    = safeStr(user._id);
  const fileShare = (file.sharedWith || []).find(s => safeStr(s?.userId) === userId);
  if (fileShare) {
    return {
      canAccess:  true,
      permission: fileShare.permission || 'download',
      reason:     'File explicitly shared'
    };
  }

  return folderAccess;
};

// ─── getFolderAccessList ──────────────────────────────────────────────────────
const getFolderAccessList = async (folder, User) => {
  const list = [];

  if (folder.createdBy) {
    const creator = await User.findById(folder.createdBy).select('fullName email department');
    if (creator) list.push({ user: creator, permission: 'manage', reason: 'Creator' });
  }

  const ac = folder.accessControl || {};
  for (const inv of (ac.invitedUsers || [])) {
    if (!inv?.userId) continue;
    const u = await User.findById(inv.userId).select('fullName email department');
    if (u) list.push({ user: u, permission: inv.permission, reason: 'Invited', invitedAt: inv.invitedAt });
  }

  return list;
};

module.exports = {
  safeStr,
  sameId,
  isFolderVisibleToUser,
  canUserAccessFolder,
  canUserPerformAction,
  canUserUploadToFolder,
  canUserManageFolder,
  canUserDeleteFolder,
  canUserInviteToFolder,
  canUserBlockFromFolder,
  getUserFolderPermission,
  canUserAccessFile,
  getFolderAccessList
};





