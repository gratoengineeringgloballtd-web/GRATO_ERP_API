/**
 * add-employee-ngouning.js
 *
 * Creates a new employee, mirroring exactly what controllers/hrController.js's
 * createEmployee does (same fields, same temp-password + welcome-email flow,
 * same employmentStatus default) — just run directly against the DB instead
 * of through the API. No token needed, same pattern as the other scripts.
 *
 * Run FROM YOUR BACKEND ROOT (same folder as package.json / .env):
 *
 *   node scripts/add-employee-ngouning.js
 *
 * It will:
 *   1. Look up Bruiline Tsitoh to use as supervisor (and to default the
 *      department to hers, since none was specified for the new employee).
 *   2. Create the employee with a random temp password.
 *   3. Try to email the login credentials (same as the HR "Add Employee"
 *      screen does) — if email sending isn't configured/working, this is
 *      only logged as a warning, the employee is still created.
 */

const NEW_EMPLOYEE = {
  fullName: 'Ngouning Zoning Vanel',
  email: 'ngouningv@gmail.com',
  position: 'Office Janitor',
  supervisorName: 'Bruiline Tsitoh'
  // department left unset below — defaults to the supervisor's department
};

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');

const envCandidates = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env')
];
const envPath = envCandidates.find(p => fs.existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

const mongoose = require('mongoose');

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not found. Run this from your backend root (same folder as your .env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const User = require('../models/User');

  const existing = await User.findOne({ email: NEW_EMPLOYEE.email });
  if (existing) {
    console.error(`❌ "${NEW_EMPLOYEE.email}" is already registered to ${existing.fullName} (${existing._id}). Nothing created.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const supervisor = await User.findOne({ fullName: { $regex: NEW_EMPLOYEE.supervisorName, $options: 'i' } });
  if (!supervisor) {
    console.error(`❌ No employee found matching supervisor name "${NEW_EMPLOYEE.supervisorName}". Aborting — fix the name and re-run.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Supervisor: ${supervisor.fullName} (${supervisor._id}) — department: ${supervisor.department || '(none on file)'}`);

  const tempPassword = crypto.randomBytes(8).toString('hex');

  const employee = await User.create({
    fullName: NEW_EMPLOYEE.fullName,
    email: NEW_EMPLOYEE.email,
    password: tempPassword,
    department: supervisor.department,
    position: NEW_EMPLOYEE.position,
    role: 'employee',
    departmentRole: 'staff',
    supervisor: supervisor._id,
    employmentDetails: {
      employmentStatus: 'Probation'
    },
    isActive: true
  });

  console.log(`\n✅ Employee created: ${employee.fullName} (${employee._id})`);
  console.log(`   Email: ${employee.email}`);
  console.log(`   Department: ${employee.department}`);
  console.log(`   Position: ${employee.position}`);
  console.log(`   Supervisor: ${supervisor.fullName}`);
  console.log(`   Temp password: ${tempPassword}`);

  try {
    const sendEmail = require('./utils/sendEmail');
    await sendEmail({
      to: NEW_EMPLOYEE.email,
      subject: 'Welcome to the Company - Account Created',
      html: `
        <h2>Welcome ${NEW_EMPLOYEE.fullName}!</h2>
        <p>Your employee account has been created by HR.</p>
        <h3>Login Credentials:</h3>
        <p><strong>Email:</strong> ${NEW_EMPLOYEE.email}</p>
        <p><strong>Temporary Password:</strong> ${tempPassword}</p>
        <p><strong>Login URL:</strong> ${process.env.FRONTEND_URL}/login</p>
        <p style="color: red;"><strong>Important:</strong> Please change your password immediately after first login.</p>
        <hr>
        <p>If you have any questions, please contact HR department.</p>
      `
    });
    console.log('✅ Welcome email sent.');
  } catch (emailError) {
    console.warn(`⚠️  Welcome email failed to send (${emailError.message}). The employee record was still created — share the temp password above manually.`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
