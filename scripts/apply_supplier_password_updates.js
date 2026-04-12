/*
  apply_supplier_password_updates.js
  - Reads scripts/supplier_new_passwords_with_hashes.json
  - Connects to MongoDB using MONGO_URI from .env
  - Updates users by email setting the hashed password value

  USAGE (dry-run):
    node scripts/apply_supplier_password_updates.js --dry

  USAGE (apply):
    node scripts/apply_supplier_password_updates.js

  Notes:
  - Make a DB backup before applying.
  - This script updates by `email` in the `users` collection.
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const INPUT = path.join(__dirname, 'supplier_new_passwords_with_hashes.json');
if (!fs.existsSync(INPUT)) {
  console.error('Input file not found:', INPUT);
  process.exit(1);
}

const updates = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const MONGO = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
if (!MONGO) {
  console.error('No Mongo connection string found in .env (MONGO_URI or MONGODB_URI)');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry');

(async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected');

    const User = require('../models/User');

    for (const u of updates) {
      const { email, passwordHash } = u;
      const user = await User.findOne({ email });
      if (!user) {
        console.warn('User not found:', email);
        continue;
      }

      console.log('Found user:', email, 'currentPasswordHashPrefix=', (user.password || '').slice(0,10));

      if (dryRun) {
        console.log('[dry] Would update', email, '->', passwordHash.slice(0,20), '...');
        continue;
      }

      user.password = passwordHash; // set already-hashed password
      // Avoid triggering pre-save hash - we set __v flag to skip re-hash: use direct update instead
      await User.updateOne({ email }, { $set: { password: passwordHash } });
      console.log('Updated password for', email);
    }

    console.log('Done');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error applying updates:', err);
    process.exit(1);
  }
})();
