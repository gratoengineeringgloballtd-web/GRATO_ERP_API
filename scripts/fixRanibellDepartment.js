/**
 * fixRanibellDepartment.js
 *
 * Corrects ranibellmambo@gratoengineering.com's department field to 'Finance'.
 *
 * WHY: she's currently showing up under 'Business Development & Supply Chain' in the
 * HR department distribution, but she's referenced throughout the codebase as the
 * finance approver/verifier for cash requests, invoices, and purchase requisitions
 * (config/invoiceApprovalChain.js, cashRequestController.js, purchaseRequisitionController.js,
 * budgetCodeController.js all hardcode her email as a finance-access exception).
 *
 * NOTE: the sheer number of hardcoded email exceptions for her (rather than just relying
 * on role === 'finance') suggests her `role` field may ALSO be set to something other than
 * 'finance', not just her department. This script only touches department, since that's
 * what was asked for - if you want her role corrected too, that's a separate, more
 * consequential change (affects route/API access broadly) worth deciding on deliberately.
 *
 * Usage:
 *   node scripts/fixRanibellDepartment.js
 *   node scripts/fixRanibellDepartment.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_EMAIL = 'ranibellmambo@gratoengineering.com';
const CORRECT_DEPARTMENT = 'Finance';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN — no writes will be made)' : ''}\n`);

  const user = await User.findOne({ email: TARGET_EMAIL });

  if (!user) {
    console.log(`❌ No user found with email ${TARGET_EMAIL}`);
    await mongoose.disconnect();
    return;
  }

  console.log(`Found: ${user.fullName} (${user.email})`);
  console.log(`   Current department: ${user.department}`);
  console.log(`   Current role:       ${user.role}`);
  console.log(`   Current position:   ${user.position}`);

  if (user.department === CORRECT_DEPARTMENT) {
    console.log(`\nℹ️  Department is already "${CORRECT_DEPARTMENT}" — nothing to do.`);
  } else {
    console.log(`\n${DRY_RUN ? '[dry-run] would update' : 'Updating'} department: "${user.department}" → "${CORRECT_DEPARTMENT}"`);
    if (!DRY_RUN) {
      user.department = CORRECT_DEPARTMENT;
      await user.save();
      console.log('✅ Updated.');
    }
  }

  if (user.role !== 'finance') {
    console.log(`\n⚠️  Note: her role field is "${user.role}", not "finance". This script did NOT change`);
    console.log('   it, since that affects broader access and wasn\'t part of what was asked. The');
    console.log('   codebase has several hardcoded email checks that only exist because her role');
    console.log('   isn\'t "finance" - worth deciding separately whether to correct that too.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
