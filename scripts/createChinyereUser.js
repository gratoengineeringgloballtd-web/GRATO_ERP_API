/**
 * createChinyereUser.js
 *
 * WHY THIS EXISTS
 * ----------------
 * config/departmentStructure.js now lists Chinyere Tamaia as Marketing Intern under
 * Marcel Ngong, but that config is only used for building approval chains/org lookups -
 * it doesn't create an actual account. attachSignaturesByName.js correctly failed with
 * "No user found" because there's no User document for her at all yet. This creates one.
 *
 * WHAT IT DOES
 * ------------
 * Creates a single User document:
 *   - email: tamaia.chinyere@gratoglobal.com
 *   - role: 'employee' (the system access level - she has no special permissions)
 *   - position: 'Marketing Intern' (the display title)
 *   - department: 'IT' (matches where she was placed in departmentStructure.js -
 *     Marcel's own entry lives under the 'IT' department key there too)
 *   - supervisor: looked up and set to Marcel Ngong's actual User _id, so the
 *     relationship is real in the database, not just the config file
 *   - employmentDetails.contractType: 'Internship', employmentStatus defaults to
 *     'Probation' (the schema's own default - appropriate for a new intern)
 *   - password: a random temporary one, printed once at the end so it can be shared
 *     with her securely - never logged anywhere else, never stored in this script
 *
 * Also appends her to Marcel's own directReports array for relational consistency,
 * if that field isn't already populated with her.
 *
 * Safe to re-run: if a user with this email already exists, the script reports that
 * and exits without changing anything - it will not overwrite an existing account or
 * reset an existing password.
 *
 * Usage:
 *   node scripts/createChinyereUser.js
 *   node scripts/createChinyereUser.js --password "SomeSpecificPassword123"
 *   node scripts/createChinyereUser.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');

const DRY_RUN = process.argv.includes('--dry-run');
const passwordFlagIndex = process.argv.indexOf('--password');
const EXPLICIT_PASSWORD = passwordFlagIndex !== -1 ? process.argv[passwordFlagIndex + 1] : null;

const NEW_USER = {
  email: 'tamaia.chinyere@gratoglobal.com',
  fullName: 'Chinyere Tamaia',
  role: 'employee',
  department: 'IT',
  position: 'Marketing Intern',
  supervisorEmail: 'marcel.ngong@gratoglobal.com'
};

function generateTempPassword() {
  // Readable-ish random password: 12 hex chars, easy to type over the phone/chat once.
  return crypto.randomBytes(6).toString('hex');
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN — no writes will be made)' : ''}\n`);

  const existing = await User.findOne({ email: new RegExp(`^${NEW_USER.email}$`, 'i') });
  if (existing) {
    console.log(`ℹ️  A user with email ${NEW_USER.email} already exists (${existing.fullName}) - nothing to do.`);
    console.log('   If you need to reset her password or update her details, use a different script - this one never modifies an existing account.');
    await mongoose.disconnect();
    return;
  }

  const supervisor = await User.findOne({ email: new RegExp(`^${NEW_USER.supervisorEmail}$`, 'i') });
  if (!supervisor) {
    console.error(`❌ Could not find supervisor account for ${NEW_USER.supervisorEmail} - is Marcel's own account email correct?`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`✅ Supervisor found: ${supervisor.fullName} (${supervisor.email})\n`);

  const tempPassword = EXPLICIT_PASSWORD || generateTempPassword();

  console.log(`${DRY_RUN ? '[dry-run] would create' : 'Creating'} user:`);
  console.log(`   Name       : ${NEW_USER.fullName}`);
  console.log(`   Email      : ${NEW_USER.email}`);
  console.log(`   Role       : ${NEW_USER.role}`);
  console.log(`   Position   : ${NEW_USER.position}`);
  console.log(`   Department : ${NEW_USER.department}`);
  console.log(`   Supervisor : ${supervisor.fullName}\n`);

  if (DRY_RUN) {
    console.log('Dry run complete - no user was created. Re-run without --dry-run to apply.');
    await mongoose.disconnect();
    return;
  }

  const user = new User({
    email: NEW_USER.email,
    fullName: NEW_USER.fullName,
    password: tempPassword, // hashed automatically by the User schema's pre('save') hook
    role: NEW_USER.role,
    department: NEW_USER.department,
    position: NEW_USER.position,
    supervisor: supervisor._id,
    isActive: true,
    employmentDetails: {
      contractType: 'Internship'
      // employmentStatus defaults to 'Probation' per the schema - appropriate here
    }
  });

  await user.save();
  console.log(`✅ User created: ${user._id}`);

  // Keep Marcel's directReports in sync, for relational consistency.
  if (!supervisor.directReports?.some(id => id.toString() === user._id.toString())) {
    supervisor.directReports = [...(supervisor.directReports || []), user._id];
    await supervisor.save();
    console.log(`✅ Added to ${supervisor.fullName}'s directReports`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('TEMPORARY PASSWORD (share this with her securely - not logged anywhere else):');
  console.log(`   ${tempPassword}`);
  console.log('='.repeat(60));
  console.log('\nShe should log in and change this password as soon as possible.');
  console.log(`\nNext step: attach her signature with:`);
  console.log(`   node scripts/attachSignaturesByName.js "Chinyere-removebg-preview" "${NEW_USER.email}"`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
