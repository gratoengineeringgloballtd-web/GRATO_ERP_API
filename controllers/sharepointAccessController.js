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





