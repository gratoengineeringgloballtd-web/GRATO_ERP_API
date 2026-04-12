const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist on startup with proper error handling
const ensureUploadDirectories = () => {
  const directories = [
    path.join(__dirname, '../uploads'),
    path.join(__dirname, '../uploads/temp'),
    path.join(__dirname, '../uploads/attachments'),
    path.join(__dirname, '../uploads/justifications'),
    path.join(__dirname, '../uploads/reimbursements')
  ];

  directories.forEach(dir => {
    try {
      if (!fs.existsSync(dir)) {
        console.log(`📁 Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
        console.log(`✅ Directory created successfully: ${dir}`);
      } else {
        console.log(`✓ Directory exists: ${dir}`);
      }
      
      // Verify directory is writable
      fs.accessSync(dir, fs.constants.W_OK);
      console.log(`✓ Directory is writable: ${dir}`);
    } catch (error) {
      console.error(`❌ Failed to setup directory ${dir}:`, error.message);
      throw error;
    }
  });
};

// Call this immediately when module loads
try {
  ensureUploadDirectories();
} catch (error) {
  console.error('CRITICAL: Failed to initialize upload directories:', error);
  process.exit(1);
}

// Enhanced storage configuration with detailed logging
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/temp');
    
    console.log(`\n📤 Processing upload for field: ${file.fieldname}`);
    console.log(`   Original name: ${file.originalname}`);
    console.log(`   Destination: ${uploadDir}`);
    
    // Verify directory exists and is writable
    try {
      if (!fs.existsSync(uploadDir)) {
        console.log(`   Creating missing temp directory...`);
        fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
      }
      
      fs.accessSync(uploadDir, fs.constants.W_OK);
      console.log(`   ✓ Destination directory verified`);
      cb(null, uploadDir);
    } catch (error) {
      console.error(`   ❌ Destination directory error:`, error.message);
      cb(error);
    }
  },
  filename: function (req, file, cb) {
    try {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname).toLowerCase();
      const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${file.fieldname}-${uniqueSuffix}-${baseName}${ext}`;
      
      console.log(`   Generated filename: ${filename}`);
      cb(null, filename);
    } catch (error) {
      console.error(`   ❌ Filename generation error:`, error.message);
      cb(error);
    }
  }
});

// Enhanced file filter with comprehensive validation
const fileFilter = (req, file, cb) => {
  console.log(`\n🔍 Validating file: ${file.originalname}`);
  console.log(`   Field: ${file.fieldname}`);
  console.log(`   MIME type: ${file.mimetype}`);
  console.log(`   Size: ${file.size ? (file.size / 1024).toFixed(2) + ' KB' : 'Unknown'}`);

  // Allowed file types with extensions
  const allowedMimeTypes = {
    // Images
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/bmp': ['.bmp'],
    'image/webp': ['.webp'],

    // Documents
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'text/plain': ['.txt'],
    'application/rtf': ['.rtf']
  };

  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  // Check if mimetype is allowed
  if (!allowedMimeTypes[file.mimetype]) {
    console.error(`   ❌ Unsupported MIME type: ${file.mimetype}`);
    const error = new Error(`Unsupported file type: ${file.mimetype}. Allowed types: PDF, Word, Excel, Images`);
    error.code = 'UNSUPPORTED_MIME_TYPE';
    return cb(error, false);
  }

  // Verify extension matches mimetype
  const expectedExtensions = allowedMimeTypes[file.mimetype];
  if (!expectedExtensions.includes(fileExtension)) {
    console.error(`   ❌ Extension mismatch: ${fileExtension} for ${file.mimetype}`);
    const error = new Error(`File extension ${fileExtension} doesn't match content type ${file.mimetype}`);
    error.code = 'EXTENSION_MISMATCH';
    return cb(error, false);
  }

  // Check for suspicious patterns in filename
  const suspiciousPatterns = [
    /\.(exe|bat|cmd|scr|pif|com)$/i,
    /\.(php|asp|aspx|jsp)$/i,
    /\.\.\//, // Path traversal
    /[<>"|*?]/,
    /%[0-9a-fA-F]{2}/, // URL encoded
  ];
  
  if (suspiciousPatterns.some(pattern => pattern.test(file.originalname))) {
    console.error(`   ❌ Suspicious filename pattern detected: ${file.originalname}`);
    const error = new Error('Filename contains suspicious patterns and was rejected for security reasons');
    error.code = 'SUSPICIOUS_FILENAME';
    return cb(error, false);
  }

  console.log(`   ✅ File validation passed`);
  cb(null, true);
};

// Create multer instance with enhanced configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { 
    fileSize: 10 * 1024 * 1024,    // 10MB max per file (reduced from 25MB for stability)
    files: 10,                      // Max 10 files
    fields: 20,                     // Max 20 fields
    fieldNameSize: 100,             // Max field name length
    fieldSize: 2 * 1024 * 1024,     // 2MB max field size (for JSON data)
  }
});

// Enhanced error handling middleware with detailed logging
const handleMulterError = (error, req, res, next) => {
  console.error('\n❌ ========== UPLOAD ERROR ==========');
  console.error('Error type:', error.constructor.name);
  console.error('Error message:', error.message);
  console.error('Error code:', error.code);
  
  if (error.stack) {
    console.error('Stack trace:', error.stack);
  }

  // Clean up any uploaded files on error
  if (req.files) {
    console.log('Cleaning up files due to error...');
    cleanupFiles(req.files);
  }
  if (req.file) {
    console.log('Cleaning up file due to error...');
    cleanupFiles([req.file]);
  }

  // Handle Multer-specific errors
  if (error instanceof multer.MulterError) {
    const errorMessages = {
      'LIMIT_FILE_SIZE': 'File too large. Maximum size is 10MB per file.',
      'LIMIT_FILE_COUNT': 'Too many files. Maximum is 10 files per request.',
      'LIMIT_FIELD_COUNT': 'Too many form fields. Please reduce the number of fields.',
      'LIMIT_UNEXPECTED_FILE': 'Unexpected file field. Please check the form configuration.',
      'LIMIT_PART_COUNT': 'Too many parts in the multipart request.',
      'LIMIT_FIELD_KEY': 'Field name too long.',
      'LIMIT_FIELD_VALUE': 'Field value too long (max 2MB).',
    };

    return res.status(400).json({
      success: false,
      message: errorMessages[error.code] || `Upload error: ${error.message}`,
      error: {
        type: 'MULTER_ERROR',
        code: error.code,
        field: error.field
      }
    });
  }

  // Handle custom validation errors
  if (error.code === 'UNSUPPORTED_MIME_TYPE' || 
      error.code === 'EXTENSION_MISMATCH' ||
      error.code === 'SUSPICIOUS_FILENAME') {
    return res.status(400).json({
      success: false,
      message: error.message,
      error: {
        type: 'FILE_VALIDATION_ERROR',
        code: error.code
      }
    });
  }

  // Generic error
  console.error('❌ Generic upload error:', error);
  return res.status(500).json({
    success: false,
    message: error.message || 'File upload failed due to an internal error',
    error: {
      type: 'UPLOAD_ERROR'
    }
  });
};

// Enhanced file cleanup helper with verification
function cleanupFiles(files) {
  if (!files) {
    console.log('No files to cleanup');
    return;
  }
  
  const fileList = Array.isArray(files) ? files : Object.values(files).flat();
  
  console.log(`\n🗑️  Cleaning up ${fileList.length} file(s)...`);
  
  fileList.forEach((file, index) => {
    if (file.path && fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
        console.log(`   ${index + 1}. ✓ Deleted: ${path.basename(file.path)}`);
      } catch (err) {
        console.warn(`   ${index + 1}. ⚠️  Failed to delete ${path.basename(file.path)}:`, err.message);
      }
    } else {
      console.log(`   ${index + 1}. ⚠️  File doesn't exist: ${file.path || 'No path'}`);
    }
  });
}

// Cleanup middleware for after response with improved timing
const cleanupTempFiles = (req, res, next) => {
  const originalEnd = res.end;
  
  res.end = function(...args) {
    // Call original end first
    originalEnd.apply(this, args);
    
    // Cleanup after response is sent (increased delay for stability)
    if (req.files || req.file) {
      setTimeout(() => {
        console.log('\n🧹 Post-response cleanup initiated...');
        if (req.files) cleanupFiles(req.files);
        if (req.file) cleanupFiles([req.file]);
        console.log('✓ Post-response cleanup completed\n');
      }, 5000); // 5 seconds delay to ensure file operations complete
    }
  };
  
  next();
};

// Enhanced validation middleware with detailed checks
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
      const file = files[i];
      console.log(`\n   File ${i + 1}/${files.length}:`);
      console.log(`   Name: ${file.originalname}`);
      console.log(`   Path: ${file.path}`);
      console.log(`   Size: ${(file.size / 1024).toFixed(2)} KB`);
      
      // Verify file exists on disk
      if (!fs.existsSync(file.path)) {
        throw new Error(`File not found after upload: ${file.originalname}`);
      }
      console.log(`   ✓ File exists on disk`);
      
      // Verify file size
      const stats = fs.statSync(file.path);
      if (stats.size === 0) {
        throw new Error(`File is empty: ${file.originalname}`);
      }
      if (stats.size !== file.size) {
        console.warn(`   ⚠️  Size mismatch: reported ${file.size}, actual ${stats.size}`);
      }
      console.log(`   ✓ File size verified: ${stats.size} bytes`);
      
      // Verify file is readable
      try {
        fs.accessSync(file.path, fs.constants.R_OK);
        console.log(`   ✓ File is readable`);
      } catch (error) {
        throw new Error(`File is not readable: ${file.originalname}`);
      }
    }
    
    console.log(`\n✅ All ${files.length} file(s) validated successfully\n`);
    next();
  } catch (error) {
    console.error('\n❌ File validation failed:', error.message);
    
    // Cleanup on error
    if (req.files) cleanupFiles(req.files);
    if (req.file) cleanupFiles([req.file]);
    
    res.status(400).json({
      success: false,
      message: error.message,
      error: {
        type: 'FILE_VALIDATION_ERROR'
      }
    });
  }
};


module.exports = upload;
module.exports.upload = upload;
module.exports.handleMulterError = handleMulterError;
module.exports.cleanupTempFiles = cleanupTempFiles;
module.exports.validateFiles = validateFiles;
module.exports.ensureUploadDirectories = ensureUploadDirectories;
module.exports.cleanupFiles = cleanupFiles;

// module.exports = upload;
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




