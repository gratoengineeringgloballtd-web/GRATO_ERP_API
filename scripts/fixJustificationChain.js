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









// /**
//  * Script to fix justification approval chains
//  * 
//  * Options:
//  * 1. Reset specific request to allow re-submission with correct chain
//  * 2. Fix all requests with duplicate approvers in justification chains
//  * 
//  * Usage:
//  * node scripts/fixJustificationChain.js --requestId=695d6c89984352f376493909
//  * OR
//  * node scripts/fixJustificationChain.js --fixAll
//  */

// const mongoose = require('mongoose');
// require('dotenv').config();

// // Models
// const CashRequest = require('../models/CashRequest');

// /**
//  * Connect to MongoDB
//  */
// const connectDB = async () => {
//   try {
//     await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
//       useNewUrlParser: true,
//       useUnifiedTopology: true,
//     });
//     console.log('✅ MongoDB connected');
//   } catch (error) {
//     console.error('❌ MongoDB connection failed:', error);
//     process.exit(1);
//   }
// };

// /**
//  * Reset justification to allow re-submission
//  * @param {string} requestId 
//  */
// const resetJustificationForResubmission = async (requestId) => {
//   try {
//     console.log('\n=== RESETTING JUSTIFICATION FOR RE-SUBMISSION ===');
//     console.log(`Request ID: ${requestId}`);
    
//     const request = await CashRequest.findById(requestId);
    
//     if (!request) {
//       console.error('❌ Request not found');
//       return false;
//     }
    
//     console.log(`Found request: REQ-${requestId.toString().slice(-6).toUpperCase()}`);
//     console.log(`Employee: ${request.employee}`);
//     console.log(`Current Status: ${request.status}`);
//     console.log(`Justification Chain Levels: ${request.justificationApprovalChain?.length || 0}`);
    
//     // Check if request is disbursed
//     if (!['fully_disbursed', 'partially_disbursed', 'disbursed'].includes(request.status) && 
//         !request.status.includes('justification_')) {
//       console.error('❌ Request is not in a state where justification can be submitted');
//       console.error(`   Current status: ${request.status}`);
//       return false;
//     }
    
//     console.log('\n📝 Backing up current justification data...');
//     const backup = {
//       justification: request.justification ? JSON.parse(JSON.stringify(request.justification)) : null,
//       justificationApprovalChain: request.justificationApprovalChain ? 
//         JSON.parse(JSON.stringify(request.justificationApprovalChain)) : null,
//       justificationApproval: request.justificationApproval ? 
//         JSON.parse(JSON.stringify(request.justificationApproval)) : null,
//       status: request.status
//     };
    
//     console.log('✅ Backup created');
    
//     console.log('\n🔄 Resetting justification fields...');
    
//     // Reset to fully_disbursed status (allows re-submission)
//     request.status = 'fully_disbursed';
    
//     // Clear justification approval chain (will be regenerated on submission)
//     request.justificationApprovalChain = [];
    
//     // Keep justification data (documents, amounts) but clear approval info
//     if (request.justificationApproval) {
//       delete request.justificationApproval.submittedDate;
//       delete request.justificationApproval.submittedBy;
//     }
    
//     await request.save();
    
//     console.log('✅ Justification reset successfully!');
//     console.log('\n📊 Summary:');
//     console.log(`   Status changed: ${backup.status} → ${request.status}`);
//     console.log(`   Justification chain cleared: ${backup.justificationApprovalChain?.length || 0} levels → 0 levels`);
//     console.log(`   Justification documents preserved: ${request.justification?.documents?.length || 0}`);
//     console.log('\n✅ Employee can now resubmit justification with correct approval chain');
    
//     return true;
    
//   } catch (error) {
//     console.error('❌ Error resetting justification:', error);
//     return false;
//   }
// };

// /**
//  * Build correct justification approval chain (de-duplicated)
//  * @param {Object} request 
//  */
// const buildCorrectJustificationChain = (request) => {
//   console.log('\n🔧 Building correct justification chain...');
  
//   const HR_HEAD = {
//     name: 'Mrs. Bruiline Tsitoh',
//     email: 'bruiline.tsitoh@gratoglobal.com',
//     role: 'HR Head',
//     department: 'HR & Admin'
//   };

//   const FINANCE_OFFICER = {
//     name: 'Ms. Ranibell Mambo',
//     email: 'ranibellmambo@gratoengineering.com',
//     role: 'Finance Officer',
//     department: 'Finance'
//   };

//   const HEAD_OF_BUSINESS = {
//     name: 'Mr. E.T Kelvin',
//     email: 'kelvin.eyong@gratoglobal.com',
//     role: 'Head of Business',
//     department: 'Executive'
//   };
  
//   // Build list of unique approvers with their highest roles
//   const allPotentialApprovers = [
//     // Original chain approvers (levels 1-2)
//     ...(request.approvalChain.filter(s => s.level <= 2).map(s => ({
//       name: s.approver.name,
//       email: s.approver.email,
//       role: s.approver.role,
//       department: s.approver.department,
//       priority: s.level === 1 ? 5 : 4  // Supervisor=5, Dept Head=4
//     }))),
//     // Fixed approvers
//     { ...HR_HEAD, priority: 3 },
//     { ...FINANCE_OFFICER, priority: 2 },
//     { ...HEAD_OF_BUSINESS, priority: 1 }
//   ];
  
//   console.log(`   Processing ${allPotentialApprovers.length} potential approvers...`);
  
//   // Group by email and keep highest priority (lowest number)
//   const approverMap = new Map();
  
//   for (const approver of allPotentialApprovers) {
//     const emailLower = String(approver.email || '').trim().toLowerCase();
    
//     if (!emailLower) continue;
    
//     if (!approverMap.has(emailLower)) {
//       approverMap.set(emailLower, approver);
//       console.log(`     ✓ Added: ${approver.name} (${approver.role}) - Priority ${approver.priority}`);
//     } else {
//       const existing = approverMap.get(emailLower);
//       if (approver.priority < existing.priority) {
//         console.log(`     ↑ Upgrading: ${approver.name} from ${existing.role} to ${approver.role}`);
//         approverMap.set(emailLower, approver);
//       } else {
//         console.log(`     ⊘ Skipping: ${approver.name} (${approver.role}) - lower priority`);
//       }
//     }
//   }
  
//   // Convert map to sorted array (by priority)
//   const uniqueApprovers = Array.from(approverMap.values())
//     .sort((a, b) => b.priority - a.priority); // Sort descending (5,4,3,2,1)
  
//   console.log(`\n   Final unique approvers (${uniqueApprovers.length}):`);
//   uniqueApprovers.forEach((a, i) => {
//     console.log(`     L${i + 1}: ${a.name} (${a.role})`);
//   });
  
//   // Build justification chain
//   const justificationChain = uniqueApprovers.map((approver, index) => ({
//     level: index + 1,
//     approver: {
//       name: approver.name,
//       email: approver.email,
//       role: approver.role,
//       department: approver.department
//     },
//     status: 'pending',
//     assignedDate: index === 0 ? new Date() : null
//   }));
  
//   return justificationChain;
// };

// /**
//  * Fix justification approval chain (rebuild with de-duplication)
//  * @param {string} requestId 
//  */
// const fixJustificationChain = async (requestId) => {
//   try {
//     console.log('\n=== FIXING JUSTIFICATION APPROVAL CHAIN ===');
//     console.log(`Request ID: ${requestId}`);
    
//     const request = await CashRequest.findById(requestId);
    
//     if (!request) {
//       console.error('❌ Request not found');
//       return false;
//     }
    
//     console.log(`Found request: REQ-${requestId.toString().slice(-6).toUpperCase()}`);
//     console.log(`Current Status: ${request.status}`);
//     console.log(`Current Chain Length: ${request.justificationApprovalChain?.length || 0}`);
    
//     // Check if justification exists
//     if (!request.justificationApprovalChain || request.justificationApprovalChain.length === 0) {
//       console.error('❌ No justification approval chain to fix');
//       return false;
//     }
    
//     console.log('\n📋 Current Justification Chain:');
//     request.justificationApprovalChain.forEach((step, idx) => {
//       console.log(`   L${step.level}: ${step.approver.name} (${step.approver.role}) - ${step.status}`);
//     });
    
//     // Build correct chain
//     const correctChain = buildCorrectJustificationChain(request);
    
//     console.log('\n✅ Correct Justification Chain:');
//     correctChain.forEach((step, idx) => {
//       console.log(`   L${step.level}: ${step.approver.name} (${step.approver.role})`);
//     });
    
//     // Check if any approvals have already been made
//     const approvedSteps = request.justificationApprovalChain.filter(s => s.status === 'approved');
    
//     if (approvedSteps.length > 0) {
//       console.log(`\n⚠️  WARNING: ${approvedSteps.length} step(s) already approved`);
//       console.log('   Approvals will be reset. Consider manual review.');
//     }
    
//     // Replace chain
//     request.justificationApprovalChain = correctChain;
    
//     // Reset status to first level
//     request.status = 'justification_pending_supervisor';
    
//     await request.save();
    
//     console.log('\n✅ Justification chain fixed successfully!');
//     console.log(`   New chain length: ${correctChain.length}`);
//     console.log(`   Status: ${request.status}`);
    
//     return true;
    
//   } catch (error) {
//     console.error('❌ Error fixing justification chain:', error);
//     return false;
//   }
// };

// /**
//  * Find and fix all requests with duplicate approvers in justification chains
//  */
// const fixAllDuplicateChains = async () => {
//   try {
//     console.log('\n=== FINDING REQUESTS WITH DUPLICATE APPROVERS ===');
    
//     const requests = await CashRequest.find({
//       approvalChainVersion: 2,
//       justificationApprovalChain: { $exists: true, $ne: [] }
//     });
    
//     console.log(`Found ${requests.length} requests with justification chains`);
    
//     const requestsWithDuplicates = [];
    
//     for (const request of requests) {
//       const emails = request.justificationApprovalChain.map(s => 
//         s.approver.email.toLowerCase()
//       );
      
//       const uniqueEmails = new Set(emails);
      
//       if (emails.length !== uniqueEmails.size) {
//         console.log(`\n❌ Found duplicates in REQ-${request._id.toString().slice(-6).toUpperCase()}`);
//         console.log(`   Chain: ${request.justificationApprovalChain.map(s => s.approver.name).join(' → ')}`);
//         requestsWithDuplicates.push(request._id);
//       }
//     }
    
//     if (requestsWithDuplicates.length === 0) {
//       console.log('\n✅ No requests with duplicate approvers found!');
//       return true;
//     }
    
//     console.log(`\n📊 Summary: ${requestsWithDuplicates.length} request(s) with duplicates`);
//     console.log('\nFix these requests? (This will reset their justification approvals)');
//     console.log('Run with --fix flag to proceed');
    
//     return false;
    
//   } catch (error) {
//     console.error('❌ Error finding duplicates:', error);
//     return false;
//   }
// };

// /**
//  * Main execution
//  */
// const main = async () => {
//   await connectDB();
  
//   const args = process.argv.slice(2);
//   const requestIdArg = args.find(arg => arg.startsWith('--requestId='));
//   const fixAllFlag = args.includes('--fixAll');
//   const resetFlag = args.includes('--reset');
//   const fixFlag = args.includes('--fix');
  
//   console.log('\n╔════════════════════════════════════════════════╗');
//   console.log('║  Fix Justification Approval Chain Script      ║');
//   console.log('╚════════════════════════════════════════════════╝');
  
//   if (requestIdArg) {
//     const requestId = requestIdArg.split('=')[1];
    
//     if (resetFlag) {
//       // Option 1: Reset for re-submission
//       await resetJustificationForResubmission(requestId);
//     } else if (fixFlag) {
//       // Option 2: Fix existing chain
//       await fixJustificationChain(requestId);
//     } else {
//       console.log('\n❓ Please specify action:');
//       console.log('   --reset  : Reset justification to allow re-submission');
//       console.log('   --fix    : Fix existing justification chain');
//       console.log('\nExample:');
//       console.log(`   node scripts/fixJustificationChain.js --requestId=${requestId} --reset`);
//     }
    
//   } else if (fixAllFlag) {
//     await fixAllDuplicateChains();
//   } else {
//     console.log('\n📖 Usage:');
//     console.log('\n1. Reset specific request for re-submission:');
//     console.log('   node scripts/fixJustificationChain.js --requestId=YOUR_ID --reset');
//     console.log('\n2. Fix existing justification chain:');
//     console.log('   node scripts/fixJustificationChain.js --requestId=YOUR_ID --fix');
//     console.log('\n3. Find all requests with duplicate approvers:');
//     console.log('   node scripts/fixJustificationChain.js --fixAll');
//     console.log('\n✨ For Carmel\'s request:');
//     console.log('   node scripts/fixJustificationChain.js --requestId=695d6c89984352f376493909 --reset');
//   }
  
//   await mongoose.connection.close();
//   console.log('\n✅ Database connection closed');
// };

// // Run script
// main().catch(error => {
//   console.error('❌ Script failed:', error);
//   process.exit(1);
// });