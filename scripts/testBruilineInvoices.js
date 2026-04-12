const mongoose = require('mongoose');
const SupplierInvoice = require('../models/SupplierInvoice');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const invoices = await SupplierInvoice.getPendingForApprover('bruiline.tsitoh@gratoglobal.com');
  
  console.log('\n=== INVOICES FOR BRUILINE ===\n');
  console.log('Found:', invoices.length, 'invoices\n');
  
  invoices.forEach(inv => {
    const currentStep = inv.approvalChain.find(s => s.level === inv.currentApprovalLevel);
    console.log(`Invoice: ${inv.invoiceNumber}`);
    console.log(`  Department: ${inv.assignedDepartment}`);
    console.log(`  Current Level: ${inv.currentApprovalLevel}`);
    console.log(`  Current Approver: ${currentStep?.approver?.name} (${currentStep?.approver?.email})`);
    console.log(`  Status: ${inv.approvalStatus}\n`);
  });
  
  process.exit(0);
}).catch(err => {
  console.error('DB Error:', err.message);
  process.exit(1);
});
