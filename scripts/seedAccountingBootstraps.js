require('dotenv').config();

const BASE_URL = (
  process.env.ACCOUNTING_SEED_BASE_URL ||
  process.env.API_BASE_URL ||
  'http://localhost:5000'
).replace(/\/$/, '');

const AUTH_TOKEN =
  process.env.ACCOUNTING_SEED_TOKEN ||
  process.env.SEED_AUTH_TOKEN ||
  process.env.API_TOKEN ||
  '';

const TARGET_ENDPOINTS = {
  accounts: '/api/accounting/accounts',
  rules: '/api/accounting/rules',
  bootstrapChart: '/api/accounting/bootstrap/default-chart',
  bootstrapRules: '/api/accounting/bootstrap/default-rules'
};

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run')
  };
}

function toIdSet(items = []) {
  return new Set(items.map((item) => String(item._id)));
}

function getNewItems(before = [], after = []) {
  const beforeIds = toIdSet(before);
  return after.filter((item) => !beforeIds.has(String(item._id)));
}

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {})
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return payload;
}

async function fetchAccountsAndRules() {
  const [accountsRes, rulesRes] = await Promise.all([
    apiRequest(TARGET_ENDPOINTS.accounts),
    apiRequest(TARGET_ENDPOINTS.rules)
  ]);

  return {
    accounts: accountsRes?.data || [],
    rules: rulesRes?.data || []
  };
}

function printAccountRows(accounts = []) {
  if (!accounts.length) {
    console.log('- None created in this run');
    return;
  }

  accounts.forEach((account) => {
    console.log(`- ${account._id} | ${account.code} | ${account.name}`);
  });
}

function printRuleRows(rules = []) {
  if (!rules.length) {
    console.log('- None created in this run');
    return;
  }

  rules.forEach((rule) => {
    console.log(`- ${rule._id} | ${rule.documentType} | ${rule.name}`);
  });
}

async function run() {
  const { dryRun } = parseArgs();
  console.log('=== ACCOUNTING BOOTSTRAP SEED ===');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'WRITE'}`);

  if (!AUTH_TOKEN) {
    console.log('⚠️ No auth token found. Set ACCOUNTING_SEED_TOKEN in .env to call protected endpoints.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n=== DRY RUN: AUTH/ACCESS CHECK ===');
    console.log('The following endpoints would be called:');
    console.log(`- GET  ${TARGET_ENDPOINTS.accounts}`);
    console.log(`- GET  ${TARGET_ENDPOINTS.rules}`);
    console.log(`- POST ${TARGET_ENDPOINTS.bootstrapChart}`);
    console.log(`- POST ${TARGET_ENDPOINTS.bootstrapRules}`);

    await Promise.all([
      apiRequest(TARGET_ENDPOINTS.accounts),
      apiRequest(TARGET_ENDPOINTS.rules)
    ]);

    console.log('✅ Auth/access check passed for read endpoints.');
    console.log('✅ Dry run complete. No bootstrap mutations were executed.');
    return;
  }

  console.log('1) Snapshotting current accounts and rules...');
  const before = await fetchAccountsAndRules();

  console.log('2) Calling bootstrap endpoints...');
  const [chartRes, rulesRes] = await Promise.all([
    apiRequest(TARGET_ENDPOINTS.bootstrapChart, { method: 'POST' }),
    apiRequest(TARGET_ENDPOINTS.bootstrapRules, { method: 'POST' })
  ]);

  console.log('3) Snapshotting accounts and rules after bootstrap...');
  const after = await fetchAccountsAndRules();

  const createdAccounts = getNewItems(before.accounts, after.accounts);
  const createdRules = getNewItems(before.rules, after.rules);

  console.log('\n=== BOOTSTRAP RESPONSES ===');
  console.log(`Chart bootstrap: created=${chartRes?.created ?? 0} | message=${chartRes?.message || ''}`);
  console.log(`Rule bootstrap : created=${rulesRes?.created ?? 0} | message=${rulesRes?.message || ''}`);

  console.log('\n=== CREATED ACCOUNT IDS ===');
  printAccountRows(createdAccounts);

  console.log('\n=== CREATED RULE IDS ===');
  printRuleRows(createdRules);

  console.log('\n✅ Seed run complete');
}

run().catch((error) => {
  console.error('❌ Seed script failed:', error.message);
  process.exit(1);
});
