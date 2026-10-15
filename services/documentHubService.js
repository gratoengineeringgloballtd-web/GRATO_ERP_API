/**
 * Document hub helpers: expiry scanning across sources, reminder digests, retention flagging.
 */
const Document = require('../models/Document');
const RetentionRule = require('../models/RetentionRule');

const DAY = 24 * 3600 * 1000;
const COMPLIANCE_READERS = ['admin', 'ceo', 'finance', 'hr'];
const THRESHOLDS = [60, 30, 7, 0];

const daysLeft = (d) => Math.ceil((new Date(d).getTime() - Date.now()) / DAY);
const addYears = (d, y) => { const x = new Date(d); x.setFullYear(x.getFullYear() + y); return x; };

async function ensureRetentionRules() {
  const n = await RetentionRule.countDocuments();
  if (n === 0) await RetentionRule.insertMany(RetentionRule.DEFAULTS);
}
async function retentionYearsFor(category) {
  const rule = await RetentionRule.findOne({ category }).lean();
  return rule ? rule.years : null;
}
function retainUntil(baseDate, years) {
  return years && years > 0 ? addYears(baseDate || new Date(), years) : undefined;
}

/** Items expiring within `days` (negative daysLeft = already expired), from every expiry-bearing source. */
async function expiringItems({ days = 90, user, canSeeDoc }) {
  const horizon = new Date(Date.now() + days * DAY);
  const out = [];

  const docs = await Document.find({ expiryDate: { $lte: horizon }, retentionStatus: { $ne: 'archived' } }).sort({ expiryDate: 1 }).limit(500).lean();
  docs.filter((d) => !canSeeDoc || canSeeDoc(d)).forEach((d) => out.push({
    source: 'Document', id: d._id, title: d.title, subtitle: `${d.category}${d.linkedTo?.label ? ` / ${d.linkedTo.label}` : ''}`,
    expiryDate: d.expiryDate, daysLeft: daysLeft(d.expiryDate), url: d.file?.url
  }));

  if (COMPLIANCE_READERS.includes(user?.role)) {
    try {
      const ComplianceDocument = require('../models/ComplianceDocument');
      const cds = await ComplianceDocument.find({ expiryDate: { $lte: horizon }, status: { $ne: 'archived' } }).sort({ expiryDate: 1 }).limit(300).lean();
      cds.forEach((c) => out.push({
        source: 'Compliance', id: c._id, title: c.name, subtitle: `${c.module} / ${c.documentType}`,
        expiryDate: c.expiryDate, daysLeft: daysLeft(c.expiryDate), url: c.file?.url
      }));
    } catch (e) { /* source unavailable */ }
    try {
      const Contract = require('../models/Contract');
      const cs = await Contract.find({ 'dates.endDate': { $lte: horizon }, status: { $in: ['active', 'ACTIVE', 'Active'] } }).sort({ 'dates.endDate': 1 }).limit(300).lean();
      cs.forEach((c) => out.push({
        source: 'Contract', id: c._id, title: c.title, subtitle: c.contractNumber || 'Contract',
        expiryDate: c.dates.endDate, daysLeft: daysLeft(c.dates.endDate)
      }));
    } catch (e) { /* source unavailable */ }
  }
  return out.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
}

async function sendDigest(map) {
  const { sendEmail } = require('./emailService');
  let sent = 0;
  for (const [email, items] of map) {
    const lines = items.map((i) => `- ${i.title} (${i.source}): ${i.daysLeft <= 0 ? 'EXPIRED' : `expires in ${i.daysLeft} day(s)`} on ${new Date(i.expiryDate).toDateString()}`);
    try {
      await sendEmail({ to: email, subject: `Document expiry reminder (${items.length})`, text: `The following documents need attention:\n\n${lines.join('\n')}\n\nOpen the ERP under Documents > Expiring.` });
      sent += 1;
    } catch (e) { console.error('Document reminder email failed:', e.message); }
  }
  return sent;
}

/** Daily job: send reminders at 60/30/7/0 days (or per-document reminderDays), flag retention. */
async function runReminders() {
  const User = require('../models/User');
  const staff = await User.find({ role: { $in: ['hr', 'admin'] }, isActive: { $ne: false } }).select('email').lean();
  const staffEmails = staff.map((s) => s.email).filter(Boolean);
  const digests = new Map();
  const add = (email, item) => { if (!email) return; const k = String(email).toLowerCase(); if (!digests.has(k)) digests.set(k, []); digests.get(k).push(item); };

  // Documents: per-document thresholds, remembered in remindersSent
  const docs = await Document.find({ expiryDate: { $ne: null }, retentionStatus: { $ne: 'archived' } }).populate('notifyUsers uploadedBy', 'email').lean();
  for (const d of docs) {
    const left = daysLeft(d.expiryDate);
    const hit = (d.reminderDays || []).concat([0]).filter((t) => left <= t && !(d.remindersSent || []).includes(t)).sort((a, b) => a - b)[0];
    if (hit === undefined) continue;
    const item = { source: 'Document', title: d.title, daysLeft: left, expiryDate: d.expiryDate };
    const to = new Set([...(d.notifyUsers || []).map((u) => u.email), d.uploadedBy?.email, ...(d.scope === 'employee' ? staffEmails : [])].filter(Boolean));
    to.forEach((e) => add(e, item));
    await Document.updateOne({ _id: d._id }, { $addToSet: { remindersSent: { $each: (d.reminderDays || []).concat([0]).filter((t) => left <= t) } } });
  }

  // Compliance and contracts: fixed thresholds, to HR/admin
  const hitDays = new Set(THRESHOLDS);
  try {
    const ComplianceDocument = require('../models/ComplianceDocument');
    const cds = await ComplianceDocument.find({ expiryDate: { $ne: null }, status: { $ne: 'archived' } }).select('name expiryDate').lean();
    cds.filter((c) => hitDays.has(daysLeft(c.expiryDate))).forEach((c) => staffEmails.forEach((e) => add(e, { source: 'Compliance', title: c.name, daysLeft: daysLeft(c.expiryDate), expiryDate: c.expiryDate })));
  } catch (e) { /* ignore */ }
  try {
    const Contract = require('../models/Contract');
    const cs = await Contract.find({ 'dates.endDate': { $ne: null }, status: { $in: ['active', 'ACTIVE', 'Active'] } }).select('title dates.endDate').lean();
    cs.filter((c) => hitDays.has(daysLeft(c.dates.endDate))).forEach((c) => staffEmails.forEach((e) => add(e, { source: 'Contract', title: c.title, daysLeft: daysLeft(c.dates.endDate), expiryDate: c.dates.endDate })));
  } catch (e) { /* ignore */ }

  const sent = await sendDigest(digests);
  const flagged = await flagRetention();
  return { digests: digests.size, sent, retentionFlagged: flagged };
}

/** Mark documents past their retention date as 'due'. Nothing is ever deleted automatically. */
async function flagRetention() {
  const r = await Document.updateMany({ retentionStatus: 'active', retainUntil: { $lte: new Date() } }, { $set: { retentionStatus: 'due' } });
  return r.modifiedCount || 0;
}

module.exports = { ensureRetentionRules, retentionYearsFor, retainUntil, expiringItems, runReminders, flagRetention, daysLeft, COMPLIANCE_READERS };
