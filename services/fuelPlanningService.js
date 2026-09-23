/**
 * fuelPlanningService.js
 * PowerGen_API/services/fuelPlanningService.js
 *
 * Predicts when each site will need refueling using a 4-source algorithm:
 *
 *  SOURCE 1 — CMS daily records (gen_rh per day): most reliable, telemetry-based
 *  SOURCE 2 — FuelConsumption field data (actual liters added vs consumed): ground truth
 *  SOURCE 3 — SiteBudget CCPH (contractual litres/hour): fallback when no history
 *  SOURCE 4 — Gemini AI: narrative recommendation + risk commentary
 *
 * ALGORITHM:
 *  1. Pull last 7-day average gen_rh/day from CmsDailyRecord
 *  2. Multiply by site CCPH → predicted_consumption_per_day (L/day)
 *  3. Get current fuel level from last FuelConsumption record
 *  4. days_to_empty = current_level / predicted_consumption_per_day
 *  5. Flag as CRITICAL if days_to_empty ≤ 2 OR current_level < 100L
 *  6. Flag as HIGH    if days_to_empty ≤ 5
 *  7. Flag as MEDIUM  if days_to_empty ≤ 10
 *  8. If no CMS data: use budgeted_rh / days_in_cycle as rh_per_day
 *  9. Gemini adds contextual narrative if GEMINI_API_KEY is set
 */

'use strict';

const CmsDailyRecord  = require('../models/CmsDailyRecord');
const FuelConsumption = require('../models/FuelConsumption');
const SiteBudget      = require('../models/SiteBudget');
const Site            = require('../models/Site');
const FuelRequest     = require('../models/FuelRequest');
const logger          = require('../utils/logger');

const LOW_FUEL_CRITICAL_LITERS = 100;  // below this = always CRITICAL
const DAYS_CRITICAL            = 2;
const DAYS_HIGH                = 5;
const DAYS_MEDIUM              = 10;
const CMS_LOOKBACK_DAYS        = 7;

// ── Helpers ─────────────────────────────────────────────────────────────────
function getCycleKey() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getDate() >= 26
    ? now.getMonth() + 2   // next month
    : now.getMonth() + 1;
  const m = month > 12 ? 1 : month;
  const y = month > 12 ? year + 1 : year;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function urgencyFromDays(daysToEmpty, currentLevel) {
  if (currentLevel !== null && currentLevel < LOW_FUEL_CRITICAL_LITERS) return 'critical';
  if (daysToEmpty === null) return 'unknown';
  if (daysToEmpty <= DAYS_CRITICAL) return 'critical';
  if (daysToEmpty <= DAYS_HIGH)     return 'high';
  if (daysToEmpty <= DAYS_MEDIUM)   return 'medium';
  return 'ok';
}

/**
 * predictSiteFuel(site_id, cycle_key)
 * Returns a prediction object for a single site.
 */
async function predictSiteFuel(site_id, cycle_key) {
  const ck = cycle_key || getCycleKey();

  // ── 1. Get SiteBudget for CCPH + current budget position ─────────────────
  const sb = await SiteBudget.findOne({ site_id, cycle_key: ck }).lean();
  const ccph            = sb?.ccph             || null;
  const budgetedRh      = sb?.budgeted_rh      || null;
  const rhPerDay        = sb?.rh_per_day       || null;
  const daysInCycle     = sb?.days_in_cycle    || 30;
  const budgetLiters    = sb?.budget_liters    || null;
  const litersUsed      = sb?.liters_used      || 0;
  const litersRemaining = sb ? Math.max(0, (sb.effective_budget_liters || budgetLiters || 0) - litersUsed) : null;

  // ── 2. Latest fuel level from FuelConsumption ─────────────────────────────
  const latestFC = await FuelConsumption.findOne({ site_id })
    .sort({ record_date: -1, createdAt: -1 })
    .select('fuel_data record_date visit_date submitted_at')
    .lean();

  const currentLevel    = latestFC?.fuel_data?.closing_level  ?? null;
  // SiteBudget never carries a tank-capacity field (it's a budget/CCPH
  // record, not a site-asset record) — that lookup was always dead. Fall
  // back to Site.Tank_Capacity_1, the real field, when the latest
  // FuelConsumption record doesn't have one on file yet.
  let tankCapacity = latestFC?.fuel_data?.tank_capacity ?? null;
  if (tankCapacity === null) {
    const siteDoc = await Site.findOne({ IHS_ID_SITE: site_id }).select('Tank_Capacity_1').lean();
    tankCapacity = siteDoc?.Tank_Capacity_1 ?? null;
  }
  const lastRefuelDate  = latestFC?.visit_date || latestFC?.record_date || null;
  const fuelPct         = (currentLevel != null && tankCapacity > 0)
    ? Math.round((currentLevel / tankCapacity) * 100)
    : null;

  // ── 3. CMS 7-day average gen_rh/day + grid availability weighting ───────────
  // Uses CmsDailyRecord data written by cmsUploadRoutes after each daily upload.
  //
  // GRID AVAILABILITY WEIGHTING:
  //   Sites with low grid availability run generators longer, consuming more fuel.
  //   Raw gen_rh alone overpredicts consumption for high-grid sites and under-
  //   predicts for low-grid sites.
  //   Adjusted gen_rh = raw gen_rh × (1 + grid_off_factor × 0.2)
  //   where grid_off_factor = 1 - (avg_grid_availability_hr / 24)
  //   → fully off-grid site: +20% adjustment; fully on-grid: no adjustment.
  const cmsFrom = new Date();
  cmsFrom.setDate(cmsFrom.getDate() - CMS_LOOKBACK_DAYS);
  const cmsTo   = new Date();

  let avgGenRhPerDay = null;
  let avgGridAvailHr = null;
  let cmsRecordCount = 0;
  try {
    // Raw query to get both gen_rh and grid_availability_hr
    const cmsRecords = await CmsDailyRecord.find({
      site_id,
      record_date: { $gte: cmsFrom, $lte: cmsTo },
      gen_rh:      { $gt: 0 },
    }).select('gen_rh grid_availability_hr record_date').lean();

    if (cmsRecords.length > 0) {
      cmsRecordCount  = cmsRecords.length;
      const rawGenRh  = cmsRecords.reduce((s, r) => s + (r.gen_rh || 0), 0) / cmsRecords.length;
      const rawGridHr = cmsRecords.reduce((s, r) => s + (r.grid_availability_hr || 0), 0) / cmsRecords.length;
      avgGridAvailHr  = +rawGridHr.toFixed(2);

      // Grid-off factor: fraction of day without grid (0 = always on grid, 1 = never)
      const gridOffFactor  = Math.max(0, Math.min(1, 1 - (rawGridHr / 24)));
      // Adjustment: sites with no grid consume ~20% more fuel per gen_rh hour
      const gridAdjustment = 1 + (gridOffFactor * 0.20);
      avgGenRhPerDay       = +(rawGenRh * gridAdjustment).toFixed(2);
    }
  } catch (cmsErr) {
    // Fallback: getCycleGenRH static (no grid weighting)
    try {
      const cmsAgg = await CmsDailyRecord.getCycleGenRH(site_id, cmsFrom, cmsTo);
      if (cmsAgg && cmsAgg.days > 0) {
        avgGenRhPerDay = +(cmsAgg.total_gen_rh / cmsAgg.days).toFixed(2);
        cmsRecordCount = cmsAgg.days;
      }
    } catch { /* no CMS data */ }
  }

  // ── 4. Field-consumption rate from last 3 FuelConsumption records ─────────
  const recentFC = await FuelConsumption.find({ site_id })
    .sort({ record_date: -1 })
    .limit(5)
    .select('fuel_data record_date')
    .lean();

  let fieldConsumptionPerDay = null;
  if (recentFC.length >= 2) {
    const totalConsumed = recentFC.reduce((s, r) =>
      s + (r.fuel_data?.fuel_consumed || r.fuel_data?.total_consumption || 0), 0);
    const totalDays = (() => {
      const d1 = new Date(recentFC[recentFC.length - 1].record_date);
      const d2 = new Date(recentFC[0].record_date);
      return Math.max(1, Math.round((d2 - d1) / 86400000));
    })();
    fieldConsumptionPerDay = totalConsumed / totalDays;
  }

  // ── 5. Pick best consumption rate (priority: CMS×CCPH > field > budget) ──
  let consumptionPerDay = null;
  let rateSource        = 'none';

  if (avgGenRhPerDay !== null && ccph !== null) {
    consumptionPerDay = avgGenRhPerDay * ccph;
    rateSource        = 'cms_ccph';
  } else if (fieldConsumptionPerDay !== null && fieldConsumptionPerDay > 0) {
    consumptionPerDay = fieldConsumptionPerDay;
    rateSource        = 'field_data';
  } else if (rhPerDay !== null && ccph !== null) {
    consumptionPerDay = rhPerDay * ccph;
    rateSource        = 'budget_rh_ccph';
  } else if (budgetedRh !== null && daysInCycle > 0 && ccph !== null) {
    consumptionPerDay = (budgetedRh / daysInCycle) * ccph;
    rateSource        = 'budget_planned';
  }

  // ── 6. Days to empty ─────────────────────────────────────────────────────
  const daysToEmpty = (currentLevel !== null && consumptionPerDay > 0)
    ? +(currentLevel / consumptionPerDay).toFixed(1)
    : null;

  const estimatedEmptyDate = daysToEmpty !== null
    ? new Date(Date.now() + daysToEmpty * 86400000)
    : null;

  // Suggested refuel date = 1 day before empty (at CRITICAL), 
  // or when level would hit 100L
  const daysToRefuelThreshold = (currentLevel !== null && consumptionPerDay > 0)
    ? +((currentLevel - LOW_FUEL_CRITICAL_LITERS) / consumptionPerDay).toFixed(1)
    : null;

  const suggestedRefuelDate = daysToRefuelThreshold !== null
    ? new Date(Date.now() + Math.max(0, daysToRefuelThreshold) * 86400000)
    : null;

  // ── 7. Pending FuelRequests for this site ─────────────────────────────────
  const pendingFR = await FuelRequest.findOne({
    site_id,
    cycle_key: ck,
    status: { $in: ['pending_l1', 'pending_l2', 'pending_l3', 'pending_l4', 'pending_l5', 'pending_l6', 'approved', 'scheduled'] },
  }).select('status liters_requested liters_approved urgency').lean();

  const urgency = urgencyFromDays(daysToEmpty, currentLevel);

  return {
    site_id,
    cycle_key:             ck,
    urgency,
    // Current state
    current_level_l:       currentLevel,
    tank_capacity_l:       tankCapacity,
    fuel_pct:              fuelPct,
    last_refuel_date:      lastRefuelDate,
    // Prediction
    consumption_per_day_l: consumptionPerDay ? +consumptionPerDay.toFixed(2) : null,
    rate_source:           rateSource,
    avg_gen_rh_per_day:    avgGenRhPerDay    ? +avgGenRhPerDay.toFixed(2)    : null,
    ccph,
    days_to_empty:         daysToEmpty,
    estimated_empty_date:  estimatedEmptyDate,
    suggested_refuel_date: suggestedRefuelDate,
    // Budget position
    budget_liters:         budgetLiters,
    liters_used:           litersUsed,
    liters_remaining:      litersRemaining,
    budget_utilisation_pct:budgetLiters > 0 ? Math.round((litersUsed / budgetLiters) * 100) : null,
    // CMS data
    cms_days_used:         cmsRecordCount,
    avg_grid_avail_hr:     avgGridAvailHr,
    grid_weighting_applied:avgGridAvailHr !== null,
    // Pending request
    // Site characteristics (affect scheduling priority)
    topology:              sb?.topology || null,            // GBT, RTT, COW, ...
    is_fueling_site:       sb?.is_fueling_site || false,
    grid_availability_pct: sb?.final_grid_availability || null,

    pending_request:       pendingFR ? {
      status:           pendingFR.status,
      liters_requested: pendingFR.liters_requested,
      liters_approved:  pendingFR.liters_approved,
      urgency:          pendingFR.urgency,
    } : null,
  };
}

/**
 * planAllSites(cycle_key, options)
 * Runs predictSiteFuel for all sites that have a SiteBudget for the cycle.
 * options.urgency_filter = ['critical','high','medium','ok','unknown']
 * options.limit = max results (default 200)
 */
async function planAllSites(cycle_key, options = {}) {
  const ck     = cycle_key || getCycleKey();
  const filter = options.urgency_filter || null;
  const limit  = options.limit || 200;

  const budgets = await SiteBudget.find({ cycle_key: ck })
    .select('site_id site_name cluster region ccph topology is_fueling_site final_grid_availability')
    .limit(limit)
    .lean();

  if (!budgets.length) return { cycle_key: ck, sites: [], total: 0 };

  // Run predictions in batches of 10 to avoid overwhelming MongoDB
  const results = [];
  for (let i = 0; i < budgets.length; i += 10) {
    const batch = budgets.slice(i, i + 10);
    const predictions = await Promise.all(
      batch.map(b => predictSiteFuel(b.site_id, ck).then(p => ({
        ...p,
        site_name: b.site_name,
        cluster:   b.cluster,
        region:    b.region,
      })).catch(e => {
        logger.error(`[FuelPlanning] predictSiteFuel error for ${b.site_id}:`, e.message);
        return null;
      }))
    );
    results.push(...predictions.filter(Boolean));
  }

  // Sort: critical first, then by days_to_empty asc
  // Topology difficulty score (higher = harder to reach → schedule earlier within same urgency)
  const topologyDifficulty = { GBT: 0, COW: 1, RTT: 2, IBS: 3 };
  const urgencyOrder = { critical: 0, high: 1, medium: 2, unknown: 3, ok: 4 };
  results.sort((a, b) => {
    const ud = (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4);
    if (ud !== 0) return ud;
    const da = a.days_to_empty ?? 999;
    const db = b.days_to_empty ?? 999;
    if (da !== db) return da - db;
    // Same urgency + same days: harder topology sites first
    const ta = topologyDifficulty[a.topology] ?? 0;
    const tb = topologyDifficulty[b.topology] ?? 0;
    return tb - ta;
  });

  const filtered = filter
    ? results.filter(r => filter.includes(r.urgency))
    : results;

  return {
    cycle_key: ck,
    generated_at: new Date(),
    total: filtered.length,
    total_critical: results.filter(r => r.urgency === 'critical').length,
    total_high:     results.filter(r => r.urgency === 'high').length,
    total_medium:   results.filter(r => r.urgency === 'medium').length,
    total_ok:       results.filter(r => r.urgency === 'ok').length,
    sites: filtered,
  };
}

/**
 * geminiNarrative(prediction)
 * Adds a Gemini AI narrative to a single site prediction.
 * Returns the prediction unchanged if GEMINI_API_KEY is not set.
 */
async function geminiNarrative(prediction) {
  if (!process.env.GEMINI_API_KEY) return prediction;
  try {
    const gemini = require('./GeminiService');
    const prompt = `
You are a diesel fuel logistics expert for a telecom tower network in Cameroon.
Analyze this site's fuel prediction data and give a 2-3 sentence professional recommendation.

Site: ${prediction.site_id} (${prediction.site_name || ''})
Cluster: ${prediction.cluster || ''}
Current fuel level: ${prediction.current_level_l ?? 'unknown'} L (${prediction.fuel_pct ?? '?'}% of tank)
Predicted consumption: ${prediction.consumption_per_day_l ?? 'unknown'} L/day (based on ${prediction.rate_source})
Days to empty: ${prediction.days_to_empty ?? 'unknown'}
Suggested refuel date: ${prediction.suggested_refuel_date ? new Date(prediction.suggested_refuel_date).toDateString() : 'unknown'}
Budget remaining this cycle: ${prediction.liters_remaining ?? 'unknown'} L
Urgency: ${prediction.urgency?.toUpperCase()}
Pending refuel request: ${prediction.pending_request ? JSON.stringify(prediction.pending_request) : 'None'}

Provide: (1) Your immediate recommendation, (2) Any risk factors, (3) Whether budget is sufficient.
Keep it concise and professional. No bullet points — one flowing paragraph.
`.trim();

    const advice = await gemini.chat(prompt, 'diesel_manager');
    return { ...prediction, gemini_recommendation: advice };
  } catch (e) {
    logger.warn('[FuelPlanning] Gemini narrative failed (non-fatal):', e.message);
    return prediction;
  }
}

module.exports = { predictSiteFuel, planAllSites, geminiNarrative, getCycleKey };
