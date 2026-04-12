require('dotenv').config();
const mongoose = require('mongoose');
const accountingService = require('../services/accountingService');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run')
  };
}

function getCurrentAndLastMonth() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let lastYear = currentYear;
  let lastMonth = currentMonth - 1;

  if (lastMonth === 0) {
    lastMonth = 12;
    lastYear -= 1;
  }

  return {
    current: { year: currentYear, month: currentMonth },
    last: { year: lastYear, month: lastMonth }
  };
}

function formatPeriod(period) {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

async function connectDB() {
  if (!MONGO_URI) {
    throw new Error('Missing MONGO_URI/MONGODB_URI in environment');
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');
}

async function run() {
  const { dryRun } = parseArgs();
  const { current, last } = getCurrentAndLastMonth();

  console.log('=== ACCOUNTING PERIOD ROLLOVER ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'WRITE'}`);
  console.log(`Last month to close : ${formatPeriod(last)}`);
  console.log(`Current month to open: ${formatPeriod(current)}`);

  await connectDB();

  if (dryRun) {
    console.log('\nDry run: no changes saved. The script would execute:');
    console.log(`- setPeriodStatus(${last.year}, ${last.month}, 'closed')`);
    console.log(`- setPeriodStatus(${current.year}, ${current.month}, 'open')`);

    const existing = await accountingService.listPeriods({ year: current.year });
    console.log(`\nExisting periods for ${current.year}: ${existing.length}`);
    existing.forEach((period) => {
      console.log(`- ${period.year}-${String(period.month).padStart(2, '0')} | ${period.status}`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Dry run complete. Disconnected.');
    return;
  }

  const closeResult = await accountingService.setPeriodStatus({
    year: last.year,
    month: last.month,
    status: 'closed',
    userId: null,
    notes: 'Auto rollover script: close previous month'
  });

  const openResult = await accountingService.setPeriodStatus({
    year: current.year,
    month: current.month,
    status: 'open',
    userId: null,
    notes: 'Auto rollover script: open current month'
  });

  console.log('\n=== ROLLOVER RESULT ===');
  console.log(`Closed: ${formatPeriod(closeResult)} | status=${closeResult.status}`);
  console.log(`Opened: ${formatPeriod(openResult)} | status=${openResult.status}`);

  await mongoose.disconnect();
  console.log('✅ Rollover complete. Disconnected.');
}

run().catch(async (error) => {
  console.error('❌ Rollover failed:', error.message);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error('Disconnect error:', disconnectError.message);
  }
  process.exit(1);
});
