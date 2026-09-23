/**
 * fieldVisitService.js
 * diesel-system/services/fieldVisitService.js
 *
 * THE MISSING WRITE PATH INTO FieldVisitRecord.
 *
 * Background:
 *   FieldVisitRecord was designed as the bridge between field data and the
 *   reconciliation engine. reconciliationService.js reads EXCLUSIVELY from
 *   FieldVisitRecord for all field-visit data (field_rh, fuel quantities,
 *   meter readings, theft flags, etc.) — but no code anywhere in the
 *   codebase ever WRITES to FieldVisitRecord. The collection is permanently
 *   empty, so reconciliation always falls back to CMS-only data for every
 *   site regardless of how much GRATO or technician data has been uploaded.
 *
 * This service provides two population paths:
 *
 *   1. createFromMaintenanceDoc(maintenanceDoc, opts)
 *      Called after gratoImportService.js creates/updates a Maintenance doc.
 *      Translates the GRATO-sourced Maintenance fields into a FieldVisitRecord.
 *      Upserts by (site_id + current_visit_date) so re-uploading the same
 *      GRATO file is idempotent.
 *
 *   2. createFromEquipmentChecks(maintenanceId, opts)
 *      Called after a technician submits equipment checks via the mobile app
 *      (PATCH /api/technician/maintenance/:id/equipment/generator and
 *      PATCH /api/technician/maintenance/:id/equipment/fuel_tank).
 *      Reads Maintenance.equipment_checks.generator_checks and
 *      Maintenance.equipment_checks.fuel_tank_checks, combines them into a
 *      FieldVisitRecord with source: 'app_entry'. Safe to call multiple times
 *      as checks are updated — upserts on the same (site_id + visit_date).
 *
 * CCPH resolution:
 *   FieldVisitRecord.ccph is required: true. Neither GRATO rows nor technician
 *   submissions always carry a known CCPH. Resolution order:
 *     a) combined_stats.cph_contractual from the Maintenance doc (GRATO rows
 *        have this from getContractualCPH(kva, totalRh) at parse time)
 *     b) SiteBudget.ccph for the site's cycle_key
 *     c) getContractualCPH(dg_kva, total_rh) calculated fresh
 *     d) 0 as a last resort (clearly wrong in reconciliation output, but at
 *        least doesn't break the required-field constraint silently)
 */

'use strict';

const FieldVisitRecord = require('../models/FieldVisitRecord');
const SiteBudget       = require('../models/SiteBudget');
const DieselCycle      = require('../models/DieselCycle');
const Maintenance      = require('../models/Maintenance');
const logger           = require('../utils/logger');

// Mirrors the CPH_TABLE in gratoImportService.js — kept here as a local
// copy so this service has no circular-require dependency on the importer.
const CPH_TABLE = [
  { kva_max: 9,    below_10k: 1.57, above_10k: 2.00 },
  { kva_max: 10,   below_10k: 1.70, above_10k: 2.00 },
  { kva_max: 12.5, below_10k: 1.80, above_10k: 2.10 },
  { kva_max: 13,   below_10k: 1.80, above_10k: 2.10 },
  { kva_max: 15,   below_10k: 1.90, above_10k: 2.25 },
  { kva_max: 17,   below_10k: 2.10, above_10k: 2.40 },
  { kva_max: 20,   below_10k: 2.30, above_10k: 2.50 },
  { kva_max: 22,   below_10k: 2.60, above_10k: 3.00 },
  { kva_max: 30,   below_10k: 3.50, above_10k: 4.50 },
  { kva_max: 45,   below_10k: 4.50, above_10k: 6.00 },
  { kva_max: 60,   below_10k: 4.50, above_10k: 6.00 },
];

function getContractualCPH(kva, totalRh) {
  if (!kva) return null;
  const entry = CPH_TABLE.find(e => kva <= e.kva_max) || CPH_TABLE[CPH_TABLE.length - 1];
  return (totalRh && totalRh >= 10000) ? entry.above_10k : entry.below_10k;
}

/**
 * Resolve CCPH for a site + cycle using the priority chain described in the
 * file header. Never returns null — falls back to 0 rather than break the
 * required-field constraint.
 */
async function resolveCCPH(site_id, cycle_key, kva, total_rh, fallback_from_doc) {
  if (fallback_from_doc != null && fallback_from_doc > 0) return fallback_from_doc;

  const budget = await SiteBudget.findOne({ site_id, cycle_key }).select('ccph').lean();
  if (budget?.ccph) return budget.ccph;

  const fromTable = getContractualCPH(kva, total_rh);
  if (fromTable) return fromTable;

  return 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Path 1: from a GRATO-imported Maintenance document
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create or update a FieldVisitRecord from a Maintenance document created
 * by gratoImportService.js (source: 'data_collector_excel' or
 * 'validation_template_main').
 *
 * Upserts on (site_id, current_visit_date) so calling this multiple times
 * for the same visit (e.g. re-uploading the same GRATO file) is safe.
 *
 * @param {Object} maintenanceDoc - a lean() or toObject() Maintenance doc
 * @param {Object} opts
 * @param {string} [opts.grato_upload_id] - the GratoUpload._id for audit
 * @param {string} [opts.submitted_by]    - the uploader's User._id
 * @returns {Object} the upserted FieldVisitRecord
 */
async function createFromMaintenanceDoc(maintenanceDoc, opts = {}) {
  const m = maintenanceDoc;
  if (!m?.site_id || !m?.visit_date) {
    throw new Error('createFromMaintenanceDoc: maintenanceDoc must have site_id and visit_date');
  }

  const visit_date = new Date(m.visit_date);
  const cycle_key  = DieselCycle.getCycleKeyForDate(visit_date);

  // Generator data from generators_checked[0]
  const gen = (m.generators_checked || [])[0] || {};

  // Meter readings — respect the faulty flag already computed by gratoImportService
  const meter_is_faulty = !!(gen.meter_faulty);
  const prev_meter      = gen.ch_ancien ?? null;
  const current_meter   = gen.ch_actuel ?? null;

  // field_rh: inter-visit delta from the Maintenance row's own combined_stats
  // (gratoImportService already computed this as total_run_hour)
  const field_rh = meter_is_faulty ? null : (m.combined_stats?.total_run_hour ?? gen.run_hours ?? null);

  // CCPH resolution
  const ccph = await resolveCCPH(
    m.site_id,
    cycle_key,
    gen.kva,
    current_meter,
    m.combined_stats?.cph_contractual || gen.cph_contractual
  );

  // Fuel data from fuel_data subdoc
  const fd = m.fuel_data || {};
  const fuel_qty_found  = fd.qte_trouvee    ?? null;
  const fuel_qty_added  = fd.qte_ajoutee    ?? null;
  const fuel_qty_left   = fd.qte_laissee    ?? null;
  const qty_consumed    = fd.qte_consommee  ?? null;

  // Contractual consumption for this visit segment
  const fuel_consumption = (field_rh != null && ccph > 0) ? field_rh * ccph : null;

  const doc = {
    site_id:    m.site_id,
    site_name:  m.site_name,
    cluster:    m.site_metadata?.cluster || m.cluster,
    region:     m.site_metadata?.state   || m.region,
    sbc:        m.sbc,
    cycle_key,
    visit_cycle_attribution: cycle_key,

    prev_visit_date:    m.prev_visit_date ? new Date(m.prev_visit_date) : null,
    current_visit_date: visit_date,
    nbr_days:           m.combined_stats?.dg_rh_per_day
                          ? undefined  // not nbr_days — let it be computed
                          : null,

    // Generator
    dg_kva:          gen.kva    ?? null,
    generator_brand: gen.brand  ?? null,
    ccph,
    prev_meter,
    current_meter,
    meter_is_faulty,
    field_rh,
    final_rh:        meter_is_faulty ? null : field_rh,
    rh_per_day:      m.combined_stats?.dg_rh_per_day ?? null,
    generator_comment: m.combined_stats?.dg_vs_hours ?? null,

    // Fuel
    fuel_qty_found,
    fuel_qty_added,
    fuel_qty_left,
    fuel_consumption,
    qty_consumed_actual: qty_consumed,
    theft_l:        m.equipment_checks?.gap_cph_variation ?? null, // from Validation template extra

    // Load
    gen_ac_load_1ph:  gen.load_1ph ?? null,
    gen_ac_load_2ph:  gen.load_2ph ?? null,
    gen_ac_load_3ph:  gen.load_3ph ?? null,
    dc_load_variation: gen.dc_load ?? null,
    load_comment:     m.issues_found?.Any_Other_Issue ?? null,

    // Topology
    functional_topology: m.site_metadata?.power_topology ?? null,

    // Submission
    source:          'grato_upload',
    submitted_by:    opts.submitted_by   || m.created_by || null,
    grato_upload_id: opts.grato_upload_id || null,
    reconciliation_status: 'pending',
  };

  // Strip undefined/null to avoid overwriting existing values with null on upsert
  Object.keys(doc).forEach(k => { if (doc[k] === undefined) delete doc[k]; });

  const record = await FieldVisitRecord.findOneAndUpdate(
    { site_id: m.site_id, current_visit_date: visit_date },
    { $set: doc, $setOnInsert: { site_id: m.site_id, current_visit_date: visit_date } },
    { upsert: true, new: true, runValidators: true }
  );

  logger.info(`[FieldVisit] Upserted from GRATO doc: ${m.site_id} @ ${visit_date.toISOString().slice(0,10)}`);
  return record;
}

// ────────────────────────────────────────────────────────────────────────────
// Path 2: from technician mobile app equipment check submission
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create or update a FieldVisitRecord from a technician's mobile-app
 * equipment check submission. Reads Maintenance.equipment_checks.
 * generator_checks and .fuel_tank_checks and maps them into FieldVisitRecord.
 *
 * Called from technicianRoutes.js after:
 *   - PATCH /maintenance/:id/equipment/generator
 *   - PATCH /maintenance/:id/equipment/fuel_tank
 *   - POST  /maintenance/:id/submit
 *
 * Safe to call multiple times as checks are updated — upserts on
 * (site_id, current_visit_date) same as the GRATO path.
 *
 * @param {string|ObjectId} maintenanceId
 * @param {Object} opts
 * @param {string} [opts.submitted_by] - the technician's User._id
 * @returns {Object|null} the upserted FieldVisitRecord, or null if the
 *   Maintenance doc doesn't have enough data to create a meaningful record
 */
async function createFromEquipmentChecks(maintenanceId, opts = {}) {
  const m = await Maintenance.findById(maintenanceId).lean();
  if (!m) {
    logger.warn(`[FieldVisit] createFromEquipmentChecks: Maintenance ${maintenanceId} not found`);
    return null;
  }

  // We need at least a visit_date to create a FieldVisitRecord
  const visit_date = m.visit_date ? new Date(m.visit_date) : null;
  if (!visit_date || !m.site_id) {
    logger.warn(`[FieldVisit] createFromEquipmentChecks: ${maintenanceId} missing site_id or visit_date`);
    return null;
  }

  const cycle_key = DieselCycle.getCycleKeyForDate(visit_date);
  const checks    = m.equipment_checks || {};

  // ── Generator data from equipment_checks.generator_checks ─────────────────
  // generator_checks is stored as an object (single generator per visit in
  // the technician app's current schema), not an array — see technicianRoutes.js
  const genCheck = Array.isArray(checks.generator_checks)
    ? checks.generator_checks[0]   // handles both shapes safely
    : checks.generator_checks;

  const runningHours     = genCheck?.running_hours    != null ? parseFloat(genCheck.running_hours)    : null;
  const openingHours     = genCheck?.opening_hours    != null ? parseFloat(genCheck.opening_hours)    : null;
  const closingHours     = genCheck?.closing_hours    != null ? parseFloat(genCheck.closing_hours)    : null;

  // field_rh: technician records current running hours in 'running_hours'.
  // If both opening_hours and closing_hours exist, derive delta from those;
  // otherwise use running_hours directly as the inter-visit delta (same
  // convention as gratoImportService.js's run_hours field).
  let field_rh = null;
  if (openingHours != null && closingHours != null) {
    field_rh = Math.max(0, closingHours - openingHours);
  } else if (runningHours != null && runningHours > 0) {
    field_rh = runningHours;
  }

  // Meter readings not directly captured on the mobile check form —
  // flag them as null (not faulty, just not submitted via this path)
  const meter_is_faulty = false;

  // KVA: not directly on the check, but may be on Maintenance.generators_checked
  const gen0   = (m.generators_checked || [])[0] || {};
  const dg_kva = gen0.kva ?? null;

  const ccph = await resolveCCPH(
    m.site_id,
    cycle_key,
    dg_kva,
    closingHours,    // use cumulative hours as the "total RH" proxy for CPH_TABLE lookup
    gen0.cph_contractual
  );

  const fuel_consumption = (field_rh != null && ccph > 0) ? field_rh * ccph : null;

  // ── Fuel data from equipment_checks.fuel_tank_checks ─────────────────────
  const fuelCheck = checks.fuel_tank_checks || {};

  const fuel_qty_found = fuelCheck.closing_level != null
    ? parseFloat(fuelCheck.closing_level) : null;
  const fuel_qty_added = fuelCheck.fuel_added != null
    ? parseFloat(fuelCheck.fuel_added) : null;
  // opening_level is what was there BEFORE this refuel = fuel_found at start of visit
  const fuel_qty_previously = fuelCheck.opening_level != null
    ? parseFloat(fuelCheck.opening_level) : null;
  // fuel left = closing_level (what's in the tank after refuel)
  const fuel_qty_left = fuel_qty_found;
  const qty_consumed_actual = fuelCheck.fuel_consumed != null
    ? parseFloat(fuelCheck.fuel_consumed)
    : (fuel_qty_previously != null && fuel_qty_added != null && fuel_qty_left != null)
      ? Math.max(0, fuel_qty_previously + fuel_qty_added - fuel_qty_left)
      : null;

  const doc = {
    site_id:    m.site_id,
    site_name:  m.site_name,
    cluster:    m.site_metadata?.cluster || null,
    region:     m.site_metadata?.state   || null,
    sbc:        m.sbc || null,
    cycle_key,
    visit_cycle_attribution: cycle_key,

    current_visit_date: visit_date,
    prev_visit_date:    m.prev_visit_date ? new Date(m.prev_visit_date) : null,

    // Generator
    dg_kva,
    generator_brand: gen0.brand || null,
    ccph,
    meter_is_faulty,
    field_rh,
    final_rh:    field_rh,

    // Fuel
    fuel_qty_previously,
    fuel_qty_found,
    fuel_qty_added,
    fuel_qty_left,
    fuel_consumption,
    qty_consumed_actual,

    // Source
    source:       'app_entry',
    submitted_by: opts.submitted_by || m.created_by || null,
    reconciliation_status: 'pending',
  };

  Object.keys(doc).forEach(k => { if (doc[k] === undefined || doc[k] === null) delete doc[k]; });

  // Guard: don't create an almost-empty record with just site_id + date and
  // nothing useful. Require at least ONE of field_rh or fuel_qty_added to be
  // a real number, otherwise this visit hasn't provided any data reconciliation
  // can use and we should wait until more checks are submitted.
  if (field_rh == null && fuel_qty_added == null) {
    logger.info(`[FieldVisit] createFromEquipmentChecks: ${m.site_id} has no usable RH or fuel data yet — skipping`);
    return null;
  }

  const record = await FieldVisitRecord.findOneAndUpdate(
    { site_id: m.site_id, current_visit_date: visit_date },
    { $set: doc, $setOnInsert: { site_id: m.site_id, current_visit_date: visit_date } },
    { upsert: true, new: true, runValidators: true }
  );

  logger.info(`[FieldVisit] Upserted from app checks: ${m.site_id} @ ${visit_date.toISOString().slice(0,10)} (field_rh=${field_rh}, fuel_added=${fuel_qty_added})`);
  return record;
}

// ────────────────────────────────────────────────────────────────────────────
// Backfill: populate FieldVisitRecord from existing Maintenance documents
// ────────────────────────────────────────────────────────────────────────────

/**
 * One-time (or idempotent re-runnable) backfill: create FieldVisitRecord
 * documents from every existing Maintenance doc with
 * source: 'data_collector_excel' or 'validation_template_main'.
 *
 * Called from scripts/backfillFieldVisitRecords.js, or can be triggered
 * manually from a route. Never throws — logs errors per doc and continues.
 *
 * @param {string} [cycle_key] optional: limit to one cycle's visit_dates
 * @returns {{ created: number, skipped: number, errors: number }}
 */
async function backfillFromMaintenance(cycle_key = null) {
  const filter = {
    source: { $in: ['data_collector_excel', 'validation_template_main'] },
    visit_date: { $exists: true },
  };

  // If cycle_key provided, restrict to that cycle's date window
  if (cycle_key) {
    const cycleDoc = await DieselCycle.findOne({ cycle_key }).lean();
    if (!cycleDoc) throw new Error(`No DieselCycle found for ${cycle_key}`);
    filter.visit_date = { $gte: cycleDoc.start_date, $lte: cycleDoc.end_date };
  }

  const total = await Maintenance.countDocuments(filter);
  logger.info(`[FieldVisit Backfill] Processing ${total} Maintenance docs…`);

  let created = 0, skipped = 0, errors = 0;
  const cursor = Maintenance.find(filter).lean().cursor();

  for await (const doc of cursor) {
    try {
      // Check if a FieldVisitRecord already exists for this exact visit
      const existing = await FieldVisitRecord.findOne({
        site_id:            doc.site_id,
        current_visit_date: doc.visit_date,
        source:             'grato_upload',
      }).select('_id').lean();

      if (existing) { skipped++; continue; }

      await createFromMaintenanceDoc(doc, {});
      created++;
    } catch (err) {
      errors++;
      logger.error(`[FieldVisit Backfill] Error for ${doc.site_id} @ ${doc.visit_date}: ${err.message}`);
    }
  }

  logger.info(`[FieldVisit Backfill] Done: ${created} created, ${skipped} skipped, ${errors} errors`);
  return { created, skipped, errors };
}

module.exports = {
  createFromMaintenanceDoc,
  createFromEquipmentChecks,
  backfillFromMaintenance,
  resolveCCPH,
  getContractualCPH,
};