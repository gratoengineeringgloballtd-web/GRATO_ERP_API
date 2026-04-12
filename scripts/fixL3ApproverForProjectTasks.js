require('dotenv').config();
const mongoose = require('mongoose');
const ActionItem = require('../models/ActionItem');
const Project = require('../models/Project');
const User = require('../models/User');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

async function fixL3Approvers() {
  console.log('🔧 FIXING L3 APPROVERS FOR PROJECT TASKS');
  console.log('='.repeat(80));

  const tasks = await ActionItem.find({
    status: 'Pending L3 Final Approval',
    projectId: { $ne: null }
  }).select('projectId assignedTo title');

  console.log(`Found ${tasks.length} task(s) with Pending L3 Final Approval`);

  let updatedCount = 0;

  for (const task of tasks) {
      const project = await Project.findById(task.projectId).select('createdBy projectManager');
      if (!project?.createdBy && !project?.projectManager) {
      continue;
    }

    let finalApprover = null;
      if (project?.createdBy) {
        finalApprover = await User.findById(project.createdBy).select('fullName email');
      }
      if (!finalApprover && project?.projectManager) {
        finalApprover = await User.findById(project.projectManager).select('fullName email');
      }
    if (!finalApprover) {
      continue;
    }

    let taskUpdated = false;

    task.assignedTo.forEach((assignee) => {
      const l3 = assignee.completionApprovalChain?.find(a => a.level === 3);
      if (!l3 || l3.status !== 'pending') {
        return;
      }

      const currentApproverId = l3.approver?.userId?.toString();
      const correctApproverId = finalApprover._id.toString();

      if (currentApproverId === correctApproverId) {
        return;
      }

      l3.approver = {
        userId: finalApprover._id,
        name: finalApprover.fullName,
        email: finalApprover.email,
        role: 'project_creator'
      };
      taskUpdated = true;
    });

    if (taskUpdated) {
      task.markModified('assignedTo');
      await task.save();
      updatedCount += 1;
      console.log(`✅ Updated L3 approver for task: ${task.title} (${task._id})`);
    }
  }

  console.log('='.repeat(80));
  console.log(`Done. Updated ${updatedCount} task(s).`);
}

(async () => {
  await connectDB();
  await fixL3Approvers();
  await mongoose.disconnect();
})();
