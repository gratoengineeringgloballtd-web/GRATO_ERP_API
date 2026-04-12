const cloudinary = require('cloudinary').v2;

// Configure Cloudinary with your credentials
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME || 'ddlhwv65t',
  api_key: process.env.CLOUDINARY_API_KEY || process.env.API_KEY || '471725712229734',
  api_secret: process.env.CLOUDINARY_API_SECRET || process.env.SECRET_KEY || '-5UKqZG7YkSXfCWA6iyhUQTCTEA',
  secure: true // Use HTTPS URLs
});

// Test the configuration immediately
const testConfiguration = async () => {
  try {
    // Test the configuration by getting account details
    const result = await cloudinary.api.ping();
    console.log('✅ Cloudinary connected successfully:', result);
    return true;
  } catch (error) {
    console.error('❌ Cloudinary configuration failed:', error.message);
    return false;
  }
};

// Call test configuration
testConfiguration();

// Helper functions
const getCloudinaryUrl = (publicId, options = {}) => {
  if (!publicId) return '';
  
  const defaultOptions = {
    secure: true,
    ...options
  };
  
  return cloudinary.url(publicId, defaultOptions);
};

// Optimized image URL with transformations
const getOptimizedImageUrl = (publicId, options = {}) => {
  if (!publicId) return 'https://via.placeholder.com/400x500/f5f3f0/999999?text=No+Image';
  
  const defaultOptions = {
    secure: true,
    quality: 'auto',
    fetch_format: 'auto',
    ...options
  };
  
  return cloudinary.url(publicId, defaultOptions);
};

// Get file URL with proper handling for different resource types
const getFileUrl = (fileData) => {
  if (!fileData || !fileData.url) {
    return null;
  }
  
  // Return the secure URL directly from the stored data
  return fileData.url;
};

// Generate thumbnail for documents/PDFs
const getThumbnailUrl = (publicId, resourceType = 'image') => {
  if (!publicId) return null;
  
  const options = {
    secure: true,
    width: 200,
    height: 200,
    crop: 'fill',
    format: 'jpg'
  };
  
  // For PDFs, generate thumbnail from first page
  if (resourceType === 'raw' || publicId.includes('.pdf')) {
    options.page = 1;
    options.format = 'jpg';
  }
  
  return cloudinary.url(publicId, options);
};

// Upload file with proper error handling
const uploadFile = async (filePath, options = {}) => {
  try {
    console.log('🔄 Uploading file to Cloudinary:', filePath);
    
    const defaultOptions = {
      resource_type: 'auto',
      use_filename: true,
      unique_filename: true,
      // CRITICAL: Ensure files are publicly accessible
      type: 'upload',
      access_mode: 'public',
      invalidate: true,
      ...options
    };
    
    const result = await cloudinary.uploader.upload(filePath, defaultOptions);
    
    console.log('✅ Upload successful:', {
      publicId: result.public_id,
      url: result.secure_url,
      format: result.format,
      bytes: result.bytes
    });
    
    return {
      success: true,
      data: {
        publicId: result.public_id,
        url: result.secure_url,
        format: result.format,
        resourceType: result.resource_type,
        bytes: result.bytes,
        width: result.width,
        height: result.height
      }
    };
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

const getSecureFileUrl = (publicId, resourceType = 'auto') => {
  if (!publicId) return null;
  
  try {
    // Generate a signed URL that expires in 1 hour
    const timestamp = Math.round(new Date().getTime() / 1000) + 3600; // 1 hour from now
    
    // Use the proper signed URL generation method
    const signedUrl = cloudinary.url(publicId, {
      resource_type: resourceType,
      secure: true,
      sign_url: true,
      expires_at: timestamp,
      flags: 'attachment' // Forces download instead of display
    });
    
    return signedUrl;
  } catch (error) {
    console.error('Error generating secure URL:', error);
    // Fallback to regular URL
    return cloudinary.url(publicId, {
      resource_type: resourceType,
      secure: true,
      flags: 'attachment'
    });
  }
};

const generateDownloadUrl = (publicId, originalName, resourceType = 'auto') => {
  if (!publicId) return null;
  
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    secure: true,
    flags: 'attachment',
    // Include original filename
    public_id: originalName ? `${publicId}/${originalName}` : publicId
  });
};

// Delete file from Cloudinary
const deleteFile = async (publicId, resourceType = 'auto') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });
    
    return {
      success: result.result === 'ok',
      data: result
    };
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get file info
const getFileInfo = async (publicId) => {
  try {
    const result = await cloudinary.api.resource(publicId);
    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error('Cloudinary get info error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Validate Cloudinary configuration
const validateConfig = () => {
  const config = cloudinary.config();
  const { cloud_name, api_key, api_secret } = config;
  
  console.log('🔍 Checking Cloudinary configuration...');
  console.log('Cloud Name:', cloud_name);
  console.log('API Key:', api_key ? `${api_key.substring(0, 6)}...` : 'NOT SET');
  console.log('API Secret:', api_secret ? 'SET' : 'NOT SET');
  
  if (!cloud_name || !api_key || !api_secret) {
    console.error('❌ Cloudinary configuration is incomplete. Please check your environment variables:');
    console.error('- CLOUDINARY_CLOUD_NAME or CLOUD_NAME');
    console.error('- CLOUDINARY_API_KEY or API_KEY'); 
    console.error('- CLOUDINARY_API_SECRET or SECRET_KEY');
    return false;
  }
  
  // Check if uploader is available
  if (!cloudinary.uploader) {
    console.error('❌ Cloudinary uploader is not available');
    return false;
  }
  
  console.log(`✅ Cloudinary configured for cloud: ${cloud_name}`);
  return true;
};

// Initialize and validate configuration
const isConfigValid = validateConfig();

if (!isConfigValid) {
  console.error('❌ Cloudinary configuration failed. File uploads will not work.');
  process.exit(1); // Exit if configuration is invalid
}

module.exports = {
  cloudinary,
  getCloudinaryUrl,
  getOptimizedImageUrl,
  getFileUrl,
  getThumbnailUrl,
  getSecureFileUrl,
  generateDownloadUrl,
  uploadFile,
  deleteFile,
  getFileInfo,
  validateConfig
};



