/**
 * Document hub: unified search, document register (general / linked / employee files), expiry,
 * templates and generation, retention, and a document dashboard. Sits beside the existing
 * SharePoint folders, e-signature, policies and compliance modules and searches across them.
 */
const express = require('express');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const { upload } = require('../middlewares/uploadMiddleware');
const Document = require('../models/Document');
const DocumentTemplate = require('../models/DocumentTemplate');
const RetentionRule = require('../models/RetentionRule');
const User = require('../models/User');
const hub = require('../services/documentHubService');

const router = express.Router();
router.use(authMiddleware);

const HR = ['hr', 'admin'];
const oid = (id) => { if (!mongoose.Types.ObjectId.isValid(id)) throw bad('Invalid ID'); return id; };
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const fail = (res, e) => res.status(e.status || (e.name === 'ValidationError' ? 400 : 500)).json({ success: false, message: e.message });
const uid = (req) => String(req.user.userId || req.user._id || req.user.id);
const same = (a, b) => String(a) === String(b);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const csv = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { fail(res, e); } };

async function me(req) {
  if (!req._me) req._me = await User.findById(uid(req)).select('fullName email department role').lean();
  if (!req._me) throw bad('User not found', 404);
  return req._me;
}

// ── ACCESS ─────────────────────────────────────────────────────────────────
function canSee(doc, user, role) {
  if (['admin', 'ceo'].includes(role)) return true;
  if (doc.scope === 'employee') {
    if (role === 'hr') return true;
    return same(doc.employee, user._id) && doc.employeeCanView === true;
  }
  if (same(doc.uploadedBy, user._id)) return true;
  if ((doc.sharedWith || []).some((s) => same(s, user._id))) return true;
  if (doc.visibility === 'company') return true;
  if (doc.visibility === 'department') return !!doc.department && doc.department === user.department;
  return false;
}
const canEdit = (doc, user, role) => role === 'admin' || same(doc.uploadedBy, user._id) || (doc.scope === 'employee' && role === 'hr');

async function loadDoc(req, id, { edit = false } = {}) {
  const d = await Document.findById(oid(id));
  if (!d) throw bad('Document not found', 404);
  const u = await me(req);
  if (!canSee(d, u, req.user.role)) throw bad('Not allowed', 403);
  if (edit && !canEdit(d, u, req.user.role)) throw bad('You cannot change this document', 403);
  return d;
}

async function storeFile(file, subfolder) {
  const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');
  const s = await saveFile(file, STORAGE_CATEGORIES.HR_DOCUMENTS, subfolder, null);
  return { name: file.originalname, url: s.url, publicId: s.publicId, size: s.bytes, mimetype: file.mimetype };
}

// ── SEARCH ─────────────────────────────────────────────────────────────────
router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) throw bad('Type at least 2 characters');
  const rx = new RegExp(esc(q), 'i');
  const u = await me(req);
  const role = req.user.role;
  const out = [];

  // Register
  const docs = await Document.find({ $or: [{ title: rx }, { reference: rx }, { description: rx }, { tags: rx }, { 'linkedTo.label': rx }] }).limit(60).lean();
  docs.filter((d) => canSee(d, u, role)).slice(0, 20).forEach((d) => out.push({
    source: 'Document', id: d._id, title: d.title, subtitle: `${d.category}${d.linkedTo?.label ? ` / ${d.linkedTo.label}` : ''}${d.scope === 'employee' ? ' / employee file' : ''}`,
    date: d.updatedAt, url: d.file?.url
  }));

  // SharePoint files, honouring folder access
  try {
    const { SharePointFile, SharePointFolder } = require('../models/SharePoint');
    const { canUserAccessFolder } = require('../utils/sharepointAccessHelpers');
    const files = await SharePointFile.find({ $or: [{ name: rx }, { description: rx }, { tags: rx }] }).limit(80).lean();
    if (files.length) {
      const folders = await SharePointFolder.find({ _id: { $in: [...new Set(files.map((f) => String(f.folderId)))] } }).lean();
      const fm = new Map(folders.map((f) => [String(f._id), f]));
      files.filter((f) => { const fo = fm.get(String(f.folderId)); return fo && canUserAccessFolder(fo, u).canAccess; })
        .slice(0, 20).forEach((f) => out.push({ source: 'Folders', id: f._id, title: f.name, subtitle: `Folder: ${fm.get(String(f.folderId)).name}`, date: f.uploadedAt, route: '/sharepoint' }));
    }
  } catch (e) { /* source unavailable */ }

  // Compliance and contracts for the roles that already work with them
  if (hub.COMPLIANCE_READERS.includes(role)) {
    try {
      const CD = require('../models/ComplianceDocument');
      (await CD.find({ $or: [{ name: rx }, { referenceNumber: rx }, { description: rx }] }).limit(10).lean())
        .forEach((c) => out.push({ source: 'Compliance', id: c._id, title: c.name, subtitle: `${c.module} / ${c.documentType}`, date: c.updatedAt, url: c.file?.url, route: '/legal' }));
    } catch (e) { /* ignore */ }
    try {
      const Contract = require('../models/Contract');
      (await Contract.find({ $or: [{ title: rx }, { contractNumber: rx }] }).select('title contractNumber updatedAt').limit(10).lean())
        .forEach((c) => out.push({ source: 'Contract', id: c._id, title: c.title, subtitle: c.contractNumber || 'Contract', date: c.updatedAt, route: '/legal' }));
    } catch (e) { /* ignore */ }
  }

  // Documents for signature: only initiator, signers, admin or CEO
  try {
    const SD = require('../models/SignableDocument');
    const f = { title: rx };
    if (!['admin', 'ceo'].includes(role)) f.$or = [{ initiator: u._id }, { 'signers.user': u._id }];
    (await SD.find(f).select('title status updatedAt').limit(10).lean())
      .forEach((s) => out.push({ source: 'Signatures', id: s._id, title: s.title, subtitle: s.status.replace(/_/g, ' '), date: s.updatedAt }));
  } catch (e) { /* ignore */ }

  // Policies (active ones are for everyone)
  try {
    const Policy = require('../models/Policy');
    (await Policy.find({ status: 'active', $or: [{ title: rx }, { policyRef: rx }, { description: rx }] }).select('title policyRef updatedAt').limit(10).lean())
      .forEach((p) => out.push({ source: 'Policy', id: p._id, title: p.title, subtitle: p.policyRef || 'Policy', date: p.updatedAt }));
  } catch (e) { /* ignore */ }

  res.json({ success: true, data: out, total: out.length });
}));

// ── EXPIRING ───────────────────────────────────────────────────────────────
router.get('/expiring', wrap(async (req, res) => {
  const u = await me(req);
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 730);
  const data = await hub.expiringItems({ days, user: { role: req.user.role }, canSeeDoc: (d) => canSee(d, u, req.user.role) });
  res.json({ success: true, data });
}));

router.post('/run-reminders', requireRoles('admin'), wrap(async (req, res) => {
  res.json({ success: true, data: await hub.runReminders() });
}));

// ── REGISTER ───────────────────────────────────────────────────────────────
router.get('/library', wrap(async (req, res) => {
  const u = await me(req);
  const f = {};
  if (req.query.scope) f.scope = req.query.scope;
  if (req.query.category) f.category = req.query.category;
  if (req.query.status) f.retentionStatus = req.query.status; else f.retentionStatus = { $ne: 'archived' };
  if (req.query.linkedModel) f['linkedTo.model'] = req.query.linkedModel;
  if (req.query.linkedId) f['linkedTo.id'] = oid(req.query.linkedId);
  if (req.query.employee) f.employee = oid(req.query.employee);
  if (req.query.q) { const rx = new RegExp(esc(req.query.q), 'i'); f.$or = [{ title: rx }, { reference: rx }, { description: rx }, { tags: rx }, { 'linkedTo.label': rx }]; }
  const rows = await Document.find(f).sort({ createdAt: -1 }).limit(500).populate('uploadedBy', 'fullName').populate('employee', 'fullName').lean();
  res.json({ success: true, data: rows.filter((d) => canSee(d, u, req.user.role)).map((d) => ({ ...d, canEdit: canEdit(d, u, req.user.role) })) });
}));

router.get('/library/:id', wrap(async (req, res) => {
  const d = await loadDoc(req, req.params.id);
  const u = await me(req);
  const full = await Document.findById(d._id).populate('uploadedBy', 'fullName').populate('employee', 'fullName').populate('notifyUsers', 'fullName').lean();
  res.json({ success: true, data: { ...full, canEdit: canEdit(d, u, req.user.role) } });
}));

function applyMeta(d, b, u, role, isNew) {
  if (b.title !== undefined) d.title = String(b.title).trim();
  if (b.description !== undefined) d.description = b.description;
  if (b.category !== undefined) { if (!Document.CATEGORIES.includes(b.category)) throw bad('Unknown category'); d.category = b.category; }
  if (b.reference !== undefined) d.reference = b.reference;
  if (b.tags !== undefined) d.tags = csv(b.tags);
  if (b.documentDate !== undefined) d.documentDate = b.documentDate || undefined;
  if (b.expiryDate !== undefined) { d.expiryDate = b.expiryDate || undefined; d.remindersSent = []; }
  if (b.reminderDays !== undefined) d.reminderDays = csv(b.reminderDays).map(Number).filter((n) => n >= 0);
  if (b.notifyUsers !== undefined) d.notifyUsers = csv(b.notifyUsers).map(oid);
  if (b.sharedWith !== undefined) d.sharedWith = csv(b.sharedWith).map(oid);
  if (b.visibility !== undefined && d.scope !== 'employee') {
    if (!['company', 'department', 'private'].includes(b.visibility)) throw bad('Unknown visibility');
    d.visibility = b.visibility;
  }
  if (b.employeeCanView !== undefined && d.scope === 'employee') d.employeeCanView = b.employeeCanView === true || b.employeeCanView === 'true';
  if (isNew) {
    d.scope = ['general', 'linked', 'employee'].includes(b.scope) ? b.scope : 'general';
    if (d.scope === 'employee') {
      if (!HR.includes(role)) throw bad('Only HR can add to employee files', 403);
      d.employee = oid(b.employee); d.visibility = 'private';
    }
    if (d.scope === 'linked') {
      if (!b.linkedModel || !String(b.linkedLabel || '').trim()) throw bad('Choose the record this document belongs to');
      d.linkedTo = { model: b.linkedModel, id: b.linkedId ? oid(b.linkedId) : undefined, label: String(b.linkedLabel).trim() };
    }
    d.department = u.department;
  }
}
async function applyRetention(d, b) {
  const rule = await hub.retentionYearsFor(d.category);
  const years = b.retentionYears !== undefined && b.retentionYears !== '' ? Number(b.retentionYears) : rule;
  d.retentionYears = years == null ? undefined : years;
  d.retainUntil = hub.retainUntil(d.documentDate || d.createdAt || new Date(), years);
}

router.post('/library', upload.single('file'), wrap(async (req, res) => {
  const u = await me(req);
  if (!req.file) throw bad('Attach a file');
  if (!String(req.body.title || '').trim()) throw bad('A title is required');
  await hub.ensureRetentionRules();
  const d = new Document({ title: req.body.title, uploadedBy: u._id });
  applyMeta(d, req.body, u, req.user.role, true);
  const stored = await storeFile(req.file, d.scope === 'employee' ? 'employee-files' : 'documents');
  d.file = { ...stored, uploadedBy: u._id };
  await applyRetention(d, req.body);
  await d.save();
  res.status(201).json({ success: true, data: d });
}));

router.put('/library/:id', wrap(async (req, res) => {
  const d = await loadDoc(req, req.params.id, { edit: true });
  const u = await me(req);
  const catBefore = d.category;
  applyMeta(d, req.body, u, req.user.role, false);
  if (d.category !== catBefore || req.body.retentionYears !== undefined || req.body.documentDate !== undefined) await applyRetention(d, req.body);
  await d.save();
  res.json({ success: true, data: d });
}));

router.post('/library/:id/version', upload.single('file'), wrap(async (req, res) => {
  const d = await loadDoc(req, req.params.id, { edit: true });
  const u = await me(req);
  if (!req.file) throw bad('Attach a file');
  if (d.file) d.versions.push(d.file);
  d.file = { ...(await storeFile(req.file, d.scope === 'employee' ? 'employee-files' : 'documents')), uploadedBy: u._id };
  await d.save();
  res.json({ success: true, data: d });
}));

router.delete('/library/:id', requireRoles('admin'), wrap(async (req, res) => {
  const d = await Document.findById(oid(req.params.id));
  if (!d) throw bad('Document not found', 404);
  if (d.retentionStatus === 'active' && d.retainUntil && d.retainUntil > new Date()) {
    throw bad(`This document must be kept until ${d.retainUntil.toDateString()}. Archive it instead.`);
  }
  await d.deleteOne();
  res.json({ success: true });
}));

// Employee files
router.get('/employee-file/:employeeId', requireRoles('hr', 'admin', 'ceo'), wrap(async (req, res) => {
  const rows = await Document.find({ scope: 'employee', employee: oid(req.params.employeeId), retentionStatus: { $ne: 'archived' } }).sort({ createdAt: -1 }).populate('uploadedBy', 'fullName').lean();
  const u = await me(req);
  res.json({ success: true, data: rows.map((d) => ({ ...d, canEdit: canEdit(d, u, req.user.role) })) });
}));
router.get('/my-file', wrap(async (req, res) => {
  const rows = await Document.find({ scope: 'employee', employee: uid(req), employeeCanView: true, retentionStatus: { $ne: 'archived' } }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: rows });
}));
router.get('/employees-lookup', requireRoles('hr', 'admin', 'ceo'), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const f = { isActive: { $ne: false }, role: { $ne: 'supplier' } };
  if (q) f.$or = [{ fullName: new RegExp(esc(q), 'i') }, { email: new RegExp(esc(q), 'i') }];
  res.json({ success: true, data: await User.find(f).select('fullName email department position').sort({ fullName: 1 }).limit(30).lean() });
}));

// Link targets for "attach to a record"
const TARGETS = {
  Supplier: { path: '../models/Supplier', fields: ['companyName', 'name'] },
  Customer: { path: '../models/Customer', fields: ['companyName'] },
  Project: { path: '../models/Project', fields: ['name', 'title'] },
  Contract: { path: '../models/Contract', fields: ['title', 'contractNumber'] },
  Employee: { path: '../models/User', fields: ['fullName', 'email'] }
};
router.get('/link-targets', wrap(async (req, res) => {
  const t = TARGETS[req.query.model];
  if (!t) return res.json({ success: true, data: [], models: [...Object.keys(TARGETS), 'Other'] });
  const Model = require(t.path);
  const rx = new RegExp(esc(req.query.q || ''), 'i');
  const rows = await Model.find({ $or: t.fields.map((f) => ({ [f]: rx })) }).select(t.fields.join(' ')).limit(20).lean();
  res.json({ success: true, data: rows.map((r) => ({ id: r._id, label: t.fields.map((f) => r[f]).find(Boolean) || String(r._id) })) });
}));
router.get('/link-models', (req, res) => res.json({ success: true, data: [...Object.keys(TARGETS), 'Other'] }));

// ── RETENTION ──────────────────────────────────────────────────────────────
router.get('/retention/rules', requireRoles('admin', 'hr', 'finance', 'ceo'), wrap(async (req, res) => {
  await hub.ensureRetentionRules();
  res.json({ success: true, data: await RetentionRule.find({}).sort({ category: 1 }).lean() });
}));
router.put('/retention/rules/:category', requireRoles('admin'), wrap(async (req, res) => {
  const years = Number(req.body.years);
  if (!(years >= 0)) throw bad('Years must be zero or more');
  const r = await RetentionRule.findOneAndUpdate({ category: req.params.category }, { $set: { years, note: req.body.note, updatedBy: uid(req) } }, { upsert: true, new: true });
  res.json({ success: true, data: r });
}));
router.get('/retention/due', requireRoles('admin', 'hr'), wrap(async (req, res) => {
  await hub.flagRetention();
  const rows = await Document.find({ retentionStatus: 'due' }).sort({ retainUntil: 1 }).limit(500).populate('uploadedBy', 'fullName').lean();
  res.json({ success: true, data: req.user.role === 'admin' ? rows : rows.filter((d) => d.scope === 'employee') });
}));
router.post('/retention/:id/:action', requireRoles('admin', 'hr'), wrap(async (req, res) => {
  const d = await Document.findById(oid(req.params.id));
  if (!d) throw bad('Document not found', 404);
  if (req.user.role === 'hr' && d.scope !== 'employee') throw bad('Not allowed', 403);
  const a = req.params.action;
  if (a === 'extend') {
    const y = Number(req.body.years);
    if (!(y > 0)) throw bad('Enter the number of extra years');
    d.retainUntil = new Date(new Date(d.retainUntil || Date.now()).setFullYear(new Date(d.retainUntil || Date.now()).getFullYear() + y));
    d.retentionStatus = 'active';
  } else if (a === 'archive') {
    d.retentionStatus = 'archived'; d.archivedAt = new Date(); d.archivedBy = uid(req);
  } else throw bad('Unknown action');
  await d.save();
  res.json({ success: true, data: d });
}));
router.post('/library/:id/archive', wrap(async (req, res) => {
  const d = await loadDoc(req, req.params.id, { edit: true });
  d.retentionStatus = 'archived'; d.archivedAt = new Date(); d.archivedBy = uid(req);
  await d.save();
  res.json({ success: true, data: d });
}));

// ── TEMPLATES ──────────────────────────────────────────────────────────────
const TPL_ROLES = ['hr', 'admin', 'ceo', 'finance'];
router.get('/templates', requireRoles(...TPL_ROLES), wrap(async (req, res) => {
  res.json({ success: true, data: await DocumentTemplate.find(req.query.all ? {} : { active: true }).sort({ name: 1 }).lean() });
}));
router.post('/templates', requireRoles('hr', 'admin'), wrap(async (req, res) => {
  const { name, body } = req.body;
  if (!String(name || '').trim() || !String(body || '').trim()) throw bad('Name and body are required');
  const t = await DocumentTemplate.create({
    name: String(name).trim(), category: req.body.category || 'letter', description: req.body.description, subject: req.body.subject, body,
    placeholders: DocumentTemplate.extract(`${req.body.subject || ''} ${body}`), createdBy: uid(req)
  });
  res.status(201).json({ success: true, data: t });
}));
router.put('/templates/:id', requireRoles('hr', 'admin'), wrap(async (req, res) => {
  const t = await DocumentTemplate.findById(oid(req.params.id));
  if (!t) throw bad('Template not found', 404);
  ['name', 'category', 'description', 'subject', 'body', 'active'].forEach((k) => { if (req.body[k] !== undefined) t[k] = req.body[k]; });
  t.placeholders = DocumentTemplate.extract(`${t.subject || ''} ${t.body}`);
  t.updatedBy = uid(req);
  await t.save();
  res.json({ success: true, data: t });
}));
router.delete('/templates/:id', requireRoles('hr', 'admin'), wrap(async (req, res) => {
  await DocumentTemplate.deleteOne({ _id: oid(req.params.id) });
  res.json({ success: true });
}));

// Values that can be filled automatically from a person or candidate
async function contextValues(ctx) {
  const v = { company_name: process.env.COMPANY_NAME || 'GRATO', today: new Date().toDateString() };
  if (!ctx || !ctx.id) return v;
  if (ctx.type === 'employee') {
    const e = await User.findById(oid(ctx.id)).select('fullName email department position').lean();
    if (e) Object.assign(v, { employee_name: e.fullName, employee_email: e.email, department: e.department, position: e.position });
  } else if (ctx.type === 'candidate') {
    const Candidate = require('../models/Candidate');
    const c = await Candidate.findById(oid(ctx.id)).populate('opening', 'title department').lean();
    if (c) Object.assign(v, {
      candidate_name: c.name, candidate_email: c.email, position: c.offer?.position || c.opening?.title, department: c.opening?.department,
      salary: c.offer?.salary ? Number(c.offer.salary).toLocaleString() + ' XAF' : '', start_date: c.offer?.startDate ? new Date(c.offer.startDate).toDateString() : ''
    });
  }
  return v;
}
async function renderTemplate(t, body) {
  const values = { ...(await contextValues(body.context)), ...(body.values || {}) };
  return { title: DocumentTemplate.render(t.subject || t.name, values), text: DocumentTemplate.render(t.body, values), values };
}
function toPdf(title, text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(14).text(title, { align: 'left' }).moveDown();
    doc.font('Helvetica').fontSize(11).text(text, { align: 'left', lineGap: 3 });
    doc.end();
  });
}

router.post('/templates/:id/preview', requireRoles(...TPL_ROLES), wrap(async (req, res) => {
  const t = await DocumentTemplate.findById(oid(req.params.id));
  if (!t) throw bad('Template not found', 404);
  const r = await renderTemplate(t, req.body);
  res.json({ success: true, data: { title: r.title, text: r.text, values: r.values, placeholders: t.placeholders } });
}));

router.post('/templates/:id/generate', requireRoles('hr', 'admin'), wrap(async (req, res) => {
  const t = await DocumentTemplate.findById(oid(req.params.id));
  if (!t) throw bad('Template not found', 404);
  const u = await me(req);
  const r = await renderTemplate(t, req.body);
  if (/\[[a-zA-Z0-9_]+\]/.test(r.text) && !req.body.allowBlanks) throw bad('Some fields are still empty. Fill them in or confirm you want to keep the blanks.');
  await hub.ensureRetentionRules();
  const buf = await toPdf(r.title, r.text);
  const fname = `${r.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'document'}.pdf`;
  const stored = await storeFile({ originalname: fname, mimetype: 'application/pdf', buffer: buf, size: buf.length }, 'generated');

  const d = new Document({ title: r.title, category: Document.CATEGORIES.includes(t.category) ? t.category : 'letter', uploadedBy: u._id, department: u.department, generatedFromTemplate: t._id, documentDate: new Date() });
  const empId = req.body.context?.type === 'employee' ? req.body.context.id : req.body.employee;
  if (empId && HR.includes(req.user.role)) { d.scope = 'employee'; d.employee = oid(empId); d.visibility = 'private'; d.employeeCanView = !!req.body.employeeCanView; }
  else if (req.body.context?.type === 'candidate') { d.scope = 'linked'; d.linkedTo = { model: 'Candidate', id: oid(req.body.context.id), label: r.values.candidate_name || 'Candidate' }; d.visibility = 'private'; }
  d.file = { ...stored, uploadedBy: u._id };
  await applyRetention(d, {});
  await d.save();
  res.status(201).json({ success: true, data: d });
}));

// ── DASHBOARD ──────────────────────────────────────────────────────────────
router.get('/dashboard', wrap(async (req, res) => {
  const u = await me(req);
  const role = req.user.role;
  const all = await hub.expiringItems({ days: 90, user: { role }, canSeeDoc: (d) => canSee(d, u, role) });
  const out = {
    expired: all.filter((i) => i.daysLeft < 0).length,
    expiring30: all.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 30).length,
    expiring90: all.filter((i) => i.daysLeft > 30).length
  };
  if (['admin', 'hr'].includes(role)) {
    await hub.flagRetention();
    out.retentionDue = await Document.countDocuments(role === 'admin' ? { retentionStatus: 'due' } : { retentionStatus: 'due', scope: 'employee' });
  }
  out.myDocuments = await Document.countDocuments({ uploadedBy: u._id, retentionStatus: { $ne: 'archived' } });
  try {
    const SD = require('../models/SignableDocument');
    out.awaitingMySignature = await SD.countDocuments({ status: 'pending_signatures', signers: { $elemMatch: { user: u._id, status: 'pending' } } });
    if (['admin', 'ceo'].includes(role)) out.pendingSignatures = await SD.countDocuments({ status: 'pending_signatures' });
  } catch (e) { /* ignore */ }
  try {
    const Policy = require('../models/Policy');
    const pols = await Policy.find({ status: 'active' }).select('currentVersion acknowledgements.userId acknowledgements.version mandatoryFor mandatoryRoles mandatoryDepts').lean();
    out.policiesToAcknowledge = pols.filter((p) => {
      const applies = p.mandatoryFor === 'all_staff' || (p.mandatoryFor === 'specific_roles' && (p.mandatoryRoles || []).includes(role)) || (p.mandatoryFor === 'specific_departments' && (p.mandatoryDepts || []).includes(u.department));
      return applies && !(p.acknowledgements || []).some((a) => same(a.userId, u._id) && a.version === p.currentVersion);
    }).length;
  } catch (e) { /* ignore */ }
  res.json({ success: true, data: out });
}));

router.get('/meta', (req, res) => res.json({ success: true, categories: Document.CATEGORIES }));

module.exports = router;
