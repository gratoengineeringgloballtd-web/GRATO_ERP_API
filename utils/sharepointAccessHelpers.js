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










// /**
//  * sharepointAccessHelpers.js
//  *
//  * All ID comparisons use safeStr() so a null/undefined createdBy,
//  * userId, or accessControl entry never throws "Cannot read properties
//  * of null (reading 'toString')".
//  */

// // ─── Safe string helper ────────────────────────────────────────────────────────
// const safeStr = (val) => {
//   if (val === null || val === undefined) return '';
//   // Mongoose ObjectId or populated object
//   if (typeof val === 'object') {
//     if (val._id)  return val._id.toString();
//     if (val.id)   return val.id.toString();
//     return val.toString();
//   }
//   return String(val);
// };

// // ─── canUserAccessFolder ────────────────────────────────────────────────────────
// /**
//  * Returns { canAccess: boolean, permission: string, reason: string }
//  */
// const canUserAccessFolder = (folder, user) => {
//   if (!folder || !user) {
//     return { canAccess: false, permission: 'none', reason: 'Missing folder or user' };
//   }

//   const userId = safeStr(user._id);
//   const ac     = folder.accessControl || {};

//   // 1. Blocked?
//   const blocked = (ac.blockedUsers || []).some(b => safeStr(b?.userId) === userId);
//   if (blocked) {
//     return { canAccess: false, permission: 'none', reason: 'User is blocked from this folder' };
//   }

//   // 2. Creator → full manage
//   if (safeStr(folder.createdBy) === userId) {
//     return { canAccess: true, permission: 'manage', reason: 'Folder creator' };
//   }

//   // 3. Admin → full manage
//   if (user.role === 'admin') {
//     return { canAccess: true, permission: 'manage', reason: 'Administrator' };
//   }

//   // 4. Explicit invitation
//   const invitation = (ac.invitedUsers || []).find(inv => safeStr(inv?.userId) === userId);
//   if (invitation) {
//     return {
//       canAccess:  true,
//       permission: invitation.permission || 'download',
//       reason:     'Explicitly invited'
//     };
//   }

//   // 5. Privacy level
//   const level = folder.privacyLevel || (folder.isPublic ? 'public' : 'department');

//   if (level === 'public') {
//     return { canAccess: true, permission: 'download', reason: 'Public folder' };
//   }

//   if (level === 'department') {
//     if (folder.department && folder.department === user.department) {
//       return { canAccess: true, permission: 'upload', reason: 'Same department' };
//     }
//     if ((ac.allowedDepartments || []).includes(user.department)) {
//       return { canAccess: true, permission: 'download', reason: 'Allowed department' };
//     }
//     // Legacy allowedUsers array
//     if ((ac.allowedUsers || []).some(uid => safeStr(uid) === userId)) {
//       return { canAccess: true, permission: 'download', reason: 'Allowed user (legacy)' };
//     }
//   }

//   if (level === 'confidential') {
//     // Only invited users (already checked above)
//     return { canAccess: false, permission: 'none', reason: 'Confidential — invitation required' };
//   }

//   return { canAccess: false, permission: 'none', reason: 'No access permissions' };
// };

// // ─── Permission hierarchy helpers ──────────────────────────────────────────────
// const PERMISSION_RANK = { none: 0, view: 1, download: 2, upload: 3, edit: 3, manage: 4 };

// const canUserPerformAction = (folder, user, action) => {
//   const { canAccess, permission } = canUserAccessFolder(folder, user);
//   if (!canAccess) return false;

//   const rank = PERMISSION_RANK[permission] || 0;

//   switch (action) {
//     case 'view':     return rank >= PERMISSION_RANK.view;
//     case 'download': return rank >= PERMISSION_RANK.download;
//     case 'upload':   return rank >= PERMISSION_RANK.upload;
//     case 'delete':   return rank >= PERMISSION_RANK.manage;
//     case 'manage':   return rank >= PERMISSION_RANK.manage;
//     case 'invite':   return rank >= PERMISSION_RANK.manage;
//     case 'share':    return rank >= PERMISSION_RANK.upload;
//     default:         return false;
//   }
// };

// const canUserUploadToFolder  = (folder, user) => canUserPerformAction(folder, user, 'upload');
// const canUserManageFolder    = (folder, user) => canUserPerformAction(folder, user, 'manage');
// const canUserInviteToFolder  = (folder, user) => canUserPerformAction(folder, user, 'invite');

// const canUserDeleteFolder = (folder, user) => {
//   if (!folder || !user) return false;
//   return safeStr(folder.createdBy) === safeStr(user._id) || user.role === 'admin';
// };

// const canUserBlockFromFolder = (folder, user) => {
//   if (!folder || !user) return false;
//   return safeStr(folder.createdBy) === safeStr(user._id) || user.role === 'admin';
// };

// const getUserFolderPermission = (folder, user) => canUserAccessFolder(folder, user).permission;

// // ─── isFolderVisibleToUser ─────────────────────────────────────────────────────
// /**
//  * Confidential folders are invisible to users who have no access to them.
//  */
// const isFolderVisibleToUser = (folder, user) => {
//   if (!folder || !user) return false;

//   if (user.role === 'admin') return true;

//   const userId = safeStr(user._id);

//   if (safeStr(folder.createdBy) === userId) return true;

//   const level = folder.privacyLevel || (folder.isPublic ? 'public' : 'department');

//   if (level === 'confidential') {
//     const ac = folder.accessControl || {};
//     return (ac.invitedUsers || []).some(inv => safeStr(inv?.userId) === userId);
//   }

//   // public and department folders are always visible
//   return true;
// };

// // ─── canUserAccessFile (async — needs the folder) ─────────────────────────────
// const canUserAccessFile = async (file, user, SharePointFolder) => {
//   if (!file) return { canAccess: false, permission: 'none', reason: 'File not found' };

//   const folder = await SharePointFolder.findById(file.folderId);
//   if (!folder)  return { canAccess: false, permission: 'none', reason: 'Parent folder not found' };

//   const folderAccess = canUserAccessFolder(folder, user);
//   if (folderAccess.canAccess) return folderAccess;

//   // File explicitly shared with this user?
//   const userId    = safeStr(user._id);
//   const fileShare = (file.sharedWith || []).find(s => safeStr(s?.userId) === userId);
//   if (fileShare) {
//     return { canAccess: true, permission: fileShare.permission || fileShare.type || 'download', reason: 'File explicitly shared' };
//   }

//   return folderAccess;
// };

// // ─── getFolderAccessList (async helper for access controller) ─────────────────
// const getFolderAccessList = async (folder, User) => {
//   const list = [];

//   if (folder.createdBy) {
//     const creator = await User.findById(folder.createdBy).select('fullName email department');
//     if (creator) list.push({ user: creator, permission: 'manage', reason: 'Creator' });
//   }

//   const ac = folder.accessControl || {};
//   for (const inv of (ac.invitedUsers || [])) {
//     if (!inv?.userId) continue;
//     const u = await User.findById(inv.userId).select('fullName email department');
//     if (u) list.push({ user: u, permission: inv.permission, reason: 'Invited', invitedAt: inv.invitedAt });
//   }

//   return list;
// };

// module.exports = {
//   canUserAccessFolder,
//   canUserPerformAction,
//   canUserUploadToFolder,
//   canUserManageFolder,
//   canUserDeleteFolder,
//   canUserInviteToFolder,
//   canUserBlockFromFolder,
//   getUserFolderPermission,
//   isFolderVisibleToUser,
//   canUserAccessFile,
//   getFolderAccessList,
//   safeStr
// };









// // ============================================
// // ENHANCED ACCESS CONTROL HELPER FUNCTIONS
// // ============================================

// /**
//  * Check if user can access a folder
//  * @returns {Object} { canAccess: boolean, permission: string, reason: string }
//  */
// const canUserAccessFolder = (folder, user) => {
//   // 1. PRIORITY: Check if user is blocked
//   const isBlocked = folder.accessControl.blockedUsers.some(
//     block => block.userId.toString() === user._id.toString()
//   );
  
//   if (isBlocked) {
//     return {
//       canAccess: false,
//       permission: 'none',
//       reason: 'User is blocked from this folder'
//     };
//   }

//   // 2. Creator always has full access
//   if (folder.createdBy.toString() === user._id.toString()) {
//     return {
//       canAccess: true,
//       permission: 'manage',
//       reason: 'Folder creator'
//     };
//   }

//   // 3. Admin has full access to all folders
//   if (user.role === 'admin') {
//     return {
//       canAccess: true,
//       permission: 'manage',
//       reason: 'Administrator'
//     };
//   }

//   // 4. Check explicit invitations (highest priority for regular users)
//   const invitation = folder.accessControl.invitedUsers.find(
//     inv => inv.userId.toString() === user._id.toString()
//   );
  
//   if (invitation) {
//     return {
//       canAccess: true,
//       permission: invitation.permission,
//       reason: 'Explicitly invited'
//     };
//   }

//   // 5. Check privacy level
//   switch (folder.privacyLevel) {
//     case 'public':
//       // Everyone can view public folders
//       return {
//         canAccess: true,
//         permission: 'download',
//         reason: 'Public folder'
//       };
      
//     case 'department':
//       // Users in same department can access
//       if (folder.department === user.department) {
//         return {
//           canAccess: true,
//           permission: 'upload',
//           reason: 'Same department'
//         };
//       }
      
//       // Check if user's department is in allowedDepartments
//       if (folder.accessControl.allowedDepartments.includes(user.department)) {
//         return {
//           canAccess: true,
//           permission: 'download',
//           reason: 'Allowed department'
//         };
//       }
//       break;
      
//     case 'confidential':
//       // Only invited users can access confidential folders
//       // Already checked in step 4, so if we reach here, no access
//       return {
//         canAccess: false,
//         permission: 'none',
//         reason: 'Confidential folder - invitation required'
//       };
//   }

//   // 6. No access by default
//   return {
//     canAccess: false,
//     permission: 'none',
//     reason: 'No access permissions'
//   };
// };

// /**
//  * Check if user can perform specific action on folder
//  */
// const canUserPerformAction = (folder, user, action) => {
//   const access = canUserAccessFolder(folder, user);
  
//   if (!access.canAccess) {
//     return false;
//   }

//   const permission = access.permission;

//   switch (action) {
//     case 'view':
//       return ['view', 'download', 'upload', 'manage'].includes(permission);
      
//     case 'download':
//       return ['download', 'upload', 'manage'].includes(permission);
      
//     case 'upload':
//       return ['upload', 'manage'].includes(permission);
      
//     case 'delete':
//       return permission === 'manage';
      
//     case 'manage':
//       return permission === 'manage';
      
//     case 'invite':
//       return permission === 'manage';
      
//     case 'share':
//       return ['upload', 'manage'].includes(permission);
      
//     default:
//       return false;
//   }
// };

// /**
//  * Check if user can upload to folder
//  */
// const canUserUploadToFolder = (folder, user) => {
//   return canUserPerformAction(folder, user, 'upload');
// };

// /**
//  * Check if user can manage folder (invite, change settings, etc)
//  */
// const canUserManageFolder = (folder, user) => {
//   return canUserPerformAction(folder, user, 'manage');
// };

// /**
//  * Check if user can delete folder
//  */
// const canUserDeleteFolder = (folder, user) => {
//   // Only creator and admin can delete
//   return (
//     folder.createdBy.toString() === user._id.toString() || 
//     user.role === 'admin'
//   );
// };

// /**
//  * Check if user can invite others to folder
//  */
// const canUserInviteToFolder = (folder, user) => {
//   return canUserPerformAction(folder, user, 'invite');
// };

// /**
//  * Check if user can block others from folder
//  */
// const canUserBlockFromFolder = (folder, user) => {
//   // Only creator and admin can block
//   return (
//     folder.createdBy.toString() === user._id.toString() || 
//     user.role === 'admin'
//   );
// };

// /**
//  * Get user's permission level for folder
//  */
// const getUserFolderPermission = (folder, user) => {
//   const access = canUserAccessFolder(folder, user);
//   return access.permission;
// };

// /**
//  * Check if folder should be visible to user
//  * Confidential folders are invisible unless user has access
//  */
// const isFolderVisibleToUser = (folder, user) => {
//   // Admin sees all folders
//   if (user.role === 'admin') {
//     return true;
//   }

//   // Creator sees their own folders
//   if (folder.createdBy.toString() === user._id.toString()) {
//     return true;
//   }

//   // Confidential folders are invisible unless user has access
//   if (folder.privacyLevel === 'confidential') {
//     const invitation = folder.accessControl.invitedUsers.find(
//       inv => inv.userId.toString() === user._id.toString()
//     );
//     return !!invitation;
//   }

//   // All other folders are visible
//   return true;
// };

// /**
//  * Check if user can access file
//  */
// const canUserAccessFile = async (file, user, SharePointFolder) => {
//   // Get parent folder
//   const folder = await SharePointFolder.findById(file.folderId);
  
//   if (!folder) {
//     return {
//       canAccess: false,
//       permission: 'none',
//       reason: 'Folder not found'
//     };
//   }

//   // Check folder access first
//   const folderAccess = canUserAccessFolder(folder, user);
  
//   if (!folderAccess.canAccess) {
//     // Check if file is explicitly shared with user
//     const fileShare = file.sharedWith.find(
//       share => share.userId?.toString() === user._id.toString()
//     );
    
//     if (fileShare) {
//       return {
//         canAccess: true,
//         permission: fileShare.permission || fileShare.type,
//         reason: 'File explicitly shared'
//       };
//     }
    
//     return folderAccess;
//   }

//   return folderAccess;
// };

// /**
//  * Get list of users who can access folder
//  */
// const getFolderAccessList = async (folder, User) => {
//   const accessList = [];

//   // Add creator
//   const creator = await User.findById(folder.createdBy).select('fullName email department');
//   if (creator) {
//     accessList.push({
//       user: creator,
//       permission: 'manage',
//       reason: 'Creator'
//     });
//   }

//   // Add invited users
//   for (const invitation of folder.accessControl.invitedUsers) {
//     const user = await User.findById(invitation.userId).select('fullName email department');
//     if (user) {
//       accessList.push({
//         user: user,
//         permission: invitation.permission,
//         reason: 'Invited',
//         invitedAt: invitation.invitedAt,
//         invitedBy: invitation.invitedBy
//       });
//     }
//   }

//   // Add department users (if not confidential)
//   if (folder.privacyLevel !== 'confidential') {
//     const deptUsers = await User.find({ 
//       department: folder.department,
//       _id: { $ne: folder.createdBy }
//     }).select('fullName email department');
    
//     for (const user of deptUsers) {
//       // Skip if already in list
//       if (accessList.find(a => a.user._id.toString() === user._id.toString())) {
//         continue;
//       }
      
//       // Skip if blocked
//       const isBlocked = folder.accessControl.blockedUsers.some(
//         block => block.userId.toString() === user._id.toString()
//       );
      
//       if (!isBlocked) {
//         accessList.push({
//           user: user,
//           permission: folder.privacyLevel === 'public' ? 'download' : 'upload',
//           reason: 'Department member'
//         });
//       }
//     }
//   }

//   return accessList;
// };

// module.exports = {
//   canUserAccessFolder,
//   canUserPerformAction,
//   canUserUploadToFolder,
//   canUserManageFolder,
//   canUserDeleteFolder,
//   canUserInviteToFolder,
//   canUserBlockFromFolder,
//   getUserFolderPermission,
//   isFolderVisibleToUser,
//   canUserAccessFile,
//   getFolderAccessList
// };