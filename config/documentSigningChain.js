// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/documentSigningChain.js
//
// Builds the ordered signer list for a SignableDocument.
//
// Two modes:
//   'hierarchical' — reuses getApprovalChainFromStructure() (the same walk
//                     used by cash requests: supervisor -> dept head -> ...)
//                     as the BASE list, then merges in any uploader-selected
//                     extra signers at the positions the uploader chose.
//   'custom'        — the uploader has picked the full list of signers,
//                     in order, themselves. No hierarchy is auto-injected.
//
// In both modes, the FINAL list the client sends us is already a single
// flat ordered array — building "extras insertion" is a client-side
// concern (the placement UI lets the uploader drag people into any slot).
// The server's job here is to:
//   1. If hierarchical + no custom list provided, derive the base chain.
//   2. Re-number levels 1..N sequentially (no gaps).
//   3. Snapshot each signer's name/email/role/department.
//   4. Generate a unique access token per signer.
//   5. Validate every signer actually exists and is an internal user
//      (signing is restricted to people in the system).
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const User = require('../models/User');
const { getApprovalChainFromStructure } = require('./departmentStructure');

/**
 * Build the final signer array for a SignableDocument.
 *
 * @param {Object} opts
 * @param {String} opts.initiatorEmail   - email of the employee uploading the doc
 * @param {String} opts.chainMode        - 'hierarchical' | 'custom'
 * @param {Array}  opts.requestedSigners - ordered array of { userId, isExtra? }
 *                                         from the client. For 'hierarchical' mode
 *                                         this represents: hierarchy base list
 *                                         WITH the uploader's extras already
 *                                         merged into position by the client UI.
 *                                         For 'custom' mode this IS the full chain.
 * @returns {Promise<{ success: boolean, signers?: Array, error?: String }>}
 */
const buildSignerChain = async ({ initiatorEmail, chainMode, requestedSigners }) => {
  console.log(`\n=== BUILDING DOCUMENT SIGNING CHAIN (mode: ${chainMode}) ===`);

  if (!['hierarchical', 'custom'].includes(chainMode)) {
    return { success: false, error: `Invalid chainMode: ${chainMode}` };
  }

  let orderedList = Array.isArray(requestedSigners) ? [...requestedSigners] : [];

  // ── Hierarchical mode with no client-provided list: derive it server-side ──
  // (This is the path used when the uploader didn't customize anything at all —
  //  pure default hierarchy, no extras.)
  if (chainMode === 'hierarchical' && orderedList.length === 0) {
    const baseChain = getApprovalChainFromStructure(initiatorEmail);
    if (!baseChain || baseChain.length === 0) {
      return {
        success: false,
        error: `No hierarchical approval chain found for ${initiatorEmail}. Add this employee to departmentStructure.js, or use custom chain mode.`
      };
    }
    // baseChain entries look like { level, approver: { name, email, role, department } }
    orderedList = baseChain.map(step => ({ email: step.approver.email, isExtra: false }));
  }

  if (orderedList.length === 0) {
    return { success: false, error: 'At least one signer is required' };
  }

  // ── Resolve every entry to a real, active, internal User ───────────────────
  // Signing is restricted to people in the system — no external/supplier
  // signers, per spec.
  const resolvedSigners = [];
  const seenEmails = new Set();

  for (let i = 0; i < orderedList.length; i++) {
    const entry = orderedList[i];
    const lookup = entry.userId
      ? await User.findById(entry.userId)
      : await User.findOne({ email: String(entry.email || '').toLowerCase().trim() });

    if (!lookup) {
      return { success: false, error: `Signer at position ${i + 1} not found in system (${entry.email || entry.userId})` };
    }
    if (!lookup.isActive) {
      return { success: false, error: `Signer ${lookup.fullName} (${lookup.email}) is not an active user` };
    }
    if (lookup.role === 'supplier') {
      return { success: false, error: `Signer ${lookup.fullName} is a supplier account — signing is restricted to internal employees` };
    }

    const emailKey = lookup.email.toLowerCase();
    if (seenEmails.has(emailKey)) {
      return { success: false, error: `${lookup.fullName} (${lookup.email}) appears more than once in the signer list` };
    }
    seenEmails.add(emailKey);

    resolvedSigners.push({
      level: i + 1, // re-numbered sequentially — no gaps regardless of input order
      user: lookup._id,
      name: lookup.fullName,
      email: lookup.email,
      role: lookup.position || lookup.role,
      department: lookup.department || '',
      isExtra: !!entry.isExtra,
      status: 'pending',
      accessToken: crypto.randomBytes(32).toString('hex')
    });
  }

  console.log(`✅ Chain built: ${resolvedSigners.length} signer(s)`);
  resolvedSigners.forEach(s => console.log(`   L${s.level}: ${s.name} (${s.email})${s.isExtra ? ' [EXTRA]' : ''}`));

  return { success: true, signers: resolvedSigners };
};

/**
 * Preview the default hierarchical chain for an employee WITHOUT building
 * tokens — used by the frontend to pre-populate the placement UI before the
 * uploader decides whether to customize it.
 */
const previewHierarchicalChain = (employeeEmail) => {
  const baseChain = getApprovalChainFromStructure(employeeEmail);
  if (!baseChain || baseChain.length === 0) return [];
  return baseChain.map((step, idx) => ({
    level: idx + 1,
    email: step.approver.email,
    name: step.approver.name,
    role: step.approver.role,
    department: step.approver.department,
    isExtra: false
  }));
};

module.exports = {
  buildSignerChain,
  previewHierarchicalChain
};