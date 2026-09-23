/**
 * reconciliationService_pm_patch.js
 *
 * This is NOT a replacement for your full reconciliationService.js.
 * It shows EXACTLY where to add the PM integration calls.
 * Copy the marked sections into your existing reconciliationService.js.
 *
 * ──────────────────────────────────────────────────────────────────
 * STEP 1: Add this require near the top of reconciliationService.js
 * ──────────────────────────────────────────────────────────────────
 */
const pmService = require('./pmIntegrationService');

/**
 * ──────────────────────────────────────────────────────────────────
 * STEP 2: In your main reconcileSite() or reconcileCycle() function,
 * after you build the reconRow object and before you save() it,
 * add this block:
 * ──────────────────────────────────────────────────────────────────
 *
 * (cycleStart and cycleEnd are the Date objects for the cycle window,
 *  e.g. from your DieselCycle document: cycle.start_date, cycle.end_date)
 */
async function applyPMPatches(reconRow, cycleStart, cycleEnd) {
  try {
    const patches = await pmService.validateAndPatch(reconRow, cycleStart, cycleEnd);

    if (Object.keys(patches).length === 0) return reconRow;

    // Merge patches into the reconRow
    Object.assign(reconRow, patches);

    // If PM records fixed the RH, recalculate cons_variance
    if (patches.rh_source === 'pm_records' && reconRow.contractual_consumption > 0) {
      const field_cons = reconRow.field_consumption_actual || 0;
      reconRow.cons_variance     = field_cons - reconRow.contractual_consumption;
      reconRow.cons_variance_pct = reconRow.contractual_consumption > 0
        ? reconRow.cons_variance / reconRow.contractual_consumption
        : null;
      reconRow.cons_status = reconRow.cons_variance > 0 ? 'over'
                           : reconRow.cons_variance < 0 ? 'under'
                           : 'ok';
    }

    return reconRow;

  } catch (err) {
    // PM integration is best-effort — never block reconciliation
    console.error('[pmIntegration] validateAndPatch failed for', reconRow.site_id, err.message);
    return reconRow;
  }
}

/**
 * ──────────────────────────────────────────────────────────────────
 * STEP 3: Export the helper so it can be called from your main engine
 * ──────────────────────────────────────────────────────────────────
 */
module.exports = { applyPMPatches };

/**
 * ──────────────────────────────────────────────────────────────────
 * EXAMPLE: How your reconcileCycle() loop should call applyPMPatches
 * ──────────────────────────────────────────────────────────────────
 *
 * for (const siteBudget of siteBudgets) {
 *   let reconRow = await buildReconRow(siteBudget, cmsData, gratoData, cycle);
 *
 *   // ← INSERT HERE after buildReconRow, before save:
 *   reconRow = await applyPMPatches(reconRow, cycle.start_date, cycle.end_date);
 *
 *   await CycleReconciliation.findOneAndUpdate(
 *     { cycle_key, site_id: siteBudget.site_id },
 *     { $set: reconRow },
 *     { upsert: true, new: true }
 *   );
 * }
 *
 * ──────────────────────────────────────────────────────────────────
 * WHAT THIS DOES FOR EACH SITE:
 * ──────────────────────────────────────────────────────────────────
 *
 * 1. MISSING CMS (has_cms_data = false):
 *    - Queries Maintenance records for PM visits in the cycle window
 *    - Extracts generator running hours from equipment_checks.generator_checks
 *    - Sets final_rh = pm_rh, rh_source = 'pm_records'
 *    - Recalculates contractual_consumption using PM-derived RH
 *    - Recalculates cons_variance, cons_status
 *    → Sites previously stuck at cons_status:'over' with 0 contractual
 *      will now show a meaningful comparison
 *
 * 2. CMS PRESENT but FAULTY:
 *    - Compares cms_rh vs pm_rh
 *    - If variance > 15% → alerts.faulty_meter = true, faulty_meter_days++
 *    → Catches sensors that report wrong hours vs physical meter
 *
 * 3. NO PM DATA:
 *    - Returns unchanged — reconciliation proceeds with CMS only
 */