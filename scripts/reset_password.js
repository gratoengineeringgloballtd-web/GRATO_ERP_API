/**
 * reset_password.js
 *
 * Resets the password for a specific user by email.
 *
 * USAGE:
 *   node reset_password.js "pascal.rodrique@gratoglobal.com" "NewStrongPassword123!"
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcrypt');

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/generator-management';

async function main() {
  const [, , emailArg, newPasswordArg] = process.argv;

  if (!emailArg || !newPasswordArg) {
    console.error('Usage: node reset_password.js <email> <newPassword>');
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();

  if (newPasswordArg.length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    process.exit(1);
  }

  console.log(`Connecting to: ${MONGO_URI.replace(/:([^:@]+)@/, ':****@')}`);
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ MongoDB connected\n');

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(newPasswordArg, salt);

  // driver v6+ returns the doc directly; older driver wraps it in { value }
  const result = await mongoose.connection.collection('users').findOneAndUpdate(
    { email },
    {
      $set: {
        password: hashed,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  const updatedDoc = result && result.value !== undefined ? result.value : result;

  if (!updatedDoc) {
    console.error(`❌ No user found with email: ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('✅ Password updated successfully');
  console.log(`   Email: ${updatedDoc.email}`);
  console.log(`   Role:  ${updatedDoc.role}`);
  console.log(`   ID:    ${updatedDoc._id}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});