/*
  Script: generate_supplier_passwords.js
  - Reads scripts/supplier_plain_passwords.json
  - Produces scripts/supplier_new_passwords_with_hashes.json with bcrypt hashes
  Usage:
    1. Install dependency: npm install bcryptjs
    2. Run: node scripts/generate_supplier_passwords.js
  Output: scripts/supplier_new_passwords_with_hashes.json and console summary with mongo update commands
*/

const fs = require('fs');
const path = require('path');
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (err) {
  console.error('Missing dependency: bcryptjs. Install with: npm install bcryptjs');
  process.exit(1);
}

const INPUT = path.join(__dirname, 'supplier_plain_passwords.json');
const OUTPUT = path.join(__dirname, 'supplier_new_passwords_with_hashes.json');

if (!fs.existsSync(INPUT)) {
  console.error('Input file not found:', INPUT);
  process.exit(1);
}

const suppliers = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const saltRounds = 12;

(async () => {
  const out = [];
  for (const s of suppliers) {
    const hash = await bcrypt.hash(s.newPassword, saltRounds);
    out.push({ _id: s._id, email: s.email, passwordPlain: s.newPassword, passwordHash: hash });
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote:', OUTPUT);
  console.log('\nSummary:');
  for (const o of out) {
    console.log(o.email, '->', o.passwordPlain);
  }

  console.log('\nMongoDB update commands (examples):');
  console.log("use your_database_name;");
  for (const o of out) {
    console.log(
      `db.users.updateOne({ email: '${o.email}' }, { $set: { password: '${o.passwordHash}' } });`
    );
  }
  console.log('\nMake sure to backup your DB before applying updates.');
})();
