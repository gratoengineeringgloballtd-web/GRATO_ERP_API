// ============================================================
// routes/legalComplianceRoutes.js
// Mount in app.js as:
//   app.use('/api/legal', legalComplianceRoutes);
// Auth: requires roles legal, finance, admin, ceo
// ============================================================
const express = require('express');
const router  = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const ComplianceDocument  = require('../models/ComplianceDocument');
const RiskCase            = require('../models/RiskCase');
const ContractRecord      = require('../models/ContractRecord');
const RegulatoryStandard  = require('../models/RegulatoryStandard');
const IntellectualProperty= require('../models/IntellectualProperty');
const SDDRecord           = require('../models/SDDRecord');
const { SDD_SECTIONS, buildBlankAnswers } = require('../config/sddQuestions');

router.use(authMiddleware);
router.use(requireRoles('legal', 'finance', 'admin', 'ceo'));

const ok  = (res, data, msg = 'OK', code = 200) => res.status(code).json({ success: true, data, message: msg });
const err = (res, msg, e, code = 400) => {
  console.error(msg, e?.message);
  res.status(code).json({ success: false, message: msg, error: e?.message });
};


// ── DASHBOARD ────────────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const thirtyDays = new Date(now); thirtyDays.setDate(now.getDate() + 30);

    const [
      openRisks,
      criticalRisks,
      expiringDocs,
      activeContracts,
      pendingSDDs,
      regulatoryNonCompliant,
      ipAtRisk
    ] = await Promise.all([
      RiskCase.countDocuments({ status: { $in: ['open','under_review','escalated'] } }),
      RiskCase.countDocuments({ severity: 'critical', status: { $nin: ['resolved','closed'] } }),
      ComplianceDocument.countDocuments({ expiryDate: { $lte: thirtyDays }, status: { $ne: 'archived' } }),
      ContractRecord.countDocuments({ status: 'active' }),
      SDDRecord.countDocuments({ status: { $in: ['submitted','under_review'] } }),
      RegulatoryStandard.countDocuments({ complianceStatus: 'non_compliant', isActive: true }),
      IntellectualProperty.countDocuments({ monitoringStatus: { $in: ['at_risk','infringement_detected','in_litigation'] } })
    ]);

    const recentRisks = await RiskCase.find({ status: { $nin: ['resolved','closed'] } })
      .sort({ createdAt: -1 }).limit(5).lean();

    const reviewsDue = await ComplianceDocument.find({ nextReviewDue: { $lte: thirtyDays } })
      .sort({ nextReviewDue: 1 }).limit(5).lean();

    ok(res, {
      kpis: { openRisks, criticalRisks, expiringDocs, activeContracts, pendingSDDs, regulatoryNonCompliant, ipAtRisk },
      recentRisks,
      reviewsDue
    });
  } catch (e) { err(res, 'Failed to load dashboard', e, 500); }
});


// ── COMPLIANCE DOCUMENTS ─────────────────────────────────────────────────────

router.get('/documents', async (req, res) => {
  try {
    const { module, entityType, entityId, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (module)     filter.module     = module;
    if (entityType) filter.entityType = entityType;
    if (entityId)   filter.entityId   = entityId;
    if (status)     filter.status     = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [docs, total] = await Promise.all([
      ComplianceDocument.find(filter).populate('createdBy','fullName email').sort({ nextReviewDue: 1 }).skip(skip).limit(Number(limit)),
      ComplianceDocument.countDocuments(filter)
    ]);
    ok(res, { documents: docs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch documents', e, 500); }
});

router.post('/documents', async (req, res) => {
  try {
    const doc = await ComplianceDocument.create({ ...req.body, createdBy: req.user.userId });
    ok(res, doc, 'Document created', 201);
  } catch (e) { err(res, 'Failed to create document', e); }
});

router.put('/documents/:id', async (req, res) => {
  try {
    const doc = await ComplianceDocument.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    ok(res, doc, 'Document updated');
  } catch (e) { err(res, 'Failed to update document', e); }
});

router.post('/documents/:id/review', async (req, res) => {
  try {
    const doc = await ComplianceDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    doc.reviewCycles.push({ reviewedBy: req.user.userId, reviewDate: new Date(), ...req.body });
    doc.lastReviewDate = new Date();
    if (req.body.nextReviewDue) doc.nextReviewDue = new Date(req.body.nextReviewDue);
    await doc.save();
    ok(res, doc, 'Review recorded');
  } catch (e) { err(res, 'Failed to record review', e); }
});

router.post('/documents/:id/approve', async (req, res) => {
  try {
    const doc = await ComplianceDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    const step = doc.approvalChain.find(s => s.level === doc.currentApprovalLevel && s.status === 'pending');
    if (!step) return err(res, 'No pending approval step');
    step.status = req.body.decision || 'approved';
    step.actionDate = new Date();
    step.comments = req.body.comments || '';
    if (step.status === 'approved') {
      const next = doc.approvalChain.find(s => s.level === doc.currentApprovalLevel + 1);
      if (next) { doc.currentApprovalLevel++; }
      else { doc.approvalStatus = 'approved'; }
    } else {
      doc.approvalStatus = 'rejected';
    }
    await doc.save();
    ok(res, doc, `Document ${step.status}`);
  } catch (e) { err(res, 'Approval action failed', e); }
});


// ── RISK CASES ────────────────────────────────────────────────────────────────

router.get('/risk-cases', async (req, res) => {
  try {
    const { module, status, classification, severity, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (module)         filter.module         = module;
    if (status)         filter.status         = status;
    if (classification) filter.classification = classification;
    if (severity)       filter.severity       = severity;
    const skip = (Number(page) - 1) * Number(limit);
    const [cases, total] = await Promise.all([
      RiskCase.find(filter).populate('createdBy','fullName email').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      RiskCase.countDocuments(filter)
    ]);
    ok(res, { cases, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch risk cases', e, 500); }
});

router.post('/risk-cases', async (req, res) => {
  try {
    const rcase = await RiskCase.create({ ...req.body, createdBy: req.user.userId });
    ok(res, rcase, 'Risk case created', 201);
  } catch (e) { err(res, 'Failed to create risk case', e); }
});

router.put('/risk-cases/:id', async (req, res) => {
  try {
    const rcase = await RiskCase.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!rcase) return res.status(404).json({ success: false, message: 'Risk case not found' });
    ok(res, rcase, 'Risk case updated');
  } catch (e) { err(res, 'Failed to update risk case', e); }
});

router.post('/risk-cases/:id/resolve', async (req, res) => {
  try {
    const rcase = await RiskCase.findById(req.params.id);
    if (!rcase) return res.status(404).json({ success: false, message: 'Risk case not found' });
    rcase.status = 'resolved';
    rcase.resolutionNotes = req.body.resolutionNotes || '';
    rcase.resolvedAt = new Date();
    rcase.resolvedBy = req.user.userId;
    await rcase.save();
    ok(res, rcase, 'Risk case resolved');
  } catch (e) { err(res, 'Failed to resolve risk case', e); }
});


// ── CONTRACT RECORDS ──────────────────────────────────────────────────────────

router.get('/contracts', async (req, res) => {
  try {
    const { status, supplierId, projectId, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status)     filter.status     = status;
    if (supplierId) filter.supplierId = supplierId;
    if (projectId)  filter.projectId  = projectId;
    const skip = (Number(page) - 1) * Number(limit);
    const [contracts, total] = await Promise.all([
      ContractRecord.find(filter).populate('createdBy','fullName email').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      ContractRecord.countDocuments(filter)
    ]);
    ok(res, { contracts, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch contracts', e, 500); }
});

router.post('/contracts', async (req, res) => {
  try {
    const contract = await ContractRecord.create({ ...req.body, createdBy: req.user.userId });
    ok(res, contract, 'Contract created', 201);
  } catch (e) { err(res, 'Failed to create contract', e); }
});

router.get('/contracts/:id', async (req, res) => {
  try {
    const contract = await ContractRecord.findById(req.params.id)
      .populate('createdBy','fullName email')
      .populate('documents')
      .populate('riskCases');
    if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
    ok(res, contract);
  } catch (e) { err(res, 'Failed to fetch contract', e, 500); }
});

router.put('/contracts/:id', async (req, res) => {
  try {
    const contract = await ContractRecord.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
    ok(res, contract, 'Contract updated');
  } catch (e) { err(res, 'Failed to update contract', e); }
});

// Add a service level to a contract
router.post('/contracts/:id/service-levels', async (req, res) => {
  try {
    const contract = await ContractRecord.findById(req.params.id);
    if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
    contract.serviceLevels.push(req.body);
    await contract.save();
    ok(res, contract, 'Service level added');
  } catch (e) { err(res, 'Failed to add service level', e); }
});

// Add a task, optionally linking to project module task
router.post('/contracts/:id/tasks', async (req, res) => {
  try {
    const contract = await ContractRecord.findById(req.params.id);
    if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
    contract.contractTasks.push(req.body);
    await contract.save();
    ok(res, contract, 'Contract task added');
  } catch (e) { err(res, 'Failed to add task', e); }
});

router.patch('/contracts/:id/tasks/:taskId', async (req, res) => {
  try {
    const contract = await ContractRecord.findById(req.params.id);
    if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
    const task = contract.contractTasks.id(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    Object.assign(task, req.body);
    if (req.body.status === 'completed') { task.completedAt = new Date(); task.completedBy = req.user.userId; }
    await contract.save();
    ok(res, contract, 'Task updated');
  } catch (e) { err(res, 'Failed to update task', e); }
});


// ── REGULATORY STANDARDS ──────────────────────────────────────────────────────

router.get('/regulatory', async (req, res) => {
  try {
    const { regulatoryArea, complianceStatus, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true };
    if (regulatoryArea)    filter.regulatoryArea    = regulatoryArea;
    if (complianceStatus)  filter.complianceStatus  = complianceStatus;
    const skip = (Number(page) - 1) * Number(limit);
    const [standards, total] = await Promise.all([
      RegulatoryStandard.find(filter).sort({ nextReviewDue: 1 }).skip(skip).limit(Number(limit)),
      RegulatoryStandard.countDocuments(filter)
    ]);
    ok(res, { standards, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch standards', e, 500); }
});

router.post('/regulatory', async (req, res) => {
  try {
    const standard = await RegulatoryStandard.create({ ...req.body, createdBy: req.user.userId });
    ok(res, standard, 'Regulatory standard created', 201);
  } catch (e) { err(res, 'Failed to create standard', e); }
});

router.put('/regulatory/:id', async (req, res) => {
  try {
    const standard = await RegulatoryStandard.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!standard) return res.status(404).json({ success: false, message: 'Standard not found' });
    ok(res, standard, 'Standard updated');
  } catch (e) { err(res, 'Failed to update standard', e); }
});

router.post('/regulatory/:id/disclosures', async (req, res) => {
  try {
    const standard = await RegulatoryStandard.findById(req.params.id);
    if (!standard) return res.status(404).json({ success: false, message: 'Standard not found' });
    standard.disclosures.push(req.body);
    await standard.save();
    ok(res, standard, 'Disclosure added');
  } catch (e) { err(res, 'Failed to add disclosure', e); }
});


// ── INTELLECTUAL PROPERTY ─────────────────────────────────────────────────────

router.get('/ip', async (req, res) => {
  try {
    const { ipType, status, monitoringStatus, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (ipType)           filter.ipType           = ipType;
    if (status)           filter.status           = status;
    if (monitoringStatus) filter.monitoringStatus = monitoringStatus;
    const skip = (Number(page) - 1) * Number(limit);
    const [ips, total] = await Promise.all([
      IntellectualProperty.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      IntellectualProperty.countDocuments(filter)
    ]);
    ok(res, { ips, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch IP records', e, 500); }
});

router.post('/ip', async (req, res) => {
  try {
    const ip = await IntellectualProperty.create({ ...req.body, createdBy: req.user.userId });
    ok(res, ip, 'IP record created', 201);
  } catch (e) { err(res, 'Failed to create IP record', e); }
});

router.put('/ip/:id', async (req, res) => {
  try {
    const ip = await IntellectualProperty.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!ip) return res.status(404).json({ success: false, message: 'IP record not found' });
    ok(res, ip, 'IP record updated');
  } catch (e) { err(res, 'Failed to update IP record', e); }
});

router.post('/ip/:id/litigations', async (req, res) => {
  try {
    const ip = await IntellectualProperty.findById(req.params.id);
    if (!ip) return res.status(404).json({ success: false, message: 'IP record not found' });
    ip.litigations.push(req.body);
    await ip.save();
    ok(res, ip, 'Litigation added');
  } catch (e) { err(res, 'Failed to add litigation', e); }
});

router.post('/ip/:id/trust-entities', async (req, res) => {
  try {
    const ip = await IntellectualProperty.findById(req.params.id);
    if (!ip) return res.status(404).json({ success: false, message: 'IP record not found' });
    ip.trustEntities.push(req.body);
    await ip.save();
    ok(res, ip, 'Trust entity added');
  } catch (e) { err(res, 'Failed to add trust entity', e); }
});


// ── SDD RECORDS ───────────────────────────────────────────────────────────────

// Get the full question template (for frontend to render the form)
router.get('/sdd/template', (req, res) => {
  ok(res, SDD_SECTIONS);
});

router.get('/sdd', async (req, res) => {
  try {
    const { sddType, status, supplierId, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (sddType)    filter.sddType    = sddType;
    if (status)     filter.status     = status;
    if (supplierId) filter.supplierId = supplierId;
    const skip = (Number(page) - 1) * Number(limit);
    const [records, total] = await Promise.all([
      SDDRecord.find(filter).populate('createdBy','fullName email').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      SDDRecord.countDocuments(filter)
    ]);
    ok(res, { records, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch SDD records', e, 500); }
});

// Create a new blank SDD (seeded with all questions)
router.post('/sdd', async (req, res) => {
  try {
    const record = await SDDRecord.create({
      ...req.body,
      answers: buildBlankAnswers(),
      createdBy: req.user.userId
    });
    ok(res, record, 'SDD record created', 201);
  } catch (e) { err(res, 'Failed to create SDD record', e); }
});

router.get('/sdd/:id', async (req, res) => {
  try {
    const record = await SDDRecord.findById(req.params.id)
      .populate('createdBy','fullName email')
      .populate('supplierId','name email country');
    if (!record) return res.status(404).json({ success: false, message: 'SDD record not found' });
    ok(res, record);
  } catch (e) { err(res, 'Failed to fetch SDD record', e, 500); }
});

// Save answers (partial save — supports autosave)
router.patch('/sdd/:id/answers', async (req, res) => {
  try {
    const record = await SDDRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'SDD record not found' });
    if (!['draft','submitted'].includes(record.status)) {
      return err(res, 'Cannot edit an SDD that has been reviewed or approved');
    }

    // Merge incoming answers into existing answers array
    const incoming = req.body.answers || [];
    incoming.forEach(update => {
      const existing = record.answers.find(
        a => a.sectionKey === update.sectionKey && a.questionKey === update.questionKey
      );
      if (existing) {
        if (update.answer       !== undefined) existing.answer       = update.answer;
        if (update.answerText   !== undefined) existing.answerText   = update.answerText;
        if (update.notApplicable!== undefined) existing.notApplicable= update.notApplicable;
        if (update.attachments  !== undefined) existing.attachments  = update.attachments;
        if (update.flagged      !== undefined) existing.flagged      = update.flagged;
      }
    });

    if (req.body.unmetCriticalPoints !== undefined) {
      record.unmetCriticalPoints = req.body.unmetCriticalPoints;
    }

    await record.save();
    ok(res, { score: record.score, scoreBySection: record.scoreBySection, answeredQuestions: record.answeredQuestions, totalQuestions: record.totalQuestions });
  } catch (e) { err(res, 'Failed to save answers', e); }
});

// Submit for review
router.post('/sdd/:id/submit', async (req, res) => {
  try {
    const record = await SDDRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'SDD record not found' });
    if (record.status !== 'draft') return err(res, 'SDD is not in draft status');
    record.status = 'submitted';
    record.submittedAt = new Date();
    record.submittedBy = req.user.userId;
    record.submittedByName = req.body.submittedByName || '';
    await record.save();
    ok(res, record, 'SDD submitted for review');
  } catch (e) { err(res, 'Failed to submit SDD', e); }
});

// Approve or reject SDD
router.post('/sdd/:id/review', async (req, res) => {
  try {
    const record = await SDDRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'SDD record not found' });
    if (!['submitted','under_review'].includes(record.status)) {
      return err(res, 'SDD is not in a reviewable state');
    }

    const { decision, reviewerNotes, rejectionReason } = req.body;
    record.reviewerNotes = reviewerNotes || '';
    record.status = 'under_review';

    if (decision === 'approved') {
      record.status = 'approved';
      record.approvalStatus = 'approved';
      record.approvedAt = new Date();
      // Default expiry: 2 years from approval
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 2);
      record.expiryDate = expiry;
    } else if (decision === 'rejected') {
      record.status = 'rejected';
      record.approvalStatus = 'rejected';
      record.rejectionReason = rejectionReason || '';
    }

    await record.save();
    ok(res, record, `SDD ${decision}`);
  } catch (e) { err(res, 'Failed to review SDD', e); }
});

// Profiling report for a supplier
router.get('/sdd/supplier/:supplierId/profile', async (req, res) => {
  try {
    const records = await SDDRecord.find({ supplierId: req.params.supplierId })
      .sort({ createdAt: -1 })
      .lean();
    const latest = records[0] || null;
    ok(res, { latest, history: records });
  } catch (e) { err(res, 'Failed to load supplier profile', e, 500); }
});

module.exports = router;