/**
 * Expense claims and mission expenses with advance reconciliation.
 * Approval: line manager (from the org structure) -> finance. Finance approval posts to accounting.
 */
const express = require('express');
const mongoose = require('mongoose');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const { upload } = require('../middlewares/uploadMiddleware');
const ExpenseClaim = require('../models/ExpenseClaim');
const User = require('../models/User');
const Counter = require('../models/Counter');

const router = express.Router();
router.use(authMiddleware);

const CATEGORIES = ExpenseClaim.CATEGORIES;
// SYSCOHADA expense account per category
const EXPENSE_ACCOUNT = {
  transport: '614', accommodation: '638', meals: '638', per_diem: '663', fuel: '605',
  communication: '628', supplies: '605', training: '633', other: '638'
};
const FINANCE = ['finance', 'admin'];
const SEES_ALL = ['finance', 'admin', 'ceo'];

const r0 = (v) => Math.round(Number(v) || 0);
const oid = (id) => { if (!mongoose.Types.ObjectId.isValid(id)) throw Object.assign(new Error('Invalid ID'), { status: 400 }); return id; };
const fail = (res, e) => res.status(e.status || (e.name === 'ValidationError' ? 400 : 500)).json({ success: false, message: e.message });
const uid = (req) => String(req.user.userId || req.user._id || req.user.id);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const same = (a, b) => String(a) === String(b);
const lc = (s) => String(s || '').toLowerCase().trim();

async function nextNumber() {
  const key = `EXP-${new Date().getFullYear()}`;
  const c = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${key}-${String(c.seq).padStart(5, '0')}`;
}
function history(claim, req, action, comment) {
  claim.history.push({ action, by: uid(req), byName: req.user.fullName || req.user.email || '', comment: comment || '' });
}

// Normalise items; per-diem amounts are days x rate
function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((i) => i && i.category).map((i) => {
    if (!CATEGORIES.includes(i.category)) throw bad(`Unknown category ${i.category}`);
    const isPd = i.category === 'per_diem';
    const days = isPd ? Number(i.days) || 0 : undefined;
    const rate = isPd ? Number(i.rate) || 0 : undefined;
    const amount = isPd ? r0(days * rate) : r0(i.amount);
    if (!i.date) throw bad('Every line needs a date');
    if (!String(i.description || '').trim()) throw bad('Every line needs a description');
    if (!(amount > 0)) throw bad('Every line needs an amount above zero');
    return { date: i.date, category: i.category, description: String(i.description).trim(), days, rate, amount };
  });
}
function reconcile(claim) {
  claim.total = claim.items.reduce((s, i) => s + i.amount, 0);
  const adv = r0(claim.advance?.amount);
  claim.reimbursementDue = Math.max(0, claim.total - adv);
  claim.surplusDue = Math.max(0, adv - claim.total);
}

async function managerFor(user) {
  try {
    const { findPersonByEmail } = require('../config/departmentStructure');
    const person = findPersonByEmail(user.email) || findPersonByEmail(lc(user.email));
    if (!person || !person.reportsTo) return null;
    const m = await User.findOne({ email: new RegExp(`^${String(person.reportsTo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), isActive: { $ne: false } }).select('fullName email').lean();
    return m ? { email: lc(m.email), name: m.fullName } : { email: lc(person.reportsTo), name: person.reportsTo };
  } catch (e) { return null; }
}

async function notify(to, subject, text) {
  if (!to) return;
  try { await require('../services/emailService').sendEmail({ to, subject, text }); } catch (e) { /* best effort */ }
}

// ── ACCOUNTING ─────────────────────────────────────────────────────────────
async function acct(code) {
  const svc = require('../services/accountingService');
  try { return await svc.getAccountByCode(code); } catch (e) {
    if (typeof svc.ensureDefaultChart === 'function') { await svc.ensureDefaultChart(); return svc.getAccountByCode(code); }
    throw e;
  }
}
const jl = (account, debit, credit, description) => ({ account: account._id, debit, credit, description });

async function postApproval(claim, userId) {
  const svc = require('../services/accountingService');
  const by = {};
  claim.items.forEach((i) => { const c = EXPENSE_ACCOUNT[i.category] || '638'; by[c] = (by[c] || 0) + i.amount; });
  const lines = [];
  for (const [code, amt] of Object.entries(by)) lines.push(jl(await acct(code), amt, 0, `Expense claim ${claim.claimNumber}`));
  const adv = r0(claim.advance?.amount);
  const clearAdvance = Math.min(claim.total, adv);
  if (clearAdvance > 0) lines.push(jl(await acct('4211'), 0, clearAdvance, `Advance settled ${claim.advance?.reference || ''}`.trim()));
  if (claim.reimbursementDue > 0) lines.push(jl(await acct('422'), 0, claim.reimbursementDue, 'Reimbursement due to employee'));
  return svc.createJournalEntry({
    date: new Date(), description: `Expense claim ${claim.claimNumber} - ${claim.employeeName}`,
    sourceType: 'expense_claim', sourceId: claim._id, lines
  }, userId);
}
const treasury = (c) => (['521', '571'].includes(String(c)) ? String(c) : '521');

function settleIfDone(claim) {
  const reimbOk = claim.reimbursementDue === 0 || claim.reimbursementPaid;
  const surplusOk = claim.surplusDue === 0 || claim.surplusReturned;
  if (claim.status === 'approved' && reimbOk && surplusOk) claim.status = 'settled';
}

// ── ACCESS ─────────────────────────────────────────────────────────────────
async function loadFor(req, id) {
  const claim = await ExpenseClaim.findById(oid(id));
  if (!claim) throw bad('Claim not found', 404);
  const mine = same(claim.employee, uid(req));
  const isMgr = claim.manager?.email && lc(claim.manager.email) === lc(req.user.email);
  if (!mine && !isMgr && !SEES_ALL.includes(req.user.role)) throw bad('Not allowed', 403);
  return claim;
}

// ── LIST ───────────────────────────────────────────────────────────────────
router.get('/claims', async (req, res) => {
  try {
    const scope = req.query.scope || 'mine';
    let f = {};
    if (scope === 'mine') f.employee = uid(req);
    else if (scope === 'manager') { f['manager.email'] = lc(req.user.email); f.status = req.query.status || 'pending_manager'; }
    else if (scope === 'all') {
      if (!SEES_ALL.includes(req.user.role)) throw bad('Not allowed', 403);
      if (req.query.status) f.status = req.query.status;
    } else throw bad('Unknown scope');
    const rows = await ExpenseClaim.find(f).select('-history -receipts').sort({ createdAt: -1 }).limit(500).lean();
    res.json({ success: true, data: rows });
  } catch (e) { fail(res, e); }
});

router.get('/claims/:id', async (req, res) => {
  try { res.json({ success: true, data: await loadFor(req, req.params.id) }); } catch (e) { fail(res, e); }
});

router.get('/summary', async (req, res) => {
  try {
    const me = uid(req);
    const [mine, toApprove] = await Promise.all([
      ExpenseClaim.countDocuments({ employee: me, status: { $in: ['draft', 'pending_manager', 'pending_finance', 'approved'] } }),
      ExpenseClaim.countDocuments({ 'manager.email': lc(req.user.email), status: 'pending_manager' })
    ]);
    const out = { mine, toApprove };
    if (FINANCE.includes(req.user.role)) {
      out.pendingFinance = await ExpenseClaim.countDocuments({ status: 'pending_finance' });
      out.awaitingPayment = await ExpenseClaim.countDocuments({ status: 'approved' });
    }
    res.json({ success: true, data: out });
  } catch (e) { fail(res, e); }
});

// ── CREATE / EDIT (claimant, while draft or rejected) ──────────────────────
function applyBody(claim, b) {
  if (b.title !== undefined) claim.title = String(b.title).trim();
  if (b.type !== undefined) claim.type = b.type === 'mission' ? 'mission' : 'expense';
  if (b.mission !== undefined) claim.mission = claim.type === 'mission' ? b.mission : undefined;
  if (b.items !== undefined) claim.items = cleanItems(b.items);
  if (b.advance !== undefined) claim.advance = { reference: b.advance?.reference, amount: Math.max(0, r0(b.advance?.amount)) };
  reconcile(claim);
}

router.post('/claims', async (req, res) => {
  try {
    const user = await User.findById(uid(req)).select('fullName email department').lean();
    if (!user) throw bad('User not found', 404);
    const claim = new ExpenseClaim({
      claimNumber: await nextNumber(), employee: uid(req), employeeName: user.fullName,
      employeeEmail: lc(user.email), department: user.department
    });
    if (!String(req.body.title || '').trim()) throw bad('A title is required');
    applyBody(claim, req.body);
    history(claim, req, 'created');
    await claim.save();
    res.status(201).json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

router.put('/claims/:id', async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (!same(claim.employee, uid(req))) throw bad('Only the claimant can edit a claim', 403);
    if (!['draft', 'rejected'].includes(claim.status)) throw bad('This claim can no longer be edited');
    applyBody(claim, req.body);
    history(claim, req, 'edited');
    await claim.save();
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

router.delete('/claims/:id', async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (!same(claim.employee, uid(req))) throw bad('Only the claimant can delete a claim', 403);
    if (claim.status !== 'draft') throw bad('Only drafts can be deleted');
    await claim.deleteOne();
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

router.post('/claims/:id/receipts', upload.array('receipts', 10), async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (!same(claim.employee, uid(req))) throw bad('Only the claimant can add receipts', 403);
    if (!['draft', 'rejected'].includes(claim.status)) throw bad('This claim can no longer be edited');
    const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');
    for (const file of req.files || []) {
      const saved = await saveFile(file, STORAGE_CATEGORIES.REIMBURSEMENTS, 'expense-claims', null);
      claim.receipts.push({ name: file.originalname, url: saved.url, publicId: saved.publicId, size: saved.bytes, mimetype: file.mimetype });
    }
    await claim.save();
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

router.delete('/claims/:id/receipts/:index', async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (!same(claim.employee, uid(req)) || !['draft', 'rejected'].includes(claim.status)) throw bad('Not allowed', 403);
    claim.receipts.splice(Number(req.params.index), 1);
    await claim.save();
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

// ── WORKFLOW ───────────────────────────────────────────────────────────────
router.post('/claims/:id/submit', async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (!same(claim.employee, uid(req))) throw bad('Only the claimant can submit', 403);
    if (!['draft', 'rejected'].includes(claim.status)) throw bad('Already submitted');
    if (!claim.items.length) throw bad('Add at least one expense line');
    if (claim.type === 'mission' && (!claim.mission?.destination || !claim.mission?.startDate || !claim.mission?.endDate)) {
      throw bad('Mission claims need a destination and dates');
    }
    const needsReceipt = claim.items.some((i) => i.category !== 'per_diem');
    if (needsReceipt && !claim.receipts.length) throw bad('Attach at least one receipt');
    reconcile(claim);
    const user = await User.findById(uid(req)).select('email').lean();
    const mgr = await managerFor(user);
    if (mgr && lc(mgr.email) !== lc(user.email)) {
      claim.manager = mgr; claim.status = 'pending_manager';
      history(claim, req, 'submitted', `To manager ${mgr.name}`);
    } else {
      claim.manager = undefined; claim.status = 'pending_finance';
      history(claim, req, 'submitted', 'No line manager found in the org structure, sent to finance');
    }
    claim.rejectionReason = undefined; claim.rejectedAtStage = undefined;
    await claim.save();
    if (claim.status === 'pending_manager') {
      notify(mgr.email, `Expense claim ${claim.claimNumber} awaiting your approval`,
        `${claim.employeeName} submitted "${claim.title}" for ${claim.total.toLocaleString()} XAF. Please review it in the ERP under Expenses.`);
    }
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

router.post('/claims/:id/manager-approve', async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (claim.status !== 'pending_manager') throw bad('Not awaiting manager approval');
    const isMgr = lc(claim.manager?.email) === lc(req.user.email);
    if (!isMgr && req.user.role !== 'admin') throw bad('Only the line manager can approve this claim', 403);
    if (same(claim.employee, uid(req))) throw bad('You cannot approve your own claim', 403);
    claim.status = 'pending_finance';
    history(claim, req, 'manager_approved', req.body.comment);
    await claim.save();
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

// Finance approval posts the claim; if posting fails nothing changes.
router.post('/claims/:id/finance-approve', requireRoles(...FINANCE), async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (claim.status !== 'pending_finance') throw bad('Not awaiting finance approval');
    if (same(claim.employee, uid(req))) throw bad('You cannot approve your own claim', 403);
    reconcile(claim);
    if (!claim.accrualEntry) {
      try { claim.accrualEntry = (await postApproval(claim, uid(req)))._id; } catch (e) { throw bad(`Could not post to accounting: ${e.message}`); }
    }
    claim.status = 'approved';
    history(claim, req, 'finance_approved', req.body.comment);
    settleIfDone(claim);
    await claim.save();
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

router.post('/claims/:id/reject', async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw bad('A rejection reason is required');
    if (claim.status === 'pending_manager') {
      if (lc(claim.manager?.email) !== lc(req.user.email) && req.user.role !== 'admin') throw bad('Only the line manager can reject this claim', 403);
    } else if (claim.status === 'pending_finance') {
      if (!FINANCE.includes(req.user.role)) throw bad('Only finance can reject this claim', 403);
    } else throw bad('Claim is not awaiting approval');
    claim.rejectedAtStage = claim.status;
    claim.status = 'rejected'; claim.rejectionReason = reason;
    history(claim, req, 'rejected', reason);
    await claim.save();
    notify(claim.employeeEmail, `Expense claim ${claim.claimNumber} was rejected`, `Reason: ${reason}\n\nYou can correct it and resubmit from Expenses.`);
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

router.post('/claims/:id/pay', requireRoles(...FINANCE), async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (claim.status !== 'approved') throw bad('Claim is not approved');
    if (!(claim.reimbursementDue > 0) || claim.reimbursementPaid) throw bad('Nothing to reimburse');
    const svc = require('../services/accountingService');
    const code = treasury(req.body.accountCode);
    try {
      const [due, bank] = await Promise.all([acct('422'), acct(code)]);
      const e = await svc.createJournalEntry({
        date: new Date(), description: `Reimbursement ${claim.claimNumber} - ${claim.employeeName}`,
        sourceType: 'expense_payment', sourceId: claim._id,
        lines: [jl(due, claim.reimbursementDue, 0, 'Reimbursement settled'), jl(bank, 0, claim.reimbursementDue, 'Paid from treasury')]
      }, uid(req));
      claim.paymentEntry = e._id;
    } catch (e) { throw bad(`Could not post payment: ${e.message}`); }
    claim.reimbursementPaid = true;
    history(claim, req, 'reimbursed', `Account ${code}`);
    settleIfDone(claim);
    await claim.save();
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

// Employee returns unspent advance cash
router.post('/claims/:id/return-surplus', requireRoles(...FINANCE), async (req, res) => {
  try {
    const claim = await loadFor(req, req.params.id);
    if (claim.status !== 'approved') throw bad('Claim is not approved');
    if (!(claim.surplusDue > 0) || claim.surplusReturned) throw bad('No unspent advance to collect');
    const svc = require('../services/accountingService');
    const code = treasury(req.body.accountCode);
    try {
      const [adv, bank] = await Promise.all([acct('4211'), acct(code)]);
      const e = await svc.createJournalEntry({
        date: new Date(), description: `Advance returned ${claim.claimNumber} - ${claim.employeeName}`,
        sourceType: 'expense_surplus_return', sourceId: claim._id,
        lines: [jl(bank, claim.surplusDue, 0, 'Unspent advance received'), jl(adv, 0, claim.surplusDue, 'Advance cleared')]
      }, uid(req));
      claim.surplusEntry = e._id;
    } catch (e) { throw bad(`Could not post: ${e.message}`); }
    claim.surplusReturned = true;
    history(claim, req, 'surplus_returned', `Account ${code}`);
    settleIfDone(claim);
    await claim.save();
    res.json({ success: true, data: claim });
  } catch (e) { fail(res, e); }
});

router.get('/meta', (req, res) => res.json({ success: true, categories: CATEGORIES }));

module.exports = router;
