/**
 * routes/uploadRoutes.js
 *
 * Drop-in replacement for your existing uploadRoutes.js.
 * Only change: files go to Cloudinary instead of local disk.
 *
 * The response shape is identical to the original:
 *   { success: true, url: <cloudinary_secure_url>, filename, mimetype }
 * so the React Native uploadAPI needs zero changes.
 */

const express = require('express');
const router  = express.Router();

const upload = require('../middlewares/cloudinaryUpload');
const {
  uploadToCloudinary,
  handleUploadError,
  cloudinary,
} = require('../middlewares/cloudinaryUpload');
const { authenticateToken } = require('../middlewares/authMiddleware');

// ─── Subfolder routing inside Cloudinary ─────────────────────────────────────
function getSubfolder(mimetype = '') {
  if (mimetype.startsWith('image/'))  return 'images';
  if (mimetype.startsWith('video/'))  return 'videos';
  if (
    mimetype === 'application/pdf'    ||
    mimetype.includes('word')         ||
    mimetype.includes('excel')        ||
    mimetype.includes('spreadsheet')  ||
    mimetype.includes('presentation') ||
    mimetype === 'text/plain'         ||
    mimetype === 'text/csv'           ||
    mimetype === 'application/rtf'
  ) return 'documents';
  if (
    mimetype.includes('zip') ||
    mimetype.includes('rar') ||
    mimetype.includes('7z')  ||
    mimetype.includes('tar')
  ) return 'archives';
  return 'attachments';
}

// ─── POST /api/upload  (single — field name "file") ──────────────────────────
router.post(
  '/',
  // Debug middleware — preserved exactly from your original
  (req, res, next) => {
    console.log('\n=== UPLOAD DEBUG ===');
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Has Authorization header:', Boolean(req.headers.authorization));
    next();
  },
  authenticateToken,
  upload.single('file'),
  handleUploadError,           // catches multer / validation errors
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    try {
      const { buffer, mimetype, originalname } = req.file;
      const subfolder = getSubfolder(mimetype);

      console.log(`⬆️  Cloudinary upload: ${originalname} (${mimetype})`);

      const result = await uploadToCloudinary(buffer, mimetype, originalname, subfolder);

      console.log(`✅ File uploaded to Cloudinary: ${result.secure_url}`);

      // Same response shape your app already expects: { success, url, filename, mimetype }
      return res.json({
        success   : true,
        url       : result.secure_url,      // ← Cloudinary CDN URL (https, permanent)
        filename  : originalname,
        mimetype,
        public_id : result.public_id,       // ← store this if you ever need to delete
        resource_type: result.resource_type,
      });
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      return res.status(500).json({
        success: false,
        error  : error.message || 'Upload failed',
      });
    }
  },
);

// ─── POST /api/upload/multiple  (up to 10 files — field name "files") ─────────
router.post(
  '/multiple',
  authenticateToken,
  upload.array('files', 10),
  handleUploadError,
  async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    try {
      console.log(`⬆️  Cloudinary multi-upload: ${req.files.length} file(s)`);

      const results = await Promise.all(
        req.files.map(async (file) => {
          const { buffer, mimetype, originalname } = file;
          const subfolder = getSubfolder(mimetype);
          try {
            const r = await uploadToCloudinary(buffer, mimetype, originalname, subfolder);
            return {
              success          : true,
              url              : r.secure_url,
              filename         : originalname,
              mimetype,
              public_id        : r.public_id,
              resource_type    : r.resource_type,
            };
          } catch (err) {
            console.error(`❌ Failed: ${originalname}:`, err.message);
            return { success: false, filename: originalname, error: err.message };
          }
        }),
      );

      const successful = results.filter(r => r.success);
      const failed     = results.filter(r => !r.success);

      console.log(`✅ ${successful.length} uploaded, ${failed.length} failed`);

      return res.json({
        success : failed.length === 0,
        message : `${successful.length} of ${results.length} files uploaded`,
        files   : results,
        urls    : successful.map(r => r.url),   // convenience array of CDN URLs
      });
    } catch (error) {
      console.error('Multi-upload error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Upload failed' });
    }
  },
);

// ─── DELETE /api/upload  (delete a file by public_id) ────────────────────────
// Body: { public_id: "powergen/images/1234-photo", resource_type: "image" }
router.delete(
  '/',
  authenticateToken,
  async (req, res) => {
    const { public_id, resource_type = 'image' } = req.body;

    if (!public_id) {
      return res.status(400).json({ success: false, error: 'public_id is required' });
    }

    try {
      // If we don't know the resource_type, try all three
      const typesToTry = resource_type
        ? [resource_type]
        : ['image', 'video', 'raw'];

      let deleted = false;
      for (const type of typesToTry) {
        const result = await cloudinary.uploader.destroy(public_id, { resource_type: type });
        if (result.result === 'ok') { deleted = true; break; }
      }

      if (!deleted) {
        return res.status(404).json({ success: false, error: 'File not found on Cloudinary' });
      }

      return res.json({ success: true, message: 'File deleted', public_id });
    } catch (error) {
      console.error('Cloudinary delete error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  },
);

module.exports = router;









// const express = require('express');
// const router = express.Router();
// const upload = require('../middlewares/uploadMiddleware'); // Standard multer setup
// const { authenticateToken } = require('../middlewares/authMiddleware');

// // ✅ Full server URL so mobile clients can fetch the file directly
// const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';

// // Generic file upload
// router.post(
//   '/',
//   (req, res, next) => {
//     // Lightweight debug to identify common mobile upload failures.
//     console.log('\n=== UPLOAD DEBUG ===');
//     console.log('Content-Type:', req.headers['content-type']);
//     console.log('Has Authorization header:', Boolean(req.headers.authorization));
//     next();
//   },
//   authenticateToken,
//   upload.single('file'),
//   // If multer/fileFilter fails, return a structured error response.
//   upload.handleMulterError,
//   upload.validateFiles,
//   (req, res) => {
//     if (!req.file) {
//       return res.status(400).json({ success: false, error: 'No file uploaded' });
//     }

//     // ✅ Return a full URL the mobile app can fetch directly —
//     //    relative paths like /uploads/temp/... break on Render
//     //    because the client has no base URL to resolve against.
//     const fileUrl = `${SERVER_URL}/uploads/temp/${req.file.filename}`;

//     console.log(`✅ File uploaded successfully: ${fileUrl}`);

//     res.json({
//       success: true,
//       url: fileUrl,
//       filename: req.file.filename,
//       mimetype: req.file.mimetype,
//     });
//   }
// );

// module.exports = router;



