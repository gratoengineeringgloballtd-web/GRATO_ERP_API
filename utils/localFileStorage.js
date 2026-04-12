const fs = require('fs').promises;
const path = require('path');
const fsSync = require('fs');

/**
 * Enhanced Local File Storage Service
 * With proper receipt image handling for reimbursements
 */

// Base upload directory
const BASE_UPLOAD_DIR = path.join(__dirname, '../uploads');

// Storage categories
const STORAGE_CATEGORIES = {
  CASH_REQUESTS: 'cash-requests',
  JUSTIFICATIONS: 'justifications',
  REIMBURSEMENTS: 'reimbursements',  
  SUPPLIER_INVOICES: 'supplier-invoices',
  EMPLOYEE_INVOICES: 'employee-invoices',
  SUPPLIER_DOCUMENTS: 'supplier-documents',
  SUPPLIER_ONBOARDING: 'supplier-onboarding',
  CUSTOMER_ONBOARDING: 'customer-onboarding',
  PURCHASE_REQUISITIONS: 'purchase-requisitions',
  CONTRACTS: 'contracts',
  SIGNED_DOCUMENTS: 'signed-documents',
  ACTION_ITEMS: 'action-items',
  IT_SUPPORT: 'it-support',
  SALARY_PAYMENTS: 'salary-payments'
};

/**
 * Initialize storage directories
 */
const initializeStorageDirectories = async () => {
  const directories = [
    BASE_UPLOAD_DIR,
    
    // Cash Requests
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.CASH_REQUESTS, 'attachments'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.CASH_REQUESTS, 'receipts'),
    
    // Justifications
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.JUSTIFICATIONS),
    
    // ✅ Reimbursements (receipt images)
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.REIMBURSEMENTS),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.REIMBURSEMENTS, 'receipts'),
    
    // Supplier Management
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SUPPLIER_INVOICES, 'invoices'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SUPPLIER_INVOICES, 'po-files'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SUPPLIER_INVOICES, 'signed-documents'),
    
    // Purchase Requisitions
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.PURCHASE_REQUISITIONS, 'attachments'),
    
    // Employee Invoices
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.EMPLOYEE_INVOICES),
    
    // Supplier Documents
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SUPPLIER_DOCUMENTS),
    
    // Onboarding
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SUPPLIER_ONBOARDING),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.CUSTOMER_ONBOARDING),
    
    // Contracts
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.CONTRACTS),
    
    // Signed Documents
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SIGNED_DOCUMENTS, 'supply-chain'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SIGNED_DOCUMENTS, 'level-1'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SIGNED_DOCUMENTS, 'level-2'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SIGNED_DOCUMENTS, 'level-3'),

    // Action Items
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.ACTION_ITEMS, 'completion-docs'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.ACTION_ITEMS, 'attachments'),

    // IT Support
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.IT_SUPPORT, 'attachments'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.IT_SUPPORT, 'receipts'),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.IT_SUPPORT, 'work-logs'),

    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SALARY_PAYMENTS),
    path.join(BASE_UPLOAD_DIR, STORAGE_CATEGORIES.SALARY_PAYMENTS, 'documents'),
    
    // Temp
    path.join(BASE_UPLOAD_DIR, 'temp')
  ];

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o755 });
      console.log(`✓ Directory ready: ${dir}`);
    } catch (error) {
      console.error(`❌ Failed to create directory ${dir}:`, error);
      throw error;
    }
  }
};

/**
 * Generate unique filename
 */
const generateUniqueFilename = (originalName, prefix = '') => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 50);
  
  return `${prefix}${prefix ? '_' : ''}${baseName}-${timestamp}-${randomString}${ext}`;
};

/**
 * ✅ ENHANCED: Save file with better error handling and validation
 */
const saveFile = async (file, category = 'general', subfolder = '', customFilename = null) => {
  try {
    // Get base directory
    // const uploadsBase = path.resolve(process.cwd(), 'uploads');

    const uploadsBase = process.env.UPLOADS_PATH || path.resolve(process.cwd(), 'uploads');
    
    // Build category path
    const categoryDir = subfolder 
      ? path.join(uploadsBase, category, subfolder)
      : path.join(uploadsBase, category);
    
    // Ensure directory exists
    await fs.mkdir(categoryDir, { recursive: true, mode: 0o755 });
    
    // Generate filename
    const uniqueFilename = customFilename || generateUniqueFilename(file.originalname);
    
    // Build ABSOLUTE path for file storage
    const filePath = path.join(categoryDir, uniqueFilename);
    
    console.log('💾 Saving file:');
    console.log('   Category:', category);
    console.log('   Subfolder:', subfolder || 'none');
    console.log('   Original name:', file.originalname);
    console.log('   Unique name:', uniqueFilename);
    console.log('   Directory:', categoryDir);
    console.log('   Full path:', filePath);
    
    // ✅ VALIDATE FILE SIZE (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    const fileSize = file.size || file.buffer?.length || 0;
    
    if (fileSize > maxSize) {
      throw new Error(`File size (${(fileSize / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed size (10 MB)`);
    }
    
    // ✅ VALIDATE FILE TYPE (for images)
    if (category === STORAGE_CATEGORIES.REIMBURSEMENTS) {
      const allowedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf'
      ];
      
      if (!allowedTypes.includes(file.mimetype)) {
        throw new Error(`Invalid file type for receipts: ${file.mimetype}. Allowed: PDF, JPG, PNG, GIF, WEBP`);
      }
      
      console.log('   ✅ Receipt file type validated:', file.mimetype);
    }
    
    // Save file
    if (file.buffer) {
      // Multer memoryStorage
      await fs.writeFile(filePath, file.buffer);
      console.log('   💾 Saved from buffer');
    } else if (file.path) {
      // Multer diskStorage - copy from temp
      await fs.copyFile(file.path, filePath);
      console.log('   💾 Copied from temp path');
      
      // ✅ DELETE TEMP FILE
      try {
        await fs.unlink(file.path);
        console.log('   🗑️  Temp file deleted');
      } catch (cleanupError) {
        console.warn('   ⚠️  Could not delete temp file:', cleanupError.message);
      }
    } else {
      throw new Error('No file buffer or path provided');
    }
    
    // Verify file was saved
    const exists = fsSync.existsSync(filePath);
    if (!exists) {
      throw new Error('File was not saved successfully');
    }
    
    // Get file stats
    const stats = await fs.stat(filePath);
    
    // Generate relative path for URL
    const relativePath = path.relative(uploadsBase, filePath).replace(/\\/g, '/');
    const fileUrl = `/uploads/${relativePath}`;
    
    console.log('   ✅ File saved successfully');
    console.log('   ✅ Size:', (stats.size / 1024).toFixed(2), 'KB');
    console.log('   ✅ URL:', fileUrl);
    
    // ✅ RETURN COMPREHENSIVE METADATA
    return {
      publicId: uniqueFilename,
      url: fileUrl,
      localPath: filePath, // Absolute path
      relativePath: relativePath, // Relative to uploads/
      originalName: file.originalname,
      format: path.extname(file.originalname).substring(1),
      resourceType: file.mimetype.startsWith('image/') ? 'image' : 'raw',
      bytes: stats.size,
      mimetype: file.mimetype,
      category: category,
      subfolder: subfolder || null,
      uploadedAt: new Date()
    };
  } catch (error) {
    console.error('❌ Error saving file:', error);
    throw new Error(`Failed to save file: ${error.message}`);
  }
};

/**
 * ✅ ENHANCED: Delete file with better error handling
 */
const deleteFile = async (fileMetadata) => {
  try {
    if (!fileMetadata) {
      console.warn('⚠️  No file metadata provided for deletion');
      return { success: false, error: 'No metadata' };
    }
    
    // Try to get path from various possible properties
    const filePath = fileMetadata.localPath || fileMetadata.path || fileMetadata.url;
    
    if (!filePath) {
      console.warn('⚠️  No file path found in metadata');
      return { success: false, error: 'No path' };
    }
    
    // If URL, convert to absolute path
    let absolutePath = filePath;
    if (filePath.startsWith('/uploads/')) {
      absolutePath = path.join(process.cwd(), filePath);
    }
    
    console.log('🗑️  Attempting to delete:', absolutePath);
    
    // Check if file exists
    if (fsSync.existsSync(absolutePath)) {
      await fs.unlink(absolutePath);
      console.log(`✅ Deleted file: ${path.basename(absolutePath)}`);
      return { success: true };
    } else {
      console.warn(`⚠️  File not found: ${absolutePath}`);
      return { success: false, error: 'File not found' };
    }
  } catch (error) {
    console.error(`❌ Failed to delete file:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete multiple files
 */
const deleteFiles = async (fileMetadataArray) => {
  if (!Array.isArray(fileMetadataArray)) {
    return { success: false, error: 'Input must be an array' };
  }
  
  const results = [];
  for (const metadata of fileMetadataArray) {
    const result = await deleteFile(metadata);
    results.push({ 
      ...result, 
      file: metadata.originalName || metadata.name || metadata.publicId 
    });
  }
  
  return {
    success: results.every(r => r.success),
    results,
    deletedCount: results.filter(r => r.success).length,
    failedCount: results.filter(r => !r.success).length
  };
};

/**
 * ✅ NEW: Get file info
 */
const getFileInfo = async (fileMetadata) => {
  try {
    const filePath = fileMetadata.localPath || fileMetadata.path;
    
    if (!filePath || !fsSync.existsSync(filePath)) {
      return { exists: false, error: 'File not found' };
    }
    
    const stats = await fs.stat(filePath);
    
    return {
      exists: true,
      path: filePath,
      size: stats.size,
      sizeKB: (stats.size / 1024).toFixed(2),
      sizeMB: (stats.size / 1024 / 1024).toFixed(2),
      created: stats.birthtime,
      modified: stats.mtime,
      isImage: fileMetadata.mimetype?.startsWith('image/') || false,
      isPDF: fileMetadata.mimetype === 'application/pdf' || false
    };
  } catch (error) {
    return { exists: false, error: error.message };
  }
};

/**
 * ✅ NEW: Validate receipt images
 */
const validateReceiptImages = (files) => {
  const errors = [];
  const warnings = [];
  
  if (!files || files.length === 0) {
    errors.push('No receipt images provided');
    return { valid: false, errors, warnings };
  }
  
  if (files.length > 10) {
    errors.push(`Too many files (${files.length}/10 maximum)`);
  }
  
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf'
  ];
  
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  files.forEach((file, index) => {
    const fileNum = index + 1;
    
    // Check type
    if (!allowedTypes.includes(file.mimetype)) {
      errors.push(`File ${fileNum} (${file.originalname}): Invalid type ${file.mimetype}`);
    }
    
    // Check size
    const fileSize = file.size || file.buffer?.length || 0;
    if (fileSize > maxSize) {
      errors.push(`File ${fileNum} (${file.originalname}): Too large (${(fileSize / 1024 / 1024).toFixed(2)} MB / 10 MB max)`);
    }
    
    // Check if image is too small (likely corrupt)
    if (file.mimetype.startsWith('image/') && fileSize < 1024) {
      warnings.push(`File ${fileNum} (${file.originalname}): Very small file size, may be corrupt`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fileCount: files.length
  };
};

/**
 * Get storage statistics
 */
const getStorageStats = async () => {
  try {
    const stats = {};
    
    for (const [key, category] of Object.entries(STORAGE_CATEGORIES)) {
      const categoryPath = path.join(BASE_UPLOAD_DIR, category);
      
      if (fsSync.existsSync(categoryPath)) {
        const files = await fs.readdir(categoryPath, { recursive: true });
        let totalSize = 0;
        let fileCount = 0;
        
        for (const file of files) {
          const filePath = path.join(categoryPath, file);
          try {
            const stat = await fs.stat(filePath);
            if (stat.isFile()) {
              totalSize += stat.size;
              fileCount++;
            }
          } catch (err) {
            continue;
          }
        }
        
        stats[key] = {
          path: categoryPath,
          fileCount,
          totalSize,
          totalSizeKB: (totalSize / 1024).toFixed(2),
          totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
        };
      } else {
        stats[key] = { 
          path: categoryPath, 
          fileCount: 0, 
          totalSize: 0,
          totalSizeKB: '0',
          totalSizeMB: '0'
        };
      }
    }
    
    // Calculate totals
    const totals = Object.values(stats).reduce((acc, cat) => ({
      totalFiles: acc.totalFiles + cat.fileCount,
      totalSize: acc.totalSize + cat.totalSize
    }), { totalFiles: 0, totalSize: 0 });
    
    stats.TOTALS = {
      totalFiles: totals.totalFiles,
      totalSize: totals.totalSize,
      totalSizeKB: (totals.totalSize / 1024).toFixed(2),
      totalSizeMB: (totals.totalSize / (1024 * 1024)).toFixed(2),
      totalSizeGB: (totals.totalSize / (1024 * 1024 * 1024)).toFixed(2)
    };
    
    return stats;
  } catch (error) {
    console.error('Failed to get storage stats:', error);
    throw error;
  }
};

/**
 * Recursively search for a file by name
 */
const findFileRecursively = (directory, filename) => {
  if (!fsSync.existsSync(directory)) return null;
  
  try {
    const files = fsSync.readdirSync(directory, { withFileTypes: true });
    
    for (const file of files) {
      const fullPath = path.join(directory, file.name);
      
      if (file.isDirectory()) {
        const found = findFileRecursively(fullPath, filename);
        if (found) return found;
      } else if (file.name === filename) {
        return fullPath;
      }
    }
  } catch (error) {
    console.error(`Error searching ${directory}:`, error.message);
  }
  
  return null;
};

/**
 * Clean up old temporary files
 */
const cleanupOldTempFiles = async (maxAgeHours = 24) => {
  try {
    const tempDir = path.join(BASE_UPLOAD_DIR, 'temp');
    
    if (!fsSync.existsSync(tempDir)) {
      return { success: true, deletedCount: 0 };
    }
    
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      try {
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;
        
        if (age > maxAge) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      } catch (err) {
        console.warn(`⚠️  Failed to process temp file ${file}:`, err.message);
      }
    }
    
    console.log(`🧹 Cleanup complete: ${deletedCount} old temp files deleted`);
    return { success: true, deletedCount };
  } catch (error) {
    console.error('Failed to cleanup temp files:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  // Core functions
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
  BASE_UPLOAD_DIR,
  STORAGE_CATEGORIES
};



