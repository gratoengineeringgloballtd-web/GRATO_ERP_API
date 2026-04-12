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
 * Extract name from filename
 * Bechem-removebg-preview.png → Bechem
 * Carmel_Dafny_signature-removebg-preview.png → Carmel Dafny
 */
function extractNameFromFilename(filename) {
  let name = path.basename(filename, path.extname(filename));
  
  // Remove "-removebg-preview" or "-remove" suffix
  name = name.replace(/-removebg-preview$/i, '')
             .replace(/-remove$/i, '');
  
  // Replace underscores with spaces
  name = name.replace(/_/g, ' ');
  
  return name.trim();
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
 * Search for user by name (fuzzy matching)
 */
async function findUserByName(nameToSearch) {
  try {
    // Try exact match first (case-insensitive)
    let user = await User.findOne({
      fullName: new RegExp(`\\b${nameToSearch}\\b`, 'i')
    });

    if (user) return user;

    // Try partial match - name appears anywhere in fullName
    user = await User.findOne({
      fullName: new RegExp(nameToSearch, 'i')
    });

    if (user) return user;

    // Try matching first name
    const firstNameRegex = new RegExp(`^${nameToSearch}`, 'i');
    user = await User.findOne({
      fullName: firstNameRegex
    });

    return user;
  } catch (error) {
    console.error(`Error searching for user "${nameToSearch}":`, error);
    return null;
  }
}

/**
 * Attach all signatures to users
 */
async function attachAllSignatures() {
  try {
    console.log('📤 ATTACHING SIGNATURES TO USERS');
    console.log('='.repeat(80) + '\n');

    await connectDB();
    await initializeSignatureDirectory();

    // Read all signature files from public/signatures
    if (!fsSync.existsSync(SOURCE_SIGNATURES_DIR)) {
      console.error(`❌ Signatures directory not found: ${SOURCE_SIGNATURES_DIR}`);
      process.exit(1);
    }

    const files = await fs.readdir(SOURCE_SIGNATURES_DIR);
    const signatureFiles = files.filter(f => 
      f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.svg')
    );

    console.log(`Found ${signatureFiles.length} signature files\n`);

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      details: []
    };

    for (const file of signatureFiles) {
      const sourceFilePath = path.join(SOURCE_SIGNATURES_DIR, file);
      
      // Extract name from filename
      const extractedName = extractNameFromFilename(file);
      console.log(`\n📄 Processing: ${file}`);
      console.log(`   Extracted name: "${extractedName}"`);

      try {
        // Find user by name
        const user = await findUserByName(extractedName);
        
        if (!user) {
          console.log(`   ⚠️  User not found`);
          results.skipped++;
          results.details.push({
            file,
            extractedName,
            status: 'skipped',
            reason: 'User not found'
          });
          continue;
        }

        console.log(`   ✅ Found user: ${user.fullName}`);
        console.log(`      Email: ${user.email}`);
        console.log(`      Position: ${user.position}`);

        // Check if user already has signature
        if (user.signature && user.signature.url) {
          console.log(`   ⚠️  User already has a signature`);
          results.details.push({
            file,
            extractedName,
            userId: user._id,
            fullName: user.fullName,
            status: 'skipped',
            reason: 'Already has signature'
          });
          continue;
        }

        // Copy signature file
        console.log(`   💾 Copying signature file...`);
        const signatureData = await copySignatureFile(
          sourceFilePath,
          user._id,
          file
        );

        // Update user with signature
        user.signature = signatureData;
        await user.save();

        console.log(`   ✅ Signature attached successfully!`);
        console.log(`      URL: ${signatureData.url}`);
        
        results.success++;
        results.details.push({
          file,
          extractedName,
          userId: user._id,
          fullName: user.fullName,
          email: user.email,
          signatureUrl: signatureData.url,
          status: 'success'
        });

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        results.failed++;
        results.details.push({
          file,
          extractedName,
          status: 'failed',
          reason: error.message
        });
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 ATTACHMENT SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total files        : ${signatureFiles.length}`);
    console.log(`Successful         : ${results.success} ✅`);
    console.log(`Failed             : ${results.failed} ❌`);
    console.log(`Skipped            : ${results.skipped} ⚠️`);
    console.log('='.repeat(80) + '\n');

    // Print detailed results
    console.log('📋 DETAILED RESULTS:');
    console.log('='.repeat(80));
    
    results.details.forEach((detail, index) => {
      console.log(`\n${index + 1}. ${detail.file}`);
      console.log(`   Name extracted: "${detail.extractedName}"`);
      
      if (detail.status === 'success') {
        console.log(`   Status: ✅ SUCCESS`);
        console.log(`   User: ${detail.fullName}`);
        console.log(`   Email: ${detail.email}`);
        console.log(`   Signature URL: ${detail.signatureUrl}`);
      } else if (detail.status === 'skipped') {
        console.log(`   Status: ⚠️ SKIPPED`);
        console.log(`   Reason: ${detail.reason}`);
        if (detail.fullName) {
          console.log(`   User: ${detail.fullName}`);
        }
      } else {
        console.log(`   Status: ❌ FAILED`);
        console.log(`   Reason: ${detail.reason}`);
      }
    });

    console.log('\n' + '='.repeat(80) + '\n');

    if (results.success > 0) {
      console.log('✅ SIGNATURES ATTACHED SUCCESSFULLY!\n');
    }

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Attachment process failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the attachment process
if (require.main === module) {
  attachAllSignatures();
}

module.exports = { attachAllSignatures };
