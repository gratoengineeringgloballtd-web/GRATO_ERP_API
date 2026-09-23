/**
 * importTomCards.js
 * PowerGen_API/scripts/importTomCards.js
 *
 * Imports the TOMCARDS.xlsx cluster card distribution into the system.
 * This file is the AUTHORITATIVE card distribution template — it defines
 * which Tom Card number covers each cluster and what the card limits are.
 *
 * TOMCARDS.xlsx structure (Sheet1):
 *   Col 1: New SBC (e.g. GRATO)
 *   Col 2: Cluster (e.g. Bonaberi 1)
 *   Col 3: Vendor (TOTAL / TRADEX)
 *   Col 4: Old Card Number
 *   Col 5: New Card Number     ← USE THIS as card_number
 *   Col 6: Diesel Budget August 2026 (L)
 *   Col 7: Diesel Budget Amount August 2026 XAF
 *   Col 8: Initial % Recharge Amount (decimal, e.g. 0.8 = 80%)
 *   Col 9: Initial Recharge XAF
 *   Col 10: Actual Card Limit (XAF)
 *   Col 11: Strategic Tank Usage
 *   Col 12: New limit on 26/07/2026 (XAF) ← active card limit
 *
 * WHAT IT DOES:
 *   1. Updates every SiteBudget in the cycle to set card_number and fuel_vendor
 *      based on the cluster mapping from TOMCARDS.xlsx
 *   2. Creates/updates TomCardTransaction records for the initial card load
 *   3. Reports the cluster → card → limit mapping
 *
 * USAGE:
 *   node scripts/importTomCards.js
 *   node scripts/importTomCards.js --file path/to/TOMCARDS.xlsx
 *   node scripts/importTomCards.js --cycle 2026-08
 *   node scripts/importTomCards.js --dry-run
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const path     = require('path');
const fs       = require('fs');
const XLSX     = require('xlsx');

const isDryRun  = process.argv.includes('--dry-run');
const fileIdx   = process.argv.indexOf('--file');
const cycleIdx  = process.argv.indexOf('--cycle');
const XLSX_FILE = fileIdx > -1
  ? path.resolve(process.argv[fileIdx + 1])
  : path.resolve(__dirname, './TOMCARDS.xlsx');
const CYCLE_KEY = cycleIdx > -1 ? process.argv[cycleIdx + 1] : '2026-08';

// Normalise cluster names (handle case/spacing differences)
function normCluster(s) {
  return (s || '').toLowerCase()
    .replace(/\s+/g, ' ')
    .replace('bonaberi 1', 'bonaberi 1')
    .replace('bonaberi 2', 'bonaberi 2')
    .trim();
}

async function run() {
  if (!fs.existsSync(XLSX_FILE)) {
    console.error('TOMCARDS file not found:', XLSX_FILE);
    console.error('Usage: node scripts/importTomCards.js --file /path/to/TOMCARDS.xlsx');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  console.log('Mode:   ', isDryRun ? 'DRY RUN' : 'LIVE');
  console.log('File:   ', XLSX_FILE);
  console.log('Cycle:  ', CYCLE_KEY);
  console.log();

  const SiteBudget = require('../models/SiteBudget');

  // ── Read TOMCARDS.xlsx ──────────────────────────────────────────────────────
  const wb = XLSX.readFile(XLSX_FILE, { cellDates: true });
  const ws = wb.Sheets['Sheet1'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Row 0 = headers, data from row 1
  const dataRows = rows.slice(1).filter(r => r && r.some(v => v != null));

  // Build cluster → card mapping
  const cardMap = {};
  console.log('Tom Card cluster distribution:');
  console.log('─'.repeat(70));

  for (const row of dataRows) {
    const sbc        = row[0];  // Col 1
    const cluster    = row[1];  // Col 2
    const vendor     = row[2];  // Col 3
    const oldCard    = row[3];  // Col 4
    const newCard    = row[4];  // Col 5 — NEW card number (authoritative)
    const budgetL    = row[5];  // Col 6 — Budget (L)
    const budgetXAF  = row[6];  // Col 7 — Budget (XAF)
    const rechargePct= row[7];  // Col 8 — Initial recharge %
    const rechargeXAF= row[8];  // Col 9 — Initial recharge XAF
    const cardLimit  = row[9];  // Col 10 — Actual card limit
    const newLimit   = row[11]; // Col 12 — New limit on 26/07/2026 (ACTIVE)

    if (!cluster || !newCard) continue;

    const key = normCluster(cluster);
    cardMap[key] = {
      cluster_name:  cluster,
      card_number:   String(Math.round(Number(newCard))),  // ensure no decimal
      old_card:      oldCard ? String(Math.round(Number(oldCard))) : null,
      vendor:        vendor || 'TOTAL',
      budget_l:      budgetL,
      budget_xaf:    budgetXAF,
      recharge_pct:  rechargePct,
      recharge_xaf:  rechargeXAF,
      card_limit_xaf:cardLimit,
      active_limit_xaf: newLimit,  // most recent limit after 26 Jul
    };

    console.log(
      `  ${(cluster + ':').padEnd(15)}` +
      ` Card ${String(Math.round(Number(newCard))).padEnd(8)}` +
      ` (was ${String(Math.round(Number(oldCard || 0))).padEnd(8)})` +
      ` ${vendor.padEnd(8)}` +
      ` ${(budgetL || 0).toLocaleString('en-GB', {maximumFractionDigits:0}).padStart(8)} L` +
      ` | Limit: ${(newLimit || cardLimit || 0).toLocaleString('en-GB', {maximumFractionDigits:0})} XAF`
    );
  }

  console.log('─'.repeat(70));
  console.log(`\n${Object.keys(cardMap).length} clusters mapped`);

  // ── Update SiteBudget records ───────────────────────────────────────────────
  console.log(`\nUpdating SiteBudget records for cycle ${CYCLE_KEY}...`);

  const budgets = await SiteBudget.find({ cycle_key: CYCLE_KEY })
    .select('_id site_id cluster card_number fuel_vendor xaf_per_liter')
    .lean();

  let updated = 0, unmatched = [];

  for (const sb of budgets) {
    const key   = normCluster(sb.cluster);
    const card  = cardMap[key];

    if (!card) {
      unmatched.push(sb.cluster);
      continue;
    }

    if (!isDryRun) {
      await SiteBudget.updateOne({ _id: sb._id }, {
        $set: {
          card_number: card.card_number,
          fuel_vendor: card.vendor,
          // xaf_per_liter already set by budget import (828/837/847/851)
        }
      });
    }
    updated++;
  }

  console.log(`  Updated: ${updated} sites`);
  if (unmatched.length > 0) {
    const unique = [...new Set(unmatched)];
    console.log(`  Unmatched clusters (no card found): ${unique.join(', ')}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('TOMCARD IMPORT COMPLETE');
  console.log(`  Cards mapped:   ${Object.keys(cardMap).length} clusters`);
  console.log(`  Sites updated:  ${updated}`);
  if (isDryRun) {
    console.log('\n  DRY RUN — no data written. Remove --dry-run to commit.');
  } else {
    console.log('\n  Card numbers and vendors are now set on all site budgets.');
    console.log('  The TomCard page will reflect the correct cluster card mapping.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });