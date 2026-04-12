const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const DatauriParser = require('datauri/parser');
const parser = new DatauriParser();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.SECRET_KEY,
  secure: true
});

// Allowed file types and their corresponding mime types
const ALLOWED_FILE_TYPES = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/gif': ['gif'],
    'application/pdf': ['pdf']
};

// Maximum file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Validate file
const validateFile = (file) => {
    // Check if file exists
    if (!file) {
        throw new Error('No file provided');
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`);
    }

    // Check file type
    const fileExtension = path.extname(file.originalname).toLowerCase().slice(1);
    const isValidType = Object.entries(ALLOWED_FILE_TYPES).some(([mimeType, extensions]) => 
        file.mimetype === mimeType && extensions.includes(fileExtension)
    );

    if (!isValidType) {
        throw new Error('Invalid file type');
    }
};

// Convert buffer to base64 data URI
const bufferToDataURI = (file) => {
    return parser.format(path.extname(file.originalname).toString(), file.buffer).content;
};

// Main upload function
exports.uploadFile = async (file) => {
    try {
        // Set a longer timeout for the upload (e.g., 30 seconds)
        const uploadOptions = {
            timeout: 30000,
            resource_type: 'auto',
            folder: 'uploads'
        };

        // If file is already a string URL, return it
        if (typeof file === 'string' && file.startsWith('http')) {
            return file;
        }

        // Handle file buffer upload
        if (file.buffer) {
            return new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    uploadOptions,
                    (error, result) => {
                        if (error) {
                            console.error('Cloudinary upload error:', error);
                            reject(new Error('File upload failed: ' + error.message));
                        } else {
                            resolve(result);
                        }
                    }
                );

                // Convert buffer to stream and pipe to uploadStream
                const bufferStream = require('stream').Readable.from(file.buffer);
                bufferStream.pipe(uploadStream);
            });
        }

        // Handle file path upload
        return await cloudinary.uploader.upload(file.path, uploadOptions);
    } catch (error) {
        console.error('File upload error:', {
            error: error.message,
            file: file ? {
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype
            } : 'No file data'
        });
        
        throw new Error(
            `File upload failed: ${error.message || 'Unknown error'}`
        );
    }
};

// Delete file from Cloudinary
exports.deleteFile = async (publicId) => {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return result.result === 'ok';
    } catch (error) {
        console.error('File deletion error:', error);
        throw new Error('File deletion failed');
    }
};

// Get image details from Cloudinary
exports.getFileDetails = async (publicId) => {
    try {
        const result = await cloudinary.api.resource(publicId);
        return result;
    } catch (error) {
        console.error('File details retrieval error:', error);
        throw new Error('Failed to retrieve file details');
    }
};

// Generate a signed URL for temporary access (if needed)
exports.getSignedUrl = (publicId, options = {}) => {
    try {
        const { transformation = [], expiresAt } = options;
        return cloudinary.url(publicId, {
            secure: true,
            transformation,
            sign_url: true,
            expires_at: expiresAt || Math.floor(Date.now() / 1000) + 3600 
        });
    } catch (error) {
        console.error('Signed URL generation error:', error);
        throw new Error('Failed to generate signed URL');
    }
};

// List files in a folder
exports.listFiles = async (folder = 'uploads', options = {}) => {
    try {
        const { maxResults = 100, nextCursor = null } = options;
        const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: folder,
            max_results: maxResults,
            next_cursor: nextCursor
        });
        return result;
    } catch (error) {
        console.error('File listing error:', error);
        throw new Error('Failed to list files');
    }
};

// Helper function to generate Cloudinary transformations URL
exports.getTransformedUrl = (publicId, transformations = []) => {
    return cloudinary.url(publicId, {
        secure: true,
        transformation: transformations
    });
};

// Optional: Add image optimization helper
exports.optimizeImage = (publicId, options = {}) => {
    const {
        width,
        height,
        crop = 'scale',
        quality = 'auto',
        format = 'auto'
    } = options;

    return cloudinary.url(publicId, {
        secure: true,
        width,
        height,
        crop,
        quality,
        fetch_format: format
    });
};