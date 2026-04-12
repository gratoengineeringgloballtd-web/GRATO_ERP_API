// scripts/fixJustificationPaths.js
const mongoose = require('mongoose');
const CashRequest = require('../models/CashRequest');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

// Search for files in these possible locations
const SEARCH_LOCATIONS = [
  path.join(__dirname, '../uploads/justifications'),
  path.join(__dirname, '../uploads/temp'),
  path.join(__dirname, '../uploads/cash-requests'),
  path.join(__dirname, '../uploads/cash-requests/attachments'),
  path.join(__dirname, '../uploads/reimbursements'),
  'C:\\Users\\IT OFFICER\\Videos\\ERP_GRATO_API\\uploads\\justifications',
  'C:\\Users\\IT OFFICER\\Videos\\ERP_GRATO_API\\uploads\\temp'
];

/**
 * Recursively search for a file by name in a directory
 */
function findFileRecursively(directory, filename) {
  if (!fs.existsSync(directory)) return null;
  
  try {
    const files = fs.readdirSync(directory, { withFileTypes: true });
    
    for (const file of files) {
      const fullPath = path.join(directory, file.name);
      
      if (file.isDirectory()) {
        // Recursively search subdirectories
        const found = findFileRecursively(fullPath, filename);
        if (found) return found;
      } else if (file.name === filename) {
        return fullPath;
      }
    }
  } catch (error) {
    console.error(`Error searching ${directory}:`, error.message);
  }
  
  return null;
}

/**
 * Search for file in all known upload locations
 */
function findFile(publicId) {
  console.log(`   🔍 Searching for: ${publicId}`);
  
  for (const location of SEARCH_LOCATIONS) {
    const filePath = path.join(location, publicId);
    
    if (fs.existsSync(filePath)) {
      console.log(`   ✅ Found at: ${filePath}`);
      return filePath;
    }
  }
  
  // Try recursive search in uploads root
  const uploadsRoot = path.join(__dirname, '../uploads');
  const found = findFileRecursively(uploadsRoot, publicId);
  
  if (found) {
    console.log(`   ✅ Found (recursive): ${found}`);
    return found;
  }
  
  console.log(`   ❌ Not found anywhere`);
  return null;
}

async function fixJustificationPaths() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const requests = await CashRequest.find({
      'justification.documents.0': { $exists: true }
    });

    console.log(`\n📊 Found ${requests.length} requests with justification documents\n`);

    let fixedCount = 0;
    let notFoundCount = 0;
    let alreadyCorrectCount = 0;

    for (const request of requests) {
      console.log(`\n📄 Request: ${request._id} (${request.employee?.fullName || 'Unknown'})`);
      let hasChanges = false;

      for (const doc of request.justification.documents) {
        const currentPath = doc.localPath;

        // Check if current path is valid
        if (fs.existsSync(currentPath)) {
          console.log(`   ✅ Path already correct: ${currentPath}`);
          alreadyCorrectCount++;
          continue;
        }

        console.log(`   ❌ Invalid path: ${currentPath}`);

        // Try to find the file
        const foundPath = findFile(doc.publicId);

        if (foundPath) {
          // Update document paths
          doc.localPath = foundPath;
          doc.url = `/uploads/justifications/${doc.publicId}`;
          hasChanges = true;
          fixedCount++;
          console.log(`   ✅ Fixed: ${doc.name}`);
        } else {
          console.log(`   ⚠️  File not found: ${doc.name}`);
          notFoundCount++;
        }
      }

      if (hasChanges) {
        await request.save();
        console.log(`   💾 Updated request ${request._id}`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Fixed: ${fixedCount} documents`);
    console.log(`✓  Already correct: ${alreadyCorrectCount} documents`);
    console.log(`❌ Not found: ${notFoundCount} documents`);
    console.log('='.repeat(50));

    if (notFoundCount > 0) {
      console.log('\n⚠️  WARNING: Some files were not found.');
      console.log('These files may need to be re-uploaded by users.');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

fixJustificationPaths();