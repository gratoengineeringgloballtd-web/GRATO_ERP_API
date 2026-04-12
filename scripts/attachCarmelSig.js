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
const SOURCE_SIGNATURES_DIR = path.join(__dirname, '../public/signatures');

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
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
 * Copy signature file to uploads directory
 */
async function copySignatureFile(sourceFilePath, userId, originalFilename) {
  try {
    await initializeSignatureDirectory();

    // Get file extension
    const ext = path.extname(originalFilename).toLowerCase();
    
    // Generate filename
    const filename = generateSignatureFilename(userId, ext);
    const destPath = path.join(SIGNATURES_DIR, filename);

    // Copy file
    await fs.copyFile(sourceFilePath, destPath);

    // Get file stats
    const stats = await fs.stat(destPath);

    // Generate URL
    const relativePath = path.relative(BASE_UPLOAD_DIR, destPath).replace(/\\/g, '/');
    const fileUrl = `/uploads/${relativePath}`;

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
    console.error(`❌ Failed to copy signature:`, error);
    throw error;
  }
}

/**
 * Attach Carmel signature
 */
async function attachCarmelSignature() {
  try {
    console.log('📤 ATTACHING CARMEL SIGNATURE');
    console.log('='.repeat(80) + '\n');

    await connectDB();
    await initializeSignatureDirectory();

    // Find Carmel Dafny
    const user = await User.findOne({
      fullName: 'Carmel Dafny'
    });

    if (!user) {
      console.error('❌ User "Carmel Dafny" not found\n');
      process.exit(1);
    }

    console.log('✅ Found user: ' + user.fullName);
    console.log('   ID: ' + user._id);
    console.log('   Email: ' + user.email);
    console.log('   Position: ' + user.position);
    console.log('   Department: ' + user.department);
    console.log('');

    // Check if already has signature
    if (user.signature && user.signature.url) {
      console.log('⚠️  User already has a signature:');
      console.log('   URL: ' + user.signature.url);
      console.log('');
      const args = process.argv.slice(2);
      if (!args.includes('--force')) {
        console.log('Use --force flag to replace\n');
        process.exit(0);
      }
    }

    // Find the Carmel signature file
    const sourceFile = path.join(SOURCE_SIGNATURES_DIR, 'Carmel-removebg-preview.png');

    if (!fsSync.existsSync(sourceFile)) {
      console.error('❌ Signature file not found: ' + sourceFile);
      process.exit(1);
    }

    console.log('📁 Signature file found');
    console.log('   Path: ' + sourceFile);
    console.log('');

    // Copy and attach signature
    console.log('💾 Attaching signature...');
    const signatureData = await copySignatureFile(
      sourceFile,
      user._id,
      'Carmel-removebg-preview.png'
    );

    user.signature = signatureData;
    await user.save();

    console.log('✅ Signature attached successfully!\n');

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

    console.log('✅ CARMEL SIGNATURE ATTACHED SUCCESSFULLY!\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the attachment
if (require.main === module) {
  attachCarmelSignature();
}

module.exports = { attachCarmelSignature };
