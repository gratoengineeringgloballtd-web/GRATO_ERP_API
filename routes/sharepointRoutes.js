const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const sharepointController = require('../controllers/sharepointController');
const accessController = require('../controllers/sharepointAccessController');
const { handleMulterError, validateFiles, cleanupTempFiles } = require('../middlewares/uploadMiddleware');

// ── FOLDERS ────────────────────────────────────────────────────────────────────
router.post('/folders',            authMiddleware, sharepointController.createFolder);
router.get('/folders',             authMiddleware, sharepointController.getFolders);
router.get('/folders/:folderId',   authMiddleware, sharepointController.getFolder);
router.put('/folders/:folderId',   authMiddleware, sharepointController.updateFolder);
router.delete('/folders/:folderId', authMiddleware, requireRoles('admin'), sharepointController.deleteFolder);

// ── FOLDER ACCESS MANAGEMENT ────────────────────────────────────────────────────
router.post('/folders/:folderId/invite',              authMiddleware, accessController.inviteUsersToFolder);
router.delete('/folders/:folderId/revoke/:userId',    authMiddleware, accessController.revokeUserAccess);
router.post('/folders/:folderId/block',               authMiddleware, accessController.blockUserFromFolder);
router.delete('/folders/:folderId/unblock/:userId',   authMiddleware, accessController.unblockUserFromFolder);
router.get('/folders/:folderId/access',               authMiddleware, accessController.getFolderAccess);
router.patch('/folders/:folderId/permission/:userId', authMiddleware, accessController.updateUserPermission);

// ── FILES ──────────────────────────────────────────────────────────────────────
router.post('/folders/:folderId/files',
  authMiddleware, upload.single('file'), handleMulterError, validateFiles,
  sharepointController.uploadFile, cleanupTempFiles);

router.get('/folders/:folderId/files', authMiddleware, sharepointController.getFiles);
router.get('/files/:fileId',           authMiddleware, sharepointController.getFileDetails);
router.get('/files/:fileId/download',  authMiddleware, sharepointController.downloadFile);
router.delete('/files/:fileId',        authMiddleware, sharepointController.deleteFile);

// ── CHECK-OUT / CHECK-IN ───────────────────────────────────────────────────────
// Checkout (lock file for editing)
router.post('/files/:fileId/checkout',  authMiddleware, sharepointController.checkoutFile);
// Check-in with optional new version (multipart)
router.post('/files/:fileId/checkin',
  authMiddleware, upload.single('file'), handleMulterError,
  sharepointController.checkinFile, cleanupTempFiles);
// Force-release a lock (admin or checkout owner)
router.delete('/files/:fileId/checkout', authMiddleware, sharepointController.forceCheckin);

// ── VERSIONS ───────────────────────────────────────────────────────────────────
router.post('/files/:fileId/version',
  authMiddleware, upload.single('file'), handleMulterError, validateFiles,
  sharepointController.createFileVersion, cleanupTempFiles);
router.get('/files/:fileId/versions',                     authMiddleware, sharepointController.getFileVersions);
router.post('/files/:fileId/restore/:versionIndex',       authMiddleware, sharepointController.restoreFileVersion);

// ── COMMENTS ──────────────────────────────────────────────────────────────────
router.post('/files/:fileId/comments',                    authMiddleware, sharepointController.addComment);
router.delete('/files/:fileId/comments/:commentId',       authMiddleware, sharepointController.deleteComment);

// ── COLLABORATORS ──────────────────────────────────────────────────────────────
router.post('/files/:fileId/collaborators',               authMiddleware, sharepointController.addCollaborator);
router.delete('/files/:fileId/collaborators/:userId',     authMiddleware, sharepointController.removeCollaborator);
router.get('/files/:fileId/audit',                        authMiddleware, sharepointController.getFileAuditTrail);

// ── SHARING ────────────────────────────────────────────────────────────────────
router.post('/files/:fileId/share',                       authMiddleware, sharepointController.shareFile);
router.delete('/files/:fileId/access/:userId',            authMiddleware, sharepointController.revokeAccess);
router.post('/files/:fileId/share-link',                  authMiddleware, sharepointController.generateShareLink);

// ── USER-SPECIFIC ──────────────────────────────────────────────────────────────
router.get('/my-files',   authMiddleware, sharepointController.getUserFiles);
router.get('/user-stats', authMiddleware, sharepointController.getUserStats);
router.get('/users/search', authMiddleware, accessController.searchUsers);

// ── SEARCH ────────────────────────────────────────────────────────────────────
router.get('/search', authMiddleware, sharepointController.globalSearch);
router.get('/recent', authMiddleware, sharepointController.getRecentFiles);

// ── BULK UPLOAD ────────────────────────────────────────────────────────────────
router.post('/folders/:folderId/bulk-upload',
  authMiddleware, upload.array('files', 10), handleMulterError, validateFiles,
  sharepointController.bulkUploadFiles, cleanupTempFiles);

// ── ANALYTICS (admin) ──────────────────────────────────────────────────────────
router.get('/stats/storage',           authMiddleware, requireRoles('admin'), sharepointController.getStorageStats);
router.get('/stats/activity',          authMiddleware, requireRoles('admin'), sharepointController.getActivityLog);
router.get('/stats/department/:department', authMiddleware, sharepointController.getDepartmentStats);
router.get('/dashboard-stats',         authMiddleware, sharepointController.getSharePointDashboardStats);

module.exports = router;









// const express = require('express');
// const router = express.Router();
// const auth = require('../middleware/auth');
// const SharePoint = require('../models/SharePoint');

// // Get all folders
// router.get('/folders', auth, async (req, res) => {
//   try {
//     const folders = await SharePoint.find();
//     res.json({ success: true, data: folders });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// });

// // Create folder
// router.post('/folders', auth, async (req, res) => {
//   try {
//     const { name, description, department, isPublic } = req.body;
//     const folder = new SharePoint({
//       name,
//       description,
//       department,
//       isPublic,
//       createdBy: req.user.id,
//       files: []
//     });
//     await folder.save();
//     res.json({ success: true, data: folder });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// });

// // Upload file to folder
// router.post('/folders/:folderId/files', auth, async (req, res) => {
//   try {
//     const { folderId } = req.params;
//     const folder = await SharePoint.findById(folderId);
    
//     if (!folder) {
//       return res.status(404).json({ success: false, message: 'Folder not found' });
//     }

//     const file = {
//       id: Date.now(),
//       name: req.file.originalname,
//       size: req.file.size,
//       type: req.file.mimetype,
//       url: req.file.path,
//       uploadedBy: req.user.fullName,
//       uploadedAt: new Date(),
//       downloads: 0
//     };

//     folder.files.push(file);
//     await folder.save();
//     res.json({ success: true, data: file });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// });

// // Delete file
// router.delete('/files/:fileId', auth, async (req, res) => {
//   try {
//     const { fileId } = req.params;
//     const result = await SharePoint.updateOne(
//       { 'files.id': fileId },
//       { $pull: { files: { id: fileId } } }
//     );
//     res.json({ success: true, message: 'File deleted successfully' });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// });

// module.exports = router;