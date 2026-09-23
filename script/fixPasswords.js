const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Script to fix users with unhashed passwords
 */
async function fixUnhashedPasswords() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB');

    // Find all users
    const users = await User.find({});
    logger.info(`Found ${users.length} users to check`);

    let fixed = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        // Check if password is already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
        const isHashed = /^\$2[ayb]\$/.test(user.password);

        if (!isHashed) {
          logger.info(`Fixing unhashed password for: ${user.email}`);

          // Determine default password based on role
          let newPassword = 'Default@123';
          if (user.role === 'supervisor') {
            newPassword = 'Supervisor@123';
          } else if (user.role === 'technician') {
            newPassword = 'Tech@123';
          } else if (user.role === 'admin') {
            newPassword = 'Admin@123';
          }

          // Hash the password
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(newPassword, salt);

          // Update user directly with MongoDB update to bypass hooks
          await User.updateOne(
            { _id: user._id },
            { $set: { password: hashedPassword } }
          );

          fixed++;
          logger.info(`  ✓ Fixed: ${user.email} (${user.role})`);
        } else {
          skipped++;
        }
      } catch (error) {
        logger.error(`  ✗ Error fixing user ${user.email}:`, error.message);
      }
    }

    logger.info('='.repeat(60));
    logger.info('Password Fix Summary:');
    logger.info(`  Total Users: ${users.length}`);
    logger.info(`  Fixed: ${fixed}`);
    logger.info(`  Already Hashed: ${skipped}`);
    logger.info('='.repeat(60));

    if (fixed > 0) {
      logger.info('\nDefault Passwords Set:');
      logger.info('  Admin: Admin@123');
      logger.info('  Supervisor: Supervisor@123');
      logger.info('  Technician: Tech@123');
    }

  } catch (error) {
    logger.error('Error fixing passwords:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info('Database connection closed');
  }
}

// Run the script
if (require.main === module) {
  fixUnhashedPasswords()
    .then(() => {
      logger.info('Password fix completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Password fix failed:', error);
      process.exit(1);
    });
}

module.exports = fixUnhashedPasswords;