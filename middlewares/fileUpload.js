const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter - allow common document types
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, Word, Excel, and image files are allowed.'), false);
  }
};

// Create multer instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Wrap upload to add logging
const uploadWithLogging = (fieldName) => {
  return (req, res, next) => {
    console.log(`📁 Multer processing file upload for field: ${fieldName}`);
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        console.error(`❌ Multer error: ${err.message}`);
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed'
        });
      }
      if (req.file) {
        console.log(`✅ File uploaded: ${req.file.filename}`);
      } else {
        console.log('ℹ️ No file provided (optional)');
      }
      next();
    });
  };
};

module.exports = upload;
module.exports.uploadWithLogging = uploadWithLogging;
