const User = require('../models/User');

/**
 * Get the current user's own delegation status.
 */
exports.getMyDelegation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('delegation email fullName');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        isActive: user.hasActiveDelegation(),
        delegation: user.delegation || null
      }
    });
  } catch (error) {
    console.error('Get my delegation error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch delegation status', error: error.message });
  }
};

/**
 * Set (or update) delegation - hand off approvals/requests to a colleague, optionally
 * for a bounded period. Setting it again while already active replaces the previous
 * delegation (the old one is archived into history, not lost).
 */
exports.setDelegation = async (req, res) => {
  try {
    const { delegateId, reason, fromDate, untilDate, notifyDelegate, keepInformed } = req.body;

    if (!delegateId) {
      return res.status(400).json({ success: false, message: 'A delegate must be selected' });
    }

    const [user, delegate] = await Promise.all([
      User.findById(req.user.userId),
      User.findById(delegateId).select('fullName email isActive role')
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!delegate) {
      return res.status(404).json({ success: false, message: 'Selected delegate not found' });
    }
    if (delegate._id.toString() === user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot delegate to yourself' });
    }
    if (!delegate.isActive) {
      return res.status(400).json({ success: false, message: 'Selected delegate account is not active' });
    }

    // Archive whatever delegation was previously in place before overwriting it, so
    // there's a real audit trail of who covered for whom and when - not just the
    // current state.
    if (user.delegation?.isActive) {
      user.delegation.history = user.delegation.history || [];
      user.delegation.history.push({
        delegateEmail: user.delegation.delegateEmail,
        delegateName: user.delegation.delegateName,
        reason: user.delegation.reason,
        fromDate: user.delegation.fromDate,
        untilDate: user.delegation.untilDate,
        setBy: user.delegation.setBy,
        setAt: user.delegation.setAt,
        clearedAt: new Date(),
        clearedBy: req.user.userId
      });
    }

    user.delegation = {
      ...(user.delegation?.toObject ? user.delegation.toObject() : user.delegation || {}),
      isActive: true,
      delegateId: delegate._id,
      delegateEmail: delegate.email,
      delegateName: delegate.fullName,
      reason: reason || '',
      fromDate: fromDate ? new Date(fromDate) : new Date(),
      untilDate: untilDate ? new Date(untilDate) : undefined,
      notifyDelegate: notifyDelegate !== false,
      keepInformed: keepInformed !== false,
      setBy: req.user.userId,
      setAt: new Date(),
      history: user.delegation?.history || []
    };

    user.markModified('delegation');
    await user.save();

    console.log(`✅ ${user.email} delegated approvals to ${delegate.email}${untilDate ? ` until ${untilDate}` : ' (no end date)'}`);

    res.json({
      success: true,
      message: `Approvals delegated to ${delegate.fullName}`,
      data: user.delegation
    });
  } catch (error) {
    console.error('Set delegation error:', error);
    res.status(500).json({ success: false, message: 'Failed to set delegation', error: error.message });
  }
};

/**
 * Clear the current user's active delegation - they resume acting on their own
 * approvals/requests immediately.
 */
exports.clearDelegation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.delegation?.isActive) {
      return res.status(400).json({ success: false, message: 'No active delegation to clear' });
    }

    user.delegation.history = user.delegation.history || [];
    user.delegation.history.push({
      delegateEmail: user.delegation.delegateEmail,
      delegateName: user.delegation.delegateName,
      reason: user.delegation.reason,
      fromDate: user.delegation.fromDate,
      untilDate: user.delegation.untilDate,
      setBy: user.delegation.setBy,
      setAt: user.delegation.setAt,
      clearedAt: new Date(),
      clearedBy: req.user.userId
    });

    user.delegation.isActive = false;
    user.delegation.delegateId = undefined;
    user.delegation.delegateEmail = undefined;
    user.delegation.delegateName = undefined;

    user.markModified('delegation');
    await user.save();

    res.json({ success: true, message: 'Delegation cleared - you are now acting on your own approvals again' });
  } catch (error) {
    console.error('Clear delegation error:', error);
    res.status(500).json({ success: false, message: 'Failed to clear delegation', error: error.message });
  }
};

/**
 * Search for potential delegates by name or email - used by the delegate picker.
 * Excludes the current user and inactive accounts.
 */
exports.searchDelegateCandidates = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    const candidates = await User.find({
      _id: { $ne: req.user.userId },
      isActive: true,
      role: { $ne: 'supplier' },
      $or: [
        { fullName: { $regex: q.trim(), $options: 'i' } },
        { email: { $regex: q.trim(), $options: 'i' } }
      ]
    })
      .select('fullName email department position')
      .limit(15);

    res.json({ success: true, data: candidates });
  } catch (error) {
    console.error('Search delegate candidates error:', error);
    res.status(500).json({ success: false, message: 'Failed to search users', error: error.message });
  }
};

/**
 * List everyone who currently has an active delegation pointing at the current user -
 * i.e. whose approvals the current user is currently covering.
 */
exports.getMyDelegators = async (req, res) => {
  try {
    const now = new Date();
    const delegators = await User.find({
      'delegation.isActive': true,
      'delegation.delegateId': req.user.userId,
      $or: [
        { 'delegation.untilDate': { $exists: false } },
        { 'delegation.untilDate': null },
        { 'delegation.untilDate': { $gte: now } }
      ]
    }).select('fullName email department position delegation.reason delegation.fromDate delegation.untilDate');

    res.json({
      success: true,
      data: delegators.map(u => ({
        userId: u._id,
        fullName: u.fullName,
        email: u.email,
        department: u.department,
        position: u.position,
        reason: u.delegation?.reason,
        fromDate: u.delegation?.fromDate,
        untilDate: u.delegation?.untilDate
      }))
    });
  } catch (error) {
    console.error('Get my delegators error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch delegators', error: error.message });
  }
};
