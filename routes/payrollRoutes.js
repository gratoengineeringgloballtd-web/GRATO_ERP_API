/**
 * Payroll: salary profiles, statutory rates, monthly runs, approval (HR -> Finance -> CEO),
 * accounting posting and payslip PDFs.
 */
const express = require('express');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const SalaryProfile = require('../models/SalaryProfile');
const PayrollRate = require('../models/PayrollRate');
const PayrollRun = require('../models/PayrollRun');
const SalaryPayment = require('../models/SalaryPayment');
const User = require('../models/User');
const Counter = require('../models/Counter');
const engine = require('../services/payrollEngine');

const router = express.Router();
router.use(authMiddleware);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ');
const oid = (id) => { if (!mongoose.Types.ObjectId.isValid(id)) throw Object.assign(new Error('Invalid ID'), { status: 400 }); return id; };
const fail = (res, e) => res.status(e.status || (e.name === 'ValidationError' ? 400 : 500)).json({ success: false, message: e.message });
const uid = (req) => req.user.userId || req.user._id || req.user.id;
const isRole = (req, ...roles) => roles.includes(req.user.role);
const STAFF = ['hr', 'finance', 'admin', 'ceo'];
const needStaff = requireRoles(...STAFF);
const only = (...roles) => requireRoles(...roles);

async function getRates() {
  let doc = await PayrollRate.findOne({ key: 'default' });
  if (!doc) doc = await PayrollRate.create({ key: 'default' });
  return doc;
}
const ratesObj = (doc) => {
  const o = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, key, createdAt, updatedAt, updatedBy, ...rest } = o;
  return rest;
};

async function nextRunNumber(year) {
  const key = `PAYRUN-${year}`;
  const c = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${key}-${String(c.seq).padStart(3, '0')}`;
}

function calcLine(line, rates) {
  const result = engine.computePayslip(line.profile, line.adjustments, rates);
  line.result = result;
  return result;
}
function recomputeRun(run, rates) {
  run.lines.forEach((l) => calcLine(l, rates));
  run.totals = engine.summarize(run.lines.map((l) => l.result));
  run.ratesSnapshot = rates;
  run.markModified('lines');
  run.markModified('totals');
}
function addHistory(run, req, action, comment) {
  run.history.push({ action, by: uid(req), byName: req.user.fullName || req.user.email || '', comment: comment || '' });
}
async function loadRun(id) {
  const run = await PayrollRun.findById(oid(id));
  if (!run) throw Object.assign(new Error('Payroll run not found'), { status: 404 });
  return run;
}
const sameUser = (a, b) => String(a) === String(b);

// ── ACCOUNTING ─────────────────────────────────────────────────────────────
async function acct(code) {
  const svc = require('../services/accountingService');
  try { return await svc.getAccountByCode(code); } catch (e) {
    if (typeof svc.ensureDefaultChart === 'function') {
      await svc.ensureDefaultChart();
      return svc.getAccountByCode(code);
    }
    throw e;
  }
}
const jl = (account, debit, credit, description) => ({ account: account._id, debit, credit, description });

async function postAccrual(run, userId) {
  const svc = require('../services/accountingService');
  const a = engine.postingAmounts(run.totals);
  const [sal, chg, net, cnps, inc, oth, adv] = await Promise.all([
    acct('661'), acct('664'), acct('422'), acct('431'), acct('4471'), acct('4472'), acct('4211')
  ]);
  const lines = [
    jl(sal, a.debitSalaries, 0, 'Gross salaries'),
    jl(chg, a.debitCharges, 0, 'Employer social charges'),
    jl(net, 0, a.creditNet, 'Net pay due to staff'),
    jl(cnps, 0, a.creditCnps, 'CNPS contributions'),
    jl(inc, 0, a.creditIncomeTax, 'IRPP and CAC withheld'),
    jl(oth, 0, a.creditOtherTaxes, 'CFC and FNE'),
    jl(adv, 0, a.creditRecoveries, 'Staff recoveries')
  ].filter((l) => l.debit || l.credit);
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  if (debit !== credit) throw new Error(`Payroll posting is out of balance (${debit} vs ${credit})`);
  const lastDay = new Date(Date.UTC(run.period.year, run.period.month, 0));
  return svc.createJournalEntry({
    date: lastDay,
    description: `Payroll ${MONTHS[run.period.month - 1]} ${run.period.year} (${run.runNumber})`,
    sourceType: 'payroll_run', sourceId: run._id, lines
  }, userId);
}

async function postPayment(run, treasuryCode, userId) {
  const svc = require('../services/accountingService');
  const [due, bank] = await Promise.all([acct('422'), acct(treasuryCode)]);
  const amount = run.totals.net;
  return svc.createJournalEntry({
    date: new Date(),
    description: `Payroll payment ${MONTHS[run.period.month - 1]} ${run.period.year} (${run.runNumber})`,
    sourceType: 'payroll_payment', sourceId: run._id,
    lines: [jl(due, amount, 0, 'Net pay settled'), jl(bank, 0, amount, 'Paid from treasury')]
  }, userId);
}

// ── RATES ──────────────────────────────────────────────────────────────────
router.get('/rates', needStaff, async (req, res) => {
  try { res.json({ success: true, data: ratesObj(await getRates()), defaults: engine.DEFAULT_RATES }); } catch (e) { fail(res, e); }
});
router.put('/rates', only('admin', 'finance'), async (req, res) => {
  try {
    const doc = await getRates();
    const keys = Object.keys(engine.DEFAULT_RATES);
    for (const k of keys) {
      if (req.body[k] === undefined) continue;
      if (k === 'irppBrackets') {
        const b = req.body[k];
        if (!Array.isArray(b) || !b.length) throw Object.assign(new Error('IRPP brackets must be a non-empty list'), { status: 400 });
        doc.irppBrackets = b.map((x) => ({ upTo: x.upTo === '' || x.upTo == null ? null : Number(x.upTo), rate: Number(x.rate) }));
      } else {
        const v = Number(req.body[k]);
        if (!Number.isFinite(v) || v < 0) throw Object.assign(new Error(`Invalid value for ${k}`), { status: 400 });
        doc[k] = v;
      }
    }
    doc.updatedBy = uid(req);
    await doc.save();
    res.json({ success: true, data: ratesObj(doc) });
  } catch (e) { fail(res, e); }
});

// ── SALARY PROFILES ────────────────────────────────────────────────────────
router.get('/employees', only('hr', 'admin'), async (req, res) => {
  try {
    const users = await User.find({ isActive: { $ne: false }, role: { $ne: 'supplier' } })
      .select('fullName email department position role').sort({ fullName: 1 }).lean();
    const profiles = await SalaryProfile.find({}).select('employee status').lean();
    const has = new Map(profiles.map((p) => [String(p.employee), p.status]));
    res.json({ success: true, data: users.map((u) => ({ ...u, profileStatus: has.get(String(u._id)) || null })) });
  } catch (e) { fail(res, e); }
});

router.get('/profiles', only('hr', 'finance', 'admin', 'ceo'), async (req, res) => {
  try {
    const rows = await SalaryProfile.find({}).populate('employee', 'fullName email department position').lean();
    const rates = ratesObj(await getRates());
    res.json({
      success: true,
      data: rows.map((p) => ({ ...p, preview: engine.computePayslip(p, [], rates) }))
    });
  } catch (e) { fail(res, e); }
});

router.put('/profiles/:employeeId', only('hr', 'admin'), async (req, res) => {
  try {
    const employee = oid(req.params.employeeId);
    const user = await User.findById(employee).select('_id');
    if (!user) throw Object.assign(new Error('Employee not found'), { status: 404 });
    const b = req.body || {};
    const base = Number(b.baseSalary);
    if (!Number.isFinite(base) || base < 0) throw Object.assign(new Error('Base salary is required'), { status: 400 });
    const clean = (arr, withFlags) => (Array.isArray(arr) ? arr : [])
      .filter((x) => x && String(x.name || '').trim() && Number(x.amount) >= 0)
      .map((x) => withFlags
        ? { name: String(x.name).trim(), amount: Number(x.amount), taxable: x.taxable !== false, cnpsable: x.cnpsable !== false }
        : { name: String(x.name).trim(), amount: Number(x.amount) });
    const doc = await SalaryProfile.findOneAndUpdate(
      { employee },
      {
        $set: {
          baseSalary: base,
          allowances: clean(b.allowances, true),
          fixedDeductions: clean(b.fixedDeductions, false),
          exemptCnps: !!b.exemptCnps, exemptTax: !!b.exemptTax,
          cnpsNumber: b.cnpsNumber, taxPayerNumber: b.taxPayerNumber,
          paymentMethod: b.paymentMethod || 'bank', bankName: b.bankName, bankAccount: b.bankAccount,
          hireDate: b.hireDate || undefined, status: b.status || 'active', notes: b.notes,
          updatedBy: uid(req)
        }
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: doc });
  } catch (e) { fail(res, e); }
});

// ── RUNS ───────────────────────────────────────────────────────────────────
router.get('/runs', needStaff, async (req, res) => {
  try {
    const f = {};
    if (req.query.year) f['period.year'] = Number(req.query.year);
    if (req.query.status) f.status = req.query.status;
    const rows = await PayrollRun.find(f).select('-lines -ratesSnapshot').sort({ 'period.year': -1, 'period.month': -1 })
      .populate('preparedBy', 'fullName').lean();
    res.json({ success: true, data: rows });
  } catch (e) { fail(res, e); }
});

router.post('/runs', only('hr', 'admin'), async (req, res) => {
  try {
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    if (!(month >= 1 && month <= 12) || !(year >= 2000)) throw Object.assign(new Error('Valid month and year are required'), { status: 400 });
    const clash = await PayrollRun.findOne({ 'period.month': month, 'period.year': year, status: { $ne: 'rejected' } });
    if (clash) throw Object.assign(new Error(`A payroll run already exists for ${MONTHS[month - 1]} ${year} (${clash.runNumber})`), { status: 409 });
    const profiles = await SalaryProfile.find({ status: 'active' }).populate('employee', 'fullName department position isActive').lean();
    const usable = profiles.filter((p) => p.employee && p.employee.isActive !== false);
    if (!usable.length) throw Object.assign(new Error('No active salary profiles. Set up employee salaries first.'), { status: 400 });
    const rates = ratesObj(await getRates());
    const run = new PayrollRun({
      runNumber: await nextRunNumber(year),
      period: { month, year },
      title: `Payroll ${MONTHS[month - 1]} ${year}`,
      preparedBy: uid(req),
      lines: usable.map((p) => ({
        employee: p.employee._id, name: p.employee.fullName, position: p.employee.position, department: p.employee.department,
        paymentMethod: p.paymentMethod, bankName: p.bankName, bankAccount: p.bankAccount, cnpsNumber: p.cnpsNumber,
        adjustments: [],
        profile: {
          baseSalary: p.baseSalary, allowances: p.allowances, fixedDeductions: p.fixedDeductions,
          exemptCnps: p.exemptCnps, exemptTax: p.exemptTax
        }
      }))
    });
    recomputeRun(run, rates);
    addHistory(run, req, 'created', `${run.lines.length} employees`);
    await run.save();
    res.status(201).json({ success: true, data: run });
  } catch (e) { fail(res, e); }
});

router.get('/runs/:id', needStaff, async (req, res) => {
  try {
    const run = await PayrollRun.findById(oid(req.params.id)).populate('preparedBy', 'fullName').lean();
    if (!run) throw Object.assign(new Error('Payroll run not found'), { status: 404 });
    const legacy = await SalaryPayment.find({ 'paymentPeriod.month': run.period.month, 'paymentPeriod.year': run.period.year })
      .select('totalAmount status description accountingAudit').lean();
    res.json({ success: true, data: run, legacyPayments: legacy });
  } catch (e) { fail(res, e); }
});

// Replace one employee's adjustments (bonus/overtime/deduction) while the run is a draft
router.put('/runs/:id/lines/:lineId/adjustments', only('hr', 'admin'), async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    if (run.status !== 'draft') throw Object.assign(new Error('Only draft runs can be edited'), { status: 400 });
    const line = run.lines.id(oid(req.params.lineId));
    if (!line) throw Object.assign(new Error('Line not found'), { status: 404 });
    line.adjustments = (Array.isArray(req.body.adjustments) ? req.body.adjustments : [])
      .filter((a) => a && String(a.label || '').trim() && Number(a.amount) > 0)
      .map((a) => ({ label: String(a.label).trim(), type: a.type === 'deduction' ? 'deduction' : 'earning', amount: Number(a.amount) }));
    recomputeRun(run, ratesObj(await getRates()));
    addHistory(run, req, 'adjusted', line.name);
    await run.save();
    res.json({ success: true, data: run });
  } catch (e) { fail(res, e); }
});

// Refresh profile snapshots and rates (draft only)
router.post('/runs/:id/recalculate', only('hr', 'admin'), async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    if (run.status !== 'draft') throw Object.assign(new Error('Only draft runs can be recalculated'), { status: 400 });
    const profiles = await SalaryProfile.find({ employee: { $in: run.lines.map((l) => l.employee) } }).lean();
    const by = new Map(profiles.map((p) => [String(p.employee), p]));
    for (const l of run.lines) {
      const p = by.get(String(l.employee));
      if (!p) continue;
      l.profile = { baseSalary: p.baseSalary, allowances: p.allowances, fixedDeductions: p.fixedDeductions, exemptCnps: p.exemptCnps, exemptTax: p.exemptTax };
      l.paymentMethod = p.paymentMethod; l.bankName = p.bankName; l.bankAccount = p.bankAccount; l.cnpsNumber = p.cnpsNumber;
    }
    recomputeRun(run, ratesObj(await getRates()));
    addHistory(run, req, 'recalculated');
    await run.save();
    res.json({ success: true, data: run });
  } catch (e) { fail(res, e); }
});

router.delete('/runs/:id', only('hr', 'admin'), async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    if (!['draft', 'rejected'].includes(run.status)) throw Object.assign(new Error('Only draft or rejected runs can be deleted'), { status: 400 });
    await run.deleteOne();
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

router.post('/runs/:id/submit', only('hr', 'admin'), async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    if (!['draft', 'rejected'].includes(run.status)) throw Object.assign(new Error('Run already submitted'), { status: 400 });
    if (!run.lines.length) throw Object.assign(new Error('Run has no employees'), { status: 400 });
    run.status = 'pending_finance';
    run.rejectionReason = undefined;
    addHistory(run, req, 'submitted');
    await run.save();
    res.json({ success: true, data: run });
  } catch (e) { fail(res, e); }
});

router.post('/runs/:id/finance-approve', only('finance', 'admin'), async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    if (run.status !== 'pending_finance') throw Object.assign(new Error('Run is not awaiting finance approval'), { status: 400 });
    if (sameUser(run.preparedBy, uid(req))) throw Object.assign(new Error('You prepared this run, so someone else must approve it'), { status: 403 });
    run.status = 'pending_ceo';
    addHistory(run, req, 'finance_approved', req.body.comment);
    await run.save();
    res.json({ success: true, data: run });
  } catch (e) { fail(res, e); }
});

// CEO approval posts the accrual entry; if posting fails nothing is approved.
router.post('/runs/:id/ceo-approve', only('ceo', 'admin'), async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    if (run.status !== 'pending_ceo') throw Object.assign(new Error('Run is not awaiting CEO approval'), { status: 400 });
    if (sameUser(run.preparedBy, uid(req))) throw Object.assign(new Error('You prepared this run, so someone else must approve it'), { status: 403 });
    if (!run.accrualEntry) {
      let entry;
      try { entry = await postAccrual(run, uid(req)); } catch (e) {
        throw Object.assign(new Error(`Could not post to accounting: ${e.message}`), { status: 400 });
      }
      run.accrualEntry = entry._id;
    }
    run.status = 'approved';
    addHistory(run, req, 'ceo_approved', req.body.comment);
    await run.save();
    res.json({ success: true, data: run });
  } catch (e) { fail(res, e); }
});

router.post('/runs/:id/reject', only('finance', 'ceo', 'admin'), async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    if (!['pending_finance', 'pending_ceo'].includes(run.status)) throw Object.assign(new Error('Run is not awaiting approval'), { status: 400 });
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw Object.assign(new Error('A rejection reason is required'), { status: 400 });
    run.status = 'rejected';
    run.rejectionReason = reason;
    addHistory(run, req, 'rejected', reason);
    await run.save();
    res.json({ success: true, data: run });
  } catch (e) { fail(res, e); }
});

router.post('/runs/:id/pay', only('finance', 'admin'), async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    if (run.status !== 'approved') throw Object.assign(new Error('Only approved runs can be paid'), { status: 400 });
    const code = ['521', '571'].includes(String(req.body.accountCode)) ? String(req.body.accountCode) : '521';
    let entry;
    try { entry = await postPayment(run, code, uid(req)); } catch (e) {
      throw Object.assign(new Error(`Could not post payment: ${e.message}`), { status: 400 });
    }
    run.paymentEntry = entry._id;
    run.paymentAccountCode = code;
    run.paidAt = new Date();
    run.status = 'paid';
    addHistory(run, req, 'paid', `Account ${code}`);
    await run.save();
    res.json({ success: true, data: run });
  } catch (e) { fail(res, e); }
});

// ── PAYSLIPS ───────────────────────────────────────────────────────────────
router.get('/my-payslips', async (req, res) => {
  try {
    const runs = await PayrollRun.find({ status: { $in: ['approved', 'paid'] }, 'lines.employee': uid(req) })
      .select('runNumber period status lines').sort({ 'period.year': -1, 'period.month': -1 }).lean();
    const data = runs.map((r) => {
      const l = r.lines.find((x) => sameUser(x.employee, uid(req)));
      return { runId: r._id, lineId: l._id, runNumber: r.runNumber, period: r.period, status: r.status, gross: l.result?.gross, netPay: l.result?.netPay };
    });
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
});

router.get('/runs/:id/payslip/:lineId', async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    const line = run.lines.id(oid(req.params.lineId));
    if (!line) throw Object.assign(new Error('Payslip not found'), { status: 404 });
    const own = sameUser(line.employee, uid(req));
    const staff = isRole(req, ...STAFF);
    if (!own && !staff) throw Object.assign(new Error('Not allowed'), { status: 403 });
    if (own && !staff && !['approved', 'paid'].includes(run.status)) throw Object.assign(new Error('Payslip not yet available'), { status: 403 });

    const r = line.result || {};
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="payslip-${run.period.year}-${String(run.period.month).padStart(2, '0')}-${(line.name || 'employee').replace(/[^\w]+/g, '_')}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text('PAYSLIP', { align: 'right' });
    doc.fontSize(10).fillColor('#555').text(`${MONTHS[run.period.month - 1]} ${run.period.year}  |  ${run.runNumber}`, { align: 'right' });
    doc.moveDown().fillColor('#000').fontSize(11);
    doc.text(`Employee: ${line.name || ''}`);
    doc.text(`Position: ${line.position || '-'}    Department: ${line.department || '-'}`);
    doc.text(`CNPS no.: ${line.cnpsNumber || '-'}`);
    doc.moveDown();
    const row = (label, amount, bold) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(label, 40, y, { width: 340 });
      doc.text(`${fmt(amount)} XAF`, 380, y, { width: 175, align: 'right' });
    };
    const head = (t) => { doc.moveDown(0.5); doc.font('Helvetica-Bold').fontSize(11).fillColor('#1d4e89').text(t, 40); doc.fillColor('#000'); doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#cccccc'); doc.moveDown(0.3); };
    head('Earnings');
    row('Base salary', r.base);
    (r.allowances || []).forEach((a) => row(a.name, a.amount));
    (r.earnings || []).forEach((a) => row(a.label, a.amount));
    row('Gross salary', r.gross, true);
    head('Deductions');
    if (r.cnpsEmployee) row('CNPS pension (employee)', r.cnpsEmployee);
    if (r.irpp) row('IRPP (income tax)', r.irpp);
    if (r.cac) row('CAC (communal surtax)', r.cac);
    if (r.cfcEmployee) row('CFC (housing fund)', r.cfcEmployee);
    (r.recoveries || []).forEach((d) => row(d.name, d.amount));
    row('Total deductions', r.totalDeductions, true);
    doc.moveDown();
    doc.rect(40, doc.y, 515, 28).fill('#eaf2fb').fillColor('#000');
    const yy = doc.y + 8;
    doc.font('Helvetica-Bold').fontSize(12).text('NET PAY', 50, yy).text(`${fmt(r.netPay)} XAF`, 380, yy, { width: 165, align: 'right' });
    doc.y = yy + 30;
    if (line.paymentMethod) doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Payment: ${line.paymentMethod}${line.bankName ? ` - ${line.bankName}` : ''}${line.bankAccount ? ` ${line.bankAccount}` : ''}`, 40);
    doc.end();
  } catch (e) { if (!res.headersSent) fail(res, e); else res.end(); }
});

// Reporting: totals per department for one run
router.get('/runs/:id/by-department', needStaff, async (req, res) => {
  try {
    const run = await loadRun(req.params.id);
    const m = new Map();
    run.lines.forEach((l) => {
      const k = l.department || 'Unassigned';
      const t = m.get(k) || { department: k, employees: 0, gross: 0, net: 0, employerCost: 0 };
      t.employees += 1; t.gross += l.result?.gross || 0; t.net += l.result?.netPay || 0; t.employerCost += l.result?.employerCost || 0;
      m.set(k, t);
    });
    res.json({ success: true, data: [...m.values()].sort((a, b) => b.employerCost - a.employerCost) });
  } catch (e) { fail(res, e); }
});

module.exports = router;
