// scripts/deleteSupplierApplication.js
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

require('dotenv').config();

// ACTION: 'delete' or 'changePassword'
const ACTION = process.env.SCRIPT_ACTION || 'changePassword';

// Specify the supplier application / user to target
const SUPPLIER_IDENTIFIER = {
  // Set the supplier email or _id here
  email: 'marcelngong50@gmail.com',
  // Or: _id: '6970df46473211b313cd729c'
};

/**
 * Delete a file safely
 */
function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`   🗑️  Deleted file: ${filePath}`);
      return true;
    } else {
      console.log(`   ⚠️  File not found: ${filePath}`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ Error deleting file ${filePath}:`, error.message);
    return false;
  }
}

// Invoke the script
deleteSupplierApplication();

/**
 * Delete supplier documents from filesystem
 */
function deleteSupplierDocuments(documents) {
  console.log('\n📁 Deleting supplier documents...');
  
  if (!documents) {
    console.log('   ℹ️  No documents to delete');
    return;
  }

  let deletedCount = 0;
  let failedCount = 0;

  // Delete business registration certificate
  if (documents.businessRegistrationCertificate?.url) {
    const filePath = path.join(__dirname, '..', documents.businessRegistrationCertificate.url);
    deleteFile(filePath) ? deletedCount++ : failedCount++;
  }

  // Delete tax clearance certificate
  if (documents.taxClearanceCertificate?.url) {
    const filePath = path.join(__dirname, '..', documents.taxClearanceCertificate.url);
    deleteFile(filePath) ? deletedCount++ : failedCount++;
  }

  // Delete bank statement
  if (documents.bankStatement?.url) {
    const filePath = path.join(__dirname, '..', documents.bankStatement.url);
    deleteFile(filePath) ? deletedCount++ : failedCount++;
  }

  // Delete additional documents
  if (Array.isArray(documents.additionalDocuments)) {
    for (const doc of documents.additionalDocuments) {
      if (doc.url) {
        const filePath = path.join(__dirname, '..', doc.url);
        deleteFile(filePath) ? deletedCount++ : failedCount++;
      }
    }
  }

  console.log(`   ✅ Deleted ${deletedCount} files`);
  if (failedCount > 0) {
    console.log(`   ⚠️  Failed to delete ${failedCount} files`);
  }
}

async function deleteSupplierApplication() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Build query based on identifier
    let query = {};
    if (SUPPLIER_IDENTIFIER.email) {
      query.email = SUPPLIER_IDENTIFIER.email;
    } else if (SUPPLIER_IDENTIFIER.applicationId) {
      query.applicationId = SUPPLIER_IDENTIFIER.applicationId;
    } else if (SUPPLIER_IDENTIFIER._id) {
      query._id = SUPPLIER_IDENTIFIER._id;
    } else {
      console.log('❌ No supplier identifier specified.');
      process.exit(1);
    }

    // Get list of all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📚 Available collections:');
    collections.forEach(col => console.log(`   - ${col.name}`));
    console.log('');

    // Try to find the supplier in different possible collections
    let supplier = null;
    let collectionName = null;

    // Common collection names for supplier applications
    const possibleCollections = [
      'supplierapplications',
      'supplier_applications', 
      'SupplierApplication',
      'supplierApplications',
      'users',
      'suppliers'
    ];

    for (const collName of possibleCollections) {
      try {
        const collection = mongoose.connection.db.collection(collName);
        const result = await collection.findOne(query);
        if (result) {
          supplier = result;
          collectionName = collName;
          break;
        }
      } catch (error) {
        // Collection doesn't exist, continue
      }
    }

    if (!supplier) {
      console.log(`❌ Supplier not found with identifier:`, SUPPLIER_IDENTIFIER);
      console.log('\n💡 Try searching in MongoDB Compass or check the exact collection name.');
      process.exit(1);
    }

    console.log('📋 SUPPLIER APPLICATION DETAILS');
    console.log('='.repeat(60));
    console.log(`Collection: ${collectionName}`);
    console.log(`ID: ${supplier._id}`);
    console.log(`Application ID: ${supplier.applicationId || 'N/A'}`);
    console.log(`Email: ${supplier.email}`);
    console.log(`Contact Name: ${supplier.contactName || 'N/A'}`);
    console.log(`Company: ${supplier.companyName || 'N/A'}`);
    console.log(`Status: ${supplier.status || 'N/A'}`);
    console.log(`Business Reg #: ${supplier.businessRegistrationNumber || 'N/A'}`);
    console.log(`Tax ID: ${supplier.taxIdNumber || 'N/A'}`);
    console.log(`Phone: ${supplier.phoneNumber || 'N/A'}`);
    console.log(`Supplier Type: ${supplier.supplierType || 'N/A'}`);
    console.log(`Submitted: ${supplier.submittedAt || 'N/A'}`);
    console.log(`Created: ${supplier.createdAt}`);
    console.log('='.repeat(60));

    // Show review history if exists
    if (supplier.reviewHistory?.length > 0) {
      console.log('\n📝 Review History:');
      supplier.reviewHistory.forEach((review, index) => {
        console.log(`   ${index + 1}. ${review.status} - ${review.reviewedAt}`);
      });
    }

    // Show documents
    const docs = supplier.documents;
    if (docs) {
      console.log('\n📄 Documents to be deleted:');
      let docCount = 0;
      
      if (docs.businessRegistrationCertificate) {
        docCount++;
        console.log(`   ${docCount}. Business Registration: ${docs.businessRegistrationCertificate.name}`);
        console.log(`      Size: ${(docs.businessRegistrationCertificate.size / 1024).toFixed(2)} KB`);
      }
      if (docs.taxClearanceCertificate) {
        docCount++;
        console.log(`   ${docCount}. Tax Clearance: ${docs.taxClearanceCertificate.name}`);
        console.log(`      Size: ${(docs.taxClearanceCertificate.size / 1024).toFixed(2)} KB`);
      }
      if (docs.bankStatement) {
        docCount++;
        console.log(`   ${docCount}. Bank Statement: ${docs.bankStatement.name}`);
        console.log(`      Size: ${(docs.bankStatement.size / 1024).toFixed(2)} KB`);
      }
      if (docs.additionalDocuments?.length > 0) {
        docs.additionalDocuments.forEach((doc, index) => {
          docCount++;
          console.log(`   ${docCount}. Additional: ${doc.name}`);
          console.log(`      Size: ${(doc.size / 1024).toFixed(2)} KB`);
        });
      }
      console.log(`\n   Total: ${docCount} document(s)`);
    }

    console.log('\n⚠️  WARNING: This action cannot be undone!');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');

    // Wait 5 seconds before proceeding
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Obtain collection reference
    const collection = mongoose.connection.db.collection(collectionName);

    if (ACTION === 'changePassword') {
      console.log('\n🔐 Changing password for user...');

      // Generate a new temporary password (16 hex chars)
      const newPassword = crypto.randomBytes(8).toString('hex');
      const saltRounds = 12;
      const hashed = await bcrypt.hash(newPassword, saltRounds);

      const updateResult = await collection.updateOne({ _id: supplier._id }, { $set: { password: hashed } });

      if (updateResult.matchedCount === 0) {
        console.error('❌ Failed to find the user for password update.');
        process.exit(1);
      }

      if (updateResult.modifiedCount === 0) {
        console.warn('⚠️  Password update did not modify the document (it may already have that password).');
      }

      console.log('\n✅ Password updated successfully.');
      console.log('--- NEW CREDENTIALS ---');
      console.log(`Email: ${supplier.email}`);
      console.log(`New Password: ${newPassword}`);
      console.log('----------------------');

      process.exit(0);
    }

    // Default action: delete (existing behavior)
    // Delete documents from filesystem
    if (supplier.documents) {
      deleteSupplierDocuments(supplier.documents);
    }

    // Delete supplier from database
    console.log('\n🗑️  Deleting supplier application from database...');
    await collection.deleteOne({ _id: supplier._id });

    console.log('\n' + '='.repeat(60));
    console.log('✅ DELETION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Supplier application for "${supplier.contactName}" has been permanently deleted.`);
    console.log(`Email: ${supplier.email}`);
    console.log(`Application ID: ${supplier.applicationId}`);
    console.log(`Collection: ${collectionName}`);
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Deletion failed:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

