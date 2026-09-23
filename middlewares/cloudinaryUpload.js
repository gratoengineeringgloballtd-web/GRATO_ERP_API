/**
 * cloudinaryUpload.js
 *
 * Drop-in replacement for the multer disk-storage middleware.
 * Uses multer memoryStorage so files never touch the local disk,
 * then pipes the buffer straight to Cloudinary via a stream.
 *
 * Environment variables required:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   CLOUDINARY_ROOT_FOLDER   (e.g. "powergen" — organises all uploads)
 */

const multer = require('multer');
const path   = require('path');
const { Readable } = require('stream');
const cloudinary = require('cloudinary').v2;

// ─── Configure Cloudinary ────────────────────────────────────────────────────
cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
  secure     : true,
});

// ─── Resource-type routing ───────────────────────────────────────────────────
// Cloudinary requires the right resource_type or it rejects the upload.
// "image"  → jpg/png/gif/webp/bmp/svg
// "video"  → mp4/mov/avi/webm/mkv
// "raw"    → everything else (pdf/xlsx/docx/zip/txt/csv …)

const MIME_TO_RESOURCE_TYPE = {
  // Images
  'image/jpeg'  : 'image',
  'image/jpg'   : 'image',
  'image/png'   : 'image',
  'image/gif'   : 'image',
  'image/webp'  : 'image',
  'image/bmp'   : 'image',
  'image/svg+xml': 'image',
  // Video
  'video/mp4'   : 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  'video/webm'  : 'video',
  'video/x-matroska': 'video',
  'video/3gpp'  : 'video',
  // Raw (everything else)
  'application/pdf': 'raw',
  'application/msword': 'raw',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'raw',
  'application/vnd.ms-excel': 'raw',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'raw',
  'application/vnd.ms-powerpoint': 'raw',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'raw',
  'application/zip': 'raw',
  'application/x-zip-compressed': 'raw',
  'application/x-rar-compressed': 'raw',
  'application/x-7z-compressed': 'raw',
  'application/x-tar': 'raw',
  'text/plain': 'raw',
  'text/csv'  : 'raw',
  'application/json': 'raw',
  'application/rtf': 'raw',
};

function getResourceType(mimetype) {
  return MIME_TO_RESOURCE_TYPE[mimetype] || 'raw';
}

// ─── Allowed mime-types (same list as your original fileFilter) ──────────────
const ALLOWED_MIME_TYPES = new Set([
  ...Object.keys(MIME_TO_RESOURCE_TYPE),
]);

// ─── Multer — memory storage (no disk writes) ────────────────────────────────
const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    const err = new Error(`Unsupported file type: ${file.mimetype}`);
    err.code  = 'UNSUPPORTED_MIME_TYPE';
    return cb(err, false);
  }

  // Block suspicious filenames
  const suspicious = [
    /\.(exe|bat|cmd|scr|pif|com)$/i,
    /\.(php|asp|aspx|jsp)$/i,
    /\.\.\//,
    /[<>"|*?]/,
    /%[0-9a-fA-F]{2}/,
  ];
  if (suspicious.some(p => p.test(file.originalname))) {
    const err = new Error('Filename contains suspicious patterns');
    err.code  = 'SUSPICIOUS_FILENAME';
    return cb(err, false);
  }

  cb(null, true);
};

const upload = multer({
  storage   : multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize       : 100 * 1024 * 1024, // 100 MB — Cloudinary can handle it
    files          : 10,
    fields         : 20,
    fieldNameSize  : 100,
    fieldSize      : 1024 * 1024,
  },
});

// ─── Core upload helper ──────────────────────────────────────────────────────
/**
 * Upload a single file buffer to Cloudinary.
 *
 * @param {Buffer}  buffer      - File contents (from multer memoryStorage)
 * @param {string}  mimetype    - MIME type of the file
 * @param {string}  originalname - Original filename (used for public_id & display)
 * @param {string}  [subfolder] - Optional sub-folder within root folder
 * @returns {Promise<object>}   - Cloudinary upload result
 */
async function uploadToCloudinary(buffer, mimetype, originalname, subfolder = 'attachments') {
  const rootFolder    = process.env.CLOUDINARY_ROOT_FOLDER || 'powergen';
  const resourceType  = getResourceType(mimetype);

  // Build a clean public_id: root/subfolder/timestamp-originalname
  const ext        = path.extname(originalname).toLowerCase();
  const nameWithout= path.basename(originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const publicId   = `${rootFolder}/${subfolder}/${Date.now()}-${nameWithout}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id     : publicId,
        resource_type : resourceType,
        // For raw files, force a download-friendly delivery URL
        ...(resourceType === 'raw' && {
          type: 'upload',
        }),
        // Preserve original filename as a display name tag
        context: {
          original_filename: originalname,
          mime_type        : mimetype,
        },
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    // Pipe buffer into the Cloudinary stream
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(stream);
  });
}

// ─── Error handler (same interface as your existing handleMulterError) ────────
const handleUploadError = (error, req, res, next) => {
  console.error('Upload error:', error);

  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE  : 'File too large. Maximum is 100 MB per file.',
      LIMIT_FILE_COUNT : 'Too many files. Maximum is 10 per request.',
      LIMIT_FIELD_COUNT: 'Too many form fields.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field.',
    };
    return res.status(400).json({
      success: false,
      message: messages[error.code] || `Upload error: ${error.message}`,
      error  : { type: 'MULTER_ERROR', code: error.code },
    });
  }

  if (['UNSUPPORTED_MIME_TYPE', 'EXTENSION_MISMATCH', 'SUSPICIOUS_FILENAME'].includes(error.code)) {
    return res.status(400).json({
      success: false,
      message: error.message,
      error  : { type: 'FILE_VALIDATION_ERROR', code: error.code },
    });
  }

  return res.status(500).json({
    success: false,
    message: error.message || 'File upload failed',
    error  : { type: 'UPLOAD_ERROR' },
  });
};

module.exports = upload;
module.exports.uploadToCloudinary  = uploadToCloudinary;
module.exports.handleUploadError   = handleUploadError;
module.exports.getResourceType     = getResourceType;
module.exports.cloudinary          = cloudinary;
// Keep backward-compat aliases used in server.js
module.exports.handleMulterError   = handleUploadError;
module.exports.cleanupTempFiles    = (_req, _res, next) => next(); // no-op: nothing on disk
module.exports.validateFiles       = (_req, _res, next) => next(); // validation is now in route
module.exports.ensureUploadDirectories = () => {};                 // no-op: no local dirs needed