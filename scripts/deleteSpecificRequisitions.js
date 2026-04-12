/**
 * Script to delete specific purchase requisitions
 * Usage: node scripts/deleteSpecificRequisitions.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const PurchaseRequisition = require('../models/PurchaseRequisition');

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Requisitions to delete
const requisitionIds = [
  '695e05928ae9ddb786252313', // REQ202601073842 - IT accessories
  '6966045d43211f67b3d1e5db'  // REQ202601135889 - First Aid Box
];

// Main function
const deleteRequisitions = async () => {
  try {
    console.log('\n=== DELETING SPECIFIC PURCHASE REQUISITIONS ===\n');

    for (const id of requisitionIds) {
      console.log(`Processing requisition ID: ${id}`);
      
      // Find the requisition first to display details
      const requisition = await PurchaseRequisition.findById(id);
      
      if (!requisition) {
        console.log(`   ❌ Not found - may already be deleted\n`);
        continue;
      }
      
      console.log(`   Found: ${requisition.requisitionNumber}`);
      console.log(`   Title: ${requisition.title}`);
      console.log(`   Status: ${requisition.status}`);
      console.log(`   Budget: XAF ${(requisition.budgetXAF || 0).toLocaleString()}`);
      
      // Delete the requisition
      await PurchaseRequisition.findByIdAndDelete(id);
      console.log(`   ✅ DELETED successfully\n`);
    }
    
    console.log('=== DELETION COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Error deleting requisitions:', error.message);
    console.error(error.stack);
  }
};

// Run the script
const run = async () => {
  await connectDB();
  await deleteRequisitions();
  await mongoose.connection.close();
  console.log('✅ Database connection closed\n');
};

run();
