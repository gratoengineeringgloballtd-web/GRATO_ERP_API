// scripts/fixProjectPlanApprovalChain.js
// Fix existing project plans to have 3-level approval chain

require('dotenv').config();
const mongoose = require('mongoose');
const ProjectPlan = require('../models/ProjectPlan');
const User = require('../models/User'); // Required for populate
const { getProjectPlanApprovalChain } = require('../config/projectPlanApprovalChain');

async function fixProjectPlanApprovalChains() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find all project plans that are pending approval or approved
    const plans = await ProjectPlan.find({
      status: { 
        $in: [
          'Pending Project Coordinator Approval',
          'Pending Head of Business Approval',
          'Pending Supply Chain Coordinator Approval',
          'Approved'
        ] 
      }
    }).populate('createdBy', 'fullName email');

    console.log(`\n📊 Found ${plans.length} project plans to check\n`);

    for (const plan of plans) {
      console.log(`\n🔍 Checking: ${plan.projectName} (${plan._id})`);
      console.log(`   Status: ${plan.status}`);
      console.log(`   Current approval chain length: ${plan.approvalChain.length}`);

      // If approval chain has less than 3 levels, fix it
      if (plan.approvalChain.length < 3) {
        console.log(`   ⚠️ Approval chain has only ${plan.approvalChain.length} levels. Fixing...`);

        const currentLevel = plan.currentApprovalLevel;
        const approvedLevels = plan.approvalChain.filter(item => item.status === 'approved');

        // Generate new 3-level chain
        const newChain = getProjectPlanApprovalChain(plan.department);

        // Preserve existing approvals
        approvedLevels.forEach(approvedItem => {
          const chainItem = newChain.find(item => item.level === approvedItem.level);
          if (chainItem) {
            chainItem.status = 'approved';
            chainItem.approvalDate = approvedItem.approvalDate;
            chainItem.comments = approvedItem.comments;
            chainItem.approvedBy = approvedItem.approvedBy;
          }
        });

        // Update the plan
        plan.approvalChain = newChain;

        // Adjust current level and status if needed
        if (currentLevel === 1 && plan.status === 'Pending Head of Business Approval') {
          // Plan was at level 2 (old head of business), now should be at level 2 (supply chain)
          plan.currentApprovalLevel = 2;
          plan.status = 'Pending Supply Chain Coordinator Approval';
          console.log(`   ✅ Updated status to: ${plan.status}`);
        }

        await plan.save();
        console.log(`   ✅ Fixed approval chain - now has ${plan.approvalChain.length} levels`);
        console.log(`   ✅ New chain:`);
        plan.approvalChain.forEach(item => {
          console.log(`      L${item.level}: ${item.approver} (${item.role}) - ${item.status}`);
        });
      } else {
        console.log(`   ✅ Approval chain is correct (3 levels)`);
      }
    }

    console.log('\n✅ All project plans have been checked and fixed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

fixProjectPlanApprovalChains();
