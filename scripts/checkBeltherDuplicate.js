/**
 * checkBeltherDuplicate.js
 *
 * WHY THIS EXISTS
 * ----------------
 * config/departmentStructure.js already had a 'House Maid' entry for "Ms. Ndi Belther"
 * (ndi.belther@gratoengineering.com) reporting to Bruiline, BEFORE
 * createEmployeesFromSpreadsheet.js created "Nih Belther Azwe"
 * (nih.belther@gratoglobal.com) - also House Maid, also reporting to Bruiline.
 *
 * Same surname, same unusual role, same supervisor: this is very likely the same
 * person under two different spellings and two different email domains, not two
 * different people. This script checks whether the OLD email actually has a real
 * account, so you can decide how to reconcile them - it makes no changes itself.
 *
 * Usage:
 *   node scripts/checkBeltherDuplicate.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('Connected to:', mongoose.connection.db.databaseName, '\n');

  const oldAccount = await User.findOne({ email: /ndi\.belther/i });
  const newAccount = await User.findOne({ email: /nih\.belther/i });

  console.log('OLD config entry (ndi.belther@gratoengineering.com):');
  if (oldAccount) {
    console.log(`  ✅ Real account exists: ${oldAccount.fullName} (${oldAccount.email}), role=${oldAccount.role}, active=${oldAccount.isActive}, created ${oldAccount.createdAt}`);
  } else {
    console.log('  ❌ No account exists for this email - the config entry was never turned into a real user.');
  }

  console.log('\nNEW account just created (nih.belther@gratoglobal.com):');
  if (newAccount) {
    console.log(`  ✅ Exists: ${newAccount.fullName} (${newAccount.email}), personalEmail=${newAccount.personalEmail || 'none'}, created ${newAccount.createdAt}`);
  } else {
    console.log('  ❌ Not found - did createEmployeesFromSpreadsheet.js actually run?');
  }

  console.log('\n' + '='.repeat(60));
  if (oldAccount && newAccount) {
    console.log('Both emails have real accounts - you now have two separate logins for');
    console.log('what is very likely the same person. Decide which one is correct and');
    console.log('deactivate (do not delete, to preserve history) the other.');
  } else if (!oldAccount && newAccount) {
    console.log('Only the NEW account is real. The old departmentStructure.js entry was');
    console.log('just a stale config reference that was never turned into an actual user -');
    console.log('safe to update that config entry to point at the new email, or remove it,');
    console.log('since the new one now covers this person correctly.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
