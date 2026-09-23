/**
 * fuelPricing.js
 * config/fuelPricing.js
 *
 * SINGLE SOURCE OF TRUTH for the fuel price used to convert liters <-> XAF.
 *
 * Previously FUEL_PRICE_PER_LITER = 828 was hardcoded independently in THREE
 * places (models/FuelRequest.js, config/fuelRequestApprovalChain.js, and the
 * default on SiteBudget.xaf_per_liter) — meaning a site with a genuinely
 * different negotiated rate (SiteBudget.xaf_per_liter IS a real per-site
 * field and DOES get set differently for some sites/vendors) would get
 * inconsistent XAF figures depending on which code path computed them:
 * the FuelRequest's own xaf_requested/xaf_approved always used the flat
 * 828 constant, while SiteBudget-derived reports could reflect the real
 * site rate. This module fixes that split.
 *
 * DEFAULT_FUEL_PRICE_PER_LITER (828 XAF) remains the fleet-wide fallback
 * for contexts with no site/cycle to look up (e.g. building the static
 * approval-chain CEO threshold copy, which only needs an estimate for the
 * email body, not a ledger-accurate figure).
 *
 * getFuelPricePerLiter(site_id, cycle_key) is the ledger-accurate lookup:
 * it checks SiteBudget.xaf_per_liter for that site+cycle first, and only
 * falls back to the default when no SiteBudget row exists yet (e.g. a
 * request raised before the cycle's budget file has been uploaded).
 */

'use strict';

const DEFAULT_FUEL_PRICE_PER_LITER = 828; // XAF — fleet-wide fallback

/**
 * Ledger-accurate fuel price for a specific site + cycle.
 * Falls back to DEFAULT_FUEL_PRICE_PER_LITER when no SiteBudget row exists
 * (never throws — pricing lookups must never block a fuel request flow).
 *
 * @param {string} site_id
 * @param {string} cycle_key
 * @returns {Promise<number>} XAF per liter
 */
async function getFuelPricePerLiter(site_id, cycle_key) {
  if (!site_id || !cycle_key) return DEFAULT_FUEL_PRICE_PER_LITER;
  try {
    // Required lazily to avoid a require-cycle with models that may
    // themselves pull in config/fuelPricing.js.
    const SiteBudget = require('../models/SiteBudget');
    const sb = await SiteBudget.findOne({ site_id, cycle_key }).select('xaf_per_liter').lean();
    return sb?.xaf_per_liter || DEFAULT_FUEL_PRICE_PER_LITER;
  } catch (_) {
    return DEFAULT_FUEL_PRICE_PER_LITER;
  }
}

/**
 * Convenience: compute XAF for a liters amount at a site's real rate.
 * Rounds to the nearest whole XAF, matching existing Math.round() usage
 * throughout the fuel-request codepaths.
 */
async function litersToXaf(liters, site_id, cycle_key) {
  const rate = await getFuelPricePerLiter(site_id, cycle_key);
  return Math.round((liters || 0) * rate);
}

module.exports = {
  DEFAULT_FUEL_PRICE_PER_LITER,
  getFuelPricePerLiter,
  litersToXaf,
};
