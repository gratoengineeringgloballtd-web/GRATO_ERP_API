require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

// Get a valid authentication token from your application
// This is a sample token - replace with a real one from your frontend localStorage
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTFhYmY0ZWM3NDMwZTgxYzE5ODQ2OTkiLCJyb2xlIjoiZmluYW5jZSIsImlhdCI6MTc2OTc1NTQ3MiwiZXhwIjoxNzY5ODQxODcyfQ.1vPFHlvfR4h1uBkGLHMsrjgOuL3w7KZ6bNkjIQ9W0F0';

async function testUsageTracking() {
  try {
    console.log('🧪 Testing Budget Code Usage Tracking Endpoint\n');
    
    // First, get available budget codes
    console.log('📋 Fetching budget codes...');
    const codesResponse = await axios.get('http://localhost:5001/api/budget-codes/available', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(`✅ Found ${codesResponse.data.length} budget codes\n`);
    
    if (codesResponse.data.length === 0) {
      console.log('❌ No budget codes available for testing');
      return;
    }
    
    // Test with the first budget code
    const firstCode = codesResponse.data[0];
    console.log(`📝 Testing with budget code: ${firstCode.code}`);
    console.log(`   ID: ${firstCode._id}`);
    console.log(`   Total Budget: XAF ${firstCode.totalBudget?.toLocaleString()}\n`);
    
    // Test the usage tracking endpoint
    console.log('🔍 Fetching usage tracking data...\n');
    const trackingResponse = await axios.get(
      `http://localhost:5001/api/budget-codes/${firstCode._id}/usage-tracking`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    const data = trackingResponse.data;
    
    // Display summary
    console.log('📊 SUMMARY:');
    console.log('═══════════════════════════════════════════════');
    console.log(`Total Budget:      XAF ${data.summary.totalBudget?.toLocaleString()}`);
    console.log(`Used Amount:       XAF ${data.summary.usedAmount?.toLocaleString()}`);
    console.log(`Remaining Budget:  XAF ${data.summary.remainingBudget?.toLocaleString()}`);
    console.log(`Utilization:       ${data.summary.utilizationPercentage}%`);
    console.log('═══════════════════════════════════════════════\n');
    
    // Display usage by source
    console.log('📂 USAGE BY SOURCE:');
    console.log('═══════════════════════════════════════════════');
    console.log(`Purchase Requisitions: XAF ${data.summary.bySource.purchaseRequisitions.total?.toLocaleString()} (${data.summary.bySource.purchaseRequisitions.count} items)`);
    console.log(`Cash Requests:         XAF ${data.summary.bySource.cashRequests.total?.toLocaleString()} (${data.summary.bySource.cashRequests.count} items)`);
    console.log(`Salary Payments:       XAF ${data.summary.bySource.salaryPayments.total?.toLocaleString()} (${data.summary.bySource.salaryPayments.count} items)`);
    console.log('═══════════════════════════════════════════════\n');
    
    // Display recent transactions
    console.log(`📝 RECENT TRANSACTIONS: (${data.recentTransactions.length} found)`);
    console.log('═══════════════════════════════════════════════');
    if (data.recentTransactions.length > 0) {
      data.recentTransactions.slice(0, 5).forEach((txn, index) => {
        console.log(`${index + 1}. [${txn.type}] XAF ${txn.amount?.toLocaleString()}`);
        console.log(`   Date: ${new Date(txn.date).toLocaleDateString()}`);
        console.log(`   ${txn.description || 'No description'}`);
        console.log('   ─────────────────────────────────────────');
      });
      if (data.recentTransactions.length > 5) {
        console.log(`   ... and ${data.recentTransactions.length - 5} more\n`);
      }
    } else {
      console.log('   No transactions found\n');
    }
    
    // Display monthly trends
    console.log(`📈 MONTHLY TRENDS: (${data.monthlyTrends.length} months)`);
    console.log('═══════════════════════════════════════════════');
    if (data.monthlyTrends.length > 0) {
      data.monthlyTrends.forEach(month => {
        const total = (month.purchaseRequisitions || 0) + (month.cashRequests || 0) + (month.salaryPayments || 0);
        console.log(`${month.month}: XAF ${total.toLocaleString()}`);
        console.log(`   PR: ${month.purchaseRequisitions?.toLocaleString()} | CR: ${month.cashRequests?.toLocaleString()} | SP: ${month.salaryPayments?.toLocaleString()}`);
      });
    } else {
      console.log('   No monthly trends available');
    }
    console.log('═══════════════════════════════════════════════\n');
    
    // Display department breakdown
    console.log(`🏢 DEPARTMENT BREAKDOWN: (${data.departmentBreakdown.length} departments)`);
    console.log('═══════════════════════════════════════════════');
    if (data.departmentBreakdown.length > 0) {
      data.departmentBreakdown.forEach(dept => {
        console.log(`${dept.department}: XAF ${dept.amount?.toLocaleString()} (${dept.percentage}%)`);
      });
    } else {
      console.log('   No department data available');
    }
    console.log('═══════════════════════════════════════════════\n');
    
    console.log('✅ Usage tracking test completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.log('\n⚠️  Authentication failed. Please update the token in the script.');
      console.log('   1. Login to the ERP system');
      console.log('   2. Open browser DevTools');
      console.log('   3. Copy the token from localStorage.getItem("token")');
      console.log('   4. Update the token variable in this script');
    }
  }
}

testUsageTracking();
