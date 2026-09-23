const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const PASSWORD_LENGTH = 8;

function generatePassword() {
  // Generates a strong password with upper, lower, and number, max 8 chars
  return crypto.randomBytes(PASSWORD_LENGTH)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, PASSWORD_LENGTH);
}

async function resetPasswords() {
  await mongoose.connect(MONGODB_URI);
  const users = await User.find();
  const updates = [];

  for (const user of users) {
    const newPassword = generatePassword();
    user.password = newPassword; // Let pre-save hook hash it
    updates.push({ email: user.email, password: newPassword });
    await user.save();
  }

  console.log('EMAIL,PASSWORD');
  for (const u of updates) {
    console.log(`${u.email},${u.password}`);
  }
  await mongoose.disconnect();
}

resetPasswords().catch(console.error);
