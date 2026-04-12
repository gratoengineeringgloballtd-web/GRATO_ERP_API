const path = require('path');
const fs = require('fs');
const User = require('../models/User');

/**
 * Download HR document by employee ID and publicId/filename
 */
const downloadHRDocument = async (req, res) => {
  try {
    const { employeeId, publicId } = req.params;
    
    console.log('\n=== HR DOCUMENT DOWNLOAD ===');
    console.log('Employee ID:', employeeId);
    console.log('Public ID:', publicId);
    console.log('User:', req.user.userId);
    
    if (!employeeId || !publicId) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and file identifier are required'
      });
    }

    // Decode the publicId (it might be URL encoded)
    const decodedPublicId = decodeURIComponent(publicId);
    console.log('Decoded Public ID:', decodedPublicId);

    // Possible file locations for HR documents
    const possiblePaths = [
      path.join(__dirname, '../uploads/hr-documents', employeeId, decodedPublicId),
      path.join(__dirname, '../uploads/documents', employeeId, decodedPublicId),
      path.join(__dirname, '../uploads/employee-documents', employeeId, decodedPublicId)
    ];

    let filePath = null;

    // Find the file
    for (const checkPath of possiblePaths) {
      if (fs.existsSync(checkPath)) {
        filePath = checkPath;
        console.log(`✓ File found at: ${checkPath}`);
        break;
      }
    }

    if (!filePath) {
      console.error('❌ File not found in any directory');
      console.error('Searched paths:', possiblePaths);
      return res.status(404).json({
        success: false,
        message: 'File not found. It may have been moved or deleted.',
        publicId: decodedPublicId
      });
    }

    // Verify file accessibility
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (accessError) {
      console.error('❌ File exists but is not readable:', accessError.message);
      return res.status(403).json({
        success: false,
        message: 'File exists but cannot be accessed'
      });
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);

    // Determine MIME type
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.txt': 'text/plain',
      '.rtf': 'application/rtf'
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    
    // Extract original filename from publicId
    // Format: documentType-timestamp-originalName.ext
    const parts = decodedPublicId.split('-');
    const originalName = parts.length >= 3 ? parts.slice(2).join('-') : path.basename(filePath);

    console.log('MIME type:', mimeType);
    console.log('Original filename:', originalName);

    // Set headers for download
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      console.error('❌ File stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error reading file'
        });
      }
    });

    fileStream.on('end', () => {
      console.log('✅ File download completed successfully');
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error('❌ Download HR document error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download document',
        error: error.message
      });
    }
  }
};

/**
 * View HR document inline (for PDFs and images)
 */
const viewHRDocument = async (req, res) => {
  try {
    const { employeeId, publicId } = req.params;
    
    console.log('\n=== HR DOCUMENT VIEW ===');
    console.log('Employee ID:', employeeId);
    console.log('Public ID:', publicId);
    
    const decodedPublicId = decodeURIComponent(publicId);

    // Possible file locations
    const possiblePaths = [
      path.join(__dirname, '../uploads/hr-documents', employeeId, decodedPublicId),
      path.join(__dirname, '../uploads/documents', employeeId, decodedPublicId),
      path.join(__dirname, '../uploads/employee-documents', employeeId, decodedPublicId)
    ];

    let filePath = null;
    for (const checkPath of possiblePaths) {
      if (fs.existsSync(checkPath)) {
        filePath = checkPath;
        break;
      }
    }

    if (!filePath) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const ext = path.extname(filePath).toLowerCase();
    
    // Only allow inline viewing for safe file types
    const inlineTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };

    const mimeType = inlineTypes[ext];
    if (!mimeType) {
      return res.status(400).json({
        success: false,
        message: 'This file type cannot be viewed inline. Please download it instead.'
      });
    }

    const stats = fs.statSync(filePath);
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    console.log('✅ File view initiated');

  } catch (error) {
    console.error('❌ View HR document error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to view document',
        error: error.message
      });
    }
  }
};

/**
 * Get HR document info without downloading
 */
const getHRDocumentInfo = async (req, res) => {
  try {
    const { employeeId, publicId } = req.params;
    const decodedPublicId = decodeURIComponent(publicId);

    const possiblePaths = [
      path.join(__dirname, '../uploads/hr-documents', employeeId, decodedPublicId),
      path.join(__dirname, '../uploads/documents', employeeId, decodedPublicId),
      path.join(__dirname, '../uploads/employee-documents', employeeId, decodedPublicId)
    ];

    let filePath = null;
    for (const checkPath of possiblePaths) {
      if (fs.existsSync(checkPath)) {
        filePath = checkPath;
        break;
      }
    }

    if (!filePath) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    res.json({
      success: true,
      data: {
        publicId: decodedPublicId,
        name: path.basename(filePath),
        size: stats.size,
        extension: ext,
        canViewInline: ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext),
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime
      }
    });

  } catch (error) {
    console.error('Get HR document info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get document info',
      error: error.message
    });
  }
};

module.exports = {
  downloadHRDocument,
  viewHRDocument,
  getHRDocumentInfo
};