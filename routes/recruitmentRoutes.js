/**
 * Recruitment: job openings (HR drafts, CEO approves), candidate pipeline, interviews with panel feedback,
 * offers, and the hand-off to onboarding (IT account request + salary profile).
 */
const express = require('express');
const mongoose = require('mongoose');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const { upload } = require('../middlewares/uploadMiddleware');
const JobOpening = require('../models/JobOpening');
const Candidate = require('../models/Candidate');
const User = require('../models/User');
const Counter = require('../models/Counter');

const router = express.Router();
router.use(authMiddleware);

const STAGES = Candidate.STAGES;
const HR = ['hr', 'admin'];
const READ = ['hr', 'admin', 'ceo'];
const needHr = requireRoles(...HR);
const needRead = requireRoles(...READ);

const oid = (id) => { if (!mongoose.Types.ObjectId.isValid(id)) throw Object.assign(new Error('Invalid ID'), { status: 400 }); return id; };
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const fail = (res, e) => res.status(e.status || (e.name === 'ValidationError' ? 400 : 500)).json({ success: false, message: e.message });
const uid = (req) => String(req.user.userId || req.user._id || req.user.id);
const same = (a, b) => String(a) === String(b);
const lc = (s) => String(s || '').toLowerCase().trim();
const hist = (doc, req, action, comment) => doc.history.push({ action, by: uid(req), byName: req.user.fullName || req.user.email || '', comment: comment || '' });
const notify = async (to, subject, text) => { if (!to || (Array.isArray(to) && !to.length)) return; try { await require('../services/emailService').sendEmail({ to, subject, text }); } catch (e) { /* best effort */ } };

async function nextRef() {
  const key = `JOB-${new Date().getFullYear()}`;
  const c = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${key}-${String(c.seq).padStart(3, '0')}`;
}

const OPENING_FIELDS = ['title', 'department', 'headcount', 'employmentType', 'location', 'description', 'requirements', 'justification', 'salaryMin', 'salaryMax', 'closingDate'];
function applyOpening(doc, b) {
  OPENING_FIELDS.forEach((k) => { if (b[k] !== undefined) doc[k] = b[k] === '' ? undefined : b[k]; });
  if (doc.salaryMin && doc.salaryMax && Number(doc.salaryMin) > Number(doc.salaryMax)) throw bad('Minimum salary cannot exceed maximum');
}
async function loadOpening(id) {
  const o = await JobOpening.findById(oid(id));
  if (!o) throw bad('Opening not found', 404);
  return o;
}
async function loadCandidate(id) {
  const c = await Candidate.findById(oid(id));
  if (!c) throw bad('Candidate not found', 404);
  return c;
}

// ── OPENINGS ───────────────────────────────────────────────────────────────
router.get('/openings', needRead, async (req, res) => {
  try {
    const f = req.query.status ? { status: req.query.status } : {};
    const rows = await JobOpening.find(f).sort({ createdAt: -1 }).populate('requestedBy', 'fullName').lean();
    const counts = await Candidate.aggregate([
      { $match: { stage: { $nin: ['rejected', 'withdrawn'] } } }, { $group: { _id: '$opening', n: { $sum: 1 } } }
    ]);
    const m = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ success: true, data: rows.map((r) => ({ ...r, activeCandidates: m.get(String(r._id)) || 0 })) });
  } catch (e) { fail(res, e); }
});

router.get('/openings/:id', needRead, async (req, res) => {
  try {
    const o = await JobOpening.findById(oid(req.params.id)).populate('requestedBy', 'fullName').lean();
    if (!o) throw bad('Opening not found', 404);
    res.json({ success: true, data: o });
  } catch (e) { fail(res, e); }
});

router.post('/openings', needHr, async (req, res) => {
  try {
    const o = new JobOpening({ reference: await nextRef(), requestedBy: uid(req), title: req.body.title, department: req.body.department });
    applyOpening(o, req.body);
    hist(o, req, 'created');
    await o.save();
    res.status(201).json({ success: true, data: o });
  } catch (e) { fail(res, e); }
});

router.put('/openings/:id', needHr, async (req, res) => {
  try {
    const o = await loadOpening(req.params.id);
    if (!['draft', 'rejected'].includes(o.status)) throw bad('Only draft or rejected openings can be edited');
    applyOpening(o, req.body);
    hist(o, req, 'edited');
    await o.save();
    res.json({ success: true, data: o });
  } catch (e) { fail(res, e); }
});

router.delete('/openings/:id', needHr, async (req, res) => {
  try {
    const o = await loadOpening(req.params.id);
    if (o.status !== 'draft') throw bad('Only drafts can be deleted');
    await o.deleteOne();
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

router.post('/openings/:id/submit', needHr, async (req, res) => {
  try {
    const o = await loadOpening(req.params.id);
    if (!['draft', 'rejected'].includes(o.status)) throw bad('Already submitted');
    if (!o.description || !o.justification) throw bad('Add a description and a justification before submitting');
    o.status = 'pending_approval'; o.rejectionReason = undefined;
    hist(o, req, 'submitted');
    await o.save();
    res.json({ success: true, data: o });
  } catch (e) { fail(res, e); }
});

router.post('/openings/:id/approve', requireRoles('ceo', 'admin'), async (req, res) => {
  try {
    const o = await loadOpening(req.params.id);
    if (o.status !== 'pending_approval') throw bad('Not awaiting approval');
    if (same(o.requestedBy, uid(req))) throw bad('You requested this post, so someone else must approve it', 403);
    o.status = 'open';
    hist(o, req, 'approved', req.body.comment);
    await o.save();
    res.json({ success: true, data: o });
  } catch (e) { fail(res, e); }
});

router.post('/openings/:id/reject', requireRoles('ceo', 'admin'), async (req, res) => {
  try {
    const o = await loadOpening(req.params.id);
    if (o.status !== 'pending_approval') throw bad('Not awaiting approval');
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw bad('A reason is required');
    o.status = 'rejected'; o.rejectionReason = reason;
    hist(o, req, 'rejected', reason);
    await o.save();
    res.json({ success: true, data: o });
  } catch (e) { fail(res, e); }
});

// hold / reopen / close
router.post('/openings/:id/status', needHr, async (req, res) => {
  try {
    const o = await loadOpening(req.params.id);
    const to = req.body.status;
    const allowed = { open: ['on_hold', 'closed'], on_hold: ['open', 'closed'], closed: ['open'], filled: ['open'] };
    if (!(allowed[o.status] || []).includes(to)) throw bad(`Cannot move from ${o.status} to ${to}`);
    o.status = to;
    hist(o, req, `status_${to}`, req.body.comment);
    await o.save();
    res.json({ success: true, data: o });
  } catch (e) { fail(res, e); }
});

// ── CANDIDATES ─────────────────────────────────────────────────────────────
router.get('/candidates', needRead, async (req, res) => {
  try {
    const f = {};
    if (req.query.opening) f.opening = oid(req.query.opening);
    if (req.query.stage) f.stage = req.query.stage;
    const rows = await Candidate.find(f).select('-notes -stageHistory').sort({ createdAt: -1 }).limit(500).lean();
    res.json({ success: true, data: rows.map((c) => ({ ...c, avgScore: avgScore(c) })) });
  } catch (e) { fail(res, e); }
});

function avgScore(c) {
  const s = (c.interviews || []).flatMap((i) => (i.feedback || []).map((f) => f.score));
  return s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : null;
}

router.get('/candidates/:id', needRead, async (req, res) => {
  try {
    const c = await Candidate.findById(oid(req.params.id)).populate('interviews.panel', 'fullName email').populate('opening', 'title reference department salaryMin salaryMax').lean();
    if (!c) throw bad('Candidate not found', 404);
    res.json({ success: true, data: { ...c, avgScore: avgScore(c) } });
  } catch (e) { fail(res, e); }
});

router.post('/candidates', needHr, upload.single('cv'), async (req, res) => {
  try {
    const opening = await loadOpening(req.body.opening);
    if (!['open', 'on_hold'].includes(opening.status)) throw bad('Candidates can only be added to approved openings');
    if (!String(req.body.name || '').trim()) throw bad('Candidate name is required');
    const c = new Candidate({
      opening: opening._id, name: req.body.name, email: req.body.email, phone: req.body.phone, source: req.body.source || 'other',
      currentEmployer: req.body.currentEmployer, expectedSalary: req.body.expectedSalary ? Number(req.body.expectedSalary) : undefined,
      createdBy: uid(req), stageHistory: [{ stage: 'applied', by: uid(req) }]
    });
    if (req.file) {
      const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');
      const s = await saveFile(req.file, STORAGE_CATEGORIES.HR_DOCUMENTS, 'recruitment', null);
      c.cv = { name: req.file.originalname, url: s.url, publicId: s.publicId, size: s.bytes, mimetype: req.file.mimetype };
    }
    await c.save();
    res.status(201).json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

router.put('/candidates/:id', needHr, upload.single('cv'), async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    ['name', 'email', 'phone', 'source', 'currentEmployer'].forEach((k) => { if (req.body[k] !== undefined) c[k] = req.body[k]; });
    if (req.body.expectedSalary !== undefined) c.expectedSalary = req.body.expectedSalary === '' ? undefined : Number(req.body.expectedSalary);
    if (req.file) {
      const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');
      const s = await saveFile(req.file, STORAGE_CATEGORIES.HR_DOCUMENTS, 'recruitment', null);
      c.cv = { name: req.file.originalname, url: s.url, publicId: s.publicId, size: s.bytes, mimetype: req.file.mimetype };
    }
    await c.save();
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

router.delete('/candidates/:id', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (['offer', 'hired'].includes(c.stage)) throw bad('Candidates at offer or hired stage cannot be deleted');
    await c.deleteOne();
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

router.post('/candidates/:id/notes', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (!String(req.body.text || '').trim()) throw bad('Note text is required');
    c.notes.push({ text: String(req.body.text).trim(), by: uid(req), byName: req.user.fullName || '' });
    await c.save();
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

// Stage moves. 'offer' and 'hired' are reached through the offer endpoints, not directly.
router.patch('/candidates/:id/stage', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    const to = req.body.stage;
    if (!STAGES.includes(to)) throw bad('Unknown stage');
    if (['offer', 'hired'].includes(to)) throw bad('Use the offer actions to move a candidate to offer or hired');
    if (c.stage === 'hired') throw bad('Candidate is already hired');
    if (to === 'rejected') {
      if (!String(req.body.reason || '').trim()) throw bad('A rejection reason is required');
      c.rejectionReason = String(req.body.reason).trim();
    }
    if (c.stage === 'offer' && c.offer?.status === 'accepted') throw bad('Offer already accepted, complete the hire instead');
    c.stage = to;
    c.stageHistory.push({ stage: to, by: uid(req) });
    await c.save();
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

// ── INTERVIEWS ─────────────────────────────────────────────────────────────
router.post('/candidates/:id/interviews', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (['rejected', 'withdrawn', 'hired'].includes(c.stage)) throw bad('This candidate is no longer in the process');
    const when = new Date(req.body.scheduledAt);
    if (isNaN(when)) throw bad('A valid date and time is required');
    const panel = (Array.isArray(req.body.panel) ? req.body.panel : []).map(oid);
    if (!panel.length) throw bad('Choose at least one interviewer');
    c.interviews.push({
      round: Number(req.body.round) || c.interviews.length + 1, mode: req.body.mode || 'in_person', scheduledAt: when,
      durationMinutes: Number(req.body.durationMinutes) || 60, location: req.body.location, panel
    });
    if (['applied', 'screening'].includes(c.stage)) { c.stage = 'interview'; c.stageHistory.push({ stage: 'interview', by: uid(req) }); }
    await c.save();
    const people = await User.find({ _id: { $in: panel } }).select('email').lean();
    notify(people.map((p) => p.email), `Interview: ${c.name}`,
      `You are on the interview panel for ${c.name} on ${when.toUTCString()} (${req.body.mode || 'in person'}${req.body.location ? ', ' + req.body.location : ''}). Submit your feedback in the ERP under Recruitment > My interviews.`);
    if (c.email && req.body.notifyCandidate) {
      notify(c.email, 'Interview invitation', `Dear ${c.name},\n\nYou are invited to an interview on ${when.toUTCString()}${req.body.location ? ` at/via ${req.body.location}` : ''}.\n\nKind regards,\nHR`);
    }
    res.status(201).json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

router.post('/candidates/:id/interviews/:iid/cancel', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    const i = c.interviews.id(oid(req.params.iid));
    if (!i) throw bad('Interview not found', 404);
    i.status = 'cancelled';
    await c.save();
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

// Panel members (any user) see their own interviews
router.get('/my-interviews', async (req, res) => {
  try {
    const me = uid(req);
    const rows = await Candidate.find({ 'interviews.panel': me, stage: { $nin: ['rejected', 'withdrawn'] } })
      .select('name opening interviews stage').populate('opening', 'title reference').lean();
    const out = [];
    rows.forEach((c) => (c.interviews || []).forEach((i) => {
      if (i.status === 'cancelled' || !(i.panel || []).some((p) => same(p, me))) return;
      out.push({
        candidateId: c._id, candidate: c.name, opening: c.opening?.title, interviewId: i._id, round: i.round, mode: i.mode,
        scheduledAt: i.scheduledAt, location: i.location, status: i.status,
        submitted: (i.feedback || []).some((f) => same(f.by, me))
      });
    }));
    out.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    res.json({ success: true, data: out });
  } catch (e) { fail(res, e); }
});

router.post('/candidates/:id/interviews/:iid/feedback', async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    const i = c.interviews.id(oid(req.params.iid));
    if (!i) throw bad('Interview not found', 404);
    const onPanel = i.panel.some((p) => same(p, uid(req)));
    if (!onPanel && !HR.includes(req.user.role)) throw bad('Only panel members can give feedback', 403);
    if (i.status === 'cancelled') throw bad('Interview was cancelled');
    const score = Number(req.body.score);
    if (!(score >= 1 && score <= 5)) throw bad('Score must be between 1 and 5');
    if (!['strong_yes', 'yes', 'no', 'strong_no'].includes(req.body.recommendation)) throw bad('Choose a recommendation');
    if (i.feedback.some((f) => same(f.by, uid(req)))) throw bad('You already submitted feedback for this interview');
    i.feedback.push({ by: uid(req), byName: req.user.fullName || '', score, recommendation: req.body.recommendation, comments: req.body.comments });
    if (i.feedback.length >= i.panel.length) i.status = 'done';
    await c.save();
    res.json({ success: true, data: { ok: true } });
  } catch (e) { fail(res, e); }
});

// ── OFFER ──────────────────────────────────────────────────────────────────
router.put('/candidates/:id/offer', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (['rejected', 'withdrawn', 'hired'].includes(c.stage)) throw bad('This candidate is no longer in the process');
    if (['sent', 'accepted'].includes(c.offer?.status)) throw bad('The offer was already sent');
    const salary = Number(req.body.salary);
    if (!(salary > 0)) throw bad('Offer salary is required');
    const opening = await JobOpening.findById(c.opening).lean();
    c.offer = {
      ...(c.offer?.toObject ? c.offer.toObject() : {}),
      position: req.body.position || opening?.title, salary, startDate: req.body.startDate || undefined, notes: req.body.notes,
      aboveBand: !!(opening?.salaryMax && salary > opening.salaryMax), status: 'draft'
    };
    if (c.stage !== 'offer') { c.stage = 'offer'; c.stageHistory.push({ stage: 'offer', by: uid(req) }); }
    await c.save();
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

router.post('/candidates/:id/offer/send', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (c.offer?.status !== 'draft') throw bad('Prepare the offer first');
    if (c.offer.aboveBand && !['ceo', 'admin'].includes(req.user.role)) throw bad('This offer is above the approved salary band, so the CEO or an admin must send it', 403);
    c.offer.status = 'sent'; c.offer.sentAt = new Date();
    await c.save();
    if (c.email) {
      notify(c.email, `Job offer: ${c.offer.position}`,
        `Dear ${c.name},\n\nWe are pleased to offer you the position of ${c.offer.position}${c.offer.startDate ? `, starting ${new Date(c.offer.startDate).toDateString()}` : ''}, at a monthly gross salary of ${Number(c.offer.salary).toLocaleString()} XAF.\n\nPlease reply to confirm.\n\nKind regards,\nHR`);
    }
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

router.post('/candidates/:id/offer/respond', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (c.offer?.status !== 'sent') throw bad('The offer has not been sent');
    c.offer.status = req.body.accepted ? 'accepted' : 'declined';
    c.offer.respondedAt = new Date();
    if (!req.body.accepted) { c.stage = 'withdrawn'; c.rejectionReason = 'Declined the offer'; c.stageHistory.push({ stage: 'withdrawn', by: uid(req) }); }
    await c.save();
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

// ── HIRE + ONBOARDING HAND-OFF ─────────────────────────────────────────────
router.post('/candidates/:id/hire', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (c.stage === 'hired') throw bad('Already hired');
    if (c.offer?.status !== 'accepted') throw bad('The offer must be accepted first');
    const o = await loadOpening(c.opening);
    c.stage = 'hired'; c.stageHistory.push({ stage: 'hired', by: uid(req) });
    o.filled += 1;
    if (o.filled >= o.headcount) { o.status = 'filled'; hist(o, req, 'filled', c.name); }
    await c.save(); await o.save();
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

// Ask IT to create the account (they own account creation and passwords)
router.post('/candidates/:id/request-account', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (c.stage !== 'hired') throw bad('Complete the hire first');
    const o = await JobOpening.findById(c.opening).lean();
    const it = await User.find({ role: 'it', isActive: { $ne: false } }).select('email').lean();
    if (!it.length) throw bad('No active IT users to notify');
    await notify(it.map((u) => u.email), `New starter account request: ${c.name}`,
      `Please create an account for a new hire.\n\nName: ${c.name}\nPersonal email: ${c.email || '-'}\nPhone: ${c.phone || '-'}\nPosition: ${c.offer?.position || o?.title}\nDepartment: ${o?.department}\nStart date: ${c.offer?.startDate ? new Date(c.offer.startDate).toDateString() : 'TBC'}\n\nUse IT Console > User Management. When done, HR will link the account to the salary profile.`);
    c.onboarding.itRequestedAt = new Date();
    await c.save();
    res.json({ success: true, data: c });
  } catch (e) { fail(res, e); }
});

router.get('/users-lookup', needHr, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const f = { isActive: { $ne: false }, role: { $ne: 'supplier' } };
    if (q) f.$or = [{ fullName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    const rows = await User.find(f).select('fullName email department position').sort({ createdAt: -1 }).limit(20).lean();
    res.json({ success: true, data: rows });
  } catch (e) { fail(res, e); }
});

// Link the created account and create the payroll salary profile from the accepted offer
router.post('/candidates/:id/link-user', needHr, async (req, res) => {
  try {
    const c = await loadCandidate(req.params.id);
    if (c.stage !== 'hired') throw bad('Complete the hire first');
    const user = await User.findById(oid(req.body.userId)).select('_id fullName');
    if (!user) throw bad('User not found', 404);
    const SalaryProfile = require('../models/SalaryProfile');
    const exists = await SalaryProfile.findOne({ employee: user._id }).select('_id');
    if (!exists) {
      await SalaryProfile.create({ employee: user._id, baseSalary: c.offer.salary, hireDate: c.offer.startDate, status: 'active', updatedBy: uid(req) });
      c.onboarding.salaryProfileCreated = true;
    }
    c.onboarding.hiredUser = user._id;
    await c.save();
    res.json({ success: true, data: c, message: exists ? 'Linked. A salary profile already existed for this user.' : 'Linked and salary profile created. Add allowances in Payroll.' });
  } catch (e) { fail(res, e); }
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
router.get('/dashboard', needRead, async (req, res) => {
  try {
    const [openings, byStage, upcoming] = await Promise.all([
      JobOpening.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Candidate.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
      Candidate.aggregate([
        { $unwind: '$interviews' },
        { $match: { 'interviews.status': 'scheduled', 'interviews.scheduledAt': { $gte: new Date() } } },
        { $count: 'n' }
      ])
    ]);
    res.json({ success: true, data: { openings, byStage, upcomingInterviews: upcoming[0]?.n || 0, stages: STAGES } });
  } catch (e) { fail(res, e); }
});

module.exports = router;
