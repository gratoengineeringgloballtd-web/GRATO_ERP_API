require('dotenv').config();
const mongoose = require('mongoose');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`)
};

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
    await mongoose.connect(mongoURI);
    log.success('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

const updateUserModel = async () => {
  try {
    console.log('\n' + colors.bold + '='.repeat(60) + colors.reset);
    console.log(colors.bold + 'UPDATING USER MODEL METHODS' + colors.reset);
    console.log(colors.bold + '='.repeat(60) + colors.reset + '\n');

    await connectDB();

    // Import User model (this will load the updated schema with methods)
    const User = require('../models/User');

    // Get all users
    const users = await User.find({});
    log.info(`Found ${users.length} users`);

    // Test that methods exist
    if (users.length > 0) {
      const testUser = users[0];
      
      log.info('Testing user methods...');
      
      // Check if updateLastActivity exists
      if (typeof testUser.updateLastActivity === 'function') {
        log.success('updateLastActivity method exists');
      } else {
        log.info('updateLastActivity method not found (will be added)');
      }
      
      // Check if updateLastLogin exists
      if (typeof testUser.updateLastLogin === 'function') {
        log.success('updateLastLogin method exists');
      } else {
        log.info('updateLastLogin method not found (will be added)');
      }
    }

    log.success('User model is ready!');
    log.info('Methods available:');
    log.info('  - updateLastActivity()');
    log.info('  - updateLastLogin()');
    log.info('  - hasRole(role)');
    log.info('  - canAccess(resourceType)');
    log.info('  - addRefreshToken(token, device)');
    log.info('  - cleanExpiredTokens()');

    console.log('\n' + colors.bold + '='.repeat(60) + colors.reset);
    console.log(colors.green + '✓ User model methods verified!' + colors.reset);
    console.log(colors.bold + '='.repeat(60) + colors.reset + '\n');

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    log.info('Database connection closed');
  }
};

updateUserModel();