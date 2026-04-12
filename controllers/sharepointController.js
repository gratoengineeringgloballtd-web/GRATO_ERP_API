const { SharePointFolder, SharePointFile, SharePointActivityLog } = require('../models/SharePoint');
const User = require('../models/User');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  canUserAccessFolder,
  canUserUploadToFolder,
  canUserManageFolder,
  canUserDeleteFolder,
  isFolderVisibleToUser
} = require('../utils/sharepointAccessHelpers');

// ─── Helpers ───────────────────────────────────────────────────────────────────
const toObjectId = (id) => new mongoose.Types.ObjectId(id);   // ← FIX for "cannot invoke without new"
const CHECKOUT_TTL_MS = 2 * 60 * 60 * 1000;                  // 2 hours

const cleanupLocalFile = (file) => {
  if (file && file.path && !file.path.startsWith('http') && fs.existsSync(file.path)) {
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
};

const isCloudinaryFile = (file) =>
  !!(file && file.path && file.path.startsWith('http'));

// Append one entry to the embedded audit trail (capped at 500 in the pre-save hook)
const logFileAudit = async (fileId, action, userId, meta = {}) => {
  try {
    await SharePointFile.updateOne(
      { _id: fileId },
      {
        $push: {
          auditTrail: {
            $each:  [{ action, userId: toObjectId(userId), timestamp: new Date(), meta }],
            $slice: -500
          }
        }
      }
    );
  } catch (e) {
    console.error('logFileAudit error:', e.message);
  }
};

// Email collaborators when a version is uploaded or a comment is added
const notifyCollaborators = async (file, action, actor, extra = {}) => {
  try {
    const emailSvc = require('../services/sharepointEmailService');
    if (typeof emailSvc.notifyCollaborators !== 'function') return;

    const ids = [
      ...file.collaborators.map(c => c.userId?.toString()),
      ...file.sharedWith.filter(s => s.userId).map(s => s.userId.toString())
    ].filter(id => id && id !== actor._id.toString());

    const unique = [...new Set(ids)];
    if (!unique.length) return;

    const users = await User.find({ _id: { $in: unique } }).select('email fullName');
    for (const u of users) {
      await emailSvc.notifyCollaborators(
        u.email, u.fullName, file.name, actor.fullName, action, extra
      );
    }
  } catch (e) {
    console.error('notifyCollaborators error:', e.message);
  }
};


// ============================================================
// FOLDER OPERATIONS
// ============================================================

const createFolder = async (req, res) => {
  try {
    const { name, description, privacyLevel, allowedDepartments } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });
 
    // ── Determine department ───────────────────────────────────────────────
    // Admins can specify any department; everyone else uses their own.
    const department = user.role === 'admin'
      ? (req.body.department || user.department)
      : user.department;
 
    if (!name || !description || !department) {
      return res.status(400).json({ success: false, message: 'name, description and department are required' });
    }
 
    const resolvedPrivacy = ['public', 'department', 'confidential'].includes(privacyLevel)
      ? privacyLevel
      : 'department';
 
    if (await SharePointFolder.findOne({ name })) {
      return res.status(400).json({ success: false, message: 'A folder with this name already exists' });
    }
 
    // ── Determine allowedDepartments ──────────────────────────────────────
    // Company folders: accessible to all → empty allowedDepartments list
    //   (the helper checks department === 'Company' directly)
    // Public folders: same — everyone can access, no list needed
    // Department / confidential: restricted to the specified department(s)
    let resolvedAllowedDepts;
    if (department === 'Company' || resolvedPrivacy === 'public') {
      resolvedAllowedDepts = [];
    } else if (Array.isArray(allowedDepartments) && allowedDepartments.length > 0) {
      resolvedAllowedDepts = allowedDepartments;
    } else {
      resolvedAllowedDepts = [department];
    }
 
    const folder = await new SharePointFolder({
      name,
      description,
      department,
      privacyLevel: resolvedPrivacy,
      isPublic:     resolvedPrivacy === 'public',
      createdBy:    req.user.userId,
      accessControl: {
        allowedDepartments: resolvedAllowedDepts,
        allowedUsers:       [req.user.userId],
        invitedUsers:       [],
        blockedUsers:       []
      }
    }).save();
 
    await new SharePointActivityLog({
      action:     'folder_create',
      userId:     req.user.userId,
      folderId:   folder._id,
      folderName: folder.name,
      details:    { department, privacyLevel: resolvedPrivacy }
    }).save();
 
    res.status(201).json({ success: true, message: 'Folder created', data: folder });
  } catch (error) {
    console.error('createFolder error:', error);
    res.status(500).json({ success: false, message: 'Failed to create folder', error: error.message });
  }
};
 

// const getFolders = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const { department } = req.query;

//     let allFolders = await SharePointFolder.find({})
//       .populate('createdBy', 'fullName email')
//       .sort({ createdAt: -1 });

//     let visible = allFolders.filter(f => isFolderVisibleToUser(f, user));
//     if (department && department !== 'all') visible = visible.filter(f => f.department === department);

//     const result = visible.map(folder => {
//       const access = canUserAccessFolder(folder, user);
//       return {
//         ...folder.toObject(),
//         userAccess: {
//           canView:    access.canAccess,
//           canUpload:  canUserUploadToFolder(folder, user),
//           canManage:  canUserManageFolder(folder, user),
//           canDelete:  canUserDeleteFolder(folder, user),
//           permission: access.permission,
//           reason:     access.reason
//         }
//       };
//     });

//     res.json({ success: true, data: result, count: result.length, userDepartment: user.department, userRole: user.role });
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Failed to fetch folders', error: error.message });
//   }
// };


const getFolders = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });
 
    const { department } = req.query;
 
    // ── Build a query that finds every folder that COULD be visible ─────────
    //
    // We fetch broadly here and let isFolderVisibleToUser() do the fine-grained
    // filtering, because the helper encodes all the business rules.
    //
    // The query includes:
    //   a) All public folders
    //   b) All 'Company' department folders (org-wide default)
    //   c) Folders belonging to the user's own department
    //   d) Folders where the user's department is explicitly allowed
    //   e) Folders the user created
    //   f) Folders where the user is explicitly invited
    //   g) For admins: everything
    //
    let dbQuery;
 
    if (user.role === 'admin') {
      // Admin sees every folder
      dbQuery = {};
    } else {
      dbQuery = {
        $or: [
          // Public
          { privacyLevel: 'public' },
          { isPublic: true },
          // Company-wide default
          { department: 'Company' },
          // User's own department
          ...(user.department ? [{ department: user.department }] : []),
          // Explicitly allowed departments
          ...(user.department ? [{ 'accessControl.allowedDepartments': user.department }] : []),
          // User created it
          { createdBy: toObjectId(req.user.userId) },
          // User is explicitly invited (covers confidential folders)
          { 'accessControl.invitedUsers.userId': toObjectId(req.user.userId) },
          // Legacy allowedUsers
          { 'accessControl.allowedUsers': toObjectId(req.user.userId) }
        ]
      };
    }
 
    // Apply optional department filter from query string
    if (department && department !== 'all') {
      dbQuery = { $and: [dbQuery, { department }] };
    }
 
    const allFolders = await SharePointFolder.find(dbQuery)
      .populate('createdBy', 'fullName email')
      .sort({ department: 1, name: 1 });
 
    const result = [];
 
    for (const folder of allFolders) {
      try {
        // Fine-grained visibility check (handles confidential, blocked, etc.)
        if (!isFolderVisibleToUser(folder, user)) continue;
 
        const access = canUserAccessFolder(folder, user);
 
        result.push({
          ...folder.toObject(),
          userAccess: {
            canView:    access.canAccess,
            canUpload:  canUserUploadToFolder(folder, user),
            canManage:  canUserManageFolder(folder, user),
            canDelete:  canUserDeleteFolder(folder, user),
            permission: access.permission,
            reason:     access.reason
          }
        });
      } catch (perFolderErr) {
        console.error(`getFolders: skipping folder ${folder._id} (${folder.name}):`, perFolderErr.message);
      }
    }
 
    res.json({
      success:        true,
      data:           result,
      count:          result.length,
      userDepartment: user.department,
      userRole:       user.role
    });
 
  } catch (error) {
    console.error('getFolders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch folders', error: error.message });
  }
};

const getFolder = async (req, res) => {
  try {
    const folder = await SharePointFolder.findById(req.params.folderId).populate('createdBy', 'fullName email');
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const user   = await User.findById(req.user.userId);
    const access = canUserAccessFolder(folder, user);
    if (!access.canAccess) return res.status(403).json({ success: false, message: 'Access denied' });

    res.json({ success: true, data: folder });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch folder', error: error.message });
  }
};

const updateFolder = async (req, res) => {
  try {
    const folder = await SharePointFolder.findById(req.params.folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const user = await User.findById(req.user.userId);
    if (!canUserManageFolder(folder, user))
      return res.status(403).json({ success: false, message: 'No permission to manage this folder' });

    const { description, isPublic, allowedDepartments } = req.body;
    if (description)         folder.description = description;
    if (isPublic !== undefined) folder.isPublic = isPublic;
    if (allowedDepartments)  folder.accessControl.allowedDepartments = allowedDepartments;
    await folder.save();

    res.json({ success: true, message: 'Folder updated', data: folder });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update folder', error: error.message });
  }
};

const deleteFolder = async (req, res) => {
  try {
    const folder = await SharePointFolder.findById(req.params.folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const user = await User.findById(req.user.userId);
    if (!canUserDeleteFolder(folder, user))
      return res.status(403).json({ success: false, message: 'No permission to delete this folder' });

    const fileCount = await SharePointFile.countDocuments({ folderId: folder._id, isDeleted: false });
    if (fileCount > 0)
      return res.status(400).json({ success: false, message: 'Delete all files in this folder first' });

    await SharePointFolder.findByIdAndDelete(req.params.folderId);
    await new SharePointActivityLog({ action: 'folder_delete', userId: req.user.userId, folderId: folder._id, folderName: folder.name }).save();

    res.json({ success: true, message: 'Folder deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete folder', error: error.message });
  }
};


// ============================================================
// FILE OPERATIONS
// ============================================================

const uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

    const folder = await SharePointFolder.findById(req.params.folderId);
    if (!folder) { cleanupLocalFile(req.file); return res.status(404).json({ success: false, message: 'Folder not found' }); }

    const user = await User.findById(req.user.userId);
    if (!canUserUploadToFolder(folder, user)) {
      cleanupLocalFile(req.file);
      return res.status(403).json({ success: false, message: 'No permission to upload to this folder' });
    }

    const cloudinary = isCloudinaryFile(req.file);
    const file = await new SharePointFile({
      folderId:    folder._id,
      name:        req.file.originalname,
      description: req.body.description,
      mimetype:    req.file.mimetype,
      size:        req.file.size,
      path:        req.file.path,
      publicId:    req.file.filename || req.file.public_id || null,
      storageType: cloudinary ? 'cloudinary' : 'local',
      uploadedBy:  req.user.userId,
      tags:        req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : []
    }).save();

    folder.fileCount  += 1;
    folder.totalSize  += req.file.size;
    folder.lastModified = new Date();
    await folder.save();

    await new SharePointActivityLog({ action: 'upload', userId: req.user.userId, fileId: file._id, folderId: folder._id, fileName: file.name, folderName: folder.name }).save();

    res.status(201).json({ success: true, message: 'File uploaded', data: file });
  } catch (error) {
    cleanupLocalFile(req.file);
    res.status(500).json({ success: false, message: 'Failed to upload file', error: error.message });
  }
};

const getFiles = async (req, res) => {
  try {
    const { folderId }        = req.params;
    const { search, sortBy, tags } = req.query;
    const user   = await User.findById(req.user.userId);
    const folder = await SharePointFolder.findById(folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const access = canUserAccessFolder(folder, user);
    if (!access.canAccess) return res.status(403).json({ success: false, message: access.reason || 'Access denied' });

    const query = { folderId, isDeleted: false };
    if (search) query.name = { $regex: search, $options: 'i' };
    if (tags)   query.tags = { $in: tags.split(',').map(t => t.trim()) };

    const sortMap = { recent: { uploadedAt: -1 }, size: { size: -1 }, name: { name: 1 } };
    const files = await SharePointFile.find(query)
      .populate('uploadedBy', 'fullName email')
      .populate('collaborators.userId', 'fullName email')
      .populate('checkout.userId', 'fullName email')
      .sort(sortMap[sortBy] || { uploadedAt: -1 });

    const result = files.map(file => {
      // Determine if checkout has expired
      const coExpired = file.checkout?.expiresAt && new Date() > file.checkout.expiresAt;
      const checkedOutByMe = !coExpired && file.checkout?.userId?.toString() === user._id.toString();
      const isLocked = !coExpired && !!file.checkout?.userId;

      return {
        ...file.toObject(),
        checkoutStatus: {
          isLocked,
          checkedOutByMe,
          checkedOutBy:  isLocked ? file.checkout.userId : null,
          expiresAt:     isLocked ? file.checkout.expiresAt : null
        },
        userPermissions: {
          canDownload: ['download', 'upload', 'manage'].includes(access.permission),
          canDelete:   access.permission === 'manage' || file.uploadedBy._id?.toString() === user._id.toString(),
          canShare:    ['upload', 'manage'].includes(access.permission),
          canEdit:     ['edit', 'manage'].includes(access.permission) ||
            file.collaborators.some(c => c.userId._id?.toString() === user._id.toString() && c.permission === 'edit'),
          canCheckout: !isLocked || checkedOutByMe
        }
      };
    });

    res.json({ success: true, data: result, count: result.length, userPermission: access.permission });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch files', error: error.message });
  }
};

const getFileDetails = async (req, res) => {
  try {
    const { fileId } = req.params;
 
    const file = await SharePointFile.findById(fileId)
      .populate('uploadedBy',           'fullName email')
      .populate('folderId',             'name department')
      .populate('sharedWith.userId',    'fullName email')
      .populate('collaborators.userId', 'fullName email department')
      .populate('checkout.userId',      'fullName email')
      .populate('comments.userId',      'fullName email')
      .populate('auditTrail.userId',    'fullName email');
 
    if (!file || file.isDeleted) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
 
    // ── Resolve caller's effective permission ──────────────────────────────
    const user   = await User.findById(req.user.userId);
    const folder = await SharePointFolder.findById(file.folderId);
 
    let folderPermission = 'none';
    let canEdit          = false;
 
    if (user && folder) {
      const access     = canUserAccessFolder(folder, user);
      folderPermission = access.permission || 'none';
 
      // Edit-capable: file uploader, admin, folder upload/manage, or file collab 'edit'
      const isFileOwner = file.uploadedBy?._id?.toString() === user._id.toString()
                       || file.uploadedBy?.toString()       === user._id.toString();
 
      const isCollabEdit = (file.collaborators || []).some(c => {
        const uid = c.userId?._id?.toString() ?? c.userId?.toString();
        return uid === user._id.toString() && c.permission === 'edit';
      });
 
      canEdit = isFileOwner
             || user.role === 'admin'
             || ['upload', 'manage'].includes(folderPermission)
             || isCollabEdit;
    }
 
    // ── Append permissions to response ─────────────────────────────────────
    const fileObj = file.toObject();
    fileObj.userPermissions = {
      canEdit,
      canDownload:     ['download', 'upload', 'manage'].includes(folderPermission) || canEdit,
      canDelete:       canEdit || user?.role === 'admin',
      canShare:        ['upload', 'manage'].includes(folderPermission) || canEdit,
      folderPermission
    };
 
    // Log the view
    await logFileAudit(file._id, 'view', req.user.userId);
 
    res.json({ success: true, data: fileObj });
  } catch (error) {
    console.error('getFileDetails error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch file', error: error.message });
  }
};

const downloadFile = async (req, res) => {
  try {
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    // Check if locked by someone else
    const coExpired = file.checkout?.expiresAt && new Date() > file.checkout.expiresAt;
    const isLockedByOther = !coExpired && file.checkout?.userId &&
      file.checkout.userId.toString() !== req.user.userId;

    // Downloads are always allowed even when locked (read-only is fine)
    file.downloads += 1;
    file.downloadLog.push({ userId: req.user.userId, downloadedAt: new Date(), ipAddress: req.ip });
    await file.save();

    await logFileAudit(file._id, 'download', req.user.userId);
    await new SharePointActivityLog({ action: 'download', userId: req.user.userId, fileId: file._id, fileName: file.name }).save();

    // ── FIX: Cloudinary / remote URL — redirect to the CDN directly ──────
    if (file.storageType === 'cloudinary' || file.path?.startsWith('http')) {
      return res.redirect(file.path);
    }

    // ── Local disk ────────────────────────────────────────────────────────
    if (!fs.existsSync(file.path))
      return res.status(404).json({ success: false, message: 'File not found on server' });

    res.download(file.path, file.name);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to download file', error: error.message });
  }
};

const deleteFile = async (req, res) => {
  try {
    const { permanently } = req.query;
    const user = await User.findById(req.user.userId);
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'No permission to delete this file' });

    if (permanently === 'true') {
      cleanupLocalFile(file);
      const folder = await SharePointFolder.findById(file.folderId);
      if (folder) { folder.fileCount = Math.max(0, folder.fileCount - 1); folder.totalSize = Math.max(0, folder.totalSize - file.size); await folder.save(); }
      await SharePointFile.findByIdAndDelete(file._id);
    } else {
      file.isDeleted = true; file.deletedAt = new Date(); file.deletedBy = req.user.userId;
      await file.save();
    }

    await new SharePointActivityLog({ action: 'delete', userId: req.user.userId, fileId: file._id, fileName: file.name }).save();
    res.json({ success: true, message: 'File deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete file', error: error.message });
  }
};


// ============================================================
// CHECK-OUT / CHECK-IN
// ============================================================

/**
 * POST /api/sharepoint/files/:fileId/checkout
 * Locks the file for exclusive editing by the calling user.
 * Optional body: { note: "Working on Q3 figures" }
 */
const checkoutFile = async (req, res) => {
  try {
    const file = await SharePointFile.findById(req.params.fileId)
      .populate('checkout.userId', 'fullName email');
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    // Check existing checkout
    const now = new Date();
    if (file.checkout?.userId) {
      const expired = file.checkout.expiresAt && now > file.checkout.expiresAt;
      if (!expired) {
        const isMe = file.checkout.userId._id?.toString() === req.user.userId;
        if (!isMe) {
          return res.status(409).json({
            success: false,
            message: `File is checked out by ${file.checkout.userId.fullName || 'another user'}`,
            checkout: {
              checkedOutBy: file.checkout.userId,
              expiresAt:    file.checkout.expiresAt
            }
          });
        }
        // Already checked out by me — renew expiry
        file.checkout.expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);
        file.checkout.note      = req.body.note || file.checkout.note;
        await file.save();
        return res.json({ success: true, message: 'Checkout renewed', data: file.checkout });
      }
      // Expired — log it
      await logFileAudit(file._id, 'checkout_expired', file.checkout.userId._id || file.checkout.userId, {});
    }

    // Lock the file
    file.checkout = {
      userId:       toObjectId(req.user.userId),
      checkedOutAt: now,
      expiresAt:    new Date(now.getTime() + CHECKOUT_TTL_MS),
      note:         req.body.note || ''
    };
    await file.save();

    await logFileAudit(file._id, 'checkout', req.user.userId, { note: file.checkout.note });
    await new SharePointActivityLog({ action: 'checkout', userId: req.user.userId, fileId: file._id, fileName: file.name }).save();

    res.json({ success: true, message: 'File checked out. You have 2 hours to upload a new version.', data: file.checkout });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to check out file', error: error.message });
  }
};

/**
 * POST /api/sharepoint/files/:fileId/checkin
 * Releases the lock. If a file is attached, it is uploaded as a new version first.
 * Optional body (multipart): file, changeNote
 */
const checkinFile = async (req, res) => {
  try {
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file || file.isDeleted) { cleanupLocalFile(req.file); return res.status(404).json({ success: false, message: 'File not found' }); }

    const user = await User.findById(req.user.userId);

    // Only the person who checked it out (or admin) can check in
    if (file.checkout?.userId?.toString() !== req.user.userId && user.role !== 'admin') {
      cleanupLocalFile(req.file);
      return res.status(403).json({ success: false, message: 'You did not check out this file' });
    }

    // If a new file was uploaded with the check-in, create a version
    if (req.file) {
      const cloudinary = isCloudinaryFile(req.file);
      // Archive current
      file.versions.push({
        versionNumber: file.versions.length + 1,
        path:          file.path,
        publicId:      file.publicId,
        size:          file.size,
        mimetype:      file.mimetype,
        uploadedBy:    file.uploadedBy,
        uploadedAt:    file.uploadedAt,
        changeNote:    req.body.changeNote || ''
      });
      // Promote new
      file.path        = req.file.path;
      file.publicId    = req.file.filename || req.file.public_id || null;
      file.storageType = cloudinary ? 'cloudinary' : 'local';
      file.size        = req.file.size;
      file.mimetype    = req.file.mimetype;
      file.uploadedAt  = new Date();
      file.uploadedBy  = toObjectId(req.user.userId);

      await logFileAudit(file._id, 'upload_version', req.user.userId, { versionNumber: file.versions.length, changeNote: req.body.changeNote });
      await new SharePointActivityLog({ action: 'version_create', userId: req.user.userId, fileId: file._id, fileName: file.name, details: { versionNumber: file.versions.length } }).save();
      await notifyCollaborators(file, 'new_version', user, { changeNote: req.body.changeNote, versionNumber: file.versions.length });
    }

    // Release the lock
    file.checkout = undefined;
    await file.save();

    await logFileAudit(file._id, 'checkin', req.user.userId, { hadNewVersion: !!req.file });
    await new SharePointActivityLog({ action: 'checkin', userId: req.user.userId, fileId: file._id, fileName: file.name }).save();

    res.json({ success: true, message: req.file ? 'Checked in with new version' : 'Check-in complete (no changes)', data: file });
  } catch (error) {
    cleanupLocalFile(req.file);
    res.status(500).json({ success: false, message: 'Failed to check in file', error: error.message });
  }
};

/**
 * DELETE /api/sharepoint/files/:fileId/checkout
 * Force-release a lock. Admin only, or the person who checked it out.
 */
const forceCheckin = async (req, res) => {
  try {
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const user = await User.findById(req.user.userId);
    const isOwner = file.checkout?.userId?.toString() === req.user.userId;
    if (!isOwner && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Only admin or the checkout owner can force-release' });

    const prevUser = file.checkout?.userId;
    file.checkout = undefined;
    await file.save();

    await logFileAudit(file._id, 'checkin', req.user.userId, { forced: true, prevUser });
    res.json({ success: true, message: 'Checkout released' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to release checkout', error: error.message });
  }
};


// ============================================================
// VERSION CONTROL
// ============================================================

const createFileVersion = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

    const file = await SharePointFile.findById(req.params.fileId);
    if (!file || file.isDeleted) { cleanupLocalFile(req.file); return res.status(404).json({ success: false, message: 'File not found' }); }

    const user = await User.findById(req.user.userId);
    const isCollaboratorWithEdit = file.collaborators.some(c => c.userId.toString() === req.user.userId && c.permission === 'edit');

    if (file.uploadedBy.toString() !== req.user.userId && !isCollaboratorWithEdit && user.role !== 'admin') {
      cleanupLocalFile(req.file);
      return res.status(403).json({ success: false, message: 'No permission to upload versions. You need Edit collaborator access.' });
    }

    // Check that file is not locked by someone else
    const coExpired = file.checkout?.expiresAt && new Date() > file.checkout.expiresAt;
    const isLockedByOther = !coExpired && file.checkout?.userId && file.checkout.userId.toString() !== req.user.userId;
    if (isLockedByOther) {
      cleanupLocalFile(req.file);
      return res.status(409).json({ success: false, message: 'File is checked out by another user. Ask them to check in first.' });
    }

    const cloudinary = isCloudinaryFile(req.file);
    file.versions.push({
      versionNumber: file.versions.length + 1,
      path:          file.path,
      publicId:      file.publicId,
      size:          file.size,
      mimetype:      file.mimetype,
      uploadedBy:    file.uploadedBy,
      uploadedAt:    file.uploadedAt,
      changeNote:    req.body.changeNote || ''
    });

    file.path        = req.file.path;
    file.publicId    = req.file.filename || req.file.public_id || null;
    file.storageType = cloudinary ? 'cloudinary' : 'local';
    file.size        = req.file.size;
    file.mimetype    = req.file.mimetype;
    file.uploadedAt  = new Date();
    file.uploadedBy  = toObjectId(req.user.userId);

    await file.save();

    await logFileAudit(file._id, 'upload_version', req.user.userId, { versionNumber: file.versions.length, changeNote: req.body.changeNote });
    await new SharePointActivityLog({ action: 'version_create', userId: req.user.userId, fileId: file._id, fileName: file.name, details: { versionNumber: file.versions.length } }).save();
    await notifyCollaborators(file, 'new_version', user, { changeNote: req.body.changeNote, versionNumber: file.versions.length });

    res.json({ success: true, message: 'New version uploaded', data: file });
  } catch (error) {
    cleanupLocalFile(req.file);
    res.status(500).json({ success: false, message: 'Failed to create version', error: error.message });
  }
};

const getFileVersions = async (req, res) => {
  try {
    const file = await SharePointFile.findById(req.params.fileId)
      .populate('versions.uploadedBy', 'fullName email');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const archived = file.versions.map((v, i) => ({ ...v.toObject(), isCurrent: false, index: i }));
    const current  = {
      versionNumber: file.versions.length + 1,
      path:          file.path,
      size:          file.size,
      mimetype:      file.mimetype,
      uploadedBy:    file.uploadedBy,
      uploadedAt:    file.uploadedAt,
      changeNote:    'Current version',
      isCurrent:     true,
      index:         file.versions.length
    };

    res.json({ success: true, data: [...archived, current].reverse() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch versions', error: error.message });
  }
};

const restoreFileVersion = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Only the file owner or admin can restore versions' });

    const version = file.versions[parseInt(req.params.versionIndex)];
    if (!version) return res.status(404).json({ success: false, message: 'Version not found' });

    if (!version.path?.startsWith('http') && !fs.existsSync(version.path))
      return res.status(404).json({ success: false, message: 'Version file not found on disk' });

    file.versions.push({
      versionNumber: file.versions.length + 1,
      path:          file.path,
      publicId:      file.publicId,
      size:          file.size,
      mimetype:      file.mimetype,
      uploadedBy:    file.uploadedBy,
      uploadedAt:    file.uploadedAt,
      changeNote:    'Auto-archived before restore'
    });

    file.path       = version.path;
    file.publicId   = version.publicId;
    file.size       = version.size;
    file.mimetype   = version.mimetype;
    file.uploadedAt = new Date();

    await file.save();

    await logFileAudit(file._id, 'upload_version', req.user.userId, { restoredFrom: version.versionNumber });
    await new SharePointActivityLog({ action: 'version_restore', userId: req.user.userId, fileId: file._id, fileName: file.name, details: { restoredVersion: version.versionNumber } }).save();

    res.json({ success: true, message: 'Version restored', data: file });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to restore version', error: error.message });
  }
};


// ============================================================
// COMMENTS
// ============================================================

const addComment = async (req, res) => {
  try {
    const { text, versionIndex } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'Comment text is required' });

    const file = await SharePointFile.findById(req.params.fileId);
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    file.comments.push({ userId: req.user.userId, text: text.trim(), versionIndex: versionIndex ?? null });
    await file.save();

    await logFileAudit(file._id, 'comment', req.user.userId, { preview: text.slice(0, 80) });
    await new SharePointActivityLog({ action: 'comment_add', userId: req.user.userId, fileId: file._id, fileName: file.name }).save();

    const user = await User.findById(req.user.userId);
    await notifyCollaborators(file, 'comment', user, { preview: text.slice(0, 100) });

    const populated = await SharePointFile.findById(file._id).populate('comments.userId', 'fullName email');
    res.json({ success: true, message: 'Comment added', data: populated.comments.filter(c => !c.isDeleted) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to add comment', error: error.message });
  }
};

const deleteComment = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const comment = file.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    if (comment.userId.toString() !== req.user.userId && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'No permission to delete this comment' });

    comment.isDeleted = true;
    await file.save();

    await new SharePointActivityLog({ action: 'comment_delete', userId: req.user.userId, fileId: file._id, fileName: file.name }).save();
    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete comment', error: error.message });
  }
};


// ============================================================
// COLLABORATORS
// ============================================================

const addCollaborator = async (req, res) => {
  try {
    const { userEmail, permission } = req.body;
    if (!['view', 'download', 'edit'].includes(permission))
      return res.status(400).json({ success: false, message: 'Permission must be: view, download, or edit' });

    const file = await SharePointFile.findById(req.params.fileId);
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    const user = await User.findById(req.user.userId);
    if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Only the file owner can manage collaborators' });

    const target = await User.findOne({ email: userEmail });
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    const existing = file.collaborators.find(c => c.userId.toString() === target._id.toString());
    if (existing) {
      existing.permission = permission;
    } else {
      file.collaborators.push({ userId: target._id, permission, addedBy: req.user.userId, addedAt: new Date() });
    }
    await file.save();

    await logFileAudit(file._id, 'collaborator_add', req.user.userId, { targetEmail: userEmail, permission });
    await new SharePointActivityLog({ action: 'collaborator_add', userId: req.user.userId, fileId: file._id, fileName: file.name, targetUserId: target._id, permission }).save();

    try {
      const emailSvc = require('../services/sharepointEmailService');
      await emailSvc.folderAccessGranted(target.email, target.fullName, file.name, user.fullName, permission);
    } catch (e) { console.error('Email error:', e.message); }

    res.json({ success: true, message: 'Collaborator added', data: file.collaborators });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to add collaborator', error: error.message });
  }
};

const removeCollaborator = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'No permission to remove collaborators' });

    file.collaborators = file.collaborators.filter(c => c.userId.toString() !== req.params.userId);
    await file.save();

    await new SharePointActivityLog({ action: 'collaborator_remove', userId: req.user.userId, fileId: file._id, fileName: file.name, targetUserId: req.params.userId }).save();
    res.json({ success: true, message: 'Collaborator removed' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to remove collaborator', error: error.message });
  }
};

const getFileAuditTrail = async (req, res) => {
  try {
    const file = await SharePointFile.findById(req.params.fileId)
      .populate('auditTrail.userId', 'fullName email')
      .select('auditTrail name');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const trail = [...file.auditTrail].sort((a, b) => b.timestamp - a.timestamp);
    res.json({ success: true, data: trail, fileName: file.name });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit trail', error: error.message });
  }
};


// ============================================================
// SHARING
// ============================================================

const shareFile = async (req, res) => {
  try {
    const { shareWith, permission, type } = req.body;
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    if (type === 'user') {
      let userId = shareWith;
      if (shareWith.includes('@')) {
        const target = await User.findOne({ email: shareWith });
        if (!target) return res.status(404).json({ success: false, message: `User ${shareWith} not found` });
        userId = target._id.toString();
      } else if (!mongoose.Types.ObjectId.isValid(shareWith)) {
        return res.status(400).json({ success: false, message: 'Invalid user ID or email' });
      }
      const ex = file.sharedWith.find(s => s.userId?.toString() === userId);
      if (ex) { ex.permission = permission || 'download'; }
      else { file.sharedWith.push({ userId, permission: permission || 'download', type: 'user', sharedAt: new Date(), sharedBy: req.user.userId }); }
    } else if (type === 'department') {
      const ex = file.sharedWith.find(s => s.department === shareWith);
      if (ex) { ex.permission = permission || 'download'; }
      else { file.sharedWith.push({ department: shareWith, permission: permission || 'download', type: 'department', sharedAt: new Date(), sharedBy: req.user.userId }); }
    } else {
      return res.status(400).json({ success: false, message: 'type must be "user" or "department"' });
    }

    await file.save();
    await logFileAudit(file._id, 'share', req.user.userId, { shareWith, permission, type });
    await new SharePointActivityLog({ action: 'share', userId: req.user.userId, fileId: file._id, fileName: file.name, details: { shareWith, permission, type } }).save();

    res.json({ success: true, message: 'File shared', data: file });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to share file', error: error.message });
  }
};

const revokeAccess = async (req, res) => {
  try {
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });
    file.sharedWith = file.sharedWith.filter(s => s.userId?.toString() !== req.params.userId);
    await file.save();
    await new SharePointActivityLog({ action: 'access_revoked', userId: req.user.userId, fileId: file._id, fileName: file.name }).save();
    res.json({ success: true, message: 'Access revoked' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to revoke access', error: error.message });
  }
};

const generateShareLink = async (req, res) => {
  try {
    const { expiresIn = 604800 } = req.body;
    const user = await User.findById(req.user.userId);
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'No permission to generate share link' });

    const token = crypto.randomBytes(32).toString('hex');
    file.shareLink = { token, expiresAt: new Date(Date.now() + expiresIn * 1000), createdBy: req.user.userId };
    await file.save();

    res.json({ success: true, data: { shareLink: `${process.env.FRONTEND_URL}/sharepoint/shared/${token}`, expiresAt: file.shareLink.expiresAt } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate share link', error: error.message });
  }
};


// ============================================================
// USER-SPECIFIC
// ============================================================

const getUserFiles = async (req, res) => {
  try {
    const { search, folderId, sortBy } = req.query;
    const query = { uploadedBy: req.user.userId, isDeleted: false };
    if (search)   query.name     = { $regex: search, $options: 'i' };
    if (folderId && folderId !== 'all') query.folderId = folderId;

    const sortMap = { recent: { uploadedAt: -1 }, size: { size: -1 }, name: { name: 1 } };
    const files = await SharePointFile.find(query)
      .populate('uploadedBy', 'fullName email')
      .populate('folderId', 'name department')
      .sort(sortMap[sortBy] || { uploadedAt: -1 });

    res.json({ success: true, data: files, count: files.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch your files', error: error.message });
  }
};

const getUserStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    const userFolders = await SharePointFolder.find({
      $or: [
        { department: user.department },
        { createdBy:  toObjectId(req.user.userId) },          // ← FIX: new keyword
        { 'accessControl.allowedDepartments': user.department },
        { 'accessControl.allowedUsers': toObjectId(req.user.userId) }
      ]
    });

    const folderIds = userFolders.map(f => f._id);

    const [stats, activityStats, recentUploads] = await Promise.all([
      SharePointFile.aggregate([
        { $match: { folderId: { $in: folderIds }, uploadedBy: toObjectId(req.user.userId), isDeleted: false } },
        { $group: { _id: null, filesUploaded: { $sum: 1 }, totalSize: { $sum: '$size' }, totalDownloads: { $sum: '$downloads' } } }
      ]),
      SharePointActivityLog.aggregate([
        { $match: { userId: toObjectId(req.user.userId) } },
        { $group: { _id: '$action', count: { $sum: 1 } } }
      ]),
      SharePointFile.find({ folderId: { $in: folderIds }, uploadedBy: req.user.userId, isDeleted: false })
        .sort({ uploadedAt: -1 }).limit(5).populate('folderId', 'name department')
    ]);

    res.json({
      success: true,
      data: {
        uploads: stats[0] || { filesUploaded: 0, totalSize: 0, totalDownloads: 0 },
        activity: activityStats,
        recentUploads,
        userDepartment: user.department,
        accessibleFoldersCount: folderIds.length
      }
    });
  } catch (error) {
    console.error('getUserStats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user statistics', error: error.message });
  }
};


// ============================================================
// SEARCH & DISCOVERY
// ============================================================

const globalSearch = async (req, res) => {
  try {
    const { query, fileType } = req.query;
    if (!query) return res.status(400).json({ success: false, message: 'Search query required' });

    const user = await User.findById(req.user.userId);
    const accessible = await SharePointFolder.find({
      $or: [
        { isPublic: true },
        { department: user.department },
        { 'accessControl.allowedDepartments': user.department },
        { 'accessControl.allowedUsers':       toObjectId(req.user.userId) },
        { createdBy:                           toObjectId(req.user.userId) },
        ...(user.role === 'admin' ? [{}] : [])
      ]
    });

    const q = {
      isDeleted: false,
      folderId:  { $in: accessible.map(f => f._id) },
      $or: [
        { name:        { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { tags:        { $in: [new RegExp(query, 'i')] } }
      ]
    };
    if (fileType) q.mimetype = { $regex: fileType, $options: 'i' };

    const files = await SharePointFile.find(q)
      .populate('uploadedBy', 'fullName email')
      .populate('folderId', 'name department')
      .sort({ uploadedAt: -1 }).limit(50);

    res.json({ success: true, data: files, count: files.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to search', error: error.message });
  }
};

const getRecentFiles = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const user = await User.findById(req.user.userId);
    const accessible = await SharePointFolder.find({
      $or: [
        { isPublic: true },
        { department: user.department },
        { 'accessControl.allowedDepartments': user.department },
        { 'accessControl.allowedUsers':       toObjectId(req.user.userId) },
        { createdBy:                           toObjectId(req.user.userId) },
        ...(user.role === 'admin' ? [{}] : [])
      ]
    });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const files = await SharePointFile.find({
      uploadedAt: { $gte: startDate },
      isDeleted: false,
      folderId: { $in: accessible.map(f => f._id) }
    })
      .populate('uploadedBy', 'fullName email')
      .populate('folderId', 'name department')
      .sort({ uploadedAt: -1 }).limit(20);

    res.json({ success: true, data: files, count: files.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch recent files', error: error.message });
  }
};


// ============================================================
// BULK UPLOAD
// ============================================================

const bulkUploadFiles = async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ success: false, message: 'No files provided' });

    const folder = await SharePointFolder.findById(req.params.folderId);
    if (!folder) { req.files.forEach(cleanupLocalFile); return res.status(404).json({ success: false, message: 'Folder not found' }); }

    const user = await User.findById(req.user.userId);
    if (!canUserUploadToFolder(folder, user)) {
      req.files.forEach(cleanupLocalFile);
      return res.status(403).json({ success: false, message: 'No permission to upload to this folder' });
    }

    const saved = [];
    let totalSize = 0;
    for (const f of req.files) {
      const cloudinary = isCloudinaryFile(f);
      const nf = await new SharePointFile({
        folderId: folder._id, name: f.originalname, description: req.body.description,
        mimetype: f.mimetype, size: f.size, path: f.path,
        publicId: f.filename || null, storageType: cloudinary ? 'cloudinary' : 'local',
        uploadedBy: req.user.userId,
        tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : []
      }).save();
      saved.push(nf);
      totalSize += f.size;
      await new SharePointActivityLog({ action: 'upload', userId: req.user.userId, fileId: nf._id, folderId: folder._id, fileName: nf.name, folderName: folder.name }).save();
    }

    folder.fileCount  += saved.length;
    folder.totalSize  += totalSize;
    folder.lastModified = new Date();
    await folder.save();

    res.status(201).json({ success: true, message: `${saved.length} files uploaded`, data: saved });
  } catch (error) {
    if (req.files) req.files.forEach(cleanupLocalFile);
    res.status(500).json({ success: false, message: 'Failed to upload files', error: error.message });
  }
};


// ============================================================
// ANALYTICS
// ============================================================

const getStorageStats = async (req, res) => {
  try {
    const match = { isDeleted: false };
    if (req.query.folderId) match.folderId = toObjectId(req.query.folderId);

    const [stats, byType, byDept] = await Promise.all([
      SharePointFile.aggregate([{ $match: match }, { $group: { _id: null, totalFiles: { $sum: 1 }, totalSize: { $sum: '$size' }, averageFileSize: { $avg: '$size' }, largestFile: { $max: '$size' } } }]),
      SharePointFile.aggregate([{ $match: match }, { $group: { _id: '$mimetype', count: { $sum: 1 }, totalSize: { $sum: '$size' } } }]),
      SharePointFolder.aggregate([{ $group: { _id: '$department', folderCount: { $sum: 1 }, totalFiles: { $sum: '$fileCount' }, totalSize: { $sum: '$totalSize' } } }])
    ]);

    res.json({ success: true, data: { overall: stats[0] || {}, byType, byDepartment: byDept } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch storage stats', error: error.message });
  }
};

const getActivityLog = async (req, res) => {
  try {
    const { days = 30, action, userId } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    const query = { timestamp: { $gte: startDate } };
    if (action) query.action = action;
    if (userId) query.userId = toObjectId(userId);

    const logs = await SharePointActivityLog.find(query)
      .populate('userId', 'fullName email')
      .sort({ timestamp: -1 }).limit(1000);

    res.json({ success: true, data: logs, count: logs.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch activity log', error: error.message });
  }
};

const getDepartmentStats = async (req, res) => {
  try {
    const { department } = req.params;
    const user = await User.findById(req.user.userId);
    if (user.role !== 'admin' && user.department !== department)
      return res.status(403).json({ success: false, message: 'Access denied' });

    const folders = await SharePointFolder.find({ department });
    const stats = await SharePointFile.aggregate([
      { $lookup: { from: 'sharepointfolders', localField: 'folderId', foreignField: '_id', as: 'folder' } },
      { $unwind: '$folder' },
      { $match: { 'folder.department': department, isDeleted: false } },
      { $group: { _id: null, totalFiles: { $sum: 1 }, totalSize: { $sum: '$size' }, totalDownloads: { $sum: '$downloads' } } }
    ]);

    res.json({ success: true, data: { department, folders: folders.length, ...(stats[0] || { totalFiles: 0, totalSize: 0, totalDownloads: 0 }) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch department stats', error: error.message });
  }
};

const getSharePointDashboardStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const accessible = await SharePointFolder.find({
      $or: [
        { isPublic: true },
        { department: user.department },
        { 'accessControl.allowedDepartments': user.department },
        { 'accessControl.allowedUsers': toObjectId(req.user.userId) },
        { createdBy: toObjectId(req.user.userId) },
        ...(user.role === 'admin' ? [{}] : [])
      ]
    });

    const ids = accessible.map(f => f._id);
    const ago7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, mine, recent] = await Promise.all([
      SharePointFile.countDocuments({ folderId: { $in: ids }, isDeleted: false }),
      SharePointFile.countDocuments({ uploadedBy: toObjectId(req.user.userId), isDeleted: false }),
      SharePointFile.countDocuments({ folderId: { $in: ids }, isDeleted: false, uploadedAt: { $gte: ago7 } })
    ]);

    res.json({ success: true, data: { pending: 0, total, userUploaded: mine, recent, accessibleFolders: accessible.length } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats', error: error.message });
  }
};


module.exports = {
  // Folder
  createFolder, getFolders, getFolder, updateFolder, deleteFolder,
  // Files
  uploadFile, getFiles, getFileDetails, downloadFile, deleteFile,
  // Checkout / check-in
  checkoutFile, checkinFile, forceCheckin,
  // Versions
  createFileVersion, getFileVersions, restoreFileVersion,
  // Comments
  addComment, deleteComment,
  // Collaborators
  addCollaborator, removeCollaborator, getFileAuditTrail,
  // Sharing
  shareFile, revokeAccess, generateShareLink,
  // User
  getUserFiles, getUserStats,
  // Search
  globalSearch, getRecentFiles,
  // Bulk
  bulkUploadFiles,
  // Analytics
  getStorageStats, getActivityLog, getDepartmentStats, getSharePointDashboardStats
};








// const { SharePointFolder, SharePointFile, SharePointActivityLog } = require('../models/SharePoint');
// const User = require('../models/User');
// const fs = require('fs');
// const path = require('path');
// const crypto = require('crypto');
// const mongoose = require('mongoose');
// const {
//   canUserAccessFolder,
//   canUserUploadToFolder,
//   canUserManageFolder,
//   canUserDeleteFolder,
//   isFolderVisibleToUser
// } = require('../utils/sharepointAccessHelpers');

// // ============ FOLDER OPERATIONS ============

// const createFolder = async (req, res) => {
//   try {
//     const { name, description, department, privacyLevel, allowedDepartments } = req.body;
//     const user = await User.findById(req.user.userId);

//     // Validation
//     if (!name || !description || !department) {
//       return res.status(400).json({
//         success: false,
//         message: 'Missing required fields: name, description, department'
//       });
//     }

//     if (!['public', 'department', 'confidential'].includes(privacyLevel)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid privacy level'
//       });
//     }

//     // Check if folder already exists
//     const existingFolder = await SharePointFolder.findOne({ name });
//     if (existingFolder) {
//       return res.status(400).json({
//         success: false,
//         message: 'Folder with this name already exists'
//       });
//     }

//     const folder = new SharePointFolder({
//       name,
//       description,
//       department,
//       privacyLevel: privacyLevel || 'department',
//       isPublic: privacyLevel === 'public', // For backward compatibility
//       createdBy: req.user.userId,
//       accessControl: {
//         allowedDepartments: allowedDepartments || [department],
//         allowedUsers: [req.user.userId],
//         invitedUsers: [],
//         blockedUsers: []
//       }
//     });

//     await folder.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'folder_create',
//       userId: req.user.userId,
//       folderId: folder._id,
//       folderName: folder.name,
//       details: {
//         department,
//         privacyLevel
//       }
//     }).save();

//     res.status(201).json({
//       success: true,
//       message: 'Folder created successfully',
//       data: folder
//     });

//   } catch (error) {
//     console.error('Create folder error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create folder',
//       error: error.message
//     });
//   }
// };


// const getFolders = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const { department, includeAll } = req.query;

//     // Get ALL folders first
//     let allFolders = await SharePointFolder.find({})
//       .populate('createdBy', 'fullName email')
//       .sort({ createdAt: -1 });

//     // Filter folders based on visibility
//     const visibleFolders = allFolders.filter(folder => 
//       isFolderVisibleToUser(folder, user)
//     );

//     // Apply department filter if requested
//     let filteredFolders = visibleFolders;
//     if (department && department !== 'all') {
//       filteredFolders = visibleFolders.filter(f => f.department === department);
//     }

//     // Add access info for current user
//     const foldersWithAccess = filteredFolders.map(folder => {
//       const access = canUserAccessFolder(folder, user);
//       const canUpload = canUserUploadToFolder(folder, user);
//       const canManage = canUserManageFolder(folder, user);
//       const canDelete = canUserDeleteFolder(folder, user);

//       return {
//         ...folder.toObject(),
//         userAccess: {
//           canView: access.canAccess,
//           canUpload: canUpload,
//           canManage: canManage,
//           canDelete: canDelete,
//           permission: access.permission,
//           reason: access.reason
//         }
//       };
//     });

//     console.log('=== GET FOLDERS DEBUG ===');
//     console.log('User:', {
//       id: user._id.toString(),
//       role: user.role,
//       department: user.department
//     });
//     console.log('Total folders in DB:', allFolders.length);
//     console.log('Visible to user:', visibleFolders.length);
//     console.log('After filters:', foldersWithAccess.length);

//     res.json({
//       success: true,
//       data: foldersWithAccess,
//       count: foldersWithAccess.length,
//       userDepartment: user.department
//     });

//   } catch (error) {
//     console.error('Get folders error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch folders',
//       error: error.message
//     });
//   }
// };

// const getFolder = async (req, res) => {
//   try {
//     const { folderId } = req.params;
    
//     const folder = await SharePointFolder.findById(folderId)
//       .populate('createdBy', 'fullName email');

//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     // Check access permission
//     const user = await User.findById(req.user.userId);
//     const hasAccess = 
//       folder.isPublic ||
//       folder.department === user.department ||
//       folder.accessControl.allowedDepartments.includes(user.department) ||
//       folder.accessControl.allowedUsers.includes(req.user.userId) ||
//       user.role === 'admin';

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied to this folder'
//       });
//     }

//     res.json({
//       success: true,
//       data: folder
//     });

//   } catch (error) {
//     console.error('Get folder error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch folder',
//       error: error.message
//     });
//   }
// };

// const updateFolder = async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     const { description, isPublic, allowedDepartments } = req.body;

//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const user = await User.findById(req.user.userId);

//     // Check permission
//     if (!canUserManageFolder(folder, user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to manage this folder'
//       });
//     }

//     // Update fields
//     if (description) folder.description = description;
//     if (isPublic !== undefined) folder.isPublic = isPublic;
//     if (allowedDepartments) folder.accessControl.allowedDepartments = allowedDepartments;

//     folder.updatedAt = new Date();
//     await folder.save();

//     res.json({
//       success: true,
//       message: 'Folder updated successfully',
//       data: folder
//     });

//   } catch (error) {
//     console.error('Update folder error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update folder',
//       error: error.message
//     });
//   }
// };

// const deleteFolder = async (req, res) => {
//   try {
//     const { folderId } = req.params;

//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const user = await User.findById(req.user.userId);

//     // Check permission
//     if (!canUserDeleteFolder(folder, user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to delete this folder'
//       });
//     }

//     // Check if folder has files
//     const fileCount = await SharePointFile.countDocuments({ folderId, isDeleted: false });
//     if (fileCount > 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot delete folder with existing files. Please delete files first.'
//       });
//     }

//     await SharePointFolder.findByIdAndDelete(folderId);

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'delete',
//       userId: req.user.userId,
//       folderId,
//       folderName: folder.name
//     }).save();

//     res.json({
//       success: true,
//       message: 'Folder deleted successfully'
//     });

//   } catch (error) {
//     console.error('Delete folder error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete folder',
//       error: error.message
//     });
//   }
// };

// // ============ FILE OPERATIONS ============

// const uploadFile = async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     const { description, tags } = req.body;

//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file provided'
//       });
//     }

//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       if (req.file.path && fs.existsSync(req.file.path)) {
//         fs.unlinkSync(req.file.path);
//       }
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const user = await User.findById(req.user.userId);

//     // Check upload permission using new access control
//     if (!canUserUploadToFolder(folder, user)) {
//       if (req.file.path && fs.existsSync(req.file.path)) {
//         fs.unlinkSync(req.file.path);
//       }
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to upload to this folder'
//       });
//     }

//     // Check storage quota
//     const totalSize = await SharePointFile.aggregate([
//       { $match: { folderId: folder._id, isDeleted: false } },
//       { $group: { _id: null, totalSize: { $sum: '$size' } } }
//     ]);

//     const currentTotal = totalSize[0]?.totalSize || 0;
//     const maxStoragePerFolder = 10 * 1024 * 1024 * 1024; // 10GB

//     if (currentTotal + req.file.size > maxStoragePerFolder) {
//       fs.unlinkSync(req.file.path);
//       return res.status(400).json({
//         success: false,
//         message: 'Storage quota exceeded for this folder'
//       });
//     }

//     // Create file document
//     const file = new SharePointFile({
//       folderId,
//       name: req.file.originalname,
//       description,
//       mimetype: req.file.mimetype,
//       size: req.file.size,
//       path: req.file.path,
//       publicId: req.file.filename,
//       uploadedBy: req.user.userId,
//       tags: tags ? tags.split(',').map(t => t.trim()) : []
//     });

//     await file.save();

//     // Update folder metadata
//     folder.fileCount += 1;
//     folder.totalSize += req.file.size;
//     folder.lastModified = new Date();
//     await folder.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'upload',
//       userId: req.user.userId,
//       fileId: file._id,
//       folderId,
//       fileName: file.name,
//       folderName: folder.name
//     }).save();

//     res.status(201).json({
//       success: true,
//       message: 'File uploaded successfully',
//       data: file
//     });

//   } catch (error) {
//     console.error('Upload file error:', error);
//     if (req.file?.path && fs.existsSync(req.file.path)) {
//       fs.unlinkSync(req.file.path);
//     }
//     res.status(500).json({
//       success: false,
//       message: 'Failed to upload file',
//       error: error.message
//     });
//   }
// };


// const getFiles = async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     const { search, sortBy, tags } = req.query;
//     const user = await User.findById(req.user.userId);

//     // Verify folder exists
//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     // Check if user has access to this folder
//     const access = canUserAccessFolder(folder, user);
//     if (!access.canAccess) {
//       return res.status(403).json({
//         success: false,
//         message: access.reason || 'You do not have access to this folder'
//       });
//     }

//     let query = { folderId, isDeleted: false };

//     // Search filter
//     if (search) {
//       query.name = { $regex: search, $options: 'i' };
//     }

//     // Tags filter
//     if (tags) {
//       const tagArray = tags.split(',').map(t => t.trim());
//       query.tags = { $in: tagArray };
//     }

//     let fileQuery = SharePointFile.find(query)
//       .populate('uploadedBy', 'fullName email')
//       .populate('sharedWith.userId', 'fullName email');

//     // Sorting
//     if (sortBy === 'recent') {
//       fileQuery = fileQuery.sort({ uploadedAt: -1 });
//     } else if (sortBy === 'size') {
//       fileQuery = fileQuery.sort({ size: -1 });
//     } else if (sortBy === 'name') {
//       fileQuery = fileQuery.sort({ name: 1 });
//     } else {
//       fileQuery = fileQuery.sort({ uploadedAt: -1 });
//     }

//     const files = await fileQuery.exec();

//     // Add user permissions to each file
//     const filesWithPermissions = files.map(file => ({
//       ...file.toObject(),
//       userPermissions: {
//         canDownload: ['download', 'upload', 'manage'].includes(access.permission),
//         canDelete: access.permission === 'manage' || file.uploadedBy._id.toString() === user._id.toString(),
//         canShare: ['upload', 'manage'].includes(access.permission)
//       }
//     }));

//     res.json({
//       success: true,
//       data: filesWithPermissions,
//       count: filesWithPermissions.length,
//       folder: {
//         id: folder._id,
//         name: folder.name,
//         department: folder.department,
//         privacyLevel: folder.privacyLevel
//       },
//       userPermission: access.permission
//     });

//   } catch (error) {
//     console.error('Get files error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch files',
//       error: error.message
//     });
//   }
// };

// const getFileDetails = async (req, res) => {
//   try {
//     const { fileId } = req.params;
    
//     const file = await SharePointFile.findById(fileId)
//       .populate('uploadedBy', 'fullName email')
//       .populate('folderId', 'name department')
//       .populate('sharedWith.userId', 'fullName email');

//     if (!file || file.isDeleted) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     res.json({
//       success: true,
//       data: file
//     });

//   } catch (error) {
//     console.error('Get file details error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch file details',
//       error: error.message
//     });
//   }
// };

// const downloadFile = async (req, res) => {
//   try {
//     const { fileId } = req.params;

//     const file = await SharePointFile.findById(fileId);
//     if (!file || file.isDeleted) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     // Check if file exists on disk
//     if (!fs.existsSync(file.path)) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found on server'
//       });
//     }

//     // Log download
//     file.downloads += 1;
//     file.downloadLog.push({
//       userId: req.user.userId,
//       downloadedAt: new Date(),
//       ipAddress: req.ip
//     });
//     await file.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'download',
//       userId: req.user.userId,
//       fileId,
//       fileName: file.name
//     }).save();

//     // Send file
//     res.download(file.path, file.name, (err) => {
//       if (err) {
//         console.error('Download error:', err);
//       }
//     });

//   } catch (error) {
//     console.error('Download file error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to download file',
//       error: error.message
//     });
//   }
// };

// const deleteFile = async (req, res) => {
//   try {
//     const { fileId } = req.params;
//     const { permanently } = req.query;
//     const user = await User.findById(req.user.userId);

//     const file = await SharePointFile.findById(fileId);
//     if (!file) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     // Check permission
//     if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin') {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to delete this file'
//       });
//     }

//     if (permanently === 'true') {
//       // Permanently delete
//       if (fs.existsSync(file.path)) {
//         fs.unlinkSync(file.path);
//       }

//       // Update folder metadata
//       const folder = await SharePointFolder.findById(file.folderId);
//       if (folder) {
//         folder.fileCount -= 1;
//         folder.totalSize -= file.size;
//         await folder.save();
//       }

//       await SharePointFile.findByIdAndDelete(fileId);
//     } else {
//       // Soft delete
//       file.isDeleted = true;
//       file.deletedAt = new Date();
//       file.deletedBy = req.user.userId;
//       await file.save();
//     }

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'delete',
//       userId: req.user.userId,
//       fileId,
//       fileName: file.name
//     }).save();

//     res.json({
//       success: true,
//       message: 'File deleted successfully'
//     });

//   } catch (error) {
//     console.error('Delete file error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete file',
//       error: error.message
//     });
//   }
// };

// // ============ USER-SPECIFIC OPERATIONS ============

// const getUserFiles = async (req, res) => {
//   try {
//     const { search, folderId, sortBy } = req.query;

//     let query = {
//       uploadedBy: req.user.userId,
//       isDeleted: false
//     };

//     if (search) {
//       query.name = { $regex: search, $options: 'i' };
//     }

//     if (folderId && folderId !== 'all') {
//       query.folderId = folderId;
//     }

//     let fileQuery = SharePointFile.find(query)
//       .populate('uploadedBy', 'fullName email')
//       .populate('folderId', 'name department');

//     // Apply sorting
//     if (sortBy === 'recent') {
//       fileQuery = fileQuery.sort({ uploadedAt: -1 });
//     } else if (sortBy === 'size') {
//       fileQuery = fileQuery.sort({ size: -1 });
//     } else if (sortBy === 'name') {
//       fileQuery = fileQuery.sort({ name: 1 });
//     } else {
//       fileQuery = fileQuery.sort({ uploadedAt: -1 });
//     }

//     const files = await fileQuery.exec();

//     res.json({
//       success: true,
//       data: files,
//       count: files.length
//     });

//   } catch (error) {
//     console.error('Get user files error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch your files',
//       error: error.message
//     });
//   }
// };


// const getUserStats = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);

//     // Get folders belonging to user's department or created by user
//     const userFolders = await SharePointFolder.find({
//       $or: [
//         { department: user.department },
//         { createdBy: req.user.userId },
//         { 'accessControl.allowedDepartments': user.department },
//         { 'accessControl.allowedUsers': req.user.userId }
//       ]
//     });

//     const userFolderIds = userFolders.map(f => f._id);

//     // Get files from accessible folders only
//     const stats = await SharePointFile.aggregate([
//       {
//         $match: {
//           folderId: { $in: userFolderIds },
//           uploadedBy: mongoose.Types.ObjectId(req.user.userId),
//           isDeleted: false
//         }
//       },
//       {
//         $group: {
//           _id: null,
//           filesUploaded: { $sum: 1 },
//           totalSize: { $sum: '$size' },
//           totalDownloads: { $sum: '$downloads' }
//         }
//       }
//     ]);

//     const activityStats = await SharePointActivityLog.aggregate([
//       { $match: { userId: mongoose.Types.ObjectId(req.user.userId) } },
//       { $group: {
//           _id: '$action',
//           count: { $sum: 1 }
//         }
//       }
//     ]);

//     // Get recent uploads from accessible folders
//     const recentUploads = await SharePointFile.find({
//       folderId: { $in: userFolderIds },
//       uploadedBy: req.user.userId,
//       isDeleted: false
//     })
//     .sort({ uploadedAt: -1 })
//     .limit(5)
//     .populate('folderId', 'name department');

//     console.log('=== USER STATS DEBUG ===');
//     console.log('User:', {
//       id: user._id.toString(),
//       department: user.department
//     });
//     console.log('Accessible folders count:', userFolderIds.length);
//     console.log('User uploads:', stats[0]?.filesUploaded || 0);

//     res.json({
//       success: true,
//       data: {
//         uploads: stats[0] || {
//           filesUploaded: 0,
//           totalSize: 0,
//           totalDownloads: 0
//         },
//         activity: activityStats,
//         recentUploads,
//         userDepartment: user.department,
//         accessibleFoldersCount: userFolderIds.length
//       }
//     });

//   } catch (error) {
//     console.error('Get user stats error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch user statistics',
//       error: error.message
//     });
//   }
// };

// // ============ SHARING OPERATIONS ============
// const shareFile = async (req, res) => {
//   try {
//     const { fileId } = req.params;
//     const { shareWith, permission, type } = req.body;

//     const file = await SharePointFile.findById(fileId);
//     if (!file) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     const user = await User.findById(req.user.userId);
    
//     // Check if user can share (uploader, manage permission, or admin)
//     const folder = await SharePointFolder.findById(file.folderId);
//     const access = canUserAccessFolder(folder, user);
    
//     if (!['upload', 'manage'].includes(access.permission) && 
//         file.uploadedBy.toString() !== req.user.userId && 
//         user.role !== 'admin') {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to share this file'
//       });
//     }

//     // Handle sharing by user or department
//     if (type === 'user') {
//       let userId = shareWith;
      
//       // If it looks like an email, find the user
//       if (shareWith.includes('@')) {
//         const targetUser = await User.findOne({ email: shareWith });
//         if (!targetUser) {
//           return res.status(404).json({
//             success: false,
//             message: `User with email ${shareWith} not found`
//           });
//         }
//         userId = targetUser._id.toString();
//       } else {
//         // Validate ObjectId
//         if (!mongoose.Types.ObjectId.isValid(shareWith)) {
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid user ID or email format'
//           });
//         }
        
//         const targetUser = await User.findById(shareWith);
//         if (!targetUser) {
//           return res.status(404).json({
//             success: false,
//             message: 'User not found'
//           });
//         }
//       }

//       // Check if already shared
//       const existingShare = file.sharedWith.find(s => s.userId?.toString() === userId);
//       if (existingShare) {
//         // Update permission
//         existingShare.permission = permission || 'download';
//         existingShare.type = permission || 'download';
//       } else {
//         // Add new share
//         file.sharedWith.push({
//           userId: userId,
//           permission: permission || 'download',
//           type: permission || 'download',
//           sharedAt: new Date(),
//           sharedBy: req.user.userId
//         });
//       }
//     } else if (type === 'department') {
//       // Check if already shared with department
//       const existingDeptShare = file.sharedWith.find(s => s.department === shareWith);
//       if (existingDeptShare) {
//         existingDeptShare.permission = permission || 'download';
//         existingDeptShare.type = permission || 'download';
//       } else {
//         file.sharedWith.push({
//           department: shareWith,
//           permission: permission || 'download',
//           type: permission || 'download',
//           sharedAt: new Date(),
//           sharedBy: req.user.userId
//         });
//       }
//     } else {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid share type. Must be "user" or "department"'
//       });
//     }

//     await file.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'share',
//       userId: req.user.userId,
//       fileId,
//       fileName: file.name,
//       details: { shareWith, permission, type }
//     }).save();

//     res.json({
//       success: true,
//       message: 'File shared successfully',
//       data: file
//     });

//   } catch (error) {
//     console.error('Share file error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to share file',
//       error: error.message
//     });
//   }
// };


// const revokeAccess = async (req, res) => {
//   try {
//     const { fileId, userId } = req.params;

//     const file = await SharePointFile.findById(fileId);
//     if (!file) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     // Remove from shared list
//     file.sharedWith = file.sharedWith.filter(s => s.userId?.toString() !== userId);
//     await file.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'access_revoked',
//       userId: req.user.userId,
//       fileId,
//       fileName: file.name
//     }).save();

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

// const generateShareLink = async (req, res) => {
//   try {
//     const { fileId } = req.params;
//     const { expiresIn = 604800 } = req.body; // Default 7 days in seconds
//     const user = await User.findById(req.user.userId);

//     const file = await SharePointFile.findById(fileId);
//     if (!file || file.isDeleted) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     // // Check permission
//     // if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin') {
//     //   return res.status(403).json({
//     //     success: false,
//     //     message: 'You do not have permission to generate share link'
//     //   });
//     // }

//     // Generate unique token
//     const token = crypto.randomBytes(32).toString('hex');
//     const expiresAt = new Date(Date.now() + expiresIn * 1000);

//     file.shareLink = {
//       token,
//       expiresAt,
//       createdBy: req.user.userId
//     };

//     await file.save();

//     const shareLink = `${process.env.FRONTEND_URL}/sharepoint/shared/${token}`;

//     res.json({
//       success: true,
//       message: 'Share link generated successfully',
//       data: {
//         shareLink,
//         expiresAt
//       }
//     });

//   } catch (error) {
//     console.error('Generate share link error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to generate share link',
//       error: error.message
//     });
//   }
// };

// const globalSearch = async (req, res) => {
//   try {
//     const { query, fileType, department } = req.query;
//     const user = await User.findById(req.user.userId);

//     if (!query) {
//       return res.status(400).json({
//         success: false,
//         message: 'Search query is required'
//       });
//     }

//     // Get folders accessible to user based on their department
//     const accessibleFolders = await SharePointFolder.find({
//       $or: [
//         { isPublic: true },
//         { department: user.department },
//         { 'accessControl.allowedDepartments': user.department },
//         { 'accessControl.allowedUsers': req.user.userId },
//         { createdBy: req.user.userId },
//         ...(user.role === 'admin' ? [{}] : []) // Admin can access all
//       ]
//     });

//     const accessibleFolderIds = accessibleFolders.map(f => f._id);

//     let searchQuery = {
//       isDeleted: false,
//       folderId: { $in: accessibleFolderIds },
//       $or: [
//         { name: { $regex: query, $options: 'i' } },
//         { description: { $regex: query, $options: 'i' } },
//         { tags: { $in: [new RegExp(query, 'i')] } }
//       ]
//     };

//     // File type filter
//     if (fileType) {
//       searchQuery.mimetype = { $regex: fileType, $options: 'i' };
//     }

//     // Department filter (if user is allowed to view other departments)
//     if (department && (user.role === 'admin' || user.department === department)) {
//       searchQuery['folder.department'] = department;
//     }

//     const files = await SharePointFile.find(searchQuery)
//       .populate('uploadedBy', 'fullName email')
//       .populate('folderId', 'name department')
//       .sort({ uploadedAt: -1 })
//       .limit(50);

//     console.log('=== GLOBAL SEARCH DEBUG ===');
//     console.log('User department:', user.department);
//     console.log('Accessible folders:', accessibleFolderIds.length);
//     console.log('Search results:', files.length);

//     res.json({
//       success: true,
//       data: files,
//       count: files.length,
//       userDepartment: user.department
//     });

//   } catch (error) {
//     console.error('Global search error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to search files',
//       error: error.message
//     });
//   }
// };

// const getRecentFiles = async (req, res) => {
//   try {
//     const { days = 7 } = req.query;
//     const user = await User.findById(req.user.userId);

//     // Get folders accessible to user's department
//     const accessibleFolders = await SharePointFolder.find({
//       $or: [
//         { isPublic: true },
//         { department: user.department },
//         { 'accessControl.allowedDepartments': user.department },
//         { 'accessControl.allowedUsers': req.user.userId },
//         { createdBy: req.user.userId },
//         ...(user.role === 'admin' ? [{}] : [])
//       ]
//     });

//     const accessibleFolderIds = accessibleFolders.map(f => f._id);

//     const startDate = new Date();
//     startDate.setDate(startDate.getDate() - parseInt(days));

//     const files = await SharePointFile.find({
//       uploadedAt: { $gte: startDate },
//       isDeleted: false,
//       folderId: { $in: accessibleFolderIds }
//     })
//       .populate('uploadedBy', 'fullName email')
//       .populate('folderId', 'name department')
//       .sort({ uploadedAt: -1 })
//       .limit(20);

//     console.log('=== RECENT FILES DEBUG ===');
//     console.log('User department:', user.department);
//     console.log('Days range:', days);
//     console.log('Recent files found:', files.length);

//     res.json({
//       success: true,
//       data: files,
//       count: files.length,
//       userDepartment: user.department
//     });

//   } catch (error) {
//     console.error('Get recent files error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch recent files',
//       error: error.message
//     });
//   }
// };

// // ============ BULK OPERATIONS ============

// const bulkUploadFiles = async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     const { description, tags } = req.body;

//     if (!req.files || req.files.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'No files provided'
//       });
//     }

//     const folder = await SharePointFolder.findById(folderId);
//     if (!folder) {
//       // Cleanup files
//       req.files.forEach(file => {
//         if (fs.existsSync(file.path)) {
//           fs.unlinkSync(file.path);
//         }
//       });
//       return res.status(404).json({
//         success: false,
//         message: 'Folder not found'
//       });
//     }

//     const user = await User.findById(req.user.userId);

//     // Check upload permission
//     if (!canUserUploadToFolder(folder, user)) {
//       // Cleanup files
//       req.files.forEach(file => {
//         if (fs.existsSync(file.path)) {
//           fs.unlinkSync(file.path);
//         }
//       });
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to upload to this folder'
//       });
//     }

//     const uploadedFiles = [];
//     let totalSize = 0;

//     for (const file of req.files) {
//       const newFile = new SharePointFile({
//         folderId,
//         name: file.originalname,
//         description,
//         mimetype: file.mimetype,
//         size: file.size,
//         path: file.path,
//         publicId: file.filename,
//         uploadedBy: req.user.userId,
//         tags: tags ? tags.split(',').map(t => t.trim()) : []
//       });

//       await newFile.save();
//       uploadedFiles.push(newFile);
//       totalSize += file.size;

//       // Log activity
//       await new SharePointActivityLog({
//         action: 'upload',
//         userId: req.user.userId,
//         fileId: newFile._id,
//         folderId,
//         fileName: newFile.name,
//         folderName: folder.name
//       }).save();
//     }

//     // Update folder metadata
//     folder.fileCount += uploadedFiles.length;
//     folder.totalSize += totalSize;
//     folder.lastModified = new Date();
//     await folder.save();

//     res.status(201).json({
//       success: true,
//       message: `${uploadedFiles.length} files uploaded successfully`,
//       data: uploadedFiles
//     });

//   } catch (error) {
//     console.error('Bulk upload error:', error);
//     if (req.files) {
//       req.files.forEach(file => {
//         if (fs.existsSync(file.path)) {
//           fs.unlinkSync(file.path);
//         }
//       });
//     }
//     res.status(500).json({
//       success: false,
//       message: 'Failed to upload files',
//       error: error.message
//     });
//   }
// };

// // ============ ANALYTICS & REPORTING ============

// const getStorageStats = async (req, res) => {
//   try {
//     const { folderId, department } = req.query;

//     let match = { isDeleted: false };
//     if (folderId) match.folderId = mongoose.Types.ObjectId(folderId);

//     const stats = await SharePointFile.aggregate([
//       { $match: match },
//       { $group: {
//           _id: null,
//           totalFiles: { $sum: 1 },
//           totalSize: { $sum: '$size' },
//           averageFileSize: { $avg: '$size' },
//           largestFile: { $max: '$size' }
//         }
//       }
//     ]);

//     const filesByType = await SharePointFile.aggregate([
//       { $match: match },
//       { $group: {
//           _id: '$mimetype',
//           count: { $sum: 1 },
//           totalSize: { $sum: '$size' }
//         }
//       }
//     ]);

//     const folderStats = await SharePointFolder.aggregate([
//       { $group: {
//           _id: '$department',
//           folderCount: { $sum: 1 },
//           totalFiles: { $sum: '$fileCount' },
//           totalSize: { $sum: '$totalSize' }
//         }
//       }
//     ]);

//     res.json({
//       success: true,
//       data: {
//         overall: stats[0] || {},
//         byType: filesByType,
//         byDepartment: folderStats
//       }
//     });

//   } catch (error) {
//     console.error('Get storage stats error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch storage stats',
//       error: error.message
//     });
//   }
// };

// const getActivityLog = async (req, res) => {
//   try {
//     const { days = 30, action, userId } = req.query;

//     const startDate = new Date();
//     startDate.setDate(startDate.getDate() - parseInt(days));

//     let query = { timestamp: { $gte: startDate } };
//     if (action) query.action = action;
//     if (userId) query.userId = userId;

//     const logs = await SharePointActivityLog.find(query)
//       .populate('userId', 'fullName email')
//       .sort({ timestamp: -1 })
//       .limit(1000);

//     res.json({
//       success: true,
//       data: logs,
//       count: logs.length
//     });

//   } catch (error) {
//     console.error('Get activity log error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch activity log',
//       error: error.message
//     });
//   }
// };

// const getDepartmentStats = async (req, res) => {
//   try {
//     const { department } = req.params;
//     const user = await User.findById(req.user.userId);

//     // Check permission
//     if (user.role !== 'admin' && user.department !== department) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied'
//       });
//     }

//     const folders = await SharePointFolder.find({ department });
    
//     const stats = await SharePointFile.aggregate([
//       {
//         $lookup: {
//           from: 'sharepointfolders',
//           localField: 'folderId',
//           foreignField: '_id',
//           as: 'folder'
//         }
//       },
//       { $unwind: '$folder' },
//       { $match: { 'folder.department': department, isDeleted: false } },
//       {
//         $group: {
//           _id: null,
//           totalFiles: { $sum: 1 },
//           totalSize: { $sum: '$size' },
//           totalDownloads: { $sum: '$downloads' }
//         }
//       }
//     ]);

//     res.json({
//       success: true,
//       data: {
//         department,
//         folders: folders.length,
//         ...stats[0] || { totalFiles: 0, totalSize: 0, totalDownloads: 0 }
//       }
//     });

//   } catch (error) {
//     console.error('Get department stats error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch department statistics',
//       error: error.message
//     });
//   }
// };

// // ============ VERSION CONTROL ============

// const createFileVersion = async (req, res) => {
//   try {
//     const { fileId } = req.params;
//     const user = await User.findById(req.user.userId);
    
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file provided'
//       });
//     }

//     const file = await SharePointFile.findById(fileId);
//     if (!file || file.isDeleted) {
//       if (req.file.path && fs.existsSync(req.file.path)) {
//         fs.unlinkSync(req.file.path);
//       }
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     // Check permission
//     if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin') {
//       if (req.file.path && fs.existsSync(req.file.path)) {
//         fs.unlinkSync(req.file.path);
//       }
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to create versions'
//       });
//     }

//     // Save current version
//     file.versions.push({
//       versionNumber: file.versions.length + 1,
//       path: file.path,
//       size: file.size,
//       mimetype: file.mimetype,
//       uploadedBy: file.uploadedBy,
//       uploadedAt: file.uploadedAt
//     });

//     // Update to new version
//     file.path = req.file.path;
//     file.size = req.file.size;
//     file.mimetype = req.file.mimetype;
//     file.uploadedAt = new Date();
//     file.publicId = req.file.filename;

//     await file.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'version_create',
//       userId: req.user.userId,
//       fileId,
//       fileName: file.name,
//       details: { versionNumber: file.versions.length }
//     }).save();

//     res.json({
//       success: true,
//       message: 'New version created successfully',
//       data: file
//     });

//   } catch (error) {
//     console.error('Create file version error:', error);
//     if (req.file?.path && fs.existsSync(req.file.path)) {
//       fs.unlinkSync(req.file.path);
//     }
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create file version',
//       error: error.message
//     });
//   }
// };

// const getFileVersions = async (req, res) => {
//   try {
//     const { fileId } = req.params;
    
//     const file = await SharePointFile.findById(fileId);
//     if (!file) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     res.json({
//       success: true,
//       data: file.versions || []
//     });

//   } catch (error) {
//     console.error('Get file versions error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch file versions',
//       error: error.message
//     });
//   }
// };

// const restoreFileVersion = async (req, res) => {
//   try {
//     const { fileId, versionIndex } = req.params;
//     const user = await User.findById(req.user.userId);

//     const file = await SharePointFile.findById(fileId);
//     if (!file || file.isDeleted) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     // Check permission
//     if (file.uploadedBy.toString() !== req.user.userId && user.role !== 'admin') {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to restore versions'
//       });
//     }

//     const version = file.versions[parseInt(versionIndex)];
//     if (!version) {
//       return res.status(404).json({
//         success: false,
//         message: 'Version not found'
//       });
//     }

//     // Check if version file exists
//     if (!fs.existsSync(version.path)) {
//       return res.status(404).json({
//         success: false,
//         message: 'Version file not found on server'
//       });
//     }

//     // Save current as version
//     file.versions.push({
//       versionNumber: file.versions.length + 1,
//       path: file.path,
//       size: file.size,
//       mimetype: file.mimetype,
//       uploadedBy: file.uploadedBy,
//       uploadedAt: file.uploadedAt
//     });

//     // Restore version
//     file.path = version.path;
//     file.size = version.size;
//     file.mimetype = version.mimetype;
//     file.uploadedAt = new Date();

//     await file.save();

//     // Log activity
//     await new SharePointActivityLog({
//       action: 'version_restore',
//       userId: req.user.userId,
//       fileId,
//       fileName: file.name,
//       details: { restoredVersion: version.versionNumber }
//     }).save();

//     res.json({
//       success: true,
//       message: 'Version restored successfully',
//       data: file
//     });

//   } catch (error) {
//     console.error('Restore file version error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to restore file version',
//       error: error.message
//     });
//   }
// };

// // Get SharePoint dashboard statistics (for dashboard card)
// const getSharePointDashboardStats = async (req, res) => {
//   try {
//     const userId = req.user.userId;
//     const user = await User.findById(userId);

//     console.log('=== GET SHAREPOINT DASHBOARD STATS ===');
//     console.log('User:', userId);
//     console.log('Role:', user.role);
//     console.log('Department:', user.department);

//     // Get folders accessible to user
//     const accessibleFolders = await SharePointFolder.find({
//       $or: [
//         { isPublic: true },
//         { department: user.department },
//         { 'accessControl.allowedDepartments': user.department },
//         { 'accessControl.allowedUsers': userId },
//         { createdBy: userId },
//         ...(user.role === 'admin' ? [{}] : [])
//       ]
//     });

//     const accessibleFolderIds = accessibleFolders.map(f => f._id);

//     // Get file statistics
//     const [
//       totalFiles,
//       userUploadedFiles,
//       recentFiles
//     ] = await Promise.all([
//       SharePointFile.countDocuments({
//         folderId: { $in: accessibleFolderIds },
//         isDeleted: false
//       }),
//       SharePointFile.countDocuments({
//         uploadedBy: userId,
//         isDeleted: false
//       }),
//       SharePointFile.countDocuments({
//         folderId: { $in: accessibleFolderIds },
//         isDeleted: false,
//         uploadedAt: {
//           $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
//         }
//       })
//     ]);

//     const stats = {
//       pending: 0, // SharePoint doesn't have pending concept, but keeping for consistency
//       total: totalFiles,
//       userUploaded: userUploadedFiles,
//       recent: recentFiles,
//       accessibleFolders: accessibleFolders.length
//     };

//     console.log('SharePoint Stats:', stats);

//     res.status(200).json({
//       success: true,
//       data: stats
//     });

//   } catch (error) {
//     console.error('Error fetching SharePoint dashboard stats:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch SharePoint dashboard stats',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined
//     });
//   }
// };


// module.exports = {
//   // Folder operations
//   createFolder,
//   getFolders,
//   getFolder,
//   updateFolder,
//   deleteFolder,
  
//   // File operations
//   uploadFile,
//   getFiles,
//   getFileDetails,
//   downloadFile,
//   deleteFile,
  
//   // User-specific
//   getUserFiles,
//   getUserStats,
  
//   // Sharing
//   shareFile,
//   revokeAccess,
//   generateShareLink,
  
//   // Search & Discovery
//   globalSearch,
//   getRecentFiles,
  
//   // Bulk operations
//   bulkUploadFiles,
  
//   // Analytics
//   getStorageStats,
//   getActivityLog,
//   getDepartmentStats,
  
//   // Version control
//   createFileVersion,
//   getFileVersions,
//   restoreFileVersion,

//   // Dashboard stats
//   getSharePointDashboardStats
  
// }

