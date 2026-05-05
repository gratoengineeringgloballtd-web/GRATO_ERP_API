/**
 * cloudinaryStorage.js
 * Drop-in replacement for localFileStorage.js
 *
 * Place at: utils/cloudinaryStorage.js
 *
 * All functions maintain the same return shape as localFileStorage.js so
 * nothing else in the codebase needs to change except the require() path.
 *
 * Required env vars (add to Render environment):
 *   CLOUDINARY_CLOUD_NAME=your_cloud_name
 *   CLOUDINARY_API_KEY=your_api_key
 *   CLOUDINARY_API_SECRET=your_api_secret
 */

const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const path        = require('path');
const fs          = require('fs');

// ─── Configure Cloudinary ─────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true
});

// ─── Storage category → Cloudinary folder mapping ────────────────────────────
const STORAGE_CATEGORIES = {
  CASH_REQUESTS:        'cash-requests',
  JUSTIFICATIONS:       'justifications',
  REIMBURSEMENTS:       'reimbursements',
  SUPPLIER_INVOICES:    'supplier-invoices',
  EMPLOYEE_INVOICES:    'employee-invoices',
  SUPPLIER_DOCUMENTS:   'supplier-documents',
  SUPPLIER_ONBOARDING:  'supplier-onboarding',
  CUSTOMER_ONBOARDING:  'customer-onboarding',
  PURCHASE_REQUISITIONS:'purchase-requisitions',
  CONTRACTS:            'contracts',
  SIGNED_DOCUMENTS:     'signed-documents',
  ACTION_ITEMS:         'action-items',
  IT_SUPPORT:           'it-support',
  SALARY_PAYMENTS:      'salary-payments',
  USER_SIGNATURES:      'user-signatures'
};

// Root Cloudinary folder — keeps all ERP files organised under one namespace
const CLOUDINARY_ROOT = process.env.CLOUDINARY_ROOT_FOLDER || 'grato-erp';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine Cloudinary resource_type from mimetype
 */
const getResourceType = (mimetype = '') => {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype === 'application/pdf')  return 'raw';   // PDFs must be 'raw'
  return 'raw';
};

/**
 * Generate a clean public_id for Cloudinary (no extension)
 */
const generatePublicId = (originalName, category, subfolder) => {
  const timestamp  = Date.now();
  const random     = Math.random().toString(36).substring(2, 8);
  const baseName   = path.basename(originalName, path.extname(originalName))
                       .replace(/[^a-zA-Z0-9]/g, '_')
                       .substring(0, 50);

  const folder = subfolder
    ? `${CLOUDINARY_ROOT}/${category}/${subfolder}`
    : `${CLOUDINARY_ROOT}/${category}`;

  return { folder, publicId: `${baseName}-${timestamp}-${random}` };
};

/**
 * Upload a buffer or file path to Cloudinary
 * Returns a Promise that resolves with the Cloudinary upload result
 */
const uploadToCloudinary = (source, options) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      ...options,
      use_filename:      false,
      unique_filename:   false,
      overwrite:         false,
    };

    if (Buffer.isBuffer(source)) {
      // Upload from buffer via stream
      const stream = cloudinary.uploader.upload_stream(uploadOptions, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
      streamifier.createReadStream(source).pipe(stream);
    } else if (typeof source === 'string' && fs.existsSync(source)) {
      // Upload from local file path
      cloudinary.uploader.upload(source, uploadOptions, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    } else {
      reject(new Error('No valid buffer or file path provided for upload'));
    }
  });
};

// ─── Core API (same shape as localFileStorage.js) ────────────────────────────

/**
 * saveFile — uploads a multer file object to Cloudinary
 *
 * @param {object} file          - Multer file object (has .buffer or .path)
 * @param {string} category      - STORAGE_CATEGORIES value
 * @param {string} subfolder     - Optional subfolder within category
 * @param {string} customFilename - Optional custom base name (extension stripped)
 * @returns {object}             - Same metadata shape as localFileStorage.saveFile
 */
const saveFile = async (file, category = 'general', subfolder = '', customFilename = null) => {
  try {
    console.log('☁️  Cloudinary upload starting:');
    console.log('   Category:', category);
    console.log('   Subfolder:', subfolder || 'none');
    console.log('   Original name:', file.originalname);
    console.log('   MIME type:', file.mimetype);

    // Validate size (10 MB)
    const fileSize = file.size || file.buffer?.length || 0;
    if (fileSize > 10 * 1024 * 1024) {
      throw new Error(`File size (${(fileSize / 1024 / 1024).toFixed(2)} MB) exceeds 10 MB limit`);
    }

    // Validate receipt types
    if (category === STORAGE_CATEGORIES.REIMBURSEMENTS) {
      const allowed = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','application/pdf'];
      if (!allowed.includes(file.mimetype)) {
        throw new Error(`Invalid file type for receipts: ${file.mimetype}`);
      }
    }

    // Build Cloudinary folder + public_id
    const { folder, publicId: basePublicId } = generatePublicId(
      customFilename || file.originalname,
      category,
      subfolder
    );

    const resourceType = getResourceType(file.mimetype);
    const ext          = path.extname(file.originalname).toLowerCase();

    // For 'raw' resources Cloudinary needs the extension in the public_id
    const cloudinaryPublicId = resourceType === 'raw'
      ? `${basePublicId}${ext}`
      : basePublicId;

    const uploadOptions = {
      folder,
      public_id:     cloudinaryPublicId,
      resource_type: resourceType,
    };

    // Source: buffer (memoryStorage) or path (diskStorage)
    const source = file.buffer || file.path;

    console.log('   Uploading to:', `${folder}/${cloudinaryPublicId}`);
    const result = await uploadToCloudinary(source, uploadOptions);

    // Clean up local temp file if it came from diskStorage
    if (file.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch (_) {}
    }

    console.log('   ✅ Uploaded successfully');
    console.log('   ✅ URL:', result.secure_url);
    console.log('   ✅ Public ID:', result.public_id);

    // Return same shape as localFileStorage.saveFile
    return {
      publicId:     result.public_id,          // Full Cloudinary public_id (with folder)
      url:          result.secure_url,          // HTTPS URL — use this everywhere
      localPath:    result.secure_url,          // ← kept for backward compat with old code
      relativePath: result.public_id,
      originalName: file.originalname,
      format:       result.format || ext.substring(1),
      resourceType: result.resource_type,
      bytes:        result.bytes,
      mimetype:     file.mimetype,
      category,
      subfolder:    subfolder || null,
      uploadedAt:   new Date(),
      // Cloudinary extras
      cloudinaryId: result.public_id,
      width:        result.width  || null,
      height:       result.height || null,
    };
  } catch (error) {
    console.error('❌ Cloudinary upload failed:', error.message);
    throw new Error(`Failed to save file: ${error.message}`);
  }
};

/**
 * deleteFile — deletes a file from Cloudinary
 *
 * @param {object} fileMetadata - Object with publicId / cloudinaryId / url
 */
const deleteFile = async (fileMetadata) => {
  try {
    if (!fileMetadata) return { success: false, error: 'No metadata' };

    // Prefer cloudinaryId → publicId → extract from URL
    let publicId = fileMetadata.cloudinaryId || fileMetadata.publicId;

    if (!publicId && fileMetadata.url) {
      // Extract public_id from Cloudinary URL
      // e.g. https://res.cloudinary.com/cloud/image/upload/v123/grato-erp/folder/file.jpg
      const match = fileMetadata.url.match(/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
      if (match) publicId = match[1];
    }

    if (!publicId) {
      console.warn('⚠️  Could not determine Cloudinary public_id for deletion');
      return { success: false, error: 'No public_id' };
    }

    // Determine resource type from mimetype or url
    const resourceType = fileMetadata.resourceType ||
      (fileMetadata.mimetype?.startsWith('image/') ? 'image' : 'raw');

    console.log('🗑️  Deleting from Cloudinary:', publicId);
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

    if (result.result === 'ok' || result.result === 'not found') {
      console.log('✅ Deleted from Cloudinary:', publicId);
      return { success: true };
    }

    console.warn('⚠️  Cloudinary deletion result:', result.result);
    return { success: false, error: result.result };
  } catch (error) {
    console.error('❌ Cloudinary deletion failed:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * deleteFiles — deletes multiple files
 */
const deleteFiles = async (fileMetadataArray) => {
  if (!Array.isArray(fileMetadataArray)) return { success: false, error: 'Input must be an array' };

  const results = [];
  for (const metadata of fileMetadataArray) {
    const result = await deleteFile(metadata);
    results.push({ ...result, file: metadata.originalName || metadata.name || metadata.publicId });
  }

  return {
    success:      results.every(r => r.success),
    results,
    deletedCount: results.filter(r => r.success).length,
    failedCount:  results.filter(r => !r.success).length
  };
};

/**
 * getFileInfo — returns metadata about a stored file
 * For Cloudinary files, queries the API for resource details
 */
const getFileInfo = async (fileMetadata) => {
  try {
    const publicId     = fileMetadata.cloudinaryId || fileMetadata.publicId;
    const resourceType = fileMetadata.resourceType ||
      (fileMetadata.mimetype?.startsWith('image/') ? 'image' : 'raw');

    if (!publicId) return { exists: false, error: 'No public_id' };

    const result = await cloudinary.api.resource(publicId, { resource_type: resourceType });

    return {
      exists:   true,
      url:      result.secure_url,
      publicId: result.public_id,
      size:     result.bytes,
      sizeKB:   (result.bytes / 1024).toFixed(2),
      sizeMB:   (result.bytes / 1024 / 1024).toFixed(2),
      format:   result.format,
      created:  result.created_at,
      isImage:  result.resource_type === 'image',
      isPDF:    result.format === 'pdf'
    };
  } catch (error) {
    // Cloudinary returns 404 for missing resources
    if (error.http_code === 404) return { exists: false, error: 'Not found on Cloudinary' };
    return { exists: false, error: error.message };
  }
};

/**
 * validateReceiptImages — unchanged validation logic (no I/O)
 */
const validateReceiptImages = (files) => {
  const errors   = [];
  const warnings = [];

  if (!files || files.length === 0) {
    errors.push('No receipt images provided');
    return { valid: false, errors, warnings };
  }

  if (files.length > 10) errors.push(`Too many files (${files.length}/10 maximum)`);

  const allowedTypes = [
    'image/jpeg','image/jpg','image/png','image/gif','image/webp','application/pdf'
  ];
  const maxSize = 10 * 1024 * 1024;

  files.forEach((file, index) => {
    const fileNum  = index + 1;
    const fileSize = file.size || file.buffer?.length || 0;

    if (!allowedTypes.includes(file.mimetype))
      errors.push(`File ${fileNum} (${file.originalname}): Invalid type ${file.mimetype}`);

    if (fileSize > maxSize)
      errors.push(`File ${fileNum} (${file.originalname}): Too large (${(fileSize/1024/1024).toFixed(2)} MB / 10 MB max)`);

    if (file.mimetype.startsWith('image/') && fileSize < 1024)
      warnings.push(`File ${fileNum} (${file.originalname}): Very small file, may be corrupt`);
  });

  return { valid: errors.length === 0, errors, warnings, fileCount: files.length };
};

/**
 * generateUniqueFilename — kept for any code that still calls it
 */
const generateUniqueFilename = (originalName, prefix = '') => {
  const timestamp    = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const ext          = path.extname(originalName);
  const baseName     = path.basename(originalName, ext)
                         .replace(/[^a-zA-Z0-9]/g, '_')
                         .substring(0, 50);
  return `${prefix}${prefix ? '_' : ''}${baseName}-${timestamp}-${randomString}${ext}`;
};

/**
 * initializeStorageDirectories — no-op for Cloudinary
 * Kept so existing startup code doesn't break
 */
const initializeStorageDirectories = async () => {
  console.log('☁️  Cloudinary storage active — no local directories needed');
};

/**
 * getStorageStats — queries Cloudinary usage API
 */
const getStorageStats = async () => {
  try {
    const usage = await cloudinary.api.usage();
    return {
      TOTALS: {
        totalFiles:  usage.resources,
        totalSize:   usage.storage.usage,
        totalSizeKB: (usage.storage.usage / 1024).toFixed(2),
        totalSizeMB: (usage.storage.usage / 1024 / 1024).toFixed(2),
        totalSizeGB: (usage.storage.usage / 1024 / 1024 / 1024).toFixed(4),
      },
      plan: {
        storageLimit:    usage.storage.limit,
        bandwidthUsed:   usage.bandwidth.usage,
        bandwidthLimit:  usage.bandwidth.limit,
        transformations: usage.transformations.usage,
      }
    };
  } catch (error) {
    console.error('Failed to get Cloudinary stats:', error.message);
    throw error;
  }
};

/**
 * findFileRecursively — not applicable for Cloudinary
 * Returns null to keep callers from crashing
 */
const findFileRecursively = () => null;

/**
 * cleanupOldTempFiles — no-op for Cloudinary
 */
const cleanupOldTempFiles = async () => ({
  success: true, deletedCount: 0, message: 'No temp files in Cloudinary mode'
});

// ─── Exports (identical surface area to localFileStorage.js) ─────────────────
module.exports = {
  // Core
  saveFile,
  deleteFile,
  deleteFiles,
  getFileInfo,
  findFileRecursively,

  // Validation
  validateReceiptImages,

  // Utilities
  initializeStorageDirectories,
  generateUniqueFilename,
  getStorageStats,
  cleanupOldTempFiles,

  // Constants
  BASE_UPLOAD_DIR: '/var/data/uploads', // legacy compat — not used in Cloudinary mode
  STORAGE_CATEGORIES,

  // Cloudinary instance (for advanced use)
  cloudinary,
};









// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');

// // Ensure upload directories exist on startup with proper error handling
// const ensureUploadDirectories = () => {
//   const directories = [
//     path.join(__dirname, '../uploads'),
//     path.join(__dirname, '../uploads/temp'),
//     path.join(__dirname, '../uploads/attachments'),
//     path.join(__dirname, '../uploads/justifications'),
//     path.join(__dirname, '../uploads/reimbursements')
//   ];

//   directories.forEach(dir => {
//     try {
//       if (!fs.existsSync(dir)) {
//         console.log(`📁 Creating directory: ${dir}`);
//         fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
//         console.log(`✅ Directory created successfully: ${dir}`);
//       } else {
//         console.log(`✓ Directory exists: ${dir}`);
//       }
      
//       // Verify directory is writable
//       fs.accessSync(dir, fs.constants.W_OK);
//       console.log(`✓ Directory is writable: ${dir}`);
//     } catch (error) {
//       console.error(`❌ Failed to setup directory ${dir}:`, error.message);
//       throw error;
//     }
//   });
// };

// // Call this immediately when module loads
// try {
//   ensureUploadDirectories();
// } catch (error) {
//   console.error('CRITICAL: Failed to initialize upload directories:', error);
//   process.exit(1);
// }

// // Enhanced storage configuration with detailed logging
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     const uploadDir = path.join(__dirname, '../uploads/temp');
    
//     console.log(`\n📤 Processing upload for field: ${file.fieldname}`);
//     console.log(`   Original name: ${file.originalname}`);
//     console.log(`   Destination: ${uploadDir}`);
    
//     // Verify directory exists and is writable
//     try {
//       if (!fs.existsSync(uploadDir)) {
//         console.log(`   Creating missing temp directory...`);
//         fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
//       }
      
//       fs.accessSync(uploadDir, fs.constants.W_OK);
//       console.log(`   ✓ Destination directory verified`);
//       cb(null, uploadDir);
//     } catch (error) {
//       console.error(`   ❌ Destination directory error:`, error.message);
//       cb(error);
//     }
//   },
//   filename: function (req, file, cb) {
//     try {
//       const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//       const ext = path.extname(file.originalname).toLowerCase();
//       const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
//       const filename = `${file.fieldname}-${uniqueSuffix}-${baseName}${ext}`;
      
//       console.log(`   Generated filename: ${filename}`);
//       cb(null, filename);
//     } catch (error) {
//       console.error(`   ❌ Filename generation error:`, error.message);
//       cb(error);
//     }
//   }
// });

// // Enhanced file filter with comprehensive validation
// const fileFilter = (req, file, cb) => {
//   console.log(`\n🔍 Validating file: ${file.originalname}`);
//   console.log(`   Field: ${file.fieldname}`);
//   console.log(`   MIME type: ${file.mimetype}`);
//   console.log(`   Size: ${file.size ? (file.size / 1024).toFixed(2) + ' KB' : 'Unknown'}`);

//   // Allowed file types with extensions
//   const allowedMimeTypes = {
//     // Images
//     'image/jpeg': ['.jpg', '.jpeg'],
//     'image/png': ['.png'],
//     'image/gif': ['.gif'],
//     'image/bmp': ['.bmp'],
//     'image/webp': ['.webp'],

//     // Documents
//     'application/pdf': ['.pdf'],
//     'application/msword': ['.doc'],
//     'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
//     'application/vnd.ms-excel': ['.xls'],
//     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
//     'text/plain': ['.txt'],
//     'application/rtf': ['.rtf']
//   };

//   const fileExtension = path.extname(file.originalname).toLowerCase();
  
//   // Check if mimetype is allowed
//   if (!allowedMimeTypes[file.mimetype]) {
//     console.error(`   ❌ Unsupported MIME type: ${file.mimetype}`);
//     const error = new Error(`Unsupported file type: ${file.mimetype}. Allowed types: PDF, Word, Excel, Images`);
//     error.code = 'UNSUPPORTED_MIME_TYPE';
//     return cb(error, false);
//   }

//   // Verify extension matches mimetype
//   const expectedExtensions = allowedMimeTypes[file.mimetype];
//   if (!expectedExtensions.includes(fileExtension)) {
//     console.error(`   ❌ Extension mismatch: ${fileExtension} for ${file.mimetype}`);
//     const error = new Error(`File extension ${fileExtension} doesn't match content type ${file.mimetype}`);
//     error.code = 'EXTENSION_MISMATCH';
//     return cb(error, false);
//   }

//   // Check for suspicious patterns in filename
//   const suspiciousPatterns = [
//     /\.(exe|bat|cmd|scr|pif|com)$/i,
//     /\.(php|asp|aspx|jsp)$/i,
//     /\.\.\//, // Path traversal
//     /[<>"|*?]/,
//     /%[0-9a-fA-F]{2}/, // URL encoded
//   ];
  
//   if (suspiciousPatterns.some(pattern => pattern.test(file.originalname))) {
//     console.error(`   ❌ Suspicious filename pattern detected: ${file.originalname}`);
//     const error = new Error('Filename contains suspicious patterns and was rejected for security reasons');
//     error.code = 'SUSPICIOUS_FILENAME';
//     return cb(error, false);
//   }

//   console.log(`   ✅ File validation passed`);
//   cb(null, true);
// };

// // Create multer instance with enhanced configuration
// const upload = multer({
//   storage: storage,
//   fileFilter: fileFilter,
//   limits: { 
//     fileSize: 10 * 1024 * 1024,    // 10MB max per file (reduced from 25MB for stability)
//     files: 10,                      // Max 10 files
//     fields: 20,                     // Max 20 fields
//     fieldNameSize: 100,             // Max field name length
//     fieldSize: 2 * 1024 * 1024,     // 2MB max field size (for JSON data)
//   }
// });

// // Enhanced error handling middleware with detailed logging
// const handleMulterError = (error, req, res, next) => {
//   console.error('\n❌ ========== UPLOAD ERROR ==========');
//   console.error('Error type:', error.constructor.name);
//   console.error('Error message:', error.message);
//   console.error('Error code:', error.code);
  
//   if (error.stack) {
//     console.error('Stack trace:', error.stack);
//   }

//   // Clean up any uploaded files on error
//   if (req.files) {
//     console.log('Cleaning up files due to error...');
//     cleanupFiles(req.files);
//   }
//   if (req.file) {
//     console.log('Cleaning up file due to error...');
//     cleanupFiles([req.file]);
//   }

//   // Handle Multer-specific errors
//   if (error instanceof multer.MulterError) {
//     const errorMessages = {
//       'LIMIT_FILE_SIZE': 'File too large. Maximum size is 10MB per file.',
//       'LIMIT_FILE_COUNT': 'Too many files. Maximum is 10 files per request.',
//       'LIMIT_FIELD_COUNT': 'Too many form fields. Please reduce the number of fields.',
//       'LIMIT_UNEXPECTED_FILE': 'Unexpected file field. Please check the form configuration.',
//       'LIMIT_PART_COUNT': 'Too many parts in the multipart request.',
//       'LIMIT_FIELD_KEY': 'Field name too long.',
//       'LIMIT_FIELD_VALUE': 'Field value too long (max 2MB).',
//     };

//     return res.status(400).json({
//       success: false,
//       message: errorMessages[error.code] || `Upload error: ${error.message}`,
//       error: {
//         type: 'MULTER_ERROR',
//         code: error.code,
//         field: error.field
//       }
//     });
//   }

//   // Handle custom validation errors
//   if (error.code === 'UNSUPPORTED_MIME_TYPE' || 
//       error.code === 'EXTENSION_MISMATCH' ||
//       error.code === 'SUSPICIOUS_FILENAME') {
//     return res.status(400).json({
//       success: false,
//       message: error.message,
//       error: {
//         type: 'FILE_VALIDATION_ERROR',
//         code: error.code
//       }
//     });
//   }

//   // Generic error
//   console.error('❌ Generic upload error:', error);
//   return res.status(500).json({
//     success: false,
//     message: error.message || 'File upload failed due to an internal error',
//     error: {
//       type: 'UPLOAD_ERROR'
//     }
//   });
// };

// // Enhanced file cleanup helper with verification
// function cleanupFiles(files) {
//   if (!files) {
//     console.log('No files to cleanup');
//     return;
//   }
  
//   const fileList = Array.isArray(files) ? files : Object.values(files).flat();
  
//   console.log(`\n🗑️  Cleaning up ${fileList.length} file(s)...`);
  
//   fileList.forEach((file, index) => {
//     if (file.path && fs.existsSync(file.path)) {
//       try {
//         fs.unlinkSync(file.path);
//         console.log(`   ${index + 1}. ✓ Deleted: ${path.basename(file.path)}`);
//       } catch (err) {
//         console.warn(`   ${index + 1}. ⚠️  Failed to delete ${path.basename(file.path)}:`, err.message);
//       }
//     } else {
//       console.log(`   ${index + 1}. ⚠️  File doesn't exist: ${file.path || 'No path'}`);
//     }
//   });
// }

// // Cleanup middleware for after response with improved timing
// const cleanupTempFiles = (req, res, next) => {
//   const originalEnd = res.end;
  
//   res.end = function(...args) {
//     // Call original end first
//     originalEnd.apply(this, args);
    
//     // Cleanup after response is sent (increased delay for stability)
//     if (req.files || req.file) {
//       setTimeout(() => {
//         console.log('\n🧹 Post-response cleanup initiated...');
//         if (req.files) cleanupFiles(req.files);
//         if (req.file) cleanupFiles([req.file]);
//         console.log('✓ Post-response cleanup completed\n');
//       }, 5000); // 5 seconds delay to ensure file operations complete
//     }
//   };
  
//   next();
// };

// // Enhanced validation middleware with detailed checks
// const validateFiles = async (req, res, next) => {
//   if (!req.files && !req.file) {
//     console.log('ℹ️  No files in request, skipping validation');
//     return next();
//   }

//   try {
//     const files = req.files 
//       ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
//       : [req.file];
    
//     console.log(`\n🔍 Validating ${files.length} uploaded file(s)...`);
    
//     for (let i = 0; i < files.length; i++) {
//       const file = files[i];
//       console.log(`\n   File ${i + 1}/${files.length}:`);
//       console.log(`   Name: ${file.originalname}`);
//       console.log(`   Path: ${file.path}`);
//       console.log(`   Size: ${(file.size / 1024).toFixed(2)} KB`);
      
//       // Verify file exists on disk
//       if (!fs.existsSync(file.path)) {
//         throw new Error(`File not found after upload: ${file.originalname}`);
//       }
//       console.log(`   ✓ File exists on disk`);
      
//       // Verify file size
//       const stats = fs.statSync(file.path);
//       if (stats.size === 0) {
//         throw new Error(`File is empty: ${file.originalname}`);
//       }
//       if (stats.size !== file.size) {
//         console.warn(`   ⚠️  Size mismatch: reported ${file.size}, actual ${stats.size}`);
//       }
//       console.log(`   ✓ File size verified: ${stats.size} bytes`);
      
//       // Verify file is readable
//       try {
//         fs.accessSync(file.path, fs.constants.R_OK);
//         console.log(`   ✓ File is readable`);
//       } catch (error) {
//         throw new Error(`File is not readable: ${file.originalname}`);
//       }
//     }
    
//     console.log(`\n✅ All ${files.length} file(s) validated successfully\n`);
//     next();
//   } catch (error) {
//     console.error('\n❌ File validation failed:', error.message);
    
//     // Cleanup on error
//     if (req.files) cleanupFiles(req.files);
//     if (req.file) cleanupFiles([req.file]);
    
//     res.status(400).json({
//       success: false,
//       message: error.message,
//       error: {
//         type: 'FILE_VALIDATION_ERROR'
//       }
//     });
//   }
// };


// module.exports = upload;
// module.exports.upload = upload;
// module.exports.handleMulterError = handleMulterError;
// module.exports.cleanupTempFiles = cleanupTempFiles;
// module.exports.validateFiles = validateFiles;
// module.exports.ensureUploadDirectories = ensureUploadDirectories;
// module.exports.cleanupFiles = cleanupFiles;








// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');

// // Ensure upload directories exist on startup
// const ensureUploadDirectories = () => {
//   const directories = [
//     path.join(__dirname, '../uploads'),
//     path.join(__dirname, '../uploads/temp'),
//     path.join(__dirname, '../uploads/attachments'),
//     path.join(__dirname, '../uploads/justifications')
//   ];

//   directories.forEach(dir => {
//     if (!fs.existsSync(dir)) {
//       console.log(`Creating directory: ${dir}`);
//       fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
//     }
//   });
// };

// // Call this immediately when module loads
// ensureUploadDirectories();

// // Simple and reliable storage configuration
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     const uploadDir = path.join(__dirname, '../uploads/temp');
    
//     // Ensure directory exists (double-check)
//     if (!fs.existsSync(uploadDir)) {
//       console.log(`Creating upload directory: ${uploadDir}`);
//       fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
//     }
    
//     cb(null, uploadDir);
//   },
//   filename: function (req, file, cb) {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     const ext = path.extname(file.originalname).toLowerCase();
//     const filename = file.fieldname + '-' + uniqueSuffix + ext;
    
//     console.log(`Saving file: ${filename}`);
//     cb(null, filename);
//   }
// });

// // File filter with comprehensive validation
// const fileFilter = (req, file, cb) => {
//   console.log('File filter check:', {
//     fieldname: file.fieldname,
//     originalname: file.originalname,
//     mimetype: file.mimetype
//   });

//   // Allowed file types
//   const allowedMimeTypes = {
//     // Images
//     'image/jpeg': ['.jpg', '.jpeg'],
//     'image/png': ['.png'],
//     'image/gif': ['.gif'],
//     'image/bmp': ['.bmp'],
//     'image/webp': ['.webp'],

//     // Documents
//     'application/pdf': ['.pdf'],
//     'application/msword': ['.doc'],
//     'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
//     'application/vnd.ms-excel': ['.xls'],
//     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
//     'text/plain': ['.txt'],
//     'application/rtf': ['.rtf']
//   };

//   const fileExtension = path.extname(file.originalname).toLowerCase();
  
//   // Check if mimetype is allowed
//   if (!allowedMimeTypes[file.mimetype]) {
//     console.error(`Unsupported file type: ${file.mimetype}`);
//     const error = new Error(`Unsupported file type: ${file.mimetype}`);
//     error.code = 'UNSUPPORTED_MIME_TYPE';
//     return cb(error, false);
//   }

//   // Verify extension matches mimetype
//   const expectedExtensions = allowedMimeTypes[file.mimetype];
//   if (!expectedExtensions.includes(fileExtension)) {
//     console.error(`Extension mismatch: ${fileExtension} for ${file.mimetype}`);
//     const error = new Error(`File extension ${fileExtension} doesn't match content type ${file.mimetype}`);
//     error.code = 'EXTENSION_MISMATCH';
//     return cb(error, false);
//   }

//   // Check for suspicious patterns in filename
//   const suspiciousPatterns = [
//     /\.(exe|bat|cmd|scr|pif|com)$/i,
//     /\.(php|asp|aspx|jsp)$/i,
//     /\.\.\//, // Path traversal
//     /[<>"|*?]/,
//     /%[0-9a-fA-F]{2}/, // URL encoded
//   ];
  
//   if (suspiciousPatterns.some(pattern => pattern.test(file.originalname))) {
//     console.error(`Suspicious filename: ${file.originalname}`);
//     const error = new Error('Filename contains suspicious patterns');
//     error.code = 'SUSPICIOUS_FILENAME';
//     return cb(error, false);
//   }

//   console.log('File passed validation');
//   cb(null, true);
// };

// // Create multer instance
// const upload = multer({
//   storage: storage,
//   fileFilter: fileFilter,
//   limits: { 
//     fileSize: 25 * 1024 * 1024,    // 25MB max per file
//     files: 10,                      // Max 10 files
//     fields: 20,                     // Max 20 fields
//     fieldNameSize: 100,             // Max field name length
//     fieldSize: 1024 * 1024,         // 1MB max field size
//   }
// });

// // Enhanced error handling middleware
// const handleMulterError = (error, req, res, next) => {
//   console.error('Upload error:', error);

//   // Clean up any uploaded files on error
//   if (req.files) {
//     cleanupFiles(req.files);
//   }
//   if (req.file) {
//     cleanupFiles([req.file]);
//   }

//   if (error instanceof multer.MulterError) {
//     const errorMessages = {
//       'LIMIT_FILE_SIZE': 'File too large. Maximum size is 25MB per file.',
//       'LIMIT_FILE_COUNT': 'Too many files. Maximum is 10 files per request.',
//       'LIMIT_FIELD_COUNT': 'Too many form fields.',
//       'LIMIT_UNEXPECTED_FILE': 'Unexpected file field.',
//     };

//     return res.status(400).json({
//       success: false,
//       message: errorMessages[error.code] || `Upload error: ${error.message}`,
//       error: {
//         type: 'MULTER_ERROR',
//         code: error.code
//       }
//     });
//   }

//   // Custom error codes
//   if (error.code === 'UNSUPPORTED_MIME_TYPE' || 
//       error.code === 'EXTENSION_MISMATCH' ||
//       error.code === 'SUSPICIOUS_FILENAME') {
//     return res.status(400).json({
//       success: false,
//       message: error.message,
//       error: {
//         type: 'FILE_VALIDATION_ERROR',
//         code: error.code
//       }
//     });
//   }

//   // Generic error
//   return res.status(500).json({
//     success: false,
//     message: error.message || 'File upload failed',
//     error: {
//       type: 'UPLOAD_ERROR'
//     }
//   });
// };

// // Clean up files helper
// function cleanupFiles(files) {
//   if (!files) return;
  
//   const fileList = Array.isArray(files) ? files : Object.values(files).flat();
  
//   fileList.forEach(file => {
//     if (file.path && fs.existsSync(file.path)) {
//       fs.unlink(file.path, (err) => {
//         if (err) {
//           console.warn('Failed to cleanup file:', file.path, err.message);
//         } else {
//           console.log('Cleaned up file:', file.path);
//         }
//       });
//     }
//   });
// }

// // Cleanup middleware for after response
// const cleanupTempFiles = (req, res, next) => {
//   const originalEnd = res.end;
  
//   res.end = function(...args) {
//     // Call original end first
//     originalEnd.apply(this, args);
    
//     // Then cleanup after a short delay
//     if (req.files || req.file) {
//       setTimeout(() => {
//         if (req.files) cleanupFiles(req.files);
//         if (req.file) cleanupFiles([req.file]);
//       }, 2000);
//     }
//   };
  
//   next();
// };

// // Validation middleware (runs after multer)
// const validateFiles = async (req, res, next) => {
//   if (!req.files && !req.file) {
//     return next();
//   }

//   try {
//     const files = req.files 
//       ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
//       : [req.file];
    
//     console.log(`Validating ${files.length} file(s)`);
    
//     for (const file of files) {
//       // Additional validation can be added here
//       if (!fs.existsSync(file.path)) {
//         throw new Error(`File not found after upload: ${file.originalname}`);
//       }
      
//       const stats = fs.statSync(file.path);
//       console.log(`File ${file.originalname}: ${stats.size} bytes`);
      
//       // Verify file size
//       if (stats.size === 0) {
//         throw new Error(`File is empty: ${file.originalname}`);
//       }
      
//       if (stats.size > 25 * 1024 * 1024) {
//         throw new Error(`File too large: ${file.originalname}`);
//       }
//     }
    
//     console.log('All files validated successfully');
//     next();
//   } catch (error) {
//     console.error('File validation error:', error);
    
//     // Cleanup on error
//     if (req.files) cleanupFiles(req.files);
//     if (req.file) cleanupFiles([req.file]);
    
//     res.status(400).json({
//       success: false,
//       message: error.message,
//       error: {
//         type: 'FILE_VALIDATION_ERROR'
//       }
//     });
//   }
// };

// module.exports = upload;
// module.exports.handleMulterError = handleMulterError;
// module.exports.cleanupTempFiles = cleanupTempFiles;
// module.exports.validateFiles = validateFiles;
// module.exports.ensureUploadDirectories = ensureUploadDirectories; 




