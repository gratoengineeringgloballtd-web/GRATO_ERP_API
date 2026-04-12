require('dotenv').config();
const mongoose = require('mongoose');
const ActionItem = require('../models/ActionItem');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function main() {
  await mongoose.connect(MONGO_URI);
  const userId = process.argv[2];
  const email = process.argv[3];

  if (!userId && !email) {
    console.log('Usage: node scripts/debugApprovalTasksForUser.js <userId> <email>');
    process.exit(1);
  }

  const userObjectId = userId ? new mongoose.Types.ObjectId(userId) : null;
  const statuses = [
    'Pending Completion Approval',
    'Pending L1 Grading',
    'Pending L2 Review',
    'Pending L3 Final Approval'
  ];

  const filter = {
    status: { $in: statuses },
    assignedTo: {
      $elemMatch: {
        completionApprovalChain: {
          $elemMatch: {
            status: 'pending',
            $or: [
              ...(email ? [{ 'approver.email': email }] : []),
              ...(userObjectId ? [{ 'approver.userId': userObjectId }] : [])
            ]
          }
        }
      }
    }
  };

  const tasks = await ActionItem.find(filter)
    .select('title status assignedTo.completionApprovalChain')
    .limit(10)
    .lean();

  console.log(`Found ${tasks.length} task(s)`);
  tasks.forEach(t => {
    console.log(`- ${t.title} (${t.status})`);
    t.assignedTo.forEach(a => {
      const pending = a.completionApprovalChain?.find(c => c.status === 'pending');
      if (pending) {
        console.log(`  Pending L${pending.level}: ${pending.approver?.name} <${pending.approver?.email}> (${pending.approver?.userId})`);
      }
    });
  });

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
