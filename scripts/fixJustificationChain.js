/**
 * Script to reset REQ-E6E1DD (69204cdaba3a4b432de6e1dd) to pending justification
 * 
 * This will:
 * 1. Clear the justification approval chain
 * 2. Reset status to 'fully_disbursed' (allows re-submission)
 * 3. Clear submission metadata but preserve justification documents
 * 
 * Usage:
 * node scripts/resetSpecificRequest.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Models
const CashRequest = require('../models/CashRequest');

/**
 * Connect to MongoDB
 */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

/**
 * Reset specific request to allow justification re-submission
 */
const resetRequestE6E1DD = async () => {
  const REQUEST_ID = '69204cdaba3a4b432de6e1dd';
  const DISPLAY_ID = 'REQ-E6E1DD';
  
  try {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  Reset Request to Pending Justification       ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log(`\nTarget Request: ${DISPLAY_ID}`);
    console.log(`Request ID: ${REQUEST_ID}`);
    
    // Find the request
    const request = await CashRequest.findById(REQUEST_ID);
    
    if (!request) {
      console.error('❌ Request not found!');
      console.error('   Please verify the request ID is correct');
      return false;
    }
    
    console.log('\n📋 Current Request Details:');
    console.log(`   Display ID: ${request.displayId}`);
    console.log(`   Employee: ${request.employee?.fullName || request.employee}`);
    console.log(`   Amount: ${request.amountApproved} XAF`);
    console.log(`   Current Status: ${request.status}`);
    console.log(`   Total Disbursed: ${request.totalDisbursed} XAF`);
    console.log(`   Disbursement Progress: ${request.disbursementProgress}%`);
    
    // Verify this is the correct request
    if (request.displayId !== DISPLAY_ID) {
      console.error(`\n❌ Display ID mismatch!`);
      console.error(`   Expected: ${DISPLAY_ID}`);
      console.error(`   Found: ${request.displayId}`);
      return false;
    }
    
    console.log('\n📊 Current Justification Status:');
    console.log(`   Justification Chain Levels: ${request.justificationApprovalChain?.length || 0}`);
    console.log(`   Submitted Date: ${request.justificationApproval?.submittedDate || 'Not submitted'}`);
    console.log(`   Submitted By: ${request.justificationApproval?.submittedBy || 'N/A'}`);
    console.log(`   Documents: ${request.justification?.documents?.length || 0}`);
    
    if (request.justificationApprovalChain?.length > 0) {
      console.log('\n   Current Approval Chain:');
      request.justificationApprovalChain.forEach((step) => {
        console.log(`      L${step.level}: ${step.approver.name} (${step.approver.role}) - ${step.status}`);
      });
    }
    
    // Create backup
    console.log('\n💾 Creating backup of current state...');
    const backup = {
      status: request.status,
      justificationApprovalChain: request.justificationApprovalChain ? 
        JSON.parse(JSON.stringify(request.justificationApprovalChain)) : null,
      justificationApproval: request.justificationApproval ? 
        JSON.parse(JSON.stringify(request.justificationApproval)) : null,
      timestamp: new Date()
    };
    console.log('✅ Backup created');
    
    // Perform reset
    console.log('\n🔄 Resetting request to pending justification...');
    
    // Step 1: Change status to fully_disbursed (allows justification submission)
    const oldStatus = request.status;
    request.status = 'fully_disbursed';
    console.log(`   ✓ Status: ${oldStatus} → ${request.status}`);
    
    // Step 2: Clear justification approval chain
    const oldChainLength = request.justificationApprovalChain?.length || 0;
    request.justificationApprovalChain = [];
    console.log(`   ✓ Approval chain cleared: ${oldChainLength} levels → 0 levels`);
    
    // Step 3: Clear submission metadata but keep justification data
    if (request.justificationApproval) {
      const hadSubmission = !!request.justificationApproval.submittedDate;
      delete request.justificationApproval.submittedDate;
      delete request.justificationApproval.submittedBy;
      
      if (hadSubmission) {
        console.log('   ✓ Submission metadata cleared');
      }
    }
    
    // Step 4: Preserve justification documents and data
    const documentsCount = request.justification?.documents?.length || 0;
    if (documentsCount > 0) {
      console.log(`   ✓ Preserved ${documentsCount} justification document(s)`);
    }
    
    const itemsCount = request.justification?.itemizedBreakdown?.length || 0;
    if (itemsCount > 0) {
      console.log(`   ✓ Preserved ${itemsCount} itemized breakdown item(s)`);
    }
    
    // Save changes
    console.log('\n💾 Saving changes to database...');
    await request.save();
    console.log('✅ Request updated successfully!');
    
    // Summary
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║              RESET SUMMARY                     ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log(`\n✅ Request ${DISPLAY_ID} has been reset`);
    console.log('\n📝 Changes Made:');
    console.log(`   • Status: ${backup.status} → fully_disbursed`);
    console.log(`   • Approval Chain: ${oldChainLength} levels → 0 levels`);
    console.log(`   • Submission Metadata: Cleared`);
    console.log(`   • Justification Documents: Preserved (${documentsCount})`);
    
    console.log('\n👤 Employee can now:');
    console.log('   1. Access the request in "Disbursed" tab');
    console.log('   2. Click "Submit Justification"');
    console.log('   3. Re-submit with correct approval chain');
    
    console.log('\n⚠️  Note: The new approval chain will be generated');
    console.log('   automatically upon submission based on the current');
    console.log('   approval chain version 2 rules.');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Error resetting request:', error);
    console.error('\nStack trace:', error.stack);
    return false;
  }
};

/**
 * Main execution
 */
const main = async () => {
  try {
    await connectDB();
    
    console.log('\n🚀 Starting reset process...\n');
    
    const success = await resetRequestE6E1DD();
    
    if (success) {
      console.log('\n✅ Reset completed successfully!');
    } else {
      console.log('\n❌ Reset failed. Please check the errors above.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
};

// Run script
main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});





