/**
 * fuelRequestApprovalChain.js
 * config/fuelRequestApprovalChain.js
 *
 * Builds the approval chain for every fuel refueling request.
 *
 * HARDENING NOTE: the six named approvers below (Minka, Pascal, Didier,
 * Ranibell, Kelvin, Tom) used to be the ONLY source of truth, hardcoded
 * directly in this file. If any of them changed email or left the company,
 * fixing it required a code change and redeploy — and in the meantime,
 * every new fuel request would silently email a dead inbox with no error,
 * in a chain that gates real money and real diesel.
 *
 * Now: models/ApprovalChainConfig.js is a DB-backed, admin-editable
 * singleton document holding the same shape. This module loads it into an
 * in-memory cache at startup and keeps getFuelRequestApprovalChain()/
 * getNextStatus() SYNCHRONOUS (so no existing caller needs to become
 * async) by always reading from the cache. refreshApprovalChainConfig()
 * re-loads the cache immediately and is called by the new admin route
 * (routes/adminRoutes.js) right after a save, so changes take effect on
 * the very next request — no restart, no polling lag.
 *
 * The DEFAULT_APPROVERS below are used only until an admin has ever saved
 * a config (or if the DB lookup fails) — this is a purely additive,
 * non-breaking change; a fresh deploy behaves exactly as before.
 *
 * CEO threshold: 100 L by default (also admin-editable via ApprovalChainConfig).
 *
 * Status strings mirror CashRequest so the same supervisor approval UI works.
 */

'use strict';

const { DEFAULT_FUEL_PRICE_PER_LITER } = require('./fuelPricing');

const FUEL_PRICE_PER_LITER = DEFAULT_FUEL_PRICE_PER_LITER; // XAF — fleet-wide estimate for email copy only; see fuelPricing.js for the ledger-accurate per-site lookup

// ── Hardcoded fallback (used only until ApprovalChainConfig has ever been saved) ──
const DEFAULT_CEO_LITERS_THRESHOLD = 100; // L
const DEFAULT_APPROVERS = [
  { level: 1, name: 'Mr. Kevin Minka',    email: 'minka.kevin@gratoglobal.com',        role: 'Diesel Coordinator',    department: 'Technical',  conditional_ceo_step: false },
  { level: 2, name: 'Mr. Pascal Assam',   email: 'pascal.rodrique@gratoglobal.com',    role: 'Operations Manager',    department: 'Technical',  conditional_ceo_step: false },
  { level: 3, name: 'Mr. Didier Oyong',   email: 'didier.oyong@gratoengineering.com',  role: 'Technical Director',    department: 'Technical',  conditional_ceo_step: false },
  { level: 4, name: 'Ms. Ranibell Mambo', email: 'ranibellmambo@gratoengineering.com', role: 'Finance Officer',       department: 'Finance',    conditional_ceo_step: false },
  { level: 5, name: 'Mr. E.T Kelvin',     email: 'kelvin.eyong@gratoglobal.com',       role: 'Head of Business',      department: 'Executive',  conditional_ceo_step: false },
  { level: 6, name: 'Mr. Tom',            email: 'tom@gratoengineering.com',           role: 'CEO - Final Authority', department: 'CEO Office', conditional_ceo_step: true  },
];

// ── In-memory cache, populated from ApprovalChainConfig at module init ──────────
let _cache = {
  steps: DEFAULT_APPROVERS,
  ceo_liters_threshold: DEFAULT_CEO_LITERS_THRESHOLD,
  loaded_from_db: false,
};

/**
 * (Re)load the cache from the DB. Called once at module init (fire-and-
 * forget — the sync API below works off DEFAULT_APPROVERS until this
 * resolves, which in practice is milliseconds after server start) and
 * again by the admin route immediately after a save.
 * Never throws — a DB hiccup just means the cache keeps whatever it had.
 */
async function refreshApprovalChainConfig() {
  try {
    const ApprovalChainConfig = require('../models/ApprovalChainConfig');
    const cfg = await ApprovalChainConfig.getActive('fuel_request');
    if (cfg?.steps?.length) {
      _cache = {
        steps: cfg.steps,
        ceo_liters_threshold: cfg.ceo_liters_threshold ?? DEFAULT_CEO_LITERS_THRESHOLD,
        loaded_from_db: true,
      };
    }
  } catch (_) {
    // Mongo not connected yet at module-init time, or query failed —
    // keep the existing cache (defaults, or whatever was last loaded).
  }
  return _cache;
}

// Kick off the initial load; don't block module export on it.
refreshApprovalChainConfig();

/**
 * Build a single chain step object.
 */
function makeStep(level, approver, assignFirst = false) {
  return {
    level,
    approver: {
      name:       approver.name,
      email:      approver.email,
      role:       approver.role,
      department: approver.department,
    },
    status:       'pending',
    assignedDate: assignFirst ? new Date() : null,
    comments:     '',
    actionDate:   null,
    actionTime:   null,
    decidedBy:    null,
  };
}

/**
 * Returns the approval chain array for a fuel request.
 * Reads from the in-memory cache (DB-backed once loaded, hardcoded
 * defaults until then) — see refreshApprovalChainConfig() above.
 *
 * @param {number} liters - quantity requested in litres
 * @returns {Array}  chain steps ready to embed in FuelRequest.approvalChain
 */
function getFuelRequestApprovalChain(liters) {
  const threshold = _cache.ceo_liters_threshold;
  const needsCEO  = liters >= threshold;
  const xaf       = Math.round(liters * FUEL_PRICE_PER_LITER);

  console.log(`\n${'='.repeat(60)}`);
  console.log('=== BUILDING FUEL REQUEST APPROVAL CHAIN ===');
  console.log(`  Source           : ${_cache.loaded_from_db ? 'ApprovalChainConfig (DB)' : 'hardcoded defaults (no DB config saved yet)'}`);
  console.log(`  Litres requested : ${liters} L`);
  console.log(`  XAF equivalent   : ${xaf.toLocaleString()} XAF`);
  console.log(`  CEO threshold    : ${threshold} L — CEO step: ${needsCEO ? 'INCLUDED' : 'SKIPPED'}`);
  console.log(`${'='.repeat(60)}\n`);

  const chain = [];
  _cache.steps.forEach((approver, idx) => {
    if (approver.conditional_ceo_step) {
      if (needsCEO) chain.push(makeStep(chain.length + 1, approver));
    } else {
      chain.push(makeStep(chain.length + 1, approver, idx === 0));
    }
  });

  chain.forEach(s =>
    console.log(`  L${s.level}: ${s.approver.name} (${s.approver.role})`)
  );

  return chain;
}

/**
 * Given the current approved level, return what the request status should be
 * after approval at that level (so the next approver's tab lights up).
 * Uses the same level → status mapping regardless of which named person
 * fills each role — the STATUS strings describe the ROLE ("pending_finance"),
 * not the individual, so they stay valid even after an approver is swapped.
 *
 * @param {number} level            - the level that just approved
 * @param {number} totalLevels      - total chain length
 * @param {number} liters           - used to determine if CEO step exists
 * @returns {string}
 */
function getNextStatus(level, totalLevels, liters) {
  if (level >= totalLevels) return 'approved';

  const map = {
    1: 'pending_operations_manager',
    2: 'pending_technical_director',
    3: 'pending_finance',
    4: 'pending_head_of_business',
    5: liters >= _cache.ceo_liters_threshold ? 'pending_ceo' : 'approved',
    6: 'approved',
  };

  return map[level] || 'approved';
}

/**
 * Map a status string to the human-readable approver label for emails.
 * Pulls the current name from the cache so this stays correct after an
 * approver is swapped via ApprovalChainConfig, instead of hardcoding names.
 */
function buildStatusLabels() {
  const byLevel = Object.fromEntries(_cache.steps.map(s => [s.level, s]));
  return {
    pending_diesel_coordinator: `Diesel Coordinator (${byLevel[1]?.name || '—'})`,
    pending_operations_manager: `Operations Manager (${byLevel[2]?.name || '—'})`,
    pending_technical_director: `Technical Director (${byLevel[3]?.name || '—'})`,
    pending_finance:            `Finance Officer (${byLevel[4]?.name || '—'})`,
    pending_head_of_business:   `Head of Business (${byLevel[5]?.name || '—'})`,
    pending_ceo:                `CEO (${byLevel[6]?.name || '—'})`,
  };
}
// STATUS_LABEL kept as a getter-backed object so existing `STATUS_LABEL['pending_finance']`
// call sites keep working without change, while still reflecting live cache data.
const STATUS_LABEL = new Proxy({}, {
  get: (_target, prop) => buildStatusLabels()[prop],
});

/**
 * Flat array of all current chain members (for email notifications).
 * Reads from the live cache instead of a hardcoded array.
 */
function getApprovalChainFlat() {
  return _cache.steps.map(s => ({ level: s.level, email: s.email, name: s.name, role: s.role }));
}
// APPROVAL_CHAIN kept as a getter-backed array-like Proxy for existing callers
// that do `APPROVAL_CHAIN.map(...)` etc. without needing to call a function.
const APPROVAL_CHAIN = new Proxy([], {
  get: (_target, prop) => {
    const flat = getApprovalChainFlat();
    if (prop === 'length') return flat.length;
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return flat[Number(prop)];
    return flat[prop] ?? flat.constructor.prototype[prop];
  },
});

/**
 * Current CEO liters threshold (from cache — DB-backed once loaded).
 * Exposed as a getter function since the underlying value can change at
 * runtime; kept the plain-value export too for any caller that just reads
 * it once at require-time (those will get the value AT THAT MOMENT, which
 * in practice is the correct default since this module's initial cache
 * load happens synchronously from DEFAULT_APPROVERS before any async
 * DB load resolves).
 */
function getCeoLitersThreshold() {
  return _cache.ceo_liters_threshold;
}

module.exports = {
  APPROVAL_CHAIN,
  getFuelRequestApprovalChain,
  getNextStatus,
  STATUS_LABEL,
  CEO_LITERS_THRESHOLD: DEFAULT_CEO_LITERS_THRESHOLD, // static fallback export, kept for compatibility
  getCeoLitersThreshold,                              // live value — prefer this over the static export above
  FUEL_PRICE_PER_LITER,
  refreshApprovalChainConfig,
  DEFAULT_APPROVERS,
  // Individual named exports below are DEPRECATED — kept only so any other
  // file still doing `const { FINANCE_OFFICER } = require(...)` doesn't
  // crash. They reflect the DEFAULT (hardcoded) approvers, not the live
  // DB-configured ones — prefer getFuelRequestApprovalChain()/getApprovalChainFlat()
  // for anything that needs the CURRENT approver.
  CEO:               DEFAULT_APPROVERS[5],
  FINANCE_OFFICER:   DEFAULT_APPROVERS[3],
  HEAD_OF_BUSINESS:  DEFAULT_APPROVERS[4],
};
