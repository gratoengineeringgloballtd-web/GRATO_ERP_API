/**
 * Sales & CRM: leads/pipeline, quotations, activities, dashboard.
 * Salespeople see only their own records; admin, CEO and finance see everything (finance read-only).
 */
const express = require('express');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const Lead = require('../models/Lead');
const SalesQuotation = require('../models/SalesQuotation');
const CrmActivity = require('../models/CrmActivity');
const Counter = require('../models/Counter');
const User = require('../models/User');

const { STAGES, DEFAULT_PROBABILITY } = Lead;
const router = express.Router();

router.use(authMiddleware);
router.use(requireRoles('sales', 'admin', 'ceo', 'finance'));

const WRITERS = ['sales', 'admin'];
const needWriter = (req, res, next) =>
  WRITERS.includes(req.user.role) ? next() : res.status(403).json({ success: false, message: 'You have read-only access to Sales' });
const seesAll = (req) => ['admin', 'ceo', 'finance'].includes(req.user.role);
const scope = (req) => (seesAll(req) ? {} : { owner: req.user.userId });
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const oid = (id) => { if (!mongoose.Types.ObjectId.isValid(id)) throw Object.assign(new Error('Invalid ID'), { status: 400 }); return id; };
const fail = (res, e) => res.status(e.status || (e.name === 'ValidationError' ? 400 : 500)).json({ success: false, message: e.message });
const rx = (q) => new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

async function nextNumber(prefix) {
  const key = `${prefix}-${new Date().getFullYear()}`;
  const c = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${key}-${String(c.seq).padStart(5, '0')}`;
}

async function loadLead(req, id) {
  const lead = await Lead.findOne({ _id: oid(id), ...scope(req) });
  if (!lead) throw Object.assign(new Error('Lead not found'), { status: 404 });
  return lead;
}
async function loadQuote(req, id) {
  const q = await SalesQuotation.findOne({ _id: oid(id), ...scope(req) });
  if (!q) throw Object.assign(new Error('Quotation not found'), { status: 404 });
  return q;
}

// ── LOOKUPS ────────────────────────────────────────────────────────────────
router.get('/customers-lookup', async (req, res) => {
  try {
    const Customer = require('../models/Customer');
    const f = { status: { $in: ['approved', 'active'] } };
    if (req.query.q) f.$or = [{ companyName: rx(req.query.q) }, { primaryEmail: rx(req.query.q) }];
    const rows = await Customer.find(f).select('companyName primaryEmail primaryPhone address').limit(20).lean();
    res.json({ success: true, data: rows.map((c) => ({ _id: c._id, companyName: c.companyName, email: c.primaryEmail, phone: c.primaryPhone, address: [c.address?.street, c.address?.city].filter(Boolean).join(', ') })) });
  } catch (e) { fail(res, e); }
});

router.get('/owners', async (req, res) => {
  try {
    const f = { role: { $in: ['sales', 'admin'] }, isActive: { $ne: false } };
    const rows = await User.find(seesAll(req) ? f : { _id: req.user.userId }).select('fullName email role').lean();
    res.json({ success: true, data: rows });
  } catch (e) { fail(res, e); }
});

// ── LEADS ──────────────────────────────────────────────────────────────────
router.get('/leads', async (req, res) => {
  try {
    const { stage, q, owner } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const f = { ...scope(req) };
    if (stage) f.stage = stage;
    if (owner && seesAll(req)) f.owner = owner;
    if (q) f.$or = [{ company: rx(q) }, { contactName: rx(q) }, { email: rx(q) }, { leadNumber: rx(q) }];
    const [rows, total] = await Promise.all([
      Lead.find(f).populate('owner', 'fullName').sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Lead.countDocuments(f)
    ]);
    res.json({ success: true, data: rows, total, page });
  } catch (e) { fail(res, e); }
});

router.post('/leads', needWriter, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.company) return res.status(400).json({ success: false, message: 'Company is required' });
    const stage = STAGES.includes(b.stage) ? b.stage : 'new';
    const owner = (req.user.role === 'admin' && b.owner) ? oid(b.owner) : req.user.userId;
    const lead = await Lead.create({
      leadNumber: await nextNumber('LD'), company: b.company, contactName: b.contactName, email: b.email, phone: b.phone,
      source: b.source, industry: b.industry, description: b.description, estimatedValue: Number(b.estimatedValue) || 0,
      stage, probability: DEFAULT_PROBABILITY[stage], expectedCloseDate: b.expectedCloseDate || null, nextFollowUp: b.nextFollowUp || null,
      customer: b.customer || null, owner, createdBy: req.user.userId, stageHistory: [{ stage, by: req.user.userId }]
    });
    res.status(201).json({ success: true, data: lead, message: `Lead ${lead.leadNumber} created` });
  } catch (e) { fail(res, e); }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const lead = await Lead.findOne({ _id: oid(req.params.id), ...scope(req) }).populate('owner', 'fullName').populate('customer', 'companyName').lean();
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    const [activities, quotations] = await Promise.all([
      CrmActivity.find({ lead: lead._id }).sort({ activityDate: -1 }).limit(100).lean(),
      SalesQuotation.find({ lead: lead._id }).sort({ createdAt: -1 }).select('quoteNumber subject total status validUntil').lean()
    ]);
    res.json({ success: true, data: { ...lead, activities, quotations } });
  } catch (e) { fail(res, e); }
});

router.put('/leads/:id', needWriter, async (req, res) => {
  try {
    const lead = await loadLead(req, req.params.id);
    const b = req.body || {};
    ['company', 'contactName', 'email', 'phone', 'source', 'industry', 'description', 'expectedCloseDate', 'nextFollowUp', 'customer'].forEach((k) => { if (k in b) lead[k] = b[k] || (k === 'customer' || k.includes('Date') || k === 'nextFollowUp' ? null : ''); });
    if ('estimatedValue' in b) lead.estimatedValue = Number(b.estimatedValue) || 0;
    if ('probability' in b && !['won', 'lost'].includes(lead.stage)) lead.probability = Math.min(100, Math.max(0, Number(b.probability) || 0));
    if (req.user.role === 'admin' && b.owner) lead.owner = oid(b.owner);
    await lead.save();
    res.json({ success: true, data: lead, message: 'Lead updated' });
  } catch (e) { fail(res, e); }
});

router.patch('/leads/:id/stage', needWriter, async (req, res) => {
  try {
    const { stage, lostReason } = req.body || {};
    if (!STAGES.includes(stage)) return res.status(400).json({ success: false, message: 'Invalid stage' });
    if (stage === 'lost' && !String(lostReason || '').trim()) return res.status(400).json({ success: false, message: 'Please give a reason for losing this lead' });
    const lead = await loadLead(req, req.params.id);
    if (lead.stage === stage) return res.json({ success: true, data: lead });
    lead.stage = stage;
    lead.probability = DEFAULT_PROBABILITY[stage];
    lead.stageHistory.push({ stage, by: req.user.userId });
    lead.lostReason = stage === 'lost' ? lostReason : '';
    lead.wonAt = stage === 'won' ? new Date() : null;
    lead.closedAt = ['won', 'lost'].includes(stage) ? new Date() : null;
    await lead.save();
    res.json({ success: true, data: lead, message: `Moved to ${stage}` });
  } catch (e) { fail(res, e); }
});

router.delete('/leads/:id', requireRoles('admin'), async (req, res) => {
  try {
    const lead = await Lead.findById(oid(req.params.id));
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (await SalesQuotation.exists({ lead: lead._id })) return res.status(400).json({ success: false, message: 'This lead has quotations; mark it lost instead of deleting' });
    await Lead.deleteOne({ _id: lead._id });
    await CrmActivity.deleteMany({ lead: lead._id });
    res.json({ success: true, message: 'Lead deleted' });
  } catch (e) { fail(res, e); }
});

// ── QUOTATIONS ─────────────────────────────────────────────────────────────
async function expireOld() {
  await SalesQuotation.updateMany({ status: 'sent', validUntil: { $lt: new Date() } }, { $set: { status: 'expired' } });
}

router.get('/quotations', async (req, res) => {
  try {
    await expireOld();
    const f = { ...scope(req) };
    if (req.query.status) f.status = req.query.status;
    if (req.query.lead) f.lead = oid(req.query.lead);
    if (req.query.q) f.$or = [{ quoteNumber: rx(req.query.q) }, { customerName: rx(req.query.q) }, { subject: rx(req.query.q) }];
    const rows = await SalesQuotation.find(f).populate('owner', 'fullName').sort({ createdAt: -1 }).limit(500).lean();
    res.json({ success: true, data: rows });
  } catch (e) { fail(res, e); }
});

const quoteFields = (b) => ({
  lead: b.lead || null, customer: b.customer || null, customerName: b.customerName, customerEmail: b.customerEmail,
  customerAddress: b.customerAddress, subject: b.subject, validUntil: b.validUntil, terms: b.terms, notes: b.notes,
  items: (b.items || []).map((i) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), taxRate: i.taxRate === undefined || i.taxRate === '' ? 19.25 : Number(i.taxRate) }))
});

router.post('/quotations', needWriter, async (req, res) => {
  try {
    const data = quoteFields(req.body || {});
    if (data.lead) {
      const lead = await loadLead(req, data.lead);
      data.customerName = data.customerName || lead.company;
      data.customerEmail = data.customerEmail || lead.email;
      data.customer = data.customer || lead.customer;
    }
    const q = await SalesQuotation.create({ ...data, quoteNumber: await nextNumber('SQ'), owner: req.user.userId, createdBy: req.user.userId });
    if (data.lead) {
      const lead = await Lead.findById(data.lead);
      if (lead && ['new', 'qualified'].includes(lead.stage)) {
        lead.stage = 'proposal'; lead.probability = DEFAULT_PROBABILITY.proposal; lead.stageHistory.push({ stage: 'proposal', by: req.user.userId });
        await lead.save();
      }
    }
    res.status(201).json({ success: true, data: q, message: `Quotation ${q.quoteNumber} created` });
  } catch (e) { fail(res, e); }
});

router.get('/quotations/:id', async (req, res) => {
  try { res.json({ success: true, data: await loadQuote(req, req.params.id) }); } catch (e) { fail(res, e); }
});

router.put('/quotations/:id', needWriter, async (req, res) => {
  try {
    const q = await loadQuote(req, req.params.id);
    if (!['draft', 'sent'].includes(q.status)) return res.status(400).json({ success: false, message: `A ${q.status} quotation can no longer be edited` });
    const data = quoteFields(req.body || {});
    ['customerName', 'customerEmail', 'customerAddress', 'subject', 'validUntil', 'terms', 'notes', 'customer'].forEach((k) => { if (data[k] !== undefined) q[k] = data[k]; });
    if (data.items.length) q.items = data.items;
    await q.save();
    res.json({ success: true, data: q, message: 'Quotation updated' });
  } catch (e) { fail(res, e); }
});

function buildPdf(q, ownerName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const money = (v) => `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${q.currency}`;
    doc.fontSize(18).text(process.env.COMPANY_NAME || 'GRATO ENGINEERING GLOBAL', { align: 'left' });
    doc.moveDown(0.3).fontSize(10).fillColor('#666').text('QUOTATION').fillColor('#000');
    doc.moveDown().fontSize(10);
    doc.text(`Quotation No: ${q.quoteNumber}`); doc.text(`Date: ${new Date(q.createdAt || Date.now()).toDateString()}`);
    doc.text(`Valid until: ${new Date(q.validUntil).toDateString()}`); doc.text(`Prepared by: ${ownerName || ''}`);
    doc.moveDown().fontSize(11).text('To:', { continued: false }).fontSize(10);
    doc.text(q.customerName); if (q.customerAddress) doc.text(q.customerAddress); if (q.customerEmail) doc.text(q.customerEmail);
    doc.moveDown().fontSize(12).text(q.subject).moveDown(0.5).fontSize(9);
    const x = [50, 270, 320, 400, 470];
    const row = (y, cells, bold) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica'); cells.forEach((c, i) => doc.text(String(c), x[i], y, { width: (x[i + 1] || 545) - x[i] - 6, align: i ? 'right' : 'left' })); };
    let y = doc.y; row(y, ['Description', 'Qty', 'Unit price', 'VAT %', 'Amount'], true); y += 16; doc.moveTo(50, y - 2).lineTo(545, y - 2).stroke();
    q.items.forEach((i) => {
      if (y > 720) { doc.addPage(); y = 50; }
      const h = doc.heightOfString(i.description, { width: 210 });
      row(y, [i.description, i.quantity, money(i.unitPrice), i.taxRate, money(i.quantity * i.unitPrice)], false);
      y += Math.max(16, h + 4);
    });
    y += 8; doc.moveTo(320, y).lineTo(545, y).stroke(); y += 6;
    [['Subtotal', q.subtotal], ['VAT', q.taxAmount], ['TOTAL', q.total]].forEach(([l, v], idx) => {
      doc.font(idx === 2 ? 'Helvetica-Bold' : 'Helvetica').text(l, 320, y, { width: 80 }).text(money(v), 400, y, { width: 145, align: 'right' }); y += 16;
    });
    doc.font('Helvetica').fontSize(9).text(`Terms: ${q.terms}`, 50, y + 20, { width: 495 });
    if (q.notes) doc.moveDown().text(`Notes: ${q.notes}`, { width: 495 });
    doc.end();
  });
}

router.get('/quotations/:id/pdf', async (req, res) => {
  try {
    const q = await loadQuote(req, req.params.id);
    const owner = await User.findById(q.owner).select('fullName').lean();
    const buf = await buildPdf(q.toObject(), owner?.fullName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${q.quoteNumber}.pdf"`);
    res.send(buf);
  } catch (e) { fail(res, e); }
});

router.post('/quotations/:id/send', needWriter, async (req, res) => {
  try {
    const q = await loadQuote(req, req.params.id);
    if (!['draft', 'sent', 'expired'].includes(q.status)) return res.status(400).json({ success: false, message: `Cannot send a ${q.status} quotation` });
    if (!q.customerEmail) return res.status(400).json({ success: false, message: 'Add the customer email before sending' });
    if (new Date(q.validUntil) < new Date()) return res.status(400).json({ success: false, message: 'The validity date has passed; extend it first' });
    const owner = await User.findById(q.owner).select('fullName email').lean();
    const pdf = await buildPdf(q.toObject(), owner?.fullName);
    const { sendEmail } = require('../services/emailService');
    await sendEmail({
      to: q.customerEmail, cc: owner?.email,
      subject: `Quotation ${q.quoteNumber}: ${q.subject}`,
      text: `Dear ${q.customerName},\n\nPlease find attached our quotation ${q.quoteNumber} for "${q.subject}", valid until ${new Date(q.validUntil).toDateString()}.\n\nTotal: ${q.total.toLocaleString()} ${q.currency}\n\nKind regards,\n${owner?.fullName || ''}`,
      attachments: [{ filename: `${q.quoteNumber}.pdf`, content: pdf }]
    });
    q.status = 'sent'; q.sentAt = new Date();
    await q.save();
    res.json({ success: true, data: q, message: `Quotation sent to ${q.customerEmail}` });
  } catch (e) { fail(res, e); }
});

async function decide(req, res, status) {
  try {
    const q = await loadQuote(req, req.params.id);
    if (!['draft', 'sent'].includes(q.status)) return res.status(400).json({ success: false, message: `Quotation is already ${q.status}` });
    q.status = status; q.decidedAt = new Date();
    if (status === 'rejected') q.rejectionReason = (req.body && req.body.reason) || '';
    await q.save();
    if (q.lead) {
      const lead = await Lead.findById(q.lead);
      if (lead && !['won', 'lost'].includes(lead.stage)) {
        if (status === 'accepted') { lead.stage = 'won'; lead.probability = 100; lead.wonAt = new Date(); lead.closedAt = new Date(); lead.estimatedValue = q.total; lead.stageHistory.push({ stage: 'won', by: req.user.userId }); await lead.save(); }
      }
    }
    res.json({ success: true, data: q, message: `Quotation ${status}` });
  } catch (e) { fail(res, e); }
}
router.post('/quotations/:id/accept', needWriter, (req, res) => decide(req, res, 'accepted'));
router.post('/quotations/:id/reject', needWriter, (req, res) => decide(req, res, 'rejected'));

router.post('/quotations/:id/invoiced', needWriter, async (req, res) => {
  try {
    const q = await loadQuote(req, req.params.id);
    if (q.status !== 'accepted') return res.status(400).json({ success: false, message: 'Only accepted quotations can be marked as invoiced' });
    if (!String(req.body?.invoiceReference || '').trim()) return res.status(400).json({ success: false, message: 'Enter the invoice number' });
    q.status = 'invoiced'; q.invoiceReference = String(req.body.invoiceReference).trim();
    await q.save();
    res.json({ success: true, data: q, message: 'Marked as invoiced' });
  } catch (e) { fail(res, e); }
});

// ── ACTIVITIES ─────────────────────────────────────────────────────────────
router.get('/activities', async (req, res) => {
  try {
    const f = { ...scope(req) };
    if (req.query.lead) f.lead = oid(req.query.lead);
    if (req.query.customer) f.customer = oid(req.query.customer);
    if (req.query.open === 'true') f.done = false;
    const rows = await CrmActivity.find(f).populate('lead', 'company leadNumber').sort({ done: 1, dueDate: 1, activityDate: -1 }).limit(300).lean();
    res.json({ success: true, data: rows });
  } catch (e) { fail(res, e); }
});

router.post('/activities', needWriter, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.subject) return res.status(400).json({ success: false, message: 'Subject is required' });
    if (!b.lead && !b.customer) return res.status(400).json({ success: false, message: 'Link the activity to a lead or customer' });
    if (b.lead) await loadLead(req, b.lead);
    const a = await CrmActivity.create({
      type: b.type, subject: b.subject, notes: b.notes, activityDate: b.activityDate || new Date(), dueDate: b.dueDate || null,
      lead: b.lead || null, customer: b.customer || null, owner: req.user.userId, done: b.type !== 'task' && !b.dueDate
    });
    if (b.dueDate && b.lead) await Lead.updateOne({ _id: b.lead, $or: [{ nextFollowUp: null }, { nextFollowUp: { $gt: new Date(b.dueDate) } }] }, { $set: { nextFollowUp: new Date(b.dueDate) } });
    res.status(201).json({ success: true, data: a });
  } catch (e) { fail(res, e); }
});

router.patch('/activities/:id/done', needWriter, async (req, res) => {
  try {
    const a = await CrmActivity.findOne({ _id: oid(req.params.id), ...scope(req) });
    if (!a) return res.status(404).json({ success: false, message: 'Activity not found' });
    a.done = req.body?.done !== false; a.doneAt = a.done ? new Date() : null;
    await a.save();
    res.json({ success: true, data: a });
  } catch (e) { fail(res, e); }
});

router.delete('/activities/:id', needWriter, async (req, res) => {
  try {
    const r = await CrmActivity.deleteOne({ _id: oid(req.params.id), ...scope(req) });
    res.json({ success: r.deletedCount > 0, message: r.deletedCount ? 'Deleted' : 'Not found' });
  } catch (e) { fail(res, e); }
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    await expireOld();
    const sc = scope(req);
    const ownerMatch = sc.owner ? { owner: new mongoose.Types.ObjectId(sc.owner) } : {};
    const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    const [byStage, wonLost, byOwner, quotes, monthly, followUps, overdue] = await Promise.all([
      Lead.aggregate([{ $match: ownerMatch }, { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$estimatedValue' }, weighted: { $sum: { $multiply: ['$estimatedValue', { $divide: ['$probability', 100] }] } } } }]),
      Lead.aggregate([{ $match: { ...ownerMatch, stage: { $in: ['won', 'lost'] }, closedAt: { $gte: yearAgo } } }, { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$estimatedValue' } } }]),
      Lead.aggregate([{ $match: { ...ownerMatch, stage: 'won', closedAt: { $gte: yearAgo } } }, { $group: { _id: '$owner', won: { $sum: 1 }, value: { $sum: '$estimatedValue' } } }, { $sort: { value: -1 } }, { $limit: 10 }]),
      SalesQuotation.aggregate([{ $match: ownerMatch }, { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } }]),
      Lead.aggregate([{ $match: { ...ownerMatch, stage: 'won', closedAt: { $gte: yearAgo } } }, { $group: { _id: { y: { $year: '$closedAt' }, m: { $month: '$closedAt' } }, value: { $sum: '$estimatedValue' }, count: { $sum: 1 } } }, { $sort: { '_id.y': 1, '_id.m': 1 } }]),
      Lead.find({ ...sc, stage: { $nin: ['won', 'lost'] }, nextFollowUp: { $ne: null } }).sort({ nextFollowUp: 1 }).limit(8).select('company leadNumber nextFollowUp stage estimatedValue').lean(),
      CrmActivity.countDocuments({ ...sc, done: false, dueDate: { $lt: new Date() } })
    ]);

    const names = await User.find({ _id: { $in: byOwner.map((o) => o._id) } }).select('fullName').lean();
    const nameOf = Object.fromEntries(names.map((n) => [String(n._id), n.fullName]));
    const stageMap = Object.fromEntries(byStage.map((s) => [s._id, s]));
    const pipeline = STAGES.map((s) => ({ stage: s, count: stageMap[s]?.count || 0, value: r2(stageMap[s]?.value), weighted: r2(stageMap[s]?.weighted) }));
    const open = pipeline.filter((p) => !['won', 'lost'].includes(p.stage));
    const won = wonLost.find((x) => x._id === 'won') || { count: 0, value: 0 };
    const lost = wonLost.find((x) => x._id === 'lost') || { count: 0 };

    res.json({
      success: true,
      data: {
        pipeline,
        openCount: open.reduce((s, p) => s + p.count, 0),
        openValue: r2(open.reduce((s, p) => s + p.value, 0)),
        weightedValue: r2(open.reduce((s, p) => s + p.weighted, 0)),
        wonLast12Months: { count: won.count, value: r2(won.value) },
        winRate: won.count + lost.count ? Math.round(won.count / (won.count + lost.count) * 1000) / 10 : null,
        byOwner: byOwner.map((o) => ({ owner: nameOf[String(o._id)] || 'Unknown', won: o.won, value: r2(o.value) })),
        quotes: quotes.map((q) => ({ status: q._id, count: q.count, value: r2(q.value) })),
        monthlyWon: monthly.map((m) => ({ month: `${m._id.y}-${String(m._id.m).padStart(2, '0')}`, value: r2(m.value), count: m.count })),
        upcomingFollowUps: followUps,
        overdueActivities: overdue
      }
    });
  } catch (e) { fail(res, e); }
});

module.exports = router;
