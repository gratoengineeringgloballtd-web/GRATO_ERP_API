/**
 * pmIntegrationService.js
 * diesel-system/services/pmIntegrationService.js
 *
 * Pulls technician PM records (Maintenance.equipment_checks.generator_checks)
 * and injects running hours into the CMS validation pipeline.
 *
 * WHY THIS EXISTS
 * ───────────────
 * CMS telemetry sends daily Gen RH from the remote monitoring system.
 * Sometimes CMS is missing (offline sensor, faulty meter days).
 * Technician PM records contain physical meter readings taken on site.
 * When CMS data is absent, PM running hours can fill the gap.
 * When CMS IS present, PM readings validate it — a large discrepancy
 * suggests a faulty meter and triggers FAULTY_METER_DAYS alert.
 *
 * USAGE IN reconciliationService.js
 * ──────────────────────────────────
 * const pmService = require('./pmIntegrationService');
 *
 * // Get all PM readings for a site within a cycle window
 * const pmReadings = await pmService.getPMRunningHours(site_id, cycle_start, cycle_end);
 *
 * // Get total PM-derived RH (for when CMS is missing)
 * const pm_rh = pmService.sumRH(pmReadings);
 *
 * // Detect discrepancy between CMS RH and PM RH
 * const { faulty, variance_pct } = pmService.detectCMSvsPM(cms_rh, pmReadings);
 */

'use strict';

const Maintenance = require('../models/Maintenance');

// If PM vs CMS RH differs by more than this %, flag FAULTY_METER
const FAULTY_METER_THRESHOLD_PCT = 0.15; // 15 %

/**
 * Get all PM generator running-hour readings for a site in a date range.
 *
 * @param {string}  site_id     IHS_ID_SITE
 * @param {Date}    cycleStart
 * @param {Date}    cycleEnd
 * @returns {Promise<PMReading[]>}
 *
 * PMReading shape:
 *   { maintenance_id, visit_date, generator_id, running_hours, closing_hours }
 */
async function getPMRunningHours(site_id, cycleStart, cycleEnd) {
  const records = await Maintenance.find({
    site_id,
    status:     { $in: ['completed', 'approved', 'pending_approval'] },
    visit_date: { $gte: cycleStart, $lte: cycleEnd },
    // Only PM-type visits carry generator checks
    visit_type: { $in: ['PM', 'PM+END', 'PM+RF', 'PM+RF+END'] },
  })
    .select('_id visit_date equipment_checks fuel_data')
    .lean();

  const readings = [];

  for (const rec of records) {
    const genChecks = rec.equipment_checks?.generator_checks;

    if (Array.isArray(genChecks) && genChecks.length > 0) {
      // New format: array of per-generator objects
      for (const gc of genChecks) {
        const rh = _extractRH(gc);
        if (rh !== null) {
          readings.push({
            maintenance_id: rec._id,
            visit_date:     rec.visit_date,
            generator_id:   gc.equipment_id || null,
            running_hours:  rh,
            closing_hours:  gc.running_hours ?? null,  // absolute meter reading
            source:         'generator_checks',
          });
        }
      }
    } else if (rec.equipment_checks?.generator_checks) {
      // Legacy format: single object
      const gc = rec.equipment_checks.generator_checks;
      const rh = _extractRH(gc);
      if (rh !== null) {
        readings.push({
          maintenance_id: rec._id,
          visit_date:     rec.visit_date,
          generator_id:   null,
          running_hours:  rh,
          closing_hours:  gc.running_hours ?? null,
          source:         'generator_checks_legacy',
        });
      }
    }

    // Fallback: running hours stored in fuel_data (old refuel submit format)
    if (readings.length === 0 && rec.fuel_data?.runtime_data?.runtime_hours) {
      readings.push({
        maintenance_id: rec._id,
        visit_date:     rec.visit_date,
        generator_id:   null,
        running_hours:  rec.fuel_data.runtime_data.runtime_hours,
        closing_hours:  rec.fuel_data.runtime_data.closing_hours ?? null,
        source:         'fuel_data_runtime',
      });
    }
  }

  // Sort chronologically
  readings.sort((a, b) => new Date(a.visit_date) - new Date(b.visit_date));
  return readings;
}

/**
 * Extract running hours delta from a generator check object.
 * Handles both absolute meter reading (running_hours field) and
 * pre-calculated delta (run_hours / delta fields).
 */
function _extractRH(gc) {
  // Pre-calculated delta (preferred)
  if (typeof gc.run_hours === 'number' && gc.run_hours > 0)  return gc.run_hours;
  if (typeof gc.delta    === 'number' && gc.delta    > 0)    return gc.delta;

  // Derive from closing − opening if both present
  const closing = gc.running_hours ?? gc.ch_actuel ?? null;
  const opening = gc.prev_running_hours ?? gc.ch_ancien ?? null;
  if (closing !== null && opening !== null && closing > opening) {
    return Math.round(closing - opening);
  }

  // Absolute meter reading only — return as-is, caller decides how to use it
  if (closing !== null && closing > 0) return closing;

  return null;
}

/**
 * Sum all PM running hours for a cycle.
 * If a site has multiple generators, sums across all.
 *
 * @param {PMReading[]} readings
 * @returns {number}
 */
function sumRH(readings) {
  return readings.reduce((acc, r) => acc + (r.running_hours || 0), 0);
}

/**
 * Get the most recent absolute meter reading for a site.
 * Used to validate CMS RH cumulative totals.
 *
 * @param {PMReading[]} readings
 * @returns {{ closing_hours: number, visit_date: Date } | null}
 */
function latestMeterReading(readings) {
  const withClosing = readings.filter(r => r.closing_hours !== null);
  if (withClosing.length === 0) return null;
  return withClosing[withClosing.length - 1];
}

/**
 * Detect discrepancy between CMS-reported RH and PM-derived RH.
 *
 * Returns:
 *   faulty         — true if variance exceeds threshold
 *   variance_pct   — fractional difference
 *   cms_rh         — input
 *   pm_rh          — derived from readings
 *   faulty_days    — number of PM visits where discrepancy was detected
 */
function detectCMSvsPM(cms_rh, readings) {
  const pm_rh = sumRH(readings);

  if (pm_rh === 0 || cms_rh === 0) {
    return { faulty: false, variance_pct: null, cms_rh, pm_rh, faulty_days: 0 };
  }

  const variance_pct = Math.abs(cms_rh - pm_rh) / Math.max(cms_rh, pm_rh);
  const faulty       = variance_pct > FAULTY_METER_THRESHOLD_PCT;

  // Count individual visits with discrepancy
  // (conservative: one faulty-meter-day per PM visit that diverges)
  const faulty_days = faulty ? readings.length : 0;

  return { faulty, variance_pct, cms_rh, pm_rh, faulty_days };
}

/**
 * Full validation for a single site's reconciliation record.
 * Meant to be called after the main reconciliation engine populates cms_rh.
 *
 * Returns patches to apply to the CycleReconciliation document:
 *   - If CMS is missing and PM data exists → use PM RH as final_rh
 *   - If both exist and diverge → mark faulty meter days
 *
 * @param {object} reconRow  — CycleReconciliation document (plain object)
 * @param {Date}   cycleStart
 * @param {Date}   cycleEnd
 * @returns {Promise<object>}  — fields to $set on reconRow
 */
async function validateAndPatch(reconRow, cycleStart, cycleEnd) {
  const readings = await getPMRunningHours(reconRow.site_id, cycleStart, cycleEnd);
  if (readings.length === 0) return {};  // no PM data — nothing to patch

  const pm_rh  = sumRH(readings);
  const patches = {};

  if (!reconRow.has_cms_data || reconRow.cms_rh === 0) {
    // CMS is absent — use PM hours as the fallback RH
    patches.final_rh          = pm_rh;
    patches.rh_source         = 'pm_records';
    patches.pm_rh             = pm_rh;
    patches.pm_visit_count    = readings.length;

    // Recalculate contractual consumption using PM-derived RH
    if (reconRow.ccph > 0) {
      patches.contractual_consumption = Math.round(reconRow.ccph * pm_rh);
    }
  } else {
    // CMS data exists — cross-validate
    const { faulty, variance_pct, faulty_days } = detectCMSvsPM(reconRow.cms_rh, readings);
    patches.pm_rh             = pm_rh;
    patches.pm_visit_count    = readings.length;
    patches.pm_vs_cms_var_pct = variance_pct;

    if (faulty) {
      patches.alerts = { ...(reconRow.alerts || {}), faulty_meter: true };
      patches.faulty_meter_days = Math.max(
        reconRow.faulty_meter_days || 0,
        faulty_days
      );
    }
  }

  return patches;
}

module.exports = {
  getPMRunningHours,
  sumRH,
  latestMeterReading,
  detectCMSvsPM,
  validateAndPatch,
  FAULTY_METER_THRESHOLD_PCT,
};