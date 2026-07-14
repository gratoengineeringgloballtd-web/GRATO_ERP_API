/**
 * cloudinaryStorage.js
 * Drop-in replacement for localFileStorage.js
 * Place at: utils/cloudinaryStorage.js
 */

const cloudinary  = require('cloudinary').v2;
const streamifier = require('streamifier');
const path        = require('path');
const fs          = require('fs');

// ─── Lazy config ──────────────────────────────────────────────────────────────
// Called right before each upload instead of at module load time.
// This ensures process.env vars are available even if dotenv loads after require().
// const ensureCloudinaryConfig = () => {
//   const current = cloudinary.config();
//   if (current.api_key) return; // already configured

//   if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
//     throw new Error(
//       'Cloudinary credentials missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in your environment.'
//     );
//   }

//   cloudinary.config({
//     cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//     api_key:    process.env.CLOUDINARY_API_KEY,
//     api_secret: process.env.CLOUDINARY_API_SECRET,
//     secure:     true
//   });
// };

const ensureCloudinaryConfig = () => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error(
      'Cloudinary credentials missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in your environment.'
    );
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key:    process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
    secure:     true
  });
};

// ─── Storage categories ───────────────────────────────────────────────────────
const STORAGE_CATEGORIES = {
  CASH_REQUESTS:         'cash-requests',
  JUSTIFICATIONS:        'justifications',
  REIMBURSEMENTS:        'reimbursements',
  SUPPLIER_INVOICES:     'supplier-invoices',
  EMPLOYEE_INVOICES:     'employee-invoices',
  SUPPLIER_DOCUMENTS:    'supplier-documents',
  SUPPLIER_ONBOARDING:   'supplier-onboarding',
  CUSTOMER_ONBOARDING:   'customer-onboarding',
  PURCHASE_REQUISITIONS: 'purchase-requisitions',
  CONTRACTS:             'contracts',
  SIGNED_DOCUMENTS:      'signed-documents',
  ACTION_ITEMS:          'action-items',
  IT_SUPPORT:            'it-support',
  SALARY_PAYMENTS:       'salary-payments',
  USER_SIGNATURES:       'user-signatures'
};

const CLOUDINARY_ROOT = process.env.CLOUDINARY_ROOT_FOLDER || 'grato-erp';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getResourceType = (mimetype = '') => {
  if (mimetype.startsWith('image/')) return 'image';
  return 'raw';
};

const generatePublicId = (originalName, category, subfolder) => {
  const timestamp = Date.now();
  const random    = Math.random().toString(36).substring(2, 8);
  const baseName  = path.basename(originalName, path.extname(originalName))
                      .replace(/[^a-zA-Z0-9]/g, '_')
                      .substring(0, 50);
  const folder    = subfolder
    ? `${CLOUDINARY_ROOT}/${category}/${subfolder}`
    : `${CLOUDINARY_ROOT}/${category}`;
  return { folder, publicId: `${baseName}-${timestamp}-${random}` };
};

const uploadToCloudinary = (source, options) => {
  ensureCloudinaryConfig(); // ← lazy — runs right before every upload

  return new Promise((resolve, reject) => {
    const uploadOptions = { ...options, use_filename: false, unique_filename: false, overwrite: false, access_mode: 'public' };

    if (Buffer.isBuffer(source)) {
      const stream = cloudinary.uploader.upload_stream(uploadOptions, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
      streamifier.createReadStream(source).pipe(stream);
    } else if (typeof source === 'string' && fs.existsSync(source)) {
      cloudinary.uploader.upload(source, uploadOptions, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    } else {
      reject(new Error('No valid buffer or file path provided for upload'));
    }
  });
};

// ─── saveFile ─────────────────────────────────────────────────────────────────
const saveFile = async (file, category = 'general', subfolder = '', customFilename = null) => {
  try {
    console.log('☁️  Cloudinary upload starting:');
    console.log('   Category:', category);
    console.log('   Subfolder:', subfolder || 'none');
    console.log('   Original name:', file.originalname);
    console.log('   MIME type:', file.mimetype);

    const fileSize = file.size || file.buffer?.length || 0;
    if (fileSize > 10 * 1024 * 1024) {
      throw new Error(`File size (${(fileSize / 1024 / 1024).toFixed(2)} MB) exceeds 10 MB limit`);
    }

    if (category === STORAGE_CATEGORIES.REIMBURSEMENTS) {
      const allowed = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','application/pdf'];
      if (!allowed.includes(file.mimetype)) {
        throw new Error(`Invalid file type for receipts: ${file.mimetype}`);
      }
    }

    const { folder, publicId: basePublicId } = generatePublicId(
      customFilename || file.originalname, category, subfolder
    );

    const resourceType       = getResourceType(file.mimetype);
    const ext                = path.extname(file.originalname).toLowerCase();
    const cloudinaryPublicId = resourceType === 'raw' ? `${basePublicId}${ext}` : basePublicId;

    const uploadOptions = { folder, public_id: cloudinaryPublicId, resource_type: resourceType };

    console.log('   Uploading to:', `${folder}/${cloudinaryPublicId}`);
    const result = await uploadToCloudinary(file.buffer || file.path, uploadOptions);

    if (file.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch (_) {}
    }

    console.log('   ✅ Uploaded successfully');
    console.log('   ✅ URL:', result.secure_url);

    return {
      publicId:     result.public_id,
      url:          result.secure_url,
      localPath:    result.secure_url,
      relativePath: result.public_id,
      originalName: file.originalname,
      format:       result.format || ext.substring(1),
      resourceType: result.resource_type,
      bytes:        result.bytes,
      mimetype:     file.mimetype,
      category,
      subfolder:    subfolder || null,
      uploadedAt:   new Date(),
      cloudinaryId: result.public_id,
      width:        result.width  || null,
      height:       result.height || null,
    };
  } catch (error) {
    console.error('❌ Cloudinary upload failed:', error.message);
    throw new Error(`Failed to save file: ${error.message}`);
  }
};

// ─── deleteFile ───────────────────────────────────────────────────────────────
const deleteFile = async (fileMetadata) => {
  try {
    if (!fileMetadata) return { success: false, error: 'No metadata' };
    ensureCloudinaryConfig();

    let publicId = fileMetadata.cloudinaryId || fileMetadata.publicId;
    if (!publicId && fileMetadata.url) {
      const match = fileMetadata.url.match(/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
      if (match) publicId = match[1];
    }
    if (!publicId) return { success: false, error: 'No public_id' };

    const resourceType = fileMetadata.resourceType ||
      (fileMetadata.mimetype?.startsWith('image/') ? 'image' : 'raw');

    console.log('🗑️  Deleting from Cloudinary:', publicId);
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

    if (result.result === 'ok' || result.result === 'not found') {
      console.log('✅ Deleted from Cloudinary:', publicId);
      return { success: true };
    }
    return { success: false, error: result.result };
  } catch (error) {
    console.error('❌ Cloudinary deletion failed:', error.message);
    return { success: false, error: error.message };
  }
};

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

const getFileInfo = async (fileMetadata) => {
  try {
    ensureCloudinaryConfig();
    const publicId     = fileMetadata.cloudinaryId || fileMetadata.publicId;
    const resourceType = fileMetadata.resourceType ||
      (fileMetadata.mimetype?.startsWith('image/') ? 'image' : 'raw');
    if (!publicId) return { exists: false, error: 'No public_id' };
    const result = await cloudinary.api.resource(publicId, { resource_type: resourceType });
    return {
      exists:  true,
      url:     result.secure_url,
      publicId:result.public_id,
      size:    result.bytes,
      sizeKB:  (result.bytes / 1024).toFixed(2),
      sizeMB:  (result.bytes / 1024 / 1024).toFixed(2),
      format:  result.format,
      created: result.created_at,
      isImage: result.resource_type === 'image',
      isPDF:   result.format === 'pdf'
    };
  } catch (error) {
    if (error.http_code === 404) return { exists: false, error: 'Not found on Cloudinary' };
    return { exists: false, error: error.message };
  }
};

const validateReceiptImages = (files) => {
  const errors = [], warnings = [];
  if (!files || files.length === 0) { errors.push('No receipt images provided'); return { valid: false, errors, warnings }; }
  if (files.length > 10) errors.push(`Too many files (${files.length}/10 maximum)`);
  const allowedTypes = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','application/pdf'];
  const maxSize = 10 * 1024 * 1024;
  files.forEach((file, index) => {
    const fileNum  = index + 1;
    const fileSize = file.size || file.buffer?.length || 0;
    if (!allowedTypes.includes(file.mimetype)) errors.push(`File ${fileNum} (${file.originalname}): Invalid type ${file.mimetype}`);
    if (fileSize > maxSize) errors.push(`File ${fileNum} (${file.originalname}): Too large`);
    if (file.mimetype.startsWith('image/') && fileSize < 1024) warnings.push(`File ${fileNum} (${file.originalname}): Very small, may be corrupt`);
  });
  return { valid: errors.length === 0, errors, warnings, fileCount: files.length };
};

const generateUniqueFilename = (originalName, prefix = '') => {
  const timestamp    = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const ext          = path.extname(originalName);
  const baseName     = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  return `${prefix}${prefix ? '_' : ''}${baseName}-${timestamp}-${randomString}${ext}`;
};

const initializeStorageDirectories = async () => console.log('☁️  Cloudinary storage active — no local directories needed');
const getStorageStats = async () => { ensureCloudinaryConfig(); const usage = await cloudinary.api.usage(); return { TOTALS: { totalFiles: usage.resources, totalSize: usage.storage.usage } }; };
const findFileRecursively = () => null;
const cleanupOldTempFiles = async () => ({ success: true, deletedCount: 0 });

module.exports = {
  saveFile, deleteFile, deleteFiles, getFileInfo, findFileRecursively,
  validateReceiptImages, initializeStorageDirectories, generateUniqueFilename,
  getStorageStats, cleanupOldTempFiles,
  BASE_UPLOAD_DIR: '/var/data/uploads',
  STORAGE_CATEGORIES,
  cloudinary,
};












// /**
//  * cloudinaryStorage.js
//  * Drop-in replacement for localFileStorage.js
//  *
//  * Place at: utils/cloudinaryStorage.js
//  *
//  * All functions maintain the same return shape as localFileStorage.js so
//  * nothing else in the codebase needs to change except the require() path.
//  *
//  * Required env vars (add to Render environment):
//  *   CLOUDINARY_CLOUD_NAME=your_cloud_name
//  *   CLOUDINARY_API_KEY=your_api_key
//  *   CLOUDINARY_API_SECRET=your_api_secret
//  */

// const cloudinary = require('cloudinary').v2;
// const streamifier = require('streamifier');
// const path        = require('path');
// const fs          = require('fs');

// // ─── Configure Cloudinary ─────────────────────────────────────────────────────
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key:    process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
//   secure:     true
// });

// // ─── Storage category → Cloudinary folder mapping ────────────────────────────
// const STORAGE_CATEGORIES = {
//   CASH_REQUESTS:        'cash-requests',
//   JUSTIFICATIONS:       'justifications',
//   REIMBURSEMENTS:       'reimbursements',
//   SUPPLIER_INVOICES:    'supplier-invoices',
//   EMPLOYEE_INVOICES:    'employee-invoices',
//   SUPPLIER_DOCUMENTS:   'supplier-documents',
//   SUPPLIER_ONBOARDING:  'supplier-onboarding',
//   CUSTOMER_ONBOARDING:  'customer-onboarding',
//   PURCHASE_REQUISITIONS:'purchase-requisitions',
//   CONTRACTS:            'contracts',
//   SIGNED_DOCUMENTS:     'signed-documents',
//   ACTION_ITEMS:         'action-items',
//   IT_SUPPORT:           'it-support',
//   SALARY_PAYMENTS:      'salary-payments',
//   USER_SIGNATURES:      'user-signatures'
// };

// // Root Cloudinary folder — keeps all ERP files organised under one namespace
// const CLOUDINARY_ROOT = process.env.CLOUDINARY_ROOT_FOLDER || 'grato-erp';

// // ─── Helpers ──────────────────────────────────────────────────────────────────

// /**
//  * Determine Cloudinary resource_type from mimetype
//  */
// const getResourceType = (mimetype = '') => {
//   if (mimetype.startsWith('image/')) return 'image';
//   if (mimetype === 'application/pdf')  return 'raw';   // PDFs must be 'raw'
//   return 'raw';
// };

// /**
//  * Generate a clean public_id for Cloudinary (no extension)
//  */
// const generatePublicId = (originalName, category, subfolder) => {
//   const timestamp  = Date.now();
//   const random     = Math.random().toString(36).substring(2, 8);
//   const baseName   = path.basename(originalName, path.extname(originalName))
//                        .replace(/[^a-zA-Z0-9]/g, '_')
//                        .substring(0, 50);

//   const folder = subfolder
//     ? `${CLOUDINARY_ROOT}/${category}/${subfolder}`
//     : `${CLOUDINARY_ROOT}/${category}`;

//   return { folder, publicId: `${baseName}-${timestamp}-${random}` };
// };

// /**
//  * Upload a buffer or file path to Cloudinary
//  * Returns a Promise that resolves with the Cloudinary upload result
//  */
// const uploadToCloudinary = (source, options) => {
//   return new Promise((resolve, reject) => {
//     const uploadOptions = {
//       ...options,
//       use_filename:      false,
//       unique_filename:   false,
//       overwrite:         false,
//     };

//     if (Buffer.isBuffer(source)) {
//       // Upload from buffer via stream
//       const stream = cloudinary.uploader.upload_stream(uploadOptions, (err, result) => {
//         if (err) return reject(err);
//         resolve(result);
//       });
//       streamifier.createReadStream(source).pipe(stream);
//     } else if (typeof source === 'string' && fs.existsSync(source)) {
//       // Upload from local file path
//       cloudinary.uploader.upload(source, uploadOptions, (err, result) => {
//         if (err) return reject(err);
//         resolve(result);
//       });
//     } else {
//       reject(new Error('No valid buffer or file path provided for upload'));
//     }
//   });
// };

// // ─── Core API (same shape as localFileStorage.js) ────────────────────────────

// /**
//  * saveFile — uploads a multer file object to Cloudinary
//  *
//  * @param {object} file          - Multer file object (has .buffer or .path)
//  * @param {string} category      - STORAGE_CATEGORIES value
//  * @param {string} subfolder     - Optional subfolder within category
//  * @param {string} customFilename - Optional custom base name (extension stripped)
//  * @returns {object}             - Same metadata shape as localFileStorage.saveFile
//  */
// const saveFile = async (file, category = 'general', subfolder = '', customFilename = null) => {
//   try {
//     console.log('☁️  Cloudinary upload starting:');
//     console.log('   Category:', category);
//     console.log('   Subfolder:', subfolder || 'none');
//     console.log('   Original name:', file.originalname);
//     console.log('   MIME type:', file.mimetype);

//     // Validate size (10 MB)
//     const fileSize = file.size || file.buffer?.length || 0;
//     if (fileSize > 10 * 1024 * 1024) {
//       throw new Error(`File size (${(fileSize / 1024 / 1024).toFixed(2)} MB) exceeds 10 MB limit`);
//     }

//     // Validate receipt types
//     if (category === STORAGE_CATEGORIES.REIMBURSEMENTS) {
//       const allowed = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','application/pdf'];
//       if (!allowed.includes(file.mimetype)) {
//         throw new Error(`Invalid file type for receipts: ${file.mimetype}`);
//       }
//     }

//     // Build Cloudinary folder + public_id
//     const { folder, publicId: basePublicId } = generatePublicId(
//       customFilename || file.originalname,
//       category,
//       subfolder
//     );

//     const resourceType = getResourceType(file.mimetype);
//     const ext          = path.extname(file.originalname).toLowerCase();

//     // For 'raw' resources Cloudinary needs the extension in the public_id
//     const cloudinaryPublicId = resourceType === 'raw'
//       ? `${basePublicId}${ext}`
//       : basePublicId;

//     const uploadOptions = {
//       folder,
//       public_id:     cloudinaryPublicId,
//       resource_type: resourceType,
//     };

//     // Source: buffer (memoryStorage) or path (diskStorage)
//     const source = file.buffer || file.path;

//     console.log('   Uploading to:', `${folder}/${cloudinaryPublicId}`);
//     const result = await uploadToCloudinary(source, uploadOptions);

//     // Clean up local temp file if it came from diskStorage
//     if (file.path && fs.existsSync(file.path)) {
//       try { fs.unlinkSync(file.path); } catch (_) {}
//     }

//     console.log('   ✅ Uploaded successfully');
//     console.log('   ✅ URL:', result.secure_url);
//     console.log('   ✅ Public ID:', result.public_id);

//     // Return same shape as localFileStorage.saveFile
//     return {
//       publicId:     result.public_id,          // Full Cloudinary public_id (with folder)
//       url:          result.secure_url,          // HTTPS URL — use this everywhere
//       localPath:    result.secure_url,          // ← kept for backward compat with old code
//       relativePath: result.public_id,
//       originalName: file.originalname,
//       format:       result.format || ext.substring(1),
//       resourceType: result.resource_type,
//       bytes:        result.bytes,
//       mimetype:     file.mimetype,
//       category,
//       subfolder:    subfolder || null,
//       uploadedAt:   new Date(),
//       // Cloudinary extras
//       cloudinaryId: result.public_id,
//       width:        result.width  || null,
//       height:       result.height || null,
//     };
//   } catch (error) {
//     console.error('❌ Cloudinary upload failed:', error.message);
//     throw new Error(`Failed to save file: ${error.message}`);
//   }
// };

// /**
//  * deleteFile — deletes a file from Cloudinary
//  *
//  * @param {object} fileMetadata - Object with publicId / cloudinaryId / url
//  */
// const deleteFile = async (fileMetadata) => {
//   try {
//     if (!fileMetadata) return { success: false, error: 'No metadata' };

//     // Prefer cloudinaryId → publicId → extract from URL
//     let publicId = fileMetadata.cloudinaryId || fileMetadata.publicId;

//     if (!publicId && fileMetadata.url) {
//       // Extract public_id from Cloudinary URL
//       // e.g. https://res.cloudinary.com/cloud/image/upload/v123/grato-erp/folder/file.jpg
//       const match = fileMetadata.url.match(/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
//       if (match) publicId = match[1];
//     }

//     if (!publicId) {
//       console.warn('⚠️  Could not determine Cloudinary public_id for deletion');
//       return { success: false, error: 'No public_id' };
//     }

//     // Determine resource type from mimetype or url
//     const resourceType = fileMetadata.resourceType ||
//       (fileMetadata.mimetype?.startsWith('image/') ? 'image' : 'raw');

//     console.log('🗑️  Deleting from Cloudinary:', publicId);
//     const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

//     if (result.result === 'ok' || result.result === 'not found') {
//       console.log('✅ Deleted from Cloudinary:', publicId);
//       return { success: true };
//     }

//     console.warn('⚠️  Cloudinary deletion result:', result.result);
//     return { success: false, error: result.result };
//   } catch (error) {
//     console.error('❌ Cloudinary deletion failed:', error.message);
//     return { success: false, error: error.message };
//   }
// };

// /**
//  * deleteFiles — deletes multiple files
//  */
// const deleteFiles = async (fileMetadataArray) => {
//   if (!Array.isArray(fileMetadataArray)) return { success: false, error: 'Input must be an array' };

//   const results = [];
//   for (const metadata of fileMetadataArray) {
//     const result = await deleteFile(metadata);
//     results.push({ ...result, file: metadata.originalName || metadata.name || metadata.publicId });
//   }

//   return {
//     success:      results.every(r => r.success),
//     results,
//     deletedCount: results.filter(r => r.success).length,
//     failedCount:  results.filter(r => !r.success).length
//   };
// };

// /**
//  * getFileInfo — returns metadata about a stored file
//  * For Cloudinary files, queries the API for resource details
//  */
// const getFileInfo = async (fileMetadata) => {
//   try {
//     const publicId     = fileMetadata.cloudinaryId || fileMetadata.publicId;
//     const resourceType = fileMetadata.resourceType ||
//       (fileMetadata.mimetype?.startsWith('image/') ? 'image' : 'raw');

//     if (!publicId) return { exists: false, error: 'No public_id' };

//     const result = await cloudinary.api.resource(publicId, { resource_type: resourceType });

//     return {
//       exists:   true,
//       url:      result.secure_url,
//       publicId: result.public_id,
//       size:     result.bytes,
//       sizeKB:   (result.bytes / 1024).toFixed(2),
//       sizeMB:   (result.bytes / 1024 / 1024).toFixed(2),
//       format:   result.format,
//       created:  result.created_at,
//       isImage:  result.resource_type === 'image',
//       isPDF:    result.format === 'pdf'
//     };
//   } catch (error) {
//     // Cloudinary returns 404 for missing resources
//     if (error.http_code === 404) return { exists: false, error: 'Not found on Cloudinary' };
//     return { exists: false, error: error.message };
//   }
// };

// /**
//  * validateReceiptImages — unchanged validation logic (no I/O)
//  */
// const validateReceiptImages = (files) => {
//   const errors   = [];
//   const warnings = [];

//   if (!files || files.length === 0) {
//     errors.push('No receipt images provided');
//     return { valid: false, errors, warnings };
//   }

//   if (files.length > 10) errors.push(`Too many files (${files.length}/10 maximum)`);

//   const allowedTypes = [
//     'image/jpeg','image/jpg','image/png','image/gif','image/webp','application/pdf'
//   ];
//   const maxSize = 10 * 1024 * 1024;

//   files.forEach((file, index) => {
//     const fileNum  = index + 1;
//     const fileSize = file.size || file.buffer?.length || 0;

//     if (!allowedTypes.includes(file.mimetype))
//       errors.push(`File ${fileNum} (${file.originalname}): Invalid type ${file.mimetype}`);

//     if (fileSize > maxSize)
//       errors.push(`File ${fileNum} (${file.originalname}): Too large (${(fileSize/1024/1024).toFixed(2)} MB / 10 MB max)`);

//     if (file.mimetype.startsWith('image/') && fileSize < 1024)
//       warnings.push(`File ${fileNum} (${file.originalname}): Very small file, may be corrupt`);
//   });

//   return { valid: errors.length === 0, errors, warnings, fileCount: files.length };
// };

// /**
//  * generateUniqueFilename — kept for any code that still calls it
//  */
// const generateUniqueFilename = (originalName, prefix = '') => {
//   const timestamp    = Date.now();
//   const randomString = Math.random().toString(36).substring(2, 15);
//   const ext          = path.extname(originalName);
//   const baseName     = path.basename(originalName, ext)
//                          .replace(/[^a-zA-Z0-9]/g, '_')
//                          .substring(0, 50);
//   return `${prefix}${prefix ? '_' : ''}${baseName}-${timestamp}-${randomString}${ext}`;
// };

// /**
//  * initializeStorageDirectories — no-op for Cloudinary
//  * Kept so existing startup code doesn't break
//  */
// const initializeStorageDirectories = async () => {
//   console.log('☁️  Cloudinary storage active — no local directories needed');
// };

// /**
//  * getStorageStats — queries Cloudinary usage API
//  */
// const getStorageStats = async () => {
//   try {
//     const usage = await cloudinary.api.usage();
//     return {
//       TOTALS: {
//         totalFiles:  usage.resources,
//         totalSize:   usage.storage.usage,
//         totalSizeKB: (usage.storage.usage / 1024).toFixed(2),
//         totalSizeMB: (usage.storage.usage / 1024 / 1024).toFixed(2),
//         totalSizeGB: (usage.storage.usage / 1024 / 1024 / 1024).toFixed(4),
//       },
//       plan: {
//         storageLimit:    usage.storage.limit,
//         bandwidthUsed:   usage.bandwidth.usage,
//         bandwidthLimit:  usage.bandwidth.limit,
//         transformations: usage.transformations.usage,
//       }
//     };
//   } catch (error) {
//     console.error('Failed to get Cloudinary stats:', error.message);
//     throw error;
//   }
// };

// /**
//  * findFileRecursively — not applicable for Cloudinary
//  * Returns null to keep callers from crashing
//  */
// const findFileRecursively = () => null;

// /**
//  * cleanupOldTempFiles — no-op for Cloudinary
//  */
// const cleanupOldTempFiles = async () => ({
//   success: true, deletedCount: 0, message: 'No temp files in Cloudinary mode'
// });

// // ─── Exports (identical surface area to localFileStorage.js) ─────────────────
// module.exports = {
//   // Core
//   saveFile,
//   deleteFile,
//   deleteFiles,
//   getFileInfo,
//   findFileRecursively,

//   // Validation
//   validateReceiptImages,

//   // Utilities
//   initializeStorageDirectories,
//   generateUniqueFilename,
//   getStorageStats,
//   cleanupOldTempFiles,

//   // Constants
//   BASE_UPLOAD_DIR: '/var/data/uploads', // legacy compat — not used in Cloudinary mode
//   STORAGE_CATEGORIES,

//   // Cloudinary instance (for advanced use)
//   cloudinary,
// };