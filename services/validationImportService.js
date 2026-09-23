/**
 * validationImportService.js
 * diesel-system/services/validationImportService.js
 *
 * Parses the "GRATO Validation Template" Excel file, which contains two
 * sheets with different roles:
 *
 *   - "Main" sheet: per-visit rows, same conceptual content as the GRATO
 *     Daily Report but in a cleaner column layout (header row 2, no legend
 *     rows). Each row already carries a per-row CCPH and Access Ticket.
 *     These rows are imported into Maintenance, the same destination as
 *     gratoImportService.js's daily-report rows, via buildMaintenancePayload
 *     (re-used directly — see notes below on why this is safe).
 *
 *   - "Validation" sheet: per-site, per-cycle MONTHLY SUMMARY rows. This is
 *     the validated, authoritative reconciliation source. Each row is
 *     stored as a ValidationRecord (audit trail) AND used to update
 *     SiteBudget.dg_kva / SiteBudget.ccph for that site+cycle, using
 *     "Final DG" / "Final DG CPH" as authoritative — NOT the static
 *     CPH_TABLE lookup used elsewhere. Because reconciliationService.js
 *     already reads SiteBudget.ccph/dg_kva on every run, this means the
 *     corrected CCPH flows into reconciliation automatically with zero
 *     changes needed to reconciliationService.js itself.
 *
 * IMPORTANT — site ID suffix:
 *   Investigation of an actual validation-template file confirmed NEITHER
 *   sheet's site-ID column ("I.H.S Site ID" / "I.H.S SITE ID") ever carries
 *   the trailing M/O suffix that CMS's SiteName column uses. That suffix is
 *   a CMS-only artifact. A prior fix mistakenly applied CMS-style suffix
 *   stripping inside gratoImportService.js's parseRow() based on an
 *   incorrect assumption from a single observed reconciliation document;
 *   that has been reverted there (see gratoImportService.js's own changelog)
 *   since it was solving a problem that does not exist in GRATO/Validation
 *   data. This service therefore does NOT strip any suffix from site IDs —
 *   doing so here would be reintroducing the same wrong assumption.
 *
 * IMPORTANT — cycle key:
 *   The "Main" sheet has a single "Cycle" column value shared by (almost)
 *   every row, but the "Validation" sheet's "CURRENT DATE" column was
 *   observed to belong to an ENTIRELY DIFFERENT cycle than Main's rows in
 *   a real sample file (Main = Apr/May 2026, Validation = Dec 2025). The
 *   two sheets must never be assumed to share a cycle. Each Validation row's
 *   cycle_key is derived independently from its own CURRENT DATE via
 *   DieselCycle.getCycleKeyForDate, exactly like cmsImportService.js does
 *   for CMS rows.
 *
 * SANITISATION (same patterns as gratoImportService.js's safeNum/BUG 3/6):
 *   - PREV METER / CURRENT METER may be the string "FAULTY" → safeNum (null),
 *     raw value preserved in prev_meter_raw/current_meter_raw.
 *   - CMS RH may be the literal string "#N/A" → safeNum (null).
 *   - Access Ticket may be the integer 0 (meaning "no ticket") → normalised
 *     to null/undefined rather than stored as the string "0".
 *
 * BUG 11: thousands-separator commas silently corrupted numeric values
 *   (e.g. a cell holding 1160.23, displayed by Excel as "1,160", parsed via
 *   parseFloat to 1 — truncated at the comma — or was wrongly rejected as
 *   non-numeric by safeNum's character allowlist). Confirmed against the
 *   real uploaded file: "Management Amount" recomputed to ~77 instead of
 *   the correct ~89,869 before this was caught and fixed. toNum()/safeNum()
 *   now strip commas before parsing/validating. See stripThousands() below
 *   for full detail.
 */

'use strict';

const XLSX           = require('xlsx');
const Maintenance     = require('../models/Maintenance');
const Site            = require('../models/Site');
const User             = require('../models/User');
const SiteBudget        = require('../models/SiteBudget');
const ValidationRecord  = require('../models/ValidationRecord');
const DieselCycle       = require('../models/DieselCycle');
const logger             = require('../utils/logger');

const {
  resolveTechnician,
  updateSiteFromVisit,
  updateSiteGenerator,
  buildMaintenancePayload,
  normaliseVisitType,
  normaliseCluster,
} = require('./gratoImportService');

// ── Cell helpers (same semantics as gratoImportService.js, PLUS a fix for
//    thousands-separator commas — see BUG 11 note below) ─────────────────────
const g     = (row, i) => row[i] ?? null;
const toStr = v => { const s = String(v ?? '').trim(); return s === '' || s.toLowerCase() === 'nan' ? null : s; };

/**
 * BUG 11 FIX: thousands-separator commas silently corrupted numeric parsing.
 *
 * Root cause: XLSX.utils.sheet_to_json with { raw: false } returns the
 * CELL'S DISPLAY-FORMATTED STRING, not the underlying number, whenever the
 * cell has number formatting applied (e.g. "#,##0" — common on totals and
 * sums in the Validation sheet, like "Final Cons", "SBC Cons", and
 * "Management Amount"). A cell holding 1160.23 was therefore read as the
 * string " 1,160 ", not the number 1160.23.
 *
 * parseFloat(" 1,160 ") returns 1 — it stops at the first character it
 * can't parse, which is the comma — silently truncating every
 * thousands-formatted value to its leading digit group. This was caught by
 * comparing a recomputed "Management Amount" (management_fee_rate is
 * itself an example of a SMALL value with no comma, so it parsed fine,
 * masking the bug) against the real spreadsheet's own value: a site that
 * should have computed to ~89,869 came out as ~77 (i.e. management_fee_rate
 * * 774.58 * 1, because final_cons " 1,160 " parsed to 1).
 *
 * Fix: strip commas (and surrounding whitespace) from numeric-looking
 * strings before handing them to parseFloat. This must happen in BOTH
 * toNum() and safeNum() — safeNum's character-allowlist regex previously
 * REJECTED commas outright (returning null for a valid number, which is
 * worse than truncation: it would be indistinguishable from a genuine
 * "FAULTY"/"#N/A" sentinel value). Applied here only — gratoImportService.js
 * was checked against real Daily-Report-format data and its numeric
 * columns never exceed 4 digits there, so no comma formatting was observed
 * in practice, but the same class of bug could appear if that ever changes;
 * worth porting this same fix there defensively.
 */
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

const toDate = v => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

/**
 * Strip non-numeric strings (FAULTY, HS, N/A, PANNE, #N/A, etc.).
 * BUG 11 FIX applied here too: commas are stripped BEFORE the
 * allowed-character check, so a legitimately comma-formatted number
 * (e.g. "1,160") is recognised as numeric instead of being rejected
 * outright as if it were a non-numeric sentinel like "FAULTY".
 */
function safeNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = stripThousands(String(v).trim());
  if (s === '' || /[^0-9.\-]/i.test(s)) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Access Ticket: sheet uses the literal number 0 to mean "no ticket".
 * Returns null for 0/empty/whitespace, otherwise the trimmed string.
 */
function safeTicket(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '0') return null;
  return s;
}

// ── Column maps (verified against an actual validation-template file) ───────
// Main sheet: header row 2 (1-indexed) / array index 1 with header:1 parsing.
const MAIN_COLS = {
  ihs_id:            0,  // 'I.H.S Site ID'
  sbc:               1,
  site_id_alt:       2,  // 'Site ID' (e.g. LIT_291) — distinct alt id, NOT ihs_id
  site_name:         3,
  cluster:           4,
  visit_topology:    5,
  access_ticket:     6,
  date_last_visit:   7,
  date_current_visit:8,
  gen_prev_meter:    9,
  gen_current_meter: 10,
  rh:                11,  // inter-visit delta RH for this row
  generator_capacity:12,  // KVA
  ccph:              13,  // per-row CCPH (Main sheet's own figure — informational;
                           // Validation sheet's Final DG CPH is authoritative)
  fuel_consumption:  14,
  qty_fuel_prev_left:15,
  qty_fuel_found:    16,
  fuel_qty_added:    17,
  qty_fuel_left:     18,
  site_topology:     19,
  cycle:             20,  // single date shared by (most) rows in the file
  region:            21,
  nbr_days:          22,
  process_id_ref:    23,
  functional_topology:24,
  generator_status:  25,
  generator_visual_check: 26,
  generator_brand:   27,
  rh_per_day:        28,
  generator_comment: 29,
  pwc1_nbr_rectifier:30,
  pwc1_rectifier_capacity:31,
  pwc2_nbr_rectifier:32,
  pwc2_rectifier_capacity:33,
  pwc_comment:       34,
  tank_type:         35,
  qty_consumed:      36,
  gap_cph_variation: 37,
  theft_l:           38,
  load_1ph:          39,
  load_2ph:          40,
  load_3ph:          41,
  dc_load_variation: 42,
  load_comment:      43,
  edo_site:          44,
};

// Validation sheet: header row 2 (1-indexed) / array index 1.
const VAL_COLS = {
  ihs_id:             0,  // 'I.H.S SITE ID'
  access_ticket:      1,
  state:              2,
  site_name:          3,
  customer_id:        4,  // alt site id (e.g. T2015 / LIT_519)
  sbc:                5,
  sbc_region:         6,
  cluster:            7,
  dr_topology:        8,
  site_supervisor:    9,
  prev_date:          10,
  current_date:       11,
  prev_meter:         12,
  current_meter:      13,
  sbc_dg_kva:         14,
  final_dg_kva:       15,
  dg_check:           16,
  dg_comment:         17,
  sbc_rh:             18,
  final_rh:           19,
  cms_rh:             20,
  cms_vs_field:       21,
  cms_vs_field_comment:22,
  total_fuel_added_reported:23,
  service_desk_recording:24,
  fuel_added_var:     25,
  qty_fuel_previously:26,
  qty_fuel_found:     27,
  qty_fuel_added:     28,
  qty_fuel_left:      29,
  final_dg_cph:       30,  // AUTHORITATIVE CCPH
  sbc_cons:           31,
  final_cons:         32,
  cons_var:           33,
  all_comment:        34,
  sbc_comment:        35,
  final_comment:      36,
  cost_per_liter:     37,
  management_fee_rate:38,
  management_amount:  39,  // recomputed, not trusted verbatim — see below
};

// ── Parse one Main-sheet row into the same shape gratoImportService.js's
//    parseRow() produces, so buildMaintenancePayload() can be reused as-is. ──
function parseMainRow(row) {
  const ihs_id     = toStr(g(row, MAIN_COLS.ihs_id));
  const visit_date = toDate(g(row, MAIN_COLS.date_current_visit));
  if (!ihs_id || !visit_date) return null;

  const ch_current_raw = toStr(g(row, MAIN_COLS.gen_current_meter));
  const ch_actuel_num  = ch_current_raw && !isNaN(parseFloat(ch_current_raw))
    ? parseFloat(ch_current_raw) : null;
  const meter_faulty   = !!(ch_current_raw && /FAULTY|HS|PANNE|N\/A/i.test(ch_current_raw));
  const ch_ancien      = safeNum(g(row, MAIN_COLS.gen_prev_meter));
  const run_hours      = toNum(g(row, MAIN_COLS.rh));
  // Main sheet supplies its own per-row CCPH directly — no CPH_TABLE lookup
  // needed/used here (this sheet is informational; Validation's Final DG CPH
  // is what actually updates SiteBudget — see importValidationSheet below).
  const cph_actual     = toNum(g(row, MAIN_COLS.ccph));
  const gen_kva         = toNum(g(row, MAIN_COLS.generator_capacity));

  const qte_laissee = toNum(g(row, MAIN_COLS.qty_fuel_left));
  const qte_trouvee = toNum(g(row, MAIN_COLS.qty_fuel_found));
  const qte_ajoutee = toNum(g(row, MAIN_COLS.fuel_qty_added)) ??
    ((qte_laissee != null && qte_trouvee != null) ? Math.max(0, qte_laissee - qte_trouvee) : null);

  return {
    ihs_id,
    site_id_raw_from_file: ihs_id,  // no suffix issue on this sheet — kept for
                                      // parity with gratoImportService.js's shape
    site_id_alt:      toStr(g(row, MAIN_COLS.site_id_alt)),
    site_name:        toStr(g(row, MAIN_COLS.site_name)),
    cluster:          normaliseCluster(toStr(g(row, MAIN_COLS.cluster))),
    region:           toStr(g(row, MAIN_COLS.region)),
    operator:         null,
    site_priority:    null,
    power_topology:   toStr(g(row, MAIN_COLS.functional_topology)) || toStr(g(row, MAIN_COLS.site_topology)),
    outdoor_indoor:   null,
    sbc:              toStr(g(row, MAIN_COLS.sbc)),

    technician_name:  toStr(g(row, MAIN_COLS.site_supervisor)) || null,
    visit_date,
    prev_visit_date:  toDate(g(row, MAIN_COLS.date_last_visit)),
    hours_since_last: null,
    num_days:         toNum(g(row, MAIN_COLS.nbr_days)),
    visit_type:       normaliseVisitType(null),  // Main sheet has no visit-type column — defaults to 'PM'
    date_check:       null,

    electrical_data: {
      earthing_ohm: null, eneo_working: null, phase_type: null,
      n_ph1_voltage: null, n_ph2_voltage: null, n_ph3_voltage: null,
      eneo_meter_number: null, eneo_sq_check: null,
      actual_index: null, previous_index: null, consumed_kwa: null,
      comments_on_grid: null,
    },

    fuel_data: {
      tom_card_debit_l: null,
      tank_type:        toStr(g(row, MAIN_COLS.tank_type)),
      tank_capacity:    null,
      tank_dimensions:  { long: null, large: null, hauteur: null },
      fond_de_cuve:     null,
      fuel_sq_check:    null,
      qte_precedente:   toNum(g(row, MAIN_COLS.qty_fuel_prev_left)),
      hauteur_gasoil_cm:null,
      qte_trouvee,
      qte_laissee,
      qte_ajoutee,
      qte_consommee:    toNum(g(row, MAIN_COLS.qty_consumed)) ?? toNum(g(row, MAIN_COLS.fuel_consumption)),
    },

    generators_checked: [{
      generator_number: 1,
      brand:             toStr(g(row, MAIN_COLS.generator_brand)),
      serial_number:     null,  // Main sheet has no serial number column
      maintenance_cycle: null,
      kva:               gen_kva,
      dg_age_check:      null,
      dg_age:            null,
      hour_meter_check:  null,
      ch_actuel:         ch_actuel_num,
      ch_ancien,
      run_hours,
      cph_actual,
      cph_contractual:   null,  // see header note — Validation sheet supplies the authoritative figure
      load_1ph:          toNum(g(row, MAIN_COLS.load_1ph)),
      load_2ph:          toNum(g(row, MAIN_COLS.load_2ph)),
      load_3ph:          toNum(g(row, MAIN_COLS.load_3ph)),
      dc_load:           toNum(g(row, MAIN_COLS.dc_load_variation)),
      meter_faulty,
    }],
    gen_number_on_site: null,

    combined_stats: {
      total_run_hour:          run_hours,
      cph_actual,
      cph_contractual:         null,
      dg_rh_per_day:           toNum(g(row, MAIN_COLS.rh_per_day)),
      pertes_en_litres:        null,
      pertes_en_xaf:           null,
      dg_vs_hours:             null,
      grid_gen_percent:        null,
      reason_grid_gen_percent: null,
      automatization_status:   null,
      ch_next_vidange:         null,
      hours_to_oil_change:     null,
    },

    pm_checks: {
      belt: null, oil_filter: null, fuel_filter: null, separ_filter: null,
      air_filter: null, qty_oil_changed: null, qty_radiator_water: null, dirty_oil: null,
    },

    issues_found: {
      DG_Issues: toStr(g(row, MAIN_COLS.generator_comment)),
      IPT_BB_Issues: toStr(g(row, MAIN_COLS.pwc_comment)),
      Issue_of_Aircon: null, Issue_of_Solar: null,
      Any_Other_Issue: toStr(g(row, MAIN_COLS.load_comment)),
      Parts_Replaced: null,
    },

    power_systems: {
      power_cabinets: [],  // Main sheet has rectifier counts but not full cabinet
                            // objects (no battery fields) — left empty; the raw
                            // PWC columns are preserved below for audit.
      battery_threshold_dg_start: null,
    },

    // Extra fields specific to this sheet, carried through to
    // equipment_checks by the caller (see importMainSheet below) since
    // buildMaintenancePayload's generic shape has no dedicated slot for them.
    _validation_extra: {
      access_ticket: safeTicket(g(row, MAIN_COLS.access_ticket)),
      pwc1_nbr_rectifier: toNum(g(row, MAIN_COLS.pwc1_nbr_rectifier)),
      pwc1_rectifier_capacity: toNum(g(row, MAIN_COLS.pwc1_rectifier_capacity)),
      pwc2_nbr_rectifier: toNum(g(row, MAIN_COLS.pwc2_nbr_rectifier)),
      pwc2_rectifier_capacity: toNum(g(row, MAIN_COLS.pwc2_rectifier_capacity)),
      gap_cph_variation: toNum(g(row, MAIN_COLS.gap_cph_variation)),
      theft_l: toNum(g(row, MAIN_COLS.theft_l)),
      edo_site: toStr(g(row, MAIN_COLS.edo_site)),
      generator_status: toStr(g(row, MAIN_COLS.generator_status)),
      generator_visual_check: toStr(g(row, MAIN_COLS.generator_visual_check)),
      process_id_ref: toStr(g(row, MAIN_COLS.process_id_ref)),
    },

    comments: toStr(g(row, MAIN_COLS.generator_comment)),
    source:   'validation_template_main',
  };
}

// ── Parse one Validation-sheet row ────────────────────────────────────────────
function parseValidationRow(row, rowNumber) {
  const ihs_id        = toStr(g(row, VAL_COLS.ihs_id));
  const current_date  = toDate(g(row, VAL_COLS.current_date));
  const final_dg_cph  = toNum(g(row, VAL_COLS.final_dg_cph));
  if (!ihs_id || !current_date || final_dg_cph == null) return null;

  const prev_meter_raw    = toStr(g(row, VAL_COLS.prev_meter));
  const current_meter_raw = toStr(g(row, VAL_COLS.current_meter));

  const final_cons   = toNum(g(row, VAL_COLS.final_cons));
  const cost_per_liter      = toNum(g(row, VAL_COLS.cost_per_liter));
  const management_fee_rate = toNum(g(row, VAL_COLS.management_fee_rate));
  // Recompute rather than trust the sheet's own value verbatim — confirmed
  // via Final_Cons * cost_per_liter * management_fee_rate on real sample
  // data (exact match to within floating point on every checked row).
  const management_amount = (final_cons != null && cost_per_liter != null && management_fee_rate != null)
    ? final_cons * cost_per_liter * management_fee_rate
    : toNum(g(row, VAL_COLS.management_amount));

  return {
    ihs_id,
    access_ticket: safeTicket(g(row, VAL_COLS.access_ticket)),
    state:         toStr(g(row, VAL_COLS.state)),
    site_name:     toStr(g(row, VAL_COLS.site_name)),
    customer_id:   toStr(g(row, VAL_COLS.customer_id)),
    sbc:           toStr(g(row, VAL_COLS.sbc)),
    sbc_region:    toStr(g(row, VAL_COLS.sbc_region)),
    cluster:       normaliseCluster(toStr(g(row, VAL_COLS.cluster))),
    topology:      toStr(g(row, VAL_COLS.dr_topology)),
    site_supervisor: toStr(g(row, VAL_COLS.site_supervisor)),

    prev_date:    toDate(g(row, VAL_COLS.prev_date)),
    current_date,

    prev_meter:        safeNum(g(row, VAL_COLS.prev_meter)),
    current_meter:      safeNum(g(row, VAL_COLS.current_meter)),
    prev_meter_raw:     prev_meter_raw,
    current_meter_raw:  current_meter_raw,

    sbc_dg_kva:   toNum(g(row, VAL_COLS.sbc_dg_kva)),
    final_dg_kva: toNum(g(row, VAL_COLS.final_dg_kva)),
    dg_check:     !!g(row, VAL_COLS.dg_check),
    dg_comment:   toStr(g(row, VAL_COLS.dg_comment)),

    sbc_rh:   toNum(g(row, VAL_COLS.sbc_rh)),
    final_rh: toNum(g(row, VAL_COLS.final_rh)),
    cms_rh:   safeNum(g(row, VAL_COLS.cms_rh)),  // strips literal '#N/A'
    cms_vs_field:         toNum(g(row, VAL_COLS.cms_vs_field)),
    cms_vs_field_comment: toStr(g(row, VAL_COLS.cms_vs_field_comment)),

    total_fuel_added_reported: toNum(g(row, VAL_COLS.total_fuel_added_reported)),
    service_desk_recording:    toNum(g(row, VAL_COLS.service_desk_recording)),
    fuel_added_var:             toNum(g(row, VAL_COLS.fuel_added_var)),
    qty_fuel_previously: toNum(g(row, VAL_COLS.qty_fuel_previously)),
    qty_fuel_found:      toNum(g(row, VAL_COLS.qty_fuel_found)),
    qty_fuel_added:      toNum(g(row, VAL_COLS.qty_fuel_added)),
    qty_fuel_left:       toNum(g(row, VAL_COLS.qty_fuel_left)),

    final_dg_cph,
    sbc_cons:   toNum(g(row, VAL_COLS.sbc_cons)),
    final_cons,
    cons_var:   toNum(g(row, VAL_COLS.cons_var)),

    all_comment:   toStr(g(row, VAL_COLS.all_comment)),
    sbc_comment:   toStr(g(row, VAL_COLS.sbc_comment)),
    final_comment: toStr(g(row, VAL_COLS.final_comment)),

    cost_per_liter,
    management_fee_rate,
    management_amount,

    source_row: rowNumber,
  };
}

/**
 * Import the "Main" sheet — per-visit rows, same destination as the GRATO
 * Daily Report (Maintenance), reusing gratoImportService.js's
 * updateSiteFromVisit / updateSiteGenerator / buildMaintenancePayload so
 * both importers stay behind a single, consistently-sanitised pipeline.
 */
async function importMainSheet(ws, uploadedById, summary) {
  // BUG 11 FIX: raw: true (not raw: false) — preserves underlying numeric
  // precision and avoids thousands-separator display strings entirely.
  // See stripThousands()/toNum()/safeNum() header notes for the full story.
  const rawRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, raw: true,
  });

  const visits = [];
  for (let i = 2; i < rawRows.length; i++) {  // header at index 1, data from index 2
    const row = rawRows[i];
    if (!row || row.every(c => c == null || String(c).trim() === '')) continue;
    const v = parseMainRow(row);
    if (v) visits.push(v);
  }

  summary.main_rows_total = visits.length;

  const seenKeys = new Map();
  function buildUniqueIds(ihs_id, visit_date) {
    const baseKey = `${ihs_id}_${visit_date.getTime()}`;
    const count = seenKeys.get(baseKey) || 0;
    seenKeys.set(baseKey, count + 1);
    const suffix = count === 0 ? '' : `_${count + 1}`;
    return {
      maintenance_id:  `MAINT_VALIDATION_${baseKey}${suffix}`,
      visit_reference: `VISIT_VALIDATION_${baseKey}${suffix}`,
    };
  }

  for (const v of visits) {
    try {
      const techUser = await resolveTechnician(v.technician_name);
      if (techUser) summary.main_technician_links++;

      const t0 = new Date(v.visit_date.getTime() - 4 * 3600000);
      const t1 = new Date(v.visit_date.getTime() + 4 * 3600000);
      const dup = await Maintenance.findOne({
        site_id: v.ihs_id,
        visit_date: { $gte: t0, $lte: t1 },
        source: { $in: ['validation_template_main', 'data_collector_excel'] },
      }).select('_id').lean();
      if (dup) { summary.main_rows_skipped++; continue; }

      await updateSiteFromVisit(v, techUser?._id, uploadedById);

      const swapped = await updateSiteGenerator(v.ihs_id, v.generators_checked[0], uploadedById);
      if (swapped) summary.main_generator_swaps++;

      const supervisorId = techUser?.supervisor || uploadedById;
      const ids = buildUniqueIds(v.ihs_id, v.visit_date);
      const payload = buildMaintenancePayload(v, techUser?._id, supervisorId, uploadedById, ids);

      // Fold in this sheet's extra fields (access ticket, rectifier/PWC
      // detail, theft, gap CPH variation, EDO flag) under equipment_checks,
      // the same Mixed-field destination used for other audit-only data.
      payload.equipment_checks = {
        ...payload.equipment_checks,
        ...v._validation_extra,
      };
      payload.source = 'validation_template_main';

      await Maintenance.create(payload);
      summary.main_rows_imported++;
    } catch (err) {
      logger.error(`[Validation Main] Row error ${v?.ihs_id} ${v?.visit_date}: ${err.message}`);
      summary.errors.push({ sheet: 'Main', site: v?.ihs_id, date: v?.visit_date, error: err.message });
    }
  }
}

/**
 * Import the "Validation" sheet — per-site monthly summary. Stores a
 * ValidationRecord per (site, cycle) and pushes Final DG / Final DG CPH
 * into SiteBudget so reconciliationService.js picks up the authoritative
 * CCPH/KVA on its next run with no changes needed there.
 */
async function importValidationSheet(ws, uploadedById, uploadId, summary) {
  // BUG 11 FIX: raw: true — see importMainSheet's note above.
  const rawRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, raw: true,
  });

  const rows = [];
  for (let i = 2; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c == null || String(c).trim() === '')) continue;
    const parsed = parseValidationRow(row, i + 1);
    if (parsed) rows.push(parsed);
  }

  summary.validation_rows_total = rows.length;
  const cyclesTouched = new Set();

  for (const r of rows) {
    try {
      // Cycle key derived independently per row from CURRENT DATE — never
      // assumed to match the Main sheet's Cycle column. See header note.
      const cycle_key = DieselCycle.getCycleKeyForDate(r.current_date);
      cyclesTouched.add(cycle_key);

      const doc = {
        site_id:       r.ihs_id,
        cycle_key,
        access_ticket: r.access_ticket,
        state:         r.state,
        site_name:     r.site_name,
        customer_id:   r.customer_id,
        sbc:           r.sbc,
        sbc_region:    r.sbc_region,
        cluster:       r.cluster,
        topology:      r.topology,
        site_supervisor: r.site_supervisor,

        prev_date:    r.prev_date,
        current_date: r.current_date,

        prev_meter:    r.prev_meter,
        current_meter: r.current_meter,
        prev_meter_raw:    r.prev_meter_raw,
        current_meter_raw: r.current_meter_raw,

        sbc_dg_kva:   r.sbc_dg_kva,
        final_dg_kva: r.final_dg_kva,
        dg_check:     r.dg_check,
        dg_comment:   r.dg_comment,

        sbc_rh:   r.sbc_rh,
        final_rh: r.final_rh,
        cms_rh:   r.cms_rh,
        cms_vs_field: r.cms_vs_field,
        cms_vs_field_comment: r.cms_vs_field_comment,

        total_fuel_added_reported: r.total_fuel_added_reported,
        service_desk_recording:    r.service_desk_recording,
        fuel_added_var:             r.fuel_added_var,
        qty_fuel_previously: r.qty_fuel_previously,
        qty_fuel_found:      r.qty_fuel_found,
        qty_fuel_added:      r.qty_fuel_added,
        qty_fuel_left:       r.qty_fuel_left,

        final_dg_cph: r.final_dg_cph,
        sbc_cons:   r.sbc_cons,
        final_cons: r.final_cons,
        cons_var:   r.cons_var,

        all_comment:   r.all_comment,
        sbc_comment:   r.sbc_comment,
        final_comment: r.final_comment,

        cost_per_liter:      r.cost_per_liter,
        management_fee_rate: r.management_fee_rate,
        management_amount:   r.management_amount,

        upload_id:   uploadId,
        uploaded_by: uploadedById,
        source_row:  r.source_row,
      };

      const existing = await ValidationRecord.findOne({ site_id: r.ihs_id, cycle_key }).select('_id').lean();

      await ValidationRecord.findOneAndUpdate(
        { site_id: r.ihs_id, cycle_key },
        { $set: doc },
        { upsert: true, runValidators: true }
      );

      if (existing) summary.validation_rows_skipped++;
      else summary.validation_rows_imported++;

      // ── Push authoritative CCPH/KVA into SiteBudget ───────────────────────
      // SiteBudget.dg_kva and .ccph are both `required: true` on the schema,
      // so only attempt this when both Final DG and Final DG CPH are present
      // (parseValidationRow already guarantees final_dg_cph is non-null;
      // final_dg_kva was observed to be 100% populated on real data too, but
      // we still guard defensively here rather than assume that holds for
      // every future file).
      if (r.final_dg_kva != null && r.final_dg_cph != null) {
        const existingBudget = await SiteBudget.findOne({ site_id: r.ihs_id, cycle_key }).lean();

        const budgetSet = {
          dg_kva: r.final_dg_kva,
          ccph:   r.final_dg_cph,
        };
        // Only fill identity fields when missing, never overwrite values
        // that may already be curated from the Book11 budget upload.
        if (!existingBudget?.site_name) budgetSet.site_name = r.site_name;
        if (!existingBudget?.cluster)   budgetSet.cluster   = r.cluster;
        if (!existingBudget?.region)    budgetSet.region    = r.state;
        if (!existingBudget?.topology)  budgetSet.topology  = r.topology;

        await SiteBudget.findOneAndUpdate(
          { site_id: r.ihs_id, cycle_key },
          {
            $set: budgetSet,
            $setOnInsert: {
              site_id: r.ihs_id,
              cycle_key,
              imported_by: uploadedById,
              imported_at: new Date(),
              source_file: 'validation_template',
            },
          },
          { upsert: true, runValidators: true }
        );
        summary.site_budgets_updated++;
      }
    } catch (err) {
      logger.error(`[Validation] Row error ${r?.ihs_id} cycle=? : ${err.message}`);
      summary.errors.push({ sheet: 'Validation', site: r?.ihs_id, date: r?.current_date, error: err.message });
    }
  }

  summary.validation_cycles_touched = [...cyclesTouched];
}

/**
 * Main entry point: imports both sheets from the validation template file.
 *
 * @param {Buffer} fileBuffer
 * @param {string} uploadedById
 * @param {string} [uploadId] - the ValidationUpload._id, attached to each
 *   ValidationRecord for audit. Optional; pass after creating the upload
 *   doc in the route, or omit and patch in afterward.
 * @returns {Object} summary
 */
async function importValidationFile(fileBuffer, uploadedById, uploadId = null) {
  const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });

  if (!wb.SheetNames.includes('Main') || !wb.SheetNames.includes('Validation')) {
    throw new Error(
      `Expected sheets "Main" and "Validation", found: ${wb.SheetNames.join(', ')}`
    );
  }

  const summary = {
    main_rows_total: 0, main_rows_imported: 0, main_rows_skipped: 0,
    main_technician_links: 0, main_generator_swaps: 0,
    validation_rows_total: 0, validation_rows_imported: 0, validation_rows_skipped: 0,
    validation_cycles_touched: [], site_budgets_updated: 0,
    errors: [],
  };

  await importMainSheet(wb.Sheets['Main'], uploadedById, summary);
  await importValidationSheet(wb.Sheets['Validation'], uploadedById, uploadId, summary);

  logger.info(
    `[Validation Import] Main: ${summary.main_rows_imported}/${summary.main_rows_total} imported. ` +
    `Validation: ${summary.validation_rows_imported}/${summary.validation_rows_total} imported, ` +
    `${summary.site_budgets_updated} SiteBudgets updated, cycles=${summary.validation_cycles_touched.join(',')}. ` +
    `${summary.errors.length} errors.`
  );

  return summary;
}

/**
 * Serialise error objects to strings for ValidationUpload.errors [String].
 * Same contract as gratoImportService.js's serialiseErrors.
 */
function serialiseErrors(errors) {
  return (errors || []).slice(0, 30).map(e => {
    if (typeof e === 'string') return e;
    const sheet = e.sheet ? `[${e.sheet}] ` : '';
    return `${sheet}${e.site || '?'} | ${e.date ? new Date(e.date).toISOString().slice(0, 10) : '?'} | ${e.error || e.message || JSON.stringify(e)}`;
  });
}

module.exports = {
  importValidationFile,
  parseMainRow,
  parseValidationRow,
  safeNum,
  safeTicket,
  serialiseErrors,
  MAIN_COLS,
  VAL_COLS,
};