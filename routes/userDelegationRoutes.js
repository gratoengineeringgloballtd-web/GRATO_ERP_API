// ═══════════════════════════════════════════════════════════════════════════
// FILE: routes/userDelegationRoutes.js  (NEW FILE)
//
// Mount in server.js / app.js:
//   app.use('/api/delegations', require('./routes/userDelegationRoutes'));
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router();
const { authMiddleware }  = require('../middlewares/authMiddleware');
const UserDelegation      = require('../models/UserDelegation');
const User                = require('../models/User');
const {
  transferInFlightApprovals,
  revertInFlightApprovals,
  getDelegationSummaryForUser,
  getPendingItemsForDelegate,
}  = require('../services/userDelegationService');
const {
  getAllProcessTypeKeys,
  isValidProcessType,
  filterValidProcessTypes,
  getProcessTypesByCategory,
  DELEGATION_PROCESS_TYPES,
}  = require('../config/delegationProcessTypes');


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/delegations/process-types
// Returns the full list of delegatable process types (for the settings UI).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/process-types', authMiddleware, (req, res) => {
  res.json({
    success: true,
    data: {
      byCategory: getProcessTypesByCategory(),
      flat:       Object.entries(DELEGATION_PROCESS_TYPES).map(([key, cfg]) => ({
        key, ...cfg,
      })),
    },
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/delegations/my-summary
// Returns the current user's outgoing and incoming delegations + locked types.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my-summary', authMiddleware, async (req, res) => {
  try {
    const summary = await getDelegationSummaryForUser(req.user.email);
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/delegations/my-pending/:processType
// Returns items pending in `processType` where the current user is a delegate.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my-pending/:processType', authMiddleware, async (req, res) => {
  try {
    const { processType } = req.params;
    if (!isValidProcessType(processType)) {
      return res.status(400).json({ success: false, message: 'Invalid process type' });
    }
    const items = await getPendingItemsForDelegate(req.user.email, processType);
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/delegations
// Returns ALL delegations the current user is involved in (outgoing + incoming).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { type = 'all' } = req.query;   // 'outgoing' | 'incoming' | 'all'
    const email            = req.user.email.toLowerCase();

    let outgoing = [], incoming = [];

    if (type !== 'incoming') {
      outgoing = await UserDelegation.findOutgoing(email);
    }
    if (type !== 'outgoing') {
      incoming = await UserDelegation.findIncoming(email);
    }

    res.json({
      success: true,
      data: { outgoing, incoming, total: outgoing.length + incoming.length },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/delegations
// Create a new delegation (A sets up B as their delegate).
// Only the delegator themselves can create delegations on their behalf.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      delegateEmail,
      scope          = 'selective',
      processTypes   = [],
      startDate,
      endDate,
      reason,
    } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!delegateEmail) {
      return res.status(400).json({ success: false, message: 'delegateEmail is required' });
    }

    if (delegateEmail.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(400).json({ success: false, message: 'You cannot delegate to yourself' });
    }

    if (!['all', 'selective'].includes(scope)) {
      return res.status(400).json({ success: false, message: 'scope must be "all" or "selective"' });
    }

    if (scope === 'selective' && (!processTypes || processTypes.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'At least one process type is required for selective delegation',
      });
    }

    const validTypes = filterValidProcessTypes(processTypes);
    if (scope === 'selective' && validTypes.length !== processTypes.length) {
      return res.status(400).json({ success: false, message: 'One or more invalid process types' });
    }

    // ── Resolve delegate user ──────────────────────────────────────────────
    const delegateUser = await User.findOne({ email: delegateEmail.toLowerCase() })
      .select('fullName email isActive');

    if (!delegateUser) {
      return res.status(404).json({
        success: false,
        message: `User with email "${delegateEmail}" not found`,
      });
    }

    if (!delegateUser.isActive) {
      return res.status(400).json({
        success: false,
        message: `User "${delegateUser.fullName}" is not active`,
      });
    }

    // ── Check for conflicting active delegation ────────────────────────────
    // A user can have multiple delegations to different people, but not two
    // active delegations to the SAME person (merge instead).
    const existing = await UserDelegation.findOne({
      delegatorEmail: req.user.email.toLowerCase(),
      delegateEmail:  delegateEmail.toLowerCase(),
      status:         'active',
    });

    if (existing) {
      return res.status(409).json({
        success:      false,
        message:      `An active delegation to ${delegateUser.fullName} already exists. Edit that one instead.`,
        existingId:   existing._id,
      });
    }

    // ── Create delegation ──────────────────────────────────────────────────
    const delegation = await UserDelegation.create({
      delegatorId:    req.user._id || req.user.id,
      delegatorEmail: req.user.email.toLowerCase(),
      delegatorName:  req.user.fullName,
      delegateId:     delegateUser._id,
      delegateEmail:  delegateUser.email.toLowerCase(),
      delegateName:   delegateUser.fullName,
      scope,
      processTypes:   scope === 'all' ? [] : validTypes,
      startDate:      startDate ? new Date(startDate) : new Date(),
      endDate:        endDate   ? new Date(endDate)   : null,
      reason:         reason    || '',
      createdBy:      req.user._id || req.user.id,
      status:         'active',
    });

    // ── Transfer in-flight approvals ───────────────────────────────────────
    const transferSummary = await transferInFlightApprovals(delegation);

    delegation.transferSummary = {
      transferredAt:    new Date(),
      totalTransferred: transferSummary.totalTransferred,
      byType:           transferSummary.byType,
    };
    await delegation.save();

    // ── Send notification to delegator (confirmation) ──────────────────────
    const { sendEmail } = require('../services/emailService');
    await sendEmail({
      to:      req.user.email,
      subject: `Delegation activated — ${delegateUser.fullName} is now your delegate`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;">
          <h2>Delegation Confirmed</h2>
          <p>You have successfully delegated the following to <strong>${delegateUser.fullName}</strong>:</p>
          <ul>
            ${scope === 'all'
              ? '<li>All process types</li>'
              : validTypes.map((t) => `<li>${DELEGATION_PROCESS_TYPES[t]?.label || t}</li>`).join('')}
          </ul>
          <p>${transferSummary.totalTransferred} pending approval step(s) were immediately transferred.</p>
          <p>While this delegation is active, you can read but not write for the delegated processes.</p>
        </div>
      `,
    }).catch(() => {});

    res.status(201).json({
      success:         true,
      message:         `Delegation created. ${transferSummary.totalTransferred} in-flight approval(s) transferred to ${delegateUser.fullName}.`,
      data:            delegation,
      transferSummary,
    });
  } catch (err) {
    console.error('[delegationRoutes] POST /:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/delegations/:id
// Get a single delegation (must be the delegator or delegate).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const delegation = await UserDelegation.findById(req.params.id)
      .populate('delegatorId', 'fullName email department position')
      .populate('delegateId',  'fullName email department position');

    if (!delegation) {
      return res.status(404).json({ success: false, message: 'Delegation not found' });
    }

    const email = req.user.email.toLowerCase();
    const isInvolved =
      delegation.delegatorEmail === email || delegation.delegateEmail === email;
    const isAdmin = ['admin', 'ceo'].includes(req.user.role);

    if (!isInvolved && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: delegation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/delegations/:id
// Edit an active delegation (only the delegator can edit).
// Changing processTypes triggers a differential transfer/revert.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const delegation = await UserDelegation.findById(req.params.id);
    if (!delegation) {
      return res.status(404).json({ success: false, message: 'Delegation not found' });
    }

    // Only the delegator can edit
    if (delegation.delegatorEmail !== req.user.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'Only the delegator can modify this delegation',
      });
    }

    if (delegation.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Cannot edit a delegation with status "${delegation.status}"`,
      });
    }

    const {
      scope,
      processTypes,
      endDate,
      reason,
    } = req.body;

    const previousTypes = new Set(delegation.getCoveredTypes());

    // Apply changes
    if (scope && ['all', 'selective'].includes(scope)) {
      delegation.scope = scope;
    }
    if (processTypes !== undefined && delegation.scope === 'selective') {
      delegation.processTypes = filterValidProcessTypes(processTypes);
    }
    if (endDate !== undefined) {
      delegation.endDate = endDate ? new Date(endDate) : null;
    }
    if (reason !== undefined) {
      delegation.reason = reason;
    }

    await delegation.save();

    // Compute newly added and removed types for differential transfer/revert
    const newTypes     = new Set(delegation.getCoveredTypes());
    const addedTypes   = [...newTypes].filter((t) => !previousTypes.has(t));
    const removedTypes = [...previousTypes].filter((t) => !newTypes.has(t));

    let transferSummary = { totalTransferred: 0, byType: [] };
    let revertSummary   = { totalReverted: 0 };

    if (addedTypes.length > 0) {
      transferSummary = await transferInFlightApprovals(delegation, addedTypes);
    }

    if (removedTypes.length > 0) {
      // Create a temporary delegation-like object scoped to removed types
      const tempDelegation = Object.assign(Object.create(delegation), {
        getCoveredTypes: () => removedTypes,
      });
      revertSummary = await revertInFlightApprovals(tempDelegation);
    }

    res.json({
      success: true,
      message: `Delegation updated. ${transferSummary.totalTransferred} new transfer(s), ${revertSummary.totalReverted} revert(s).`,
      data: delegation,
      transferSummary,
      revertSummary,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/delegations/:id  (revoke)
// Revoke a delegation — only the delegator can do this.
// Immediately reverts all in-flight approval steps back to the delegator.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { reason: revokeReason = '' } = req.body;

    const delegation = await UserDelegation.findById(req.params.id);
    if (!delegation) {
      return res.status(404).json({ success: false, message: 'Delegation not found' });
    }

    if (delegation.delegatorEmail !== req.user.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'Only the delegator can revoke this delegation',
      });
    }

    if (!['active', 'paused'].includes(delegation.status)) {
      return res.status(400).json({
        success: false,
        message: `Delegation is already "${delegation.status}"`,
      });
    }

    // Revert in-flight approvals back to delegator
    const revertSummary = await revertInFlightApprovals(delegation);

    // Mark as revoked
    delegation.status        = 'revoked';
    delegation.revokedAt     = new Date();
    delegation.revokedBy     = req.user._id || req.user.id;
    delegation.revokedReason = revokeReason;
    await delegation.save();

    res.json({
      success: true,
      message: `Delegation revoked. ${revertSummary.totalReverted} approval step(s) returned to ${delegation.delegatorName}.`,
      data:    delegation,
      revertSummary,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/delegations/:id/pause  |  /resume
// Pause suspends the delegation without revoking it — approvals are NOT
// reverted (the steps stay with the delegate) but new submissions are
// re-enabled for the delegator.  Resume re-enables the full delegation.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/pause', authMiddleware, async (req, res) => {
  try {
    const delegation = await UserDelegation.findById(req.params.id);
    if (!delegation)
      return res.status(404).json({ success: false, message: 'Delegation not found' });
    if (delegation.delegatorEmail !== req.user.email.toLowerCase())
      return res.status(403).json({ success: false, message: 'Access denied' });
    if (delegation.status !== 'active')
      return res.status(400).json({ success: false, message: 'Delegation is not active' });

    delegation.status = 'paused';
    await delegation.save();

    res.json({ success: true, message: 'Delegation paused', data: delegation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/resume', authMiddleware, async (req, res) => {
  try {
    const delegation = await UserDelegation.findById(req.params.id);
    if (!delegation)
      return res.status(404).json({ success: false, message: 'Delegation not found' });
    if (delegation.delegatorEmail !== req.user.email.toLowerCase())
      return res.status(403).json({ success: false, message: 'Access denied' });
    if (delegation.status !== 'paused')
      return res.status(400).json({ success: false, message: 'Delegation is not paused' });

    delegation.status = 'active';
    await delegation.save();

    res.json({ success: true, message: 'Delegation resumed', data: delegation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


module.exports = router;