/**
 * createTchikamenUser.js
 *
 * Creates the account for Tchikamen Emmanuel (Field Technician, Technical department,
 * reporting to Mr. Pascal Assam) and registers him in the runtime approval structure
 * so his requests route to Pascal, exactly as the IT console's "Add user" would.
 *
 * What it does
 *   1. Creates the User (role 'technical', department 'Technical', position 'Field Technician').
 *   2. Links his supervisor (User.supervisor) and adds him to the supervisor's directReports.
 *   3. Adds a StructureEntry (reports to Pascal, level 1, staff) so approval chains work.
 *   4. Prints a random temporary password once. Nothing is emailed unless you pass --send-email.
 *
 * Safe to re-run: if the email already exists it changes nothing.
 *
 * Usage (from the GRATO_ERP_API folder):
 *   node scripts/createTchikamenUser.js --dry-run
 *   node scripts/createTchikamenUser.js
 *   node scripts/createTchikamenUser.js --email "other.address@gratoglobal.com"   (if the email changes)
 *   node scripts/createTchikamenUser.js --password "SomeStrongPassword1!"
 *   node scripts/createTchikamenUser.js --send-email                              (emails the login details)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');
const StructureEntry = require('../models/StructureEntry');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const DRY_RUN = flag('--dry-run');
const SEND_EMAIL = flag('--send-email');

const NEW_USER = {
  fullName: 'Tchikamen Emmanuel',
  email: String(opt('--email') || 'emmanuel.tchikamen@gratoglobal.com').toLowerCase().trim(),
  role: 'technical',
  department: 'Technical',
  position: 'Field Technician', // matches the title Pascal Assam is set up to supervise
  departmentRole: 'staff',
  supervisorEmail: String(opt('--supervisor') || 'pascal.rodrique@gratoglobal.com').toLowerCase().trim()
};

function tempPassword() {
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const all = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let p = pick('ABCDEFGHJKLMNPQRSTUVWXYZ') + pick('abcdefghijkmnopqrstuvwxyz') + pick('23456789') + pick('@#$%');
  while (p.length < 12) p += pick(all);
  return p.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

const exactEmail = (e) => new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('No MONGODB_URI / MONGO_URI in .env'); process.exit(1); }
  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${DRY_RUN ? ' (DRY RUN, no writes)' : ''}\n`);

  const existing = await User.findOne({ email: exactEmail(NEW_USER.email) }).select('fullName email');
  if (existing) {
    console.log(`A user with email ${NEW_USER.email} already exists (${existing.fullName}). Nothing changed.`);
    await mongoose.disconnect();
    return;
  }

  const supervisor = await User.findOne({ email: exactEmail(NEW_USER.supervisorEmail) });
  if (!supervisor) {
    console.error(`Supervisor account not found for ${NEW_USER.supervisorEmail}. Check the address (use --supervisor "email" to override).`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Supervisor found: ${supervisor.fullName} (${supervisor.email})`);

  console.log(`\n${DRY_RUN ? '[dry-run] would create' : 'Creating'}:`);
  console.log(`  Name       : ${NEW_USER.fullName}`);
  console.log(`  Email      : ${NEW_USER.email}`);
  console.log(`  Role       : ${NEW_USER.role}`);
  console.log(`  Department : ${NEW_USER.department}`);
  console.log(`  Position   : ${NEW_USER.position}`);
  console.log(`  Supervisor : ${supervisor.fullName}\n`);

  if (DRY_RUN) {
    console.log('Dry run complete. Re-run without --dry-run to apply.');
    await mongoose.disconnect();
    return;
  }

  const password = opt('--password') || tempPassword();
  const user = new User({
    fullName: NEW_USER.fullName,
    email: NEW_USER.email,
    password, // hashed by the User schema's pre-save hook
    role: NEW_USER.role,
    department: NEW_USER.department,
    position: NEW_USER.position,
    departmentRole: NEW_USER.departmentRole,
    supervisor: supervisor._id,
    isActive: true
  });
  await user.save();
  console.log(`User created: ${user._id}`);

  if (!supervisor.directReports?.some((id) => id.toString() === user._id.toString())) {
    supervisor.directReports = [...(supervisor.directReports || []), user._id];
    await supervisor.save();
    console.log(`Added to ${supervisor.fullName}'s directReports`);
  }

  // Approval structure (same record the IT console creates). Skipped if he is already in the base file.
  try {
    const { findPersonByEmail } = require('../config/departmentStructure');
    const inBase = findPersonByEmail(NEW_USER.email);
    if (inBase && !inBase.dynamic) {
      console.log('Already listed in config/departmentStructure.js, no runtime structure entry needed.');
    } else {
      await StructureEntry.findOneAndUpdate(
        { email: NEW_USER.email },
        {
          email: NEW_USER.email, name: NEW_USER.fullName, department: NEW_USER.department, position: NEW_USER.position,
          reportsTo: NEW_USER.supervisorEmail, hierarchyLevel: 1, canSupervise: [], approvalAuthority: 'staff',
          isDepartmentHead: false, source: 'runtime', user: user._id
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      console.log(`Registered in the approval structure (reports to ${NEW_USER.supervisorEmail}).`);
      console.log('A running server picks this up within 5 minutes, or immediately after a restart.');
    }
  } catch (e) {
    console.error(`Account created, but the approval structure entry failed: ${e.message}`);
    console.error('Add him from the IT console: Org Structure.');
  }

  if (SEND_EMAIL) {
    try {
      const { sendEmail } = require('../services/emailService');
      await sendEmail({
        to: NEW_USER.email,
        subject: 'Your GRATO ERP account has been created',
        text: `Hello ${NEW_USER.fullName},\n\nAn account has been created for you on the GRATO ERP.\n\nEmail: ${NEW_USER.email}\nTemporary password: ${password}\nLogin: ${process.env.FRONTEND_URL || ''}/login\n\nPlease log in and change your password immediately.`
      });
      console.log(`Login details emailed to ${NEW_USER.email}`);
    } catch (e) {
      console.error(`Could not send the email: ${e.message}. Share the password below securely instead.`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('TEMPORARY PASSWORD (shown once, share securely):');
  console.log(`   ${password}`);
  console.log('='.repeat(60));
  console.log('He should log in and change it straight away.');

  await mongoose.disconnect();
}

main().catch((err) => { console.error('Script failed:', err); process.exit(1); });
