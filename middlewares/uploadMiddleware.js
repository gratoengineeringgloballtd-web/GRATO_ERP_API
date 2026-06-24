/**
 * uploadMiddleware.js
 *
 * Cloudinary / memoryStorage mode.
 * Accepted file types updated to include:
 *   - Video: mp4, mov, avi, mkv, webm, wmv, 3gp
 *   - Archives: zip, rar, 7z, tar, gz
 */

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ─── Storage ──────────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();

// ─── File filter ──────────────────────────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  console.log(`\n🔍 Validating file: ${file.originalname}`);
  console.log(`   Field: ${file.fieldname}`);
  console.log(`   MIME type: ${file.mimetype}`);

  const allowedMimeTypes = {
    // Images
    'image/jpeg':  ['.jpg', '.jpeg'],
    'image/png':   ['.png'],
    'image/gif':   ['.gif'],
    'image/bmp':   ['.bmp'],
    'image/webp':  ['.webp'],

    // Documents
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'text/plain':  ['.txt'],
    'application/rtf': ['.rtf'],

    // ── Video ──────────────────────────────────────────────────────────────
    'video/mp4':        ['.mp4'],
    'video/quicktime':  ['.mov'],
    'video/x-msvideo':  ['.avi'],
    'video/x-matroska': ['.mkv'],
    'video/webm':       ['.webm'],
    'video/x-ms-wmv':   ['.wmv'],
    'video/3gpp':       ['.3gp'],
    'video/3gpp2':      ['.3g2'],

    // ── Archives ───────────────────────────────────────────────────────────
    'application/zip':                          ['.zip'],
    'application/x-zip-compressed':             ['.zip'],
    'application/x-rar-compressed':             ['.rar'],
    'application/vnd.rar':                      ['.rar'],
    'application/x-7z-compressed':              ['.7z'],
    'application/x-tar':                        ['.tar'],
    'application/gzip':                         ['.gz'],
    'application/x-gzip':                       ['.gz'],
    'application/x-bzip2':                      ['.bz2'],
    // octet-stream is used by many archive tools — allow it when extension matches
    'application/octet-stream': ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.mkv', '.avi']
  };

  const fileExtension = path.extname(file.originalname).toLowerCase();

  // Look up allowed extensions for this MIME type
  const expectedExtensions = allowedMimeTypes[file.mimetype];

  if (!expectedExtensions) {
    // MIME not in our list at all
    console.error(`   ❌ Unsupported MIME type: ${file.mimetype}`);
    const error = new Error(
      `Unsupported file type: ${file.mimetype}. Allowed: PDF, Word, Excel, Images, Video (MP4/MOV/AVI/MKV/WEBM/WMV/3GP), Archives (ZIP/RAR/7Z/TAR/GZ)`
    );
    error.code = 'UNSUPPORTED_MIME_TYPE';
    return cb(error, false);
  }

  if (!expectedExtensions.includes(fileExtension)) {
    console.error(`   ❌ Extension mismatch: ${fileExtension} for ${file.mimetype}`);
    const error = new Error(`File extension ${fileExtension} doesn't match content type ${file.mimetype}`);
    error.code = 'EXTENSION_MISMATCH';
    return cb(error, false);
  }

  const suspiciousPatterns = [
    /\.(exe|bat|cmd|scr|pif|com)$/i,
    /\.(php|asp|aspx|jsp)$/i,
    /\.\.\//,
    /[<>"|*?]/,
    /%[0-9a-fA-F]{2}/
  ];

  if (suspiciousPatterns.some(pattern => pattern.test(file.originalname))) {
    console.error(`   ❌ Suspicious filename: ${file.originalname}`);
    const error = new Error('Filename contains suspicious patterns');
    error.code = 'SUSPICIOUS_FILENAME';
    return cb(error, false);
  }

  console.log(`   ✅ File validation passed`);
  cb(null, true);
};

// ─── Multer instance ──────────────────────────────────────────────────────────
// Max file size raised to 500 MB to accommodate video files.
// Adjust LIMIT_FILE_SIZE in the error map below if you change this.
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize:      500 * 1024 * 1024, // 500 MB (videos can be large)
    files:         20,
    fields:        200,
    fieldNameSize: 100,
    fieldSize:     2 * 1024 * 1024
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
const handleMulterError = (error, req, res, next) => {
  console.error('\n❌ ========== UPLOAD ERROR ==========');
  console.error('Error type:', error.constructor.name);
  console.error('Error message:', error.message);
  console.error('Error code:', error.code);

  if (error instanceof multer.MulterError) {
    const errorMessages = {
      'LIMIT_FILE_SIZE':       'File too large. Maximum size is 500 MB per file.',
      'LIMIT_FILE_COUNT':      'Too many files. Maximum is 20 files per request.',
      'LIMIT_FIELD_COUNT':     'Too many form fields.',
      'LIMIT_UNEXPECTED_FILE': 'Unexpected file field.',
      'LIMIT_PART_COUNT':      'Too many parts in multipart request.',
      'LIMIT_FIELD_KEY':       'Field name too long.',
      'LIMIT_FIELD_VALUE':     'Field value too long (max 2MB).'
    };
    return res.status(400).json({
      success: false,
      message: errorMessages[error.code] || `Upload error: ${error.message}`,
      error: { type: 'MULTER_ERROR', code: error.code, field: error.field }
    });
  }

  if (['UNSUPPORTED_MIME_TYPE', 'EXTENSION_MISMATCH', 'SUSPICIOUS_FILENAME'].includes(error.code)) {
    return res.status(400).json({
      success: false,
      message: error.message,
      error: { type: 'FILE_VALIDATION_ERROR', code: error.code }
    });
  }

  return res.status(500).json({
    success: false,
    message: error.message || 'File upload failed',
    error: { type: 'UPLOAD_ERROR' }
  });
};

// ─── No-ops kept for compatibility ───────────────────────────────────────────
function cleanupFiles(files) {
  if (!files) return;
  console.log('ℹ️  cleanupFiles called (no-op in Cloudinary/memoryStorage mode)');
}

const cleanupTempFiles = (req, res, next) => next();

const ensureUploadDirectories = () => {
  console.log('☁️  Cloudinary mode — skipping local directory creation');
};

// ─── validateFiles ────────────────────────────────────────────────────────────
const validateFiles = async (req, res, next) => {
  if (!req.files && !req.file) {
    console.log('ℹ️  No files in request, skipping validation');
    return next();
  }

  try {
    const files = req.files
      ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
      : [req.file];

    console.log(`\n🔍 Validating ${files.length} uploaded file(s)...`);

    for (let i = 0; i < files.length; i++) {
      const file     = files[i];
      const fileSize = file.size || file.buffer?.length || 0;

      console.log(`\n   File ${i + 1}/${files.length}: ${file.originalname} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

      if (fileSize === 0) throw new Error(`File is empty: ${file.originalname}`);
      if (!file.buffer && !file.path) throw new Error(`No file data received for: ${file.originalname}`);

      console.log(`   ✅ Validated`);
    }

    console.log(`\n✅ All ${files.length} file(s) validated\n`);
    next();
  } catch (error) {
    console.error('\n❌ File validation failed:', error.message);
    res.status(400).json({ success: false, message: error.message, error: { type: 'FILE_VALIDATION_ERROR' } });
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports                          = upload;
module.exports.upload                   = upload;
module.exports.handleMulterError        = handleMulterError;
module.exports.cleanupTempFiles         = cleanupTempFiles;
module.exports.validateFiles            = validateFiles;
module.exports.ensureUploadDirectories  = ensureUploadDirectories;
module.exports.cleanupFiles             = cleanupFiles;

