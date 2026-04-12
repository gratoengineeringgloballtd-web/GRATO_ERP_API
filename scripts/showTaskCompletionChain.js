require('dotenv').config();
const mongoose = require('mongoose');
const ActionItem = require('../models/ActionItem');
const Project = require('../models/Project');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function main() {
  const taskId = process.argv[2];
  if (!taskId) {
    console.log('Usage: node scripts/showTaskCompletionChain.js <taskId>');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);

  const task = await ActionItem.findById(taskId).lean();
  if (!task) {
    console.log('Task not found');
    await mongoose.disconnect();
    return;
  }

  console.log(`Task: ${task.title} (${task.status})`);
  console.log(`ProjectId: ${task.projectId}`);
  if (task.projectId) {
    const project = await Project.findById(task.projectId).select('name createdBy projectManager').lean();
    console.log('Project:', project);
  }

  task.assignedTo.forEach((assignee) => {
    console.log(`Assignee: ${assignee.user}`);
    assignee.completionApprovalChain?.forEach(step => {
      console.log(`  L${step.level} ${step.status}: ${step.approver?.name} <${step.approver?.email}> (${step.approver?.userId})`);
    });
  });

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
