/**
 * generatorSwapService.js
 * Handles generator moves/replacements.
 * Integrates with existing GeneratorUpdate model → GeneratorAssignmentLedger.
 * Triggers re-reconciliation for affected cycles after every swap.
 */
const GeneratorAssignmentLedger = require('../models/GeneratorAssignmentLedger');
const SiteBudget                = require('../models/SiteBudget');
const DieselCycle               = require('../models/DieselCycle');
const alertService              = require('./alertService');
const reconciliationService     = require('./reconciliationService');
const logger                    = require('../utils/logger');

/**
 * Record a new generator assignment when a site gets its first generator.
 */
async function assignGenerator({ site_id, site_name, cluster, region, generator_id, generator_brand, dg_kva, assigned_at, assigned_reason, recorded_by, generator_update_ref }) {
  // Close any existing active assignment first (shouldn't exist, but safety net)
  await GeneratorAssignmentLedger.closeActiveAssignment(
    site_id,
    assigned_at,
    recorded_by,
    'Replaced by new assignment'
  );

  // Get CCPH from SiteBudget for the current cycle
  const cycleKey = DieselCycle.getCycleKeyForDate(assigned_at);
  const budget   = await SiteBudget.findOne({ site_id, cycle_key: cycleKey }).lean();

  const ledgerEntry = await GeneratorAssignmentLedger.create({
    site_id, site_name, cluster, region,
    generator_id, generator_brand, dg_kva,
    ccph:           budget?.ccph || null,
    assigned_at:    assigned_at || new Date(),
    assigned_reason: assigned_reason || 'Initial assignment',
    is_active:      true,
    cycles_affected: [cycleKey],
    recorded_by,
    generator_update_ref,
  });

  logger.info(`[GenSwap] Assigned ${generator_id} to site ${site_id} (cycle ${cycleKey})`);
  return ledgerEntry;
}

/**
 * Record a generator swap (old gen removed, new gen installed).
 * Called when supervisor approves a GeneratorUpdate of type 'new_generator'.
 */
async function swapGenerator({
  site_id, site_name, cluster, region,
  old_generator_id,
  new_generator_id, new_generator_brand, new_dg_kva,
  swap_date, swap_reason,
  recorded_by, generator_update_ref,
}) {
  const swapAt   = new Date(swap_date || Date.now());
  const cycleKey = DieselCycle.getCycleKeyForDate(swapAt);

  // 1. Close the old assignment
  const closed = await GeneratorAssignmentLedger.closeActiveAssignment(
    site_id,
    swapAt,
    recorded_by,
    swap_reason || `Replaced by ${new_generator_id}`
  );

  if (closed) {
    // Add this cycle to its cycles_affected if not already there
    await GeneratorAssignmentLedger.findByIdAndUpdate(closed._id, {
      $addToSet: { cycles_affected: cycleKey },
    });
  }

  // 2. Get CCPH from budget (new generator may have different CCPH)
  const budget = await SiteBudget.findOne({ site_id, cycle_key: cycleKey }).lean();

  // 3. Open new assignment
  const newEntry = await GeneratorAssignmentLedger.create({
    site_id, site_name, cluster, region,
    generator_id:    new_generator_id,
    generator_brand: new_generator_brand,
    dg_kva:          new_dg_kva,
    ccph:            budget?.ccph || null,
    assigned_at:     swapAt,
    assigned_reason: swap_reason || `Replaced ${old_generator_id || 'previous generator'}`,
    is_active:       true,
    cycles_affected: [cycleKey],
    recorded_by,
    generator_update_ref,
  });

  // 4. Alert
  await alertService.fireSystemAlert(
    'GENERATOR_MOVED',
    'info',
    `Generator Swap — ${site_name || site_id}`,
    `Generator ${old_generator_id || 'previous'} replaced by ${new_generator_id} at site ${site_id} on ${swapAt.toLocaleDateString()}.`,
    { site_id, cluster, old_generator_id, new_generator_id, swap_date: swapAt },
    cycleKey
  );

  // 5. Re-run reconciliation for this cycle (swap affects pro-rated CCPH)
  setImmediate(async () => {
    try {
      await reconciliationService.runForCycle(cycleKey, site_id);
      logger.info(`[GenSwap] Re-reconciled ${site_id} for cycle ${cycleKey}`);
    } catch (err) {
      logger.error(`[GenSwap] Re-reconciliation failed: ${err.message}`);
    }
  });

  logger.info(`[GenSwap] Swapped ${old_generator_id} → ${new_generator_id} at ${site_id}`);
  return { closed, newEntry };
}

/**
 * Get the full assignment history for a site (for the GeneratorLedger page).
 */
async function getSiteHistory(site_id) {
  return GeneratorAssignmentLedger.find({ site_id })
    .sort({ assigned_at: -1 })
    .populate('recorded_by', 'fullName')
    .populate('removed_by',  'fullName')
    .lean();
}

/**
 * Get all sites that currently have no active generator assignment.
 * These are data gaps that need attention.
 */
async function getSitesWithoutGenerator() {
  const activeSiteIds = await GeneratorAssignmentLedger.distinct('site_id', { is_active: true });
  return activeSiteIds; // Consumer compares this list against all known sites
}

module.exports = { assignGenerator, swapGenerator, getSiteHistory, getSitesWithoutGenerator };