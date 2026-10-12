/**
 * routes/itAdminRoutes.js
 * MOUNT: app.use('/api/it-admin', require('./routes/itAdminRoutes'));
 *
 * The IT support console API. Scope (agreed with the business):
 *  - OPERATIONAL access only: system health, logs, user accounts, support
 *    sessions. No payroll, HR files or financial data is exposed here.
 *  - IT can never approve/decide anything in a business workflow.
 *  - Every privileged action is written to ITAuditLog.
 *  - admin / ceo accounts can only be managed by admin / ceo.
 */
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const router = express.Router();

const User = require('../models/User');
const ITAuditLog = require('../models/ITAuditLog');
const SystemErrorLog = require('../models/SystemErrorLog');
const HierarchyService = require('../services/hierarchyService');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

router.use(authMiddleware);
router.use(requireRoles('it', 'admin', 'ceo'));

// A support ("view as user") session must never be used to reach this console.
router.use((req, res, next) => {
  if (req.user.impersonatedBy) {
    return res.status(403).json({ success: false, message: 'Not available during a support session' });
  }
  next();
});

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------
const FULL_ADMIN_ROLES = ['admin', 'ceo'];
// Roles IT may assign or remove. Granting admin / ceo / finance / hr is a
// privilege decision that stays with admin / ceo.
const IT_ASSIGNABLE_ROLES = ['employee', 'buyer', 'supply_chain', 'technical', 'hse', 'project', 'it'];
// Roles whose screens contain no payroll / HR-file / finance data, so a
// read-only support session is acceptable.
const VIEW_AS_ROLES = ['employee', 'buyer', 'supply_chain', 'technical', 'hse', 'project'];
// Roles whose password reset is delivered by email only (IT never sees it).
const EMAIL_ONLY_RESET_ROLES = ['finance', 'hr'];

const SAFE_FIELDS =
  'fullName email phone role department position departmentRole supervisor departmentHead isActive lastLogin createdAt hierarchyLevel';

const isFullAdmin = (req) => FULL_ADMIN_ROLES.includes(req.user.role);

const log = async (req, action, target, description, metadata = {}) => {
  try {
    await ITAuditLog.create({
      action,
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      performedByRole: req.user.role,
      targetUser: target?._id,
      targetName: target?.fullName,
      description,
      metadata,
      ip: req.ip
    });
  } catch (e) {
    console.error('Failed to write IT audit log:', e.message);
  }
};

/** Loads the target user and enforces "IT cannot touch admin / ceo accounts". */
const loadManageableUser = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    res.status(400).json({ success: false, message: 'Invalid user id' });
    return null;
  }
  const user = await User.findById(req.params.userId);
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return null;
  }
  if (FULL_ADMIN_ROLES.includes(user.role) && !isFullAdmin(req)) {
    res.status(403).json({ success: false, message: 'Admin and CEO accounts can only be managed by an admin or CEO' });
    return null;
  }
  return user;
};

// ---------------------------------------------------------------------------
// Overview / health
// ---------------------------------------------------------------------------
router.get('/overview', async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [totalUsers, activeUsers, byRole, errors24h, topFailing, logins24h, recentActions] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      SystemErrorLog.countDocuments({ createdAt: { $gte: since24h } }),
      SystemErrorLog.aggregate([
        { $match: { createdAt: { $gte: since24h } } },
        { $group: { _id: { method: '$method', url: '$url', status: '$status' }, count: { $sum: 1 }, last: { $max: '$createdAt' } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]),
      User.countDocuments({ lastLogin: { $gte: since24h } }),
      ITAuditLog.countDocuments({ createdAt: { $gte: since24h } })
    ]);

    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const mem = process.memoryUsage();

    res.json({
      success: true,
      data: {
        server: {
          uptimeSeconds: Math.round(process.uptime()),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'development',
          memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
          database: states[mongoose.connection.readyState] || 'unknown'
        },
        users: {
          total: totalUsers,
          active: activeUsers,
          inactive: totalUsers - activeUsers,
          loggedInLast24h: logins24h,
          byRole: byRole.map(r => ({ role: r._id, count: r.count }))
        },
        errors: {
          last24h: errors24h,
          topFailing: topFailing.map(t => ({ ...t._id, count: t.count, last: t.last }))
        },
        itActionsLast24h: recentActions
      }
    });
  } catch (error) {
    console.error('IT overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to load system overview' });
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const { search, role, department, status, page = 1, limit = 25 } = req.query;
    const query = {};
    if (role) query.role = role;
    if (department) query.department = department;
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (search) {
      const rx = { $regex: String(search).slice(0, 80), $options: 'i' };
      query.$or = [{ fullName: rx }, { email: rx }, { position: rx }];
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);

    const [users, total] = await Promise.all([
      User.find(query)
        .select(SAFE_FIELDS)
        .populate('supervisor', 'fullName email')
        .sort({ fullName: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: users.map(u => ({
        ...u,
        canManage: isFullAdmin(req) || !FULL_ADMIN_ROLES.includes(u.role),
        canViewAs: VIEW_AS_ROLES.includes(u.role) && String(u._id) !== req.user.userId && u.isActive
      })),
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch (error) {
    console.error('IT list users error:', error);
    res.status(500).json({ success: false, message: 'Failed to load users' });
  }
});

router.put('/users/:userId', async (req, res) => {
  try {
    const user = await loadManageableUser(req, res);
    if (!user) return;

    const allowed = ['fullName', 'phone', 'email', 'department', 'position', 'departmentRole', 'departmentHead'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (updates.email) {
      updates.email = String(updates.email).toLowerCase().trim();
      const clash = await User.findOne({ email: updates.email, _id: { $ne: user._id } }).select('_id');
      if (clash) return res.status(409).json({ success: false, message: 'Another account already uses that email' });
    }

    const before = {};
    Object.keys(updates).forEach(k => { before[k] = user[k]; });

    if (Object.keys(updates).length) {
      await User.findByIdAndUpdate(user._id, updates, { runValidators: true });
    }

    // Supervisor changes go through the hierarchy service so reporting lines,
    // direct-report lists and approval chains stay consistent.
    if (req.body.supervisor !== undefined &&
        String(req.body.supervisor || '') !== String(user.supervisor || '')) {
      if (String(req.body.supervisor) === String(user._id)) {
        return res.status(400).json({ success: false, message: 'A user cannot supervise themselves' });
      }
      await HierarchyService.updateSupervisor(user._id, req.body.supervisor || null, req.user.userId);
      before.supervisor = user.supervisor;
      updates.supervisor = req.body.supervisor;
    }

    await log(req, 'user_profile_updated', user, `Updated profile fields: ${Object.keys(updates).join(', ') || 'none'}`, { before, after: updates });

    const fresh = await User.findById(user._id).select(SAFE_FIELDS).populate('supervisor', 'fullName email');
    res.json({ success: true, message: 'User updated', data: fresh });
  } catch (error) {
    console.error('IT update user error:', error);
    res.status(error.name === 'ValidationError' ? 400 : 500).json({ success: false, message: error.message || 'Failed to update user' });
  }
});

router.put('/users/:userId/role', async (req, res) => {
  try {
    const user = await loadManageableUser(req, res);
    if (!user) return;

    const { role } = req.body;
    const validRoles = User.schema.path('role').enumValues;
    if (!validRoles.includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });
    if (String(user._id) === req.user.userId) {
      return res.status(400).json({ success: false, message: 'You cannot change your own role' });
    }

    if (!isFullAdmin(req)) {
      if (!IT_ASSIGNABLE_ROLES.includes(role) || !IT_ASSIGNABLE_ROLES.includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: `IT can only move users between: ${IT_ASSIGNABLE_ROLES.join(', ')}. Roles such as finance, hr, admin and ceo must be changed by an admin.`
        });
      }
    }

    const previous = user.role;
    await User.findByIdAndUpdate(user._id, { role }, { runValidators: true });
    await log(req, 'user_role_changed', user, `Role changed from ${previous} to ${role}`, { from: previous, to: role });

    res.json({ success: true, message: `Role changed to ${role}`, data: { _id: user._id, role } });
  } catch (error) {
    console.error('IT change role error:', error);
    res.status(500).json({ success: false, message: 'Failed to change role' });
  }
});

router.patch('/users/:userId/status', async (req, res) => {
  try {
    const user = await loadManageableUser(req, res);
    if (!user) return;

    if (typeof req.body.isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive (true/false) is required' });
    }
    if (String(user._id) === req.user.userId && !req.body.isActive) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }

    await User.findByIdAndUpdate(user._id, { isActive: req.body.isActive });
    await log(req, req.body.isActive ? 'user_activated' : 'user_deactivated', user,
      `${req.body.isActive ? 'Activated' : 'Deactivated'} ${user.email}`, { reason: req.body.reason });

    res.json({ success: true, message: `User ${req.body.isActive ? 'activated' : 'deactivated'}`, data: { _id: user._id, isActive: req.body.isActive } });
  } catch (error) {
    console.error('IT status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
});

router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const user = await loadManageableUser(req, res);
    if (!user) return;

    // 12 chars, guaranteed upper/lower/digit/symbol.
    const pick = (chars) => chars[crypto.randomInt(chars.length)];
    const all = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let temp = pick('ABCDEFGHJKLMNPQRSTUVWXYZ') + pick('abcdefghijkmnopqrstuvwxyz') + pick('23456789') + pick('@#$%');
    while (temp.length < 12) temp += pick(all);
    temp = temp.split('').sort(() => crypto.randomInt(3) - 1).join('');

    // Hash directly and update only the password so older profiles that
    // would fail full-document validation can still be reset.
    const hashed = await require('bcryptjs').hash(temp, 12);
    await User.updateOne({ _id: user._id }, { $set: { password: hashed } });

    const emailOnly = EMAIL_ONLY_RESET_ROLES.includes(user.role) && !isFullAdmin(req);
    let emailSent = false;
    try {
      const { sendEmail } = require('../services/emailService');
      const result = await sendEmail({
        to: user.email,
        subject: 'Your GRATO ERP password has been reset',
        text:
          `Hello ${user.fullName},\n\nYour password was reset by the IT department.\n\n` +
          `Temporary password: ${temp}\n\nPlease log in and change it as soon as possible. ` +
          `If you did not ask for this, contact IT immediately.`
      });
      emailSent = !!(result && result.success !== false);
    } catch (e) {
      console.error('Password reset email failed:', e.message);
    }

    if (emailOnly && !emailSent) {
      // Don't leave a finance / hr account with a password nobody knows
      // and IT is not allowed to see - tell IT to escalate.
      await log(req, 'password_reset_email_failed', user, `Reset for ${user.email} done but email failed`, {});
      return res.status(502).json({
        success: false,
        message: 'Password was reset but the email could not be sent. This account type cannot be handed out by IT - ask an admin to issue the password.'
      });
    }

    await log(req, 'password_reset', user, `Password reset for ${user.email}`, { emailSent, shownToIT: !emailOnly });

    res.json({
      success: true,
      message: emailSent ? 'Password reset and emailed to the user' : 'Password reset (email could not be sent)',
      emailSent,
      ...(emailOnly ? {} : { temporaryPassword: temp })
    });
  } catch (error) {
    console.error('IT reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// ---------------------------------------------------------------------------
// Support session: read-only "view as user"
// ---------------------------------------------------------------------------
router.post('/users/:userId/view-as', async (req, res) => {
  try {
    const target = await loadManageableUser(req, res);
    if (!target) return;

    if (!target.isActive) return res.status(400).json({ success: false, message: 'Account is deactivated' });
    if (String(target._id) === req.user.userId) return res.status(400).json({ success: false, message: 'That is your own account' });
    if (!VIEW_AS_ROLES.includes(target.role)) {
      return res.status(403).json({
        success: false,
        message: `Support sessions are not allowed for ${target.role} accounts (payroll, HR and finance data).`
      });
    }

    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) {
      return res.status(400).json({ success: false, message: 'A reason (at least 5 characters) is required for a support session' });
    }

    const token = jwt.sign(
      { userId: target._id, role: target.role, impersonatedBy: req.user.userId },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );

    await log(req, 'support_session_started', target, `Started read-only support session as ${target.email}`, { reason });

    res.json({
      success: true,
      message: 'Read-only support session started (30 minutes)',
      data: {
        token,
        expiresInMinutes: 30,
        user: {
          _id: target._id,
          id: target._id,
          fullName: target.fullName,
          email: target.email,
          role: target.role,
          department: target.department,
          position: target.position
        }
      }
    });
  } catch (error) {
    console.error('IT view-as error:', error);
    res.status(500).json({ success: false, message: 'Failed to start support session' });
  }
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------
router.get('/logs/activity', async (req, res) => {
  try {
    const { action, performedBy, targetUser, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (mongoose.isValidObjectId(performedBy)) filter.performedBy = performedBy;
    if (mongoose.isValidObjectId(targetUser)) filter.targetUser = targetUser;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

    const [logs, total] = await Promise.all([
      ITAuditLog.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      ITAuditLog.countDocuments(filter)
    ]);
    res.json({ success: true, data: logs, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('IT activity log error:', error);
    res.status(500).json({ success: false, message: 'Failed to load activity log' });
  }
});

router.get('/logs/errors', async (req, res) => {
  try {
    const { status, search, hours, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = parseInt(status);
    if (search) filter.url = { $regex: String(search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (hours) filter.createdAt = { $gte: new Date(Date.now() - parseInt(hours) * 3600 * 1000) };

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

    const [logs, total] = await Promise.all([
      SystemErrorLog.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      SystemErrorLog.countDocuments(filter)
    ]);
    res.json({ success: true, data: logs, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('IT error log error:', error);
    res.status(500).json({ success: false, message: 'Failed to load error log' });
  }
});

router.get('/logs/logins', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const users = await User.find({ lastLogin: { $ne: null } })
      .select('fullName email role department lastLogin isActive')
      .sort({ lastLogin: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('IT logins error:', error);
    res.status(500).json({ success: false, message: 'Failed to load login history' });
  }
});

// ---------------------------------------------------------------------------
// Configuration (read-only view of the department structure)
// ---------------------------------------------------------------------------
router.get('/config/department-structure', async (req, res) => {
  try {
    const structure = require('../config/departmentStructure');
    const data = structure.DEPARTMENT_STRUCTURE || structure.departmentStructure || structure;
    res.json({ success: true, data });
  } catch (error) {
    console.error('IT department structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to load department structure' });
  }
});

module.exports = router;
