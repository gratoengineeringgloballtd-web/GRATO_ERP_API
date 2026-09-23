/**
 * reconciliationService.js
 * THE CORE ENGINE.
 *
 * Called after every upload. For each site in a cycle:
 *   1. Pull SiteBudget (CCPH, budgeted_rh, grid_target)
 *   2. Pull GeneratorAssignmentLedger segments (handles mid-cycle swaps)
 *   3. Pull CmsDailyRecord aggregates (CMS RH, consumption, refuel, grid hours)
 *   4. Pull FieldVisitRecord aggregates (field RH, fuel added/found/left, theft)
 *   5. Fill CMS-fallback RH for faulty meters
 *   6. Calculate all variances
 *   7. Apply PM (maintenance) patches as a secondary RH source (best-effort)
 *   8. Set alert flags
 *   9. Upsert CycleReconciliation
 *  10. Call alertService to create DieselAlert docs
 */

const CycleReconciliation      = require('../models/CycleReconciliation');
const CmsDailyRecord           = require('../models/CmsDailyRecord');
const FieldVisitRecord         = require('../models/FieldVisitRecord');
const FuelConsumption           = require('../models/FuelConsumption');
const SiteBudget                = require('../models/SiteBudget');
const Site                      = require('../models/Site');
const TomCardTransaction        = require('../models/TomCardTransaction');
const GeneratorAssignmentLedger = require('../models/GeneratorAssignmentLedger');
const DieselCycle                = require('../models/DieselCycle');
const alertService               = require('./alertService');
const logger                     = require('../utils/logger');
const pmService                  = require('./pmIntegrationService');

// ── Thresholds (change here when you have confirmed values) ─────────────────
const THRESHOLDS = {
  FUEL_LEVEL_LOW_PCT:        25,   // % of tank capacity (site-specific — see reconcileSite step 12)
  FUEL_LEVEL_LOW_FALLBACK_L: 500,  // absolute-liters fallback ONLY for sites with no tank_capacity on file
  CONS_OVER_CCPH_TOLERANCE:  0.10, // 10% over CCPH triggers alert
  REFUEL_MISMATCH_LITERS:    50,   // L difference triggers alert
  RH_MISMATCH_PCT:           0.05, // 5% RH difference triggers alert
  THEFT_MIN_LITERS:          50,   // minimum gap to flag as theft suspected
  MISSING_GRATO_GRACE_DAYS:  10,   // days into cycle before missing GRATO alert
  MISSING_CMS_DAYS:          3,    // consecutive missing CMS days before alert
  PM_RH_FAULTY_VARIANCE_PCT: 0.15, // 15% variance between CMS RH and PM RH flags faulty meter
};

/**
 * Run reconciliation for all sites in a cycle.
 * @param {string} cycleKey  - e.g. "2026-05"
 * @param {string|null} siteId - optional: reconcile only one site
 */
async function runForCycle(cycleKey, siteId = null) {
  const startTime = Date.now();
  logger.info(`[Reconciliation] Starting cycle=${cycleKey} site=${siteId || 'ALL'}`);

  // Get cycle dates
  const cycle = await DieselCycle.findOne({ cycle_key: cycleKey });
  if (!cycle) {
    // FIX: this used to `return { error: 'Cycle not found', cycleKey }`,
    // which the route (routes/reconciliationRoutes.js) still wrapped in
    // `res.json({ success: true, ... })` — meaning the API reported
    // success while having silently done NOTHING. A user clicking
    // "Reconcile" for a cycle with no DieselCycle record would see no
    // error at all, just unchanged dashboard numbers, with zero way to
    // tell that from "ran correctly and found nothing to reconcile".
    // Throwing here makes the route return a real error the frontend can
    // actually show.
    logger.warn(`[Reconciliation] No cycle found for key ${cycleKey}`);
    const err = new Error(`No cycle record exists for "${cycleKey}" — create the cycle before reconciling it.`);
    err.statusCode = 404;
    throw err;
  }

  const { start_date, end_date, days_in_cycle } = cycle;

  // Collect all site IDs that have any data for this cycle
  const siteQuery = siteId ? { cycle_key: cycleKey, site_id: siteId } : { cycle_key: cycleKey };
  const [budgetSites, cmsSites, gratoSites] = await Promise.all([
    SiteBudget.distinct('site_id', siteQuery),
    CmsDailyRecord.distinct('site_id', siteQuery),
    FieldVisitRecord.distinct('site_id', siteQuery),
  ]);

  const allSites = [...new Set([...budgetSites, ...cmsSites, ...gratoSites])];
  logger.info(`[Reconciliation] Processing ${allSites.length} sites`);

  let processed = 0, errors = 0;

  for (const site of allSites) {
    try {
      await reconcileSite(site, cycleKey, cycle, days_in_cycle, start_date, end_date);
      processed++;
    } catch (err) {
      errors++;
      logger.error(`[Reconciliation] Error for site ${site}: ${err.message}`);
    }
  }

  const ms = Date.now() - startTime;
  logger.info(`[Reconciliation] Done: ${processed} ok, ${errors} errors, ${ms}ms`);
  return { processed, errors, ms, cycleKey };
}

/**
 * Apply PM (maintenance) integration patches as a best-effort secondary
 * RH source. Never throws — PM integration failures must not block
 * the core reconciliation pipeline.
 *
 * Mutates and returns reconDoc. Call this AFTER all core RH/consumption
 * fields are set, and BEFORE alert flags are computed, so that any
 * patched RH/consumption values are reflected in the alerts.
 *
 * @param {object} reconDoc   - the in-progress reconciliation doc
 * @param {Date}   cycleStart
 * @param {Date}   cycleEnd
 * @param {object} ctx        - { budget, ccph } extra context needed for recompute
 */
async function applyPMPatches(reconDoc, cycleStart, cycleEnd, ctx = {}) {
  try {
    const patches = await pmService.validateAndPatch(reconDoc, cycleStart, cycleEnd);

    if (!patches || Object.keys(patches).length === 0) {
      reconDoc.pm_patch_applied = false;
      return reconDoc;
    }

    // Merge patches into the reconDoc
    Object.assign(reconDoc, patches);
    reconDoc.pm_patch_applied = true;
    reconDoc.pm_patch_fields  = Object.keys(patches);

    // ── Case 1: PM supplied RH because CMS/GRATO RH was missing ─────────────
    if (patches.rh_source === 'pm_records') {
      const ccph = ctx.ccph || 0;

      // Recompute contractual consumption from the PM-derived RH
      if (ccph > 0 && reconDoc.final_rh !== null && reconDoc.final_rh !== undefined) {
        reconDoc.contractual_consumption = reconDoc.final_rh * ccph;
      }

      const fieldCons = reconDoc.field_consumption_actual;
      if (fieldCons !== null && fieldCons !== undefined && reconDoc.contractual_consumption > 0) {
        reconDoc.cons_variance     = fieldCons - reconDoc.contractual_consumption;
        reconDoc.cons_variance_pct = reconDoc.cons_variance / reconDoc.contractual_consumption;
        reconDoc.cons_status       = reconDoc.cons_variance > 0 ? 'over'
                                    : reconDoc.cons_variance < 0 ? 'under'
                                    : 'ok';
      } else {
        reconDoc.cons_variance     = null;
        reconDoc.cons_variance_pct = null;
        reconDoc.cons_status       = 'unknown';
      }
    }

    // ── Case 2: CMS present but PM RH disagrees significantly ──────────────
    if (patches.pm_rh !== undefined && reconDoc.cms_rh) {
      const cmsRH = reconDoc.cms_rh;
      const pmRH  = patches.pm_rh;
      if (cmsRH > 0 && pmRH !== null && pmRH !== undefined) {
        const pmVariancePct = Math.abs(cmsRH - pmRH) / cmsRH;
        reconDoc.pm_rh_variance_pct = pmVariancePct;
        if (pmVariancePct > THRESHOLDS.PM_RH_FAULTY_VARIANCE_PCT) {
          reconDoc.faulty_meter_days = (reconDoc.faulty_meter_days || 0) + 1;
          // Ensure the flag gets reflected even though `alerts` is built
          // separately in reconcileSite — set a marker the alert block reads.
          reconDoc._pm_faulty_meter_flag = true;
        }
      }
    }

    return reconDoc;

  } catch (err) {
    // PM integration is best-effort — never block reconciliation
    logger.error(`[pmIntegration] validateAndPatch failed for ${reconDoc.site_id}: ${err.message}`);
    reconDoc.pm_patch_applied = false;
    reconDoc.pm_patch_error   = err.message;
    return reconDoc;
  }
}

/**
 * Reconcile a single site for a cycle. The full calculation pipeline.
 */
async function reconcileSite(siteId, cycleKey, cycle, daysInCycle, startDate, endDate) {
  // ── 1. Budget baseline ─────────────────────────────────────────────────────
  const budget = await SiteBudget.findOne({ site_id: siteId, cycle_key: cycleKey }).lean();

  // Tank capacity — needed for a site-specific low-fuel threshold (see step 12).
  // Sourced from Site.Tank_Capacity_1, the real schema field (not the
  // non-existent "Tank_Capacity" name used elsewhere before this fix).
  const siteAsset = await Site.findOne({ IHS_ID_SITE: siteId }).select('Tank_Capacity_1').lean();
  const tankCapacityL = siteAsset?.Tank_Capacity_1 || null;

  // ── 2. Generator assignment segments (handles mid-cycle swap) ──────────────
  const segments = await GeneratorAssignmentLedger.getSegmentsForPeriod(siteId, startDate, endDate);
  const activeGen = segments.find(s => s.is_active) || segments[segments.length - 1] || null;
  const hadSwap   = segments.length > 1;

  // ── 3. CMS daily aggregates ────────────────────────────────────────────────
  const cmsData  = await CmsDailyRecord.getCycleFuelStats(siteId, startDate, endDate);
  const cmsRH    = await CmsDailyRecord.getCycleGenRH(siteId, startDate, endDate);

  // Latest CMS record for current fuel level
  const latestCms = await CmsDailyRecord
    .findOne({ site_id: siteId, cycle_key: cycleKey })
    .sort({ record_date: -1 })
    .lean();

  // Zero-grid max streak in this cycle
  const maxStreakDoc = await CmsDailyRecord
    .findOne({ site_id: siteId, cycle_key: cycleKey })
    .sort({ consecutive_zero_grid_hours: -1 })
    .select('consecutive_zero_grid_hours')
    .lean();
  const zeroGridMaxStreak = maxStreakDoc?.consecutive_zero_grid_hours || 0;

  // Grid availability hours total
  const gridAggResult = await CmsDailyRecord.aggregate([
    { $match: { site_id: siteId, cycle_key: cycleKey } },
    { $group: { _id: null, total_grid_h: { $sum: '$grid_availability_hr' }, days: { $sum: 1 } } },
  ]);
  const totalGridH = gridAggResult[0]?.total_grid_h || 0;
  const cmsDaysCovered = gridAggResult[0]?.days || 0;
  const totalPossibleH = cmsDaysCovered * 24;
  const gridAvailActual = totalPossibleH > 0 ? totalGridH / totalPossibleH : null;

  // ── 4. Field visit aggregates ─────────────────────────────────────────────
  const visits = await FieldVisitRecord.find({ site_id: siteId, cycle_key: cycleKey })
    .sort({ current_visit_date: 1 })
    .lean();

  const visitCount    = visits.length;
  const hasGrato      = visitCount > 0;
  let fieldRH         = 0;
  let faultyMeterDays = 0;
  let totalFuelAdded  = 0;
  let lastFuelFound   = null;
  let lastFuelLeft    = null;
  let totalGapCPH     = 0;
  let totalTheft       = 0;

  for (const v of visits) {
    if (v.meter_is_faulty) {
      faultyMeterDays++;
      // Fill CMS fallback: get CMS gen_rh for the nbr_days window of this visit
      if (v.nbr_days && cmsRH.total_gen_rh > 0) {
        const dailyGenRH = cmsRH.total_gen_rh / (cmsRH.days || 1);
        const fallback   = dailyGenRH * (v.nbr_days || 1);
        fieldRH += fallback;
        // Write back to FieldVisitRecord
        await FieldVisitRecord.findByIdAndUpdate(v._id, {
          cms_rh_fallback: fallback,
          final_rh: fallback,
          reconciliation_status: 'reconciled',
        });
      }
    } else {
      fieldRH += v.final_rh || v.field_rh || 0;
    }
    totalFuelAdded += v.fuel_qty_added || 0;
    if (v.fuel_qty_found !== null && v.fuel_qty_found !== undefined) lastFuelFound = v.fuel_qty_found;
    if (v.fuel_qty_left  !== null && v.fuel_qty_left  !== undefined) lastFuelLeft  = v.fuel_qty_left;
    totalGapCPH  += v.gap_cph_variation || 0;
    totalTheft   += v.theft_l || 0;
  }

  // First visit fuel found (cycle-opening stock)
  const firstFuelFound = visits[0]?.fuel_qty_found || null;

  // ── 4b. Fuel added via the mobile app's refuel workflow ────────────────────
  // FuelConsumption records are created when a technician completes an
  // actual refuel through the mobile app (fuel request → approval →
  // purchase → refuel). Previously NEVER queried anywhere in this file —
  // field_fuel_added only ever reflected periodic bulk GRATO Excel visits,
  // so a site refueled exclusively through the mobile workflow (the
  // primary, real-time path this whole system is built around) always
  // showed 0 fuel added in reconciliation, no matter how many real
  // refuels happened or how many times reconciliation ran.
  let fuelAddedFromMobileRefuels = 0;
  try {
    const mobileRefuels = await FuelConsumption.find({
      site_id: siteId,
      record_date: { $gte: startDate, $lte: endDate },
    }).select('fuel_data.fuel_added').lean();
    fuelAddedFromMobileRefuels = mobileRefuels.reduce((s, r) => s + (r.fuel_data?.fuel_added || 0), 0);
  } catch (fcErr) {
    // Non-fatal — a lookup failure here must not block reconciliation;
    // field_fuel_added just falls back to GRATO-only for this site/run.
    logger.error(`[Reconciliation] FuelConsumption lookup failed for ${siteId}: ${fcErr.message}`);
  }

  const fuelAddedFromGratoVisits = totalFuelAdded;
  // Summed, not replaced: a GRATO field visit and a mobile-app refuel
  // represent different kinds of events (a routine observation vs. an
  // actual delivery), so both can legitimately have happened in the same
  // cycle and should both count toward total fuel added.
  totalFuelAdded += fuelAddedFromMobileRefuels;

  // Actual consumption: opening stock + all added - closing stock
  const fieldConsumptionActual = (firstFuelFound !== null && lastFuelLeft !== null)
    ? (firstFuelFound + totalFuelAdded - lastFuelLeft)
    : null;

  // ── 5. Final RH decision ──────────────────────────────────────────────────
  // Use field RH if we have GRATO data, else fall back to CMS
  const finalRH    = hasGrato ? fieldRH : cmsRH.total_gen_rh;
  const cmsRHTotal = cmsRH.total_gen_rh;

  // RH variance
  const rhVariance    = (hasGrato && cmsRHTotal > 0) ? (cmsRHTotal - fieldRH) : null;
  const rhVariancePct = (rhVariance !== null && fieldRH > 0) ? (rhVariance / fieldRH) : null;

  // ── 6. Contractual consumption (with mid-cycle swap handling) ─────────────
  let contractualConsumption = 0;
  const swapSegments = [];

  if (hadSwap && segments.length > 0) {
    for (const seg of segments) {
      const segStart = seg.assigned_at > startDate ? seg.assigned_at : startDate;
      const segEnd   = (seg.removed_at && seg.removed_at < endDate) ? seg.removed_at : endDate;
      const segDays  = Math.max(0, (segEnd - segStart) / (1000 * 60 * 60 * 24));

      // Pro-rate gen RH for this segment
      const totalDays    = Math.max(1, (endDate - startDate) / (1000 * 60 * 60 * 24));
      const segRHShare   = finalRH * (segDays / totalDays);
      const segCons      = segRHShare * (seg.ccph || budget?.ccph || 0);

      contractualConsumption += segCons;
      swapSegments.push({
        generator_id:           seg.generator_id,
        ccph:                   seg.ccph || budget?.ccph,
        from_date:              segStart,
        to_date:                segEnd,
        rh_in_segment:          segRHShare,
        consumption_in_segment: segCons,
      });
    }
  } else {
    const ccph = activeGen?.ccph || budget?.ccph || 0;
    contractualConsumption = finalRH * ccph;
  }

  // ── 7. Tom Card totals ────────────────────────────────────────────────────
  const tcResult = await TomCardTransaction.aggregate([
    { $match: { cycle_key: cycleKey, site_id: siteId, reconciled: false } },
    { $group: { _id: null, total: { $sum: '$quantity_l' } } },
  ]);
  // Also try cluster-level match if no site match
  let tomcardPurchased = tcResult[0]?.total || null;

  // ── 8. Variances ──────────────────────────────────────────────────────────
  const ccph            = activeGen?.ccph || budget?.ccph || 0;
  const consVariance    = fieldConsumptionActual !== null ? fieldConsumptionActual - contractualConsumption : null;
  const consVariancePct = (consVariance !== null && contractualConsumption > 0)
    ? consVariance / contractualConsumption : null;
  const consStatus = consVariance === null ? 'unknown'
    : consVariance > 0 ? 'over' : consVariance < 0 ? 'under' : 'ok';

  const refuelFieldCmsVar  = cmsData.total_refuel > 0
    ? totalFuelAdded - cmsData.total_refuel : null;
  const refuelStatus = refuelFieldCmsVar === null ? 'no_cms_data'
    : Math.abs(refuelFieldCmsVar) <= THRESHOLDS.REFUEL_MISMATCH_LITERS ? 'ok' : 'discrepancy';

  const refuelFieldCardVar = tomcardPurchased !== null
    ? totalFuelAdded - tomcardPurchased : null;

  // ── 9. Current fuel level ─────────────────────────────────────────────────
  const tankCapacity     = latestCms?.fuel_level_l || null;
  const currentFuelLevel = latestCms?.fuel_level_l || null;

  // ── 10. Build the reconciliation doc (pre-PM-patch, pre-alerts) ──────────
  const daysSinceCycleStart = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24));

  const reconDoc = {
    site_id:    siteId,
    site_name:  budget?.site_name || visits[0]?.site_name || latestCms?.site_id,
    cluster:    budget?.cluster   || visits[0]?.cluster,
    region:     budget?.region    || visits[0]?.region,
    cycle_key:  cycleKey,
    cycle_id:   cycle._id,

    // Budget
    dg_kva:            budget?.dg_kva,
    ccph:              ccph,
    budgeted_rh:       budget?.budgeted_rh,
    budget_liters:     budget?.budget_liters,
    grid_avail_target: budget?.final_grid_availability,
    topology:          budget?.topology || latestCms?.power_topology,
    is_fueling_site:   budget?.is_fueling_site || false,

    // Generator
    generator_id:       activeGen?.generator_id,
    generator_brand:    activeGen?.generator_brand,
    had_mid_cycle_swap: hadSwap,
    swap_segments:      hadSwap ? swapSegments : [],

    // RH
    field_rh:          fieldRH,
    cms_rh:            cmsRHTotal,
    final_rh:          finalRH,
    rh_source:         hasGrato ? 'field_grato' : (cmsRHTotal > 0 ? 'cms' : 'none'),
    faulty_meter_days: faultyMeterDays,
    rh_variance:       rhVariance,
    rh_variance_pct:   rhVariancePct,

    // Fuel
    contractual_consumption:  contractualConsumption,
    cms_consumption:          cmsData.total_consumed,
    cms_refuel_total:         cmsData.total_refuel,
    field_fuel_found:         firstFuelFound,
    field_fuel_added:         totalFuelAdded,
    field_added_from_grato_visits:   fuelAddedFromGratoVisits,
    field_added_from_mobile_refuels: fuelAddedFromMobileRefuels,
    field_fuel_left:          lastFuelLeft,
    field_consumption_actual: fieldConsumptionActual,
    field_visits_count:       visitCount,
    tomcard_purchased:        tomcardPurchased,

    // Variances
    cons_variance:            consVariance,
    cons_variance_pct:        consVariancePct,
    cons_status:              consStatus,
    refuel_field_vs_cms_var:  refuelFieldCmsVar,
    refuel_status:            refuelStatus,
    refuel_field_vs_card_var: refuelFieldCardVar,
    card_reconciled:          refuelFieldCardVar !== null && Math.abs(refuelFieldCardVar) <= THRESHOLDS.REFUEL_MISMATCH_LITERS,

    // Theft
    gap_cph_variation: totalGapCPH,
    theft_detected:    totalTheft > 0,
    theft_liters:      totalTheft,

    // Grid
    grid_avail_actual:    gridAvailActual,
    grid_avail_hours:     totalGridH,
    zero_grid_max_streak: zeroGridMaxStreak,
    zero_grid_alert:      zeroGridMaxStreak >= 24,

    // Completeness
    has_cms_data:             cmsDaysCovered > 0,
    has_grato_data:           hasGrato,
    cms_days_covered:         cmsDaysCovered,
    cms_days_expected:        daysInCycle,
    missing_cms_days:         daysInCycle - cmsDaysCovered,
    grato_submission_missing: !hasGrato,

    last_reconciled_at:     new Date(),
    reconciliation_version: 1,
  };

  // ── 11. PM (maintenance) integration patches ─────────────────────────────
  // Best-effort secondary RH source. Runs AFTER core RH/consumption are set
  // and BEFORE alert flags are computed, so patched values (e.g. PM-derived
  // RH filling in for missing CMS, or a faulty-meter flag from CMS-vs-PM
  // variance) are reflected in this cycle's alerts rather than lagging a run.
  await applyPMPatches(reconDoc, startDate, endDate, { ccph, budget });

  // ── 12. Alert flags ───────────────────────────────────────────────────────
  const alerts = {
    low_fuel:              false, // overwritten below by the dedicated tank-minimum check
    zero_grid_24h:         reconDoc.zero_grid_max_streak >= 24,
    consumption_over_ccph: reconDoc.cons_variance_pct !== null && reconDoc.cons_variance_pct > THRESHOLDS.CONS_OVER_CCPH_TOLERANCE,
    refuel_mismatch:       reconDoc.refuel_status === 'discrepancy',
    tomcard_mismatch:      reconDoc.refuel_field_vs_card_var !== null && Math.abs(reconDoc.refuel_field_vs_card_var) > THRESHOLDS.REFUEL_MISMATCH_LITERS,
    missing_grato:         !hasGrato && daysSinceCycleStart >= THRESHOLDS.MISSING_GRATO_GRACE_DAYS,
    missing_cms:           cmsDaysCovered === 0 || (daysInCycle - cmsDaysCovered) >= THRESHOLDS.MISSING_CMS_DAYS,
    faulty_meter:          reconDoc.faulty_meter_days > 0 || !!reconDoc._pm_faulty_meter_flag,
    theft_suspected:       totalTheft > THRESHOLDS.THEFT_MIN_LITERS || totalGapCPH > 200,
    rh_mismatch:           reconDoc.rh_variance_pct !== null && Math.abs(reconDoc.rh_variance_pct) > THRESHOLDS.RH_MISMATCH_PCT,
    missing_tank_capacity: reconDoc.tank_capacity_missing === true,
  };

  // ── Low-fuel check — site-specific, percentage-of-tank-capacity based ──────
  // Previously a flat 500L cutoff applied to every site regardless of tank
  // size (explicitly marked as a placeholder). Now uses THRESHOLDS.FUEL_LEVEL_LOW_PCT
  // (25%) of the site's actual Tank_Capacity_1 when known. If a site has no
  // tank capacity on file, fall back to the old flat-liters check rather than
  // silently never alerting — but flag the reconciliation doc so this data
  // gap itself is visible on the dashboard.
  reconDoc.tank_capacity_l = tankCapacityL;
  reconDoc.low_fuel_threshold_l = tankCapacityL
    ? +(tankCapacityL * (THRESHOLDS.FUEL_LEVEL_LOW_PCT / 100)).toFixed(1)
    : THRESHOLDS.FUEL_LEVEL_LOW_FALLBACK_L;
  reconDoc.tank_capacity_missing = !tankCapacityL;

  if (latestCms?.fuel_level_l !== null && latestCms?.fuel_level_l !== undefined) {
    alerts.low_fuel = latestCms.fuel_level_l < reconDoc.low_fuel_threshold_l;
  }

  const alertCount = Object.values(alerts).filter(Boolean).length;

  reconDoc.faulty_meter_days = reconDoc.faulty_meter_days; // unchanged, kept explicit for clarity
  reconDoc.alerts            = alerts;
  reconDoc.alert_count       = alertCount;

  // Clean up internal-only marker before persisting
  delete reconDoc._pm_faulty_meter_flag;

  // ── 13. Upsert CycleReconciliation ───────────────────────────────────────
  await CycleReconciliation.findOneAndUpdate(
    { site_id: siteId, cycle_key: cycleKey },
    { $set: reconDoc },
    { upsert: true }
  );

  // ── 14. Fire alerts ───────────────────────────────────────────────────────
  await alertService.processAlerts(reconDoc);
}

module.exports = { runForCycle, reconcileSite, applyPMPatches, THRESHOLDS };


