// ═══════════════════════════════════════════════════════════════════════════
// FILE: routes/ceoAvailabilityRoutes.js  (NEW FILE)
// PURPOSE: API endpoints for Tom to manage his availability and delegation,
//          and for the auto-escalation cron job to query status.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const User    = require('../models/User');
const {
  CEO_ESCALATION_TIMEOUTS,
  CEO,
  DEFAULT_CEO_DELEGATE,
} = require('../config/ceoApprovalConfig');
const { sendEmail } = require('../services/emailService');


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ceo/availability
// Returns Tom's current availability status.
// Accessible to: CEO, Admin (so Kelvin / admin can see if Tom is away)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/availability', authMiddleware, requireRoles('ceo', 'admin'), async (req, res) => {
  try {
    const ceoUser = await User.findOne({ email: CEO.email })
      .select('fullName email ceoAvailability');

    if (!ceoUser) {
      return res.status(404).json({ success: false, message: 'CEO user not found' });
    }

    const av         = ceoUser.ceoAvailability || {};
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
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/ceo/availability
// Tom sets himself as unavailable / available and nominates a delegate.
// Only the CEO account itself can call this endpoint.
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

    // Build update object
    const avUpdate = {
      isUnavailable:        Boolean(isUnavailable),
      unavailabilityReason: unavailabilityReason || '',
      unavailableFrom:      unavailableFrom ? new Date(unavailableFrom) : new Date(),
      unavailableUntil:     unavailableUntil ? new Date(unavailableUntil) : null,
      delegateEmail:        delegateEmail    || DEFAULT_CEO_DELEGATE.email,
      delegateName:         delegateName,
      keepTomInformed:      keepTomInformed !== false,
      notifyDelegate:       true,
      lastUpdatedAt:        new Date(),
      lastUpdatedBy:        req.user.email,
    };

    // If going unavailable, add to delegation history
    if (isUnavailable && !(ceoUser.ceoAvailability?.isUnavailable)) {
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

    // If coming back (isUnavailable = false), stamp clearedAt on the last history entry
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

    // Notify the delegate if becoming unavailable
    if (isUnavailable && avUpdate.delegateEmail) {
      await sendDelegationNotification(
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
        ? `Delegation activated — ${delegateName} will handle CEO approvals`
        : 'CEO availability restored — delegation cleared',
      data:    avUpdate,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/ceo/availability/auto-escalation
// Tom adjusts the auto-escalation timeout settings.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/availability/auto-escalation', authMiddleware, requireRoles('ceo', 'admin', 'ceo'), async (req, res) => {
  try {
    const { enabled, reminderAfterDays, autoDelegateAfterDays } = req.body;

    await User.findOneAndUpdate(
      { email: CEO.email },
      {
        $set: {
          'ceoAvailability.autoEscalation.enabled':              enabled !== false,
          'ceoAvailability.autoEscalation.reminderAfterDays':    reminderAfterDays    || CEO_ESCALATION_TIMEOUTS.reminderAfterDays,
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
// Returns the current threshold table for display on the frontend.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/thresholds', authMiddleware, requireRoles('ceo', 'admin', 'finance'), async (req, res) => {
  try {
    const { CEO_THRESHOLDS, CEO_ESCALATION_TIMEOUTS } = require('../config/ceoApprovalConfig');
    res.json({ success: true, data: { thresholds: CEO_THRESHOLDS, timeouts: CEO_ESCALATION_TIMEOUTS } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// Email helper
// ─────────────────────────────────────────────────────────────────────────────
async function sendDelegationNotification(toEmail, toName, reason, from, until) {
  try {
    const fromStr  = from  ? new Date(from).toLocaleDateString()  : 'Now';
    const untilStr = until ? new Date(until).toLocaleDateString() : 'Until further notice';

    await sendEmail({
      to:      toEmail,
      subject: `You are now Acting CEO — Approval Delegation Active`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #faad14;">🏛️ CEO Approval Delegation</h2>
          <p>Dear ${toName},</p>
          <p>Mr. Tom has delegated his final approval authority to you for the period below.</p>

          <div style="background: #fff7e6; border-left: 4px solid #faad14; padding: 16px; border-radius: 4px; margin: 20px 0;">
            <p><strong>Reason:</strong> ${reason || 'Not specified'}</p>
            <p><strong>From:</strong> ${fromStr}</p>
            <p><strong>Until:</strong> ${untilStr}</p>
          </div>

          <p>
            During this period, any request that reaches the <strong>CEO - Final Authority</strong>
            approval step will be <strong>routed to you</strong> instead.
            You have full authority to approve or reject these on Tom's behalf.
          </p>

          <p>Tom may still receive read-only copies of notifications to stay informed.</p>

          <p style="color: #888; font-size: 12px; margin-top: 30px;">
            This is an automated notification from the Grato Engineering ERP system.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[ceoAvailability] Failed to send delegation notification:', err.message);
  }
}


module.exports = router;