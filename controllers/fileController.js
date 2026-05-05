/**
 * fileController.js
 *
 * Updated for Cloudinary storage.
 * Files are now served directly via Cloudinary secure_url — no local disk I/O.
 * The download and view endpoints redirect to the Cloudinary URL.
 *
 * Backward compat: if a stored URL is still a local path (old files not yet
 * migrated), the resolver falls back to the old disk-search logic so nothing
 * breaks during the transition period.
 */

const path        = require('path');
const fs          = require('fs');
const https       = require('https');
const CashRequest = require('../models/CashRequest');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.bmp':  'image/bmp',
  '.webp': 'image/webp',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt':  'text/plain',
  '.rtf':  'application/rtf'
};

const INLINE_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp']);

const getMimeType = (ext) => MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';

/**
 * Returns true if the string looks like a Cloudinary URL
 */
const isCloudinaryUrl = (str = '') =>
  str.startsWith('https://res.cloudinary.com') ||
  str.startsWith('http://res.cloudinary.com');

/**
 * resolveAttachmentPath — legacy fallback for files still on local disk.
 * Only used during transition period (before migration script runs).
 */
const ATTACHMENT_SEARCH_DIRS = [
  process.env.UPLOADS_PATH,
  process.env.UPLOADS_PATH && path.join(process.env.UPLOADS_PATH, 'attachments'),
  process.env.UPLOADS_PATH && path.join(process.env.UPLOADS_PATH, 'justifications'),
  process.env.UPLOADS_PATH && path.join(process.env.UPLOADS_PATH, 'reimbursements'),
  '/var/data/uploads/attachments',
  '/var/data/uploads/justifications',
  '/var/data/uploads/reimbursements',
  '/var/data/uploads/temp',
  path.join(__dirname, '../uploads/attachments'),
  path.join(__dirname, '../uploads/justifications'),
  path.join(__dirname, '../uploads/reimbursements'),
  path.join(__dirname, '../uploads/temp'),
].filter(Boolean);

const resolveAttachmentPath = (storedPathOrId) => {
  if (!storedPathOrId) return null;
  if (isCloudinaryUrl(storedPathOrId)) return null; // handled by redirect

  if (path.isAbsolute(storedPathOrId) && fs.existsSync(storedPathOrId))
    return { filePath: storedPathOrId };

  const normalised = storedPathOrId.replace(/\\/g, '/');
  const filename   = path.basename(normalised);

  for (const dir of ATTACHMENT_SEARCH_DIRS) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      console.log(`✅ Legacy file found: ${candidate}`);
      return { filePath: candidate };
    }
  }

  const relative   = normalised.replace(/^\/+/, '');
  const candidates = [
    path.resolve(__dirname, '..', relative),
    path.resolve(process.cwd(), relative),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`✅ Legacy file found (relative): ${candidate}`);
      return { filePath: candidate };
    }
  }

  console.warn(`⚠️  File not found on disk: "${storedPathOrId}"`);
  return null;
};

// ─── Shared: resolve a stored url/path to either a Cloudinary URL or local path
const resolveFile = (storedUrl) => {
  if (!storedUrl) return null;

  // New files: Cloudinary URL
  if (isCloudinaryUrl(storedUrl)) {
    return { type: 'cloudinary', url: storedUrl };
  }

  // Old files: local disk path
  const local = resolveAttachmentPath(storedUrl);
  if (local) return { type: 'local', filePath: local.filePath };

  return null;
};

// ─── Stream a Cloudinary URL back to the client ───────────────────────────────
const proxyCloudinaryFile = (cloudinaryUrl, disposition, res) => {
  https.get(cloudinaryUrl, (cloudRes) => {
    const contentType = cloudRes.headers['content-type'] || 'application/octet-stream';
    const contentLength = cloudRes.headers['content-length'];

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', disposition);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    cloudRes.pipe(res);

    cloudRes.on('error', (err) => {
      console.error('❌ Cloudinary proxy stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Error streaming file' });
    });
  }).on('error', (err) => {
    console.error('❌ Cloudinary HTTPS request error:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error fetching file from storage' });
  });
};


// =============================================================================
// downloadFile
// =============================================================================
const downloadFile = async (req, res) => {
  try {
    const publicId        = decodeURIComponent(req.params.publicId);
    const originalName    = publicId.split('-').slice(2).join('-') || path.basename(publicId);

    console.log('\n=== FILE DOWNLOAD REQUEST ===');
    console.log('Public ID:', publicId);

    const resolved = resolveFile(publicId);

    if (!resolved) {
      return res.status(404).json({
        success: false,
        message: 'File not found.',
        publicId
      });
    }

    const disposition = `attachment; filename="${originalName}"`;

    if (resolved.type === 'cloudinary') {
      console.log('☁️  Serving from Cloudinary:', resolved.url);
      return proxyCloudinaryFile(resolved.url, disposition, res);
    }

    // Legacy local file
    const { filePath } = resolved;
    const stats        = fs.statSync(filePath);
    const ext          = path.extname(filePath).toLowerCase();

    res.setHeader('Content-Type', getMimeType(ext));
    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    fs.createReadStream(filePath).pipe(res);
    console.log('📁 Serving legacy local file:', filePath);

  } catch (error) {
    console.error('❌ Download error:', error);
    if (!res.headersSent)
      res.status(500).json({ success: false, message: 'Failed to download file', error: error.message });
  }
};


// =============================================================================
// viewFile
// =============================================================================
const viewFile = async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);

    console.log('\n=== FILE VIEW REQUEST ===');
    console.log('Public ID:', publicId);

    const resolved = resolveFile(publicId);

    if (!resolved) {
      return res.status(404).json({ success: false, message: 'File not found', publicId });
    }

    if (resolved.type === 'cloudinary') {
      console.log('☁️  Redirecting to Cloudinary URL');
      // Redirect browser directly to Cloudinary — avoids proxying large files
      return res.redirect(302, resolved.url);
    }

    // Legacy local file
    const { filePath } = resolved;
    const ext          = path.extname(filePath).toLowerCase();

    if (!INLINE_EXTS.has(ext)) {
      return res.status(400).json({
        success: false,
        message: 'This file type cannot be viewed inline. Please download it instead.'
      });
    }

    const stats = fs.statSync(filePath);
    res.setHeader('Content-Type', getMimeType(ext));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    fs.createReadStream(filePath).pipe(res);
    console.log('📁 Serving legacy local file inline');

  } catch (error) {
    console.error('❌ View error:', error);
    if (!res.headersSent)
      res.status(500).json({ success: false, message: 'Failed to view file', error: error.message });
  }
};


// =============================================================================
// getFileInfo
// =============================================================================
const getFileInfo = async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    const resolved = resolveFile(publicId);

    if (!resolved) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    if (resolved.type === 'cloudinary') {
      const ext = path.extname(publicId).toLowerCase();
      return res.json({
        success: true,
        data: {
          publicId,
          url:          resolved.url,
          storageType:  'cloudinary',
          extension:    ext,
          mimeType:     getMimeType(ext),
          canViewInline: INLINE_EXTS.has(ext),
        }
      });
    }

    // Legacy
    const { filePath } = resolved;
    const stats        = fs.statSync(filePath);
    const ext          = path.extname(filePath).toLowerCase();

    res.json({
      success: true,
      data: {
        publicId,
        name:         path.basename(filePath),
        size:         stats.size,
        storageType:  'local',
        extension:    ext,
        mimeType:     getMimeType(ext),
        canViewInline: INLINE_EXTS.has(ext),
        createdAt:    stats.birthtime,
        modifiedAt:   stats.mtime,
      }
    });

  } catch (error) {
    console.error('Get file info error:', error);
    res.status(500).json({ success: false, message: 'Failed to get file info', error: error.message });
  }
};


module.exports = { downloadFile, viewFile, getFileInfo, resolveAttachmentPath, resolveFile };










// const path = require('path');
// const fs = require('fs');
// const CashRequest = require('../models/CashRequest');

// // ─── Attachment search directories (priority order) ───────────────────────────
// // Mirrors the same pattern used in signatureResolver.js
// const ATTACHMENT_SEARCH_DIRS = [
//   process.env.UPLOADS_PATH,                                     // Render persistent disk root
//   process.env.UPLOADS_PATH && path.join(process.env.UPLOADS_PATH, 'attachments'),
//   process.env.UPLOADS_PATH && path.join(process.env.UPLOADS_PATH, 'justifications'),
//   process.env.UPLOADS_PATH && path.join(process.env.UPLOADS_PATH, 'reimbursements'),
//   process.env.UPLOADS_PATH && path.join(process.env.UPLOADS_PATH, 'temp'),
//   '/var/data/uploads/attachments',                              // Render disk fallback
//   '/var/data/uploads/justifications',
//   '/var/data/uploads/reimbursements',
//   '/var/data/uploads/temp',
//   path.join(__dirname, '../uploads/attachments'),               // local dev
//   path.join(__dirname, '../uploads/justifications'),
//   path.join(__dirname, '../uploads/reimbursements'),
//   path.join(__dirname, '../uploads/temp'),
// ].filter(Boolean);

// /**
//  * Resolves a stored file path/publicId to an absolute local path.
//  *
//  * Handles:
//  *   1. Absolute path that still exists (local dev happy path)
//  *   2. Filename / publicId searched across all known upload dirs
//  *   3. Relative path resolved from project root
//  *
//  * @param {string} storedPathOrId  - localPath or publicId from the database
//  * @returns {{ filePath: string, fileType: string } | null}
//  */
// const resolveAttachmentPath = (storedPathOrId) => {
//   if (!storedPathOrId) return null;

//   // Strategy 1: stored absolute path still works (local dev)
//   if (path.isAbsolute(storedPathOrId) && fs.existsSync(storedPathOrId)) {
//     const fileType = detectFileType(storedPathOrId);
//     return { filePath: storedPathOrId, fileType };
//   }

//   // Strategy 2: extract filename and search known dirs
//   const normalised = storedPathOrId.replace(/\\/g, '/');
//   const filename   = path.basename(normalised);

//   for (const dir of ATTACHMENT_SEARCH_DIRS) {
//     const candidate = path.join(dir, filename);
//     if (fs.existsSync(candidate)) {
//       console.log(`✅ Attachment resolved: ${candidate}`);
//       return { filePath: candidate, fileType: detectFileType(candidate) };
//     }
//   }

//   // Strategy 3: strip leading slash, resolve relative to project root
//   const relative   = normalised.replace(/^\/+/, '');
//   const candidates = [
//     path.resolve(__dirname, '..', relative),
//     path.resolve(process.cwd(), relative),
//   ];

//   for (const candidate of candidates) {
//     if (fs.existsSync(candidate)) {
//       console.log(`✅ Attachment resolved (relative): ${candidate}`);
//       return { filePath: candidate, fileType: detectFileType(candidate) };
//     }
//   }

//   console.warn(`⚠️  Attachment not found. Stored path: "${storedPathOrId}"`);
//   console.warn(`   Searched dirs: ${ATTACHMENT_SEARCH_DIRS.join(', ')}`);
//   return null;
// };

// const detectFileType = (filePath) => {
//   if (filePath.includes('justification')) return 'justification';
//   if (filePath.includes('reimbursement'))  return 'reimbursement';
//   if (filePath.includes('attachment'))     return 'attachment';
//   return 'unknown';
// };

// // ─── MIME types ───────────────────────────────────────────────────────────────
// const MIME_TYPES = {
//   '.pdf':  'application/pdf',
//   '.jpg':  'image/jpeg',
//   '.jpeg': 'image/jpeg',
//   '.png':  'image/png',
//   '.gif':  'image/gif',
//   '.bmp':  'image/bmp',
//   '.webp': 'image/webp',
//   '.doc':  'application/msword',
//   '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//   '.xls':  'application/vnd.ms-excel',
//   '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//   '.txt':  'text/plain',
//   '.rtf':  'application/rtf'
// };

// const getMimeType = (ext) => MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';

// // ─── INLINE-SAFE types ────────────────────────────────────────────────────────
// const INLINE_MIME_TYPES = {
//   '.pdf':  'application/pdf',
//   '.jpg':  'image/jpeg',
//   '.jpeg': 'image/jpeg',
//   '.png':  'image/png',
//   '.gif':  'image/gif',
//   '.webp': 'image/webp'
// };


// // =============================================================================
// // downloadFile
// // =============================================================================
// const downloadFile = async (req, res) => {
//   try {
//     const { publicId } = req.params;

//     console.log('\n=== FILE DOWNLOAD REQUEST ===');
//     console.log('Public ID:', publicId);
//     console.log('User:', req.user.userId);

//     if (!publicId) {
//       return res.status(400).json({ success: false, message: 'File identifier is required' });
//     }

//     const decodedPublicId = decodeURIComponent(publicId);
//     console.log('Decoded Public ID:', decodedPublicId);

//     // ✅ Use resolver instead of hardcoded paths
//     const resolved = resolveAttachmentPath(decodedPublicId);

//     if (!resolved) {
//       console.error('❌ File not found in any directory');
//       console.error('Searched dirs:', ATTACHMENT_SEARCH_DIRS);
//       return res.status(404).json({
//         success: false,
//         message: 'File not found. It may have been moved or deleted.',
//         publicId: decodedPublicId
//       });
//     }

//     const { filePath, fileType } = resolved;
//     console.log(`✓ File found (${fileType}): ${filePath}`);

//     // Verify readability
//     try {
//       fs.accessSync(filePath, fs.constants.R_OK);
//     } catch (accessError) {
//       console.error('❌ File not readable:', accessError.message);
//       return res.status(403).json({ success: false, message: 'File exists but cannot be accessed' });
//     }

//     const stats      = fs.statSync(filePath);
//     const ext        = path.extname(filePath).toLowerCase();
//     const mimeType   = getMimeType(ext);
//     const originalName = decodedPublicId.split('-').slice(2).join('-') || path.basename(filePath);

//     console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);
//     console.log('MIME type:', mimeType);
//     console.log('Original filename:', originalName);

//     res.setHeader('Content-Type', mimeType);
//     res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
//     res.setHeader('Content-Length', stats.size);
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Pragma', 'no-cache');
//     res.setHeader('Expires', '0');

//     const fileStream = fs.createReadStream(filePath);

//     fileStream.on('error', (error) => {
//       console.error('❌ File stream error:', error);
//       if (!res.headersSent) {
//         res.status(500).json({ success: false, message: 'Error reading file' });
//       }
//     });

//     fileStream.on('end', () => console.log('✅ File download completed'));
//     fileStream.pipe(res);

//   } catch (error) {
//     console.error('❌ Download file error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({ success: false, message: 'Failed to download file', error: error.message });
//     }
//   }
// };


// // =============================================================================
// // viewFile
// // =============================================================================
// const viewFile = async (req, res) => {
//   try {
//     const { publicId } = req.params;

//     console.log('\n=== FILE VIEW REQUEST ===');
//     console.log('Public ID:', publicId);

//     const decodedPublicId = decodeURIComponent(publicId);

//     // ✅ Use resolver instead of hardcoded paths
//     const resolved = resolveAttachmentPath(decodedPublicId);

//     if (!resolved) {
//       return res.status(404).json({ success: false, message: 'File not found' });
//     }

//     const { filePath } = resolved;
//     const ext          = path.extname(filePath).toLowerCase();
//     const mimeType     = INLINE_MIME_TYPES[ext];

//     if (!mimeType) {
//       return res.status(400).json({
//         success: false,
//         message: 'This file type cannot be viewed inline. Please download it instead.'
//       });
//     }

//     const stats = fs.statSync(filePath);

//     res.setHeader('Content-Type', mimeType);
//     res.setHeader('Content-Disposition', 'inline');
//     res.setHeader('Content-Length', stats.size);
//     res.setHeader('Cache-Control', 'private, max-age=3600');

//     const fileStream = fs.createReadStream(filePath);
//     fileStream.pipe(res);

//     console.log('✅ File view initiated');

//   } catch (error) {
//     console.error('❌ View file error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({ success: false, message: 'Failed to view file', error: error.message });
//     }
//   }
// };


// // =============================================================================
// // getFileInfo
// // =============================================================================
// const getFileInfo = async (req, res) => {
//   try {
//     const { publicId } = req.params;
//     const decodedPublicId = decodeURIComponent(publicId);

//     // ✅ Use resolver instead of hardcoded paths
//     const resolved = resolveAttachmentPath(decodedPublicId);

//     if (!resolved) {
//       return res.status(404).json({ success: false, message: 'File not found' });
//     }

//     const { filePath, fileType } = resolved;
//     const stats = fs.statSync(filePath);
//     const ext   = path.extname(filePath).toLowerCase();

//     res.json({
//       success: true,
//       data: {
//         publicId:      decodedPublicId,
//         name:          path.basename(filePath),
//         size:          stats.size,
//         type:          fileType,
//         extension:     ext,
//         mimeType:      getMimeType(ext),
//         canViewInline: Object.keys(INLINE_MIME_TYPES).includes(ext),
//         createdAt:     stats.birthtime,
//         modifiedAt:    stats.mtime
//       }
//     });

//   } catch (error) {
//     console.error('Get file info error:', error);
//     res.status(500).json({ success: false, message: 'Failed to get file info', error: error.message });
//   }
// };


// module.exports = { downloadFile, viewFile, getFileInfo, resolveAttachmentPath };











// const path = require('path');
// const fs = require('fs');
// const CashRequest = require('../models/CashRequest');

// /**
//  * Download a file by its publicId
//  * Supports attachments, justifications, and reimbursement documents
//  */
// const downloadFile = async (req, res) => {
//   try {
//     const { publicId } = req.params;
    
//     console.log('\n=== FILE DOWNLOAD REQUEST ===');
//     console.log('Public ID:', publicId);
//     console.log('User:', req.user.userId);
    
//     if (!publicId) {
//       return res.status(400).json({
//         success: false,
//         message: 'File identifier is required'
//       });
//     }

//     // Decode the publicId (it might be URL encoded)
//     const decodedPublicId = decodeURIComponent(publicId);
//     console.log('Decoded Public ID:', decodedPublicId);

//     // Possible file locations
//     const possiblePaths = [
//       path.join(__dirname, '../uploads/attachments', decodedPublicId),
//       path.join(__dirname, '../uploads/justifications', decodedPublicId),
//       path.join(__dirname, '../uploads/reimbursements', decodedPublicId),
//       path.join(__dirname, '../uploads/temp', decodedPublicId)
//     ];

//     let filePath = null;
//     let fileType = 'unknown';

//     // Find the file
//     for (let i = 0; i < possiblePaths.length; i++) {
//       if (fs.existsSync(possiblePaths[i])) {
//         filePath = possiblePaths[i];
//         fileType = possiblePaths[i].includes('attachments') ? 'attachment' :
//                    possiblePaths[i].includes('justifications') ? 'justification' :
//                    possiblePaths[i].includes('reimbursements') ? 'reimbursement' : 'temp';
//         console.log(`✓ File found in ${fileType} directory`);
//         break;
//       }
//     }

//     if (!filePath) {
//       console.error('❌ File not found in any directory');
//       console.error('Searched paths:', possiblePaths);
//       return res.status(404).json({
//         success: false,
//         message: 'File not found. It may have been moved or deleted.',
//         publicId: decodedPublicId
//       });
//     }

//     // Verify file accessibility
//     try {
//       fs.accessSync(filePath, fs.constants.R_OK);
//     } catch (accessError) {
//       console.error('❌ File exists but is not readable:', accessError.message);
//       return res.status(403).json({
//         success: false,
//         message: 'File exists but cannot be accessed'
//       });
//     }

//     // Get file stats
//     const stats = fs.statSync(filePath);
//     console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);

//     // Determine MIME type
//     const ext = path.extname(filePath).toLowerCase();
//     const mimeTypes = {
//       '.pdf': 'application/pdf',
//       '.jpg': 'image/jpeg',
//       '.jpeg': 'image/jpeg',
//       '.png': 'image/png',
//       '.gif': 'image/gif',
//       '.bmp': 'image/bmp',
//       '.webp': 'image/webp',
//       '.doc': 'application/msword',
//       '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//       '.xls': 'application/vnd.ms-excel',
//       '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//       '.txt': 'text/plain',
//       '.rtf': 'application/rtf'
//     };

//     const mimeType = mimeTypes[ext] || 'application/octet-stream';
//     const originalName = decodedPublicId.split('-').slice(2).join('-') || path.basename(filePath);

//     console.log('MIME type:', mimeType);
//     console.log('Original filename:', originalName);

//     // Set headers for download
//     res.setHeader('Content-Type', mimeType);
//     res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
//     res.setHeader('Content-Length', stats.size);
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Pragma', 'no-cache');
//     res.setHeader('Expires', '0');

//     // Stream the file
//     const fileStream = fs.createReadStream(filePath);
    
//     fileStream.on('error', (error) => {
//       console.error('❌ File stream error:', error);
//       if (!res.headersSent) {
//         res.status(500).json({
//           success: false,
//           message: 'Error reading file'
//         });
//       }
//     });

//     fileStream.on('end', () => {
//       console.log('✅ File download completed successfully');
//     });

//     fileStream.pipe(res);

//   } catch (error) {
//     console.error('❌ Download file error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to download file',
//         error: error.message
//       });
//     }
//   }
// };

// /**
//  * View a file inline (for PDFs and images)
//  */
// const viewFile = async (req, res) => {
//   try {
//     const { publicId } = req.params;
    
//     console.log('\n=== FILE VIEW REQUEST ===');
//     console.log('Public ID:', publicId);
    
//     const decodedPublicId = decodeURIComponent(publicId);

//     // Possible file locations
//     const possiblePaths = [
//       path.join(__dirname, '../uploads/attachments', decodedPublicId),
//       path.join(__dirname, '../uploads/justifications', decodedPublicId),
//       path.join(__dirname, '../uploads/reimbursements', decodedPublicId)
//     ];

//     let filePath = null;
//     for (const checkPath of possiblePaths) {
//       if (fs.existsSync(checkPath)) {
//         filePath = checkPath;
//         break;
//       }
//     }

//     if (!filePath) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     const ext = path.extname(filePath).toLowerCase();
    
//     // Only allow inline viewing for safe file types
//     const inlineTypes = {
//       '.pdf': 'application/pdf',
//       '.jpg': 'image/jpeg',
//       '.jpeg': 'image/jpeg',
//       '.png': 'image/png',
//       '.gif': 'image/gif',
//       '.webp': 'image/webp'
//     };

//     const mimeType = inlineTypes[ext];
//     if (!mimeType) {
//       return res.status(400).json({
//         success: false,
//         message: 'This file type cannot be viewed inline. Please download it instead.'
//       });
//     }

//     const stats = fs.statSync(filePath);
    
//     res.setHeader('Content-Type', mimeType);
//     res.setHeader('Content-Disposition', 'inline');
//     res.setHeader('Content-Length', stats.size);
//     res.setHeader('Cache-Control', 'private, max-age=3600');

//     const fileStream = fs.createReadStream(filePath);
//     fileStream.pipe(res);

//     console.log('✅ File view initiated');

//   } catch (error) {
//     console.error('❌ View file error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to view file',
//         error: error.message
//       });
//     }
//   }
// };

// /**
//  * Get file info without downloading
//  */
// const getFileInfo = async (req, res) => {
//   try {
//     const { publicId } = req.params;
//     const decodedPublicId = decodeURIComponent(publicId);

//     const possiblePaths = [
//       path.join(__dirname, '../uploads/attachments', decodedPublicId),
//       path.join(__dirname, '../uploads/justifications', decodedPublicId),
//       path.join(__dirname, '../uploads/reimbursements', decodedPublicId)
//     ];

//     let filePath = null;
//     let fileType = 'unknown';

//     for (const checkPath of possiblePaths) {
//       if (fs.existsSync(checkPath)) {
//         filePath = checkPath;
//         fileType = checkPath.includes('attachments') ? 'attachment' :
//                    checkPath.includes('justifications') ? 'justification' :
//                    checkPath.includes('reimbursements') ? 'reimbursement' : 'unknown';
//         break;
//       }
//     }

//     if (!filePath) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found'
//       });
//     }

//     const stats = fs.statSync(filePath);
//     const ext = path.extname(filePath).toLowerCase();

//     res.json({
//       success: true,
//       data: {
//         publicId: decodedPublicId,
//         name: path.basename(filePath),
//         size: stats.size,
//         type: fileType,
//         extension: ext,
//         mimeType: getMimeType(ext),
//         canViewInline: ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext),
//         createdAt: stats.birthtime,
//         modifiedAt: stats.mtime
//       }
//     });

//   } catch (error) {
//     console.error('Get file info error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get file info',
//       error: error.message
//     });
//   }
// };

// function getMimeType(ext) {
//   const mimeTypes = {
//     '.pdf': 'application/pdf',
//     '.jpg': 'image/jpeg',
//     '.jpeg': 'image/jpeg',
//     '.png': 'image/png',
//     '.gif': 'image/gif',
//     '.bmp': 'image/bmp',
//     '.webp': 'image/webp',
//     '.doc': 'application/msword',
//     '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//     '.xls': 'application/vnd.ms-excel',
//     '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//     '.txt': 'text/plain',
//     '.rtf': 'application/rtf'
//   };
//   return mimeTypes[ext] || 'application/octet-stream';
// }

// module.exports = {
//   downloadFile,
//   viewFile,
//   getFileInfo
// };

