/**
 * gratoImportService.js
 * diesel-system/services/gratoImportService.js
 *
 * Parses the GRATO Global Daily Report Excel file.
 * Verified column indices from actual file analysis.
 *
 * KEY RULES:
 *  - CPH 1 (col 56) = ACTUAL measured L/hr → USE THIS for reconciliation
 *  - CPH CONTRACTUELS (col 58) = stale placeholder → SKIP
 *  - RUN HOURS G1 (col 55) = inter-visit delta hours (not cumulative)
 *  - CH ACTUEL G1 (col 53) = cumulative meter reading (may be 'FAULTY')
 *  - QTE AJOUTEE derived: max(0, QTE_LAISSEE - QTE_TROUVEE)
 *  - CM visit type mapped to 'END' (corrective maintenance)
 *  - 'kotto' cluster normalised to 'Kotto'
 *  - Generator swap detected when serial number changes on same site
 *
 * PATCH NOTES (applied):
 *  BUG 1: Phase_Type: '' is not a valid enum value
 *    → Never write empty strings to enum fields on Site. Only $set
 *      validated, non-empty values via findOneAndUpdate.
 *  BUG 2: Current_Generators.0: A site can have maximum 2 generators
 *    → GRATO import must NEVER write to Current_Generators or
 *      Primary_Generator/Secondary_Generator. Only Generators_Details
 *      (embedded detail sub-docs) is touched.
 *  BUG 3: Generators_Details.0.dg_age: Cast to Number failed for value "FAULTY"
 *    → Strip non-numeric strings (FAULTY, HS, N/A, PANNE) via safeNum()
 *      before writing dg_age (and other numeric generator fields).
 *  BUG 4: GratoUpload errors.0: Cast to [string] failed
 *    → GratoUpload.errors is [String]; serialiseErrors() converts the
 *      {site, date, error} objects to plain strings before saving.
 *  BUG 5: power_systems.power_cabinets.0: Cast to [string] failed
 *    → Maintenance.power_systems.power_cabinets is [String], but parseRow()
 *      builds cabinet objects. buildMaintenancePayload() passes an empty
 *      array there and stores the real objects under
 *      equipment_checks.power_cabinet_info (Mixed) instead.
 *  BUG 6: electrical_data.actual_index: Cast to Number failed for "OUTAGE"
 *    → actual_index is Number on the schema, but the sheet may contain
 *      "OUTAGE"/"FAULTY"/"COUPURE". buildMaintenancePayload() runs it
 *      through safeNum() (null if non-numeric) and preserves the raw
 *      string under equipment_checks.actual_index_raw.
 *  BUG 7: E11000 duplicate key error on maintenance_id_1
 *    → maintenance_id/visit_reference are derived from site_id + visit
 *      timestamp. Two rows in the SAME uploaded file can share that exact
 *      key (multi-generator sites, duplicate sheet rows), which the
 *      DB-side ±4h/technician de-dup check does not catch since that only
 *      looks at previously-saved records. importGratoExcel() now tracks
 *      every (site_id + timestamp) key seen so far in the batch via
 *      seenKeys/buildUniqueIds() and appends a numeric suffix (_2, _3, ...)
 *      on repeats so the insert succeeds instead of erroring the row.
 *  BUG 8: fuel_data.tank_type: `EXT/INT` is not a valid enum value
 *    → Maintenance.fuel_data.tank_type shares Site.Type_de_Tank's enum
 *      (['INT','EXT','underground','surface','mobile']), but the sheet
 *      sometimes records combined values like "EXT/INT" for sites with
 *      both tank types. buildMaintenancePayload() now applies the same
 *      TANK_TYPES allow-list used for the Site update and omits the field
 *      when it doesn't match exactly, preserving the raw value under
 *      equipment_checks.tank_type_raw.
 *  BUG 9: route was requiring '../services/gratoImportService_fix' (a
 *    different, stale file). Not fixable from within this file — see
 *    gratoUploadRoutes.js, which now requires this file directly.
 *  BUG 10 (REVERTED): a prior fix applied CMS-style trailing-M/O-suffix
 *    stripping to the ihs_id column inside parseRow(), based on a single
 *    observed reconciliation document showing "IHS_BNB_030M". Direct
 *    inspection of an actual GRATO Daily Report / Validation Template file
 *    confirmed NEITHER sheet's site-ID column ever carries that suffix — it
 *    is exclusively a CMS SiteName artifact (confirmed against
 *    cmsImportService.js's normaliseSiteId(), which exists for exactly that
 *    reason). Applying the strip here was solving a problem that does not
 *    exist in GRATO data, and risked silently corrupting any real GRATO
 *    site id that happens to legitimately end in M or O. The
 *    normaliseSiteId() function is kept (and exported) in case any future
 *    caller genuinely needs it, but parseRow() no longer calls it on
 *    ihs_id — ihs_id is used verbatim, as it was before BUG 10's
 *    (incorrect) fix was applied.
 */




'use strict';

const XLSX        = require('xlsx');
const Maintenance  = require('../models/Maintenance');
const Site         = require('../models/Site');
const User         = require('../models/User');
const logger       = require('../utils/logger');
// INTEGRATION: populate FieldVisitRecord so reconciliationService.js
// can read field data — this was the missing write path.
const fieldVisitService = require('./fieldVisitService');

// ── CPH Contractual Lookup Table (from CPH sheet) ─────────────────────────────
// Used ONLY to look up the correct contractual rate for reconciliation.
// Structure: { kva_code: { below_10k: rate, above_10k: rate } }
// kva_code is the standardised bucket code from the CPH sheet.
const CPH_TABLE = [
  { kva_max: 9,   kva_code: 10,  below_10k: 1.57, above_10k: 2.00 },
  { kva_max: 10,  kva_code: 12,  below_10k: 1.70, above_10k: 2.00 },
  { kva_max: 12.5,kva_code: 15,  below_10k: 1.80, above_10k: 2.10 },
  { kva_max: 13,  kva_code: 15,  below_10k: 1.80, above_10k: 2.10 },
  { kva_max: 15,  kva_code: 17,  below_10k: 1.90, above_10k: 2.25 },
  { kva_max: 17,  kva_code: 20,  below_10k: 2.10, above_10k: 2.40 },
  { kva_max: 20,  kva_code: 22,  below_10k: 2.30, above_10k: 2.50 },
  { kva_max: 22,  kva_code: 30,  below_10k: 2.60, above_10k: 3.00 },
  { kva_max: 30,  kva_code: 45,  below_10k: 3.50, above_10k: 4.50 },
  { kva_max: 45,  kva_code: 60,  below_10k: 4.50, above_10k: 6.00 },
  { kva_max: 60,  kva_code: 60,  below_10k: 4.50, above_10k: 6.00 },
];

/**
 * Get contractual CPH for a generator given KVA and cumulative running hours.
 * @param {number} kva   - Generator KVA rating
 * @param {number} totalRh - Cumulative running hours on the generator
 * @returns {number|null}
 */
function getContractualCPH(kva, totalRh) {
  if (!kva) return null;
  const entry = CPH_TABLE.find(e => kva <= e.kva_max) || CPH_TABLE[CPH_TABLE.length - 1];
  return (totalRh && totalRh >= 10000) ? entry.above_10k : entry.below_10k;
}

// ── Verified column index map (header row 11, 0-indexed) ─────────────────────
const C = {
  date_fixed:         0,
  ihs_id:             1,   // IHS_ID_SITE
  site_id_alt:        2,   // LIT_xxx
  site_name:          3,
  cluster:            4,
  power_topology:     5,   // New POWER TOPOLOGY
  power_topology2:    6,   // duplicate col — ignore
  comments_col7:      7,   // empty
  outdoor_indoor:     8,
  site_priority:      9,
  state:              10,  // region
  operator:           11,
  technician:         12,
  date_check:         13,
  visit_date:         14,  // ACTUEL DATE VISIT
  prev_visit_date:    15,
  hours_since_last:   16,  // inter-visit hours
  sbc:                17,
  visit_type:         18,  // PM / RF / PM+RF / END / CM / etc.

  // Grid
  earthing_ohm:       19,
  eneo_working:       20,
  phase_type:         21,
  ph1_voltage:        22,
  ph2_voltage:        23,
  ph3_voltage:        24,
  eneo_meter_num:     25,
  eneo_sq_check:      26,
  actual_index:       27,
  previous_index:     28,
  consumed_kwa:       29,
  comments_grid:      30,

  // Fuel & Tom Card
  tom_card_debit_l:   31,
  tank_type:          32,
  tank_capacity:      33,
  tank_long:          34,
  tank_large:         35,
  tank_hauteur:       36,
  tank_coef:          37,  // coéficiant (often empty)
  fond_de_cuve:       38,
  fuel_sq_check:      39,
  qte_precedente:     40,  // fuel found at LAST visit (opening balance)
  hauteur_trouvee_cm: 41,
  qte_trouvee:        42,  // fuel found THIS visit (before refuel)
  qte_laissee:        43,  // fuel left AFTER refuel
  qte_consommee:      44,  // fuel consumed since last visit

  // Generator 1
  gen_number:         45,  // number of generators on site
  gen1_brand:         46,
  gen1_serial:        47,
  gen1_maint_cycle:   48,  // maintenance cycle in hours (e.g. 250)
  gen1_kva:           49,
  dg_age_check:       50,
  dg_age:             51,
  hour_meter_check:   52,
  ch_actuel_g1:       53,  // cumulative meter NOW (may be 'FAULTY')
  ch_ancien_g1:       54,  // cumulative meter at prev visit
  run_hours_g1:       55,  // DELTA hours this inter-visit period
  cph1:               56,  // ACTUAL measured L/hr — USE THIS
  hours_to_oil_change:57,
  // col 58: CPH CONTRACTUELS — SKIP (stale pre-filled value)
  pertes_litres:      59,
  pertes_xaf:         60,
  num_days:           61,
  dg_rh_per_day:      62,  // average RH per day for the period

  // Load readings
  load_1ph:           63,
  load_2ph:           64,
  load_3ph:           65,  // col label says 'G2' but is actually G1 3ph
  dc_load:            66,
  dg_vs_hours:        67,
  grid_gen_pct:       68,
  reason_grid_gen:    69,  // usually empty
  automatization:     70,
  ch_next_vidange:    71,

  // PM Parts
  belt:               72,
  oil_filter:         73,
  fuel_filter:        74,
  separ_filter:       75,
  air_filter:         76,
  qty_oil_changed:    77,
  qty_radiator_water: 78,
  dirty_oil:          79,

  // Issues
  dg_issues:          80,
  ipt_bb_issues:      81,
  aircon_issues:      82,
  solar_issues:       83,
  other_issues:       84,
  parts_replaced:     85,

  // Power Cabinet 1
  pow_cab1_type:      86,
  pow_cab1_rect_type: 87,
  pow_cab1_rect_num:  88,
  pow_cab1_rect_cap:  89,
  pow_cab1_bat_num:   90,
  pow_cab1_bat_cap:   91,
  pow_cab1_bat_auto:  92,

  // Power Cabinet 2
  pow_cab2_type:      93,
  pow_cab2_rect_type: 94,
  pow_cab2_rect_num:  95,
  pow_cab2_rect_cap:  96,
  pow_cab2_bat_num:   97,
  pow_cab2_bat_cap:   98,
  pow_cab2_bat_auto:  99,

  // Power Cabinet 3
  pow_cab3_type:      100,
  pow_cab3_rect_type: 101,
  pow_cab3_rect_num:  102,
  pow_cab3_rect_cap:  103,
  pow_cab3_bat_num:   104,
  pow_cab3_bat_cap:   105,
  pow_cab3_bat_auto:  106,

  bat_threshold_dg:   107,
  comments:           108,
};

// ── Visit type normaliser ─────────────────────────────────────────────────────
const VALID_VISIT_TYPES = new Set(['PM','RF','END','PM+END','PM+RF','RF+END','PM+RF+END']);
function normaliseVisitType(raw) {
  if (!raw) return 'PM';
  const s = raw.trim().toUpperCase();
  if (s === 'CM') return 'END';           // CM = corrective maintenance → END
  if (s === 'RF') return 'RF';
  if (VALID_VISIT_TYPES.has(s)) return s;
  // Handle lowercase variants like 'Rf'
  const upper = s.replace(/[^A-Z+]/g, '');
  return VALID_VISIT_TYPES.has(upper) ? upper : 'PM';
}

// Normalise cluster name (e.g. 'kotto' → 'Kotto')
function normaliseCluster(raw) {
  if (!raw) return null;
  return raw.trim().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Kept available for any caller that genuinely needs CMS-style suffix
 * stripping (e.g. cross-referencing against CMS-format data elsewhere),
 * but — per BUG 10's revert, see header note — this is NO LONGER called
 * inside parseRow() on GRATO's ihs_id column. Real GRATO Daily Report /
 * Validation Template data confirmed that column never carries this
 * suffix; CMS's SiteName column is the only place it legitimately occurs.
 */
function normaliseSiteId(rawName) {
  if (!rawName) return null;
  return rawName.replace(/[MO]$/, '').trim();
}

// ── Cell helpers ──────────────────────────────────────────────────────────────
const g    = (row, i)  => row[i] ?? null;
const toStr = v => { const s = String(v ?? '').trim(); return s === '' || s.toLowerCase() === 'nan' ? null : s; };
const toNum = v => { if (v == null) return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
const toDate = v => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

// ── BUG 3 FIX: safe numeric — strips FAULTY/HS/N/A/PANNE strings ─────────────
// Any non-numeric string (e.g. "FAULTY", "HS", "N/A", "PANNE") becomes null
// instead of being cast to Number and throwing a Mongoose CastError.
function safeNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim();
  if (s === '' || /[^0-9.\-]/i.test(s)) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ── Helper: only include key in target obj if value is non-null/non-empty ────
function setIf(obj, key, value) {
  if (value !== null && value !== undefined && value !== '') {
    obj[key] = value;
  }
}

// ── Technician cache & fuzzy match ───────────────────────────────────────────
const _techCache = {};
async function resolveTechnician(rawName) {
  if (!rawName) return null;
  const key = rawName.trim().toLowerCase();
  if (_techCache[key] !== undefined) return _techCache[key];

  let user = await User.findOne({
    fullName: { $regex: new RegExp('^' + rawName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
    role: { $in: ['technician', 'fuel', 'data_collector'] },
  }).select('_id fullName role supervisor').lean();

  if (!user) {
    // Token-based partial match (at least 2 tokens of length > 2)
    const tokens = rawName.trim().split(/\s+/).filter(t => t.length > 2);
    if (tokens.length >= 2) {
      const regex = tokens.map(t => `(?=.*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).join('');
      user = await User.findOne({
        fullName: { $regex: new RegExp(regex, 'i') },
        role: { $in: ['technician', 'fuel', 'data_collector'] },
      }).select('_id fullName role supervisor').lean();
    }
  }

  _techCache[key] = user || null;
  return _techCache[key];
}

// ── Parse a single row ────────────────────────────────────────────────────────
function parseRow(row) {
  // BUG 10 REVERTED: ihs_id is used verbatim — no suffix stripping.
  // Real GRATO Daily Report / Validation Template data confirmed this
  // column never carries the CMS-style trailing M/O suffix. See header note.
  const ihs_id     = toStr(g(row, C.ihs_id));
  const visit_date = toDate(g(row, C.visit_date));
  if (!ihs_id || !visit_date) return null;

  const ch_actuel_raw = toStr(g(row, C.ch_actuel_g1));
  const ch_actuel_num = ch_actuel_raw && !isNaN(parseFloat(ch_actuel_raw))
    ? parseFloat(ch_actuel_raw) : null;
  const meter_faulty  = !!(ch_actuel_raw && /FAULTY|HS|PANNE|N\/A/i.test(ch_actuel_raw));
  const ch_ancien     = toNum(g(row, C.ch_ancien_g1));
  const run_hours     = toNum(g(row, C.run_hours_g1));  // delta
  const cph_actual    = toNum(g(row, C.cph1));           // measured — USE THIS
  const gen1_kva      = toNum(g(row, C.gen1_kva));

  // Derive contractual CPH from lookup table (using cumulative RH if meter ok)
  const cumulative_rh = ch_actuel_num || (ch_ancien != null && run_hours != null ? ch_ancien + run_hours : null);
  const cph_contractual = getContractualCPH(gen1_kva, cumulative_rh);

  // Derive fuel added
  const qte_laissee   = toNum(g(row, C.qte_laissee));
  const qte_trouvee   = toNum(g(row, C.qte_trouvee));
  const qte_ajoutee   = (qte_laissee != null && qte_trouvee != null)
    ? Math.max(0, qte_laissee - qte_trouvee) : null;

  const cluster = normaliseCluster(toStr(g(row, C.cluster)));

  // Power cabinets
  const power_cabinets = [];
  const cabDefs = [
    { type: C.pow_cab1_type, rt: C.pow_cab1_rect_type, rn: C.pow_cab1_rect_num,
      rc: C.pow_cab1_rect_cap, bn: C.pow_cab1_bat_num, bc: C.pow_cab1_bat_cap,
      ba: C.pow_cab1_bat_auto, num: 1 },
    { type: C.pow_cab2_type, rt: C.pow_cab2_rect_type, rn: C.pow_cab2_rect_num,
      rc: C.pow_cab2_rect_cap, bn: C.pow_cab2_bat_num, bc: C.pow_cab2_bat_cap,
      ba: C.pow_cab2_bat_auto, num: 2 },
    { type: C.pow_cab3_type, rt: C.pow_cab3_rect_type, rn: C.pow_cab3_rect_num,
      rc: C.pow_cab3_rect_cap, bn: C.pow_cab3_bat_num, bc: C.pow_cab3_bat_cap,
      ba: C.pow_cab3_bat_auto, num: 3 },
  ];
  for (const cab of cabDefs) {
    const ct = toStr(g(row, cab.type));
    if (ct) power_cabinets.push({
      cabinet_number: cab.num, type: ct,
      rectifier_type: toStr(g(row, cab.rt)),
      num_rectifiers: toNum(g(row, cab.rn)),
      capacity_per_rectifier: toNum(g(row, cab.rc)),
      num_batteries: toNum(g(row, cab.bn)),
      battery_capacity: toStr(g(row, cab.bc)),
      battery_autonomy: toNum(g(row, cab.ba)),
    });
  }

  return {
    // Identifiers
    ihs_id,
    site_id_raw_from_file: ihs_id,   // no suffix to track post-revert — kept
                                       // for shape-compatibility with callers
                                       // (e.g. validationImportService.js)
                                       // that read this field.
    site_id_alt:      toStr(g(row, C.site_id_alt)),
    site_name:        toStr(g(row, C.site_name)),
    cluster,
    region:           toStr(g(row, C.state)),
    operator:         toStr(g(row, C.operator)),
    site_priority:    toStr(g(row, C.site_priority)),
    power_topology:   toStr(g(row, C.power_topology)),
    outdoor_indoor:   toStr(g(row, C.outdoor_indoor)),
    sbc:              toStr(g(row, C.sbc)),

    // Personnel & timing
    technician_name:  toStr(g(row, C.technician)),
    visit_date,
    prev_visit_date:  toDate(g(row, C.prev_visit_date)),
    hours_since_last: toNum(g(row, C.hours_since_last)),
    num_days:         toNum(g(row, C.num_days)),
    visit_type:       normaliseVisitType(toStr(g(row, C.visit_type))),
    date_check:       toStr(g(row, C.date_check)),

    // Grid / ENEO
    electrical_data: {
      earthing_ohm:      toNum(g(row, C.earthing_ohm)),
      eneo_working:      toStr(g(row, C.eneo_working)),
      phase_type:        toStr(g(row, C.phase_type)),
      n_ph1_voltage:     toNum(g(row, C.ph1_voltage)),
      n_ph2_voltage:     toNum(g(row, C.ph2_voltage)),
      n_ph3_voltage:     toNum(g(row, C.ph3_voltage)),
      eneo_meter_number: toStr(g(row, C.eneo_meter_num)),
      eneo_sq_check:     toStr(g(row, C.eneo_sq_check)),
      actual_index:      toStr(g(row, C.actual_index)),    // may be 'OUTAGE'
      previous_index:    toNum(g(row, C.previous_index)),
      consumed_kwa:      toNum(g(row, C.consumed_kwa)),
      comments_on_grid:  toStr(g(row, C.comments_grid)),
    },

    // Fuel
    fuel_data: {
      tom_card_debit_l:   toNum(g(row, C.tom_card_debit_l)),
      tank_type:          toStr(g(row, C.tank_type)),
      tank_capacity:      toNum(g(row, C.tank_capacity)),
      tank_dimensions: {
        long:     toNum(g(row, C.tank_long)),
        large:    toNum(g(row, C.tank_large)),
        hauteur:  toNum(g(row, C.tank_hauteur)),
      },
      fond_de_cuve:       toNum(g(row, C.fond_de_cuve)),
      fuel_sq_check:      toStr(g(row, C.fuel_sq_check)),
      qte_precedente:     toNum(g(row, C.qte_precedente)), // opening balance
      hauteur_gasoil_cm:  toNum(g(row, C.hauteur_trouvee_cm)),
      qte_trouvee,                                          // fuel found (before refuel)
      qte_laissee,                                          // fuel left (after refuel)
      qte_ajoutee,                                          // DERIVED: refuel amount
      qte_consommee:      toNum(g(row, C.qte_consommee)),  // consumed since last
    },

    // Generator 1
    generators_checked: [{
      generator_number:  1,
      brand:             toStr(g(row, C.gen1_brand)),
      serial_number:     toStr(g(row, C.gen1_serial)),
      maintenance_cycle: toNum(g(row, C.gen1_maint_cycle)),
      kva:               gen1_kva,
      dg_age_check:      toStr(g(row, C.dg_age_check)),
      dg_age:            toStr(g(row, C.dg_age)),
      hour_meter_check:  toStr(g(row, C.hour_meter_check)),
      ch_actuel:         ch_actuel_num,     // cumulative meter (null if faulty)
      ch_ancien:         ch_ancien,          // previous cumulative
      run_hours:         run_hours,          // DELTA hours for this period
      cph_actual:        cph_actual,         // MEASURED L/hr — use in reconciliation
      cph_contractual,                       // CALCULATED from CPH table by KVA
      load_1ph:          toNum(g(row, C.load_1ph)),
      load_2ph:          toNum(g(row, C.load_2ph)),
      load_3ph:          toNum(g(row, C.load_3ph)),
      dc_load:           toNum(g(row, C.dc_load)),
      meter_faulty,
    }],
    gen_number_on_site: toNum(g(row, C.gen_number)),

    // Combined stats
    combined_stats: {
      total_run_hour:          run_hours,
      cph_actual:              cph_actual,
      cph_contractual,
      dg_rh_per_day:           toNum(g(row, C.dg_rh_per_day)),
      pertes_en_litres:        toNum(g(row, C.pertes_litres)),
      pertes_en_xaf:           toNum(g(row, C.pertes_xaf)),
      dg_vs_hours:             toStr(g(row, C.dg_vs_hours)),
      grid_gen_percent:        toNum(g(row, C.grid_gen_pct)),
      reason_grid_gen_percent: toStr(g(row, C.reason_grid_gen)),
      automatization_status:   toStr(g(row, C.automatization)),
      ch_next_vidange:         toNum(g(row, C.ch_next_vidange)),
      hours_to_oil_change:     toNum(g(row, C.hours_to_oil_change)),
    },

    // PM parts
    pm_checks: {
      belt:               toNum(g(row, C.belt)),
      oil_filter:         toNum(g(row, C.oil_filter)),
      fuel_filter:        toNum(g(row, C.fuel_filter)),
      separ_filter:       toNum(g(row, C.separ_filter)),
      air_filter:         toNum(g(row, C.air_filter)),
      qty_oil_changed:    toNum(g(row, C.qty_oil_changed)),
      qty_radiator_water: toNum(g(row, C.qty_radiator_water)),
      dirty_oil:          toNum(g(row, C.dirty_oil)),
    },

    // Issues
    issues_found: {
      DG_Issues:       toStr(g(row, C.dg_issues)),
      IPT_BB_Issues:   toStr(g(row, C.ipt_bb_issues)),
      Issue_of_Aircon: toStr(g(row, C.aircon_issues)),
      Issue_of_Solar:  toStr(g(row, C.solar_issues)),
      Any_Other_Issue: toStr(g(row, C.other_issues)),
      Parts_Replaced:  toStr(g(row, C.parts_replaced)),
    },

    // Power cabinets & batteries
    power_systems: {
      power_cabinets,
      battery_threshold_dg_start: toNum(g(row, C.bat_threshold_dg)),
    },

    comments:  toStr(g(row, C.comments)),
    source:    'data_collector_excel',
  };
}

// ── BUG 1, 2 & 3 FIX: updateSiteGenerator ─────────────────────────────────────
async function updateSiteGenerator(site_id, gen1, uploadedById) {
  if (!gen1?.brand && !gen1?.serial_number) return false;

  const site = await Site.findOne({ IHS_ID_SITE: site_id })
    .select('Generators_Details Generator_Assignment_History')
    .lean();
  if (!site) return false;

  const existing = (site.Generators_Details || []).find(d => d.generator_number === 1);
  const swapped  = !!(existing?.serial_number && gen1.serial_number &&
                      existing.serial_number !== gen1.serial_number);

  const genUpdate = { generator_number: 1 };
  setIf(genUpdate, 'brand',                gen1.brand);
  setIf(genUpdate, 'serial_number',        gen1.serial_number);
  setIf(genUpdate, 'maintenance_cycle',    safeNum(gen1.maintenance_cycle));
  setIf(genUpdate, 'kva',                  safeNum(gen1.kva));
  setIf(genUpdate, 'dg_age',               safeNum(gen1.dg_age));
  setIf(genUpdate, 'actual_running_hours', safeNum(gen1.ch_actuel));
  setIf(genUpdate, 'last_running_hours',   safeNum(gen1.ch_ancien));
  setIf(genUpdate, 'run_hours',            safeNum(gen1.run_hours));
  if (gen1.cph_actual != null) genUpdate.cph = String(gen1.cph_actual);
  setIf(genUpdate, 'load_1ph',  safeNum(gen1.load_1ph));
  setIf(genUpdate, 'load_2ph',  safeNum(gen1.load_2ph));
  setIf(genUpdate, 'load_3ph',  safeNum(gen1.load_3ph));
  setIf(genUpdate, 'dc_load',   safeNum(gen1.dc_load));

  const updateOp = {};

  if (!existing) {
    updateOp.$push = { Generators_Details: genUpdate };
  } else {
    updateOp.$set = {};
    for (const [k, val] of Object.entries(genUpdate)) {
      if (k !== 'generator_number') {
        updateOp.$set[`Generators_Details.$.${k}`] = val;
      }
    }
  }

  if (swapped) {
    logger.info(`[GRATO] Generator swap on ${site_id}: ${existing.serial_number} → ${gen1.serial_number}`);
    const historyEntry = [
      { generator_id: existing.serial_number, removed_date: new Date(),
        assignment_type: 'primary', assigned_by: uploadedById, status: 'replaced' },
      { generator_id: gen1.serial_number, assigned_date: new Date(),
        assignment_type: 'primary', assigned_by: uploadedById, status: 'active' },
    ];
    updateOp.$push = updateOp.$push || {};
    updateOp.$push.Generator_Assignment_History = { $each: historyEntry };
  }

  try {
    if (existing) {
      await Site.updateOne(
        { IHS_ID_SITE: site_id, 'Generators_Details.generator_number': 1 },
        updateOp,
        { runValidators: false }
      );
    } else {
      await Site.updateOne(
        { IHS_ID_SITE: site_id },
        updateOp,
        { runValidators: false }
      );
    }
    return swapped;
  } catch (err) {
    logger.warn(`[GRATO] updateSiteGenerator failed for ${site_id}: ${err.message}`);
    return false;
  }
}

// ── BUG 1 FIX: updateSiteFromVisit ────────────────────────────────────────────
const TANK_TYPES   = ['INT', 'EXT', 'underground', 'surface', 'mobile'];
const FUEL_SQ_VALS = ['ok', 'OK', 'PROB'];
const ENEO_SQ_VALS = ['ok', 'OK', 'PROB'];
const ENEO_WORK    = ['YES', 'NO'];
const PHASE_TYPES  = ['TRI', 'Mono', 'single', 'three'];
const AUTO_VALS    = ['OK', 'NOK'];

async function updateSiteFromVisit(v, techUserId, uploadedById) {
  const $set = {};

  setIf($set, 'Actual_Date_Visit',   v.visit_date);
  setIf($set, 'Previous_Date_Visit', v.prev_visit_date);
  setIf($set, 'Type_of_Visit',       v.visit_type);
  setIf($set, 'Technician_Name',     v.technician_name);

  const fd = v.fuel_data;
  if (fd.qte_trouvee    != null) $set.Fuel_Quantity_Found    = fd.qte_trouvee;
  if (fd.qte_ajoutee    != null) $set.Fuel_Quantity_Added    = fd.qte_ajoutee;
  if (fd.qte_consommee  != null) $set.Fuel_Quantity_Consumed = fd.qte_consommee;
  if (fd.qte_precedente != null) $set.Previous_Fuel_Quantity = fd.qte_precedente;
  if (fd.tank_capacity  != null) $set.Tank_Capacity_1        = fd.tank_capacity;

  if (fd.tank_type && TANK_TYPES.includes(fd.tank_type))
    $set.Type_de_Tank = fd.tank_type;
  if (fd.fuel_sq_check && FUEL_SQ_VALS.includes(fd.fuel_sq_check))
    $set.Fuel_SQ_Check = fd.fuel_sq_check;

  const ed = v.electrical_data;
  if (ed.eneo_working && ENEO_WORK.includes(ed.eneo_working.toUpperCase()))
    $set.ENEO_Working = ed.eneo_working.toUpperCase();
  if (ed.eneo_sq_check && ENEO_SQ_VALS.includes(ed.eneo_sq_check))
    $set.ENEO_SQ_Check = ed.eneo_sq_check;
  if (ed.consumed_kwa != null) $set.Consumed_KWA = ed.consumed_kwa;
  if (ed.phase_type && PHASE_TYPES.includes(ed.phase_type))
    $set.Phase_Type = ed.phase_type;

  const cs = v.combined_stats;
  if (cs.automatization_status && AUTO_VALS.includes(cs.automatization_status))
    $set.Automatization_Status = cs.automatization_status;

  const visitHistoryEntry = {
    visit_id:               `VISIT_GRATO_${v.ihs_id}_${v.visit_date.getTime()}`,
    Actual_Date_Visit:      v.visit_date,
    Previous_Date_Visit:    v.prev_visit_date || null,
    Type_of_Visit:          v.visit_type,
    Technician_Name:        v.technician_name,
    technician_id:          techUserId || uploadedById,
    Fuel_Quantity_Found:    fd.qte_trouvee   ?? null,
    Fuel_Quantity_Added:    fd.qte_ajoutee   ?? null,
    Fuel_Quantity_Consumed: fd.qte_consommee ?? null,
    Generators_Details:     v.generators_checked,
    Issues_Found:           v.issues_found,
    Visit_Comments:         v.comments,
    submission_date:        new Date(),
    status:                 'submitted',
    submitted_by:           uploadedById,
  };

  try {
    await Site.findOneAndUpdate(
      { IHS_ID_SITE: v.ihs_id },
      {
        $set,
        $push: { visit_history: visitHistoryEntry },
      },
      {
        runValidators: false,
        new: false,
      }
    );
  } catch (err) {
    logger.warn(`[GRATO] updateSiteFromVisit failed for ${v.ihs_id}: ${err.message}`);
  }
}

// ── BUG 4 FIX: serialise errors for GratoUpload model ─────────────────────────
function serialiseErrors(errors) {
  return (errors || []).slice(0, 20).map(e => {
    if (typeof e === 'string') return e;
    return `${e.site || '?'} | ${e.date ? new Date(e.date).toISOString().slice(0, 10) : '?'} | ${e.error || e.message || JSON.stringify(e)}`;
  });
}

// ── BUG 5 & 6 FIX: buildMaintenancePayload ────────────────────────────────────
function buildMaintenancePayload(v, techUserId, supervisorId, uploadedById, ids) {
  const ed = v.electrical_data;

  const maintenance_id  = ids?.maintenance_id  || `MAINT_GRATO_${v.ihs_id}_${v.visit_date.getTime()}`;
  const visit_reference = ids?.visit_reference || `VISIT_GRATO_${v.ihs_id}_${v.visit_date.getTime()}`;

  const safeElectrical = {
    earthing_ohm:      safeNum(ed.earthing_ohm),
    eneo_working:      ed.eneo_working      || undefined,
    phase_type:        ed.phase_type        || undefined,
    n_ph1_voltage:     safeNum(ed.n_ph1_voltage),
    n_ph2_voltage:     safeNum(ed.n_ph2_voltage),
    n_ph3_voltage:     safeNum(ed.n_ph3_voltage),
    eneo_meter_number: ed.eneo_meter_number || undefined,
    eneo_sq_check:     ed.eneo_sq_check     || undefined,
    actual_index:      safeNum(ed.actual_index),
    previous_index:    safeNum(ed.previous_index),
    consumed_kwa:      safeNum(ed.consumed_kwa),
    comments_on_grid:  ed.comments_on_grid  || undefined,
  };
  Object.keys(safeElectrical).forEach(k => {
    if (safeElectrical[k] === undefined || safeElectrical[k] === null) {
      delete safeElectrical[k];
    }
  });

  const cabinets = v.power_systems?.power_cabinets || [];

  const safeTankType = (v.fuel_data.tank_type && TANK_TYPES.includes(v.fuel_data.tank_type))
    ? v.fuel_data.tank_type
    : undefined;

  return {
    maintenance_id,
    site_id:          v.ihs_id,
    site_name:        v.site_name,
    visit_reference,
    technician:       techUserId || uploadedById,
    technician_name:  v.technician_name,
    supervisor:       supervisorId,
    visit_type:       v.visit_type,
    visit_date:       v.visit_date,
    prev_visit_date:  v.prev_visit_date,
    hours_on_site:    v.hours_since_last,
    sbc:              v.sbc,

    site_metadata: {
      cluster:        v.cluster,
      site_priority:  v.site_priority,
      state:          v.region,
      operator:       v.operator,
      power_topology: v.power_topology,
      outdoor_indoor: v.outdoor_indoor,
    },

    electrical_data: safeElectrical,

    fuel_data: {
      tank_type:                 safeTankType,
      tank_capacity:             v.fuel_data.tank_capacity,
      tank_dimensions:           v.fuel_data.tank_dimensions,
      fond_de_cuve:              v.fuel_data.fond_de_cuve,
      fuel_sq_check:             v.fuel_data.fuel_sq_check    || undefined,
      qte_precedente:            v.fuel_data.qte_precedente,
      hauteur_gasoil_trouvee_cm: v.fuel_data.hauteur_gasoil_cm,
      qte_trouvee:               v.fuel_data.qte_trouvee,
      qte_laissee:               v.fuel_data.qte_laissee,
      qte_ajoutee:               v.fuel_data.qte_ajoutee,
      qte_consommee:             v.fuel_data.qte_consommee,
      tom_card_debit:            v.fuel_data.tom_card_debit_l,
    },

    generators_checked: v.generators_checked,
    combined_stats:     v.combined_stats,
    pm_checks:          v.pm_checks,

    power_systems: {
      power_cabinets:             [],
      battery_threshold_dg_start: v.power_systems?.battery_threshold_dg_start,
    },

    equipment_checks: {
      power_cabinet_info: cabinets,
      actual_index_raw:   ed.actual_index || null,
      tank_type_raw:       v.fuel_data.tank_type || null,
      site_id_raw_from_file: v.site_id_raw_from_file || null,
    },

    issues_found:   v.issues_found,
    work_performed: v.comments || '',

    source:        'data_collector_excel',
    status:        'approved',
    submitted_at:  new Date(),
    reviewed_at:   new Date(),
    reviewed_by:   uploadedById,
    priority:      'medium',
    created_by:    uploadedById,
  };
}

// ── Main import function ──────────────────────────────────────────────────────
async function importGratoExcel(fileBuffer, cycleKey, uploadedById) {
  const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['Daily PM Rapport'];
  if (!ws) throw new Error('Sheet "Daily PM Rapport" not found');

  const rawRows = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, raw: false,
    dateNF: 'yyyy-mm-dd hh:mm:ss',
  });

  const visits = [];
  for (let i = 12; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c == null || String(c).trim() === '')) continue;
    const v = parseRow(row);
    if (v) visits.push(v);
  }

  const summary = {
    total: visits.length,
    imported: 0,
    skipped: 0,
    errors: [],
    technician_links: 0,
    generator_swaps: 0,
  };

  const seenKeys = new Map();

  function buildUniqueIds(ihs_id, visit_date) {
    const baseKey = `${ihs_id}_${visit_date.getTime()}`;
    const count = seenKeys.get(baseKey) || 0;
    seenKeys.set(baseKey, count + 1);
    const suffix = count === 0 ? '' : `_${count + 1}`;
    return {
      maintenance_id:  `MAINT_GRATO_${baseKey}${suffix}`,
      visit_reference: `VISIT_GRATO_${baseKey}${suffix}`,
    };
  }

  for (const v of visits) {
    try {
      const techUser = await resolveTechnician(v.technician_name);
      if (techUser) summary.technician_links++;

      const t0 = new Date(v.visit_date.getTime() - 4 * 3600000);
      const t1 = new Date(v.visit_date.getTime() + 4 * 3600000);
      const dup = await Maintenance.findOne({
        site_id: v.ihs_id,
        visit_date: { $gte: t0, $lte: t1 },
        source: 'data_collector_excel',
        $or: [
          { technician_name: v.technician_name },
          ...(techUser ? [{ technician: techUser._id }] : []),
        ],
      }).select('_id').lean();
      if (dup) { summary.skipped++; continue; }

      await updateSiteFromVisit(v, techUser?._id, uploadedById);

      const swapped = await updateSiteGenerator(v.ihs_id, v.generators_checked[0], uploadedById);
      if (swapped) summary.generator_swaps++;

      const supervisorId = techUser?.supervisor || uploadedById;
      const { maintenance_id, visit_reference } = buildUniqueIds(v.ihs_id, v.visit_date);
      const payload = buildMaintenancePayload(v, techUser?._id, supervisorId, uploadedById, {
        maintenance_id,
        visit_reference,
      });

      const savedDoc = await Maintenance.create(payload);

      // Bridge to FieldVisitRecord so reconciliationService can see this
      // visit. Best-effort — a failure here must never block the import.
      setImmediate(async () => {
        try {
          await fieldVisitService.createFromMaintenanceDoc(
            savedDoc.toObject ? savedDoc.toObject() : savedDoc,
            { submitted_by: uploadedById }
          );
        } catch (fvErr) {
          logger.error(`[GRATO] FieldVisitRecord creation failed for ${v?.ihs_id}: ${fvErr.message}`);
        }
      });

      summary.imported++;
    } catch (err) {
      logger.error(`[GRATO] Row error ${v?.ihs_id} ${v?.visit_date}: ${err.message}`);
      summary.errors.push({ site: v?.ihs_id, date: v?.visit_date, error: err.message });
    }
  }

  logger.info(`[GRATO] Import done: ${summary.imported} imported, ` +
    `${summary.skipped} skipped, ${summary.generator_swaps} gen swaps, ` +
    `${summary.errors.length} errors`);
  return summary;
}

module.exports = {
  importGratoExcel,
  parseRow,
  getContractualCPH,
  CPH_TABLE,
  COLUMN_MAP: C,
  updateSiteGenerator,
  updateSiteFromVisit,
  buildMaintenancePayload,
  serialiseErrors,
  safeNum,
  normaliseSiteId,
  resolveTechnician,
  normaliseVisitType,
  normaliseCluster,
};




