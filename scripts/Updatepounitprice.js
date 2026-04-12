const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PurchaseOrder = require('../models/PurchaseOrder');

async function updatePOUnitPrice() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // const poNumber = process.argv[2];
    // const oldPrice = Number(process.argv[3]);
    // const newPrice = Number(process.argv[4]);

    const poNumber = "PO-2026-000050";
    const oldPrice = 380000;
    const newPrice = 385000;

    if (!poNumber || !oldPrice || !newPrice) {
      console.log('Usage:   node scripts/updatePOUnitPrice.js <PO_NUMBER> <OLD_PRICE> <NEW_PRICE>');
      console.log('Example: node scripts/updatePOUnitPrice.js PO-2026-000050 380000 385000');
      await mongoose.disconnect();
      return;
    }

    console.log(`🔍 Searching for PO: ${poNumber}\n`);

    const po = await PurchaseOrder.findOne({ poNumber });

    if (!po) {
      console.log(`ℹ️  No Purchase Order found with number: ${poNumber}`);
      await mongoose.disconnect();
      return;
    }

    console.log(`Found PO: ${po.poNumber}`);
    console.log(`Supplier: ${po.supplierDetails?.name || po.supplierName}`);
    console.log(`Status:   ${po.status}`);
    console.log(`Items:    ${po.items.length}\n`);

    // Find items matching the old price
    const matchingItems = po.items.filter(item => item.unitPrice === oldPrice);

    if (matchingItems.length === 0) {
      console.log(`ℹ️  No items found with unit price: ${oldPrice}`);
      console.log('\nCurrent item prices:');
      po.items.forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.description} — unitPrice: ${item.unitPrice}`);
      });
      await mongoose.disconnect();
      return;
    }

    console.log(`Found ${matchingItems.length} item(s) with unitPrice ${oldPrice}:`);
    matchingItems.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.description}`);
      console.log(`     Old unitPrice:  ${item.unitPrice}`);
      console.log(`     Old totalPrice: ${item.totalPrice}`);
    });

    // Apply the update to all matching items
    po.items.forEach(item => {
      if (item.unitPrice === oldPrice) {
        item.unitPrice = newPrice;
        item.totalPrice = item.quantity * newPrice;
      }
    });

    // Recalculate subtotal and total (pre-save hook also does this, but be explicit)
    const subtotal = po.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    po.subtotalAmount = subtotal;

    if (po.taxApplicable && po.taxRate > 0) {
      po.taxAmount = subtotal * (po.taxRate / 100);
      po.totalAmount = subtotal + po.taxAmount;
    } else {
      po.taxAmount = 0;
      po.totalAmount = subtotal;
    }

    po.lastModifiedDate = new Date();
    po.activities.push({
      type: 'updated',
      description: `Unit price updated from ${oldPrice} to ${newPrice} via admin script`,
      user: 'System Admin',
      timestamp: new Date()
    });

    await po.save();

    console.log('\n✅ Update applied successfully:\n');
    matchingItems.forEach(item => {
      const updated = po.items.find(i => i.description === item.description);
      console.log(`  ${updated.description}`);
      console.log(`     New unitPrice:  ${updated.unitPrice}`);
      console.log(`     New totalPrice: ${updated.totalPrice}`);
    });
    console.log(`\n  New subtotal:    ${po.currency} ${po.subtotalAmount.toLocaleString()}`);
    if (po.taxApplicable) {
      console.log(`  Tax (${po.taxRate}%):     ${po.currency} ${po.taxAmount.toLocaleString()}`);
    }
    console.log(`  New total:       ${po.currency} ${po.totalAmount.toLocaleString()}`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

updatePOUnitPrice();