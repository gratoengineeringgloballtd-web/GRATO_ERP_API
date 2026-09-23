/**
 * createEmployeesFromSpreadsheet.js
 *
 * WHY THIS EXISTS
 * ----------------
 * Generalizes createChinyereUser.js to create several accounts at once, for the 8
 * employees listed in LIST_OF_EMPLOYEES_WITHOUT_NAME_IN_THE_SYSTEM.xlsx who don't yet
 * have a User account in the system.
 *
 * DATA QUALITY NOTES - PLEASE READ BEFORE RUNNING
 * --------------------------------------------------
 * The source spreadsheet has some real ambiguity that required judgment calls. Please
 * review the EMPLOYEES array below and correct anything that doesn't match reality:
 *
 *  1. TWO employees had no email at all in the spreadsheet (Che Neba Ernest, Akum John
 *     Ngwo). A company email was generated for them the same way as everyone else -
 *     there was no way to avoid this, but double-check these two specifically.
 *
 *  2. Every employee's SYSTEM LOGIN email was generated as firstname.lastname@
 *     gratoglobal.com, following the same convention already used company-wide (e.g.
 *     marcel.ngong@, flora.kidzeven@, bruiline.tsitoh@) - NOT the personal Gmail
 *     addresses from the spreadsheet, which don't follow a single consistent pattern
 *     and look like informal personal contact addresses rather than company logins.
 *     Each employee's original Gmail (where one was given) is preserved in the new
 *     personalEmail field, so it's not lost - just not used as their login.
 *
 *  3. The spreadsheet's NAMES/SURNAME columns don't cleanly map to "first name" /
 *     "last name" - some entries have multiple words in one column, and the personal
 *     Gmail addresses (where present) don't consistently favor one column over the
 *     other. Rather than guess wrong, fullName preserves both columns in the order
 *     given (NAMES then SURNAME), and the generated login email uses the first word of
 *     each column. If a name reads oddly, it's worth a quick manual fix either in this
 *     file before running, or on the account afterward.
 *
 *  4. "HR Coordinator" (Nih Belther Azwe's listed supervisor) has no exact match in
 *     config/departmentStructure.js - the closest real position is Bruiline Tsitoh, HR
 *     & Admin Head, used here as the best available match. Correct this if there's a
 *     more appropriate person.
 *
 *  5. Every other supervisor name matched a real, existing account exactly:
 *     CEO -> Tom, VERLA Ivo -> Verla Ivo (Head of Refurbishment), BECHEM Ovoh -> Ovo
 *     Bechem (HSE Coordinator), FLORA Kidzeven -> Flora Kidzeven (Fleet Coordinator).
 *     Each new employee's department was set to match their supervisor's own
 *     department, following the same pattern used when Chinyere was added under Marcel.
 *
 * WHAT IT DOES
 * ------------
 * For each employee below: looks up their supervisor's real account, skips anyone who
 * already has an account (never overwrites an existing one), otherwise creates the
 * account with a random temporary password, and adds them to their supervisor's
 * directReports. Prints every generated password once at the end - not logged
 * anywhere else, not stored in this script.
 *
 * Safe to re-run: already-created employees are skipped, not touched again.
 *
 * Usage:
 *   node scripts/createEmployeesFromSpreadsheet.js
 *   node scripts/createEmployeesFromSpreadsheet.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');

const DRY_RUN = process.argv.includes('--dry-run');

const EMPLOYEES = [
  {
    fullName: 'Che Neba Ernest',
    email: 'che.ernest@gratoglobal.com',
    personalEmail: null, // no email given in the spreadsheet
    position: 'Logistic Assistant',
    department: 'CEO Office',
    supervisorEmail: 'tom@gratoengineering.com'
  },
  {
    fullName: 'Nih Belther Azwe',
    email: 'nih.belther@gratoglobal.com',
    personalEmail: 'nihbelther7@gmail.com',
    position: 'House Maid',
    department: 'HR & Admin',
    supervisorEmail: 'bruiline.tsitoh@gratoglobal.com' // best match for "HR Coordinator" - see note 4 above
  },
  {
    fullName: 'Rasaki Abdoul Sakarlyah',
    email: 'rasaki.sakarlyah@gratoglobal.com',
    personalEmail: 'rasakiabduol@gmail.com',
    position: 'Welder',
    department: 'Technical',
    supervisorEmail: 'verla.ivo@gratoengineering.com'
  },
  {
    fullName: 'Ndessop Kouo Boris',
    email: 'ndessop.boris@gratoglobal.com',
    personalEmail: 'ndessopboris91@gmail.com',
    position: 'Driver',
    department: 'Technical',
    supervisorEmail: 'bechem.mbu@gratoglobal.com'
  },
  {
    fullName: 'Bongkiyung Bello Armand',
    email: 'bongkiyung.bello@gratoglobal.com',
    personalEmail: 'bongkiyungbelloarmand@gmail.com',
    position: 'Driver',
    department: 'Business Development & Supply Chain',
    supervisorEmail: 'flora.kidzeven@gratoglobal.com'
  },
  {
    fullName: 'Akum John Ngwo',
    email: 'akum.john@gratoglobal.com',
    personalEmail: null, // no email given in the spreadsheet
    position: 'Machine Operator / Driver',
    department: 'Technical',
    supervisorEmail: 'verla.ivo@gratoengineering.com'
  },
  {
    fullName: 'Anuh Gabila Johnas',
    email: 'anuh.gabila@gratoglobal.com',
    personalEmail: 'gabila@gmail.com',
    position: 'Driver',
    department: 'Business Development & Supply Chain',
    supervisorEmail: 'flora.kidzeven@gratoglobal.com'
  },
  {
    fullName: 'Ngandjeu Nouke Cedric',
    email: 'ngandjeu.cedric@gratoglobal.com',
    personalEmail: 'ngandjeucedric@gmail.com',
    position: 'Driver',
    department: 'Business Development & Supply Chain',
    supervisorEmail: 'flora.kidzeven@gratoglobal.com'
  }
];

function generateTempPassword() {
  // Readable-ish random password: 12 hex chars, easy to type over the phone/chat once.
  return crypto.randomBytes(6).toString('hex');
}

async function createOneEmployee(emp) {
  const existing = await User.findOne({ email: new RegExp(`^${emp.email}$`, 'i') });
  if (existing) {
    console.log(`ℹ️  ${emp.fullName}: account already exists (${emp.email}) - skipping, not modified.`);
    return { created: false };
  }

  const supervisor = await User.findOne({ email: new RegExp(`^${emp.supervisorEmail}$`, 'i') });
  if (!supervisor) {
    console.error(`❌ ${emp.fullName}: could not find supervisor account for ${emp.supervisorEmail} - skipping this employee.`);
    return { created: false, error: true };
  }

  const tempPassword = generateTempPassword();

  console.log(`${DRY_RUN ? '[dry-run] would create' : 'Creating'}: ${emp.fullName}`);
  console.log(`   Email      : ${emp.email}`);
  console.log(`   Personal   : ${emp.personalEmail || '(none given)'}`);
  console.log(`   Position   : ${emp.position}`);
  console.log(`   Department : ${emp.department}`);
  console.log(`   Supervisor : ${supervisor.fullName} (${supervisor.email})`);

  if (DRY_RUN) {
    return { created: true, dryRun: true };
  }

  const user = new User({
    email: emp.email,
    personalEmail: emp.personalEmail || undefined,
    fullName: emp.fullName,
    password: tempPassword, // hashed automatically by the User schema's pre('save') hook
    role: 'employee',
    department: emp.department,
    position: emp.position,
    supervisor: supervisor._id,
    isActive: true
  });

  await user.save();
  console.log(`   ✅ Created: ${user._id}`);

  if (!supervisor.directReports?.some(id => id.toString() === user._id.toString())) {
    supervisor.directReports = [...(supervisor.directReports || []), user._id];
    await supervisor.save();
  }

  return { created: true, email: emp.email, password: tempPassword };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN — no writes will be made)' : ''}\n`);

  const created = [];
  let skipped = 0;
  let errors = 0;

  for (const emp of EMPLOYEES) {
    console.log('-'.repeat(60));
    const result = await createOneEmployee(emp);
    if (result.error) errors++;
    else if (!result.created) skipped++;
    else if (!result.dryRun) created.push({ email: result.email, password: result.password });
  }

  console.log('\n' + '='.repeat(60));
  console.log(`${DRY_RUN ? 'Dry run complete' : 'Done'}: ${created.length || (DRY_RUN ? EMPLOYEES.length - skipped - errors : 0)} created, ${skipped} already existed, ${errors} error(s).`);

  if (created.length > 0) {
    console.log('\nTEMPORARY PASSWORDS (share these securely - not logged anywhere else):');
    created.forEach(c => console.log(`   ${c.email}  ->  ${c.password}`));
    console.log('\nEveryone should log in and change their password as soon as possible.');
  }

  if (DRY_RUN) console.log('\nRe-run without --dry-run to apply.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
