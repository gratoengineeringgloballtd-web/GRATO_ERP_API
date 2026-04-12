/**
 * Clean up duplicates and verify invoice collection
 * Run: node scripts/cleanupInvoices.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Invoice = require('../models/Invoice');

async function cleanup() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all invoices with the problematic invoice number
    const invoices = await Invoice.find({ invoiceNumber: 'GRAE-INV-IHS-2026-001' });
    
    console.log(`Found ${invoices.length} invoices with number GRAE-INV-IHS-2026-001`);
    
    if (invoices.length > 1) {
      console.log(`\n⚠️  Multiple invoices found! Details:\n`);
      invoices.forEach((inv, idx) => {
        console.log(`  ${idx + 1}. ID: ${inv._id}`);
        console.log(`     PO#: ${inv.poNumber}`);
        console.log(`     Amount: ${inv.totalAmount}`);
        console.log(`     Employee: ${inv.employee}`);
        console.log(`     CreatedBy: ${inv.createdBy}`);
        console.log(`     Status: ${inv.status}`);
        console.log();
      });

      // Delete all but keep one
      if (invoices.length > 1) {
        const toKeep = invoices[invoices.length - 1];
        const toDelete = invoices.slice(0, -1).map(inv => inv._id);
        
        console.log(`Deleting ${toDelete.length} duplicate(s)...`);
        const result = await Invoice.deleteMany({ _id: { $in: toDelete } });
        console.log(`✅ Deleted ${result.deletedCount} duplicate invoice(s)\n`);
      }
    } else if (invoices.length === 1) {
      console.log('✅ Only one invoice found - no duplicates\n');
    } else {
      console.log('✅ No invoices found with this number\n');
    }

    // Verify total invoices with this PO number
    const poInvoices = await Invoice.find({ poNumber: 'PO-2026-001' });
    console.log(`Total invoices for PO-2026-001: ${poInvoices.length}`);
    
    await mongoose.disconnect();
    console.log('\n✅ Cleanup complete and disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanup();
