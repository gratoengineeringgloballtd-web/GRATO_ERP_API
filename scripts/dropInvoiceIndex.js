/**
 * Drop the old unique index from invoices collection
 * Run: node scripts/dropInvoiceIndex.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function dropIndex() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('invoices');

    // List all indexes
    const indexes = await collection.listIndexes().toArray();
    console.log('Current indexes:\n');
    indexes.forEach((idx, i) => {
      console.log(`  ${i}. ${idx.name}`);
      console.log(`     Keys: ${JSON.stringify(idx.key)}`);
      if (idx.unique) console.log(`     Unique: true`);
      console.log();
    });

    // Drop the old unique index if it exists
    const indexName = 'unique_po_invoice_employee';
    const indexExists = indexes.some(idx => idx.name === indexName);

    if (indexExists) {
      console.log(`🗑️  Dropping index: ${indexName}`);
      await collection.dropIndex(indexName);
      console.log(`✅ Index dropped successfully\n`);
    } else {
      console.log(`ℹ️  Index "${indexName}" not found\n`);
    }

    // Verify new indexes
    const newIndexes = await collection.listIndexes().toArray();
    console.log('Updated indexes:\n');
    newIndexes.forEach((idx, i) => {
      console.log(`  ${i}. ${idx.name}`);
      console.log(`     Keys: ${JSON.stringify(idx.key)}`);
      if (idx.unique) console.log(`     Unique: true`);
      console.log();
    });

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run
dropIndex();
