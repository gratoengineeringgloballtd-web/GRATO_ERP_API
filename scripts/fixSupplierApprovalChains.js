// Fix supplier (User) approval chains — remove CEO step from supplier
// CREATION approval chains. CEO should only approve supplier INVOICES,
// not supplier onboarding/creation.
//
// Usage: node fixSupplierApprovalChains.js
//
// Safe to re-run — it's idempotent: suppliers with no CEO step are skipped.

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const CEO_EMAIL = 'tom@gratoengineering.com'; // adjust if your CEO.email config differs
const CEO_ROLE_LABEL = 'CEO - Final Authority';

function isCeoStep(step) {
  if (!step?.approver) return false;
  const email = String(step.approver.email || '').toLowerCase();
  return email === CEO_EMAIL.toLowerCase() || step.approver.role === CEO_ROLE_LABEL;
}

// Maps a renumbered level (post CEO-removal) to the matching accountStatus,
// mirroring the corrected getNextSupplierStatus() in supplierApprovalChain.js
function statusForLevel(level, totalLevels) {
  if (level > totalLevels) return 'approved';
  switch (level) {
    case 1: return 'pending_supply_chain';
    case 2: return 'pending_head_of_business';
    case 3: return 'pending_finance';
    default: return 'approved';
  }
}

async function fixSupplierApprovalChains() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);

    console.log('\nFinding suppliers whose approval chain includes a CEO step...');

    const suppliers = await User.find({
      role: 'supplier',
      approvalChain: { $exists: true, $ne: [] }
    });

    console.log(`\nScanning ${suppliers.length} supplier records...`);

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const supplier of suppliers) {
      const companyName = supplier.supplierDetails?.companyName || supplier.email;
      const hasCeoStep = supplier.approvalChain.some(isCeoStep);

      if (!hasCeoStep) {
        skippedCount++;
        continue;
      }

      console.log(`\n--- ${companyName} (${supplier._id}) ---`);
      console.log(`  Current status: ${supplier.supplierStatus?.accountStatus}`);
      console.log(`  Current level:  ${supplier.currentApprovalLevel}`);
      console.log(
        `  Chain before:`,
        supplier.approvalChain.map(s => `L${s.level}:${s.approver.role}(${s.status})`).join(', ')
      );

      try {
        // Was the CEO step itself the one pending/approved/rejected, before removal?
        const ceoStepIndex = supplier.approvalChain.findIndex(isCeoStep);
        const ceoStep = supplier.approvalChain[ceoStepIndex];
        const wasFinalApprovedViaCeo = ceoStep?.status === 'approved';

        // Remove the CEO step
        const newChain = supplier.approvalChain.filter(step => !isCeoStep(step));

        // Renumber levels sequentially
        newChain.forEach((step, index) => {
          step.level = index + 1;
        });

        supplier.approvalChain = newChain;

        const totalLevels = newChain.length;

        if (wasFinalApprovedViaCeo) {
          // CEO had already approved — supplier should now be fully approved
          // since CEO was the last step and is now removed.
          supplier.supplierStatus.accountStatus = 'approved';
          supplier.currentApprovalLevel = 0;
          if (!supplier.supplierStatus.approvalDate) {
            supplier.supplierStatus.approvalDate = new Date();
          }
          supplier.isActive = true;
          console.log(`  ⚠ CEO had already approved — promoting supplier to fully 'approved'`);
        } else {
          // Clamp currentApprovalLevel into the new (shorter) chain range
          let newLevel = Math.min(supplier.currentApprovalLevel, totalLevels);
          if (newLevel < 1) newLevel = 1;
          supplier.currentApprovalLevel = newLevel;

          const newStatus = statusForLevel(newLevel, totalLevels);
          supplier.supplierStatus.accountStatus = newStatus;
        }

        await supplier.save();
        fixedCount++;

        console.log(
          `  Chain after: `,
          supplier.approvalChain.map(s => `L${s.level}:${s.approver.role}(${s.status})`).join(', ')
        );
        console.log(`  ✅ New status: ${supplier.supplierStatus.accountStatus}, level: ${supplier.currentApprovalLevel}`);
      } catch (err) {
        errorCount++;
        console.error(`  ❌ Error fixing ${companyName}: ${err.message}`);
      }
    }

    console.log(`\n\n=== SUMMARY ===`);
    console.log(`Total suppliers scanned: ${suppliers.length}`);
    console.log(`Had CEO step (fixed):    ${fixedCount}`);
    console.log(`No CEO step (skipped):   ${skippedCount}`);
    console.log(`Errors:                  ${errorCount}`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fixSupplierApprovalChains();