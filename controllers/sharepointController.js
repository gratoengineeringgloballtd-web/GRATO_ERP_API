const { SharePointFolder, SharePointFile, SharePointActivityLog } = require('../models/SharePoint');
const User = require('../models/User');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');
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

// Resolve whether a user can access a given FILE (not just the folder), accounting
// for direct file-level grants (owner, sharedWith, collaborator) in addition to
// folder-level access. Several endpoints only checked file *ownership* for specific
// actions but never checked base folder access at all, letting any authenticated
// user interact with (comment on, check out, view version history/audit trail of)
// files in folders — including confidential ones — they had no access to.
const canUserAccessFile = async (file, user) => {
  if (!file || !user) return false;
  const uid = user._id.toString();
  if (user.role === 'admin') return true;
  if (file.uploadedBy.toString() === uid) return true;
  if ((file.sharedWith || []).some(s => s.userId?.toString() === uid)) return true;
  if ((file.collaborators || []).some(c => c.userId.toString() === uid)) return true;

  const folder = await SharePointFolder.findById(file.folderId);
  if (!folder) return false;
  return canUserAccessFolder(folder, user).canAccess;
};

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

const PRIVACY_RANK = { public: 0, department: 1, confidential: 2 };

const createFolder = async (req, res) => {
  try {
    const { name, description, privacyLevel, allowedDepartments, parentFolderId } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    if (!name || !description) {
      return res.status(400).json({ success: false, message: 'name and description are required' });
    }

    let parentFolder = null;
    if (parentFolderId) {
      if (!mongoose.Types.ObjectId.isValid(parentFolderId)) {
        return res.status(400).json({ success: false, message: 'Invalid parentFolderId' });
      }
      parentFolder = await SharePointFolder.findById(parentFolderId);
      if (!parentFolder) {
        return res.status(404).json({ success: false, message: 'Parent folder not found' });
      }
      if (!canUserUploadToFolder(parentFolder, user)) {
        return res.status(403).json({ success: false, message: 'No permission to create a subfolder here' });
      }
    }

    // ── Determine department ───────────────────────────────────────────────
    // A subfolder must stay within its parent's department - otherwise a
    // department-scoped access check on the parent wouldn't hold for the child.
    // Top-level folders: admins can specify any department; everyone else uses their own.
    const department = parentFolder
      ? parentFolder.department
      : (user.role === 'admin' ? (req.body.department || user.department) : user.department);

    if (!department) {
      return res.status(400).json({ success: false, message: 'department is required' });
    }

    // ── Determine privacy level ─────────────────────────────────────────────
    // A subfolder can be equally or more restrictive than its parent, never less -
    // otherwise a 'confidential' folder could contain a 'public' one that leaks its
    // contents to anyone.
    let resolvedPrivacy = ['public', 'department', 'confidential'].includes(privacyLevel)
      ? privacyLevel
      : (parentFolder ? parentFolder.privacyLevel : 'department');

    if (parentFolder && PRIVACY_RANK[resolvedPrivacy] < PRIVACY_RANK[parentFolder.privacyLevel]) {
      return res.status(400).json({
        success: false,
        message: `Subfolder privacy level cannot be less restrictive than its parent (${parentFolder.privacyLevel})`
      });
    }

    // Sibling-scoped uniqueness: same name is fine in a different parent.
    if (await SharePointFolder.findOne({ name, parentFolder: parentFolder ? parentFolder._id : null })) {
      return res.status(400).json({ success: false, message: 'A folder with this name already exists here' });
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
    } else if (parentFolder) {
      resolvedAllowedDepts = parentFolder.accessControl?.allowedDepartments || [department];
    } else {
      resolvedAllowedDepts = [department];
    }

    const ancestors = parentFolder ? [...(parentFolder.ancestors || []), parentFolder._id] : [];
    const depth = parentFolder ? (parentFolder.depth || 0) + 1 : 0;

    const folder = await new SharePointFolder({
      name,
      description,
      department,
      privacyLevel: resolvedPrivacy,
      isPublic:     resolvedPrivacy === 'public',
      parentFolder: parentFolder ? parentFolder._id : null,
      ancestors,
      depth,
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
      details:    { department, privacyLevel: resolvedPrivacy, parentFolderId: parentFolder ? parentFolder._id : null }
    }).save();

    res.status(201).json({ success: true, message: 'Folder created', data: folder });
  } catch (error) {
    console.error('createFolder error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A folder with this name already exists here' });
    }
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
 
    const { department, parentFolderId } = req.query;
 
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

    // ── Optional folder-tree navigation ──────────────────────────────────
    // parentFolderId='root'  -> only top-level folders (parentFolder: null)
    // parentFolderId=<id>    -> only direct children of that folder
    // omitted                -> unchanged flat-all behavior (backward compatible)
    if (parentFolderId === 'root') {
      dbQuery = { $and: [dbQuery, { parentFolder: null }] };
    } else if (parentFolderId) {
      if (!mongoose.Types.ObjectId.isValid(parentFolderId)) {
        return res.status(400).json({ success: false, message: 'Invalid parentFolderId' });
      }
      dbQuery = { $and: [dbQuery, { parentFolder: toObjectId(parentFolderId) }] };
    }
 
    const allFolders = await SharePointFolder.find(dbQuery)
      .populate('createdBy', 'fullName email')
      .sort({ department: 1, name: 1 });

    // Subfolder counts in one query rather than N+1 per-folder lookups.
    const subfolderCounts = await SharePointFolder.aggregate([
      { $match: { parentFolder: { $in: allFolders.map(f => f._id) } } },
      { $group: { _id: '$parentFolder', count: { $sum: 1 } } }
    ]);
    const subfolderCountMap = new Map(subfolderCounts.map(c => [c._id.toString(), c.count]));
 
    const result = [];
 
    for (const folder of allFolders) {
      try {
        // Fine-grained visibility check (handles confidential, blocked, etc.)
        if (!isFolderVisibleToUser(folder, user)) continue;
 
        const access = canUserAccessFolder(folder, user);
 
        result.push({
          ...folder.toObject(),
          subfolderCount: subfolderCountMap.get(folder._id.toString()) || 0,
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

    // Breadcrumb: resolve the ancestors chain to {_id, name} pairs, root first.
    const breadcrumb = folder.ancestors?.length
      ? await SharePointFolder.find({ _id: { $in: folder.ancestors } }).select('name parentFolder')
      : [];
    // ancestors is stored root-to-parent in order already, but find() doesn't
    // guarantee order, so re-sort to match the stored ancestors sequence.
    const breadcrumbOrdered = folder.ancestors.map(
      ancestorId => breadcrumb.find(b => b._id.equals(ancestorId))
    ).filter(Boolean).map(b => ({ _id: b._id, name: b.name }));

    // Direct subfolders, filtered to what this user can actually see.
    const childFolders = await SharePointFolder.find({ parentFolder: folder._id }).sort({ name: 1 });
    const visibleChildren = childFolders
      .filter(child => isFolderVisibleToUser(child, user))
      .map(child => {
        const childAccess = canUserAccessFolder(child, user);
        return {
          ...child.toObject(),
          userAccess: {
            canView:    childAccess.canAccess,
            canUpload:  canUserUploadToFolder(child, user),
            canManage:  canUserManageFolder(child, user),
            canDelete:  canUserDeleteFolder(child, user),
            permission: childAccess.permission
          }
        };
      });

    res.json({
      success: true,
      data: {
        ...folder.toObject(),
        userAccess: {
          canView:   access.canAccess,
          canUpload: canUserUploadToFolder(folder, user),
          canManage: canUserManageFolder(folder, user),
          canDelete: canUserDeleteFolder(folder, user),
          permission: access.permission
        }
      },
      breadcrumb: breadcrumbOrdered,
      subfolders: visibleChildren
    });
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

    const { description, isPublic, allowedDepartments, parentFolderId } = req.body;
    if (description)         folder.description = description;
    if (isPublic !== undefined) folder.isPublic = isPublic;
    if (allowedDepartments)  folder.accessControl.allowedDepartments = allowedDepartments;

    // ── Move to a new parent (or to root with parentFolderId: null) ─────────
    if (parentFolderId !== undefined) {
      const currentParentId = folder.parentFolder ? folder.parentFolder.toString() : null;
      const targetParentId  = parentFolderId || null;

      if (currentParentId !== targetParentId) {
        let newParent = null;

        if (targetParentId) {
          if (!mongoose.Types.ObjectId.isValid(targetParentId)) {
            return res.status(400).json({ success: false, message: 'Invalid parentFolderId' });
          }
          if (targetParentId === folder._id.toString()) {
            return res.status(400).json({ success: false, message: 'A folder cannot be its own parent' });
          }

          newParent = await SharePointFolder.findById(targetParentId);
          if (!newParent) return res.status(404).json({ success: false, message: 'Target parent folder not found' });

          if (!canUserUploadToFolder(newParent, user)) {
            return res.status(403).json({ success: false, message: 'No permission to move a folder into the target parent' });
          }

          // Cycle check: the new parent can't be this folder or any of its descendants.
          const isMovingIntoOwnSubtree =
            newParent._id.equals(folder._id) ||
            (newParent.ancestors || []).some(a => a.equals(folder._id));
          if (isMovingIntoOwnSubtree) {
            return res.status(400).json({ success: false, message: 'Cannot move a folder into its own subfolder' });
          }

          if (newParent.department !== folder.department) {
            return res.status(400).json({
              success: false,
              message: `Cannot move: target parent is in "${newParent.department}", folder is in "${folder.department}"`
            });
          }
        }

        // Sibling-scoped uniqueness at the destination.
        const nameClash = await SharePointFolder.findOne({
          _id: { $ne: folder._id },
          name: folder.name,
          parentFolder: targetParentId
        });
        if (nameClash) {
          return res.status(400).json({ success: false, message: 'A folder with this name already exists at the destination' });
        }

        const newAncestors = newParent ? [...(newParent.ancestors || []), newParent._id] : [];
        const depthDelta = newAncestors.length - (folder.ancestors || []).length;

        folder.parentFolder = newParent ? newParent._id : null;
        folder.ancestors = newAncestors;
        folder.depth = newAncestors.length;

        // Cascade the same shift to every descendant so their stored ancestors/depth
        // stay accurate - otherwise breadcrumbs and subtree queries below the moved
        // folder would silently go stale.
        const descendants = await SharePointFolder.find({ ancestors: folder._id });
        for (const descendant of descendants) {
          const oldIdx = descendant.ancestors.findIndex(a => a.equals(folder._id));
          const tail = descendant.ancestors.slice(oldIdx + 1); // path from folder down to descendant's parent
          descendant.ancestors = [...newAncestors, folder._id, ...tail];
          descendant.depth = descendant.depth + depthDelta;
          await descendant.save();
        }
      }
    }

    await folder.save();

    res.json({ success: true, message: 'Folder updated', data: folder });
  } catch (error) {
    console.error('updateFolder error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A folder with this name already exists at the destination' });
    }
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

    const subfolderCount = await SharePointFolder.countDocuments({ parentFolder: folder._id });
    if (subfolderCount > 0)
      return res.status(400).json({ success: false, message: `Delete or move ${subfolderCount} subfolder(s) first` });

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
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const user = await User.findById(req.user.userId);
    if (!canUserUploadToFolder(folder, user)) {
      return res.status(403).json({ success: false, message: 'No permission to upload to this folder' });
    }

    const fileMetadata = await saveFile(req.file, STORAGE_CATEGORIES.SHAREPOINT, folder._id.toString(), null);

    const file = await new SharePointFile({
      folderId:    folder._id,
      name:        req.file.originalname,
      description: req.body.description,
      mimetype:    req.file.mimetype,
      size:        req.file.size,
      path:        fileMetadata.url,
      publicId:    fileMetadata.publicId,
      storageType: 'cloudinary',
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
    console.error('uploadFile error:', error);
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

      const isOwner = file.uploadedBy._id?.toString() === user._id.toString();
      const hasCollaborators = (file.collaborators || []).length > 0;

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
          canDelete:   user.role === 'admin' || (isOwner && !hasCollaborators),
          canShare:    ['upload', 'manage'].includes(access.permission),
          hasCollaborators,
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
    const isFileOwner = !!user && (
      file.uploadedBy?._id?.toString() === user._id.toString() ||
      file.uploadedBy?.toString()      === user._id.toString()
    );
 
    if (user && folder) {
      const access     = canUserAccessFolder(folder, user);
      folderPermission = access.permission || 'none';
 
      // Edit-capable: file uploader, admin, folder upload/manage, or file collab 'edit'
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
    const hasCollaborators = (file.collaborators || []).length > 0;
    fileObj.userPermissions = {
      canEdit,
      canDownload:     ['download', 'upload', 'manage'].includes(folderPermission) || canEdit,
      canDelete:       user?.role === 'admin' || (isFileOwner && !hasCollaborators),
      canShare:        ['upload', 'manage'].includes(folderPermission) || canEdit,
      folderPermission,
      hasCollaborators
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

    const user = await User.findById(req.user.userId);
    const folder = await SharePointFolder.findById(file.folderId);
    const isFileOwner = file.uploadedBy.toString() === req.user.userId;
    const isSharedWithMe = (file.sharedWith || []).some(s => s.userId?.toString() === req.user.userId);
    const isCollaborator = (file.collaborators || []).some(c => c.userId.toString() === req.user.userId);

    if (!isFileOwner && !isSharedWithMe && !isCollaborator && user?.role !== 'admin') {
      const access = folder ? canUserAccessFolder(folder, user) : { canAccess: false };
      if (!access.canAccess) {
        return res.status(403).json({ success: false, message: 'No permission to access this file' });
      }
    }

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
    const file = await SharePointFile.findById(req.params.fileId)
      .populate('collaborators.userId', 'fullName email');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const isOwner = file.uploadedBy.toString() === req.user.userId;
    if (!isOwner && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'No permission to delete this file' });

    // Owners can delete their own file, but only if nobody else has been added as a
    // collaborator on it - once someone else has edit/view/download access, deleting
    // it out from under them needs an admin, not a unilateral owner action.
    if (isOwner && user.role !== 'admin' && (file.collaborators || []).length > 0) {
      const names = file.collaborators.map(c => c.userId?.fullName || c.userId?.email || 'a collaborator').join(', ');
      return res.status(409).json({
        success: false,
        message: `This file has ${file.collaborators.length} collaborator(s) (${names}). Remove them first, or ask an admin to delete it.`
      });
    }

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
    console.error('deleteFile error:', error);
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

    const requestingUser = await User.findById(req.user.userId);
    if (!(await canUserAccessFile(file, requestingUser))) {
      return res.status(403).json({ success: false, message: 'No permission to access this file' });
    }

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
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    const user = await User.findById(req.user.userId);

    // Only the person who checked it out (or admin) can check in
    if (file.checkout?.userId?.toString() !== req.user.userId && user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You did not check out this file' });
    }

    // If a new file was uploaded with the check-in, create a version
    if (req.file) {
      const fileMetadata = await saveFile(req.file, STORAGE_CATEGORIES.SHAREPOINT, file.folderId.toString(), null);

      // Archive current
      file.versions.push({
        versionNumber: file.versions.length + 1,
        path:          file.path,
        publicId:      file.publicId,
        storageType:   file.storageType,
        size:          file.size,
        mimetype:      file.mimetype,
        uploadedBy:    file.uploadedBy,
        uploadedAt:    file.uploadedAt,
        changeNote:    req.body.changeNote || ''
      });
      // Promote new
      file.path        = fileMetadata.url;
      file.publicId    = fileMetadata.publicId;
      file.storageType = 'cloudinary';
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
    console.error('checkinFile error:', error);
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
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    const user = await User.findById(req.user.userId);
    const isCollaboratorWithEdit = file.collaborators.some(c => c.userId.toString() === req.user.userId && c.permission === 'edit');

    if (file.uploadedBy.toString() !== req.user.userId && !isCollaboratorWithEdit && user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'No permission to upload versions. You need Edit collaborator access.' });
    }

    // Check that file is not locked by someone else
    const coExpired = file.checkout?.expiresAt && new Date() > file.checkout.expiresAt;
    const isLockedByOther = !coExpired && file.checkout?.userId && file.checkout.userId.toString() !== req.user.userId;
    if (isLockedByOther) {
      return res.status(409).json({ success: false, message: 'File is checked out by another user. Ask them to check in first.' });
    }

    const fileMetadata = await saveFile(req.file, STORAGE_CATEGORIES.SHAREPOINT, file.folderId.toString(), null);

    file.versions.push({
      versionNumber: file.versions.length + 1,
      path:          file.path,
      publicId:      file.publicId,
      storageType:   file.storageType,
      size:          file.size,
      mimetype:      file.mimetype,
      uploadedBy:    file.uploadedBy,
      uploadedAt:    file.uploadedAt,
      changeNote:    req.body.changeNote || ''
    });

    file.path        = fileMetadata.url;
    file.publicId     = fileMetadata.publicId;
    file.storageType  = 'cloudinary';
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
    console.error('createFileVersion error:', error);
    res.status(500).json({ success: false, message: 'Failed to create version', error: error.message });
  }
};

const getFileVersions = async (req, res) => {
  try {
    const file = await SharePointFile.findById(req.params.fileId)
      .populate('versions.uploadedBy', 'fullName email');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const user = await User.findById(req.user.userId);
    if (!(await canUserAccessFile(file, user))) {
      return res.status(403).json({ success: false, message: 'No permission to access this file' });
    }

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
      storageType:   file.storageType,
      size:          file.size,
      mimetype:      file.mimetype,
      uploadedBy:    file.uploadedBy,
      uploadedAt:    file.uploadedAt,
      changeNote:    'Auto-archived before restore'
    });

    file.path        = version.path;
    file.publicId    = version.publicId;
    file.storageType = version.storageType || (version.path?.startsWith('http') ? 'cloudinary' : 'local');
    file.size        = version.size;
    file.mimetype    = version.mimetype;
    file.uploadedAt  = new Date();

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

    const user = await User.findById(req.user.userId);
    if (!(await canUserAccessFile(file, user))) {
      return res.status(403).json({ success: false, message: 'No permission to access this file' });
    }

    file.comments.push({ userId: req.user.userId, text: text.trim(), versionIndex: versionIndex ?? null });
    await file.save();

    await logFileAudit(file._id, 'comment', req.user.userId, { preview: text.slice(0, 80) });
    await new SharePointActivityLog({ action: 'comment_add', userId: req.user.userId, fileId: file._id, fileName: file.name }).save();

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
      .select('auditTrail name uploadedBy folderId sharedWith collaborators');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const user = await User.findById(req.user.userId);
    if (!(await canUserAccessFile(file, user))) {
      return res.status(403).json({ success: false, message: 'No permission to access this file' });
    }

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
    const user = await User.findById(req.user.userId);
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file || file.isDeleted) return res.status(404).json({ success: false, message: 'File not found' });

    const isOwner = file.uploadedBy.toString() === req.user.userId;
    const isEditCollaborator = file.collaborators.some(c => c.userId.toString() === req.user.userId && c.permission === 'edit');
    if (!isOwner && !isEditCollaborator && user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the file owner, an edit collaborator, or an admin can share this file' });
    }

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
    const user = await User.findById(req.user.userId);
    const file = await SharePointFile.findById(req.params.fileId);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const isOwner = file.uploadedBy.toString() === req.user.userId;
    const isEditCollaborator = file.collaborators.some(c => c.userId.toString() === req.user.userId && c.permission === 'edit');
    if (!isOwner && !isEditCollaborator && user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the file owner, an edit collaborator, or an admin can revoke access' });
    }

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
        { 'accessControl.invitedUsers.userId': toObjectId(req.user.userId) },
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
        { 'accessControl.invitedUsers.userId': toObjectId(req.user.userId) },
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
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    const user = await User.findById(req.user.userId);
    if (!canUserUploadToFolder(folder, user)) {
      return res.status(403).json({ success: false, message: 'No permission to upload to this folder' });
    }

    const saved = [];
    let totalSize = 0;
    for (const f of req.files) {
      try {
        const fileMetadata = await saveFile(f, STORAGE_CATEGORIES.SHAREPOINT, folder._id.toString(), null);
        const nf = await new SharePointFile({
          folderId: folder._id, name: f.originalname, description: req.body.description,
          mimetype: f.mimetype, size: f.size, path: fileMetadata.url,
          publicId: fileMetadata.publicId, storageType: 'cloudinary',
          uploadedBy: req.user.userId,
          tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : []
        }).save();
        saved.push(nf);
        totalSize += f.size;
        await new SharePointActivityLog({ action: 'upload', userId: req.user.userId, fileId: nf._id, folderId: folder._id, fileName: nf.name, folderName: folder.name }).save();
      } catch (fileError) {
        console.error(`Error uploading ${f.originalname}:`, fileError);
        // Continue with remaining files rather than failing the whole batch
      }
    }

    if (saved.length === 0) {
      return res.status(500).json({ success: false, message: 'All file uploads failed' });
    }

    folder.fileCount  += saved.length;
    folder.totalSize  += totalSize;
    folder.lastModified = new Date();
    await folder.save();

    res.status(201).json({ success: true, message: `${saved.length} of ${req.files.length} files uploaded`, data: saved });
  } catch (error) {
    console.error('bulkUploadFiles error:', error);
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

