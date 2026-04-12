const mongoose = require('mongoose');
const PurchaseOrder = require('../models/PurchaseOrder');

const MONGO_URI = "mongodb+srv://gratoportal_db_user:OmGZbNiqffLJraHz@cluster0.uw3xeqa.mongodb.net/" ;

const PO_ID = '69a5cb75d478ad239f417556'; // PO-2026-000034
const APPROVER_EMAIL = 'marcel.ngong@gratoglobal.com';
const APPROVER_NAME = 'Mr. Marcel Ngong';
const USER_ID = '691abf4dc7430e81c1984697'; // Marcel userId

async function signPO() {
  await mongoose.connect(MONGO_URI);

  const po = await PurchaseOrder.findById(PO_ID);

  if (!po) {
    throw new Error('Purchase Order not found');
  }

  // Ensure approver is allowed
  if (!po.canUserApprove(APPROVER_EMAIL)) {
    throw new Error('You are not authorized to approve this PO');
  }

  // Process approval using schema logic
  po.processApprovalStep(
    APPROVER_EMAIL,
    'approved',
    'Approved by Department Head',
    USER_ID
  );

  // Add activity log
  po.activities.push({
    type: 'approved',
    description: `PO approved by Department Head (${APPROVER_NAME})`,
    user: APPROVER_NAME,
    timestamp: new Date()
  });

  po.lastModifiedDate = new Date();
  po.lastModifiedBy = USER_ID;

  await po.save();

  console.log('✅ PO APPROVED SUCCESSFULLY');
  console.log('PO:', po.poNumber);
  console.log('Current Level:', po.currentApprovalLevel);
  console.log('New Status:', po.status);

  await mongoose.disconnect();
}

signPO().catch(err => {
  console.error('❌ Approval failed:', err.message);
  process.exit(1);
});