// ═══════════════════════════════════════════════════════════════════════════
// FILE: routes/ceoAvailabilityRoutes.js
// VERSION: 2.0 — Added per-type delegation endpoints
//
// New endpoints (all prefixed /api/ceo):
//   GET  /type-delegations          → returns current per-type delegations
//   PUT  /type-delegations          → upsert/replace active type delegations
//                                     + triggers in-flight transfer
//   DELETE /type-delegations/:type  → remove delegation for a single type
//                                     + re-assigns back to Tom in-flight
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const User    = require('../models/User');
const {
  CEO_ESCALATION_TIMEOUTS,
  CEO,
  DEFAULT_CEO_DELEGATE,
  CEO_THRESHOLDS,
} = require('../config/ceoApprovalConfig');
const { sendEmail } = require('../services/emailService');
const {
  transferInFlightRequests,
  TYPE_LABELS,
} = require('../services/ceoTypeDelegationService');


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ceo/availability
// ─────────────────────────────────────────────────────────────────────────────
router.get('/availability', authMiddleware, requireRoles('ceo', 'admin'), async (req, res) => {
  try {
    const ceoUser = await User.findOne({ email: CEO.email })
      .select('fullName email ceoAvailability');

    if (!ceoUser) {
      return res.status(404).json({ success: false, message: 'CEO user not found' });
    }

    const av          = ceoUser.ceoAvailability || {};
    const hasDelegate = ceoUser.hasActiveDelegate?.() ?? false;

    res.json({
      success: true,
      data: {
        isAvailable:          !av.isUnavailable,
        isUnavailable:        av.isUnavailable || false,
        unavailabilityReason: av.unavailabilityReason || null,
        unavailableFrom:      av.unavailableFrom || null,
        unavailableUntil:     av.unavailableUntil || null,
        hasActiveDelegate:    hasDelegate,
        delegateEmail:        hasDelegate ? av.delegateEmail : null,
        delegateName:         hasDelegate ? av.delegateName  : null,
        keepTomInformed:      av.keepTomInformed !== false,
        autoEscalation:       av.autoEscalation  || {},
        delegationHistory:    av.delegationHistory || [],
        typeDelegations:      av.typeDelegations  || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/ceo/availability
// ─────────────────────────────────────────────────────────────────────────────
router.put('/availability', authMiddleware, requireRoles('ceo'), async (req, res) => {
  try {
    const {
      isUnavailable,
      unavailabilityReason,
      unavailableFrom,
      unavailableUntil,
      delegateEmail,
      keepTomInformed,
    } = req.body;

    const ceoUser = await User.findOne({ email: CEO.email });
    if (!ceoUser) {
      return res.status(404).json({ success: false, message: 'CEO user not found' });
    }

    // Resolve delegate name
    let delegateName = DEFAULT_CEO_DELEGATE.name;
    if (delegateEmail) {
      const delegateUser = await User.findOne({ email: delegateEmail }).select('fullName');
      if (!delegateUser) {
        return res.status(400).json({
          success: false,
          message: `Delegate user with email "${delegateEmail}" not found`,
        });
      }
      delegateName = delegateUser.fullName;
    }

    const avUpdate = {
      isUnavailable:        Boolean(isUnavailable),
      unavailabilityReason: unavailabilityReason || '',
      unavailableFrom:      unavailableFrom ? new Date(unavailableFrom) : new Date(),
      unavailableUntil:     unavailableUntil ? new Date(unavailableUntil) : null,
      delegateEmail:        delegateEmail   || DEFAULT_CEO_DELEGATE.email,
      delegateName,
      keepTomInformed:      keepTomInformed !== false,
      notifyDelegate:       true,
      lastUpdatedAt:        new Date(),
      lastUpdatedBy:        req.user.email,
    };

    // Push to delegation history when going unavailable
    if (isUnavailable && !ceoUser.ceoAvailability?.isUnavailable) {
      avUpdate.$push = {
        'ceoAvailability.delegationHistory': {
          delegateEmail:  avUpdate.delegateEmail,
          delegateName:   avUpdate.delegateName,
          reason:         avUpdate.unavailabilityReason,
          from:           avUpdate.unavailableFrom,
          until:          avUpdate.unavailableUntil,
        },
      };
    }

    // Stamp clearedAt on last history entry when returning
    if (!isUnavailable && ceoUser.ceoAvailability?.isUnavailable) {
      const history = ceoUser.ceoAvailability.delegationHistory || [];
      if (history.length > 0) {
        history[history.length - 1].clearedAt = new Date();
        history[history.length - 1].clearedBy = req.user.email;
        avUpdate['ceoAvailability.delegationHistory'] = history;
      }
    }

    await User.findOneAndUpdate(
      { email: CEO.email },
      { $set: { ceoAvailability: avUpdate } },
      { new: true }
    );

    if (isUnavailable && avUpdate.delegateEmail) {
      await _sendDelegationNotification(
        avUpdate.delegateEmail,
        avUpdate.delegateName,
        avUpdate.unavailabilityReason,
        avUpdate.unavailableFrom,
        avUpdate.unavailableUntil
      );
    }

    res.json({
      success: true,
      message: isUnavailable
        ? `Global delegation activated — ${delegateName} will handle all CEO approvals`
        : 'CEO availability restored — global delegation cleared',
      data: avUpdate,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/ceo/availability/auto-escalation
// ─────────────────────────────────────────────────────────────────────────────
router.put('/availability/auto-escalation', authMiddleware, requireRoles('ceo', 'admin'), async (req, res) => {
  try {
    const { enabled, reminderAfterDays, autoDelegateAfterDays } = req.body;

    await User.findOneAndUpdate(
      { email: CEO.email },
      {
        $set: {
          'ceoAvailability.autoEscalation.enabled':               enabled !== false,
          'ceoAvailability.autoEscalation.reminderAfterDays':     reminderAfterDays    || CEO_ESCALATION_TIMEOUTS.reminderAfterDays,
          'ceoAvailability.autoEscalation.autoDelegateAfterDays': autoDelegateAfterDays || CEO_ESCALATION_TIMEOUTS.autoDelegateAfterDays,
        },
      }
    );

    res.json({ success: true, message: 'Auto-escalation settings updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ceo/thresholds
// ─────────────────────────────────────────────────────────────────────────────
router.get('/thresholds', authMiddleware, requireRoles('ceo', 'admin', 'finance'), async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        thresholds: CEO_THRESHOLDS,
        timeouts:   CEO_ESCALATION_TIMEOUTS,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


router.get('/my-delegations', authMiddleware, async (req, res) => {
  try {
    const currentUserEmail = (req.user?.email || '').toLowerCase().trim();
 
    if (!currentUserEmail) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
 
    // CEOs see everything natively — no delegation data needed
    if (req.user?.role === 'ceo') {
      return res.json({
        success: true,
        data: { isGlobalDelegate: false, delegatedTypes: [] },
      });
    }
 
    const ceoUser = await User.findOne({ email: CEO.email })
      .select('ceoAvailability fullName');
 
    if (!ceoUser) {
      // CEO user doesn't exist yet — no delegations possible
      return res.json({
        success: true,
        data: { isGlobalDelegate: false, delegatedTypes: [] },
      });
    }
 
    const av = ceoUser.ceoAvailability || {};
    const result = { isGlobalDelegate: false, delegatedTypes: [] };
 
    // ── Check GLOBAL delegation ───────────────────────────────────────────
    if (
      av.isUnavailable &&
      av.delegateEmail &&
      av.delegateEmail.toLowerCase().trim() === currentUserEmail
    ) {
      // Verify the unavailability period hasn't expired
      const notExpired =
        !av.unavailableUntil || new Date(av.unavailableUntil) > new Date();
 
      if (notExpired) {
        result.isGlobalDelegate = true;
      }
    }
 
    // ── Check PER-TYPE delegations ────────────────────────────────────────
    const typeDelegations = av.typeDelegations || [];
 
    const myTypeDelegations = typeDelegations.filter(
      (d) =>
        d.delegateEmail &&
        d.delegateEmail.toLowerCase().trim() === currentUserEmail
    );
 
    result.delegatedTypes = myTypeDelegations.map((d) => ({
      requestType: d.requestType,
      label:       TYPE_LABELS[d.requestType] || d.requestType,
      delegatedAt: d.delegatedAt,
      reason:      d.reason || null,
      delegatedBy: ceoUser.fullName || CEO.name,
    }));
 
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[ceo/my-delegations] Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// PER-TYPE DELEGATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ceo/type-delegations
// Returns the current list of per-type delegations and which request types are
// eligible for delegation (i.e. not neverEscalate).
// Accessible to: CEO, Admin
// ─────────────────────────────────────────────────────────────────────────────
router.get('/type-delegations', authMiddleware, requireRoles('ceo', 'admin'), async (req, res) => {
  try {
    const ceoUser = await User.findOne({ email: CEO.email })
      .select('ceoAvailability');

    if (!ceoUser) {
      return res.status(404).json({ success: false, message: 'CEO user not found' });
    }

    const typeDelegations = ceoUser.ceoAvailability?.typeDelegations || [];

    // Build the full eligible-types list so the frontend can render the table
    // without needing to know the threshold config itself.
    const eligibleTypes = Object.entries(CEO_THRESHOLDS)
      .filter(([, cfg]) => !cfg.neverEscalate)
      .map(([type, cfg]) => {
        const active = typeDelegations.find(d => d.requestType === type);
        return {
          requestType:     type,
          label:           TYPE_LABELS[type] || type,
          description:     cfg.description,
          alwaysEscalate:  cfg.alwaysEscalate || false,
          minAmountForCEO: cfg.minAmountForCEO || null,
          currency:        cfg.currency || 'XAF',
          // Currently active delegation for this type (null if Tom handles it himself)
          activeDelegation: active
            ? {
                delegateEmail: active.delegateEmail,
                delegateName:  active.delegateName,
                delegatedAt:   active.delegatedAt,
                reason:        active.reason,
              }
            : null,
        };
      });

    res.json({
      success: true,
      data: {
        typeDelegations,
        eligibleTypes,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/ceo/type-delegations
// Full-replace of the per-type delegation list + triggers in-flight transfer.
//
// Request body:
//   {
//     delegations: [
//       { requestType: 'cash_request',  delegateEmail: 'k@...', reason: '...' },
//       { requestType: 'invoice',       delegateEmail: 'a@...', reason: '...' },
//     ]
//   }
//
// Behaviour:
//   - Types present in the array are delegated to the specified person.
//   - Types previously delegated but absent from this payload have their
//     delegation cleared (Tom resumes handling them himself).
//   - In-flight requests are transferred for newly delegated types.
//   - Only callable by the CEO role itself.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/type-delegations', authMiddleware, requireRoles('ceo'), async (req, res) => {
  try {
    const { delegations } = req.body;

    if (!Array.isArray(delegations)) {
      return res.status(400).json({
        success: false,
        message: '`delegations` must be an array',
      });
    }

    // ── Validate each delegation entry ───────────────────────────────────────
    const validTypes = Object.keys(CEO_THRESHOLDS);
    const errors     = [];

    for (const d of delegations) {
      if (!validTypes.includes(d.requestType)) {
        errors.push(`Unknown requestType: "${d.requestType}"`);
        continue;
      }
      if (CEO_THRESHOLDS[d.requestType]?.neverEscalate) {
        errors.push(`"${d.requestType}" never reaches CEO — cannot delegate`);
      }
      if (!d.delegateEmail) {
        errors.push(`delegateEmail is required for requestType "${d.requestType}"`);
      }
    }

    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join('; ') });
    }

    // ── Resolve delegate names for each unique email ──────────────────────────
    const uniqueEmails = [...new Set(delegations.map(d => d.delegateEmail))];
    const delegateUsers = await User.find({ email: { $in: uniqueEmails } }).select('fullName email');
    const emailToName   = Object.fromEntries(delegateUsers.map(u => [u.email.toLowerCase(), u.fullName]));

    const missingUsers = uniqueEmails.filter(e => !emailToName[e.toLowerCase()]);
    if (missingUsers.length) {
      return res.status(400).json({
        success: false,
        message: `Delegate user(s) not found: ${missingUsers.join(', ')}`,
      });
    }

    // ── Load current state to detect which types are NEWLY delegated ──────────
    const ceoUser = await User.findOne({ email: CEO.email }).select('ceoAvailability');
    const existingDelegations = ceoUser?.ceoAvailability?.typeDelegations || [];

    const existingSet = new Set(existingDelegations.map(d => `${d.requestType}:${d.delegateEmail}`));

    // ── Build new typeDelegations array ───────────────────────────────────────
    const newTypeDelegations = delegations.map(d => ({
      requestType:   d.requestType,
      delegateEmail: d.delegateEmail.toLowerCase(),
      delegateName:  emailToName[d.delegateEmail.toLowerCase()],
      reason:        d.reason || '',
      delegatedAt:   new Date(),
      delegatedBy:   req.user.email,
    }));

    await User.findOneAndUpdate(
      { email: CEO.email },
      {
        $set: {
          'ceoAvailability.typeDelegations': newTypeDelegations,
          'ceoAvailability.lastUpdatedAt':   new Date(),
          'ceoAvailability.lastUpdatedBy':   req.user.email,
        },
      }
    );

    // ── Transfer in-flight requests for newly delegated types ─────────────────
    // A type is "new" if it was not previously delegated to the same person,
    // or if the delegate has changed.
    const newlyDelegated = newTypeDelegations.filter(
      d => !existingSet.has(`${d.requestType}:${d.delegateEmail}`)
    );

    let transferResult = { summary: [], totalTransferred: 0 };
    if (newlyDelegated.length > 0) {
      transferResult = await transferInFlightRequests(newlyDelegated);
    }

    res.json({
      success: true,
      message: `Per-type delegations saved. ${transferResult.totalTransferred} in-flight request(s) transferred.`,
      data: {
        typeDelegations: newTypeDelegations,
        transferSummary: transferResult.summary,
        totalTransferred: transferResult.totalTransferred,
      },
    });
  } catch (err) {
    console.error('[ceoAvailability] PUT /type-delegations error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/ceo/type-delegations/:requestType
// Removes the delegation for a single request type and re-assigns any
// in-flight requests back to Tom.
// Only callable by the CEO role.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/type-delegations/:requestType', authMiddleware, requireRoles('ceo'), async (req, res) => {
  try {
    const { requestType } = req.params;

    const ceoUser = await User.findOne({ email: CEO.email }).select('ceoAvailability fullName');
    if (!ceoUser) {
      return res.status(404).json({ success: false, message: 'CEO user not found' });
    }

    const existing = (ceoUser.ceoAvailability?.typeDelegations || []).find(
      d => d.requestType === requestType
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: `No active delegation found for requestType "${requestType}"`,
      });
    }

    // Remove the delegation entry
    await User.findOneAndUpdate(
      { email: CEO.email },
      {
        $pull: { 'ceoAvailability.typeDelegations': { requestType } },
        $set:  {
          'ceoAvailability.lastUpdatedAt': new Date(),
          'ceoAvailability.lastUpdatedBy': req.user.email,
        },
      }
    );

    // Re-assign in-flight requests back to Tom
    const { transferInFlightRequests: transfer } = require('../services/ceoTypeDelegationService');
    const revertResult = await transfer([
      {
        requestType,
        // We temporarily "transfer" back to Tom — the service function is generic
        // so we pass Tom's details as the new "delegate"
        delegateEmail: CEO.email,
        delegateName:  ceoUser.fullName || CEO.name,
      },
    ]);

    res.json({
      success: true,
      message: `Delegation for "${TYPE_LABELS[requestType] || requestType}" cleared. ${revertResult.totalTransferred} request(s) returned to Tom.`,
      data: {
        requestType,
        requestsReturned: revertResult.totalTransferred,
      },
    });
  } catch (err) {
    console.error('[ceoAvailability] DELETE /type-delegations error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE EMAIL HELPER (global delegation notification)
// ─────────────────────────────────────────────────────────────────────────────
async function _sendDelegationNotification(toEmail, toName, reason, from, until) {
  try {
    const fromStr  = from  ? new Date(from).toLocaleDateString()  : 'Now';
    const untilStr = until ? new Date(until).toLocaleDateString() : 'Until further notice';

    await sendEmail({
      to:      toEmail,
      subject: `You are now Acting CEO — Global Approval Delegation Active`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#faad14;">🏛️ CEO Approval Delegation</h2>
          <p>Dear ${toName},</p>
          <p>Mr. Tom has delegated <strong>all</strong> his final approval authority to you for the period below.</p>

          <div style="background:#fff7e6;border-left:4px solid #faad14;padding:16px;border-radius:4px;margin:20px 0;">
            <p><strong>Reason:</strong> ${reason || 'Not specified'}</p>
            <p><strong>From:</strong> ${fromStr}</p>
            <p><strong>Until:</strong> ${untilStr}</p>
          </div>

          <p>
            During this period, <strong>every request</strong> that reaches the
            <em>CEO - Final Authority</em> approval step will be routed to you.
            You have full authority to approve or reject these on Tom's behalf.
          </p>

          <p>Tom may still receive read-only copies of notifications to stay informed.</p>

          <p style="color:#888;font-size:12px;margin-top:30px;">
            This is an automated notification from the Grato Engineering ERP system.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[ceoAvailability] Delegation notification failed:', err.message);
  }
}


module.exports = router;












// // ═══════════════════════════════════════════════════════════════════════════
// // FILE: routes/ceoAvailabilityRoutes.js  (NEW FILE)
// // PURPOSE: API endpoints for Tom to manage his availability and delegation,
// //          and for the auto-escalation cron job to query status.
// // ═══════════════════════════════════════════════════════════════════════════

// const express = require('express');
// const router  = express.Router();
// const { protect, authorize } = require('../middlewares/authMiddleware');
// const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
// const User    = require('../models/User');
// const {
//   CEO_ESCALATION_TIMEOUTS,
//   CEO,
//   DEFAULT_CEO_DELEGATE,
// } = require('../config/ceoApprovalConfig');
// const { sendEmail } = require('../services/emailService');


// // ─────────────────────────────────────────────────────────────────────────────
// // GET /api/ceo/availability
// // Returns Tom's current availability status.
// // Accessible to: CEO, Admin (so Kelvin / admin can see if Tom is away)
// // ─────────────────────────────────────────────────────────────────────────────
// router.get('/availability', authMiddleware, requireRoles('ceo', 'admin'), async (req, res) => {
//   try {
//     const ceoUser = await User.findOne({ email: CEO.email })
//       .select('fullName email ceoAvailability');

//     if (!ceoUser) {
//       return res.status(404).json({ success: false, message: 'CEO user not found' });
//     }

//     const av         = ceoUser.ceoAvailability || {};
//     const hasDelegate = ceoUser.hasActiveDelegate?.() ?? false;

//     res.json({
//       success: true,
//       data: {
//         isAvailable:          !av.isUnavailable,
//         isUnavailable:        av.isUnavailable || false,
//         unavailabilityReason: av.unavailabilityReason || null,
//         unavailableFrom:      av.unavailableFrom || null,
//         unavailableUntil:     av.unavailableUntil || null,
//         hasActiveDelegate:    hasDelegate,
//         delegateEmail:        hasDelegate ? av.delegateEmail : null,
//         delegateName:         hasDelegate ? av.delegateName  : null,
//         keepTomInformed:      av.keepTomInformed !== false,
//         autoEscalation:       av.autoEscalation  || {},
//         delegationHistory:    av.delegationHistory || [],
//       },
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });


// // ─────────────────────────────────────────────────────────────────────────────
// // PUT /api/ceo/availability
// // Tom sets himself as unavailable / available and nominates a delegate.
// // Only the CEO account itself can call this endpoint.
// // ─────────────────────────────────────────────────────────────────────────────
// router.put('/availability', authMiddleware, requireRoles('ceo'), async (req, res) => {
//   try {
//     const {
//       isUnavailable, 
//       unavailabilityReason,
//       unavailableFrom,
//       unavailableUntil,
//       delegateEmail,
//       keepTomInformed,
//     } = req.body;

//     const ceoUser = await User.findOne({ email: CEO.email });
//     if (!ceoUser) {
//       return res.status(404).json({ success: false, message: 'CEO user not found' });
//     }

//     // Resolve delegate name
//     let delegateName = DEFAULT_CEO_DELEGATE.name;
//     if (delegateEmail) {
//       const delegateUser = await User.findOne({ email: delegateEmail }).select('fullName');
//       if (!delegateUser) {
//         return res.status(400).json({
//           success: false,
//           message: `Delegate user with email "${delegateEmail}" not found`,
//         });
//       }
//       delegateName = delegateUser.fullName;
//     }

//     // Build update object
//     const avUpdate = {
//       isUnavailable:        Boolean(isUnavailable),
//       unavailabilityReason: unavailabilityReason || '',
//       unavailableFrom:      unavailableFrom ? new Date(unavailableFrom) : new Date(),
//       unavailableUntil:     unavailableUntil ? new Date(unavailableUntil) : null,
//       delegateEmail:        delegateEmail    || DEFAULT_CEO_DELEGATE.email,
//       delegateName:         delegateName,
//       keepTomInformed:      keepTomInformed !== false,
//       notifyDelegate:       true,
//       lastUpdatedAt:        new Date(),
//       lastUpdatedBy:        req.user.email,
//     };

//     // If going unavailable, add to delegation history
//     if (isUnavailable && !(ceoUser.ceoAvailability?.isUnavailable)) {
//       avUpdate.$push = {
//         'ceoAvailability.delegationHistory': {
//           delegateEmail:  avUpdate.delegateEmail,
//           delegateName:   avUpdate.delegateName,
//           reason:         avUpdate.unavailabilityReason,
//           from:           avUpdate.unavailableFrom,
//           until:          avUpdate.unavailableUntil,
//         },
//       };
//     }

//     // If coming back (isUnavailable = false), stamp clearedAt on the last history entry
//     if (!isUnavailable && ceoUser.ceoAvailability?.isUnavailable) {
//       const history = ceoUser.ceoAvailability.delegationHistory || [];
//       if (history.length > 0) {
//         history[history.length - 1].clearedAt = new Date();
//         history[history.length - 1].clearedBy = req.user.email;
//         avUpdate['ceoAvailability.delegationHistory'] = history;
//       }
//     }

//     await User.findOneAndUpdate(
//       { email: CEO.email },
//       { $set: { ceoAvailability: avUpdate } },
//       { new: true }
//     );

//     // Notify the delegate if becoming unavailable
//     if (isUnavailable && avUpdate.delegateEmail) {
//       await sendDelegationNotification(
//         avUpdate.delegateEmail,
//         avUpdate.delegateName,
//         avUpdate.unavailabilityReason,
//         avUpdate.unavailableFrom,
//         avUpdate.unavailableUntil
//       );
//     }

//     res.json({
//       success: true,
//       message: isUnavailable
//         ? `Delegation activated — ${delegateName} will handle CEO approvals`
//         : 'CEO availability restored — delegation cleared',
//       data:    avUpdate,
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });


// // ─────────────────────────────────────────────────────────────────────────────
// // PUT /api/ceo/availability/auto-escalation
// // Tom adjusts the auto-escalation timeout settings.
// // ─────────────────────────────────────────────────────────────────────────────
// router.put('/availability/auto-escalation', authMiddleware, requireRoles('ceo', 'admin', 'ceo'), async (req, res) => {
//   try {
//     const { enabled, reminderAfterDays, autoDelegateAfterDays } = req.body;

//     await User.findOneAndUpdate(
//       { email: CEO.email },
//       {
//         $set: {
//           'ceoAvailability.autoEscalation.enabled':              enabled !== false,
//           'ceoAvailability.autoEscalation.reminderAfterDays':    reminderAfterDays    || CEO_ESCALATION_TIMEOUTS.reminderAfterDays,
//           'ceoAvailability.autoEscalation.autoDelegateAfterDays': autoDelegateAfterDays || CEO_ESCALATION_TIMEOUTS.autoDelegateAfterDays,
//         },
//       }
//     );

//     res.json({ success: true, message: 'Auto-escalation settings updated' });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });


// // ─────────────────────────────────────────────────────────────────────────────
// // GET /api/ceo/thresholds
// // Returns the current threshold table for display on the frontend.
// // ─────────────────────────────────────────────────────────────────────────────
// router.get('/thresholds', authMiddleware, requireRoles('ceo', 'admin', 'finance'), async (req, res) => {
//   try {
//     const { CEO_THRESHOLDS, CEO_ESCALATION_TIMEOUTS } = require('../config/ceoApprovalConfig');
//     res.json({ success: true, data: { thresholds: CEO_THRESHOLDS, timeouts: CEO_ESCALATION_TIMEOUTS } });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });


// // ─────────────────────────────────────────────────────────────────────────────
// // Email helper
// // ─────────────────────────────────────────────────────────────────────────────
// async function sendDelegationNotification(toEmail, toName, reason, from, until) {
//   try {
//     const fromStr  = from  ? new Date(from).toLocaleDateString()  : 'Now';
//     const untilStr = until ? new Date(until).toLocaleDateString() : 'Until further notice';

//     await sendEmail({
//       to:      toEmail,
//       subject: `You are now Acting CEO — Approval Delegation Active`,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #faad14;">🏛️ CEO Approval Delegation</h2>
//           <p>Dear ${toName},</p>
//           <p>Mr. Tom has delegated his final approval authority to you for the period below.</p>

//           <div style="background: #fff7e6; border-left: 4px solid #faad14; padding: 16px; border-radius: 4px; margin: 20px 0;">
//             <p><strong>Reason:</strong> ${reason || 'Not specified'}</p>
//             <p><strong>From:</strong> ${fromStr}</p>
//             <p><strong>Until:</strong> ${untilStr}</p>
//           </div>

//           <p>
//             During this period, any request that reaches the <strong>CEO - Final Authority</strong>
//             approval step will be <strong>routed to you</strong> instead.
//             You have full authority to approve or reject these on Tom's behalf.
//           </p>

//           <p>Tom may still receive read-only copies of notifications to stay informed.</p>

//           <p style="color: #888; font-size: 12px; margin-top: 30px;">
//             This is an automated notification from the Grato Engineering ERP system.
//           </p>
//         </div>
//       `,
//     });
//   } catch (err) {
//     console.error('[ceoAvailability] Failed to send delegation notification:', err.message);
//   }
// }


// module.exports = router;