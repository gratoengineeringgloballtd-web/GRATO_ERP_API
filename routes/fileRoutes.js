/**
 * fileRoutes.js
 *
 * All files are stored on Cloudinary.
 * /download and /view routes resolve the Cloudinary URL and redirect the client.
 */

const express    = require('express');
const router     = express.Router();
const { cloudinary } = require('../utils/cloudinaryStorage');

// ─── Determine resource_type from extension ───────────────────────────────────
const guessResourceType = (publicId = '') => {
  const ext = publicId.split('.').pop().toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
    ? 'image'
    : 'raw';
};

// ─── Content-type sniff from extension ────────────────────────────────────────
const getContentType = (publicId = '') => {
  const ext = publicId.split('.').pop().toLowerCase();
  const map = {
    pdf:  'application/pdf',
    doc:  'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:  'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    svg:  'image/svg+xml',
    txt:  'text/plain',
    csv:  'text/csv',
  };
  return map[ext] || 'application/octet-stream';
};

// ─── Core: resolve a public_id to a Cloudinary secure_url ────────────────────
//
// Problem: publicIds stored in MongoDB may or may not have a file extension.
// When resource_type=raw, Cloudinary stores the file WITH the extension in the
// public_id (e.g. "grato-erp/.../file-123.pdf"), but the extension is sometimes
// stripped before saving to the DB.
//
// Strategy:
//   1. If publicId already starts with http → return as-is
//   2. Try the Cloudinary API for 'raw', then 'image' (handles extension mismatch)
//   3. If API fails, build URL directly (works when public_id IS correct)
// ─────────────────────────────────────────────────────────────────────────────
const resolveCloudinaryUrl = async (publicId) => {
  if (!publicId) return null;

  // Already a full URL
  if (publicId.startsWith('https://') || publicId.startsWith('http://')) {
    return publicId;
  }

  // Ensure cloudinary is configured
  if (!process.env.CLOUDINARY_CLOUD_NAME) return null;

  // Try API lookup — handles both cases (with and without extension in public_id)
  for (const resourceType of ['raw', 'image']) {
    try {
      const result = await cloudinary.api.resource(publicId, { resource_type: resourceType });
      console.log(`✅ Cloudinary API resolved (${resourceType}):`, result.secure_url);
      return result.secure_url;
    } catch (_) {
      // not found under this resource_type, try next
    }
  }

  // API failed — public_id may be missing extension.
  // Try building direct URLs for common extensions and pick the first that works.
  // This is a last-resort fallback for files uploaded before the extension fix.
  const COMMON_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.doc', '.xlsx', '.xls'];
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  // First try without extension (in case it was stored correctly)
  const hasExtension = /\.\w{2,5}$/.test(publicId);
  if (!hasExtension) {
    for (const ext of COMMON_EXTENSIONS) {
      const candidateId  = `${publicId}${ext}`;
      const resourceType = guessResourceType(candidateId);
      try {
        const result = await cloudinary.api.resource(candidateId, { resource_type: resourceType });
        console.log(`✅ Cloudinary resolved with appended extension (${ext}):`, result.secure_url);
        return result.secure_url;
      } catch (_) {
        // try next extension
      }
    }
  }

  console.warn(`⚠️  Could not resolve Cloudinary URL for public_id: ${publicId}`);
  return null;
};

// ─── Build URL directly without API call (fast path) ─────────────────────────
// Only use this when we're confident the public_id has an extension.
const buildCloudinaryUrl = (publicId, resourceType = 'raw') => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName || !publicId) return null;
  if (publicId.startsWith('https://') || publicId.startsWith('http://')) return publicId;
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${publicId}`;
};

// =============================================================================
// SUPPLIER DOCUMENT ROUTES
// =============================================================================

router.get('/supplier-document/:publicId', async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.publicId);
    if (!decodedId) return res.status(400).json({ success: false, message: 'File ID is required' });
    if (!decodedId.startsWith('supplier_doc_') && !decodedId.includes('supplier')) {
      return res.status(403).json({ success: false, message: 'Access denied. Invalid file type.' });
    }

    const url = await resolveCloudinaryUrl(decodedId);
    if (!url) return res.status(404).json({ success: false, message: 'Document not found', publicId: decodedId });

    console.log('✅ Redirecting to Cloudinary:', url);
    return res.redirect(url);
  } catch (error) {
    console.error('Supplier document download error:', error);
    res.status(500).json({ success: false, message: 'Failed to download document', error: error.message });
  }
});

router.get('/supplier-document-view/:publicId', async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.publicId);
    if (!decodedId || (!decodedId.startsWith('supplier_doc_') && !decodedId.includes('supplier'))) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const url = await resolveCloudinaryUrl(decodedId);
    if (!url) return res.status(404).json({ success: false, message: 'Document not found', publicId: decodedId });

    return res.redirect(url);
  } catch (error) {
    console.error('Supplier document view error:', error);
    res.status(500).json({ success: false, message: 'Failed to view document', error: error.message });
  }
});

// =============================================================================
// DOWNLOAD — GET /api/files/download/:publicId(*)
// =============================================================================
router.get('/download/:publicId(*)', async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    console.log('📥 File download request:', publicId);

    if (!publicId) return res.status(400).json({ success: false, message: 'File ID is required' });

    // Already a full URL
    if (publicId.startsWith('https://') || publicId.startsWith('http://')) {
      return res.redirect(publicId);
    }

    // Supplier guard
    if (publicId.startsWith('supplier_doc_')) {
      return res.redirect(`/api/files/supplier-document/${encodeURIComponent(publicId)}`);
    }

    // ✅ Always use the API resolver — it handles missing extensions automatically
    const url = await resolveCloudinaryUrl(publicId);

    if (!url) {
      console.warn('❌ File not found on Cloudinary:', publicId);
      return res.status(404).json({ success: false, message: 'File not found', publicId });
    }

    console.log('✅ Redirecting to Cloudinary:', url);
    return res.redirect(url);
  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({ success: false, message: 'Failed to download file', error: error.message });
  }
});

// =============================================================================
// VIEW — GET /api/files/view/:publicId(*)
// =============================================================================
router.get('/view/:publicId(*)', async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    console.log('👁️ File view request:', publicId);

    if (!publicId) return res.status(400).json({ success: false, message: 'File ID is required' });

    if (publicId.startsWith('https://') || publicId.startsWith('http://')) {
      return res.redirect(publicId);
    }

    if (publicId.startsWith('supplier_doc_')) {
      return res.redirect(`/api/files/supplier-document-view/${encodeURIComponent(publicId)}`);
    }

    const url = await resolveCloudinaryUrl(publicId);
    if (!url) return res.status(404).json({ success: false, message: 'File not found', publicId });

    console.log('✅ Redirecting to Cloudinary:', url);
    return res.redirect(url);
  } catch (error) {
    console.error('File view error:', error);
    res.status(500).json({ success: false, message: 'Failed to view file', error: error.message });
  }
});

// =============================================================================
// IMAGE — GET /api/files/image/:publicId(*)
// =============================================================================
router.get('/image/:publicId(*)', async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    if (!publicId) return res.status(400).json({ success: false, message: 'Image ID is required' });
    if (publicId.startsWith('https://') || publicId.startsWith('http://')) return res.redirect(publicId);

    const url = await resolveCloudinaryUrl(publicId);
    if (!url) return res.status(404).json({ success: false, message: 'Image not found' });

    return res.redirect(url);
  } catch (error) {
    console.error('Image retrieval error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve image', error: error.message });
  }
});

// =============================================================================
// INFO — GET /api/files/info/:publicId(*)
// =============================================================================
router.get('/info/:publicId(*)', async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    if (!publicId) return res.status(400).json({ success: false, message: 'File ID is required' });

    let info = null;

    for (const resourceType of ['raw', 'image']) {
      try {
        info = await cloudinary.api.resource(publicId, { resource_type: resourceType });
        break;
      } catch (_) {}
    }

    // Try with extensions if not found
    if (!info && !/\.\w{2,5}$/.test(publicId)) {
      for (const ext of ['.pdf', '.jpg', '.png', '.docx', '.xlsx']) {
        const candidateId  = `${publicId}${ext}`;
        const resourceType = guessResourceType(candidateId);
        try {
          info = await cloudinary.api.resource(candidateId, { resource_type: resourceType });
          break;
        } catch (_) {}
      }
    }

    if (!info) return res.status(404).json({ success: false, message: 'File not found', publicId });

    res.json({
      success: true,
      data: {
        publicId:    info.public_id,
        url:         info.secure_url,
        size:        info.bytes,
        sizeKB:      (info.bytes / 1024).toFixed(2),
        sizeMB:      (info.bytes / (1024 * 1024)).toFixed(2),
        format:      info.format,
        contentType: getContentType(publicId),
        createdAt:   info.created_at,
        isImage:     info.resource_type === 'image',
        isPDF:       info.format === 'pdf'
      }
    });
  } catch (error) {
    console.error('File info error:', error);
    res.status(500).json({ success: false, message: 'Failed to get file info', error: error.message });
  }
});

// =============================================================================
// HEALTH
// =============================================================================
router.get('/health', (req, res) => {
  res.json({
    success:   true,
    message:   'File service is running (Cloudinary mode)',
    storage:   'cloudinary',
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'not configured',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;










// /**
//  * fileRoutes.js
//  *
//  * All files are now stored on Cloudinary.
//  * /download and /view routes resolve the Cloudinary URL from the public_id
//  * and redirect the client there — no local filesystem involved.
//  *
//  * Supplier-document routes (supplier_doc_ prefix) keep their access control
//  * but also redirect to Cloudinary rather than streaming from disk.
//  */

// const express    = require('express');
// const router     = express.Router();
// const { cloudinary } = require('../utils/cloudinaryStorage');

// // ─── Helper: get Cloudinary URL from a public_id ─────────────────────────────
// // For 'raw' resources (PDFs, docs) we need to use the resource_type correctly.
// // We attempt 'raw' first, fall back to 'image' for images.
// const resolveCloudinaryUrl = async (publicId) => {
//   // If it already looks like a full https URL, just return it
//   if (publicId.startsWith('https://') || publicId.startsWith('http://')) {
//     return publicId;
//   }

//   // Try raw first (covers PDFs, Word, Excel …)
//   for (const resourceType of ['raw', 'image']) {
//     try {
//       const result = await cloudinary.api.resource(publicId, { resource_type: resourceType });
//       return result.secure_url;
//     } catch (_) {
//       // not found under this resource_type, try next
//     }
//   }

//   return null; // not found in Cloudinary
// };

// // ─── Helper: build a Cloudinary URL without an API round-trip ────────────────
// // Works when we already know the resource_type.
// const buildCloudinaryUrl = (publicId, resourceType = 'raw') => {
//   const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
//   if (!cloudName) return null;
//   // Cloudinary URL format: https://res.cloudinary.com/<cloud>/raw/upload/<public_id>
//   // For 'image' it's: .../image/upload/...
//   return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${publicId}`;
// };

// // ─── Content-type sniff from extension ────────────────────────────────────────
// const getContentType = (publicId = '') => {
//   const ext = publicId.split('.').pop().toLowerCase();
//   const map = {
//     pdf:  'application/pdf',
//     doc:  'application/msword',
//     docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//     xls:  'application/vnd.ms-excel',
//     xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//     ppt:  'application/vnd.ms-powerpoint',
//     pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
//     png:  'image/png',
//     jpg:  'image/jpeg',
//     jpeg: 'image/jpeg',
//     gif:  'image/gif',
//     svg:  'image/svg+xml',
//     txt:  'text/plain',
//     csv:  'text/csv',
//   };
//   return map[ext] || 'application/octet-stream';
// };

// // ─── Determine resource_type from extension ────────────────────────────────────
// const guessResourceType = (publicId = '') => {
//   const ext = publicId.split('.').pop().toLowerCase();
//   return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
//     ? 'image'
//     : 'raw';
// };

// // =============================================================================
// // SUPPLIER DOCUMENT ROUTES (PUBLIC ACCESS)
// // =============================================================================

// /**
//  * GET /api/files/supplier-document/:publicId
//  * Download a supplier document. Only allows supplier_doc_ prefixed IDs.
//  */
// router.get('/supplier-document/:publicId', async (req, res) => {
//   try {
//     const { publicId } = req.params;
//     const decodedId    = decodeURIComponent(publicId);

//     console.log('📥 Supplier document download request:', decodedId);

//     if (!decodedId) {
//       return res.status(400).json({ success: false, message: 'File ID is required' });
//     }

//     if (!decodedId.startsWith('supplier_doc_') && !decodedId.includes('supplier')) {
//       return res.status(403).json({ success: false, message: 'Access denied. Invalid file type.' });
//     }

//     const url = await resolveCloudinaryUrl(decodedId);

//     if (!url) {
//       console.warn('❌ Supplier document not found on Cloudinary:', decodedId);
//       return res.status(404).json({ success: false, message: 'Document not found', publicId: decodedId });
//     }

//     console.log('✅ Redirecting to Cloudinary:', url);
//     return res.redirect(url);

//   } catch (error) {
//     console.error('Supplier document download error:', error);
//     res.status(500).json({ success: false, message: 'Failed to download document', error: error.message });
//   }
// });

// /**
//  * GET /api/files/supplier-document-view/:publicId
//  * Inline-view a supplier document.
//  */
// router.get('/supplier-document-view/:publicId', async (req, res) => {
//   try {
//     const { publicId } = req.params;
//     const decodedId    = decodeURIComponent(publicId);

//     if (!decodedId || (!decodedId.startsWith('supplier_doc_') && !decodedId.includes('supplier'))) {
//       return res.status(403).json({ success: false, message: 'Access denied' });
//     }

//     const url = await resolveCloudinaryUrl(decodedId);

//     if (!url) {
//       return res.status(404).json({ success: false, message: 'Document not found', publicId: decodedId });
//     }

//     return res.redirect(url);

//   } catch (error) {
//     console.error('Supplier document view error:', error);
//     res.status(500).json({ success: false, message: 'Failed to view document', error: error.message });
//   }
// });

// // =============================================================================
// // AUTHENTICATED FILE ROUTES
// // =============================================================================

// /**
//  * GET /api/files/download/:publicId
//  * Download any file by its Cloudinary public_id.
//  * The public_id arrives URL-encoded (slashes become %2F etc.).
//  */
// router.get('/download/:publicId(*)', async (req, res) => {
//   try {
//     // Express captures everything after /download/ — including slashes — via (*)
//     const publicId  = decodeURIComponent(req.params.publicId);

//     console.log('📥 File download request:', publicId);

//     if (!publicId) {
//       return res.status(400).json({ success: false, message: 'File ID is required' });
//     }

//     // Fast path: if it's already a URL, redirect immediately
//     if (publicId.startsWith('https://') || publicId.startsWith('http://')) {
//       return res.redirect(publicId);
//     }

//     // Supplier documents → guard check
//     if (publicId.startsWith('supplier_doc_')) {
//       return res.redirect(`/api/files/supplier-document/${encodeURIComponent(publicId)}`);
//     }

//     // Try building the URL directly (no API call needed)
//     const resourceType = guessResourceType(publicId);
//     let url = buildCloudinaryUrl(publicId, resourceType);

//     // Verify it actually exists (optional — remove if you prefer speed over accuracy)
//     if (!url) {
//       url = await resolveCloudinaryUrl(publicId);
//     }

//     if (!url) {
//       console.warn('❌ File not found on Cloudinary:', publicId);
//       return res.status(404).json({ success: false, message: 'File not found', publicId });
//     }

//     console.log('✅ Redirecting to Cloudinary:', url);
//     return res.redirect(url);

//   } catch (error) {
//     console.error('File download error:', error);
//     res.status(500).json({ success: false, message: 'Failed to download file', error: error.message });
//   }
// });

// /**
//  * GET /api/files/view/:publicId
//  * Inline-view any file.
//  */
// router.get('/view/:publicId(*)', async (req, res) => {
//   try {
//     const publicId = decodeURIComponent(req.params.publicId);

//     console.log('👁️ File view request:', publicId);

//     if (!publicId) {
//       return res.status(400).json({ success: false, message: 'File ID is required' });
//     }

//     if (publicId.startsWith('https://') || publicId.startsWith('http://')) {
//       return res.redirect(publicId);
//     }

//     if (publicId.startsWith('supplier_doc_')) {
//       return res.redirect(`/api/files/supplier-document-view/${encodeURIComponent(publicId)}`);
//     }

//     const resourceType = guessResourceType(publicId);
//     const url = buildCloudinaryUrl(publicId, resourceType) || await resolveCloudinaryUrl(publicId);

//     if (!url) {
//       return res.status(404).json({ success: false, message: 'File not found', publicId });
//     }

//     console.log('✅ Redirecting to Cloudinary:', url);
//     return res.redirect(url);

//   } catch (error) {
//     console.error('File view error:', error);
//     res.status(500).json({ success: false, message: 'Failed to view file', error: error.message });
//   }
// });

// /**
//  * GET /api/files/image/:publicId
//  * Serve images (PUBLIC ACCESS).
//  */
// router.get('/image/:publicId(*)', async (req, res) => {
//   try {
//     const publicId = decodeURIComponent(req.params.publicId);

//     if (!publicId) {
//       return res.status(400).json({ success: false, message: 'Image ID is required' });
//     }

//     if (publicId.startsWith('https://') || publicId.startsWith('http://')) {
//       return res.redirect(publicId);
//     }

//     const url = buildCloudinaryUrl(publicId, 'image') || await resolveCloudinaryUrl(publicId);

//     if (!url) {
//       return res.status(404).json({ success: false, message: 'Image not found' });
//     }

//     return res.redirect(url);

//   } catch (error) {
//     console.error('Image retrieval error:', error);
//     res.status(500).json({ success: false, message: 'Failed to retrieve image', error: error.message });
//   }
// });

// /**
//  * GET /api/files/info/:publicId
//  * Return metadata about a file stored on Cloudinary.
//  */
// router.get('/info/:publicId(*)', async (req, res) => {
//   try {
//     const publicId = decodeURIComponent(req.params.publicId);

//     if (!publicId) {
//       return res.status(400).json({ success: false, message: 'File ID is required' });
//     }

//     let info = null;

//     for (const resourceType of ['raw', 'image']) {
//       try {
//         const result = await cloudinary.api.resource(publicId, { resource_type: resourceType });
//         info = result;
//         break;
//       } catch (_) {}
//     }

//     if (!info) {
//       return res.status(404).json({ success: false, message: 'File not found', publicId });
//     }

//     res.json({
//       success: true,
//       data: {
//         publicId:    info.public_id,
//         url:         info.secure_url,
//         size:        info.bytes,
//         sizeKB:      (info.bytes / 1024).toFixed(2),
//         sizeMB:      (info.bytes / (1024 * 1024)).toFixed(2),
//         format:      info.format,
//         contentType: getContentType(publicId),
//         createdAt:   info.created_at,
//         isImage:     info.resource_type === 'image',
//         isPDF:       info.format === 'pdf'
//       }
//     });

//   } catch (error) {
//     console.error('File info error:', error);
//     res.status(500).json({ success: false, message: 'Failed to get file info', error: error.message });
//   }
// });

// /**
//  * GET /api/files/health
//  */
// router.get('/health', (req, res) => {
//   res.json({
//     success:   true,
//     message:   'File service is running (Cloudinary mode)',
//     storage:   'cloudinary',
//     cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'not configured',
//     timestamp: new Date().toISOString()
//   });
// });

// module.exports = router;












// const express = require('express');
// const router = express.Router();
// const path = require('path');
// const fs = require('fs');
// const { findFileRecursively, BASE_UPLOAD_DIR } = require('../utils/cloudinaryStorage');

// /**
//  * Helper function to find file recursively
//  */
// const findFile = (directory, filename) => {
//   try {
//     if (!fs.existsSync(directory)) {
//       console.log(`Directory does not exist: ${directory}`);
//       return null;
//     }
    
//     const files = fs.readdirSync(directory, { withFileTypes: true });
    
//     for (const file of files) {
//       const fullPath = path.join(directory, file.name);
      
//       if (file.isDirectory()) {
//         const found = findFile(fullPath, filename);
//         if (found) return found;
//       } else if (file.name === filename) {
//         console.log(`✅ File found: ${fullPath}`);
//         return fullPath;
//       }
//     }
//   } catch (error) {
//     console.error(`Error searching directory ${directory}:`, error.message);
//   }
  
//   return null;
// };

// /**
//  * Get content type from file extension
//  */
// const getContentType = (filePath) => {
//   const ext = path.extname(filePath).toLowerCase();
//   const contentTypes = {
//     '.pdf': 'application/pdf',
//     '.doc': 'application/msword',
//     '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//     '.xls': 'application/vnd.ms-excel',
//     '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//     '.ppt': 'application/vnd.ms-powerpoint',
//     '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
//     '.png': 'image/png',
//     '.jpg': 'image/jpeg',
//     '.jpeg': 'image/jpeg',
//     '.gif': 'image/gif',
//     '.svg': 'image/svg+xml',
//     '.txt': 'text/plain',
//     '.csv': 'text/csv',
//     '.zip': 'application/zip',
//     '.rar': 'application/x-rar-compressed'
//   };
//   return contentTypes[ext] || 'application/octet-stream';
// };

// /**
//  * Stream file to response
//  */
// const streamFile = (filePath, res, inline = false) => {
//   const stats = fs.statSync(filePath);
//   const filename = path.basename(filePath);
//   const contentType = getContentType(filePath);

//   res.setHeader('Content-Type', contentType);
//   res.setHeader('Content-Length', stats.size);
//   res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);

//   const fileStream = fs.createReadStream(filePath);
  
//   fileStream.on('error', (error) => {
//     console.error('File stream error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({
//         success: false,
//         message: 'Error reading file'
//       });
//     }
//   });

//   fileStream.pipe(res);
// };

// // ===============================
// // SUPPLIER DOCUMENT ROUTES (PUBLIC ACCESS - NO AUTH REQUIRED)
// // ===============================

// /**
//  * Download supplier document (PUBLIC ACCESS)
//  * GET /api/files/supplier-document/:publicId
//  */
// router.get('/supplier-document/:publicId', async (req, res) => {
//   try {
//     const { publicId } = req.params;
    
//     console.log('📥 Supplier document download request:', publicId);
    
//     if (!publicId) {
//       return res.status(400).json({
//         success: false,
//         message: 'File ID is required'
//       });
//     }

//     // Only allow supplier_doc_ prefixed files
//     if (!publicId.startsWith('supplier_doc_')) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Invalid file type.'
//       });
//     }

//     // Search in the uploads directory
//     const uploadsDir = path.resolve(process.cwd(), 'uploads');
//     const filePath = findFile(uploadsDir, publicId);
    
//     if (!filePath) {
//       console.warn(`❌ Supplier document not found: ${publicId}`);
//       return res.status(404).json({
//         success: false,
//         message: 'Document not found',
//         publicId
//       });
//     }

//     if (!fs.existsSync(filePath)) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found on server',
//         publicId
//       });
//     }

//     console.log(`✅ Streaming supplier document: ${filePath}`);
    
//     // Stream file for download
//     streamFile(filePath, res, false);

//   } catch (error) {
//     console.error('Supplier document download error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to download document',
//       error: error.message
//     });
//   }
// });

// /**
//  * View supplier document inline (PUBLIC ACCESS)
//  * GET /api/files/supplier-document-view/:publicId
//  */
// router.get('/supplier-document-view/:publicId', async (req, res) => {
//   try {
//     const { publicId } = req.params;
    
//     console.log('👁️ Supplier document view request:', publicId);
    
//     if (!publicId || !publicId.startsWith('supplier_doc_')) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied'
//       });
//     }

//     const uploadsDir = path.resolve(process.cwd(), 'uploads');
//     const filePath = findFile(uploadsDir, publicId);
    
//     if (!filePath || !fs.existsSync(filePath)) {
//       return res.status(404).json({
//         success: false,
//         message: 'Document not found',
//         publicId
//       });
//     }

//     console.log(`✅ Viewing supplier document: ${filePath}`);
    
//     // Stream file for inline viewing
//     streamFile(filePath, res, true);

//   } catch (error) {
//     console.error('Supplier document view error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to view document',
//       error: error.message
//     });
//   }
// });

// // ===============================
// // AUTHENTICATED FILE ROUTES
// // ===============================

// /**
//  * Download file by publicId (REQUIRES AUTH)
//  * GET /api/files/download/:publicId
//  */
// router.get('/download/:publicId', async (req, res) => {
//   try {
//     const { publicId } = req.params;
    
//     console.log('📥 File download request:', publicId);
    
//     if (!publicId) {
//       return res.status(400).json({
//         success: false,
//         message: 'File ID is required'
//       });
//     }

//     // For supplier documents, redirect to public route
//     if (publicId.startsWith('supplier_doc_')) {
//       return res.redirect(`/api/files/supplier-document/${publicId}`);
//     }

//     const uploadsDir = path.resolve(process.cwd(), 'uploads');
//     const filePath = findFile(uploadsDir, publicId);
    
//     if (!filePath) {
//       console.warn(`❌ File not found: ${publicId}`);
//       return res.status(404).json({
//         success: false,
//         message: 'File not found',
//         publicId
//       });
//     }

//     if (!fs.existsSync(filePath)) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found on server',
//         publicId
//       });
//     }

//     console.log(`✅ File found: ${filePath}`);
//     streamFile(filePath, res, false);

//   } catch (error) {
//     console.error('File download error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to download file',
//       error: error.message
//     });
//   }
// });

// /**
//  * View/Preview file by publicId (REQUIRES AUTH)
//  * GET /api/files/view/:publicId
//  */
// router.get('/view/:publicId', async (req, res) => {
//   try {
//     const { publicId } = req.params;
    
//     console.log('👁️ File view request:', publicId);
    
//     if (!publicId) {
//       return res.status(400).json({
//         success: false,
//         message: 'File ID is required'
//       });
//     }

//     // For supplier documents, redirect to public view route
//     if (publicId.startsWith('supplier_doc_')) {
//       return res.redirect(`/api/files/supplier-document-view/${publicId}`);
//     }

//     const uploadsDir = path.resolve(process.cwd(), 'uploads');
//     const filePath = findFile(uploadsDir, publicId);
    
//     if (!filePath || !fs.existsSync(filePath)) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found',
//         publicId
//       });
//     }

//     streamFile(filePath, res, true);

//   } catch (error) {
//     console.error('File view error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to view file',
//       error: error.message
//     });
//   }
// });

// /**
//  * Get image by publicId (PUBLIC ACCESS)
//  * GET /api/files/image/:publicId
//  */
// router.get('/image/:publicId', async (req, res) => {
//   try {
//     const { publicId } = req.params;
    
//     if (!publicId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Image ID is required'
//       });
//     }

//     const uploadsDir = path.resolve(process.cwd(), 'uploads');
//     const filePath = findFile(uploadsDir, publicId);
    
//     if (!filePath || !fs.existsSync(filePath)) {
//       return res.status(404).json({
//         success: false,
//         message: 'Image not found'
//       });
//     }

//     // Verify it's an image
//     const ext = path.extname(filePath).toLowerCase();
//     if (!['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
//       return res.status(400).json({
//         success: false,
//         message: 'File is not an image'
//       });
//     }

//     streamFile(filePath, res, true);

//   } catch (error) {
//     console.error('Image retrieval error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to retrieve image',
//       error: error.message
//     });
//   }
// });

// /**
//  * Get file info by publicId
//  * GET /api/files/info/:publicId
//  */
// router.get('/info/:publicId', async (req, res) => {
//   try {
//     const { publicId } = req.params;
    
//     if (!publicId) {
//       return res.status(400).json({
//         success: false,
//         message: 'File ID is required'
//       });
//     }

//     const uploadsDir = path.resolve(process.cwd(), 'uploads');
//     const filePath = findFile(uploadsDir, publicId);
    
//     if (!filePath || !fs.existsSync(filePath)) {
//       return res.status(404).json({
//         success: false,
//         message: 'File not found',
//         publicId
//       });
//     }

//     const stats = fs.statSync(filePath);
//     const ext = path.extname(filePath);

//     res.json({
//       success: true,
//       data: {
//         publicId,
//         name: publicId,
//         size: stats.size,
//         sizeKB: (stats.size / 1024).toFixed(2),
//         sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
//         extension: ext,
//         contentType: getContentType(filePath),
//         createdAt: stats.birthtime,
//         modifiedAt: stats.mtime,
//         isImage: ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext.toLowerCase())
//       }
//     });

//   } catch (error) {
//     console.error('File info error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get file info',
//       error: error.message
//     });
//   }
// });

// /**
//  * Health check endpoint
//  */
// router.get('/health', (req, res) => {
//   const uploadsDir = path.resolve(process.cwd(), 'uploads');
//   res.json({
//     success: true,
//     message: 'File service is running',
//     uploadDir: uploadsDir,
//     exists: fs.existsSync(uploadsDir),
//     timestamp: new Date().toISOString()
//   });
// });

// module.exports = router;





