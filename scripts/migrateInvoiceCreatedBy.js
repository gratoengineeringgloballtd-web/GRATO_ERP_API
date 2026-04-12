/**
 * Migration script to add createdBy field to existing finance-prepared invoices
 * Run: node scripts/migrateInvoiceCreatedBy.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Invoice = require('../models/Invoice');
const User = require('../models/User');

async function migrateInvoices() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all invoices with finance role but no createdBy field
    const invoicesToMigrate = await Invoice.find({
      'createdByDetails.role': 'finance',
      createdBy: { $exists: false }
    });

    console.log(`\n📋 Found ${invoicesToMigrate.length} invoices to migrate\n`);

    if (invoicesToMigrate.length === 0) {
      console.log('✅ No invoices need migration!');
      await mongoose.disconnect();
      return;
    }

    let migratedCount = 0;
    let skippedCount = 0;

    for (const invoice of invoicesToMigrate) {
      try {
        // Get the email from createdByDetails
        const email = invoice.createdByDetails?.email;
        
        if (!email) {
          console.log(`⚠️  Skipped invoice ${invoice.invoiceNumber} - no email in createdByDetails`);
          skippedCount++;
          continue;
        }

        // Find user by email
        const user = await User.findOne({ email });
        
        if (!user) {
          console.log(`⚠️  Skipped invoice ${invoice.invoiceNumber} - user with email ${email} not found`);
          skippedCount++;
          continue;
        }

        // Update invoice with createdBy
        invoice.createdBy = user._id;
        await invoice.save();

        console.log(`✅ Migrated invoice ${invoice.invoiceNumber} - linked to user ${user.fullName}`);
        migratedCount++;

      } catch (error) {
        console.error(`❌ Error migrating invoice ${invoice.invoiceNumber}:`, error.message);
        skippedCount++;
      }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   - Successfully migrated: ${migratedCount}`);
    console.log(`   - Skipped: ${skippedCount}`);
    console.log(`   - Total: ${invoicesToMigrate.length}`);

    await mongoose.disconnect();
    console.log('\n✅ Migration completed and disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  }
}

// Run migration
migrateInvoices();
