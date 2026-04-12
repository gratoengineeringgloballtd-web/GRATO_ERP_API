const mongoose = require('mongoose');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const BudgetCode = require('../models/BudgetCode');
require('dotenv').config();

async function fetchPurchaseRequisition(requisitionNumber) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected\n');

    console.log(`🔍 FETCHING PURCHASE REQUISITION: ${requisitionNumber}\n`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Fetch the purchase requisition with all populated fields
    const requisition = await PurchaseRequisition.findOne({ requisitionNumber })
      .populate('employee', 'fullName email department role')
      .populate('budgetCode', 'code name budget used active status')
      .populate('project', 'name code')
      .populate('supplierId', 'fullName email')
      .populate('approvalChain.clarificationRequest.requestedBy', 'fullName email')
      .populate('approvalChain.decidedBy', 'fullName email')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('supplyChainReview.decidedBy', 'fullName email')
      .populate('supplyChainReview.buyerAssignedBy', 'fullName email')
      .populate('headApproval.decidedBy', 'fullName email')
      .populate('pettyCashForm.generatedBy', 'fullName email')
      .populate('pettyCashForm.receipts.uploadedBy', 'fullName email')
      .populate('disbursements.disbursedBy', 'fullName email')
      .populate('disbursements.acknowledgedBy', 'fullName email')
      .populate('justification.submittedBy', 'fullName email')
      .populate('justification.receipts.uploadedBy', 'fullName email')
      .populate('justification.supervisorReview.reviewedBy', 'fullName email')
      .populate('justification.financeReview.reviewedBy', 'fullName email')
      .populate('justification.supplyChainReview.reviewedBy', 'fullName email')
      .populate('justification.headReview.reviewedBy', 'fullName email')
      .populate('clarificationRequests.requestedBy', 'fullName email role')
      .populate('clarificationRequests.requestedTo', 'fullName email role')
      .populate('rejectionHistory.rejectedBy', 'fullName email')
      .lean();

    if (!requisition) {
      console.log(`❌ NO PURCHASE REQUISITION FOUND WITH ID: ${requisitionNumber}\n`);
      await mongoose.connection.close();
      return;
    }

    // Display basic information
    console.log('📋 BASIC INFORMATION:\n');
    console.log(`Requisition Number: ${requisition.requisitionNumber}`);
    console.log(`ID: ${requisition._id}`);
    console.log(`Title: ${requisition.title}`);
    console.log(`Status: ${requisition.status}`);
    console.log(`Current Status: ${requisition.status}`);
    console.log(`Is Resubmission: ${requisition.isResubmission ? 'Yes' : 'No'}`);
    if (requisition.resubmissionCount > 0) {
      console.log(`Resubmission Count: ${requisition.resubmissionCount}`);
      console.log(`Last Resubmitted: ${new Date(requisition.lastResubmittedDate).toLocaleDateString()}`);
    }

    // Employee Information
    console.log('\n👤 EMPLOYEE INFORMATION:\n');
    console.log(`Employee: ${requisition.employee?.fullName || 'N/A'}`);
    console.log(`Email: ${requisition.employee?.email || 'N/A'}`);
    console.log(`Department: ${requisition.department || requisition.employee?.department || 'N/A'}`);
    console.log(`Role: ${requisition.employee?.role || 'N/A'}`);

    // Budget Information
    console.log('\n💰 BUDGET INFORMATION:\n');
    console.log(`Budget Code: ${requisition.budgetCodeInfo?.code || 'N/A'}`);
    console.log(`Budget Name: ${requisition.budgetCodeInfo?.name || 'N/A'}`);
    console.log(`Requested Amount: XAF ${(requisition.budgetXAF || 0).toLocaleString()}`);
    console.log(`Budget Available at Submission: XAF ${(requisition.budgetCodeInfo?.availableAtSubmission || 0).toLocaleString()}`);
    console.log(`Submitted Amount: XAF ${(requisition.budgetCodeInfo?.submittedAmount || 0).toLocaleString()}`);
    
    if (requisition.supplyChainReview?.budgetAssignedBySupplyChain) {
      console.log(`\n  Budget Assigned by Supply Chain:`);
      console.log(`  Previous Budget: XAF ${(requisition.supplyChainReview.previousBudget || 0).toLocaleString()}`);
      console.log(`  Assigned Budget: XAF ${(requisition.supplyChainReview.assignedBudget || 0).toLocaleString()}`);
      console.log(`  Reason: ${requisition.supplyChainReview.budgetAssignmentReason || 'N/A'}`);
      console.log(`  Assigned At: ${new Date(requisition.supplyChainReview.budgetAssignedAt).toLocaleDateString()}`);
    }

    // Purchase Details
    console.log('\n📦 PURCHASE DETAILS:\n');
    console.log(`Item Category: ${requisition.itemCategory || 'N/A'}`);
    console.log(`Purchase Type: ${requisition.purchaseType || 'N/A'}`);
    console.log(`Payment Method: ${requisition.paymentMethod || 'N/A'}`);
    console.log(`Urgency: ${requisition.urgency || 'N/A'}`);
    console.log(`Delivery Location: ${requisition.deliveryLocation || 'N/A'}`);
    console.log(`Expected Delivery Date: ${requisition.expectedDate ? new Date(requisition.expectedDate).toLocaleDateString() : 'N/A'}`);
    
    if (requisition.project) {
      console.log(`Project: ${requisition.project.name || 'N/A'} (${requisition.project.code || 'N/A'})`);
    }
    
    if (requisition.preferredSupplier) {
      console.log(`Preferred Supplier: ${requisition.preferredSupplier}`);
    }

    // Items
    console.log('\n📝 ITEMS REQUESTED: (' + (requisition.items?.length || 0) + ')\n');
    if (requisition.items && requisition.items.length > 0) {
      requisition.items.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.description}`);
        console.log(`     Code: ${item.code}`);
        console.log(`     Quantity: ${item.quantity} ${item.measuringUnit}`);
        console.log(`     Category: ${item.category}`);
        if (item.subcategory) console.log(`     Subcategory: ${item.subcategory}`);
        console.log(`     Estimated Price: XAF ${(item.estimatedPrice || 0).toLocaleString()}`);
        if (item.projectName) console.log(`     Project: ${item.projectName}`);
        console.log('');
      });
    }

    // Finance Verification
    console.log('\n✅ FINANCE VERIFICATION:\n');
    const financeVerif = requisition.financeVerification;
    console.log(`Status: ${financeVerif?.decision || 'N/A'}`);
    console.log(`Budget Available: ${financeVerif?.budgetAvailable ? 'Yes' : 'No'}`);
    console.log(`Verified Budget: XAF ${(financeVerif?.verifiedBudget || 0).toLocaleString()}`);
    if (financeVerif?.availableBudgetAtVerification) {
      console.log(`Available Budget at Verification: XAF ${financeVerif.availableBudgetAtVerification.toLocaleString()}`);
    }
    if (financeVerif?.verifiedBy) {
      console.log(`Verified By: ${financeVerif.verifiedBy.fullName || 'N/A'} (${financeVerif.verifiedBy.email || 'N/A'})`);
      console.log(`Verification Date: ${financeVerif.verificationDate ? new Date(financeVerif.verificationDate).toLocaleDateString() : 'N/A'}`);
    }
    if (financeVerif?.comments) {
      console.log(`Comments: ${financeVerif.comments}`);
    }

    // Supply Chain Review
    console.log('\n🔄 SUPPLY CHAIN REVIEW:\n');
    const scReview = requisition.supplyChainReview;
    console.log(`Decision: ${scReview?.decision || 'N/A'}`);
    console.log(`Sourcing Type: ${scReview?.sourcingType || 'N/A'}`);
    console.log(`Purchase Type: ${scReview?.purchaseTypeAssigned || 'N/A'}`);
    console.log(`Estimated Cost: XAF ${(scReview?.estimatedCost || 0).toLocaleString()}`);
    
    if (scReview?.assignedBuyer) {
      console.log(`\n  Assigned Buyer: ${scReview.assignedBuyer.fullName || 'N/A'} (${scReview.assignedBuyer.email || 'N/A'})`);
      console.log(`  Assignment Date: ${scReview.buyerAssignmentDate ? new Date(scReview.buyerAssignmentDate).toLocaleDateString() : 'N/A'}`);
    }
    if (scReview?.decidedBy) {
      console.log(`  Decided By: ${scReview.decidedBy.fullName || 'N/A'}`);
      console.log(`  Decision Date: ${scReview.decisionDate ? new Date(scReview.decisionDate).toLocaleDateString() : 'N/A'}`);
    }
    if (scReview?.comments) {
      console.log(`  Comments: ${scReview.comments}`);
    }

    // Head Approval
    console.log('\n👨‍💼 HEAD APPROVAL:\n');
    const headApp = requisition.headApproval;
    console.log(`Decision: ${headApp?.decision || 'N/A'}`);
    if (headApp?.decidedBy) {
      console.log(`Decided By: ${headApp.decidedBy.fullName || 'N/A'} (${headApp.decidedBy.email || 'N/A'})`);
      console.log(`Decision Date: ${headApp.decisionDate ? new Date(headApp.decisionDate).toLocaleDateString() : 'N/A'}`);
    }
    if (headApp?.comments) {
      console.log(`Comments: ${headApp.comments}`);
    }

    // Approval Chain
    console.log('\n📊 APPROVAL CHAIN:\n');
    if (requisition.approvalChain && requisition.approvalChain.length > 0) {
      requisition.approvalChain.forEach((step, idx) => {
        console.log(`  Level ${step.level}: ${step.approver?.role || 'N/A'} - ${step.approver?.name || 'N/A'}`);
        console.log(`  Status: ${step.status}`);
        if (step.comments) console.log(`  Comments: ${step.comments}`);
        if (step.actionDate) console.log(`  Action Date: ${new Date(step.actionDate).toLocaleDateString()}`);
        if (step.clarificationRequest?.status === 'pending') {
          console.log(`  ⏳ Pending Clarification from: ${step.clarificationRequest.requesterName || 'N/A'}`);
          console.log(`     Message: ${step.clarificationRequest.message || 'N/A'}`);
        }
        console.log('');
      });
    }

    // Petty Cash Form
    if (requisition.pettyCashForm?.generated) {
      console.log('\n💸 PETTY CASH FORM:\n');
      console.log(`Form Number: ${requisition.pettyCashForm.formNumber}`);
      console.log(`Status: ${requisition.pettyCashForm.status}`);
      console.log(`Generated Date: ${new Date(requisition.pettyCashForm.generatedDate).toLocaleDateString()}`);
      console.log(`Generated By: ${requisition.pettyCashForm.generatedBy?.fullName || 'N/A'}`);
      console.log(`Change Returned: XAF ${(requisition.pettyCashForm.changeReturned || 0).toLocaleString()}`);
      console.log(`Receipts Count: ${requisition.pettyCashForm.receipts?.length || 0}`);
      console.log(`Downloads: ${requisition.pettyCashForm.downloadHistory?.length || 0}`);
    }

    // Disbursements
    if (requisition.disbursements && requisition.disbursements.length > 0) {
      console.log('\n💵 DISBURSEMENTS:\n');
      console.log(`Total Disbursed: XAF ${(requisition.totalDisbursed || 0).toLocaleString()}`);
      console.log(`Remaining Balance: XAF ${(requisition.remainingBalance || 0).toLocaleString()}`);
      console.log(`\nDisbursement Details:`);
      
      requisition.disbursements.forEach((disburse, idx) => {
        console.log(`\n  ${idx + 1}. Disbursement #${disburse.disbursementNumber}`);
        console.log(`     Amount: XAF ${(disburse.amount || 0).toLocaleString()}`);
        console.log(`     Date: ${new Date(disburse.date).toLocaleDateString()}`);
        console.log(`     Disbursed By: ${disburse.disbursedBy?.fullName || 'N/A'}`);
        console.log(`     Acknowledged: ${disburse.acknowledged ? 'Yes' : 'No'}`);
        if (disburse.acknowledged) {
          console.log(`     Acknowledged By: ${disburse.acknowledgedBy?.fullName || 'N/A'}`);
          console.log(`     Acknowledgment Date: ${new Date(disburse.acknowledgmentDate).toLocaleDateString()}`);
          console.log(`     Method: ${disburse.acknowledgmentMethod || 'N/A'}`);
        }
        if (disburse.notes) console.log(`     Notes: ${disburse.notes}`);
      });
    }

    // Justification
    if (requisition.justification && Object.keys(requisition.justification).length > 0) {
      console.log('\n📄 JUSTIFICATION:\n');
      console.log(`Status: ${requisition.justification.status || 'N/A'}`);
      console.log(`Submitted Date: ${requisition.justification.submittedDate ? new Date(requisition.justification.submittedDate).toLocaleDateString() : 'N/A'}`);
      console.log(`Submitted By: ${requisition.justification.submittedBy?.fullName || 'N/A'}`);
      console.log(`Total Spent: XAF ${(requisition.justification.totalSpent || 0).toLocaleString()}`);
      console.log(`Change Returned: XAF ${(requisition.justification.changeReturned || 0).toLocaleString()}`);
      
      if (requisition.justification.actualExpenses && requisition.justification.actualExpenses.length > 0) {
        console.log(`\n  Actual Expenses:`);
        requisition.justification.actualExpenses.forEach((exp, idx) => {
          console.log(`  ${idx + 1}. ${exp.description}`);
          console.log(`     Amount: XAF ${(exp.amount || 0).toLocaleString()}`);
          console.log(`     Category: ${exp.category}`);
          console.log(`     Date: ${new Date(exp.date).toLocaleDateString()}`);
        });
      }

      if (requisition.justification.supervisorReview?.decision) {
        console.log(`\n  Supervisor Review:`);
        console.log(`  Decision: ${requisition.justification.supervisorReview.decision}`);
        console.log(`  By: ${requisition.justification.supervisorReview.reviewedBy?.fullName || 'N/A'}`);
        console.log(`  Date: ${new Date(requisition.justification.supervisorReview.reviewedDate).toLocaleDateString()}`);
        if (requisition.justification.supervisorReview.comments) {
          console.log(`  Comments: ${requisition.justification.supervisorReview.comments}`);
        }
      }
    }

    // Rejection History
    if (requisition.rejectionHistory && requisition.rejectionHistory.length > 0) {
      console.log('\n❌ REJECTION HISTORY:\n');
      requisition.rejectionHistory.forEach((rejection, idx) => {
        console.log(`  ${idx + 1}. Rejected on ${new Date(rejection.rejectionDate).toLocaleDateString()}`);
        console.log(`     By: ${rejection.rejectorName || 'N/A'} (${rejection.rejectorRole || 'N/A'})`);
        console.log(`     Reason: ${rejection.rejectionReason || 'N/A'}`);
        console.log(`     At Level: ${rejection.approvalLevel || 'N/A'}`);
        console.log(`     Resubmitted: ${rejection.resubmitted ? 'Yes' : 'No'}`);
        if (rejection.resubmitted) {
          console.log(`     Resubmitted Date: ${new Date(rejection.resubmittedDate).toLocaleDateString()}`);
        }
        console.log('');
      });
    }

    // Clarification Requests
    if (requisition.clarificationRequests && requisition.clarificationRequests.length > 0) {
      console.log('\n❓ CLARIFICATION REQUESTS:\n');
      requisition.clarificationRequests.forEach((clarif, idx) => {
        console.log(`  ${idx + 1}. Requested on ${new Date(clarif.requestedAt).toLocaleDateString()}`);
        console.log(`     By: ${clarif.requesterName || 'N/A'} (${clarif.requesterRole || 'N/A'})`);
        console.log(`     To: ${clarif.recipientName || 'N/A'}`);
        console.log(`     Message: ${clarif.message || 'N/A'}`);
        console.log(`     Status: ${clarif.status}`);
        if (clarif.response) {
          console.log(`     Response: ${clarif.response}`);
          console.log(`     Responded At: ${new Date(clarif.respondedAt).toLocaleDateString()}`);
        }
        console.log('');
      });
    }

    // Attachments
    if (requisition.attachments && requisition.attachments.length > 0) {
      console.log('\n📎 ATTACHMENTS:\n');
      requisition.attachments.forEach((att, idx) => {
        console.log(`  ${idx + 1}. ${att.name}`);
        console.log(`     Size: ${(att.size / 1024).toFixed(2)} KB`);
        console.log(`     Type: ${att.mimetype}`);
        console.log(`     Uploaded: ${new Date(att.uploadedAt).toLocaleDateString()}`);
      });
    }

    // Dates
    console.log('\n📅 DATES:\n');
    console.log(`Created: ${new Date(requisition.createdAt).toLocaleDateString()}`);
    console.log(`Updated: ${new Date(requisition.updatedAt).toLocaleDateString()}`);

    console.log('\n═══════════════════════════════════════════════════════════════\n');

    // Close database connection
    await mongoose.connection.close();
    console.log('✅ Database connection closed\n');

  } catch (error) {
    console.error('❌ Error fetching purchase requisition:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Get requisition number from command line or use default
const requisitionNumber = process.argv[2] || 'REQ202601205092';

// Run the script
fetchPurchaseRequisition(requisitionNumber);
