require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

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
 * Add a bypass signature to all supplier accounts that are missing one.
 * This allows suppliers to access their dashboard without going through
 * the IT signature submission process.
 */
async function addSupplierSignatures() {
  try {
    console.log('📤 ADDING BYPASS SIGNATURES TO SUPPLIER ACCOUNTS');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    // Find all suppliers missing a signature
    const suppliers = await User.find({
      role: 'supplier',
      $or: [
        { signature: { $exists: false } },
        { signature: null },
        { 'signature.url': { $exists: false } }
      ]
    });

    console.log(`Found ${suppliers.length} supplier(s) without a signature\n`);

    if (suppliers.length === 0) {
      console.log('✅ All suppliers already have signatures. Nothing to do.');
      process.exit(0);
    }

    const results = { success: 0, failed: 0, details: [] };

    for (const supplier of suppliers) {
      console.log(`\n👤 Processing: ${supplier.fullName}`);
      console.log(`   Email   : ${supplier.email}`);
      console.log(`   Company : ${supplier.supplierDetails?.companyName || 'N/A'}`);

      try {
        const bypassSignature = {
          url: `/uploads/user-signatures/${supplier._id}_signature_bypass.png`,
          filename: `${supplier._id}_signature_bypass.png`,
          originalName: 'supplier_bypass_signature.png',
          format: 'png',
          size: 0,
          signedBy: supplier.fullName,
          uploadedAt: new Date(),
          isBypass: true   // flag so you can identify these later
        };

        await User.updateOne(
          { _id: supplier._id },
          { $set: { signature: bypassSignature } }
        );

        console.log(`   ✅ Bypass signature added successfully`);
        console.log(`      URL: ${bypassSignature.url}`);

        results.success++;
        results.details.push({
          fullName: supplier.fullName,
          email: supplier.email,
          company: supplier.supplierDetails?.companyName || 'N/A',
          signatureUrl: bypassSignature.url,
          status: 'success'
        });

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        results.failed++;
        results.details.push({
          fullName: supplier.fullName,
          email: supplier.email,
          status: 'failed',
          reason: error.message
        });
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total suppliers found  : ${suppliers.length}`);
    console.log(`Successfully updated   : ${results.success} ✅`);
    console.log(`Failed                 : ${results.failed} ❌`);
    console.log('='.repeat(80) + '\n');

    console.log('📋 DETAILED RESULTS:');
    console.log('='.repeat(80));
    results.details.forEach((detail, index) => {
      console.log(`\n${index + 1}. ${detail.fullName}`);
      console.log(`   Email  : ${detail.email}`);
      console.log(`   Company: ${detail.company || 'N/A'}`);
      if (detail.status === 'success') {
        console.log(`   Status : ✅ SUCCESS`);
        console.log(`   URL    : ${detail.signatureUrl}`);
      } else {
        console.log(`   Status : ❌ FAILED`);
        console.log(`   Reason : ${detail.reason}`);
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ Done. Suppliers can now access their dashboards.\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Script failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  addSupplierSignatures();
}

module.exports = { addSupplierSignatures };