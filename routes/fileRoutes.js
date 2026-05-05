const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { findFileRecursively, BASE_UPLOAD_DIR } = require('../utils/localFileStorage');

/**
 * Helper function to find file recursively
 */
const findFile = (directory, filename) => {
  try {
    if (!fs.existsSync(directory)) {
      console.log(`Directory does not exist: ${directory}`);
      return null;
    }
    
    const files = fs.readdirSync(directory, { withFileTypes: true });
    
    for (const file of files) {
      const fullPath = path.join(directory, file.name);
      
      if (file.isDirectory()) {
        const found = findFile(fullPath, filename);
        if (found) return found;
      } else if (file.name === filename) {
        console.log(`✅ File found: ${fullPath}`);
        return fullPath;
      }
    }
  } catch (error) {
    console.error(`Error searching directory ${directory}:`, error.message);
  }
  
  return null;
};

/**
 * Get content type from file extension
 */
const getContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed'
  };
  return contentTypes[ext] || 'application/octet-stream';
};

/**
 * Stream file to response
 */
const streamFile = (filePath, res, inline = false) => {
  const stats = fs.statSync(filePath);
  const filename = path.basename(filePath);
  const contentType = getContentType(filePath);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);

  const fileStream = fs.createReadStream(filePath);
  
  fileStream.on('error', (error) => {
    console.error('File stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error reading file'
      });
    }
  });

  fileStream.pipe(res);
};

// ===============================
// SUPPLIER DOCUMENT ROUTES (PUBLIC ACCESS - NO AUTH REQUIRED)
// ===============================

/**
 * Download supplier document (PUBLIC ACCESS)
 * GET /api/files/supplier-document/:publicId
 */
router.get('/supplier-document/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    
    console.log('📥 Supplier document download request:', publicId);
    
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'File ID is required'
      });
    }

    // Only allow supplier_doc_ prefixed files
    if (!publicId.startsWith('supplier_doc_')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Invalid file type.'
      });
    }

    // Search in the uploads directory
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = findFile(uploadsDir, publicId);
    
    if (!filePath) {
      console.warn(`❌ Supplier document not found: ${publicId}`);
      return res.status(404).json({
        success: false,
        message: 'Document not found',
        publicId
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
        publicId
      });
    }

    console.log(`✅ Streaming supplier document: ${filePath}`);
    
    // Stream file for download
    streamFile(filePath, res, false);

  } catch (error) {
    console.error('Supplier document download error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download document',
      error: error.message
    });
  }
});

/**
 * View supplier document inline (PUBLIC ACCESS)
 * GET /api/files/supplier-document-view/:publicId
 */
router.get('/supplier-document-view/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    
    console.log('👁️ Supplier document view request:', publicId);
    
    if (!publicId || !publicId.startsWith('supplier_doc_')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = findFile(uploadsDir, publicId);
    
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
        publicId
      });
    }

    console.log(`✅ Viewing supplier document: ${filePath}`);
    
    // Stream file for inline viewing
    streamFile(filePath, res, true);

  } catch (error) {
    console.error('Supplier document view error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to view document',
      error: error.message
    });
  }
});

// ===============================
// AUTHENTICATED FILE ROUTES
// ===============================

/**
 * Download file by publicId (REQUIRES AUTH)
 * GET /api/files/download/:publicId
 */
router.get('/download/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    
    console.log('📥 File download request:', publicId);
    
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'File ID is required'
      });
    }

    // For supplier documents, redirect to public route
    if (publicId.startsWith('supplier_doc_')) {
      return res.redirect(`/api/files/supplier-document/${publicId}`);
    }

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = findFile(uploadsDir, publicId);
    
    if (!filePath) {
      console.warn(`❌ File not found: ${publicId}`);
      return res.status(404).json({
        success: false,
        message: 'File not found',
        publicId
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
        publicId
      });
    }

    console.log(`✅ File found: ${filePath}`);
    streamFile(filePath, res, false);

  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download file',
      error: error.message
    });
  }
});

/**
 * View/Preview file by publicId (REQUIRES AUTH)
 * GET /api/files/view/:publicId
 */
router.get('/view/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    
    console.log('👁️ File view request:', publicId);
    
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'File ID is required'
      });
    }

    // For supplier documents, redirect to public view route
    if (publicId.startsWith('supplier_doc_')) {
      return res.redirect(`/api/files/supplier-document-view/${publicId}`);
    }

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = findFile(uploadsDir, publicId);
    
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
        publicId
      });
    }

    streamFile(filePath, res, true);

  } catch (error) {
    console.error('File view error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to view file',
      error: error.message
    });
  }
});

/**
 * Get image by publicId (PUBLIC ACCESS)
 * GET /api/files/image/:publicId
 */
router.get('/image/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Image ID is required'
      });
    }

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = findFile(uploadsDir, publicId);
    
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    // Verify it's an image
    const ext = path.extname(filePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
      return res.status(400).json({
        success: false,
        message: 'File is not an image'
      });
    }

    streamFile(filePath, res, true);

  } catch (error) {
    console.error('Image retrieval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve image',
      error: error.message
    });
  }
});

/**
 * Get file info by publicId
 * GET /api/files/info/:publicId
 */
router.get('/info/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'File ID is required'
      });
    }

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = findFile(uploadsDir, publicId);
    
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
        publicId
      });
    }

    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath);

    res.json({
      success: true,
      data: {
        publicId,
        name: publicId,
        size: stats.size,
        sizeKB: (stats.size / 1024).toFixed(2),
        sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
        extension: ext,
        contentType: getContentType(filePath),
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        isImage: ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext.toLowerCase())
      }
    });

  } catch (error) {
    console.error('File info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get file info',
      error: error.message
    });
  }
});

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  res.json({
    success: true,
    message: 'File service is running',
    uploadDir: uploadsDir,
    exists: fs.existsSync(uploadsDir),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;





