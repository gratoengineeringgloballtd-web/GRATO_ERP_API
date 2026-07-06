// ═══════════════════════════════════════════════════════════════════════════
// FILE: services/userDelegationService.js  (NEW FILE)
//
// PURPOSE: Core business logic for user-to-user delegation:
//
//   transferInFlightApprovals()   — when A delegates to B, find every
//     pending approval step across all models where A is the current
//     approver and swap it to B.
//
//   revertInFlightApprovals()     — when a delegation is revoked, swap
//     those steps back to A.
//
//   isActionLocked()              — returns true if a user has delegated
//     a process type and therefore cannot act on it directly.
//
//   resolveSubmitterIdentity()    — given an acting user and an optional
//     onBehalfOf target, validates the delegation and returns the identity
//     (principal's user object) to use when building the approval chain.
//
//   buildOnBehalfOfNote()         — formats the standard audit string.
// ═══════════════════════════════════════════════════════════════════════════

const UserDelegation    = require('../models/UserDelegation');
const User              = require('../models/User');
const { sendEmail }     = require('./emailService');
const {
  PROCESS_TYPE_MODEL_CONFIG,
  getAllProcessTypeKeys,
  DELEGATION_PROCESS_TYPES,
}  = require('../config/delegationProcessTypes');


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a document and its model config, find the approval chain step
 * currently waiting for `approverEmail`, but ONLY if it is the active step.
 */
function findActiveStepForApprover(doc, approverEmail, config) {
  const emailLower = approverEmail.toLowerCase();

  const step = doc.approvalChain?.find(
    (s) =>
      String(s.approver?.email || '').toLowerCase() === emailLower &&
      s.status === 'pending'
  );
  if (!step) return null;

  // Is this step currently active?
  if (config.useCurrentLevel) {
    return doc.currentApprovalLevel === step.level ? step : null;
  }

  // First-pending-wins strategy
  const firstPending = [...(doc.approvalChain || [])]
    .filter((s) => s.status === 'pending')
    .sort((a, b) => a.level - b.level)[0];

  return firstPending?.level === step.level ? step : null;
}

/**
 * Load a Mongoose model by name, returning null if not found (graceful skip).
 */
function safeRequireModel(modelName) {
  try {
    return require(`../models/${modelName}`);
  } catch {
    try {
      const mongoose = require('mongoose');
      return mongoose.model(modelName);
    } catch {
      console.warn(`[UserDelegation] Model "${modelName}" not found — skipping`);
      return null;
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// transferInFlightApprovals()
//
// Called when a delegation is first activated (or when new process types
// are added to an existing delegation).
//
// For each covered process type:
//   1. Query the model for documents where delegatorEmail has an active
//      pending approval step.
//   2. Swap that step's approver to the delegate.
//   3. Save.
//
// Returns a summary used to populate delegation.transferSummary.
// ─────────────────────────────────────────────────────────────────────────────
const transferInFlightApprovals = async (delegation, processTypesToTransfer = null) => {
  const {
    delegatorEmail,
    delegatorName,
    delegateEmail,
    delegateName,
    _id: delegationId,
  } = delegation;

  const typesToProcess = processTypesToTransfer || delegation.getCoveredTypes();
  const summary        = { totalTransferred: 0, byType: [] };

  // Grouped by delegate for consolidated email notification
  // (currently only one delegate per delegation, but structured for extensibility)
  const notificationItems = [];

  for (const processType of typesToProcess) {
    const config = PROCESS_TYPE_MODEL_CONFIG[processType];
    if (!config) continue;

    const Model = safeRequireModel(config.modelName);
    if (!Model) continue;

    try {
      const query = {
        approvalChain: {
          $elemMatch: {
            'approver.email': delegatorEmail.toLowerCase(),
            status:           'pending',
          },
        },
        ...(config.extraQuery || {}),
      };

      // Exclude terminal statuses to avoid touching closed docs
      if (config.statusField && config.terminalStatuses?.length) {
        query[config.statusField] = { $nin: config.terminalStatuses };
      }

      const docs = await Model.find(query).lean(false);
      let transferred = 0;
      const items     = [];

      for (const doc of docs) {
        const step = findActiveStepForApprover(doc, delegatorEmail, config);
        if (!step) continue;

        // Record who originally held this step (for revert)
        step.delegatedFrom = {
          email:        delegatorEmail.toLowerCase(),
          name:         delegatorName,
          delegationId: delegationId.toString(),
        };

        // Transfer to delegate
        step.approver.email = delegateEmail.toLowerCase();
        step.approver.name  = delegateName;
        // Keep role/dept for display — just mark as delegated
        step.approver.role  = `${step.approver.role || 'Approver'} (Delegated)`;

        await doc.save();
        transferred++;

        const displayId = doc.displayId || doc._id.toString().slice(-8).toUpperCase();
        items.push({ id: displayId, amount: _extractAmount(doc, processType) });
      }

      summary.totalTransferred += transferred;
      summary.byType.push({ processType, transferred });

      if (transferred > 0) {
        notificationItems.push({
          label:       DELEGATION_PROCESS_TYPES[processType]?.label || processType,
          transferred,
          details:     items,
        });
      }
    } catch (err) {
      console.error(`[UserDelegation] Transfer error for "${processType}":`, err.message);
      summary.byType.push({ processType, transferred: 0, error: err.message });
    }
  }

  // Send notification to delegate
  if (notificationItems.length > 0) {
    await _sendTransferNotification(
      delegateEmail,
      delegateName,
      delegatorName,
      notificationItems,
      'delegation_activated'
    ).catch((e) =>
      console.error('[UserDelegation] Notification error:', e.message)
    );
  }

  return summary;
};


// ─────────────────────────────────────────────────────────────────────────────
// revertInFlightApprovals()
//
// Called when a delegation is revoked or expired.
// Finds steps that were transferred under THIS delegation and reverts them
// to the original delegator's email.
// ─────────────────────────────────────────────────────────────────────────────
const revertInFlightApprovals = async (delegation) => {
  const {
    delegatorEmail,
    delegatorName,
    delegateEmail,
    _id: delegationId,
  } = delegation;

  const typesToProcess = delegation.getCoveredTypes();
  let totalReverted    = 0;

  for (const processType of typesToProcess) {
    const config = PROCESS_TYPE_MODEL_CONFIG[processType];
    if (!config) continue;

    const Model = safeRequireModel(config.modelName);
    if (!Model) continue;

    try {
      // Find docs where:
      // - current approver is the delegate
      // - step has a delegatedFrom referencing this delegation
      const docs = await Model.find({
        approvalChain: {
          $elemMatch: {
            'approver.email':            delegateEmail.toLowerCase(),
            'delegatedFrom.delegationId': delegationId.toString(),
            status:                       'pending',
          },
        },
        ...(config.extraQuery || {}),
      }).lean(false);

      for (const doc of docs) {
        const step = doc.approvalChain?.find(
          (s) =>
            String(s.approver?.email || '').toLowerCase() ===
              delegateEmail.toLowerCase() &&
            s.status === 'pending' &&
            s.delegatedFrom?.delegationId === delegationId.toString()
        );
        if (!step) continue;

        // Revert
        step.approver.email = delegatorEmail.toLowerCase();
        step.approver.name  = delegatorName;
        // Strip the "(Delegated)" suffix from role if present
        step.approver.role  = (step.approver.role || '').replace(' (Delegated)', '');
        step.delegatedFrom  = undefined;

        await doc.save();
        totalReverted++;
      }
    } catch (err) {
      console.error(`[UserDelegation] Revert error for "${processType}":`, err.message);
    }
  }

  return { totalReverted };
};


// ─────────────────────────────────────────────────────────────────────────────
// isActionLocked()
//
// Returns true when `userEmail` has an active delegation for `processType`,
// meaning they cannot directly submit or approve in that process themselves.
//
// `actionType`: 'submission' | 'approval' | 'any' (default)
// ─────────────────────────────────────────────────────────────────────────────
const isActionLocked = async (userEmail, processType, actionType = 'any') => {
  const delegations = await UserDelegation.findOutgoing(userEmail);
  return delegations.some((d) => d.coversProcessType(processType));
};


// ─────────────────────────────────────────────────────────────────────────────
// resolveSubmitterIdentity()
//
// When B submits a request on behalf of A:
//   - Validates B has an active delegation from A for this process type
//   - Returns A's full user object (to use for chain building, dept lookup, etc.)
//   - Returns B's user object as the "submittedBy" actor
//
// Throws a descriptive error if validation fails.
// ─────────────────────────────────────────────────────────────────────────────
const resolveSubmitterIdentity = async (
  actingUserEmail,  // B — the person making the API call
  onBehalfOfEmail,  // A — the person whose identity should be used
  processType
) => {
  if (!onBehalfOfEmail) {
    // No delegation — acting as themselves
    return { principal: null, isBehalf: false };
  }

  // Validate delegation exists
  const delegation = await UserDelegation.findActiveDelegation(
    onBehalfOfEmail,
    actingUserEmail,
    processType
  );

  if (!delegation) {
    throw new Error(
      `You do not have an active delegation from ${onBehalfOfEmail} ` +
      `for process type "${processType}".`
    );
  }

  // Load the principal (A)
  const principal = await User.findOne({ email: onBehalfOfEmail.toLowerCase() })
    .select('fullName email department position role supervisor hierarchyPath hierarchyLevel approvalCapacities');

  if (!principal) {
    throw new Error(`Principal user "${onBehalfOfEmail}" not found.`);
  }

  return {
    principal,
    delegation,
    isBehalf: true,
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// buildOnBehalfOfNote()
//
// Returns the standard audit note added to approval step comments and
// document-level audit fields whenever B acts on behalf of A.
// ─────────────────────────────────────────────────────────────────────────────
const buildOnBehalfOfNote = (delegateName, delegatorName) =>
  `Action performed by ${delegateName} on behalf of ${delegatorName}`;


// ─────────────────────────────────────────────────────────────────────────────
// getDelegationSummaryForUser()
//
// Returns a consolidated view of all delegations a user is involved in —
// both outgoing (they delegated) and incoming (delegated to them).
// Used by the settings page and the dashboard context.
// ─────────────────────────────────────────────────────────────────────────────
const getDelegationSummaryForUser = async (userEmail) => {
  const [outgoing, incoming] = await Promise.all([
    UserDelegation.findOutgoing(userEmail),
    UserDelegation.findIncoming(userEmail),
  ]);

  // Compute which of the user's own process types are locked
  const lockedTypes = new Set();
  outgoing.forEach((d) => {
    d.getCoveredTypes().forEach((t) => lockedTypes.add(t));
  });

  return {
    outgoing:    outgoing,
    incoming:    incoming,
    lockedTypes: [...lockedTypes],
    hasOutgoing: outgoing.length > 0,
    hasIncoming: incoming.length > 0,
    isFullyDelegated:
      outgoing.some((d) => d.scope === 'all' && d.isActive),
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// getPendingItemsForDelegate()
//
// Returns all items in a given process type that are currently awaiting
// `delegateEmail`'s action AS A DELEGATE (i.e. steps transferred from
// another user's chain).
//
// Used to populate the "Delegated to Me" panel on module pages.
// ─────────────────────────────────────────────────────────────────────────────
const getPendingItemsForDelegate = async (delegateEmail, processType) => {
  const config = PROCESS_TYPE_MODEL_CONFIG[processType];
  if (!config) return [];

  const Model = safeRequireModel(config.modelName);
  if (!Model) return [];

  try {
    // Items delegated to this user show:
    // - approver.email === delegateEmail
    // - step.delegatedFrom is set (meaning it was transferred)
    const query = {
      approvalChain: {
        $elemMatch: {
          'approver.email':      delegateEmail.toLowerCase(),
          'delegatedFrom.email': { $exists: true },
          status:                'pending',
        },
      },
      ...(config.extraQuery || {}),
    };

    if (config.statusField && config.terminalStatuses?.length) {
      query[config.statusField] = { $nin: config.terminalStatuses };
    }

    return await Model.find(query)
      .populate(config.employeeField, 'fullName email department position')
      .sort({ createdAt: -1 })
      .limit(50);
  } catch (err) {
    console.error(`[UserDelegation] getPendingItems error for "${processType}":`, err.message);
    return [];
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _extractAmount(doc, processType) {
  const amountFields = {
    cash_request:         'amountRequested',
    purchase_requisition: 'budgetXAF',
    invoice:              'totalAmount',
    purchase_order:       'totalAmount',
    debit_note:           'debitAmount',
    budget_code:          'budget',
    salary_payment:       'totalAmount',
  };
  const field = amountFields[processType];
  if (!field || !doc[field]) return null;
  return `${Number(doc[field]).toLocaleString()} XAF`;
}

async function _sendTransferNotification(toEmail, toName, fromName, items, eventType) {
  const totalTransferred = items.reduce((s, i) => s + i.transferred, 0);
  const isActivation     = eventType === 'delegation_activated';

  const itemRows = items.map(({ label, transferred, details }) => {
    const detailList = details
      .map((d) => `<li>${d.id}${d.amount ? ` — ${d.amount}` : ''}</li>`)
      .join('');
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;">${label}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">
          <span style="background:#1890ff;color:#fff;padding:2px 10px;border-radius:12px;">${transferred}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#555;">
          <ul style="margin:0;padding-left:16px;">${detailList}</ul>
        </td>
      </tr>`;
  }).join('');

  await sendEmail({
    to:      toEmail,
    subject: isActivation
      ? `[Action Required] ${totalTransferred} request(s) delegated to you by ${fromName}`
      : `[Resolved] Delegated requests returned to ${fromName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:28px 32px;border-radius:12px 12px 0 0;">
          <h2 style="color:#1890ff;margin:0 0 8px;">
            ${isActivation ? '🔄 Approval Steps Delegated to You' : '✅ Delegated Steps Returned'}
          </h2>
          <p style="color:rgba(255,255,255,0.65);margin:0;font-size:14px;">
            ${isActivation
              ? `${fromName} has delegated ${totalTransferred} pending approval step(s) to you.`
              : `${totalTransferred} approval step(s) have been returned to ${fromName}.`}
          </p>
        </div>
        <div style="border:1px solid #e8e8e8;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
          <p>Dear <strong>${toName}</strong>,</p>
          <p>${isActivation
            ? `<strong>${fromName}</strong> has set you as their delegate and the following requests are now awaiting your action.`
            : `The following requests previously delegated to you have been returned to <strong>${fromName}</strong>.`}
          </p>

          <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #f0f0f0;border-radius:8px;">
            <thead>
              <tr style="background:#fafafa;">
                <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #f0f0f0;">Type</th>
                <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #f0f0f0;width:90px;">Count</th>
                <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #f0f0f0;">Request IDs</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          ${isActivation ? `
          <div style="background:#e6f7ff;border-left:4px solid #1890ff;padding:14px 18px;border-radius:4px;margin:20px 0;">
            <p style="margin:0 0 6px;font-weight:600;">What this means:</p>
            <ul style="margin:0;padding-left:18px;color:#555;font-size:13px;line-height:1.7;">
              <li>These requests appear in your <strong>Delegated to Me</strong> queue.</li>
              <li>You can approve or reject them <strong>on behalf of ${fromName}</strong>.</li>
              <li>Your name will appear as the approver with a note: "on behalf of ${fromName}".</li>
            </ul>
          </div>` : ''}

          <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #f0f0f0;padding-top:16px;">
            Automated notification from the Grato Engineering ERP system.
          </p>
        </div>
      </div>
    `,
  });
}


module.exports = {
  transferInFlightApprovals,
  revertInFlightApprovals,
  isActionLocked,
  resolveSubmitterIdentity,
  buildOnBehalfOfNote,
  getDelegationSummaryForUser,
  getPendingItemsForDelegate,
};