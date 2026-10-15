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
const IT_ASSIGNABLE_ROLES = ['employee', 'buyer', 'supply_chain', 'technical', 'hse', 'project', 'it', 'sales'];
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

// ---------------------------------------------------------------------------
// Organisation structure (approval-chain registry)
// The hardcoded config/departmentStructure.js is the base; people added here are
// stored in StructureEntry and picked up by findPersonByEmail() immediately.
// ---------------------------------------------------------------------------
const StructureEntry = require('../models/StructureEntry');
const dynamicStructure = require('../config/dynamicStructure');
const { findPersonByEmail } = require('../config/departmentStructure');
const AUTHORITIES = ['staff', 'supervisor', 'coordinator', 'head', 'manager'];

/** Registers (or updates) a user in the runtime structure. Returns { entry, warning }. */
const registerInStructure = async (req, user, opts = {}) => {
  const email = String(user.email).toLowerCase().trim();
  const existing = findPersonByEmail(email);
  if (existing && !existing.dynamic) {
    return { skipped: true, warning: 'This person is already listed in the base department structure file.' };
  }

  const reportsTo = opts.reportsTo ? String(opts.reportsTo).toLowerCase().trim() : null;
  let warning = null;
  let supervisorPerson = null;
  if (reportsTo) {
    supervisorPerson = findPersonByEmail(reportsTo);
    if (!supervisorPerson) {
      warning = `Supervisor ${reportsTo} is not in the department structure, so approval chains will stop at ${user.fullName}. Register the supervisor first.`;
    }
  } else {
    warning = 'No supervisor given - approval chains for this person will have no departmental approver.';
  }

  const authority = AUTHORITIES.includes(opts.approvalAuthority) ? opts.approvalAuthority : 'staff';
  const level = Number(opts.hierarchyLevel) ||
    (supervisorPerson?.hierarchyLevel ? Math.max(1, supervisorPerson.hierarchyLevel - 1) : 1);

  const entry = await StructureEntry.findOneAndUpdate(
    { email },
    {
      email,
      name: user.fullName,
      department: opts.department || user.department,
      position: opts.position || user.position,
      reportsTo,
      hierarchyLevel: Math.min(6, Math.max(1, level)),
      canSupervise: Array.isArray(opts.canSupervise) ? opts.canSupervise : [],
      approvalAuthority: authority,
      isDepartmentHead: false,
      user: user._id,
      addedBy: req.user.userId
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  await dynamicStructure.refresh();
  await log(req, 'structure_registered', user, `Registered ${email} in approval structure (reports to ${reportsTo || 'nobody'})`, { reportsTo, level: entry.hierarchyLevel, authority });
  return { entry, warning };
};

router.get('/structure/entries', async (req, res) => {
  try {
    const entries = await StructureEntry.find({}).sort({ department: 1, hierarchyLevel: -1, name: 1 }).lean();
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('IT structure entries error:', error);
    res.status(500).json({ success: false, message: 'Failed to load structure entries' });
  }
});

router.get('/users/:userId/structure', async (req, res) => {
  try {
    const user = await loadManageableUser(req, res);
    if (!user) return;
    const person = findPersonByEmail(user.email);
    res.json({
      success: true,
      data: person
        ? { registered: true, source: person.dynamic ? 'runtime' : 'base', reportsTo: person.reportsTo, hierarchyLevel: person.hierarchyLevel, approvalAuthority: person.approvalAuthority, position: person.position, department: person.department }
        : { registered: false }
    });
  } catch (error) {
    console.error('IT structure lookup error:', error);
    res.status(500).json({ success: false, message: 'Failed to look up structure' });
  }
});

// Builds the approval line a person's requests would follow by running the same
// chain builders the workflows use. Read-only.
const buildChainPreview = ({ type, email, fullName, department, amount, requestType }) => {
  const notes = [];
  const person = findPersonByEmail(email);
  const source = person ? (person.dynamic ? (person.source === 'base' ? 'edited' : 'runtime') : 'base') : 'none';
  if (!person) notes.push('This person is not in the department structure, so workflows fall back to a default approval chain. Add them in the Org structure editor.');

  const origLog = console.log; // the builders are chatty
  let raw = [];
  try {
    console.log = () => {};
    switch (type) {
      case 'department':
        raw = require('../config/departmentStructure').getApprovalChainFromStructure(email);
        break;
      case 'requisition':
        raw = require('../config/requisitionApprovalChain').getApprovalChainForRequisition(email, amount);
        break;
      case 'cash':
        raw = require('../config/cashRequestApprovalChain').getCashRequestApprovalChain(email, requestType, amount);
        break;
      case 'it_support':
        raw = require('../config/itSupportApprovalChain').getITSupportApprovalChain(email);
        break;
      case 'leave':
        raw = require('../config/leaveApprovalChain').getLeaveApprovalChain(fullName, department);
        notes.push('The leave chain is matched by name and department from the base structure file; people added or edited in the editor get its default chain.');
        break;
      case 'invoice':
        raw = require('../config/invoiceApprovalChain').getInvoiceApprovalChain(fullName, department, amount);
        notes.push('The invoice chain is matched by name and department from the base structure file; people added or edited in the editor get its default chain.');
        break;
      default:
        return { error: 'Unknown chain type' };
    }
  } finally {
    console.log = origLog;
  }

  const steps = (Array.isArray(raw) ? raw : []).map((st, i) => {
    const a = st.approver || st;
    return {
      level: st.level || i + 1,
      name: a.name || a.fullName || '-',
      email: a.email || null,
      role: a.role || a.position || null,
      department: a.department || null,
      required: st.required !== false
    };
  });
  if (!steps.length) notes.push('No approval steps were produced for this person.');
  return { steps, notes, source };
};

const parseChainQuery = (q) => ({
  type: String(q.type || 'requisition'),
  amount: q.amount !== undefined && q.amount !== '' ? Number(q.amount) : null,
  requestType: String(q.requestType || 'expense')
});

router.get('/users/:userId/approval-chain', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }
    const user = await User.findById(req.params.userId).select('fullName email department position role supervisor');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const q = parseChainQuery(req.query);
    const out = buildChainPreview({ ...q, email: String(user.email).toLowerCase().trim(), fullName: user.fullName, department: user.department });
    if (out.error) return res.status(400).json({ success: false, message: out.error });

    res.json({
      success: true,
      data: {
        user: { _id: user._id, fullName: user.fullName, email: user.email, department: user.department, position: user.position },
        type: q.type, amount: q.amount, requestType: q.requestType, source: out.source, steps: out.steps, notes: out.notes
      }
    });
  } catch (error) {
    console.error('IT approval chain preview error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to build approval chain' });
  }
});

// ---------------------------------------------------------------------------
// Org structure editor
// The base file (config/departmentStructure.js) stays the starting point. Editing a
// person there saves an override in StructureEntry (source 'base', edited true);
// "reset" deletes it and the file value applies again. People not in the file are
// stored as source 'runtime'. Lookups pick overrides up via config/dynamicStructure.
// ---------------------------------------------------------------------------
const lcE = (s) => String(s || '').toLowerCase().trim();

const baseStructurePeople = () => {
  const { DEPARTMENT_STRUCTURE } = require('../config/departmentStructure');
  const out = [];
  for (const [dept, d] of Object.entries(DEPARTMENT_STRUCTURE)) {
    out.push({ dept, position: d.head.position, isHead: true, ...d.head });
    for (const [position, p] of Object.entries(d.positions || {})) out.push({ dept, positionKey: position, position: p.position || position, ...p });
  }
  return out;
};

const wouldCycle = (email, reportsTo) => {
  const seen = new Set([email]);
  let cur = reportsTo;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    const p = findPersonByEmail(cur);
    cur = p && p.reportsTo ? lcE(p.reportsTo) : null;
  }
  return false;
};

router.get('/structure/people', async (req, res) => {
  try {
    await dynamicStructure.refresh();
    const overrides = new Map(dynamicStructure.all().map((e) => [lcE(e.email), e]));
    const seen = new Set();
    const rows = [];

    for (const p of baseStructurePeople()) {
      const email = lcE(p.email);
      if (seen.has(email)) continue; // a few emails are listed twice in the file
      seen.add(email);
      const ov = overrides.get(email);
      const eff = ov && ov.edited ? ov : p;
      rows.push({
        email, name: eff.name, department: ov && ov.edited ? ov.department : p.dept,
        position: eff.position, reportsTo: eff.reportsTo ? lcE(eff.reportsTo) : null,
        hierarchyLevel: eff.hierarchyLevel, approvalAuthority: eff.approvalAuthority || null,
        canSupervise: eff.canSupervise || [], isDepartmentHead: !!(p.isHead || eff.isDepartmentHead),
        source: 'base', edited: !!(ov && ov.edited),
        original: ov && ov.edited ? { reportsTo: p.reportsTo ? lcE(p.reportsTo) : null, position: p.position, hierarchyLevel: p.hierarchyLevel, approvalAuthority: p.approvalAuthority || null } : null
      });
    }
    for (const e of dynamicStructure.all()) {
      const email = lcE(e.email);
      if (e.source === 'base' || seen.has(email)) continue;
      seen.add(email);
      rows.push({
        email, name: e.name, department: e.department, position: e.position, reportsTo: e.reportsTo,
        hierarchyLevel: e.hierarchyLevel, approvalAuthority: e.approvalAuthority, canSupervise: e.canSupervise || [],
        isDepartmentHead: !!e.isDepartmentHead, source: 'runtime', edited: false, original: null
      });
    }
    rows.sort((a, b) => (a.department || '').localeCompare(b.department || '') || (b.hierarchyLevel || 0) - (a.hierarchyLevel || 0) || a.name.localeCompare(b.name));
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('IT structure people error:', error);
    res.status(500).json({ success: false, message: 'Failed to load the org structure' });
  }
});

const saveStructurePerson = async (req, res, isCreate) => {
  try {
    const email = lcE(isCreate ? req.body.email : req.params.email);
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const base = baseStructurePeople().find((p) => lcE(p.email) === email);
    const existing = await StructureEntry.findOne({ email });
    if (isCreate && (base || existing)) return res.status(409).json({ success: false, message: 'That person is already in the structure - edit them instead' });
    if (!isCreate && !base && !existing) return res.status(404).json({ success: false, message: 'Person not found in the structure' });

    const cur = findPersonByEmail(email) || {};
    const b = req.body || {};
    const reportsTo = b.reportsTo === undefined ? (cur.reportsTo ? lcE(cur.reportsTo) : null) : (lcE(b.reportsTo) || null);

    if (reportsTo) {
      if (reportsTo === email) return res.status(400).json({ success: false, message: 'A person cannot report to themselves' });
      if (!findPersonByEmail(reportsTo)) return res.status(400).json({ success: false, message: `${reportsTo} is not in the structure - add them first` });
      if (wouldCycle(email, reportsTo)) return res.status(400).json({ success: false, message: 'That would create a reporting loop' });
    }
    if (b.approvalAuthority !== undefined && b.approvalAuthority !== null && !AUTHORITIES.includes(b.approvalAuthority)) {
      return res.status(400).json({ success: false, message: 'Invalid approval authority' });
    }
    const level = b.hierarchyLevel === undefined || b.hierarchyLevel === null ? (cur.hierarchyLevel || 1) : Number(b.hierarchyLevel);
    if (!(level >= 1 && level <= 6)) return res.status(400).json({ success: false, message: 'Hierarchy level must be 1 to 6' });

    const name = (b.name || cur.name || '').trim();
    const department = (b.department || cur.department || (base && base.dept) || '').trim();
    const position = (b.position || cur.position || '').trim();
    if (!name || !department || !position) return res.status(400).json({ success: false, message: 'Name, department and position are required' });

    const before = existing ? existing.toObject() : (base ? { reportsTo: base.reportsTo, position: base.position, hierarchyLevel: base.hierarchyLevel } : null);
    const entry = await StructureEntry.findOneAndUpdate(
      { email },
      {
        email, name, department, position, reportsTo, hierarchyLevel: level,
        canSupervise: Array.isArray(b.canSupervise) ? b.canSupervise : (cur.canSupervise || []),
        approvalAuthority: b.approvalAuthority || cur.approvalAuthority || 'staff',
        isDepartmentHead: !!(base && base.isHead) || !!b.isDepartmentHead,
        source: base ? 'base' : 'runtime',
        edited: true,
        notes: b.notes || '',
        addedBy: req.user.userId
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await dynamicStructure.refresh();
    await log(req, isCreate ? 'structure_person_added' : 'structure_person_edited', null,
      `${isCreate ? 'Added' : 'Edited'} ${email} in the org structure (reports to ${reportsTo || 'nobody'})`, { email, before, after: { reportsTo, position, hierarchyLevel: level } });
    res.json({ success: true, message: isCreate ? 'Person added to the structure' : 'Structure updated', data: entry });
  } catch (error) {
    console.error('IT save structure person error:', error);
    res.status(error.name === 'ValidationError' ? 400 : 500).json({ success: false, message: error.message || 'Failed to save' });
  }
};

router.post('/structure/people', (req, res) => saveStructurePerson(req, res, true));
router.put('/structure/people/:email', (req, res) => saveStructurePerson(req, res, false));

router.delete('/structure/people/:email', async (req, res) => {
  try {
    const email = lcE(req.params.email);
    const out = await StructureEntry.deleteOne({ email });
    await dynamicStructure.refresh();
    const stillInFile = baseStructurePeople().some((p) => lcE(p.email) === email);
    await log(req, 'structure_person_reset', null, `${stillInFile ? 'Reset to file values' : 'Removed from structure'}: ${email}`, { email });
    res.json({ success: true, message: stillInFile ? 'Reset to the values in the structure file' : (out.deletedCount ? 'Removed from the structure' : 'Nothing to remove') });
  } catch (error) {
    console.error('IT reset structure person error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset' });
  }
});

router.get('/structure/preview', async (req, res) => {
  try {
    const email = lcE(req.query.email);
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    const person = findPersonByEmail(email);
    const q = parseChainQuery(req.query);
    const out = buildChainPreview({ ...q, email, fullName: person?.name || '', department: person?.department || '' });
    if (out.error) return res.status(400).json({ success: false, message: out.error });
    res.json({ success: true, data: { type: q.type, amount: q.amount, source: out.source, steps: out.steps, notes: out.notes, person: person ? { name: person.name, position: person.position, department: person.department, email } : null } });
  } catch (error) {
    console.error('IT structure preview error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to build approval chain' });
  }
});

router.post('/users/:userId/structure', async (req, res) => {
  try {
    const user = await loadManageableUser(req, res);
    if (!user) return;
    const result = await registerInStructure(req, user, req.body || {});
    if (result.skipped) return res.status(409).json({ success: false, message: result.warning });
    res.json({ success: true, message: 'Registered in the approval structure', warning: result.warning, data: result.entry });
  } catch (error) {
    console.error('IT register structure error:', error);
    res.status(error.name === 'ValidationError' ? 400 : 500).json({ success: false, message: error.message || 'Failed to register in structure' });
  }
});

router.delete('/users/:userId/structure', async (req, res) => {
  try {
    const user = await loadManageableUser(req, res);
    if (!user) return;
    const out = await StructureEntry.deleteOne({ email: String(user.email).toLowerCase().trim() });
    await dynamicStructure.refresh();
    await log(req, 'structure_removed', user, `Removed ${user.email} from runtime approval structure`, {});
    res.json({ success: true, message: out.deletedCount ? 'Removed from the approval structure' : 'Not in the runtime structure (base-file entries cannot be removed here)' });
  } catch (error) {
    console.error('IT remove structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove from structure' });
  }
});

// Create a new user account. IT may create accounts for the roles it can assign;
// finance / hr / admin / ceo accounts can only be created by an admin / ceo.
// A temporary password is generated and emailed to the new user.
router.post('/users', async (req, res) => {
  try {
    const { fullName, email, department, position, role = 'employee', departmentRole = 'staff', phone, personalEmail, supervisorEmail, addToStructure = true, hierarchyLevel, approvalAuthority } = req.body;

    if (!fullName || !String(fullName).trim()) return res.status(400).json({ success: false, message: 'Full name is required' });
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!department || !position) return res.status(400).json({ success: false, message: 'Department and position are required' });

    if (role === 'supplier') {
      return res.status(400).json({ success: false, message: 'Supplier accounts are created through supplier onboarding' });
    }
    if (!isFullAdmin(req) && !IT_ASSIGNABLE_ROLES.includes(role)) {
      return res.status(403).json({ success: false, message: `Only an admin or CEO can create ${role} accounts` });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const exists = await User.findOne({ email: cleanEmail }).select('_id');
    if (exists) return res.status(409).json({ success: false, message: 'An account with that email already exists' });

    let supervisor = null;
    if (supervisorEmail) {
      supervisor = await User.findOne({ email: String(supervisorEmail).toLowerCase().trim() }).select('_id fullName');
      if (!supervisor) return res.status(400).json({ success: false, message: 'No user found with that supervisor email' });
    }

    const pick = (chars) => chars[crypto.randomInt(chars.length)];
    const all = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let temp = pick('ABCDEFGHJKLMNPQRSTUVWXYZ') + pick('abcdefghijkmnopqrstuvwxyz') + pick('23456789') + pick('@#$%');
    while (temp.length < 12) temp += pick(all);
    temp = temp.split('').sort(() => crypto.randomInt(3) - 1).join('');

    // password is hashed by the model's pre-save hook
    const created = await User.create({
      fullName: String(fullName).trim(),
      email: cleanEmail,
      personalEmail: personalEmail ? String(personalEmail).toLowerCase().trim() : undefined,
      phoneNumber: phone || undefined,
      password: temp,
      department,
      position,
      role,
      departmentRole,
      isActive: true
    });

    if (supervisor) {
      try {
        await HierarchyService.updateSupervisor(created._id, supervisor._id, req.user.userId);
      } catch (e) {
        console.error('IT create user: supervisor link failed:', e.message);
        await User.updateOne({ _id: created._id }, { $set: { supervisor: supervisor._id } });
      }
    }

    let structure = null;
    if (addToStructure !== false) {
      try {
        structure = await registerInStructure(req, created, {
          reportsTo: supervisorEmail, hierarchyLevel, approvalAuthority, department, position
        });
      } catch (e) {
        console.error('IT create user: structure registration failed:', e.message);
        structure = { warning: 'Account created but could not be added to the approval structure: ' + e.message };
      }
    }

    let emailSent = false;
    try {
      const { sendEmail } = require('../services/emailService');
      const result = await sendEmail({
        to: cleanEmail,
        subject: 'Your GRATO ERP account has been created',
        text:
          `Hello ${created.fullName},\n\nAn account has been created for you on the GRATO ERP by the IT department.\n\n` +
          `Email: ${cleanEmail}\nTemporary password: ${temp}\n` +
          `Login: ${process.env.FRONTEND_URL || ''}/login\n\n` +
          `Please log in and change your password immediately.`
      });
      emailSent = !!(result && result.success !== false);
    } catch (e) {
      console.error('IT create user email failed:', e.message);
    }

    // IT can only create non-sensitive roles (enforced above), so showing the temporary
    // password to the creator is safe; admin/ceo creating any role also see it.
    await log(req, 'user_created', created, `Created ${role} account for ${cleanEmail}`, { role, department, position, emailSent });

    res.status(201).json({
      success: true,
      message: emailSent ? 'Account created and login details emailed to the user' : 'Account created (login email could not be sent)',
      emailSent,
      data: { _id: created._id, fullName: created.fullName, email: created.email, role: created.role },
      structureRegistered: !!(structure && structure.entry),
      structureWarning: structure?.warning || null,
      temporaryPassword: temp
    });
  } catch (error) {
    console.error('IT create user error:', error);
    const status = error.name === 'ValidationError' ? 400 : error.code === 11000 ? 409 : 500;
    res.status(status).json({ success: false, message: error.code === 11000 ? 'An account with that email already exists' : (error.message || 'Failed to create user') });
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
