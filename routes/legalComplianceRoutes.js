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
  const AuditSchedule      = require('../models/AuditSchedule');
  const Incident           = require('../models/Incident');
  const Policy             = require('../models/Policy');
  const WhistleblowingCase = require('../models/WhistleblowingCase');
  const DataPrivacyRecord  = require('../models/DataPrivacyRecord');
  const TrainingRecord     = require('../models/TrainingRecord');
  const RiskMatrix         = require('../models/RiskMatrix');
  const SupplierMonitoring = require('../models/SupplierMonitoring');
  const DocumentVersion    = require('../models/DocumentVersion');
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


// ── DOCUMENT VERSIONING ───────────────────────────────────────────────────────
router.post('/documents/:id/versions', async (req, res) => {
  try {
    const doc = await ComplianceDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    const latestVersion = await DocumentVersion.findOne({ documentId: req.params.id }).sort({ versionNumber: -1 });
    const nextVersion   = latestVersion ? latestVersion.versionNumber + 1 : 1;
    const version = await DocumentVersion.create({
      documentId: req.params.id,
      versionNumber: nextVersion,
      changeSummary: req.body.changeSummary || '',
      changedBy: req.user.userId,
      file: req.body.file || {},
      status: 'published',
      publishedAt: new Date()
    });
    // Archive previous version
    if (latestVersion) await DocumentVersion.findByIdAndUpdate(latestVersion._id, { status: 'superseded' });
    // Update the parent document file
    if (req.body.file) { doc.file = req.body.file; await doc.save(); }
    ok(res, version, `Version ${nextVersion} created`);
  } catch (e) { err(res, 'Failed to create version', e); }
});
 
router.get('/documents/:id/versions', async (req, res) => {
  try {
    const versions = await DocumentVersion.find({ documentId: req.params.id })
      .populate('changedBy', 'fullName email').sort({ versionNumber: -1 });
    ok(res, versions);
  } catch (e) { err(res, 'Failed to fetch versions', e, 500); }
});
 
 
// ── RISK MATRIX ───────────────────────────────────────────────────────────────
router.get('/risk-matrix', async (req, res) => {
  try {
    const { category, residualRating, module: mod, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (category)       filter.category       = category;
    if (residualRating) filter.residualRating  = residualRating;
    if (mod)            filter.module          = mod;
    if (status)         filter.status          = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [risks, total] = await Promise.all([
      RiskMatrix.find(filter).populate('owner', 'fullName').sort({ residualScore: -1 }).skip(skip).limit(Number(limit)),
      RiskMatrix.countDocuments(filter)
    ]);
    // Heat map aggregate
    const heatmap = await RiskMatrix.aggregate([
      { $match: filter },
      { $group: { _id: { likelihood: '$residualLikelihood', impact: '$residualImpact' }, count: { $sum: 1 }, titles: { $push: '$title' } } }
    ]);
    ok(res, { risks, total, heatmap, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch risk matrix', e, 500); }
});
 
router.post('/risk-matrix', async (req, res) => {
  try {
    const risk = await RiskMatrix.create({ ...req.body, createdBy: req.user.userId });
    ok(res, risk, 'Risk entry created', 201);
  } catch (e) { err(res, 'Failed to create risk entry', e); }
});
 
router.put('/risk-matrix/:id', async (req, res) => {
  try {
    const risk = await RiskMatrix.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!risk) return res.status(404).json({ success: false, message: 'Risk entry not found' });
    ok(res, risk, 'Risk entry updated');
  } catch (e) { err(res, 'Failed to update risk entry', e); }
});
 
 
// ── AUDIT SCHEDULER ───────────────────────────────────────────────────────────
router.get('/audits', async (req, res) => {
  try {
    const { auditType, status, module: mod, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (auditType) filter.auditType = auditType;
    if (status)    filter.status    = status;
    if (mod)       filter.module    = mod;
    const skip = (Number(page) - 1) * Number(limit);
    const [audits, total] = await Promise.all([
      AuditSchedule.find(filter).populate('leadAuditor', 'fullName').sort({ plannedDate: -1 }).skip(skip).limit(Number(limit)),
      AuditSchedule.countDocuments(filter)
    ]);
    ok(res, { audits, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch audits', e, 500); }
});
 
router.post('/audits', async (req, res) => {
  try {
    const audit = await AuditSchedule.create({ ...req.body, createdBy: req.user.userId });
    ok(res, audit, 'Audit scheduled', 201);
  } catch (e) { err(res, 'Failed to schedule audit', e); }
});
 
router.get('/audits/:id', async (req, res) => {
  try {
    const audit = await AuditSchedule.findById(req.params.id).populate('leadAuditor auditTeam', 'fullName email');
    if (!audit) return res.status(404).json({ success: false, message: 'Audit not found' });
    ok(res, audit);
  } catch (e) { err(res, 'Failed to fetch audit', e, 500); }
});
 
router.put('/audits/:id', async (req, res) => {
  try {
    const audit = await AuditSchedule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!audit) return res.status(404).json({ success: false, message: 'Audit not found' });
    ok(res, audit, 'Audit updated');
  } catch (e) { err(res, 'Failed to update audit', e); }
});
 
router.post('/audits/:id/findings', async (req, res) => {
  try {
    const audit = await AuditSchedule.findById(req.params.id);
    if (!audit) return res.status(404).json({ success: false, message: 'Audit not found' });
    audit.findings.push(req.body);
    await audit.save();
    ok(res, audit, 'Finding added');
  } catch (e) { err(res, 'Failed to add finding', e); }
});
 
router.patch('/audits/:id/findings/:findingId/capa', async (req, res) => {
  try {
    const audit = await AuditSchedule.findById(req.params.id);
    if (!audit) return res.status(404).json({ success: false, message: 'Audit not found' });
    const finding = audit.findings.id(req.params.findingId);
    if (!finding) return res.status(404).json({ success: false, message: 'Finding not found' });
    Object.assign(finding.capa, req.body);
    await audit.save();
    ok(res, audit, 'CAPA updated');
  } catch (e) { err(res, 'Failed to update CAPA', e); }
});
 
 
// ── INCIDENT MANAGEMENT ───────────────────────────────────────────────────────
router.get('/incidents', async (req, res) => {
  try {
    const { incidentType, severity, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (incidentType) filter.incidentType = incidentType;
    if (severity)     filter.severity     = severity;
    if (status)       filter.status       = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [incidents, total] = await Promise.all([
      Incident.find(filter).populate('reportedBy', 'fullName').sort({ occurredAt: -1 }).skip(skip).limit(Number(limit)),
      Incident.countDocuments(filter)
    ]);
    // KPIs
    const kpis = await Incident.aggregate([
      { $group: { _id: '$severity', count: { $sum: 1 }, totalLoss: { $sum: '$estimatedLoss' } } }
    ]);
    ok(res, { incidents, total, kpis, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch incidents', e, 500); }
});
 
router.post('/incidents', async (req, res) => {
  try {
    const incident = await Incident.create({ ...req.body, createdBy: req.user.userId });
    ok(res, incident, 'Incident reported', 201);
  } catch (e) { err(res, 'Failed to report incident', e); }
});
 
router.put('/incidents/:id', async (req, res) => {
  try {
    const incident = await Incident.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    ok(res, incident, 'Incident updated');
  } catch (e) { err(res, 'Failed to update incident', e); }
});
 
router.post('/incidents/:id/corrective-actions', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    incident.correctiveActions.push(req.body);
    await incident.save();
    ok(res, incident, 'Corrective action added');
  } catch (e) { err(res, 'Failed to add corrective action', e); }
});
 
router.post('/incidents/:id/close', async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    incident.status    = 'closed';
    incident.closedAt  = new Date();
    incident.closedBy  = req.user.userId;
    incident.closureNotes = req.body.closureNotes || '';
    await incident.save();
    ok(res, incident, 'Incident closed');
  } catch (e) { err(res, 'Failed to close incident', e); }
});
 
 
// ── POLICY MANAGEMENT ─────────────────────────────────────────────────────────
router.get('/policies', async (req, res) => {
  try {
    const { category, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (status)   filter.status   = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [policies, total] = await Promise.all([
      Policy.find(filter).populate('owner', 'fullName').sort({ nextReviewDue: 1 }).skip(skip).limit(Number(limit)),
      Policy.countDocuments(filter)
    ]);
    ok(res, { policies, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch policies', e, 500); }
});
 
router.post('/policies', async (req, res) => {
  try {
    const policy = await Policy.create({ ...req.body, createdBy: req.user.userId });
    ok(res, policy, 'Policy created', 201);
  } catch (e) { err(res, 'Failed to create policy', e); }
});
 
router.put('/policies/:id', async (req, res) => {
  try {
    const policy = await Policy.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });
    ok(res, policy, 'Policy updated');
  } catch (e) { err(res, 'Failed to update policy', e); }
});
 
router.post('/policies/:id/versions', async (req, res) => {
  try {
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });
    const nextVer = (policy.currentVersion || 0) + 1;
    // Supersede current published version
    policy.versions.forEach(v => { if (v.status === 'published') v.status = 'superseded'; });
    policy.versions.push({ versionNumber: nextVer, ...req.body, status: 'published', publishedAt: new Date(), publishedBy: req.user.userId });
    policy.currentVersion = nextVer;
    // Reset acknowledgements when a new version is published
    policy.acknowledgements = [];
    policy.totalAcknowledged = 0;
    policy.coveragePct = 0;
    await policy.save();
    ok(res, policy, `Version ${nextVer} published — acknowledgements reset`);
  } catch (e) { err(res, 'Failed to publish version', e); }
});
 
router.post('/policies/:id/acknowledge', async (req, res) => {
  try {
    const policy = await Policy.findById(req.params.id);
    if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });
    const alreadyAcknowledged = policy.acknowledgements.some(
      a => String(a.userId) === String(req.user.userId) && a.version === policy.currentVersion
    );
    if (alreadyAcknowledged) return ok(res, policy, 'Already acknowledged for current version');
    policy.acknowledgements.push({
      userId: req.user.userId,
      userName: req.body.userName || '',
      version: policy.currentVersion,
      acknowledgedAt: new Date(),
      ipAddress: req.ip || ''
    });
    await policy.save();
    ok(res, { coveragePct: policy.coveragePct, totalAcknowledged: policy.totalAcknowledged }, 'Policy acknowledged');
  } catch (e) { err(res, 'Failed to acknowledge policy', e); }
});
 
 
// ── WHISTLEBLOWING ────────────────────────────────────────────────────────────
// Public endpoint — no auth required for submission (protected by design)
router.post('/whistleblowing/report', async (req, res) => {
  try {
    const wbCase = await WhistleblowingCase.create({ ...req.body });
    // Return only the token — no case details
    ok(res, { reporterToken: wbCase.reporterToken, message: 'Your report has been received. Use this token to check your case status.' }, 'Report submitted', 201);
  } catch (e) { err(res, 'Failed to submit report', e); }
});
 
// Check status by token — public, no auth
router.get('/whistleblowing/status/:token', async (req, res) => {
  try {
    const wbCase = await WhistleblowingCase.findOne({ reporterToken: req.params.token })
      .select('caseRef status reporterUpdates createdAt');
    if (!wbCase) return res.status(404).json({ success: false, message: 'Case not found' });
    ok(res, wbCase);
  } catch (e) { err(res, 'Failed to fetch status', e, 500); }
});
 
// Management endpoints — auth required
router.get('/whistleblowing', async (req, res) => {
  try {
    const { status, category, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status)   filter.status   = status;
    if (category) filter.category = category;
    const skip = (Number(page) - 1) * Number(limit);
    // Return sanitised list — no reporter contact details
    const [cases, total] = await Promise.all([
      WhistleblowingCase.find(filter).select('-contactDetail -investigationLog').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      WhistleblowingCase.countDocuments(filter)
    ]);
    ok(res, { cases, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch cases', e, 500); }
});
 
router.get('/whistleblowing/:id', async (req, res) => {
  try {
    const wbCase = await WhistleblowingCase.findById(req.params.id)
      .populate('investigatorId', 'fullName email')
      .populate('authorisedViewers', 'fullName email');
    if (!wbCase) return res.status(404).json({ success: false, message: 'Case not found' });
    // Check authorised access
    const isAuthorised = wbCase.authorisedViewers.some(v => String(v._id) === String(req.user.userId))
      || req.user.role === 'admin' || req.user.role === 'ceo';
    if (!isAuthorised) return res.status(403).json({ success: false, message: 'Access restricted to authorised investigators' });
    ok(res, wbCase);
  } catch (e) { err(res, 'Failed to fetch case', e, 500); }
});
 
router.put('/whistleblowing/:id', async (req, res) => {
  try {
    const wbCase = await WhistleblowingCase.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!wbCase) return res.status(404).json({ success: false, message: 'Case not found' });
    ok(res, wbCase, 'Case updated');
  } catch (e) { err(res, 'Failed to update case', e); }
});
 
router.post('/whistleblowing/:id/log', async (req, res) => {
  try {
    const wbCase = await WhistleblowingCase.findById(req.params.id);
    if (!wbCase) return res.status(404).json({ success: false, message: 'Case not found' });
    wbCase.investigationLog.push({ entry: req.body.entry, addedBy: req.user.userId, logDate: new Date() });
    await wbCase.save();
    ok(res, wbCase, 'Log entry added');
  } catch (e) { err(res, 'Failed to add log entry', e); }
});
 
router.post('/whistleblowing/:id/reporter-update', async (req, res) => {
  try {
    const wbCase = await WhistleblowingCase.findById(req.params.id);
    if (!wbCase) return res.status(404).json({ success: false, message: 'Case not found' });
    wbCase.reporterUpdates.push({ message: req.body.message, updateDate: new Date() });
    await wbCase.save();
    ok(res, { message: 'Reporter update sent' });
  } catch (e) { err(res, 'Failed to send update', e); }
});
 
 
// ── DATA PRIVACY ─────────────────────────────────────────────────────────────
const getOrCreatePrivacyRecord = async () => {
  let record = await DataPrivacyRecord.findOne();
  if (!record) record = await DataPrivacyRecord.create({ organisationName: 'Grato Engineering' });
  return record;
};
 
router.get('/privacy', async (req, res) => {
  try { ok(res, await getOrCreatePrivacyRecord()); }
  catch (e) { err(res, 'Failed to fetch privacy record', e, 500); }
});
 
router.post('/privacy/processing', async (req, res) => {
  try {
    const record = await getOrCreatePrivacyRecord();
    record.processingActivities.push({ ...req.body, createdBy: req.user.userId });
    await record.save();
    ok(res, record, 'Processing activity added');
  } catch (e) { err(res, 'Failed to add processing activity', e); }
});
 
router.post('/privacy/dpias', async (req, res) => {
  try {
    const record = await getOrCreatePrivacyRecord();
    const Counter = require('../models/Counter');
    const year    = new Date().getFullYear();
    const counter = await Counter.findByIdAndUpdate(`DPIA-${year}`, { $inc: { seq: 1 } }, { upsert: true, new: true });
    record.dpias.push({ dpiaRef: `DPIA-${year}-${String(counter.seq).padStart(3, '0')}`, ...req.body, createdBy: req.user.userId });
    await record.save();
    ok(res, record, 'DPIA added');
  } catch (e) { err(res, 'Failed to add DPIA', e); }
});
 
router.post('/privacy/breaches', async (req, res) => {
  try {
    const record = await getOrCreatePrivacyRecord();
    const Counter = require('../models/Counter');
    const now     = new Date();
    const period  = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counter = await Counter.findByIdAndUpdate(`BREACH-${period}`, { $inc: { seq: 1 } }, { upsert: true, new: true });
    const breachData = { breachRef: `BREACH-${period}-${String(counter.seq).padStart(3, '0')}`, ...req.body, createdBy: req.user.userId };
    // 72-hour notification deadline
    if (breachData.notificationRequired) {
      const deadline = new Date(breachData.discoveredAt || now);
      deadline.setHours(deadline.getHours() + 72);
      breachData.notificationDeadline = deadline;
    }
    record.breaches.push(breachData);
    await record.save();
    ok(res, record, 'Data breach recorded');
  } catch (e) { err(res, 'Failed to record breach', e); }
});
 
router.post('/privacy/sars', async (req, res) => {
  try {
    const record = await getOrCreatePrivacyRecord();
    const Counter = require('../models/Counter');
    const year    = new Date().getFullYear();
    const counter = await Counter.findByIdAndUpdate(`SAR-${year}`, { $inc: { seq: 1 } }, { upsert: true, new: true });
    const receivedAt = new Date(req.body.receivedAt || new Date());
    const deadline   = new Date(receivedAt); deadline.setDate(deadline.getDate() + 30);
    record.sars.push({
      sarRef: `SAR-${year}-${String(counter.seq).padStart(3, '0')}`,
      ...req.body, receivedAt, deadline, createdBy: req.user.userId
    });
    await record.save();
    ok(res, record, 'SAR recorded — 30-day deadline set');
  } catch (e) { err(res, 'Failed to record SAR', e); }
});
 
 
// ── TRAINING & COMPETENCY ─────────────────────────────────────────────────────
router.get('/training', async (req, res) => {
  try {
    const { userId, department, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (userId)     filter.userId     = userId;
    if (department) filter.department = department;
    const skip = (Number(page) - 1) * Number(limit);
    const [records, total] = await Promise.all([
      TrainingRecord.find(filter).populate('userId', 'fullName email department').sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)),
      TrainingRecord.countDocuments(filter)
    ]);
    ok(res, { records, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch training records', e, 500); }
});
 
router.post('/training', async (req, res) => {
  try {
    const existing = await TrainingRecord.findOne({ userId: req.body.userId });
    if (existing) return ok(res, existing, 'Record already exists — use PUT to update');
    const record = await TrainingRecord.create({ ...req.body, createdBy: req.user.userId });
    ok(res, record, 'Training record created', 201);
  } catch (e) { err(res, 'Failed to create training record', e); }
});
 
router.put('/training/:id', async (req, res) => {
  try {
    const record = await TrainingRecord.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    ok(res, record, 'Training record updated');
  } catch (e) { err(res, 'Failed to update training record', e); }
});
 
router.post('/training/:id/sessions', async (req, res) => {
  try {
    const record = await TrainingRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    record.trainingSessions.push(req.body);
    await record.save();
    ok(res, record, 'Training session added');
  } catch (e) { err(res, 'Failed to add session', e); }
});
 
router.post('/training/:id/certifications', async (req, res) => {
  try {
    const record = await TrainingRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    record.certifications.push(req.body);
    await record.save();
    ok(res, record, 'Certification added');
  } catch (e) { err(res, 'Failed to add certification', e); }
});
 
router.post('/training/:id/competencies', async (req, res) => {
  try {
    const record = await TrainingRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    // Upsert competency
    const existing = record.competencies.find(c => c.competency === req.body.competency);
    if (existing) { Object.assign(existing, req.body); }
    else { record.competencies.push(req.body); }
    await record.save();
    ok(res, record, 'Competency updated');
  } catch (e) { err(res, 'Failed to update competency', e); }
});
 
// Organisation-wide gap analysis
router.get('/training/gap-analysis', async (req, res) => {
  try {
    const { department } = req.query;
    const filter = {};
    if (department) filter.department = department;
    const records = await TrainingRecord.find(filter).lean();
    const competencyMap = new Map();
    records.forEach(r => {
      (r.competencies || []).forEach(c => {
        if (!competencyMap.has(c.competency)) {
          competencyMap.set(c.competency, { competency: c.competency, category: c.category, gaps: 0, totalAssessed: 0, avgGap: 0, totalGap: 0 });
        }
        const entry = competencyMap.get(c.competency);
        entry.totalAssessed++;
        entry.totalGap += c.gap || 0;
        if (c.gap > 0) entry.gaps++;
      });
    });
    const result = Array.from(competencyMap.values()).map(e => ({
      ...e,
      avgGap: e.totalAssessed > 0 ? Math.round((e.totalGap / e.totalAssessed) * 10) / 10 : 0
    })).sort((a, b) => b.avgGap - a.avgGap);
    ok(res, { gaps: result, totalStaff: records.length });
  } catch (e) { err(res, 'Failed to generate gap analysis', e, 500); }
});
 
 
// ── SUPPLIER MONITORING ───────────────────────────────────────────────────────
router.get('/supplier-monitoring', async (req, res) => {
  try {
    const { status, sanctionsCheckResult, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status)               filter.status               = status;
    if (sanctionsCheckResult) filter.sanctionsCheckResult = sanctionsCheckResult;
    const skip = (Number(page) - 1) * Number(limit);
    const [records, total] = await Promise.all([
      SupplierMonitoring.find(filter).populate('supplierId', 'name email').sort({ nextReviewDue: 1 }).skip(skip).limit(Number(limit)),
      SupplierMonitoring.countDocuments(filter)
    ]);
    ok(res, { records, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { err(res, 'Failed to fetch monitoring records', e, 500); }
});
 
router.post('/supplier-monitoring', async (req, res) => {
  try {
    const existing = await SupplierMonitoring.findOne({ supplierId: req.body.supplierId });
    if (existing) return ok(res, existing, 'Monitoring record already exists');
    const record = await SupplierMonitoring.create({ ...req.body, createdBy: req.user.userId });
    ok(res, record, 'Supplier monitoring record created', 201);
  } catch (e) { err(res, 'Failed to create monitoring record', e); }
});
 
router.put('/supplier-monitoring/:id', async (req, res) => {
  try {
    const record = await SupplierMonitoring.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    ok(res, record, 'Record updated');
  } catch (e) { err(res, 'Failed to update record', e); }
});
 
router.post('/supplier-monitoring/:id/sanctions-check', async (req, res) => {
  try {
    const record = await SupplierMonitoring.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    record.sanctionsCheckDate   = new Date();
    record.sanctionsCheckResult = req.body.result || 'clear';
    record.sanctionsCheckSource = req.body.source || '';
    record.sanctionsNotes       = req.body.notes  || '';
    if (req.body.result === 'flagged') {
      record.alerts.push({ alertType: 'sanctions_flag', message: 'Supplier flagged in sanctions check', severity: 'high' });
    }
    await record.save();
    ok(res, record, 'Sanctions check recorded');
  } catch (e) { err(res, 'Failed to record sanctions check', e); }
});
 
router.post('/supplier-monitoring/:id/reassessment', async (req, res) => {
  try {
    const record = await SupplierMonitoring.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    record.reassessmentTriggers.push({ ...req.body, triggeredBy: req.user.userId, triggeredAt: new Date() });
    await record.save();
    ok(res, record, 'Re-assessment trigger recorded');
  } catch (e) { err(res, 'Failed to record re-assessment trigger', e); }
});
 
 
// ── COMPLIANCE REPORTS ENDPOINTS ──────────────────────────────────────────────
router.get('/reports/compliance-summary', async (req, res) => {
  try {
    const now = new Date();
    const thisYear = now.getFullYear();
 
    const [
      openRisks,
      criticalRisks,
      withinAppetite,
      openIncidents,
      openAudits,
      overdueCapas,
      openWBCases,
      activePolicies,
      uncoveredPolicies,
      openSARs,
      openBreaches,
      blacklistedSuppliers,
      expiringCerts,
      openRiskCases
    ] = await Promise.all([
      RiskMatrix.countDocuments({ status: 'open' }),
      RiskMatrix.countDocuments({ residualRating: 'critical', status: 'open' }),
      RiskMatrix.countDocuments({ withinAppetite: true }),
      Incident.countDocuments({ status: { $nin: ['closed', 'archived'] } }),
      AuditSchedule.countDocuments({ status: { $in: ['planned', 'in_progress'] } }),
      AuditSchedule.countDocuments({ 'findings.capa.status': 'overdue' }),
      WhistleblowingCase.countDocuments({ status: { $nin: ['closed_substantiated', 'closed_unsubstantiated', 'closed_inconclusive'] } }),
      Policy.countDocuments({ status: 'active' }),
      Policy.countDocuments({ status: 'active', coveragePct: { $lt: 80 } }),
      DataPrivacyRecord.aggregate([{ $project: { openSARs: { $filter: { input: '$sars', cond: { $ne: ['$$this.status', 'completed'] } } } } }, { $project: { count: { $size: '$openSARs' } } }]),
      DataPrivacyRecord.aggregate([{ $project: { ob: { $filter: { input: '$breaches', cond: { $ne: ['$$this.status', 'closed'] } } } } }, { $project: { count: { $size: '$ob' } } }]),
      SupplierMonitoring.countDocuments({ isBlacklisted: true }),
      TrainingRecord.countDocuments({ 'certifications.isExpired': true }),
      RiskCase.countDocuments({ status: { $nin: ['resolved', 'closed'] } })
    ]);
 
    ok(res, {
      generatedAt: now,
      risks:       { open: openRisks, critical: criticalRisks, withinAppetite },
      incidents:   { open: openIncidents },
      audits:      { open: openAudits, overdueCapas },
      whistleblowing: { open: openWBCases },
      policies:    { active: activePolicies, belowCoverage: uncoveredPolicies },
      privacy:     { openSARs: openSARs[0]?.count || 0, openBreaches: openBreaches[0]?.count || 0 },
      suppliers:   { blacklisted: blacklistedSuppliers },
      training:    { expiredCerts: expiringCerts },
      riskCases:   { open: openRiskCases }
    });
  } catch (e) { err(res, 'Failed to generate compliance summary', e, 500); }
});

module.exports = router;