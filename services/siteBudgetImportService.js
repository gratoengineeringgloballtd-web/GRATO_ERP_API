/**
 * siteBudgetImportService.js
 * diesel-system/services/siteBudgetImportService.js
 *
 * Parses the "Book11" Budget Excel file referenced in SiteBudget.js's own
 * header comment ("Source: Book11 Budget file uploaded at cycle start").
 * One sheet, "Budget", header at row 2 (1-indexed) / array index 1, data
 * from row 3 / array index 2 — same simple convention as the Validation
 * Template's Main/Validation sheets.
 *
 * COLUMN MAPPING (verified against an actual Book11 file):
 *   NEW IHS ID                         -> site_id
 *   Site Name (col 1, NOT the duplicate at col 6) -> site_name
 *   Cluster                            -> cluster
 *   Update Topology                    -> topology
 *   State                              -> region
 *   Genset Capacity Mapped (kVA)       -> dg_kva  (NOT "Actual DG KVA" — see
 *                                         note below; 29/166 rows in a real
 *                                         file disagree, and "Mapped" is the
 *                                         bucketed KVA that the sheet's own
 *                                         "Genset CPH" column is computed
 *                                         from, consistent with CPH_TABLE's
 *                                         kva_code buckets used elsewhere in
 *                                         this codebase)
 *   Genset CPH                         -> ccph
 *   Days in <Month> Cycle              -> days_in_cycle
 *   RH <Month>                         -> budgeted_rh
 *   Genset RH/Day (Where Applicable)   -> rh_per_day
 *   Final Grid Availability            -> final_grid_availability (0-1, verified
 *                                         in-range on real data)
 *   Hybrid Expectation (Hrs)           -> hybrid_expectation_hrs
 *   Fueling Sites (Yes/No)             -> is_fueling_site (boolean)
 *   <Month> Diesel Budget - New CPH    -> budget_liters
 *   Dc load (A)                        -> dc_load_amps
 *   Site Load - Mapped (kW)            -> site_load_kw
 *
 *   "Final Concat" column is skipped entirely — it's a string with
 *   comma-decimal values (e.g. "3010,5", a French/Cameroonian locale
 *   artifact) that doesn't map to any SiteBudget field; looks like leftover
 *   helper/debug data from whoever built the template, not real input.
 *
 * IMPORTANT — cycle key has NO source in the file itself:
 *   Unlike CMS/Validation, this sheet has no per-row date column, so the
 *   cycle key cannot be derived the way cmsImportService.js/
 *   validationImportService.js do. It MUST be supplied by the uploader via
 *   the upload form — see siteBudgetUploadRoutes.js. Making this worse: in
 *   a real sample file, the headers reference TWO DIFFERENT MONTHS in the
 *   same sheet ("RH June-26" / "Days in June-26 Cycle" vs "May-26 Diesel
 *   Budget - New CPH") — almost certainly a stale label carried over from
 *   a previous month's copy of the template, not a real two-cycle dataset,
 *   but importImportance() surfaces this as a non-fatal WARNING (header
 *   month mismatch) rather than silently trusting either label, since there
 *   is no way to verify which (if either) is correct from the data alone.
 *
 * SANITISATION:
 *   Fueling Sites (Yes/No) -> boolean via safeBool().
 *   All numeric columns went through a full real-file scan and were 100%
 *   clean int/float (no FAULTY/#N/A/comma-decimal contamination like the
 *   Validation Template had) — safeNum() is still applied defensively in
 *   case a future file isn't as clean, mirroring the rest of this codebase.
 */

'use strict';

const XLSX       = require('xlsx');
const SiteBudget  = require('../models/SiteBudget');
const logger      = require('../utils/logger');

// ── Cell helpers (same contract as the other import services) ────────────────
const g     = (row, i) => row[i] ?? null;
const toStr = v => { const s = String(v ?? '').trim(); return s === '' || s.toLowerCase() === 'nan' ? null : s; };

function stripThousands(s) {
  return s.replace(/,/g, '');
}

const toNum = v => {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const cleaned = stripThousands(String(v).trim());
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
};

function safeNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = stripThousands(String(v).trim());
  if (s === '' || /[^0-9.\-]/i.test(s)) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function safeBool(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

// ── Column map (verified against an actual Book11 file) ──────────────────────
const COLS = {
  ihs_id:              0,  // 'NEW IHS ID'
  site_name:           1,
  sbc:                 2,
  cluster:             3,
  topology:            4,  // 'Update Topology'
  state:               5,
  site_name_dup:       6,  // duplicate of col 1 — ignored
  actual_dg_kva:       7,  // present but NOT used for dg_kva — see header note
  dg_kva_mapped:       8,  // 'Genset Capacity Mapped (kVA)' — AUTHORITATIVE
  dc_load_amps:        9,
  site_load_kw:        10,
  final_concat:        11, // skipped — comma-decimal helper column, not a real field
  ccph:                12, // 'Genset CPH'
  days_in_cycle:       13,
  budgeted_rh:         14, // 'RH <Month>'
  rh_per_day:          15,
  final_grid_availability: 16,
  hybrid_expectation_hrs:  17,
  hybrid_expectation_applied: 18, // present in file, not in SiteBudget schema — not imported
  is_fueling_site:     19, // 'Fueling Sites (Yes/No)'
  budget_liters_new_cph: 20, // '<Month> Diesel Budget - New CPH' (internal estimate)
  site_priority:       21, // 'SITE PRIORITY'
  last_visit_date:     22, // 'LAST VISIT DATE'
  last_visit_stock_l:  23, // 'LAST VISIT STOCK LEFT (L)'
  tank_bottom_l:       24, // 'TANK BOTTOM'
  card_number:         25, // 'CARD NUMBER'
  fuel_vendor:         26, // 'FUEL VENDOR'
  xaf_per_liter:       27, // 'UP' — price per litre (828/837/847/851)
  budget_liters:       28, // 'August-26 DIESEL BUDGET (L)' — FULL budget
  budget_xaf:          29, // 'August-26 DIESEL BUDGET (XAF)'
  budget_liters_approved_ihs: 30, // 'August 26 Diesel Budget Approved By IHS' — AUTHORITATIVE
  budget_xaf_approved_ihs:    31, // 'August 26 Diesel Budget Approved By IHS (FCFA)' — AUTHORITATIVE
};

/**
 * Detect which month each header label references, by scanning the
 * "Days in X Cycle" / "RH X" / "X Diesel Budget" headers for a
 * "<MonthName>-YY" pattern. Used only to produce the cross-check warning
 * described in the header note above — never to silently pick a cycle_key.
 */
function extractMonthLabels(headerRow) {
  const pattern = /([A-Za-z]+-\d{2})/;
  const labels = {};
  const daysHeader   = toStr(g(headerRow, COLS.days_in_cycle));
  const rhHeader      = toStr(g(headerRow, COLS.budgeted_rh));
  const budgetHeader = toStr(g(headerRow, COLS.budget_liters));
  const dm = daysHeader && daysHeader.match(pattern);
  const rm = rhHeader && rhHeader.match(pattern);
  const bm = budgetHeader && budgetHeader.match(pattern);
  if (dm) labels.days = dm[1];
  if (rm) labels.rh = rm[1];
  if (bm) labels.budget = bm[1];
  return labels;
}

/**
 * Parse a single Budget-sheet row.
 */
function parseBudgetRow(row) {
  const ihs_id = toStr(g(row, COLS.ihs_id));
  if (!ihs_id) return null;

  return {
    site_id:   ihs_id,
    site_name: toStr(g(row, COLS.site_name)),
    sbc:       toStr(g(row, COLS.sbc)),
    cluster:   toStr(g(row, COLS.cluster)),
    topology:  toStr(g(row, COLS.topology)),
    region:    toStr(g(row, COLS.state)),

    actual_dg_kva: safeNum(g(row, COLS.actual_dg_kva)),  // audit only — see note
    dg_kva:        safeNum(g(row, COLS.dg_kva_mapped)),  // AUTHORITATIVE
    ccph:          safeNum(g(row, COLS.ccph)),

    days_in_cycle: safeNum(g(row, COLS.days_in_cycle)),
    budgeted_rh:   safeNum(g(row, COLS.budgeted_rh)),
    rh_per_day:    safeNum(g(row, COLS.rh_per_day)),
    final_grid_availability: safeNum(g(row, COLS.final_grid_availability)),
    hybrid_expectation_hrs:  safeNum(g(row, COLS.hybrid_expectation_hrs)),
    is_fueling_site: safeBool(g(row, COLS.is_fueling_site)),

    // ── Budget figures — use IHS-APPROVED as primary ─────────────────────────
    // Col AC (index 28): Full internal budget (L)
    // Col AE (index 30): IHS-APPROVED budget (L) — THIS is the authoritative figure
    budget_liters:              safeNum(g(row, COLS.budget_liters)),
    budget_xaf:                 safeNum(g(row, COLS.budget_xaf)),
    budget_liters_approved_ihs: safeNum(g(row, COLS.budget_liters_approved_ihs)),
    budget_xaf_approved_ihs:    safeNum(g(row, COLS.budget_xaf_approved_ihs)),

    // ── Tom Card & vendor ─────────────────────────────────────────────────────
    card_number:    toStr(g(row, COLS.card_number)),
    fuel_vendor:    toStr(g(row, COLS.fuel_vendor)),
    xaf_per_liter:  safeNum(g(row, COLS.xaf_per_liter)),

    // ── Site operational data ─────────────────────────────────────────────────
    site_priority:     toStr(g(row, COLS.site_priority)),
    last_visit_date:   g(row, COLS.last_visit_date) instanceof Date ? g(row, COLS.last_visit_date) : null,
    last_visit_stock_l:safeNum(g(row, COLS.last_visit_stock_l)),
    tank_bottom_l:     safeNum(g(row, COLS.tank_bottom_l)),

    dc_load_amps: safeNum(g(row, COLS.dc_load_amps)),
    site_load_kw: safeNum(g(row, COLS.site_load_kw)),
  };
}

/**
 * Import the Book11 Budget file for an explicit, uploader-supplied cycle.
 *
 * @param {Buffer|string} fileBuffer
 * @param {string} cycle_key      - REQUIRED; this file has no per-row date
 *                                   to derive it from (see header note).
 * @param {string} uploadedById
 * @param {string} [filename]
 * @returns {Object} summary
 */
async function importSiteBudgetFile(fileBuffer, cycle_key, uploadedById, filename = 'budget.xlsx') {
  if (!cycle_key || !/^\d{4}-\d{2}$/.test(cycle_key)) {
    throw new Error('cycle_key is required and must be in YYYY-MM format — this file has no date column to derive it from.');
  }

  const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames.includes('Budget') ? 'Budget' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('No sheet found in the uploaded file.');

  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  const headerRow = rawRows[1] || [];
  const monthLabels = extractMonthLabels(headerRow);
  const warnings = [];
  const distinctLabels = new Set(Object.values(monthLabels).filter(Boolean));
  if (distinctLabels.size > 1) {
    warnings.push(
      `Header month labels disagree within this file (${JSON.stringify(monthLabels)}). ` +
      `This is usually a stale label left over from a previous month's copy of the ` +
      `template — verify which figures actually belong to cycle "${cycle_key}" before relying on this upload.`
    );
  }

  const rows = [];
  for (let i = 2; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c == null)) continue;
    const parsed = parseBudgetRow(row);
    if (parsed) rows.push(parsed);
  }

  const summary = {
    total: rows.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    warnings,
    month_labels_detected: monthLabels,
  };

  for (const r of rows) {
    try {
      if (r.dg_kva == null || r.ccph == null) {
        // SiteBudget requires both — skip rather than throw, so one bad row
        // doesn't fail the whole upload, but the skip is visible to the user.
        summary.skipped++;
        summary.errors.push({
          site: r.site_id,
          error: `Skipped — missing dg_kva or ccph (dg_kva=${r.dg_kva}, ccph=${r.ccph})`,
        });
        continue;
      }

      const existing = await SiteBudget.findOne({ site_id: r.site_id, cycle_key }).select('_id').lean();

      // Use IHS-Approved budget as the operative figure — it is what
      // was actually signed off and what the field teams work to.
      // Fall back to the full internal budget only if approved is null.
      const effectiveBudgetL   = r.budget_liters_approved_ihs ?? r.budget_liters;
      const effectiveBudgetXAF = r.budget_xaf_approved_ihs    ?? r.budget_xaf
                                   ?? Math.round((effectiveBudgetL || 0) * (r.xaf_per_liter || 828));

      const setDoc = {
        site_name: r.site_name,
        cluster:   r.cluster,
        region:    r.region,
        topology:  r.topology,
        is_fueling_site: r.is_fueling_site,
        dg_kva: r.dg_kva,
        ccph:   r.ccph,
        days_in_cycle: r.days_in_cycle,
        budgeted_rh:   r.budgeted_rh,
        rh_per_day:    r.rh_per_day,
        final_grid_availability: r.final_grid_availability,
        // ── Budget — IHS-approved is the OPERATIVE figure ─────────────────
        budget_liters:              effectiveBudgetL,
        budget_xaf:                 effectiveBudgetXAF,
        budget_liters_approved_ihs: r.budget_liters_approved_ihs,
        budget_xaf_approved_ihs:    r.budget_xaf_approved_ihs,
        // ── Tom Card & pricing ────────────────────────────────────────────
        card_number:    r.card_number   || null,
        fuel_vendor:    r.fuel_vendor   || null,
        xaf_per_liter:  r.xaf_per_liter || 828,
        // ── Site data ─────────────────────────────────────────────────────
        site_priority:     r.site_priority   || null,
        tank_bottom_l:     r.tank_bottom_l   != null ? r.tank_bottom_l : null,
        Tank_Capacity:     r.tank_bottom_l   != null ? undefined : undefined, // preserve existing
        dc_load_amps:      r.dc_load_amps,
        site_load_kw:      r.site_load_kw,
        hybrid_expectation_hrs: r.hybrid_expectation_hrs,
        ...(r.last_visit_date  ? { last_visit_date:   r.last_visit_date  } : {}),
        ...(r.last_visit_stock_l != null ? { last_visit_stock_l: r.last_visit_stock_l } : {}),
        imported_by: uploadedById,
        imported_at: new Date(),
        source_file: filename,
      };

      await SiteBudget.findOneAndUpdate(
        { site_id: r.site_id, cycle_key },
        { $set: setDoc, $setOnInsert: { site_id: r.site_id, cycle_key } },
        { upsert: true, runValidators: true }
      );

      if (existing) summary.updated++;
      else summary.imported++;

    } catch (err) {
      logger.error(`[SiteBudget Import] Row error ${r?.site_id}: ${err.message}`);
      summary.errors.push({ site: r?.site_id, error: err.message });
    }
  }

  logger.info(
    `[SiteBudget Import] cycle=${cycle_key}: ${summary.imported} new, ${summary.updated} updated, ` +
    `${summary.skipped} skipped, ${summary.errors.length} errors`
  );

  return summary;
}

module.exports = { importSiteBudgetFile, parseBudgetRow, extractMonthLabels, COLUMN_MAP: COLS };