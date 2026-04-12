// Patch script for requisition resubmission
// Usage: node scripts/patch_resubmission_6995f1cec7a3a85f74f3e407.js

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const { getApprovalChainForRequisition } = require('../config/requisitionApprovalChain');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/erp';

async function patchRequisition() {
  await mongoose.connect(MONGO_URI);

  const requisitionId = '6995f1cec7a3a85f74f3e407';
  const requisition = await PurchaseRequisition.findById(requisitionId).populate('employee', 'email fullName');
  if (!requisition) {
    console.error('Requisition not found');
    process.exit(1);
  }

  // Patch items
  requisition.items = [
    {
      itemId: requisition.items[0].itemId,
      code: 'SW-001',
      description: 'Payment for the monthly MTN network subscription',
      customDescription: 'Payment for the monthly MTN network subscription',
      quantity: 1,
      customUnitPrice: 140000,
      category: requisition.items[0].category,
      subcategory: requisition.items[0].subcategory,
      measuringUnit: requisition.items[0].measuringUnit,
      estimatedPrice: 140000,
      projectName: requisition.items[0].projectName || ''
    },
    {
      itemId: requisition.items[0].itemId,
      code: 'SW-001',
      description: 'Monthly Unlimited Internet for the Office',
      customDescription: 'Monthly Unlimited Internet for the Office',
      quantity: 1,
      customUnitPrice: 45000,
      category: requisition.items[0].category,
      subcategory: requisition.items[0].subcategory,
      measuringUnit: requisition.items[0].measuringUnit,
      estimatedPrice: 45000,
      projectName: requisition.items[0].projectName || ''
    },
    {
      itemId: requisition.items[0].itemId,
      code: 'SW-001',
      description: 'Additional mobile data allowance for essential IT systems support',
      customDescription: 'Additional mobile data allowance for essential IT systems support',
      quantity: 1,
      customUnitPrice: 20000,
      category: requisition.items[0].category,
      subcategory: requisition.items[0].subcategory,
      measuringUnit: requisition.items[0].measuringUnit,
      estimatedPrice: 20000,
      projectName: requisition.items[0].projectName || ''
    }
  ];

  // Patch justification
  requisition.justificationOfPurchase = 'This amount is allocated to ensure that all IT systems continue to operate without interruption.';

  // Patch attachment
  const attachmentPath = path.join(__dirname, '../uploads/LIST.xlsx');
  if (fs.existsSync(attachmentPath)) {
    requisition.attachments = [
      {
        name: 'LIST.xlsx',
        url: attachmentPath,
        publicId: 'LIST.xlsx',
        localPath: attachmentPath,
        size: fs.statSync(attachmentPath).size,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        uploadedAt: new Date()
      }
    ];
  } else {
    console.warn('Attachment LIST.xlsx not found in uploads folder');
  }

  // Reset approval chain
  requisition.approvalChain = getApprovalChainForRequisition(requisition.employee.email).map(step => ({
    level: step.level,
    approver: {
      name: step.approver.name,
      email: step.approver.email,
      role: step.approver.role,
      department: step.approver.department
    },
    status: 'pending',
    assignedDate: new Date()
  }));

  requisition.status = 'pending_supervisor';
  requisition.isResubmission = true;
  requisition.lastResubmittedDate = new Date();

  await requisition.save();
  console.log('Requisition patched successfully');
  mongoose.disconnect();
}

patchRequisition();
