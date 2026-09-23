/**
 * seed_fuel_chain_users.js
 *
 * Creates the 3 fuel approval chain user accounts that don't exist yet:
 *   - Ranibell Mambo   (finance)
 *   - Kelvin E.T       (head_of_business)
 *   - Tom              (ceo)
 *
 * USAGE:
 *   node seed_fuel_chain_users.js
 *
 * Run from inside PowerGen_API/ so the User model path resolves correctly,
 * or set MONGO_URI as an env var:
 *   MONGO_URI=mongodb+srv://... node seed_fuel_chain_users.js
 *
 * The script is idempotent — re-running it will update existing accounts
 * rather than creating duplicates.
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcrypt');

// ── Connection ────────────────────────────────────────────────────────────────
const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/generator-management';

// ── Step 1: Patch the User schema enum to include new roles ───────────────────
// We inline a minimal schema here so the script works without modifying
// your existing User.js. The pre-save hook will hash passwords automatically.
const userSchema = new mongoose.Schema(
  {
    fullName:  { type: String, required: true, trim: true },
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:  { type: String, required: true },
    role: {
      type: String,
      // Full enum including the 3 new roles
      enum: [
        'admin', 'supervisor', 'technician', 'ac',
        'diesel_manager', 'data_collector', 'analyst',
        'operations', 'fuel',
        'finance',           // ← NEW
        'head_of_business',  // ← NEW
        'ceo',               // ← NEW
      ],
      required: true,
    },
    phone:      { type: String, required: true },
    isActive:   { type: Boolean, default: true },
    department: { type: String },
    employee_id:{ type: String },
    date_joined:{ type: Date, default: Date.now },
    refresh_tokens: [{ token: String, created_at: Date, expires_at: Date, device: String }],
  },
  { timestamps: true }
);

// Same password-hashing hook as your production User model
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const isAlreadyHashed = /^\$2[ayb]\$/.test(this.password);
  if (isAlreadyHashed) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Use the SAME model name 'User' so we touch the same collection
let User;
try {
  User = mongoose.model('User');
} catch {
  User = mongoose.model('User', userSchema);
}

// ── Step 2: Define accounts ───────────────────────────────────────────────────
//
// IMPORTANT: these emails MUST match exactly what is in
// config/fuelRequestApprovalChain.js — the approval chain
// uses email matching to identify which user's turn it is.
//
const ACCOUNTS = [
  {
    fullName:    'Ranibell Mambo',
    email:       'ranibellmambo@gratoengineering.com',
    password:    'Finance@Grato2026!',        // change after first login
    role:        'finance',
    phone:       '+237600000004',
    department:  'Finance',
    employee_id: 'GRATO-FIN-001',
  },
  {
    fullName:    'Kelvin E.T',
    email:       'kelvin.eyong@gratoglobal.com',
    password:    'HOB@Grato2026!',            // change after first login
    role:        'head_of_business',
    phone:       '+237600000005',
    department:  'Executive Management',
    employee_id: 'GRATO-HOB-001',
  },
  {
    fullName:    'Tom',
    email:       'tom@gratoengineering.com',
    password:    'CEO@Grato2026!',            // change after first login
    role:        'ceo',
    phone:       '+237600000006',
    department:  'Executive',
    employee_id: 'GRATO-CEO-001',
  },
];

// ── Step 3: Also patch the existing User model's enum in the live collection ──
// If you haven't updated User.js yet, this migration adds the new roles to
// the validator so MongoDB won't reject saves for those role values.
async function patchExistingUserModelEnum() {
  try {
    // This works only if User model is already registered (i.e., already imported elsewhere)
    const existingModel = mongoose.models.User;
    if (existingModel && existingModel.schema.path('role')) {
      const roleEnumValues = existingModel.schema.path('role').enumValues;
      const newRoles = ['finance', 'head_of_business', 'ceo'];
      newRoles.forEach(r => {
        if (!roleEnumValues.includes(r)) {
          roleEnumValues.push(r);
        }
      });
    }
  } catch (e) {
    // Silently ignore — the seeder's own schema handles it
  }
}

// ── Step 4: Upsert each account ───────────────────────────────────────────────
async function upsertUser(data) {
  const existing = await User.findOne({ email: data.email });

  if (existing) {
    // Update role and details but preserve password if already set
    existing.fullName    = data.fullName;
    existing.role        = data.role;
    existing.phone       = data.phone;
    existing.department  = data.department;
    existing.employee_id = data.employee_id;
    existing.isActive    = true;
    await existing.save({ validateBeforeSave: false });
    return { action: 'updated', user: existing };
  }

  const user = new User(data);
  await user.save();
  return { action: 'created', user };
}

// ── Step 5: Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  GRATO Fuel Chain — User Account Seeder');
  console.log('═══════════════════════════════════════════════════\n');

  console.log(`Connecting to: ${MONGO_URI.replace(/:([^:@]+)@/, ':****@')}`);
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  console.log('✅ MongoDB connected\n');

  await patchExistingUserModelEnum();

  const results = [];

  for (const account of ACCOUNTS) {
    try {
      const { action, user } = await upsertUser(account);
      results.push({ email: account.email, role: account.role, action, id: user._id });

      const icon = action === 'created' ? '🆕' : '🔄';
      console.log(`${icon} ${action.toUpperCase()}: ${account.fullName}`);
      console.log(`   Email:    ${account.email}`);
      console.log(`   Role:     ${account.role}`);
      console.log(`   Password: ${account.password}  ← change after first login`);
      console.log(`   ID:       ${user._id}\n`);
    } catch (err) {
      console.error(`❌ FAILED: ${account.email}`);
      console.error(`   ${err.message}\n`);

      // If it failed due to role enum validation on the existing model,
      // try a raw update to bypass mongoose validation
      if (err.message?.includes('enum') || err.message?.includes('role')) {
        console.log('   ↳ Attempting raw update to bypass enum validation...');
        try {
          const salt   = await bcrypt.genSalt(10);
          const hashed = await bcrypt.hash(account.password, salt);
          await mongoose.connection.collection('users').findOneAndUpdate(
            { email: account.email },
            {
              $set: {
                fullName:    account.fullName,
                email:       account.email,
                password:    hashed,
                role:        account.role,
                phone:       account.phone,
                department:  account.department,
                employee_id: account.employee_id,
                isActive:    true,
                updatedAt:   new Date(),
              },
              $setOnInsert: {
                date_joined:     new Date(),
                createdAt:       new Date(),
                refresh_tokens:  [],
                login_count:     0,
              },
            },
            { upsert: true, returnDocument: 'after' }
          );
          console.log(`   ✅ Raw upsert succeeded for ${account.email}\n`);
          results.push({ email: account.email, role: account.role, action: 'raw_upsert' });
        } catch (rawErr) {
          console.error(`   ❌ Raw upsert also failed: ${rawErr.message}\n`);
        }
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════');
  results.forEach(r => {
    console.log(`  ${r.email.padEnd(42)} ${r.role.padEnd(20)} ${r.action}`);
  });

  console.log(`\n✅ Done — ${results.length}/${ACCOUNTS.length} accounts processed`);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  NEXT STEPS');
  console.log('═══════════════════════════════════════════════════');
  console.log(`
  1. Update User.js model — add new roles to the enum:
     role: {
       type: String,
       enum: [
         'admin', 'supervisor', 'technician', 'ac',
         'diesel_manager', 'data_collector', 'analyst',
         'operations', 'fuel',
         'finance',           // ← add
         'head_of_business',  // ← add
         'ceo',               // ← add
       ],
     }

  2. Update common.types.ts — add new roles to User type:
     role: '...' | 'finance' | 'head_of_business' | 'ceo';

  3. Add routes in App.tsx — see DASHBOARD_WIRING.ts

  4. Copy dashboard pages:
     src/pages/finance/FinanceDashboard.tsx
     src/pages/hob/HOBDashboard.tsx
     src/pages/ceo/CEODashboard.tsx

  5. Tell each user to change their password on first login.

  Approval chain email matching:
    L4 Finance:   ranibellmambo@gratoengineering.com
    L5 HOB:       kelvin.eyong@gratoglobal.com
    L6 CEO:       tom@gratoengineering.com  (only for ≥ 100 L)
  `);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
