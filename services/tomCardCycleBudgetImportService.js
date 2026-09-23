/**
 * tomCardCycleBudgetImportService.js
 *
 * Parses the cycle-opening Tom Card budget/limit aggregate (see
 * models/TomCardCycleBudget.js for the full column-shape explanation) and
 * upserts one row per (cycle_key, card_number).
 *
 * Column layout (fixed positions — header text carries stray leading
 * newlines and a duplicate column name in the source file, so this reads
 * by position, not by header string match):
 *   0  New SBC
 *   1  Cluster
 *   2  Vendor
 *   3  Card Number            (old/current number)
 *   4  New Card Number        (active number for the new cycle, if reissued)
 *   5  Diesel Budget (L)
 *   6  Diesel Budget Amount (XAF)
 *   7  Initial % Recharge Amount (fraction, e.g. 0.8)
 *   8  Initial % Recharge Amount (computed XAF value)
 *   9  Actual Card Limit
 *   10 Strategic Tank Usage
 *   11 New limit on <date>    (card ceiling for the cycle)
 */

'use strict';

const XLSX = require('xlsx');
const { TomCardCycleBudget, TomCardCycleBudgetUpload } = require('../models/TomCardCycleBudget');

const COLS = {
  sbc: 0, cluster: 1, vendor: 2,
  card_number: 3, new_card_number: 4,
  budget_liters: 5, budget_xaf: 6,
  recharge_pct: 7, recharge_amount_xaf: 8,
  card_limit_xaf: 9, strategic_tank_usage: 10,
  new_limit: 11,
};

function toStr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s.toLowerCase() === 'nan' ? null : s;
}

// Card numbers arrive as floats from Excel (e.g. 5807.0) — normalize to a
// clean integer-looking string so they compare/match consistently with
// however TomCardTransaction/TomCardMapping store card numbers elsewhere.
function toCardNumber(v) {
  const s = toStr(v);
  if (!s) return null;
  const n = Number(s);
  if (!isNaN(n) && Number.isFinite(n)) return String(Math.trunc(n));
  return s;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * @param {Buffer} fileBuffer
 * @param {string} cycleKey - e.g. '2026-08' — REQUIRED. This file has no
 *   per-row date to derive a cycle from (the month is only mentioned in
 *   free-text column headers), same reasoning as the Site Budget upload.
 * @param {string} uploadedById
 * @param {string} filename
 */
async function importTomCardCycleBudgetFile(fileBuffer, cycleKey, uploadedById, filename = 'tomcards.xlsx') {
  const start = Date.now();

  const uploadDoc = await TomCardCycleBudgetUpload.create({
    filename,
    cycle_key: cycleKey,
    status: 'processing',
    uploaded_by: uploadedById,
  });

  const errors = [];
  const warnings = [];

  try {
    const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

    // Row 0 is the header — data starts at row 1.
    const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== ''));
    let rowsTotal = dataRows.length;
    let rowsImported = 0;
    let cardsReissued = 0;

    const bulkOps = [];

    dataRows.forEach((row, i) => {
      const cluster = toStr(row[COLS.cluster]);
      const oldCardNumber = toCardNumber(row[COLS.card_number]);
      const newCardNumberRaw = toCardNumber(row[COLS.new_card_number]);

      if (!cluster || (!oldCardNumber && !newCardNumberRaw)) {
        warnings.push(`Row ${i + 2}: missing cluster or card number — skipped.`);
        return;
      }

      const activeCardNumber = newCardNumberRaw || oldCardNumber;
      const wasReissued = !!(newCardNumberRaw && oldCardNumber && newCardNumberRaw !== oldCardNumber);
      if (wasReissued) cardsReissued++;

      const budgetLiters = toNum(row[COLS.budget_liters]);
      const budgetXaf = toNum(row[COLS.budget_xaf]);
      const impliedRate = (budgetLiters && budgetXaf) ? +(budgetXaf / budgetLiters).toFixed(2) : null;

      bulkOps.push({
        updateOne: {
          filter: { cycle_key: cycleKey, card_number: activeCardNumber },
          update: {
            $set: {
              cycle_key: cycleKey,
              sbc: toStr(row[COLS.sbc]),
              cluster,
              vendor: toStr(row[COLS.vendor]) || 'TOTAL',
              card_number: activeCardNumber,
              card_number_old: oldCardNumber,
              was_reissued: wasReissued,
              budget_liters: budgetLiters,
              budget_xaf: budgetXaf,
              recharge_pct: toNum(row[COLS.recharge_pct]),
              recharge_amount_xaf: toNum(row[COLS.recharge_amount_xaf]),
              card_limit_xaf: toNum(row[COLS.new_limit]) ?? toNum(row[COLS.card_limit_xaf]),
              implied_xaf_per_liter: impliedRate,
              upload_id: uploadDoc._id,
            },
          },
          upsert: true,
        },
      });
      rowsImported++;
    });

    if (bulkOps.length > 0) {
      await TomCardCycleBudget.bulkWrite(bulkOps, { ordered: false });
    }

    await TomCardCycleBudgetUpload.findByIdAndUpdate(uploadDoc._id, {
      status: 'completed',
      rows_total: rowsTotal,
      rows_imported: rowsImported,
      cards_reissued: cardsReissued,
      errors,
      warnings,
      processed_at: new Date(),
    });

    return {
      upload_id: uploadDoc._id,
      cycle_key: cycleKey,
      rows_total: rowsTotal,
      rows_imported: rowsImported,
      cards_reissued: cardsReissued,
      errors,
      warnings,
      elapsed_ms: Date.now() - start,
    };
  } catch (err) {
    await TomCardCycleBudgetUpload.findByIdAndUpdate(uploadDoc._id, {
      status: 'failed',
      errors: [err.message],
      processed_at: new Date(),
    });
    throw err;
  }
}

module.exports = { importTomCardCycleBudgetFile };
