const mongoose = require('mongoose');
const BudgetCode = require('../models/BudgetCode');
const User = require('../models/User');
const PurchaseRequisition = require('../models/PurchaseRequisition');
require('dotenv').config();

async function fetchAllBudgetCodes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);

    console.log('✅ MongoDB Connected');
    console.log('\n💰 FETCHING ALL BUDGET CODES...\n');

    // Fetch all budget codes with populated fields
    const budgetCodes = await BudgetCode.find()
      .populate('budgetOwner', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email')
      .populate('allocations.allocatedBy', 'fullName email')
      .populate('allocations.requisitionId', 'requisitionNumber title status')
      .populate('transactions.performedBy', 'fullName email')
      .populate('budgetRevisions.requestedBy', 'fullName email')
      .populate('budgetRevisions.approvedBy', 'fullName email')
      .populate('budgetRevisions.rejectedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`Found ${budgetCodes.length} Budget Codes\n`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (budgetCodes.length === 0) {
      console.log('No budget codes found in the database.');
    } else {
      // Display summary statistics
      const stats = {
        total: budgetCodes.length,
        byStatus: {},
        byDepartment: {},
        byType: {},
        totalBudget: 0,
        totalUsed: 0,
        totalRemaining: 0,
        active: 0,
        inactive: 0,
        critical: 0,
        warning: 0,
        healthy: 0
      };

      budgetCodes.forEach(code => {
        // Count by status
        stats.byStatus[code.status] = (stats.byStatus[code.status] || 0) + 1;
        
        // Count by department
        stats.byDepartment[code.department] = (stats.byDepartment[code.department] || 0) + 1;
        
        // Count by type
        stats.byType[code.budgetType] = (stats.byType[code.budgetType] || 0) + 1;
        
        // Financial totals
        stats.totalBudget += code.budget || 0;
        stats.totalUsed += code.used || 0;
        stats.totalRemaining += (code.budget - code.used) || 0;
        
        // Active/Inactive
        if (code.active) stats.active++;
        else stats.inactive++;
        
        // Utilization status
        const utilization = code.budget > 0 ? (code.used / code.budget) * 100 : 0;
        if (utilization >= 90) stats.critical++;
        else if (utilization >= 75) stats.warning++;
        else stats.healthy++;
      });

      // Calculate overall utilization
      const overallUtilization = stats.totalBudget > 0 
        ? ((stats.totalUsed / stats.totalBudget) * 100).toFixed(2)
        : 0;

      console.log('📊 SUMMARY STATISTICS:\n');
      console.log(`Total Budget Codes: ${stats.total}`);
      console.log(`Active: ${stats.active} | Inactive: ${stats.inactive}`);
      
      console.log(`\n💵 Financial Summary:`);
      console.log(`  Total Budget: XAF ${stats.totalBudget.toLocaleString()}`);
      console.log(`  Total Used: XAF ${stats.totalUsed.toLocaleString()}`);
      console.log(`  Total Remaining: XAF ${stats.totalRemaining.toLocaleString()}`);
      console.log(`  Overall Utilization: ${overallUtilization}%`);
      
      console.log(`\n📋 By Status:`);
      Object.entries(stats.byStatus).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });
      
      console.log(`\n🏢 By Department:`);
      Object.entries(stats.byDepartment).forEach(([dept, count]) => {
        console.log(`  ${dept}: ${count}`);
      });
      
      console.log(`\n📂 By Budget Type:`);
      Object.entries(stats.byType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
      
      console.log(`\n⚠️  Utilization Status:`);
      console.log(`  Critical (≥90%): ${stats.critical}`);
      console.log(`  Warning (75-89%): ${stats.warning}`);
      console.log(`  Healthy (<75%): ${stats.healthy}`);

      console.log('\n═══════════════════════════════════════════════════════════════\n');
      console.log('📋 BUDGET CODE DETAILS:\n');

      // Display each budget code
      budgetCodes.forEach((code, index) => {
        const utilization = code.budget > 0 ? ((code.used / code.budget) * 100).toFixed(2) : 0;
        const remaining = code.budget - code.used;
        
        console.log(`${index + 1}. ${code.code} - ${code.name}`);
        console.log(`   ID: ${code._id}`);
        console.log(`   Status: ${code.status} | Type: ${code.budgetType}`);
        console.log(`   Department: ${code.department}`);
        console.log(`   Period: ${code.budgetPeriod} | Fiscal Year: ${code.fiscalYear}`);
        console.log(`   Owner: ${code.budgetOwner?.fullName || 'N/A'} (${code.budgetOwner?.email || 'N/A'})`);
        
        console.log(`\n   💰 Budget Details:`);
        console.log(`   Total Budget: XAF ${code.budget.toLocaleString()}`);
        console.log(`   Used: XAF ${code.used.toLocaleString()}`);
        console.log(`   Remaining: XAF ${remaining.toLocaleString()}`);
        console.log(`   Utilization: ${utilization}%`);
        
        // Utilization indicator
        let indicator = '🟢 Healthy';
        if (utilization >= 90) indicator = '🔴 Critical';
        else if (utilization >= 75) indicator = '🟡 Warning';
        console.log(`   Status: ${indicator}`);
        
        if (code.allocations && code.allocations.length > 0) {
          console.log(`\n   📊 Allocations: ${code.allocations.length}`);
          const allocated = code.allocations.filter(a => a.status === 'allocated').length;
          const spent = code.allocations.filter(a => a.status === 'spent').length;
          const released = code.allocations.filter(a => a.status === 'released').length;
          console.log(`      Allocated: ${allocated} | Spent: ${spent} | Released: ${released}`);
          
          // Show recent allocations
          const recentAllocations = code.allocations.slice(0, 3);
          recentAllocations.forEach((alloc, i) => {
            console.log(`      ${i + 1}. ${alloc.status.toUpperCase()} - XAF ${alloc.amount.toLocaleString()} - ${alloc.requisitionId?.requisitionNumber || 'N/A'}`);
          });
        }
        
        if (code.transactions && code.transactions.length > 0) {
          console.log(`\n   📝 Transactions: ${code.transactions.length}`);
          const lastTransaction = code.transactions[code.transactions.length - 1];
          console.log(`      Latest: ${lastTransaction.type} - XAF ${lastTransaction.amount.toLocaleString()} on ${new Date(lastTransaction.timestamp).toLocaleDateString()}`);
        }
        
        if (code.budgetRevisions && code.budgetRevisions.length > 0) {
          console.log(`\n   🔄 Budget Revisions: ${code.budgetRevisions.length}`);
          const pending = code.budgetRevisions.filter(r => r.status === 'pending').length;
          const approved = code.budgetRevisions.filter(r => r.status === 'approved').length;
          const rejected = code.budgetRevisions.filter(r => r.status === 'rejected').length;
          console.log(`      Pending: ${pending} | Approved: ${approved} | Rejected: ${rejected}`);
        }
        
        if (code.approvalChain && code.approvalChain.length > 0) {
          console.log(`\n   ✅ Approval Chain: ${code.approvalChain.length} levels`);
          const approvedSteps = code.approvalChain.filter(a => a.status === 'approved').length;
          const pendingSteps = code.approvalChain.filter(a => a.status === 'pending').length;
          console.log(`      Approved: ${approvedSteps} | Pending: ${pendingSteps}`);
        }
        
        console.log(`\n   📅 Dates:`);
        console.log(`   Created: ${new Date(code.createdAt).toLocaleDateString()}`);
        if (code.startDate) console.log(`   Start Date: ${new Date(code.startDate).toLocaleDateString()}`);
        if (code.endDate) console.log(`   End Date: ${new Date(code.endDate).toLocaleDateString()}`);
        
        if (code.description) {
          console.log(`\n   📝 Description: ${code.description.substring(0, 100)}${code.description.length > 100 ? '...' : ''}`);
        }
        
        console.log('');
      });

      // Generate alerts
      console.log('═══════════════════════════════════════════════════════════════\n');
      console.log('⚠️  ALERTS & RECOMMENDATIONS:\n');

      const criticalCodes = budgetCodes.filter(code => {
        const utilization = code.budget > 0 ? (code.used / code.budget) * 100 : 0;
        return utilization >= 90 && code.active;
      });

      if (criticalCodes.length > 0) {
        console.log('🔴 CRITICAL - Immediate Action Required:');
        criticalCodes.forEach(code => {
          const utilization = ((code.used / code.budget) * 100).toFixed(2);
          console.log(`   • ${code.code}: ${utilization}% utilized (XAF ${(code.budget - code.used).toLocaleString()} remaining)`);
        });
        console.log('');
      }

      const warningCodes = budgetCodes.filter(code => {
        const utilization = code.budget > 0 ? (code.used / code.budget) * 100 : 0;
        return utilization >= 75 && utilization < 90 && code.active;
      });

      if (warningCodes.length > 0) {
        console.log('🟡 WARNING - Monitor Closely:');
        warningCodes.forEach(code => {
          const utilization = ((code.used / code.budget) * 100).toFixed(2);
          console.log(`   • ${code.code}: ${utilization}% utilized (XAF ${(code.budget - code.used).toLocaleString()} remaining)`);
        });
        console.log('');
      }

      // Check for stale reservations
      const codesWithStaleReservations = budgetCodes.filter(code => {
        if (!code.allocations) return false;
        return code.allocations.some(alloc => {
          if (alloc.status !== 'allocated') return false;
          const daysSince = (Date.now() - new Date(alloc.allocatedDate)) / (1000 * 60 * 60 * 24);
          return daysSince > 30;
        });
      });

      if (codesWithStaleReservations.length > 0) {
        console.log('ℹ️  STALE RESERVATIONS (>30 days):');
        codesWithStaleReservations.forEach(code => {
          const staleCount = code.allocations.filter(alloc => {
            if (alloc.status !== 'allocated') return false;
            const daysSince = (Date.now() - new Date(alloc.allocatedDate)) / (1000 * 60 * 60 * 24);
            return daysSince > 30;
          }).length;
          console.log(`   • ${code.code}: ${staleCount} stale reservation(s)`);
        });
        console.log('');
      }

      // Pending approvals
      const pendingApprovals = budgetCodes.filter(code => 
        code.status === 'pending' || 
        code.status === 'pending_departmental_head' || 
        code.status === 'pending_head_of_business' || 
        code.status === 'pending_finance'
      );

      if (pendingApprovals.length > 0) {
        console.log('⏳ PENDING APPROVALS:');
        pendingApprovals.forEach(code => {
          console.log(`   • ${code.code}: ${code.status} - XAF ${code.budget.toLocaleString()}`);
        });
        console.log('');
      }
    }

    console.log('═══════════════════════════════════════════════════════════════\n');

    // Export to JSON
    const fs = require('fs');
    const exportPath = './budget_codes_export.json';
    
    fs.writeFileSync(
      exportPath, 
      JSON.stringify(budgetCodes, null, 2),
      'utf8'
    );
    
    console.log(`✅ Data exported to: ${exportPath}\n`);

    // Export to CSV
    const csvPath = './budget_codes_export.csv';
    const csvHeaders = [
      'Code',
      'Name',
      'Department',
      'Budget Type',
      'Period',
      'Fiscal Year',
      'Status',
      'Total Budget',
      'Used',
      'Remaining',
      'Utilization %',
      'Active',
      'Owner Name',
      'Owner Email',
      'Allocations Count',
      'Transactions Count',
      'Created Date',
      'Start Date',
      'End Date'
    ].join(',');

    const csvRows = budgetCodes.map(code => {
      const utilization = code.budget > 0 ? ((code.used / code.budget) * 100).toFixed(2) : 0;
      return [
        code.code,
        `"${code.name}"`,
        code.department,
        code.budgetType,
        code.budgetPeriod,
        code.fiscalYear,
        code.status,
        code.budget,
        code.used,
        code.budget - code.used,
        utilization,
        code.active ? 'Yes' : 'No',
        `"${code.budgetOwner?.fullName || ''}"`,
        code.budgetOwner?.email || '',
        code.allocations?.length || 0,
        code.transactions?.length || 0,
        code.createdAt ? new Date(code.createdAt).toISOString() : '',
        code.startDate ? new Date(code.startDate).toISOString() : '',
        code.endDate ? new Date(code.endDate).toISOString() : ''
      ].join(',');
    });

    const csvContent = [csvHeaders, ...csvRows].join('\n');
    fs.writeFileSync(csvPath, csvContent, 'utf8');
    
    console.log(`✅ CSV exported to: ${csvPath}\n`);

    // Generate summary report
    const reportPath = './budget_codes_summary.txt';
    const reportContent = `
BUDGET CODES SUMMARY REPORT
Generated: ${new Date().toLocaleString()}
═══════════════════════════════════════════════════════════════

OVERVIEW
--------
Total Budget Codes: ${budgetCodes.length}
Active: ${stats.active} | Inactive: ${stats.inactive}

FINANCIAL SUMMARY
-----------------
Total Budget: XAF ${stats.totalBudget.toLocaleString()}
Total Used: XAF ${stats.totalUsed.toLocaleString()}
Total Remaining: XAF ${stats.totalRemaining.toLocaleString()}
Overall Utilization: ${((stats.totalUsed / stats.totalBudget) * 100).toFixed(2)}%

UTILIZATION STATUS
------------------
Critical (≥90%): ${stats.critical}
Warning (75-89%): ${stats.warning}
Healthy (<75%): ${stats.healthy}

BY DEPARTMENT
-------------
${Object.entries(stats.byDepartment).map(([dept, count]) => `${dept}: ${count}`).join('\n')}

BY BUDGET TYPE
--------------
${Object.entries(stats.byType).map(([type, count]) => `${type}: ${count}`).join('\n')}

BY STATUS
---------
${Object.entries(stats.byStatus).map(([status, count]) => `${status}: ${count}`).join('\n')}
`;

    fs.writeFileSync(reportPath, reportContent, 'utf8');
    console.log(`✅ Summary report exported to: ${reportPath}\n`);

    // Close database connection
    await mongoose.connection.close();
    console.log('✅ Database connection closed\n');

  } catch (error) {
    console.error('❌ Error fetching budget codes:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run the script
fetchAllBudgetCodes();










// // fetchAllProjects.js
// const mongoose = require('mongoose');
// require('dotenv').config();

// // Connect to MongoDB
// const connectDB = async () => {
//   try {
//     await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database-name', {
//       useNewUrlParser: true,
//       useUnifiedTopology: true,
//     });
//     console.log('✅ MongoDB Connected Successfully');
//   } catch (error) {
//     console.error('❌ MongoDB Connection Error:', error);
//     process.exit(1);
//   }
// };

// // Define Project Schema (simplified - adjust to match your actual schema)
// const projectSchema = new mongoose.Schema({
//   code: String,
//   name: String,
//   description: String,
//   projectType: String,
//   priority: String,
//   status: String,
//   department: String,
//   projectManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//   budgetCodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'BudgetCode' },
//   timeline: {
//     startDate: Date,
//     endDate: Date
//   },
//   isDraft: { type: Boolean, default: false },
//   isActive: { type: Boolean, default: true },
//   progress: Number,
//   milestones: Array,
//   createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//   createdAt: Date,
//   updatedAt: Date
// }, { 
//   timestamps: true,
//   collection: 'projects' // Adjust if your collection name is different
// });

// const Project = mongoose.model('Project', projectSchema);

// // Main function to fetch and analyze projects
// const fetchAllProjects = async () => {
//   try {
//     console.log('\n🔍 FETCHING ALL PROJECTS FROM DATABASE...\n');
    
//     // Fetch all projects without filters
//     const allProjects = await Project.find({})
//       .populate('projectManager', 'fullName email')
//       .populate('budgetCodeId', 'code name budget remaining')
//       .populate('createdBy', 'fullName email')
//       .lean();

//     console.log(`📊 TOTAL PROJECTS IN DATABASE: ${allProjects.length}\n`);

//     // Analyze projects by different criteria
//     const analysis = {
//       total: allProjects.length,
//       active: allProjects.filter(p => p.isActive === true).length,
//       inactive: allProjects.filter(p => p.isActive === false).length,
//       drafts: allProjects.filter(p => p.isDraft === true).length,
//       nonDrafts: allProjects.filter(p => p.isDraft === false).length,
//       withBudgetCode: allProjects.filter(p => p.budgetCodeId).length,
//       withoutBudgetCode: allProjects.filter(p => !p.budgetCodeId).length,
//       byStatus: {},
//       byDepartment: {},
//       missingCode: allProjects.filter(p => !p.code).length,
//       missingName: allProjects.filter(p => !p.name).length
//     };

//     // Group by status
//     allProjects.forEach(p => {
//       const status = p.status || 'undefined';
//       analysis.byStatus[status] = (analysis.byStatus[status] || 0) + 1;
//     });

//     // Group by department
//     allProjects.forEach(p => {
//       const dept = p.department || 'undefined';
//       analysis.byDepartment[dept] = (analysis.byDepartment[dept] || 0) + 1;
//     });

//     // Print analysis
//     console.log('📈 PROJECT ANALYSIS:');
//     console.log('═══════════════════════════════════════');
//     console.log(`Total Projects:              ${analysis.total}`);
//     console.log(`Active Projects:             ${analysis.active}`);
//     console.log(`Inactive Projects:           ${analysis.inactive}`);
//     console.log(`Draft Projects:              ${analysis.drafts}`);
//     console.log(`Non-Draft Projects:          ${analysis.nonDrafts}`);
//     console.log(`With Budget Code:            ${analysis.withBudgetCode}`);
//     console.log(`Without Budget Code:         ${analysis.withoutBudgetCode}`);
//     console.log(`Missing Code Field:          ${analysis.missingCode}`);
//     console.log(`Missing Name Field:          ${analysis.missingName}`);
    
//     console.log('\n📊 BY STATUS:');
//     Object.entries(analysis.byStatus).forEach(([status, count]) => {
//       console.log(`  ${status.padEnd(20)}: ${count}`);
//     });
    
//     console.log('\n🏢 BY DEPARTMENT:');
//     Object.entries(analysis.byDepartment).forEach(([dept, count]) => {
//       console.log(`  ${dept.padEnd(20)}: ${count}`);
//     });

//     // Show detailed project list
//     console.log('\n\n📋 DETAILED PROJECT LIST:');
//     console.log('═══════════════════════════════════════════════════════════════════');
    
//     allProjects.forEach((project, index) => {
//       console.log(`\n${index + 1}. ${project.name || 'UNNAMED PROJECT'}`);
//       console.log(`   ID:              ${project._id}`);
//       console.log(`   Code:            ${project.code || 'NO CODE'}`);
//       console.log(`   Status:          ${project.status || 'NO STATUS'}`);
//       console.log(`   Department:      ${project.department || 'NO DEPARTMENT'}`);
//       console.log(`   isDraft:         ${project.isDraft}`);
//       console.log(`   isActive:        ${project.isActive}`);
//       console.log(`   Budget Code:     ${project.budgetCodeId ? 
//         `${project.budgetCodeId.code} (${project.budgetCodeId._id})` : 
//         'NOT ASSIGNED'}`);
//       console.log(`   Project Manager: ${project.projectManager?.fullName || 'NOT ASSIGNED'}`);
//       console.log(`   Progress:        ${project.progress || 0}%`);
//       console.log(`   Milestones:      ${project.milestones?.length || 0}`);
//       console.log(`   Created:         ${project.createdAt ? new Date(project.createdAt).toLocaleDateString() : 'UNKNOWN'}`);
//       console.log(`   Updated:         ${project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : 'UNKNOWN'}`);
//     });

//     // Check for potential issues
//     console.log('\n\n⚠️  POTENTIAL ISSUES:');
//     console.log('═══════════════════════════════════════');
    
//     const issues = [];
    
//     allProjects.forEach(p => {
//       if (!p.code && !p.isDraft) {
//         issues.push(`❌ Project "${p.name}" (${p._id}) is NOT a draft but has NO CODE`);
//       }
//       if (!p.name) {
//         issues.push(`❌ Project ${p._id} has NO NAME`);
//       }
//       if (p.isDraft === undefined || p.isDraft === null) {
//         issues.push(`⚠️  Project "${p.name}" (${p._id}) has UNDEFINED isDraft field`);
//       }
//       if (p.isActive === undefined || p.isActive === null) {
//         issues.push(`⚠️  Project "${p.name}" (${p._id}) has UNDEFINED isActive field`);
//       }
//       if (p.budgetCodeId && !p.budgetCodeId.code) {
//         issues.push(`⚠️  Project "${p.name}" has budgetCodeId but it wasn't populated properly`);
//       }
//     });

//     if (issues.length > 0) {
//       issues.forEach(issue => console.log(issue));
//     } else {
//       console.log('✅ No issues found!');
//     }

//     // Test filter queries (simulate what your API does)
//     console.log('\n\n🧪 TESTING FILTER QUERIES:');
//     console.log('═══════════════════════════════════════');
    
//     // Test 1: isDraft=false
//     const nonDraftsQuery = await Project.countDocuments({ 
//       isActive: true, 
//       isDraft: false 
//     });
//     console.log(`Filter { isActive: true, isDraft: false }:  ${nonDraftsQuery} projects`);
    
//     // Test 2: isDraft=true
//     const draftsQuery = await Project.countDocuments({ 
//       isActive: true, 
//       isDraft: true 
//     });
//     console.log(`Filter { isActive: true, isDraft: true }:   ${draftsQuery} projects`);
    
//     // Test 3: isDraft missing or null
//     const undefinedDrafts = await Project.countDocuments({
//       isActive: true,
//       $or: [
//         { isDraft: { $exists: false } },
//         { isDraft: null }
//       ]
//     });
//     console.log(`Projects with undefined/null isDraft:       ${undefinedDrafts} projects`);
    
//     // Test 4: Active projects (all)
//     const activeProjects = await Project.countDocuments({ isActive: true });
//     console.log(`Total active projects:                      ${activeProjects} projects`);

//     // Show projects with missing isDraft field
//     if (undefinedDrafts > 0) {
//       console.log('\n⚠️  PROJECTS WITH MISSING isDraft FIELD:');
//       const missingDraft = await Project.find({
//         isActive: true,
//         $or: [
//           { isDraft: { $exists: false } },
//           { isDraft: null }
//         ]
//       }).select('_id name code status').lean();
      
//       missingDraft.forEach(p => {
//         console.log(`   - ${p.name} (${p._id})`);
//       });
//     }

//     // Export to JSON file for detailed analysis
//     const fs = require('fs');
//     const exportData = {
//       timestamp: new Date().toISOString(),
//       analysis,
//       projects: allProjects.map(p => ({
//         _id: p._id,
//         name: p.name,
//         code: p.code,
//         status: p.status,
//         department: p.department,
//         isDraft: p.isDraft,
//         isActive: p.isActive,
//         budgetCodeId: p.budgetCodeId?._id,
//         budgetCode: p.budgetCodeId?.code,
//         projectManager: p.projectManager?.fullName,
//         progress: p.progress,
//         milestonesCount: p.milestones?.length || 0,
//         createdAt: p.createdAt,
//         updatedAt: p.updatedAt
//       }))
//     };

//     fs.writeFileSync('projects-export.json', JSON.stringify(exportData, null, 2));
//     console.log('\n\n💾 Full data exported to: projects-export.json');

//   } catch (error) {
//     console.error('❌ Error fetching projects:', error);
//   } finally {
//     await mongoose.connection.close();
//     console.log('\n✅ Database connection closed');
//   }
// };

// // Run the script
// (async () => {
//   await connectDB();
//   await fetchAllProjects();
//   process.exit(0);
// })();