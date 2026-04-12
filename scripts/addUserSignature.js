require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// Signature storage configuration
const BASE_UPLOAD_DIR = path.join(__dirname, '../uploads');
const SIGNATURES_DIR = path.join(BASE_UPLOAD_DIR, 'user-signatures');

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas\n');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

/**
 * Initialize signature storage directory
 */
async function initializeSignatureDirectory() {
  try {
    await fs.mkdir(SIGNATURES_DIR, { recursive: true, mode: 0o755 });
    console.log(`✓ Signature directory ready: ${SIGNATURES_DIR}\n`);
  } catch (error) {
    console.error(`❌ Failed to create signature directory:`, error);
    throw error;
  }
}

/**
 * Generate unique signature filename
 */
function generateSignatureFilename(userId, originalExt) {
  const timestamp = Date.now();
  const ext = originalExt.startsWith('.') ? originalExt : `.${originalExt}`;
  return `${userId}_signature_${timestamp}${ext}`;
}

/**
 * Save signature file to local storage
 */
async function saveSignatureFile(sourceFilePath, userId, originalFilename) {
  try {
    await initializeSignatureDirectory();

    // Get file extension
    const ext = path.extname(originalFilename).toLowerCase();
    
    // Validate file type
    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.svg'];
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
    }

    // Generate filename
    const filename = generateSignatureFilename(userId, ext);
    const destPath = path.join(SIGNATURES_DIR, filename);

    // Copy file to signatures directory
    await fs.copyFile(sourceFilePath, destPath);

    // Get file stats
    const stats = await fs.stat(destPath);

    // Generate URL (relative path for Express static serving)
    const relativePath = path.relative(BASE_UPLOAD_DIR, destPath).replace(/\\/g, '/');
    const fileUrl = `/uploads/${relativePath}`;

    console.log(`   ✓ Saved signature to: ${destPath}`);
    console.log(`   ✓ URL: ${fileUrl}`);

    return {
      url: fileUrl,
      localPath: destPath,
      filename: filename,
      originalName: originalFilename,
      format: ext.substring(1),
      size: stats.size,
      uploadedAt: new Date()
    };
  } catch (error) {
    console.error(`❌ Failed to save signature:`, error);
    throw error;
  }
}

/**
 * Delete signature file from local storage
 */
async function deleteSignatureFile(localPath) {
  try {
    if (fsSync.existsSync(localPath)) {
      await fs.unlink(localPath);
      console.log(`✓ Deleted signature: ${localPath}`);
      return { success: true };
    } else {
      console.warn(`⚠️  Signature file not found: ${localPath}`);
      return { success: false, error: 'File not found' };
    }
  } catch (error) {
    console.error(`❌ Failed to delete signature:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Add sample signature to any user (testing/placeholder)
 */
async function addSampleSignature(email) {
  try {
    console.log('✍️  ADDING SAMPLE SIGNATURE TO USER');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log('✅ Found user:', user.fullName);
    console.log('   Position:', user.position);
    console.log('   Department:', user.department);
    console.log('');

    // Check if signature already exists
    if (user.signature && user.signature.url) {
      console.log('⚠️  User already has a signature:');
      console.log('   URL:', user.signature.url);
      console.log('   Local Path:', user.signature.localPath);
      console.log('   Uploaded:', user.signature.uploadedAt);
      console.log('');
      
      const args = process.argv.slice(2);
      if (!args.includes('--force')) {
        console.log('To replace the signature, run with --force flag\n');
        process.exit(0);
      }
      
      console.log('🔄 Replacing existing signature...');
      // Delete old signature file
      if (user.signature.localPath) {
        await deleteSignatureFile(user.signature.localPath);
      }
      console.log('');
    }

    // For testing: create a placeholder file
    console.log('⚠️  NOTE: This is a test mode. To upload a real signature:');
    console.log(`   Run: node scripts/addUserSignature.js upload ${email} <signature_file_path>\n`);
    
    // Create sample signature data (placeholder)
    await initializeSignatureDirectory();
    const placeholderPath = path.join(SIGNATURES_DIR, `${user._id}_signature_sample.txt`);
    await fs.writeFile(placeholderPath, `Sample signature placeholder for ${user.fullName}`);
    
    const signatureData = {
      url: `/uploads/user-signatures/${user._id}_signature_sample.txt`,
      localPath: placeholderPath,
      filename: `${user._id}_signature_sample.txt`,
      originalName: 'sample_signature.txt',
      format: 'txt',
      size: 35,
      uploadedAt: new Date()
    };

    // Update user with signature
    user.signature = signatureData;
    await user.save();

    console.log('✅ Sample signature added successfully!\n');

    console.log('📊 SIGNATURE DETAILS');
    console.log('='.repeat(80));
    console.log(`User               : ${user.fullName}`);
    console.log(`Email              : ${user.email}`);
    console.log(`Signature URL      : ${signatureData.url}`);
    console.log(`Local Path         : ${signatureData.localPath}`);
    console.log(`Format             : ${signatureData.format}`);
    console.log(`Size               : ${(signatureData.size / 1024).toFixed(2)} KB`);
    console.log(`Uploaded           : ${signatureData.uploadedAt.toLocaleString()}`);
    console.log('='.repeat(80) + '\n');

    console.log('✅ SIGNATURE ADDED SUCCESSFULLY!\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Failed to add signature:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Upload signature file and add to user
 */
async function uploadAndAddSignature(email, signatureFilePath) {
  try {
    console.log('📤 UPLOADING SIGNATURE TO LOCAL STORAGE');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log('✅ Found user:', user.fullName);
    console.log('   Position:', user.position);
    console.log('   Department:', user.department);
    console.log('');

    // Resolve the file path (handles relative paths correctly)
    const resolvedFilePath = path.resolve(signatureFilePath);
    
    // Check if file exists
    if (!fsSync.existsSync(resolvedFilePath)) {
      console.error(`❌ Signature file not found: ${signatureFilePath}`);
      console.error(`   Resolved to: ${resolvedFilePath}`);
      console.error(`   Current directory: ${process.cwd()}`);
      process.exit(1);
    }

    const fileStats = fsSync.statSync(resolvedFilePath);
    const fileExt = path.extname(resolvedFilePath).toLowerCase();
    const originalFilename = path.basename(resolvedFilePath);

    console.log('📁 File details:');
    console.log('   Input path:', signatureFilePath);
    console.log('   Resolved path:', resolvedFilePath);
    console.log('   Size:', (fileStats.size / 1024).toFixed(2), 'KB');
    console.log('   Format:', fileExt);
    console.log('');

    // Check if user already has signature
    if (user.signature && user.signature.localPath) {
      console.log('⚠️  User already has a signature. Deleting old signature...');
      await deleteSignatureFile(user.signature.localPath);
    }

    console.log('💾 Saving signature to local storage...');

    // Save signature file
    const signatureData = await saveSignatureFile(
      resolvedFilePath,
      user._id,
      originalFilename
    );

    // Update user with signature
    user.signature = signatureData;
    await user.save();

    console.log('\n✅ User updated with signature!\n');

    console.log('📊 SIGNATURE DETAILS');
    console.log('='.repeat(80));
    console.log(`User               : ${user.fullName}`);
    console.log(`Email              : ${user.email}`);
    console.log(`Position           : ${user.position}`);
    console.log(`Signature URL      : ${user.signature.url}`);
    console.log(`Local Path         : ${user.signature.localPath}`);
    console.log(`Format             : ${user.signature.format}`);
    console.log(`Size               : ${(user.signature.size / 1024).toFixed(2)} KB`);
    console.log(`Uploaded           : ${user.signature.uploadedAt.toLocaleString()}`);
    console.log('='.repeat(80) + '\n');

    console.log('✅ SIGNATURE UPLOAD COMPLETE!\n');
    console.log('💡 TIP: Make sure your Express app serves static files from:');
    console.log(`   app.use('/uploads', express.static('${BASE_UPLOAD_DIR}'));\n`);

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Upload failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Add signature URL directly (if already uploaded)
 */
async function addSignatureURL(email, signatureURL, localPath = null) {
  try {
    console.log('🔗 ADDING SIGNATURE URL TO USER');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log('✅ Found user:', user.fullName);
    console.log('');

    // Extract format from URL
    const urlParts = signatureURL.split('.');
    const format = urlParts[urlParts.length - 1].split('?')[0];

    user.signature = {
      url: signatureURL,
      localPath: localPath || signatureURL,
      filename: path.basename(signatureURL),
      originalName: path.basename(signatureURL),
      format: format,
      size: 0, // Unknown if not uploaded through this script
      uploadedAt: new Date()
    };

    await user.save();

    console.log('✅ Signature URL added successfully!\n');

    console.log('📊 SIGNATURE DETAILS');
    console.log('='.repeat(80));
    console.log(`User               : ${user.fullName}`);
    console.log(`Email              : ${user.email}`);
    console.log(`Signature URL      : ${user.signature.url}`);
    console.log(`Local Path         : ${user.signature.localPath}`);
    console.log(`Format             : ${user.signature.format}`);
    console.log('='.repeat(80) + '\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Bulk add signatures from a directory
 */
async function bulkAddSignatures(signaturesDir) {
  try {
    console.log('📤 BULK UPLOADING SIGNATURES');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    if (!fsSync.existsSync(signaturesDir)) {
      console.error(`❌ Directory not found: ${signaturesDir}`);
      process.exit(1);
    }

    // Expected file naming: email_signature.png or email_signature.jpg
    const files = (await fs.readdir(signaturesDir)).filter(f => 
      f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.svg')
    );

    console.log(`Found ${files.length} signature files\n`);

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    for (const file of files) {
      const filePath = path.join(signaturesDir, file);
      
      // Extract email from filename (e.g., kelvin.eyong@gratoglobal.com_signature.png)
      const emailMatch = file.match(/^(.+?)_signature\.(png|jpg|jpeg|svg)$/i);
      
      if (!emailMatch) {
        console.log(`⚠️  Skipping ${file}: Invalid filename format (expected: email_signature.ext)`);
        results.skipped++;
        continue;
      }

      const email = emailMatch[1];
      console.log(`Processing: ${email}...`);

      try {
        const user = await User.findOne({ email: email.toLowerCase() });
        
        if (!user) {
          console.log(`   ❌ User not found: ${email}`);
          results.failed++;
          results.errors.push({ file, error: 'User not found' });
          continue;
        }

        // Delete old signature if exists
        if (user.signature && user.signature.localPath) {
          await deleteSignatureFile(user.signature.localPath);
        }

        // Save new signature
        const signatureData = await saveSignatureFile(
          filePath,
          user._id,
          file
        );

        user.signature = signatureData;
        await user.save();

        console.log(`   ✅ ${user.fullName} - Signature uploaded`);
        results.success++;

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        results.failed++;
        results.errors.push({ file, error: error.message });
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 BULK UPLOAD SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total files        : ${files.length}`);
    console.log(`Successful         : ${results.success} ✅`);
    console.log(`Failed             : ${results.failed} ❌`);
    console.log(`Skipped            : ${results.skipped} ⚠️`);
    console.log('='.repeat(80) + '\n');

    if (results.errors.length > 0) {
      console.log('❌ ERRORS:');
      results.errors.forEach(err => {
        console.log(`   ${err.file}: ${err.error}`);
      });
      console.log('');
    }

    console.log('💡 TIP: Make sure your Express app serves static files from:');
    console.log(`   app.use('/uploads', express.static('${BASE_UPLOAD_DIR}'));\n`);

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Bulk upload failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * List all user signatures
 */
async function listAllSignatures() {
  try {
    console.log('📋 LISTING ALL USER SIGNATURES');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    const users = await User.find({
      'signature.url': { $exists: true, $ne: null }
    }).select('fullName email position department signature');

    console.log(`Found ${users.length} users with signatures\n`);

    if (users.length === 0) {
      console.log('No signatures found.\n');
      process.exit(0);
    }

    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.fullName} (${user.email})`);
      console.log(`   Position: ${user.position}`);
      console.log(`   Department: ${user.department}`);
      console.log(`   URL: ${user.signature.url}`);
      console.log(`   Local: ${user.signature.localPath}`);
      console.log(`   Format: ${user.signature.format}`);
      console.log(`   Size: ${user.signature.size ? (user.signature.size / 1024).toFixed(2) + ' KB' : 'Unknown'}`);
      console.log(`   Uploaded: ${user.signature.uploadedAt ? user.signature.uploadedAt.toLocaleString() : 'Unknown'}`);
      console.log('');
    });

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Failed to list signatures:', error);
    process.exit(1);
  }
}

/**
 * Delete user signature
 */
async function deleteUserSignature(email) {
  try {
    console.log('🗑️  DELETING USER SIGNATURE');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log('✅ Found user:', user.fullName);
    console.log('');

    if (!user.signature || !user.signature.url) {
      console.log('⚠️  User has no signature to delete.\n');
      process.exit(0);
    }

    console.log('Current signature:');
    console.log('   URL:', user.signature.url);
    console.log('   Local Path:', user.signature.localPath);
    console.log('');

    // Delete file from storage
    if (user.signature.localPath) {
      await deleteSignatureFile(user.signature.localPath);
    }

    // Remove from database
    user.signature = undefined;
    await user.save();

    console.log('✅ Signature deleted successfully!\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Failed to delete signature:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

if (require.main === module) {
  switch (command) {
    case 'sample':
    case '--sample':
      if (!args[1]) {
        console.log('Usage: node scripts/addUserSignature.js sample <email>');
        console.log('Example: node scripts/addUserSignature.js sample kelvin.eyong@gratoglobal.com\n');
        process.exit(0);
      }
      addSampleSignature(args[1]);
      break;

    case 'upload':
    case '--upload':
      if (!args[1] || !args[2]) {
        console.log('Usage: node scripts/addUserSignature.js upload <email> <signature_file_path>');
        console.log('Example: node scripts/addUserSignature.js upload kelvin.eyong@gratoglobal.com ./signatures/kelvin.png\n');
        process.exit(0);
      }
      uploadAndAddSignature(args[1], args[2]);
      break;

    case 'add-url':
    case '--url':
      if (!args[1] || !args[2]) {
        console.log('Usage: node scripts/addUserSignature.js add-url <email> <signature_url> [local_path]');
        console.log('Example: node scripts/addUserSignature.js add-url kelvin.eyong@gratoglobal.com /uploads/user-signatures/kelvin.png\n');
        process.exit(0);
      }
      addSignatureURL(args[1], args[2], args[3]);
      break;

    case 'bulk':
    case '--bulk':
      if (!args[1]) {
        console.log('Usage: node scripts/addUserSignature.js bulk <signatures_directory>');
        console.log('Example: node scripts/addUserSignature.js bulk ./signatures\n');
        console.log('File naming convention: email_signature.png');
        console.log('   kelvin.eyong@gratoglobal.com_signature.png');
        console.log('   bruiline.tsitoh@gratoglobal.com_signature.png\n');
        process.exit(0);
      }
      bulkAddSignatures(args[1]);
      break;

    case 'list':
    case '--list':
      listAllSignatures();
      break;

    case 'delete':
    case '--delete':
      if (!args[1]) {
        console.log('Usage: node scripts/addUserSignature.js delete <email>');
        console.log('Example: node scripts/addUserSignature.js delete kelvin.eyong@gratoglobal.com\n');
        process.exit(0);
      }
      deleteUserSignature(args[1]);
      break;

    default:
      console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                ADD USER SIGNATURES - GRATO GLOBAL ERP                     ║
║                    (Local File Storage Version)                           ║
╚═══════════════════════════════════════════════════════════════════════════╝

IMPORTANT: Before running this script, add the signature field to your User model:

signature: {
  url: String,
  localPath: String,
  filename: String,
  originalName: String,
  format: String,
  size: Number,
  uploadedAt: Date
}

Also ensure your Express app serves static files:
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

Usage:
  node scripts/addUserSignature.js [command] [arguments]

Commands:

  sample <email>
    Add a sample/placeholder signature to any user (for testing)
    Example: node scripts/addUserSignature.js sample kelvin.eyong@gratoglobal.com
    Example: node scripts/addUserSignature.js sample bruiline.tsitoh@gratoglobal.com

  upload <email> <file_path>
    Upload a signature file to local storage and add to user
    Example: node scripts/addUserSignature.js upload kelvin.eyong@gratoglobal.com ./signatures/kelvin.png
    Example: node scripts/addUserSignature.js upload bruiline.tsitoh@gratoglobal.com public/signatures/bruiline.jpeg

  add-url <email> <signature_url> [local_path]
    Add an already uploaded signature URL to user
    Example: node scripts/addUserSignature.js add-url kelvin.eyong@gratoglobal.com /uploads/user-signatures/sig.png

  bulk <signatures_directory>
    Bulk upload all signatures from a directory
    Example: node scripts/addUserSignature.js bulk ./signatures
    
    File naming convention: email_signature.png
      kelvin.eyong@gratoglobal.com_signature.png
      bruiline.tsitoh@gratoglobal.com_signature.png

  list
    List all users with signatures
    Example: node scripts/addUserSignature.js list

  delete <email>
    Delete a user's signature
    Example: node scripts/addUserSignature.js delete kelvin.eyong@gratoglobal.com

Storage:
  📁 Signatures stored in: uploads/user-signatures/
  🌐 Accessible via: /uploads/user-signatures/filename
  📦 Format: userId_signature_timestamp.ext

Supported Formats:
  ✅ PNG (.png)
  ✅ JPEG (.jpg, .jpeg)
  ✅ SVG (.svg)

Features:
  ✅ Store files locally (no cloud dependency)
  ✅ Automatic file naming and organization
  ✅ Replace existing signatures (with --force)
  ✅ Bulk upload multiple signatures
  ✅ Delete signatures (file + database)
  ✅ List all user signatures

Signature Usage:
  - Display on approval documents
  - Show on requisition forms
  - Include in official reports
  - Verify document authenticity

Next Steps:
  1. Update your User model with signature field
  2. Ensure Express serves /uploads directory
  3. Upload signature files
  4. Integrate into approval workflows
      `);
      process.exit(0);
  }
}

module.exports = {
  addSampleSignature,
  uploadAndAddSignature,
  addSignatureURL,
  bulkAddSignatures,
  listAllSignatures,
  deleteUserSignature
};