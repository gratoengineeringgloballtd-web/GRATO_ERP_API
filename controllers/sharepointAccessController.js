const { SharePointFolder, SharePointFile, SharePointActivityLog } = require('../models/SharePoint');
const User = require('../models/User');
const {
  canUserManageFolder,
  canUserBlockFromFolder,
  safeStr
} = require('../utils/sharepointAccessHelpers');

// ─── Email helper (optional — won't crash if service is missing) ───────────────
const tryEmail = async (fn) => { try { await fn(); } catch (e) { console.error('Email error:', e.message); } };

// ─── Invite users ──────────────────────────────────────────────────────────────
const inviteUsersToFolder = async (req, res) => {
  try {
    const { folderId }               = req.params;
    const { userEmails, permission } = req.body;

    if (!Array.isArray(userEmails) || userEmails.length === 0)
      return res.status(400).json({ success: false, message: 'Provide an array of user emails' });

    if (!['view', 'download', 'upload', 'manage'].includes(permission))
      return res.status(400).json({ success: false, message: 'Invalid permission level' });

    const folder = await SharePointFolder.findById(folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const currentUser = await User.findById(req.user.userId);
    if (!canUserManageFolder(folder, currentUser))
      return res.status(403).json({ success: false, message: 'No permission to invite users to this folder' });

    const users = await User.find({ email: { $in: userEmails } });

    const invited = [], alreadyInvited = [], notFound = [];

    for (const email of userEmails) {
      const target = users.find(u => u.email === email);
      if (!target) { notFound.push(email); continue; }

      const existing = folder.accessControl.invitedUsers.find(
        inv => safeStr(inv?.userId) === safeStr(target._id)
      );

      if (existing) {
        if (existing.permission !== permission) {
          existing.permission = permission;
          existing.invitedBy  = req.user.userId;
          existing.invitedAt  = new Date();
          invited.push({ email: target.email, updated: true });
        } else {
          alreadyInvited.push(target.email);
        }
        continue;
      }

      // Remove from blocked if present
      folder.accessControl.blockedUsers = (folder.accessControl.blockedUsers || []).filter(
        b => safeStr(b?.userId) !== safeStr(target._id)
      );

      folder.accessControl.invitedUsers.push({
        userId:    target._id,
        permission,
        invitedBy: req.user.userId,
        invitedAt: new Date()
      });
      invited.push({ email: target.email, name: target.fullName });

      await new SharePointActivityLog({
        action: 'user_invited', userId: req.user.userId,
        folderId: folder._id, folderName: folder.name,
        targetUserId: target._id, permission,
        details: { userEmail: target.email }
      }).save();

      await tryEmail(async () => {
        const svc = require('../services/sharepointEmailService');
        await svc.folderAccessGranted(target.email, target.fullName, folder.name, currentUser.fullName, permission);
      });
    }

    await folder.save();

    res.json({
      success: true,
      message: `${invited.length} user(s) invited`,
      data: { invited, alreadyInvited, notFound }
    });
  } catch (error) {
    console.error('inviteUsersToFolder:', error);
    res.status(500).json({ success: false, message: 'Failed to invite users', error: error.message });
  }
};

// ─── Revoke access ─────────────────────────────────────────────────────────────
const revokeUserAccess = async (req, res) => {
  try {
    const { folderId, userId } = req.params;

    const folder = await SharePointFolder.findById(folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const currentUser = await User.findById(req.user.userId);
    if (!canUserManageFolder(folder, currentUser))
      return res.status(403).json({ success: false, message: 'No permission to revoke access' });

    const idx = (folder.accessControl.invitedUsers || []).findIndex(
      inv => safeStr(inv?.userId) === userId
    );
    if (idx === -1)
      return res.status(404).json({ success: false, message: 'User is not invited to this folder' });

    folder.accessControl.invitedUsers.splice(idx, 1);
    await folder.save();

    const targetUser = await User.findById(userId);
    await new SharePointActivityLog({
      action: 'access_revoked', userId: req.user.userId,
      folderId: folder._id, folderName: folder.name, targetUserId: userId,
      details: { userEmail: targetUser?.email }
    }).save();

    await tryEmail(async () => {
      if (targetUser) {
        const svc = require('../services/sharepointEmailService');
        await svc.folderAccessRevoked(targetUser.email, targetUser.fullName, folder.name, currentUser.fullName);
      }
    });

    res.json({ success: true, message: 'Access revoked' });
  } catch (error) {
    console.error('revokeUserAccess:', error);
    res.status(500).json({ success: false, message: 'Failed to revoke access', error: error.message });
  }
};

// ─── Block user ────────────────────────────────────────────────────────────────
const blockUserFromFolder = async (req, res) => {
  try {
    const { folderId }    = req.params;
    const { userEmail, reason } = req.body;

    if (!userEmail) return res.status(400).json({ success: false, message: 'User email is required' });

    const folder = await SharePointFolder.findById(folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const currentUser = await User.findById(req.user.userId);
    if (!canUserBlockFromFolder(folder, currentUser))
      return res.status(403).json({ success: false, message: 'No permission to block users' });

    const target = await User.findOne({ email: userEmail });
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    if (safeStr(target._id) === safeStr(folder.createdBy))
      return res.status(400).json({ success: false, message: 'Cannot block the folder creator' });

    const isBlocked = (folder.accessControl.blockedUsers || []).some(
      b => safeStr(b?.userId) === safeStr(target._id)
    );
    if (isBlocked) return res.status(400).json({ success: false, message: 'User is already blocked' });

    // Remove from invited first
    folder.accessControl.invitedUsers = (folder.accessControl.invitedUsers || []).filter(
      inv => safeStr(inv?.userId) !== safeStr(target._id)
    );

    folder.accessControl.blockedUsers.push({
      userId:    target._id,
      blockedBy: req.user.userId,
      blockedAt: new Date(),
      reason:    reason || 'No reason provided'
    });
    await folder.save();

    await new SharePointActivityLog({
      action: 'user_blocked', userId: req.user.userId,
      folderId: folder._id, folderName: folder.name, targetUserId: target._id,
      details: { userEmail: target.email, reason }
    }).save();

    res.json({ success: true, message: 'User blocked' });
  } catch (error) {
    console.error('blockUserFromFolder:', error);
    res.status(500).json({ success: false, message: 'Failed to block user', error: error.message });
  }
};

// ─── Unblock user ──────────────────────────────────────────────────────────────
const unblockUserFromFolder = async (req, res) => {
  try {
    const { folderId, userId } = req.params;

    const folder = await SharePointFolder.findById(folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const currentUser = await User.findById(req.user.userId);
    if (!canUserBlockFromFolder(folder, currentUser))
      return res.status(403).json({ success: false, message: 'No permission to unblock users' });

    const before = (folder.accessControl.blockedUsers || []).length;
    folder.accessControl.blockedUsers = folder.accessControl.blockedUsers.filter(
      b => safeStr(b?.userId) !== userId
    );

    if (folder.accessControl.blockedUsers.length === before)
      return res.status(404).json({ success: false, message: 'User is not blocked' });

    await folder.save();
    res.json({ success: true, message: 'User unblocked' });
  } catch (error) {
    console.error('unblockUserFromFolder:', error);
    res.status(500).json({ success: false, message: 'Failed to unblock user', error: error.message });
  }
};

// ─── Get access list ───────────────────────────────────────────────────────────
const getFolderAccess = async (req, res) => {
  try {
    const { folderId } = req.params;

    const folder = await SharePointFolder.findById(folderId)
      .populate('createdBy', 'fullName email department')
      .populate('accessControl.invitedUsers.userId', 'fullName email department')
      .populate('accessControl.invitedUsers.invitedBy', 'fullName email')
      .populate('accessControl.blockedUsers.userId', 'fullName email department')
      .populate('accessControl.blockedUsers.blockedBy', 'fullName email');

    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const currentUser = await User.findById(req.user.userId);
    if (!canUserManageFolder(folder, currentUser))
      return res.status(403).json({ success: false, message: 'No permission to view access list' });

    res.json({
      success: true,
      data: {
        creator:      folder.createdBy,
        invitedUsers: folder.accessControl?.invitedUsers || [],
        blockedUsers: folder.accessControl?.blockedUsers || [],
        privacyLevel: folder.privacyLevel,
        department:   folder.department
      }
    });
  } catch (error) {
    console.error('getFolderAccess:', error);
    res.status(500).json({ success: false, message: 'Failed to get folder access', error: error.message });
  }
};

// ─── Update permission ─────────────────────────────────────────────────────────
const updateUserPermission = async (req, res) => {
  try {
    const { folderId, userId } = req.params;
    const { permission }       = req.body;

    if (!['view', 'download', 'upload', 'manage'].includes(permission))
      return res.status(400).json({ success: false, message: 'Invalid permission level' });

    const folder = await SharePointFolder.findById(folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const currentUser = await User.findById(req.user.userId);
    if (!canUserManageFolder(folder, currentUser))
      return res.status(403).json({ success: false, message: 'No permission to change permissions' });

    const inv = (folder.accessControl.invitedUsers || []).find(
      i => safeStr(i?.userId) === userId
    );
    if (!inv) return res.status(404).json({ success: false, message: 'User is not invited' });

    inv.permission = permission;
    inv.invitedBy  = req.user.userId;
    inv.invitedAt  = new Date();
    await folder.save();

    await new SharePointActivityLog({
      action: 'permission_changed', userId: req.user.userId,
      folderId: folder._id, folderName: folder.name,
      targetUserId: userId, permission
    }).save();

    res.json({ success: true, message: 'Permission updated' });
  } catch (error) {
    console.error('updateUserPermission:', error);
    res.status(500).json({ success: false, message: 'Failed to update permission', error: error.message });
  }
};

// ─── Search users ──────────────────────────────────────────────────────────────
const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2)
      return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters' });

    const users = await User.find({
      $or: [
        { fullName: { $regex: q, $options: 'i' } },
        { email:    { $regex: q, $options: 'i' } }
      ],
      _id: { $ne: req.user.userId }
    })
      .select('fullName email department')
      .limit(20);

    res.json({ success: true, data: users });
  } catch (error) {
    console.error('searchUsers:', error);
    res.status(500).json({ success: false, message: 'Failed to search users', error: error.message });
  }
};

module.exports = {
  inviteUsersToFolder,
  revokeUserAccess,
  blockUserFromFolder,
  unblockUserFromFolder,
  getFolderAccess,
  updateUserPermission,
  searchUsers
};









// const { SharePointFolder, SharePointFile, SharePointActivityLog } = require('../models/SharePoint');
// const User = require('../models/User');
// const sharepointEmailTemplates = require('../services/sharepointEmailService');
// const {
//   canUserManageFolder,
//   canUserBlockFromFolder,
//   getFolderAccessList
// } = require('../utils/sharepointAccessHelpers');

// // ============================================
// // FOLDER ACCESS MANAGEMENT CONTROLLERS
// // ============================================

// /**
//  * Invite users to folder with specific permissions
//  * POST /api/sharepoint/folders/:folderId/invite
//  */
// const inviteUsersToFolder = async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     const { userEmails, permission } = req.body;

//     // Validation
//     if (!userEmails || !Array.isArray(userEmails) || userEmails.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Please provide an array of user emails'
//       });
//     }

//     if (!['view', 'download', 'upload', 'manage'].includes(permission)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid permission level'
//       });
//     }

//     // Get folder
//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     // Check if current user can manage folder
//     const currentUser = await User.findById(req.user.userId);
//     if (!canUserManageFolder(folder, currentUser)) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to invite users to this folder'
//       });
//     }

//     // Find users by email
//     const users = await User.find({ 
//       email: { $in: userEmails } 
//     });

//     if (users.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'No users found with provided emails'
//       });
//     }

//     const invited = [];
//     const alreadyInvited = [];
//     const notFound = [];

//     for (const email of userEmails) {
//       const user = users.find(u => u.email === email);
      
//       if (!user) {
//         notFound.push(email);
//         continue;
//       }

//       // Check if user is already invited
//       const existingInvitation = folder.accessControl.invitedUsers.find(
//         inv => inv.userId.toString() === user._id.toString()
//       );

//       if (existingInvitation) {
//         // Update permission if different
//         if (existingInvitation.permission !== permission) {
//           existingInvitation.permission = permission;
//           existingInvitation.invitedBy = req.user.userId;
//           existingInvitation.invitedAt = new Date();
//           invited.push({ email: user.email, updated: true });
//         } else {
//           alreadyInvited.push(user.email);
//         }
//         continue;
//       }

//       // Remove from blocked list if present
//       folder.accessControl.blockedUsers = folder.accessControl.blockedUsers.filter(
//         block => block.userId.toString() !== user._id.toString()
//       );

//       // Add invitation
//       folder.accessControl.invitedUsers.push({
//         userId: user._id,
//         permission: permission,
//         invitedBy: req.user.userId,
//         invitedAt: new Date()
//       });

//       invited.push({ email: user.email, name: user.fullName });

//       // Log activity
//       await new SharePointActivityLog({
//         action: 'user_invited',
//         userId: req.user.userId,
//         folderId: folder._id,
//         folderName: folder.name,
//         targetUserId: user._id,
//         permission: permission,
//         details: { userEmail: user.email }
//       }).save();

//       // Send email notification
//       await sharepointEmailTemplates.folderAccessGranted(
//         user.email,
//         user.fullName,
//         folder.name,
//         currentUser.fullName,
//         permission
//       );
//     }

//     await folder.save();

//     res.json({
//       success: true,
//       message: `Successfully invited ${invited.length} user(s)`,
//       data: {
//         invited: invited,
//         alreadyInvited: alreadyInvited,
//         notFound: notFound
//       }
//     });

//   } catch (error) {
//     console.error('Invite users error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to invite users',
//       error: error.message
//     });
//   }
// };

// /**
//  * Revoke user access from folder
//  * DELETE /api/sharepoint/folders/:folderId/revoke/:userId
//  */
// const revokeUserAccess = async (req, res) => {
//   try {
//     const { folderId, userId } = req.params;

//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const currentUser = await User.findById(req.user.userId);
//     if (!canUserManageFolder(folder, currentUser)) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to revoke access'
//       });
//     }

//     // Find and remove invitation
//     const invitationIndex = folder.accessControl.invitedUsers.findIndex(
//       inv => inv.userId.toString() === userId
//     );

//     if (invitationIndex === -1) {
//       return res.status(404).json({
//         success: false,
//         message: 'User is not invited to this folder'
//       });
//     }

//     const targetUser = await User.findById(userId);
//     folder.accessControl.invitedUsers.splice(invitationIndex, 1);
//     await folder.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'access_revoked',
//       userId: req.user.userId,
//       folderId: folder._id,
//       folderName: folder.name,
//       targetUserId: userId,
//       details: { userEmail: targetUser?.email }
//     }).save();

//     // Send notification
//     if (targetUser) {
//       await sharepointEmailTemplates.folderAccessRevoked(
//         targetUser.email,
//         targetUser.fullName,
//         folder.name,
//         currentUser.fullName
//       );
//     }

//     res.json({
//       success: true,
//       message: 'Access revoked successfully'
//     });

//   } catch (error) {
//     console.error('Revoke access error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to revoke access',
//       error: error.message
//     });
//   }
// };

// /**
//  * Block user from folder
//  * POST /api/sharepoint/folders/:folderId/block
//  */
// const blockUserFromFolder = async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     const { userEmail, reason } = req.body;

//     if (!userEmail) {
//       return res.status(400).json({
//         success: false,
//         message: 'User email is required'
//       });
//     }

//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const currentUser = await User.findById(req.user.userId);
//     if (!canUserBlockFromFolder(folder, currentUser)) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to block users'
//       });
//     }

//     const targetUser = await User.findOne({ email: userEmail });
//     if (!targetUser) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     // Cannot block folder creator
//     if (targetUser._id.toString() === folder.createdBy.toString()) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot block folder creator'
//       });
//     }

//     // Check if already blocked
//     const isBlocked = folder.accessControl.blockedUsers.some(
//       block => block.userId.toString() === targetUser._id.toString()
//     );

//     if (isBlocked) {
//       return res.status(400).json({
//         success: false,
//         message: 'User is already blocked'
//       });
//     }

//     // Remove from invited users if present
//     folder.accessControl.invitedUsers = folder.accessControl.invitedUsers.filter(
//       inv => inv.userId.toString() !== targetUser._id.toString()
//     );

//     // Add to blocked list
//     folder.accessControl.blockedUsers.push({
//       userId: targetUser._id,
//       blockedBy: req.user.userId,
//       blockedAt: new Date(),
//       reason: reason || 'No reason provided'
//     });

//     await folder.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'user_blocked',
//       userId: req.user.userId,
//       folderId: folder._id,
//       folderName: folder.name,
//       targetUserId: targetUser._id,
//       details: { userEmail: targetUser.email, reason }
//     }).save();

//     res.json({
//       success: true,
//       message: 'User blocked successfully'
//     });

//   } catch (error) {
//     console.error('Block user error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to block user',
//       error: error.message
//     });
//   }
// };

// /**
//  * Unblock user from folder
//  * DELETE /api/sharepoint/folders/:folderId/unblock/:userId
//  */
// const unblockUserFromFolder = async (req, res) => {
//   try {
//     const { folderId, userId } = req.params;

//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const currentUser = await User.findById(req.user.userId);
//     if (!canUserBlockFromFolder(folder, currentUser)) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to unblock users'
//       });
//     }

//     // Remove from blocked list
//     const initialLength = folder.accessControl.blockedUsers.length;
//     folder.accessControl.blockedUsers = folder.accessControl.blockedUsers.filter(
//       block => block.userId.toString() !== userId
//     );

//     if (folder.accessControl.blockedUsers.length === initialLength) {
//       return res.status(404).json({
//         success: false,
//         message: 'User is not blocked'
//       });
//     }

//     await folder.save();

//     res.json({
//       success: true,
//       message: 'User unblocked successfully'
//     });

//   } catch (error) {
//     console.error('Unblock user error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to unblock user',
//       error: error.message
//     });
//   }
// };

// /**
//  * Get folder access list
//  * GET /api/sharepoint/folders/:folderId/access
//  */
// const getFolderAccess = async (req, res) => {
//   try {
//     const { folderId } = req.params;

//     const folder = await SharePointFolder.findById(folderId)
//       .populate('createdBy', 'fullName email department')
//       .populate('accessControl.invitedUsers.userId', 'fullName email department')
//       .populate('accessControl.invitedUsers.invitedBy', 'fullName email')
//       .populate('accessControl.blockedUsers.userId', 'fullName email department')
//       .populate('accessControl.blockedUsers.blockedBy', 'fullName email');

//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const currentUser = await User.findById(req.user.userId);
//     if (!canUserManageFolder(folder, currentUser)) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to view access list'
//       });
//     }

//     res.json({
//       success: true,
//       data: {
//         creator: folder.createdBy,
//         invitedUsers: folder.accessControl.invitedUsers,
//         blockedUsers: folder.accessControl.blockedUsers,
//         privacyLevel: folder.privacyLevel,
//         department: folder.department
//       }
//     });

//   } catch (error) {
//     console.error('Get folder access error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get folder access list',
//       error: error.message
//     });
//   }
// };

// /**
//  * Update user permission in folder
//  * PATCH /api/sharepoint/folders/:folderId/permission/:userId
//  */
// const updateUserPermission = async (req, res) => {
//   try {
//     const { folderId, userId } = req.params;
//     const { permission } = req.body;

//     if (!['view', 'download', 'upload', 'manage'].includes(permission)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid permission level'
//       });
//     }

//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const currentUser = await User.findById(req.user.userId);
//     if (!canUserManageFolder(folder, currentUser)) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to change permissions'
//       });
//     }

//     const invitation = folder.accessControl.invitedUsers.find(
//       inv => inv.userId.toString() === userId
//     );

//     if (!invitation) {
//       return res.status(404).json({
//         success: false,
//         message: 'User is not invited to this folder'
//       });
//     }

//     invitation.permission = permission;
//     invitation.invitedBy = req.user.userId;
//     invitation.invitedAt = new Date();

//     await folder.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'permission_changed',
//       userId: req.user.userId,
//       folderId: folder._id,
//       folderName: folder.name,
//       targetUserId: userId,
//       permission: permission
//     }).save();

//     res.json({
//       success: true,
//       message: 'Permission updated successfully'
//     });

//   } catch (error) {
//     console.error('Update permission error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update permission',
//       error: error.message
//     });
//   }
// };

// /**
//  * Search users for invitation
//  * GET /api/sharepoint/users/search?q=query
//  */
// const searchUsers = async (req, res) => {
//   try {
//     const { q } = req.query;

//     if (!q || q.length < 2) {
//       return res.status(400).json({
//         success: false,
//         message: 'Search query must be at least 2 characters'
//       });
//     }

//     const users = await User.find({
//       $or: [
//         { fullName: { $regex: q, $options: 'i' } },
//         { email: { $regex: q, $options: 'i' } }
//       ],
//       _id: { $ne: req.user.userId } // Exclude current user
//     })
//     .select('fullName email department')
//     .limit(20);

//     res.json({
//       success: true,
//       data: users
//     });

//   } catch (error) {
//     console.error('Search users error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to search users',
//       error: error.message
//     });
//   }
// };

// // ============================================
// // EMAIL NOTIFICATION TEMPLATES
// // Add to sharepointEmailService.js
// // ============================================

// const emailTemplates = {
//   /**
//    * Notify when user is granted folder access
//    */
//   folderAccessGranted: async (recipientEmail, recipientName, folderName, grantedByName, permission) => {
//     const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
//     const folderLink = `${clientUrl}/sharepoint/portal`;
    
//     const permissionLabels = {
//       view: 'View only',
//       download: 'View and Download',
//       upload: 'View, Download and Upload',
//       manage: 'Full Management'
//     };

//     const subject = `📁 You've been granted access to "${folderName}"`;
//     const html = `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//         <div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
//           <h2 style="color: #333; margin-top: 0;">🎉 Folder Access Granted</h2>
//           <p style="color: #555; line-height: 1.6;">
//             Hi ${recipientName},
//           </p>
//           <p style="color: #555; line-height: 1.6;">
//             <strong>${grantedByName}</strong> has invited you to access the folder <strong>"${folderName}"</strong>.
//           </p>

//           <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
//             <h3 style="color: #333; margin-top: 0;">Your Access Level</h3>
//             <div style="background-color: #1890ff; color: white; padding: 10px 15px; border-radius: 6px; display: inline-block; font-weight: bold;">
//               ${permissionLabels[permission]}
//             </div>
//             <div style="margin-top: 15px; padding: 10px; background-color: #f5f5f5; border-radius: 4px;">
//               ${permission === 'view' ? '👁️ You can view files in this folder' : ''}
//               ${permission === 'download' ? '⬇️ You can view and download files' : ''}
//               ${permission === 'upload' ? '⬆️ You can view, download, and upload files' : ''}
//               ${permission === 'manage' ? '🔧 You have full management rights (invite others, delete files, etc.)' : ''}
//             </div>
//           </div>

//           <div style="text-align: center; margin: 30px 0;">
//             <a href="${folderLink}" 
//                style="display: inline-block; background-color: #1890ff; color: white; 
//                       padding: 15px 30px; text-decoration: none; border-radius: 8px;
//                       font-weight: bold; font-size: 16px;">
//               Access Folder Now
//             </a>
//           </div>
//         </div>
//       </div>
//     `;

//     return await sendEmail({ to: recipientEmail, subject, html });
//   },

//   /**
//    * Notify when user access is revoked
//    */
//   folderAccessRevoked: async (recipientEmail, recipientName, folderName, revokedByName) => {
//     const subject = `Access removed from "${folderName}"`;
//     const html = `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//         <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
//           <h2 style="color: #856404; margin-top: 0;">Access Removed</h2>
//           <p style="color: #856404; line-height: 1.6;">
//             Hi ${recipientName},
//           </p>
//           <p style="color: #856404; line-height: 1.6;">
//             Your access to the folder <strong>"${folderName}"</strong> has been removed by <strong>${revokedByName}</strong>.
//           </p>
//           <p style="color: #856404; line-height: 1.6;">
//             You will no longer be able to access files in this folder.
//           </p>
//         </div>
//       </div>
//     `;

//     return await sendEmail({ to: recipientEmail, subject, html });
//   }
// };

// module.exports = {
//   inviteUsersToFolder,
//   revokeUserAccess,
//   blockUserFromFolder,
//   unblockUserFromFolder,
//   getFolderAccess,
//   updateUserPermission,
//   searchUsers
// };