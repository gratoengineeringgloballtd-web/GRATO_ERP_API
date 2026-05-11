require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

/**
 * Update a user's email address
 */
async function updateUserEmail(oldEmail, newEmail) {
  try {
    console.log('📧 UPDATE USER EMAIL');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    console.log(`🔍 Looking up user with email: ${oldEmail}\n`);

    // Find user by old email
    const user = await User.findOne({ email: new RegExp(`^${oldEmail}$`, 'i') });

    if (!user) {
      console.error(`❌ No user found with email: ${oldEmail}`);
      process.exit(1);
    }

    console.log(`✅ Found user:`);
    console.log(`   Full Name : ${user.fullName}`);
    console.log(`   Old Email : ${user.email}`);
    console.log(`   Position  : ${user.position}`);

    // Check if new email is already taken by another user
    const existingUser = await User.findOne({
      email: new RegExp(`^${newEmail}$`, 'i'),
      _id: { $ne: user._id }
    });

    if (existingUser) {
      console.error(`\n❌ Email "${newEmail}" is already in use by: ${existingUser.fullName}`);
      process.exit(1);
    }

    // Update the email
    const oldEmailBackup = user.email;
    user.email = newEmail.toLowerCase().trim();
    await user.save();

    console.log(`\n✅ Email updated successfully!`);
    console.log('='.repeat(80));
    console.log(`   User      : ${user.fullName}`);
    console.log(`   Old Email : ${oldEmailBackup}`);
    console.log(`   New Email : ${user.email}`);
    console.log(`   Updated At: ${new Date().toISOString()}`);
    console.log('='.repeat(80) + '\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Email update failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run from CLI
// Usage: node updateUserEmail.js <oldEmail> <newEmail>
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('❌ Usage: node updateUserEmail.js <oldEmail> <newEmail>');
    console.error('   Example: node updateUserEmail.js tom@gratoengineering.com gratoengineeringgloballtd@gmail.com');
    process.exit(1);
  }

  updateUserEmail(args[0], args[1]);
}

module.exports = { updateUserEmail };