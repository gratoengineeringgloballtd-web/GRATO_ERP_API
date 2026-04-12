// Fix supplier invoices with old approval chains
const mongoose = require('mongoose');
const SupplierInvoice = require('../models/SupplierInvoice');
const { getSupplierApprovalChain } = require('../config/supplierApprovalChain');
require('dotenv').config();

async function fixInvoices() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log('\nFinding invoices that need approval chain fixes...');
    
    // Find all invoices with approval status
    const invoices = await SupplierInvoice.find({ 
      approvalStatus: { 
        $in: [
          'pending_department_head_approval', 
          'pending_head_of_business_approval',
          'pending_finance_approval'
        ] 
      },
      assignedDepartment: { $exists: true, $ne: null }
    });
    
    console.log(`\nFound ${invoices.length} invoices to potentially fix`);
    
    let fixedCount = 0;
    
    for (const invoice of invoices) {
      console.log(`\n--- Invoice ${invoice.invoiceNumber} ---`);
      console.log(`Department: ${invoice.assignedDepartment}`);
      console.log(`Current Level 1 Approver: ${invoice.approvalChain[0]?.approver?.name}`);
      
      // Regenerate the approval chain for this department
      try {
        const newChain = getSupplierApprovalChain(invoice.assignedDepartment);
        
        // Update the approval chain
        invoice.approvalChain = newChain.map((step, index) => ({
          level: step.level,
          approver: {
            name: step.approver.name,
            email: step.approver.email,
            role: step.approver.role,
            department: step.approver.department
          },
          status: index === 0 ? 'pending' : 'pending',
          activatedDate: index === 0 ? invoice.approvalChain[0]?.activatedDate || new Date() : null
        }));
        
        // Reset current approval level if it was affected
        if (!invoice.currentApprovalLevel) {
          invoice.currentApprovalLevel = 1;
        }
        
        await invoice.save();
        fixedCount++;
        
        console.log(`✅ Fixed - New Level 1 Approver: ${invoice.approvalChain[0]?.approver?.name}`);
      } catch (err) {
        console.error(`❌ Error fixing invoice: ${err.message}`);
      }
    }
    
    console.log(`\n\n=== SUMMARY ===`);
    console.log(`Total invoices processed: ${invoices.length}`);
    console.log(`Successfully fixed: ${fixedCount}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fixInvoices();
