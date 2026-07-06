// ═══════════════════════════════════════════════════════════════════════════
// FILE: services/ceoTypeDelegationService.js  (NEW FILE)
// PURPOSE: Handles per-type CEO delegation:
//   - Finds all in-flight requests currently sitting at Tom's approval step
//     for one or more specified request types
//   - Swaps Tom's approver slot to the new delegate
//   - Sends a summary notification email to the delegate
//
// Called by: routes/ceoAvailabilityRoutes.js (PUT /api/ceo/type-delegations)
// ═══════════════════════════════════════════════════════════════════════════

const { CEO } = require('../config/ceoApprovalConfig');
const { sendEmail } = require('./emailService');

// ─────────────────────────────────────────────────────────────────────────────
// MODEL REGISTRY
//
// useCurrentLevel: true  → the model has a `currentApprovalLevel` field;
//                          the CEO step is "active" only when
//                          ceoStep.level === doc.currentApprovalLevel
//
// useCurrentLevel: false → no currentApprovalLevel field; the CEO step is
//                          "active" when it is the first `status:'pending'`
//                          entry in the sorted chain
//
// extraQuery             → additional Mongoose query conditions (e.g. supplier
//                          records live in the User model, not a separate one)
// ─────────────────────────────────────────────────────────────────────────────
const REQUEST_TYPE_MODEL_MAP = {
  cash_request: {
    modelName:       'CashRequest',
    useCurrentLevel: false,
  },
  purchase_requisition: {
    modelName:       'PurchaseRequisition',
    useCurrentLevel: false,
  },
  invoice: {
    modelName:       'Invoice',
    useCurrentLevel: true,
  },
  purchase_order: {
    modelName:       'PurchaseOrder',
    useCurrentLevel: true,
  },
  debit_note: {
    modelName:       'DebitNote',
    useCurrentLevel: true,
  },
  budget_code: {
    modelName:       'BudgetCode',
    useCurrentLevel: false,
  },
  supplier: {
    modelName:       'User',
    useCurrentLevel: true,
    extraQuery:      { role: 'supplier' },
  },
  // ─── Add entries below when these models exist ────────────────────────────
  // salary_payment:  { modelName: 'SalaryPayment',  useCurrentLevel: true  },
  // budget_transfer: { modelName: 'BudgetTransfer', useCurrentLevel: true  },
  // project_plan:    { modelName: 'ProjectPlan',    useCurrentLevel: false },
};

// Human-readable labels used in the notification email
const TYPE_LABELS = {
  cash_request:         'Cash Requests',
  purchase_requisition: 'Purchase Requisitions',
  invoice:              'Supplier Invoices',
  purchase_order:       'Purchase Orders',
  debit_note:           'Debit Notes',
  budget_code:          'Budget Codes',
  supplier:             'Supplier Onboarding',
  salary_payment:       'Salary Payments',
  budget_transfer:      'Budget Transfers',
  project_plan:         'Project Plans',
};

// Field from which we read the monetary amount for display in the email
const AMOUNT_FIELD_MAP = {
  cash_request:         'amountRequested',
  purchase_requisition: 'budgetXAF',
  invoice:              'totalAmount',
  purchase_order:       'totalAmount',
  debit_note:           'debitAmount',
  budget_code:          'budget',
  supplier:             null,
};


// ─────────────────────────────────────────────────────────────────────────────
// transferInFlightRequests()
//
// Main exported function. Receives an array of delegation objects, each
// describing one request type and the delegate who should now handle it.
//
// For each type:
//   1. Queries the relevant model for documents where Tom has an active
//      pending approval step.
//   2. Swaps the approver on that step to the delegate.
//   3. Saves the document.
//   4. Sends a summary notification email to the delegate(s).
//
// @param {Array<{ requestType, delegateEmail, delegateName }>} delegations
// @returns {Promise<{ summary: Array, totalTransferred: number }>}
// ─────────────────────────────────────────────────────────────────────────────
const transferInFlightRequests = async (delegations) => {
  const results        = [];
  let   totalTransferred = 0;

  // Group by delegate so we can send one consolidated email per delegate
  // instead of one email per request type.
  // Shape: { [delegateEmail]: { delegateName, items: [{ label, transferred, details[] }] } }
  const delegateSummaryMap = {};

  for (const { requestType, delegateEmail, delegateName } of delegations) {
    const config = REQUEST_TYPE_MODEL_MAP[requestType];

    if (!config) {
      // Model not wired up yet — log and skip gracefully
      console.warn(`[ceoTypeDelegation] No model mapped for requestType "${requestType}" — skipping transfer`);
      results.push({ requestType, transferred: 0, skipped: true, reason: 'Model not implemented yet' });
      continue;
    }

    try {
      // Lazy-load model to avoid circular dependency issues at startup
      const Model = require(`../models/${config.modelName}`);

      // ── Find all documents where Tom has a pending chain step ─────────────
      const query = {
        approvalChain: {
          $elemMatch: {
            'approver.email': CEO.email.toLowerCase(),
            status: 'pending',
          },
        },
      };
      if (config.extraQuery) Object.assign(query, config.extraQuery);

      const docs = await Model.find(query).lean(false); // need full Mongoose docs for .save()

      let transferred    = 0;
      const transferredItems = [];

      for (const doc of docs) {
        // ── Locate Tom's step in this document ────────────────────────────
        const ceoStep = doc.approvalChain.find(
          s =>
            String(s.approver?.email || '').toLowerCase() === CEO.email.toLowerCase() &&
            s.status === 'pending'
        );
        if (!ceoStep) continue;

        // ── Verify it's the currently ACTIVE step ────────────────────────
        const isActiveStep = _isCEOStepActive(doc, ceoStep, config.useCurrentLevel);
        if (!isActiveStep) continue;

        // ── Mutate the step's approver to the delegate ────────────────────
        ceoStep.approver.name       = delegateName;
        ceoStep.approver.email      = delegateEmail.toLowerCase();
        ceoStep.approver.role       = 'Acting CEO (Delegate)';
        // Preserve department so chain display still makes sense
        ceoStep.approver.department = ceoStep.approver.department || 'CEO Office';

        await doc.save();
        transferred++;

        // Collect reference data for the notification email
        const displayId  = doc.displayId || doc._id.toString().slice(-8).toUpperCase();
        const amountField = AMOUNT_FIELD_MAP[requestType];
        const amount      = amountField && doc[amountField]
          ? Number(doc[amountField]).toLocaleString() + ' XAF'
          : null;
        transferredItems.push({ id: displayId, amount });
      }

      results.push({
        requestType,
        label:       TYPE_LABELS[requestType] || requestType,
        transferred,
      });
      totalTransferred += transferred;

      // Accumulate items per delegate for the notification email
      if (transferred > 0) {
        if (!delegateSummaryMap[delegateEmail]) {
          delegateSummaryMap[delegateEmail] = { delegateName, items: [] };
        }
        delegateSummaryMap[delegateEmail].items.push({
          label:       TYPE_LABELS[requestType] || requestType,
          transferred,
          details:     transferredItems,
        });
      }

    } catch (err) {
      console.error(`[ceoTypeDelegation] Error transferring "${requestType}":`, err.message);
      results.push({ requestType, transferred: 0, error: err.message });
    }
  }

  // ── Send one notification email per unique delegate ───────────────────────
  for (const [delegateEmail, { delegateName, items }] of Object.entries(delegateSummaryMap)) {
    await _sendTransferNotification(delegateEmail, delegateName, items).catch(err =>
      console.error('[ceoTypeDelegation] Notification email failed:', err.message)
    );
  }

  return { summary: results, totalTransferred };
};


// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether the given CEO chain step is the currently ACTIVE one,
 * i.e. it is Tom's turn right now (not queued behind other pending approvers).
 *
 * Strategy A (useCurrentLevel === true):
 *   The document has a `currentApprovalLevel` integer field.
 *   Active ↔ ceoStep.level === doc.currentApprovalLevel.
 *
 * Strategy B (useCurrentLevel === false):
 *   No explicit level pointer. Active ↔ ceoStep is the lowest-level
 *   pending step in the chain (i.e. all steps before it are approved).
 */
function _isCEOStepActive(doc, ceoStep, useCurrentLevel) {
  if (useCurrentLevel) {
    return doc.currentApprovalLevel === ceoStep.level;
  }

  // Find the first pending step by level; it should be the CEO step
  const pendingSteps  = doc.approvalChain
    .filter(s => s.status === 'pending')
    .sort((a, b) => a.level - b.level);

  return pendingSteps.length > 0 && pendingSteps[0].level === ceoStep.level;
}


/**
 * Sends a consolidated HTML notification email to a delegate listing every
 * request type and individual request that was just transferred to them.
 */
async function _sendTransferNotification(toEmail, toName, items) {
  const totalTransferred = items.reduce((sum, i) => sum + i.transferred, 0);

  const itemRows = items.map(({ label, transferred, details }) => {
    const detailList = details
      .map(d => `<li style="margin:2px 0;">${d.id}${d.amount ? ` — <em>${d.amount}</em>` : ''}</li>`)
      .join('');

    return `
      <tr>
        <td style="padding:12px 14px;border-bottom:1px solid #f0f0f0;font-weight:600;vertical-align:top;">
          ${label}
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #f0f0f0;text-align:center;vertical-align:top;">
          <span style="
            display:inline-block;background:#faad14;color:#fff;
            padding:2px 12px;border-radius:12px;font-weight:700;
          ">${transferred}</span>
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
          <ul style="margin:0;padding-left:16px;font-size:12px;color:#555;">
            ${detailList}
          </ul>
        </td>
      </tr>`;
  }).join('');

  await sendEmail({
    to:      toEmail,
    subject: `[Action Required] ${totalTransferred} Request(s) Transferred to You — CEO Delegation`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:660px;margin:0 auto;">

        <!-- Header -->
        <div style="
          background:linear-gradient(135deg,#0a0a1a,#1a1a3e);
          padding:28px 32px;border-radius:12px 12px 0 0;
        ">
          <h2 style="color:#faad14;margin:0 0 8px;">🏛️ CEO Approval Delegation</h2>
          <p style="color:rgba(255,255,255,0.65);margin:0;font-size:14px;">
            ${totalTransferred} request(s) have been transferred to your approval queue.
          </p>
        </div>

        <!-- Body -->
        <div style="
          border:1px solid #e8e8e8;border-top:none;
          padding:28px 32px;border-radius:0 0 12px 12px;
        ">
          <p>Dear <strong>${toName}</strong>,</p>
          <p>
            Mr. Tom has delegated his final approval authority to you for the request types
            listed below. The requests that were currently awaiting his signature have been
            <strong>transferred to your approval queue</strong> immediately.
          </p>

          <!-- Transfer summary table -->
          <table style="width:100%;border-collapse:collapse;margin:20px 0;border-radius:8px;overflow:hidden;border:1px solid #f0f0f0;">
            <thead>
              <tr style="background:#fafafa;">
                <th style="padding:12px 14px;text-align:left;border-bottom:2px solid #f0f0f0;font-size:13px;">
                  Request Type
                </th>
                <th style="padding:12px 14px;text-align:center;border-bottom:2px solid #f0f0f0;font-size:13px;width:100px;">
                  Transferred
                </th>
                <th style="padding:12px 14px;text-align:left;border-bottom:2px solid #f0f0f0;font-size:13px;">
                  Request IDs
                </th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <!-- Info callout -->
          <div style="
            background:#fff7e6;border-left:4px solid #faad14;
            padding:14px 18px;border-radius:4px;margin:20px 0;
          ">
            <p style="margin:0 0 6px;font-weight:600;">What this means for you:</p>
            <ul style="margin:0;padding-left:18px;color:#555;font-size:13px;line-height:1.7;">
              <li>These requests now appear under your <strong>Pending Approvals</strong> in the ERP.</li>
              <li>You have full authority to <strong>approve or reject</strong> them on Mr. Tom's behalf.</li>
              <li>Mr. Tom may still receive read-only copies of approval notifications.</li>
            </ul>
          </div>

          <p style="color:#888;font-size:12px;margin-top:28px;border-top:1px solid #f0f0f0;padding-top:16px;">
            This is an automated notification from the Grato Engineering ERP system.
            Do not reply to this email.
          </p>
        </div>

      </div>
    `,
  });
}


module.exports = {
  transferInFlightRequests,
  REQUEST_TYPE_MODEL_MAP,
  TYPE_LABELS,
};