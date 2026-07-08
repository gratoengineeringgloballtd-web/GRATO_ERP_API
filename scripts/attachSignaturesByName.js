require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

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

async function initializeSignatureDirectory() {
  await fs.mkdir(SIGNATURES_DIR, { recursive: true, mode: 0o755 });
}

function generateSignatureFilename(userId, originalExt) {
  const timestamp = Date.now();
  const ext = originalExt.startsWith('.') ? originalExt : `.${originalExt}`;
  return `${userId}_signature_${timestamp}${ext}`;
}

async function copySignatureFile(sourceFilePath, userId, originalFilename) {
  await initializeSignatureDirectory();

  const ext = path.extname(originalFilename).toLowerCase();
  const filename = generateSignatureFilename(userId, ext);
  const destPath = path.join(SIGNATURES_DIR, filename);

  await fs.copyFile(sourceFilePath, destPath);

  const stats = await fs.stat(destPath);
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
}

/**
 * Attach a specific signature file to a specific user by email
 */
async function attachSignatureToUser(signatureFilename, userEmail) {
  try {
    console.log('📤 ATTACHING SIGNATURE TO USER');
    console.log('='.repeat(60) + '\n');
    console.log(`   Signature file : ${signatureFilename}`);
    console.log(`   Target email   : ${userEmail}\n`);

    await connectDB();

    // Resolve source file — try with and without extension
    let sourceFilePath = null;
    const candidates = [
      path.join(SOURCE_SIGNATURES_DIR, signatureFilename),
      ...['png', 'jpg', 'jpeg', 'svg'].map(ext =>
        path.join(SOURCE_SIGNATURES_DIR, `${signatureFilename}.${ext}`)
      )
    ];

    for (const candidate of candidates) {
      if (fsSync.existsSync(candidate)) {
        sourceFilePath = candidate;
        break;
      }
    }

    if (!sourceFilePath) {
      console.error(`❌ Signature file not found in: ${SOURCE_SIGNATURES_DIR}`);
      console.error(`   Tried: ${candidates.map(c => path.basename(c)).join(', ')}`);
      process.exit(1);
    }

    console.log(`✅ Signature file found: ${path.basename(sourceFilePath)}\n`);

    // Find user by email (case-insensitive)
    const user = await User.findOne({ email: new RegExp(`^${userEmail}$`, 'i') });

    if (!user) {
      console.error(`❌ No user found with email: ${userEmail}`);
      process.exit(1);
    }

    console.log(`✅ User found:`);
    console.log(`   Name     : ${user.fullName}`);
    console.log(`   Email    : ${user.email}`);
    console.log(`   Position : ${user.position || 'N/A'}\n`);

    // Warn if signature already exists but proceed
    if (user.signature && user.signature.url) {
      console.log(`⚠️  User already has a signature: ${user.signature.url}`);
      console.log(`   Overwriting with new signature...\n`);
    }

    // Copy and attach
    console.log(`💾 Copying signature file...`);
    const signatureData = await copySignatureFile(
      sourceFilePath,
      user._id,
      path.basename(sourceFilePath)
    );

    user.signature = signatureData;
    await user.save();

    console.log(`✅ Signature attached successfully!`);
    console.log(`   URL  : ${signatureData.url}`);
    console.log(`   Size : ${(signatureData.size / 1024).toFixed(1)} KB`);

    console.log('\n' + '='.repeat(60) + '\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// --- Entry point ---
// Usage: node attach-signature-by-email.js <filename> <email>
// Example: node attach-signature-by-email.js marcelngong50-removebg-preview marcelngong50@gmail.com

const [,, filenameArg, emailArg] = process.argv;

if (filenameArg && emailArg) {
  attachSignatureToUser(filenameArg, emailArg);
} else {
  // Default: the specific case requested
  attachSignatureToUser(
    'marcelngong50-removebg-preview',
    'marcelngong50@gmail.com'
  );
}

module.exports = { attachSignatureToUser };





// node attach-signature-by-email.js "Minka-removebg-preview" "minka.kevin@gratoglobal.com"