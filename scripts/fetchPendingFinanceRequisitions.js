/**
 * Script to fetch all purchase requisitions pending finance verification
 * Usage: node scripts/fetchPendingFinanceRequisitions.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const BudgetCode = require('../models/BudgetCode');

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

// Main function
const fetchPendingFinanceRequisitions = async () => {
  try {
    console.log('\n=== FETCHING PURCHASE REQUISITIONS PENDING FINANCE VERIFICATION ===\n');

    // Query for requisitions pending finance verification
    const query = {
      $or: [
        { status: 'pending_finance_verification' },
        {
          status: 'pending_supervisor',
          'approvalChain': {
            $elemMatch: {
              'approver.role': { $regex: /finance/i },
              'status': 'pending'
            }
          }
        }
      ]
    };

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('budgetCode', 'code name budget used')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`📊 Total Found: ${requisitions.length} requisitions\n`);

    if (requisitions.length === 0) {
      console.log('✓ No requisitions pending finance verification.');
      return;
    }

    // Display results
    requisitions.forEach((req, index) => {
      console.log(`${index + 1}. Requisition #${req.requisitionNumber}`);
      console.log(`   ID: ${req._id}`);
      console.log(`   Title: ${req.title}`);
      console.log(`   Requester: ${req.employee?.fullName || 'Unknown'} (${req.employee?.department || 'N/A'})`);
      console.log(`   Status: ${req.status}`);
      console.log(`   Budget: XAF ${(req.budgetXAF || 0).toLocaleString()}`);
      
      if (req.budgetCode) {
        console.log(`   Budget Code: ${req.budgetCode.code} - ${req.budgetCode.name}`);
        const available = req.budgetCode.budget - req.budgetCode.used;
        console.log(`   Budget Available: XAF ${available.toLocaleString()}`);
      }
      
      console.log(`   Category: ${req.itemCategory || 'N/A'}`);
      console.log(`   Urgency: ${req.urgency || 'Normal'}`);
      console.log(`   Items Count: ${req.items?.length || 0}`);
      console.log(`   Submitted: ${new Date(req.createdAt).toLocaleString('en-GB')}`);
      
      // Check finance approval chain step
      const financeStep = req.approvalChain?.find(step => 
        step.approver.role?.toLowerCase().includes('finance') && 
        step.status === 'pending'
      );
      
      if (financeStep) {
        console.log(`   ⏳ Awaiting: ${financeStep.approver.name} (${financeStep.approver.role})`);
        console.log(`   Email: ${financeStep.approver.email}`);
      }
      
      // Check if finance verification exists
      if (req.financeVerification) {
        console.log(`   Finance Status: ${req.financeVerification.decision || 'Pending'}`);
        if (req.financeVerification.budgetAvailable !== undefined) {
          console.log(`   Budget Available (Finance): ${req.financeVerification.budgetAvailable ? 'Yes' : 'No'}`);
        }
        if (req.financeVerification.assignedBudget) {
          console.log(`   Assigned Budget: XAF ${req.financeVerification.assignedBudget.toLocaleString()}`);
        }
      }
      
      console.log(`   ---\n`);
    });

    // Summary statistics
    console.log('\n=== SUMMARY STATISTICS ===\n');
    
    const totalAmount = requisitions.reduce((sum, req) => sum + (req.budgetXAF || 0), 0);
    console.log(`💰 Total Amount Pending: XAF ${totalAmount.toLocaleString()}`);
    
    const byDepartment = requisitions.reduce((acc, req) => {
      const dept = req.employee?.department || 'Unknown';
      acc[dept] = (acc[dept] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\n📁 By Department:');
    Object.entries(byDepartment)
      .sort((a, b) => b[1] - a[1])
      .forEach(([dept, count]) => {
        console.log(`   ${dept}: ${count} requisition${count > 1 ? 's' : ''}`);
      });
    
    const byUrgency = requisitions.reduce((acc, req) => {
      const urgency = req.urgency || 'Normal';
      acc[urgency] = (acc[urgency] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\n⚡ By Urgency:');
    Object.entries(byUrgency)
      .sort((a, b) => b[1] - a[1])
      .forEach(([urgency, count]) => {
        console.log(`   ${urgency}: ${count} requisition${count > 1 ? 's' : ''}`);
      });
    
    const byCategory = requisitions.reduce((acc, req) => {
      const category = req.itemCategory || 'Uncategorized';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\n📦 By Category:');
    Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .forEach(([category, count]) => {
        console.log(`   ${category}: ${count} requisition${count > 1 ? 's' : ''}`);
      });
    
    // Age analysis
    const now = new Date();
    const ageGroups = {
      '< 24 hours': 0,
      '1-3 days': 0,
      '3-7 days': 0,
      '> 7 days': 0
    };
    
    requisitions.forEach(req => {
      const ageInDays = (now - new Date(req.createdAt)) / (1000 * 60 * 60 * 24);
      if (ageInDays < 1) ageGroups['< 24 hours']++;
      else if (ageInDays < 3) ageGroups['1-3 days']++;
      else if (ageInDays < 7) ageGroups['3-7 days']++;
      else ageGroups['> 7 days']++;
    });
    
    console.log('\n⏱️  By Age:');
    Object.entries(ageGroups).forEach(([age, count]) => {
      if (count > 0) {
        console.log(`   ${age}: ${count} requisition${count > 1 ? 's' : ''}`);
      }
    });
    
    // Urgent items needing attention
    const urgentOld = requisitions.filter(req => 
      req.urgency === 'urgent' && 
      (now - new Date(req.createdAt)) / (1000 * 60 * 60 * 24) > 3
    );
    
    if (urgentOld.length > 0) {
      console.log('\n⚠️  URGENT ITEMS > 3 DAYS OLD:');
      urgentOld.forEach(req => {
        const age = Math.floor((now - new Date(req.createdAt)) / (1000 * 60 * 60 * 24));
        console.log(`   • ${req.requisitionNumber} - ${req.title} (${age} days old)`);
      });
    }
    
    console.log('\n');

  } catch (error) {
    console.error('❌ Error fetching requisitions:', error.message);
    console.error(error.stack);
  }
};

// Run the script
const run = async () => {
  await connectDB();
  await fetchPendingFinanceRequisitions();
  await mongoose.connection.close();
  console.log('✅ Database connection closed\n');
};

run();
