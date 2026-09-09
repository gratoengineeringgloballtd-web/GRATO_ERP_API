require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const BudgetCode = require('../models/BudgetCode');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('Connected to:', mongoose.connection.db.databaseName, '\n');

  const bruiline = await User.findOne({ email: /bruiline/i });
  if (!bruiline) {
    console.log('❌ No user found matching "bruiline" - check the email');
  } else {
    console.log('Bruiline\'s account:');
    console.log('  fullName  :', bruiline.fullName);
    console.log('  email     :', bruiline.email);
    console.log('  department:', JSON.stringify(bruiline.department));
    console.log('  role      :', bruiline.role);
  }

  console.log('\nAll active BudgetCode documents with a department containing "HR":');
  const hrCodes = await BudgetCode.find({ department: /hr/i, active: true }).select('code name department');
  if (hrCodes.length === 0) {
    console.log('  None found at all - no HR budget codes exist yet in this database.');
  } else {
    hrCodes.forEach(c => console.log(`  - ${c.code} (${c.name}) -> department: ${JSON.stringify(c.department)}`));
  }

  console.log('\nEvery distinct department value across ALL active budget codes:');
  const distinctDepts = await BudgetCode.distinct('department', { active: true });
  console.log(' ', distinctDepts.join(', ') || '(none)');

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
