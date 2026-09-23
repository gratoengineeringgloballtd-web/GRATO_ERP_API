// script/resetPasswords.js
// Run with: node script/resetPasswords.js

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}✗ ${msg}${colors.reset}`)
};

// Map of email -> new plaintext password
// The User model's pre-save hook hashes this automatically
const passwordUpdates = [
  { email: 'minka.kevin@gratoglobal.com', password: 'K7v#mQ2pL' },
  { email: 'rodrigue.nono@gratoglobal.com', password: 'Bz8$wF5jH' }
];

const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
  await mongoose.connect(mongoURI);
  log.success('Connected to MongoDB');
};

const updatePassword = async (email, plainPassword) => {
  try {
    const user = await User.findOne({ email });
    if (!user) {
      log.warning(`User ${email} not found - skipping`);
      return false;
    }
    user.password = plainPassword; 
    await user.save();
    log.success(`Password updated for ${email}`);
    return true;
  } catch (error) {
    log.error(`Failed to update ${email}: ${error.message}`);
    return false;
  }
};

const run = async () => {
  try {
    await connectDB();

    log.info('Starting password resets...\n');

    for (const { email, password } of passwordUpdates) {
      await updatePassword(email, password);
    }

    console.log('\n');
    log.success('Password reset complete.');
    log.warning('Share these credentials securely and ask users to change them on first login.');
  } catch (error) {
    log.error('Script failed: ' + error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    log.info('Database connection closed');
  }
};

run();




// ```javascript
// const passwordUpdates = [
//   { email: 'minka.kevin@gratoglobal.com', password: 'K7v#mQ2pL' },
//   { email: 'rodrigue.nono@gratoglobal.com', password: 'Bz8$wF5jH' }
// ];

// ```
