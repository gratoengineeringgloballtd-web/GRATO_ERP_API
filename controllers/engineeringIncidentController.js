'use strict';
// controllers/engineeringIncidentController.js
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const XLSX   = require('xlsx');

const EngineeringIncidentReport = require('../models/EngineeringIncidentReport');
const User                      = require('../models/User');
const {
  getEngineeringApprovalChain,
  getStatusAfterApproval,
  getNotificationEmailForLevel,
  getApproverForLevel,
  getApproverLevel,
  isEngineeringApprover,
  canViewAllTechnicalReports,
  ENGINEERING_APPROVERS
} = require('../config/engineeringIncidentApprovalChain');
const cloudinaryStorage = require('../utils/cloudinaryStorage');

// ── Email helper (fire-and-forget) ────────────────────────────────────────────
const tryEmail = async (fn) => { try { await fn(); } catch (e) { console.error('Email error:', e.message); } };

const sendEmail = (() => {
  let _send;
  return async (opts) => {
    if (!_send) {
      try { const svc = require('../services/emailService'); _send = svc.sendEmail || svc.default; }
      catch (_) { _send = null; }
    }
    if (_send) return _send(opts);
  };
})();

// ── Email templates ───────────────────────────────────────────────────────────
const approverNotificationHtml = (report, approverName, level) => {
  const actionLabel = level === 1 ? 'review' : level === 2 ? 'approve' : 'give final approval to';
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1890ff;color:white;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0">Engineering Incident Report — Action Required (Level ${level})</h2>
  </div>
  <div style="background:#f9f9f9;padding:20px;border:1px solid #ddd">
    <p>Dear ${approverName},</p>
    <p>An Engineering Incident Report requires you to <strong>${actionLabel}</strong> it. You may also edit the report before actioning.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Report Number:</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${report.reportNumber}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Title:</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${report.title}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Severity:</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${report.severity}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Affected Site:</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${report.affectedSiteLocation}</td></tr>
      <tr><td style="padding:8px"><strong>Status:</strong></td><td style="padding:8px">${report.incidentStatus}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/engineering-incidents/${report._id}/review"
         style="background:#1890ff;color:white;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold">
        Review, Edit &amp; Sign
      </a>
    </div>
    <p style="color:#888;font-size:12px">This is an automated notification from Grato Engineering ERP.</p>
  </div>
</div>`;
};

const submitterConfirmHtml = (report) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#52c41a;color:white;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0">✅ Engineering Incident Report Submitted</h2>
  </div>
  <div style="background:#f9f9f9;padding:20px;border:1px solid #ddd">
    <p>Your Engineering Incident Report has been submitted successfully.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Report Number:</strong></td><td style="padding:8px">${report.reportNumber}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Title:</strong></td><td style="padding:8px">${report.title}</td></tr>
      <tr><td style="padding:8px"><strong>Next Step:</strong></td><td style="padding:8px">Awaiting review by ${ENGINEERING_APPROVERS.pascal.name}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/employee/engineering-incident-reports"
         style="background:#52c41a;color:white;padding:12px 28px;text-decoration:none;border-radius:6px">
        Track Your Report
      </a>
    </div>
  </div>
</div>`;

const statusUpdateHtml = (report, status, comments) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:${status === 'approved' ? '#52c41a' : status === 'rejected' ? '#f5222d' : '#faad14'};color:white;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0">Engineering Incident Report — ${status.toUpperCase()}</h2>
  </div>
  <div style="background:#f9f9f9;padding:20px;border:1px solid #ddd">
    <p>Report <strong>${report.reportNumber}</strong> has been <strong>${status}</strong>.</p>
    ${comments ? `<p><strong>Comments:</strong> ${comments}</p>` : ''}
    <div style="text-align:center;margin:24px 0">
      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/employee/engineering-incident-reports/${report._id}"
         style="background:#1890ff;color:white;padding:12px 28px;text-decoration:none;border-radius:6px">
        View Report
      </a>
    </div>
  </div>
</div>`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — which roles/emails can edit
// An approver can edit only when it is their active level.
// ─────────────────────────────────────────────────────────────────────────────
const canEditReport = (user, report) => {
  // Owner can edit only while still in pending_review (not yet actioned)
  const isOwner = report.submittedBy.toString() === user._id.toString();
  if (isOwner && report.overallStatus === 'pending_review') return true;

  // Admin can always edit
  if (['admin', 'ceo'].includes(user.role)) return true;

  // Approver can edit when it is their active turn
  const approverLevel = getApproverLevel(user.email);
  if (!approverLevel) return false;

  const activeStep = report.approvalChain.find(
    s => s.approver.email.toLowerCase() === user.email.toLowerCase() && s.status === 'pending'
  );
  if (!activeStep) return false;

  // Confirm the report is actually sitting at their level
  return report.currentApprovalLevel === approverLevel;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — apply editable fields from request body to a report doc
// ─────────────────────────────────────────────────────────────────────────────
const applyEditableFields = (report, body, parse) => {
  // Section 1
  if (body.title)                report.title               = body.title;
  if (body.duration)             report.duration            = body.duration;
  if (body.severity)             report.severity            = body.severity;
  if (body.incidentTypes)        report.incidentTypes       = parse('incidentTypes', report.incidentTypes);
  if (body.affectedSiteLocation) report.affectedSiteLocation= body.affectedSiteLocation;
  if (body.affectedServices)     report.affectedServices    = body.affectedServices;
  if (body.slaStatus)            report.slaStatus           = body.slaStatus;
  if (body.changeId)             report.changeId            = body.changeId;
  if (body.existingProblemId)    report.existingProblemId   = body.existingProblemId;
  if (body.incidentStatus)       report.incidentStatus      = body.incidentStatus;
  if (body.detailsNarrative)     report.detailsNarrative    = body.detailsNarrative;
  if (body.resolutionSummary !== undefined) report.resolutionSummary = body.resolutionSummary;
  if (body.resolutionDateTime)   report.resolutionDateTime  = new Date(body.resolutionDateTime);

  // Section 2
  if (body.impactLevel)            report.impactLevel           = body.impactLevel;
  if (body.impactAffectedServices) report.impactAffectedServices= body.impactAffectedServices;
  if (body.numberOfSitesAffected)  report.numberOfSitesAffected = body.numberOfSitesAffected;
  if (body.financialImpact !== undefined) report.financialImpact= body.financialImpact;
  if (body.regulatoryImpact)       report.regulatoryImpact      = body.regulatoryImpact;
  if (body.reputationalRisk)       report.reputationalRisk      = body.reputationalRisk;
  if (body.impactDescription !== undefined) report.impactDescription = body.impactDescription;

  // Section 3
  if (body.activityLog)        report.activityLog        = body.activityLog;
  if (body.activityLogEntries) report.activityLogEntries = parse('activityLogEntries', report.activityLogEntries);

  // Section 4
  if (body.initialObservation)  report.initialObservation = body.initialObservation;
  if (body.systemsChecked)      report.systemsChecked     = body.systemsChecked;
  if (body.testsPerformed)      report.testsPerformed     = parse('testsPerformed', report.testsPerformed);
  if (body.initialConclusion)   report.initialConclusion  = parse('initialConclusion', report.initialConclusion);
  if (body.detailedFindings)    report.detailedFindings   = body.detailedFindings;

  // Section 5
  if (body.rcaMethod)             report.rcaMethod           = body.rcaMethod;
  if (body.rootCauseCategories)   report.rootCauseCategories = parse('rootCauseCategories', report.rootCauseCategories);
  if (body.contributingFactors !== undefined) report.contributingFactors = body.contributingFactors;
  if (body.rootCauseConfirmedBy)  report.rootCauseConfirmedBy= body.rootCauseConfirmedBy;
  if (body.rootCauseDescription)  report.rootCauseDescription= body.rootCauseDescription;

  // Section 6
  if (body.logisticsChallenges)   report.logisticsChallenges   = body.logisticsChallenges;
  if (body.securityAccessIssues)  report.securityAccessIssues  = body.securityAccessIssues;
  if (body.sparePartsAvailability)report.sparePartsAvailability= body.sparePartsAvailability;
  if (body.communicationIssues)   report.communicationIssues   = body.communicationIssues;
  if (body.vendorDelays)          report.vendorDelays          = body.vendorDelays;
  if (body.challengeDetails !== undefined) report.challengeDetails = body.challengeDetails;

  // Section 7
  if (body.recommendationText) report.recommendationText = body.recommendationText;
  if (body.actionItems)        report.actionItems        = parse('actionItems', report.actionItems);
  if (body.additionalRecommendations !== undefined) report.additionalRecommendations = body.additionalRecommendations;

  // Section 8
  if (body.additionalAttachmentTypes) report.additionalAttachmentTypes = parse('additionalAttachmentTypes', report.additionalAttachmentTypes);
  if (body.otherAttachmentsSpec !== undefined) report.otherAttachmentsSpec = body.otherAttachmentsSpec;
  if (body.evidenceDescriptions)      report.evidenceDescriptions       = parse('evidenceDescriptions', report.evidenceDescriptions);
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────
const createReport = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });
    if (user.department !== 'Technical' && user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Only Technical department employees may submit this report' });

    const body  = req.body;
    const parse = (field, fallback = null) => {
      if (!body[field]) return fallback;
      try { return typeof body[field] === 'string' ? JSON.parse(body[field]) : body[field]; }
      catch { return body[field]; }
    };

    let actionItems = parse('actionItems', []);
    if (!Array.isArray(actionItems)) actionItems = [];

    // Upload attachments to Cloudinary
    let attachments = [];
    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        try {
          console.log(`☁️  Uploading: ${f.originalname}`);
          const result = await cloudinaryStorage.saveFile(f, 'engineering-incidents', '', null);
          attachments.push({
            name:     f.originalname,
            url:      result.url,
            publicId: result.publicId,
            mimetype: f.mimetype,
            size:     f.size || f.buffer?.length || 0,
            description: ''
          });
          console.log(`   ✅ ${result.url}`);
        } catch (uploadErr) {
          console.error(`❌ Failed to upload ${f.originalname}:`, uploadErr.message);
          return res.status(500).json({ success: false, message: `Failed to upload: ${f.originalname} — ${uploadErr.message}` });
        }
      }
    }

    const approvalChain = getEngineeringApprovalChain();

    const report = new EngineeringIncidentReport({
      // Section 1
      incidentId:            body.incidentId            || '',
      title:                 body.title,
      reportedDateTime:      new Date(body.reportedDateTime),
      incidentStartDateTime: new Date(body.incidentStartDateTime),
      resolutionDateTime:    body.resolutionDateTime ? new Date(body.resolutionDateTime) : undefined,
      duration:              body.duration              || '',
      severity:              body.severity,
      incidentTypes:         parse('incidentTypes', []),
      affectedSiteLocation:  body.affectedSiteLocation,
      affectedServices:      body.affectedServices,
      slaStatus:             body.slaStatus,
      changeId:              body.changeId              || 'N/A',
      existingProblemId:     body.existingProblemId     || 'N/A',
      incidentStatus:        body.incidentStatus,
      detailsNarrative:      body.detailsNarrative,
      resolutionSummary:     body.resolutionSummary     || '',
      // Section 2
      impactLevel:            body.impactLevel,
      impactAffectedServices: body.impactAffectedServices,
      numberOfSitesAffected:  body.numberOfSitesAffected  || '',
      financialImpact:        body.financialImpact         || '',
      regulatoryImpact:       body.regulatoryImpact,
      reputationalRisk:       body.reputationalRisk,
      impactDescription:      body.impactDescription       || '',
      // Section 3
      activityLog:         body.activityLog,
      activityLogEntries:  parse('activityLogEntries', []),
      // Section 4
      initialObservation: body.initialObservation,
      systemsChecked:     body.systemsChecked  || '',
      testsPerformed:     parse('testsPerformed', []),
      initialConclusion:  parse('initialConclusion', []),
      detailedFindings:   body.detailedFindings,
      // Section 5
      rcaMethod:           body.rcaMethod            || '',
      rootCauseCategories: parse('rootCauseCategories', []),
      contributingFactors: body.contributingFactors   || '',
      rootCauseConfirmedBy:body.rootCauseConfirmedBy,
      rootCauseDescription:body.rootCauseDescription,
      // Section 6
      logisticsChallenges:    body.logisticsChallenges,
      securityAccessIssues:   body.securityAccessIssues,
      sparePartsAvailability: body.sparePartsAvailability,
      communicationIssues:    body.communicationIssues,
      vendorDelays:           body.vendorDelays,
      challengeDetails:       body.challengeDetails    || '',
      // Section 7
      recommendationText:        body.recommendationText,
      actionItems,
      additionalRecommendations: body.additionalRecommendations || '',
      // Section 8
      attachments,
      evidenceDescriptions:      parse('evidenceDescriptions', []),
      additionalAttachmentTypes: parse('additionalAttachmentTypes', []),
      otherAttachmentsSpec:      body.otherAttachmentsSpec || '',
      // Section 9
      preparedByName:        body.preparedByName || user.fullName,
      preparedByDesignation: body.preparedByDesignation || user.position || '',
      preparedByDate:        new Date(),
      reviewedByName:        ENGINEERING_APPROVERS.pascal.name,
      reviewedByDesignation: ENGINEERING_APPROVERS.pascal.designation,
      approvedByName:        ENGINEERING_APPROVERS.didier.name,
      approvedByDesignation: ENGINEERING_APPROVERS.didier.designation,
      finalApprovedByName:        ENGINEERING_APPROVERS.kelvin.name,
      finalApprovedByDesignation: ENGINEERING_APPROVERS.kelvin.designation,
      // Meta
      submittedBy:          req.user.userId,
      approvalChain,
      currentApprovalLevel: 1,
      overallStatus:        'pending_review',
      reportStatus:         'Draft — awaiting review'
    });

    await report.save();

    // Notify Pascal (level 1)
    await tryEmail(() => sendEmail({
      to:      ENGINEERING_APPROVERS.pascal.email,
      subject: `🔧 Engineering Incident Report — Review Required [${report.reportNumber}]`,
      html:    approverNotificationHtml(report, ENGINEERING_APPROVERS.pascal.name, 1)
    }));

    // Confirm to submitter
    await tryEmail(() => sendEmail({
      to:      user.email,
      subject: `✅ Engineering Incident Report Submitted — ${report.reportNumber}`,
      html:    submitterConfirmHtml(report)
    }));

    report.notificationsSent = {
      pascal:    { sent: true, sentAt: new Date(), email: ENGINEERING_APPROVERS.pascal.email },
      submitter: { sent: true, sentAt: new Date(), email: user.email }
    };
    await report.save();

    res.status(201).json({ success: true, message: 'Engineering Incident Report submitted successfully', data: report });
  } catch (err) {
    console.error('createReport error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to create report' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE REPORT (edit by approver at their active level, or owner/admin)
// PUT /engineering-incidents/:id
// ─────────────────────────────────────────────────────────────────────────────
const updateReport = async (req, res) => {
  try {
    const user   = await User.findById(req.user.userId);
    const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    if (!canEditReport(user, report))
      return res.status(403).json({ success: false, message: 'You are not authorised to edit this report at this stage' });

    const body  = req.body;
    const parse = (field, fallback) => {
      if (!body[field]) return fallback;
      try { return typeof body[field] === 'string' ? JSON.parse(body[field]) : body[field]; }
      catch { return body[field]; }
    };

    applyEditableFields(report, body, parse);

    // Handle additional file uploads if any
    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        try {
          const result = await cloudinaryStorage.saveFile(f, 'engineering-incidents', '', null);
          report.attachments.push({
            name:     f.originalname,
            url:      result.url,
            publicId: result.publicId,
            mimetype: f.mimetype,
            size:     f.size || f.buffer?.length || 0,
            description: ''
          });
        } catch (uploadErr) {
          console.error(`❌ Failed to upload ${f.originalname}:`, uploadErr.message);
        }
      }
    }

    await report.save();
    res.json({ success: true, message: 'Report updated successfully', data: report });
  } catch (err) {
    console.error('updateReport error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET REPORTS
// ─────────────────────────────────────────────────────────────────────────────
const getReports = async (req, res) => {
  try {
    const user   = await User.findById(req.user.userId);
    const { status, severity, page = 1, limit = 20 } = req.query;

    let query = { isDeleted: false };

    const isAdminLevel   = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
    const isDashboardViewer = canViewAllTechnicalReports(user.email);

    if (!isAdminLevel && !isDashboardViewer) {
      query.submittedBy = req.user.userId;
    }

    if (status   && status   !== 'all') query.overallStatus = status;
    if (severity && severity !== 'all') query.severity      = severity;

    const total   = await EngineeringIncidentReport.countDocuments(query);
    const reports = await EngineeringIncidentReport.find(query)
      .populate('submittedBy', 'fullName email department position')
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .lean();

    res.json({
      success: true,
      data: reports,
      pagination: { total, page: +page, pages: Math.ceil(total / +limit), limit: +limit }
    });
  } catch (err) {
    console.error('getReports error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE REPORT
// ─────────────────────────────────────────────────────────────────────────────
const getReportById = async (req, res) => {
  try {
    const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false })
      .populate('submittedBy', 'fullName email department position');
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    const user        = await User.findById(req.user.userId);
    const isOwner     = report.submittedBy._id.toString() === req.user.userId;
    const isAdminLevel= ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
    const isViewer    = canViewAllTechnicalReports(user.email);

    if (!isOwner && !isAdminLevel && !isViewer)
      return res.status(403).json({ success: false, message: 'Access denied' });

    // Attach canEdit flag for frontend gating
    const data    = report.toObject();
    data.canEdit  = canEditReport(user, report);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// APPROVE / REJECT STEP
// POST /engineering-incidents/:id/approve
// Body: { decision: 'approved'|'rejected', comments?: string }
// Approver may also submit edits in the same request body.
// ─────────────────────────────────────────────────────────────────────────────
const processApproval = async (req, res) => {
  try {
    const { decision, comments, ...editFields } = req.body;

    if (!['approved', 'rejected'].includes(decision))
      return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });

    const user   = await User.findById(req.user.userId);
    const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    // Find the pending step this user can action
    const stepIndex = report.approvalChain.findIndex(
      s => s.approver.email.toLowerCase() === user.email.toLowerCase() && s.status === 'pending'
    );
    if (stepIndex === -1)
      return res.status(403).json({ success: false, message: 'You are not authorised to action this report, or it has already been processed' });

    // Verify it is actually their turn
    const step = report.approvalChain[stepIndex];
    if (report.currentApprovalLevel !== step.level)
      return res.status(403).json({ success: false, message: `It is not your turn yet. Current level: ${report.currentApprovalLevel}` });

    // ── Apply any field edits submitted alongside the approval ────────────
    const parse = (field, fallback) => {
      const val = editFields[field];
      if (!val) return fallback;
      try { return typeof val === 'string' ? JSON.parse(val) : val; }
      catch { return val; }
    };
    if (Object.keys(editFields).length > 0) {
      applyEditableFields(report, editFields, parse);
    }

    // Handle any additional file uploads attached to the approval request
    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        try {
          const result = await cloudinaryStorage.saveFile(f, 'engineering-incidents', '', null);
          report.attachments.push({
            name: f.originalname, url: result.url, publicId: result.publicId,
            mimetype: f.mimetype, size: f.size || f.buffer?.length || 0, description: ''
          });
        } catch (uploadErr) {
          console.error(`❌ Failed to upload ${f.originalname}:`, uploadErr.message);
        }
      }
    }

    // ── Record the decision ───────────────────────────────────────────────
    step.status     = decision;
    step.comments   = comments || '';
    step.actionDate = new Date();
    step.actionTime = new Date().toLocaleTimeString('en-GB');
    if (user.signature?.url)       step.signatureUrl = user.signature.url;
    else if (user.signature?.localPath) step.signatureUrl = user.signature.localPath;

    // Update section-9 date fields
    if (step.role === 'reviewed_by')       report.reviewedByDate       = new Date();
    if (step.role === 'approved_by')       report.approvedByDate       = new Date();
    if (step.role === 'final_approved_by') report.finalApprovedByDate  = new Date();

    const totalLevels = report.approvalChain.length; // 3

    if (decision === 'rejected') {
      report.overallStatus    = 'rejected';
      report.reportStatus     = 'Rejected — revision required';
      report.approverComments = comments || '';

      const submitter = await User.findById(report.submittedBy);
      if (submitter) {
        await tryEmail(() => sendEmail({
          to:      submitter.email,
          subject: `❌ Engineering Incident Report Rejected — ${report.reportNumber}`,
          html:    statusUpdateHtml(report, 'rejected', comments)
        }));
      }
    } else {
      // Approved — advance the chain
      const currentLevel = step.level;

      if (currentLevel >= totalLevels) {
        // ── Fully approved (Kelvin signed) ────────────────────────────
        report.overallStatus = 'approved';
        report.reportStatus  = 'Approved — final';

        const submitter = await User.findById(report.submittedBy);
        if (submitter) {
          await tryEmail(() => sendEmail({
            to:      submitter.email,
            subject: `✅ Engineering Incident Report Fully Approved — ${report.reportNumber}`,
            html:    statusUpdateHtml(report, 'approved', comments)
          }));
        }

        // Also notify submitter and all prior approvers
        await tryEmail(() => sendEmail({
          to:      ENGINEERING_APPROVERS.pascal.email,
          subject: `✅ EIR Fully Approved — ${report.reportNumber}`,
          html:    statusUpdateHtml(report, 'approved', comments)
        }));
        await tryEmail(() => sendEmail({
          to:      ENGINEERING_APPROVERS.didier.email,
          subject: `✅ EIR Fully Approved — ${report.reportNumber}`,
          html:    statusUpdateHtml(report, 'approved', comments)
        }));
      } else {
        // ── Activate next level ───────────────────────────────────────
        const nextLevel     = currentLevel + 1;
        const nextStepIndex = report.approvalChain.findIndex(s => s.level === nextLevel);

        if (nextStepIndex > -1) {
          report.approvalChain[nextStepIndex].assignedDate = new Date();
          report.currentApprovalLevel = nextLevel;
        }

        report.overallStatus = getStatusAfterApproval(currentLevel, totalLevels);
        report.reportStatus  = nextLevel === totalLevels ? 'Pending Final Approval' : 'Under Review';

        // Notify next approver
        const nextEmail    = getNotificationEmailForLevel(nextLevel);
        const nextApprover = getApproverForLevel(nextLevel);
        if (nextEmail && nextApprover) {
          await tryEmail(() => sendEmail({
            to:      nextEmail,
            subject: `🔧 Engineering Incident Report — Action Required (Level ${nextLevel}) [${report.reportNumber}]`,
            html:    approverNotificationHtml(report, nextApprover.name, nextLevel)
          }));
        }

        // Notify submitter that progress was made
        const submitter = await User.findById(report.submittedBy);
        if (submitter) {
          await tryEmail(() => sendEmail({
            to:      submitter.email,
            subject: `📋 Engineering Incident Report Update — ${report.reportNumber}`,
            html:    statusUpdateHtml(report, 'under review', `Level ${currentLevel} approved by ${step.approver.name}. Now pending level ${nextLevel} action.`)
          }));
        }
      }
    }

    await report.save();
    res.json({ success: true, message: `Report ${decision}`, data: report });
  } catch (err) {
    console.error('processApproval error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE SHARE LINK
// ─────────────────────────────────────────────────────────────────────────────
const generateShareLink = async (req, res) => {
  try {
    const user   = await User.findById(req.user.userId);
    const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    const isAdminLevel = ['admin', 'ceo'].includes(user.role);
    const isViewer     = canViewAllTechnicalReports(user.email);
    const isOwner      = report.submittedBy.toString() === req.user.userId;

    if (!isAdminLevel && !isViewer && !isOwner)
      return res.status(403).json({ success: false, message: 'Only approvers, admins, or the report owner can generate share links' });

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    report.publicShareToken     = token;
    report.publicShareExpiresAt = expiry;
    await report.save();

    const frontendBase = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');
    const shareLink    = `${frontendBase}/engineering-incidents/public/${token}`;

    res.json({ success: true, data: { shareLink, expiresAt: expiry, token } });
  } catch (err) {
    console.error('generateShareLink error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC VIEW (no auth)
// ─────────────────────────────────────────────────────────────────────────────
const getPublicReport = async (req, res) => {
  try {
    const report = await EngineeringIncidentReport.findOne({
      publicShareToken:     req.params.token,
      isDeleted:            false,
      publicShareExpiresAt: { $gt: new Date() }
    }).populate('submittedBy', 'fullName department');

    if (!report) return res.status(404).json({ success: false, message: 'Report not found or link expired' });

    const safe = report.toObject();
    delete safe.publicShareToken;
    delete safe.notificationsSent;

    res.json({ success: true, data: safe });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — PDF
// ─────────────────────────────────────────────────────────────────────────────
const exportPDF = async (req, res) => {
  try {
    const user   = await User.findById(req.user.userId);
    const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false })
      .populate('submittedBy', 'fullName email department position signature');
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    const isOwner      = report.submittedBy._id.toString() === req.user.userId;
    const isAdminLevel = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
    const isViewer     = canViewAllTechnicalReports(user.email);
    if (!isOwner && !isAdminLevel && !isViewer)
      return res.status(403).json({ success: false, message: 'Access denied' });

    const PDFService = require('../services/pdfService');
    const result     = await PDFService.generateEngineeringIncidentPDF(report);
    if (!result.success) return res.status(500).json({ success: false, message: 'PDF generation failed' });

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length':      result.buffer.length
    });
    res.send(result.buffer);
  } catch (err) {
    console.error('exportPDF error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — Excel
// ─────────────────────────────────────────────────────────────────────────────
const exportExcel = async (req, res) => {
  try {
    const user         = await User.findById(req.user.userId);
    const isAdminLevel = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
    const isViewer     = canViewAllTechnicalReports(user.email);
    if (!isAdminLevel && !isViewer)
      return res.status(403).json({ success: false, message: 'Access denied' });

    const { status, severity, startDate, endDate } = req.query;
    const query = { isDeleted: false };
    if (status   && status   !== 'all') query.overallStatus = status;
    if (severity && severity !== 'all') query.severity      = severity;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate)   query.createdAt.$lte = new Date(endDate);
    }

    const reports = await EngineeringIncidentReport.find(query)
      .populate('submittedBy', 'fullName email department')
      .sort({ createdAt: -1 })
      .lean();

    const rows = reports.map(r => ({
      'Report Number':          r.reportNumber || '',
      'Title':                  r.title || '',
      'Severity':               r.severity || '',
      'Incident Status':        r.incidentStatus || '',
      'Overall Status':         r.overallStatus || '',
      'SLA Status':             r.slaStatus || '',
      'Affected Site':          r.affectedSiteLocation || '',
      'Impact Level':           r.impactLevel || '',
      'Financial Impact':       r.financialImpact || '',
      'Reputational Risk':      r.reputationalRisk || '',
      'Root Cause Confirmed By':r.rootCauseConfirmedBy || '',
      'RCA Method':             r.rcaMethod || '',
      'Incident Start':         r.incidentStartDateTime ? new Date(r.incidentStartDateTime).toLocaleString('en-GB') : '',
      'Resolution Date':        r.resolutionDateTime    ? new Date(r.resolutionDateTime).toLocaleString('en-GB')    : '',
      'Prepared By':            r.preparedByName || '',
      'Reviewed By':            r.reviewedByName || '',
      'Approved By':            r.approvedByName || '',
      'Final Approved By':      r.finalApprovedByName || '',
      'Submitted By':           r.submittedBy?.fullName || '',
      'Department':             r.submittedBy?.department || '',
      'Submitted On':           r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB') : '',
      'Details Narrative':      (r.detailsNarrative || '').substring(0, 500),
      'Root Cause Description': (r.rootCauseDescription || '').substring(0, 500),
      'Recommendations':        (r.recommendationText || '').substring(0, 500)
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Engineering Incidents');
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 18) }));

    const buffer   = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `Engineering_Incidents_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      buffer.length
    });
    res.send(buffer);
  } catch (err) {
    console.error('exportExcel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────────────────────────────────────
const getDashboardStats = async (req, res) => {
  try {
    const user         = await User.findById(req.user.userId);
    const isAdminLevel = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
    const isViewer     = canViewAllTechnicalReports(user.email);

    const query = isAdminLevel || isViewer
      ? { isDeleted: false }
      : { isDeleted: false, submittedBy: req.user.userId };

    const [total, pending, approved, rejected, bySeverity] = await Promise.all([
      EngineeringIncidentReport.countDocuments(query),
      EngineeringIncidentReport.countDocuments({ ...query, overallStatus: { $in: ['pending_review', 'pending_approval', 'pending_final_approval', 'submitted'] } }),
      EngineeringIncidentReport.countDocuments({ ...query, overallStatus: 'approved' }),
      EngineeringIncidentReport.countDocuments({ ...query, overallStatus: 'rejected' }),
      EngineeringIncidentReport.aggregate([
        { $match: query },
        { $group: { _id: '$severity', count: { $sum: 1 } } }
      ])
    ]);

    res.json({ success: true, data: { total, pending, approved, rejected, bySeverity } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (soft)
// ─────────────────────────────────────────────────────────────────────────────
const deleteReport = async (req, res) => {
  try {
    const user   = await User.findById(req.user.userId);
    const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    const isOwner      = report.submittedBy.toString() === req.user.userId;
    const isAdminLevel = ['admin', 'ceo'].includes(user.role);
    const canDelete    = isAdminLevel || (isOwner && report.overallStatus === 'pending_review');
    if (!canDelete)
      return res.status(403).json({ success: false, message: 'Cannot delete a report that is already being reviewed' });

    report.isDeleted = true;
    report.deletedAt = new Date();
    await report.save();

    res.json({ success: true, message: 'Report deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createReport,
  updateReport,
  getReports,
  getReportById,
  processApproval,
  generateShareLink,
  getPublicReport,
  exportPDF,
  exportExcel,
  getDashboardStats,
  deleteReport
};












// 'use strict';
// // controllers/engineeringIncidentController.js
// // ─────────────────────────────────────────────────────────────────────────────

// const crypto   = require('crypto');
// const path     = require('path');
// const fs       = require('fs');
// const XLSX     = require('xlsx');

// const EngineeringIncidentReport = require('../models/EngineeringIncidentReport');
// const User                      = require('../models/User');
// const {
//   getEngineeringApprovalChain,
//   getStatusAfterApproval,
//   getNotificationEmailForLevel,
//   isEngineeringApprover,
//   canViewAllTechnicalReports,
//   ENGINEERING_APPROVERS
// } = require('../config/engineeringIncidentApprovalChain');
// const cloudinaryStorage = require('../utils/cloudinaryStorage');

// // ── Email helper (fire-and-forget) ────────────────────────────────────────────
// const tryEmail = async (fn) => { try { await fn(); } catch (e) { console.error('Email error:', e.message); } };

// // ── Inline email templates ────────────────────────────────────────────────────
// const sendEmail = (() => {
//   let _send;
//   return async (opts) => {
//     if (!_send) { try { const svc = require('../services/emailService'); _send = svc.sendEmail || svc.default; } catch (_) { _send = null; } }
//     if (_send) return _send(opts);
//   };
// })();

// const approverNotificationHtml = (report, approverName, level) => `
// <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
//   <div style="background:#1890ff;color:white;padding:20px;border-radius:8px 8px 0 0">
//     <h2 style="margin:0">Engineering Incident Report — Action Required</h2>
//   </div>
//   <div style="background:#f9f9f9;padding:20px;border:1px solid #ddd">
//     <p>Dear ${approverName},</p>
//     <p>An Engineering Incident Report has been submitted and requires your ${level === 1 ? 'review' : level === 2 ? 'approval' : 'HSE sign-off'}.</p>
//     <table style="width:100%;border-collapse:collapse;margin:16px 0">
//       <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Report Number:</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${report.reportNumber}</td></tr>
//       <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Title:</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${report.title}</td></tr>
//       <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Severity:</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${report.severity}</td></tr>
//       <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Affected Site:</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${report.affectedSiteLocation}</td></tr>
//       <tr><td style="padding:8px"><strong>Status:</strong></td><td style="padding:8px">${report.incidentStatus}</td></tr>
//     </table>
//     <div style="text-align:center;margin:24px 0">
//       <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/engineering-incidents/${report._id}/review"
//          style="background:#1890ff;color:white;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold">
//         Review &amp; Sign
//       </a>
//     </div>
//     <p style="color:#888;font-size:12px">This is an automated notification from Grato Engineering ERP.</p>
//   </div>
// </div>`;

// const submitterConfirmHtml = (report) => `
// <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
//   <div style="background:#52c41a;color:white;padding:20px;border-radius:8px 8px 0 0">
//     <h2 style="margin:0">✅ Engineering Incident Report Submitted</h2>
//   </div>
//   <div style="background:#f9f9f9;padding:20px;border:1px solid #ddd">
//     <p>Your Engineering Incident Report has been submitted successfully.</p>
//     <table style="width:100%;border-collapse:collapse;margin:16px 0">
//       <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Report Number:</strong></td><td style="padding:8px">${report.reportNumber}</td></tr>
//       <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Title:</strong></td><td style="padding:8px">${report.title}</td></tr>
//       <tr><td style="padding:8px"><strong>Next Step:</strong></td><td style="padding:8px">Awaiting review by ${ENGINEERING_APPROVERS.pascal.name}</td></tr>
//     </table>
//     <div style="text-align:center;margin:24px 0">
//       <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/employee/engineering-incident-reports"
//          style="background:#52c41a;color:white;padding:12px 28px;text-decoration:none;border-radius:6px">
//         Track Your Report
//       </a>
//     </div>
//   </div>
// </div>`;

// const statusUpdateHtml = (report, status, comments) => `
// <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
//   <div style="background:${status === 'approved' ? '#52c41a' : status === 'rejected' ? '#f5222d' : '#faad14'};color:white;padding:20px;border-radius:8px 8px 0 0">
//     <h2 style="margin:0">Engineering Incident Report — ${status.toUpperCase()}</h2>
//   </div>
//   <div style="background:#f9f9f9;padding:20px;border:1px solid #ddd">
//     <p>Report <strong>${report.reportNumber}</strong> has been <strong>${status}</strong>.</p>
//     ${comments ? `<p><strong>Comments:</strong> ${comments}</p>` : ''}
//     <div style="text-align:center;margin:24px 0">
//       <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/employee/engineering-incident-reports/${report._id}"
//          style="background:#1890ff;color:white;padding:12px 28px;text-decoration:none;border-radius:6px">
//         View Report
//       </a>
//     </div>
//   </div>
// </div>`;

// // ─────────────────────────────────────────────────────────────────────────────
// // CREATE — Technical dept employees only
// // ─────────────────────────────────────────────────────────────────────────────
// const createReport = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!user) return res.status(401).json({ success: false, message: 'User not found' });
//     if (user.department !== 'Technical' && user.role !== 'admin')
//       return res.status(403).json({ success: false, message: 'Only Technical department employees may submit this report' });

//     const body = req.body;

//     // Parse JSON fields sent via multipart
//     const parse = (field, fallback = null) => {
//       if (!body[field]) return fallback;
//       try { return typeof body[field] === 'string' ? JSON.parse(body[field]) : body[field]; }
//       catch { return body[field]; }
//     };

//     // Build structured action items from recommendation text if needed
//     let actionItems = parse('actionItems', []);
//     if (!Array.isArray(actionItems)) actionItems = [];

//     // Attachments from uploaded files
//     let attachments = [];
    
//       if (req.files && req.files.length > 0) {
//       for (const f of req.files) {
//         try {
//           console.log(`☁️  Uploading attachment to Cloudinary: ${f.originalname}`);

//           const result = await cloudinaryStorage.saveFile(
//             f,
//             'engineering-incidents', // category / folder
//             '',                       // subfolder
//             null                      // customFilename
//           );

//           attachments.push({
//             name:        f.originalname,
//             url:         result.url,          // Cloudinary HTTPS URL
//             publicId:    result.publicId,     // Cloudinary public_id (for deletion)
//             mimetype:    f.mimetype,
//             size:        f.size || f.buffer?.length || 0,
//             description: ''
//           });

//           console.log(`   ✅ Uploaded: ${result.url}`);
//         } catch (uploadErr) {
//           console.error(`❌ Failed to upload ${f.originalname}:`, uploadErr.message);
//           return res.status(500).json({
//             success: false,
//             message: `Failed to upload file: ${f.originalname} — ${uploadErr.message}`
//           });
//         }
//       }
//     }


//     // Parse evidence descriptions
//     const evidenceDescriptions = parse('evidenceDescriptions', []);

//     // Build approval chain
//     const approvalChain = getEngineeringApprovalChain();

//     const report = new EngineeringIncidentReport({
//       // Section 1
//       incidentId:            body.incidentId            || '',
//       title:                 body.title,
//       reportedDateTime:      new Date(body.reportedDateTime),
//       incidentStartDateTime: new Date(body.incidentStartDateTime),
//       resolutionDateTime:    body.resolutionDateTime ? new Date(body.resolutionDateTime) : undefined,
//       duration:              body.duration              || '',
//       severity:              body.severity,
//       incidentTypes:         parse('incidentTypes', []),
//       affectedSiteLocation:  body.affectedSiteLocation,
//       affectedServices:      body.affectedServices,
//       slaStatus:             body.slaStatus,
//       changeId:              body.changeId              || 'N/A',
//       existingProblemId:     body.existingProblemId     || 'N/A',
//       incidentStatus:        body.incidentStatus,
//       detailsNarrative:      body.detailsNarrative,
//       resolutionSummary:     body.resolutionSummary     || '',
//       // Section 2
//       impactLevel:           body.impactLevel,
//       impactAffectedServices: body.impactAffectedServices,
//       numberOfUsersAffected: body.numberOfUsersAffected || '',
//       financialImpact:       body.financialImpact,
//       regulatoryImpact:      body.regulatoryImpact,
//       reputationalRisk:      body.reputationalRisk,
//       impactDescription:     body.impactDescription     || '',
//       // Section 3
//       activityLog:           body.activityLog,
//       activityLogEntries:    parse('activityLogEntries', []),
//       // Section 4
//       initialObservation:    body.initialObservation,
//       systemsChecked:        body.systemsChecked        || '',
//       testsPerformed:        parse('testsPerformed', []),
//       initialConclusion:     parse('initialConclusion', []),
//       detailedFindings:      body.detailedFindings,
//       // Section 5
//       rcaMethod:             body.rcaMethod             || '',
//       rootCauseCategories:   parse('rootCauseCategories', []),
//       contributingFactors:   body.contributingFactors   || '',
//       rootCauseConfirmedBy:  body.rootCauseConfirmedBy,
//       rootCauseDescription:  body.rootCauseDescription,
//       // Section 6
//       logisticsChallenges:   body.logisticsChallenges,
//       securityAccessIssues:  body.securityAccessIssues,
//       sparePartsAvailability: body.sparePartsAvailability,
//       communicationIssues:   body.communicationIssues,
//       vendorDelays:          body.vendorDelays,
//       challengeDetails:      body.challengeDetails      || '',
//       // Section 7
//       recommendationText:    body.recommendationText,
//       actionItems,
//       additionalRecommendations: body.additionalRecommendations || '',
//       // Section 8
//       attachments,
//       evidenceDescriptions,
//       additionalAttachmentTypes: parse('additionalAttachmentTypes', []),
//       otherAttachmentsSpec:  body.otherAttachmentsSpec  || '',
//       // Section 9
//       preparedByName:        body.preparedByName || user.fullName,
//       preparedByDesignation: body.preparedByDesignation || user.position || '',
//       preparedByDate:        new Date(),
//       reviewedByName:        ENGINEERING_APPROVERS.pascal.name,
//       reviewedByDesignation: ENGINEERING_APPROVERS.pascal.designation,
//       approvedByName:        ENGINEERING_APPROVERS.didier.name,
//       approvedByDesignation: ENGINEERING_APPROVERS.didier.designation,
//       // Meta
//       submittedBy:           req.user.userId,
//       approvalChain,
//       currentApprovalLevel:  1,
//       overallStatus:         'pending_review',
//       reportStatus:          'Draft — awaiting review'
//     });

//     await report.save();

//     // ── Notify Pascal (level 1) ───────────────────────────────────────────
//     await tryEmail(() => sendEmail({
//       to:      ENGINEERING_APPROVERS.pascal.email,
//       subject: `🔧 Engineering Incident Report — Review Required [${report.reportNumber}]`,
//       html:    approverNotificationHtml(report, ENGINEERING_APPROVERS.pascal.name, 1)
//     }));

//     // ── Confirm to submitter ──────────────────────────────────────────────
//     await tryEmail(() => sendEmail({
//       to:      user.email,
//       subject: `✅ Engineering Incident Report Submitted — ${report.reportNumber}`,
//       html:    submitterConfirmHtml(report)
//     }));

//     report.notificationsSent = {
//       pascal:    { sent: true, sentAt: new Date(), email: ENGINEERING_APPROVERS.pascal.email },
//       submitter: { sent: true, sentAt: new Date(), email: user.email }
//     };
//     await report.save();

//     res.status(201).json({ success: true, message: 'Engineering Incident Report submitted successfully', data: report });
//   } catch (err) {
//     console.error('createReport error:', err);
//     res.status(500).json({ success: false, message: err.message || 'Failed to create report' });
//   }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // GET REPORTS — role-based
// // ─────────────────────────────────────────────────────────────────────────────
// const getReports = async (req, res) => {
//   try {
//     const user   = await User.findById(req.user.userId);
//     const { status, severity, page = 1, limit = 20 } = req.query;

//     let query = { isDeleted: false };

//     const isAdminLevel = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
//     const isDashboardViewer = canViewAllTechnicalReports(user.email);

//     if (isAdminLevel || isDashboardViewer) {
//       // See all Technical dept reports
//     } else {
//       // Regular Technical employee — see only their own
//       query.submittedBy = req.user.userId;
//     }

//     if (status && status !== 'all') query.overallStatus = status;
//     if (severity && severity !== 'all') query.severity = severity;

//     const total   = await EngineeringIncidentReport.countDocuments(query);
//     const reports = await EngineeringIncidentReport.find(query)
//       .populate('submittedBy', 'fullName email department position')
//       .sort({ createdAt: -1 })
//       .skip((+page - 1) * +limit)
//       .limit(+limit)
//       .lean();

//     res.json({
//       success: true,
//       data:    reports,
//       pagination: {
//         total,
//         page:  +page,
//         pages: Math.ceil(total / +limit),
//         limit: +limit
//       }
//     });
//   } catch (err) {
//     console.error('getReports error:', err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // GET SINGLE REPORT
// // ─────────────────────────────────────────────────────────────────────────────
// const getReportById = async (req, res) => {
//   try {
//     const report = await EngineeringIncidentReport.findOne({
//       _id: req.params.id, isDeleted: false
//     }).populate('submittedBy', 'fullName email department position');

//     if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

//     const user = await User.findById(req.user.userId);
//     const isOwner     = report.submittedBy._id.toString() === req.user.userId;
//     const isAdminLevel = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
//     const isViewer    = canViewAllTechnicalReports(user.email);

//     if (!isOwner && !isAdminLevel && !isViewer)
//       return res.status(403).json({ success: false, message: 'Access denied' });

//     res.json({ success: true, data: report });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // APPROVE / REJECT STEP
// // ─────────────────────────────────────────────────────────────────────────────
// const processApproval = async (req, res) => {
//   try {
//     const { decision, comments } = req.body;   // decision: 'approved' | 'rejected'
//     if (!['approved', 'rejected'].includes(decision))
//       return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });

//     const user   = await User.findById(req.user.userId);
//     const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false });
//     if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

//     // Find the pending step this user can action
//     const stepIndex = report.approvalChain.findIndex(
//       s => s.approver.email.toLowerCase() === user.email.toLowerCase() && s.status === 'pending'
//     );
//     if (stepIndex === -1)
//       return res.status(403).json({ success: false, message: 'You are not authorised to action this report, or it has already been processed' });

//     const step          = report.approvalChain[stepIndex];
//     step.status         = decision;
//     step.comments       = comments || '';
//     step.actionDate     = new Date();
//     step.actionTime     = new Date().toLocaleTimeString('en-GB');

//     // Attach signature from user profile if available
//     if (user.signature?.url) step.signatureUrl = user.signature.url;
//     else if (user.signature?.localPath) step.signatureUrl = user.signature.localPath;

//     if (decision === 'rejected') {
//       report.overallStatus = 'rejected';
//       report.reportStatus  = 'Rejected — revision required';
//       report.approverComments = comments || '';

//       // Notify submitter
//       const submitter = await User.findById(report.submittedBy);
//       if (submitter) {
//         await tryEmail(() => sendEmail({
//           to:      submitter.email,
//           subject: `❌ Engineering Incident Report Rejected — ${report.reportNumber}`,
//           html:    statusUpdateHtml(report, 'rejected', comments)
//         }));
//       }
//     } else {
//       // Move to next level
//       const totalLevels = report.approvalChain.length;
//       const currentLevel = step.level;

//       if (currentLevel >= totalLevels) {
//         // Fully approved
//         report.overallStatus = 'approved';
//         report.reportStatus  = 'Approved — final';

//         // Set approved dates on section 9 fields
//         if (step.role === 'reviewed_by')  { report.reviewedByDate = new Date(); }
//         if (step.role === 'approved_by')  { report.approvedByDate = new Date(); }

//         // Notify submitter
//         const submitter = await User.findById(report.submittedBy);
//         if (submitter) {
//           await tryEmail(() => sendEmail({
//             to:      submitter.email,
//             subject: `✅ Engineering Incident Report Fully Approved — ${report.reportNumber}`,
//             html:    statusUpdateHtml(report, 'approved', comments)
//           }));
//         }
//       } else {
//         // Activate next step
//         const nextStepIndex = report.approvalChain.findIndex(s => s.level === currentLevel + 1);
//         if (nextStepIndex > -1) {
//           report.approvalChain[nextStepIndex].assignedDate = new Date();
//           report.currentApprovalLevel = currentLevel + 1;
//         }
//         report.overallStatus = getStatusAfterApproval(currentLevel, totalLevels);
//         report.reportStatus  = 'Under Review';

//         // Set date fields
//         if (step.role === 'reviewed_by') report.reviewedByDate = new Date();
//         if (step.role === 'approved_by') report.approvedByDate = new Date();

//         // Notify next approver
//         const nextEmail = getNotificationEmailForLevel(currentLevel + 1);
//         if (nextEmail) {
//           const nextApprover = report.approvalChain[nextStepIndex]?.approver.name || 'Approver';
//           await tryEmail(() => sendEmail({
//             to:      nextEmail,
//             subject: `🔧 Engineering Incident Report — Action Required [${report.reportNumber}]`,
//             html:    approverNotificationHtml(report, nextApprover, currentLevel + 1)
//           }));
//         }
//       }
//     }

//     await report.save();
//     res.json({ success: true, message: `Report ${decision}`, data: report });
//   } catch (err) {
//     console.error('processApproval error:', err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// const generateShareLink = async (req, res) => {
//   try {
//     const crypto = require('crypto');
//     const User   = require('../models/User');
//     const EngineeringIncidentReport = require('../models/EngineeringIncidentReport');
//     const {
//       canViewAllTechnicalReports
//     } = require('../config/engineeringIncidentApprovalChain');
 
//     const user   = await User.findById(req.user.userId);
//     const report = await EngineeringIncidentReport.findOne({
//       _id: req.params.id, isDeleted: false
//     });
 
//     if (!report) {
//       return res.status(404).json({ success: false, message: 'Report not found' });
//     }
 
//     const isAdminLevel = ['admin', 'ceo'].includes(user.role);
//     const isViewer     = canViewAllTechnicalReports(user.email);
//     const isOwner      = report.submittedBy.toString() === req.user.userId;
 
//     if (!isAdminLevel && !isViewer && !isOwner) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only approvers, admins, or the report owner can generate share links'
//       });
//     }
 
//     // Generate token — valid 30 days
//     const token  = crypto.randomBytes(32).toString('hex');
//     const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
 
//     report.publicShareToken    = token;
//     report.publicShareExpiresAt = expiry;
//     await report.save();
 
//     // ── KEY FIX: use FRONTEND_URL, not CLIENT_URL / API base ──────────────
//     // FRONTEND_URL = https://hub.gratoglobal.com  (the React app)
//     // The React router will handle /engineering-incidents/public/:token
//     // and render the PublicEngineeringIncidentViewer page (see FIX 3 below).
//     const frontendBase = (
//       process.env.FRONTEND_URL ||
//       process.env.CLIENT_URL   ||
//       'http://localhost:3000'
//     ).replace(/\/$/, ''); // strip trailing slash
 
//     const shareLink = `${frontendBase}/engineering-incidents/public/${token}`;
 
//     return res.json({
//       success: true,
//       data: {
//         shareLink,
//         expiresAt: expiry,
//         token
//       }
//     });
//   } catch (err) {
//     console.error('generateShareLink error:', err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };


// // ─────────────────────────────────────────────────────────────────────────────
// // PUBLIC (no-auth) view via token
// // ─────────────────────────────────────────────────────────────────────────────
// const getPublicReport = async (req, res) => {
//   try {
//     const { token } = req.params;
//     const report = await EngineeringIncidentReport.findOne({
//       publicShareToken:    token,
//       isDeleted:           false,
//       publicShareExpiresAt: { $gt: new Date() }
//     }).populate('submittedBy', 'fullName department');

//     if (!report) return res.status(404).json({ success: false, message: 'Report not found or link expired' });

//     // Strip sensitive fields
//     const safe = report.toObject();
//     delete safe.publicShareToken;
//     delete safe.notificationsSent;

//     res.json({ success: true, data: safe });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // EXPORT — PDF
// // ─────────────────────────────────────────────────────────────────────────────
// const exportPDF = async (req, res) => {
//   try {
//     const user   = await User.findById(req.user.userId);
//     // const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false })
//     //   .populate('submittedBy', 'fullName email department position');
    
//     const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false })
//       .populate('submittedBy', 'fullName email department position signature');
//     if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

//     const isOwner     = report.submittedBy._id.toString() === req.user.userId;
//     const isAdminLevel = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
//     const isViewer    = canViewAllTechnicalReports(user.email);
//     if (!isOwner && !isAdminLevel && !isViewer)
//       return res.status(403).json({ success: false, message: 'Access denied' });

//     const PDFService = require('../services/pdfService');
//     const result     = await PDFService.generateEngineeringIncidentPDF(report);

//     if (!result.success) return res.status(500).json({ success: false, message: 'PDF generation failed' });

//     res.set({
//       'Content-Type':        'application/pdf',
//       'Content-Disposition': `attachment; filename="${result.filename}"`,
//       'Content-Length':      result.buffer.length
//     });
//     res.send(result.buffer);
//   } catch (err) {
//     console.error('exportPDF error:', err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // EXPORT — Excel (bulk list)
// // ─────────────────────────────────────────────────────────────────────────────
// const exportExcel = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const isAdminLevel = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
//     const isViewer     = canViewAllTechnicalReports(user.email);
//     if (!isAdminLevel && !isViewer)
//       return res.status(403).json({ success: false, message: 'Access denied' });

//     const { status, severity, startDate, endDate } = req.query;
//     const query = { isDeleted: false };
//     if (status   && status   !== 'all') query.overallStatus = status;
//     if (severity && severity !== 'all') query.severity      = severity;
//     if (startDate || endDate) {
//       query.createdAt = {};
//       if (startDate) query.createdAt.$gte = new Date(startDate);
//       if (endDate)   query.createdAt.$lte = new Date(endDate);
//     }

//     const reports = await EngineeringIncidentReport.find(query)
//       .populate('submittedBy', 'fullName email department')
//       .sort({ createdAt: -1 })
//       .lean();

//     // Build rows
//     const rows = reports.map(r => ({
//       'Report Number':         r.reportNumber || '',
//       'Title':                 r.title || '',
//       'Severity':              r.severity || '',
//       'Incident Status':       r.incidentStatus || '',
//       'Overall Status':        r.overallStatus || '',
//       'SLA Status':            r.slaStatus || '',
//       'Affected Site':         r.affectedSiteLocation || '',
//       'Impact Level':          r.impactLevel || '',
//       'Financial Impact':      r.financialImpact || '',
//       'Reputational Risk':     r.reputationalRisk || '',
//       'Root Cause Confirmed By': r.rootCauseConfirmedBy || '',
//       'RCA Method':            r.rcaMethod || '',
//       'Incident Start':        r.incidentStartDateTime ? new Date(r.incidentStartDateTime).toLocaleString('en-GB') : '',
//       'Resolution Date':       r.resolutionDateTime    ? new Date(r.resolutionDateTime).toLocaleString('en-GB')    : '',
//       'Prepared By':           r.preparedByName || '',
//       'Reviewed By':           r.reviewedByName || '',
//       'Approved By':           r.approvedByName || '',
//       'Submitted By':          r.submittedBy?.fullName || '',
//       'Department':            r.submittedBy?.department || '',
//       'Submitted On':          r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB') : '',
//       'Details Narrative':     (r.detailsNarrative || '').substring(0, 500),
//       'Root Cause Description':(r.rootCauseDescription || '').substring(0, 500),
//       'Recommendations':       (r.recommendationText || '').substring(0, 500)
//     }));

//     const ws  = XLSX.utils.json_to_sheet(rows);
//     const wb  = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, 'Engineering Incidents');

//     // Auto column widths
//     const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 18) }));
//     ws['!cols'] = colWidths;

//     const buffer   = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
//     const filename = `Engineering_Incidents_${new Date().toISOString().slice(0, 10)}.xlsx`;

//     res.set({
//       'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//       'Content-Disposition': `attachment; filename="${filename}"`,
//       'Content-Length':      buffer.length
//     });
//     res.send(buffer);
//   } catch (err) {
//     console.error('exportExcel error:', err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // DASHBOARD STATS
// // ─────────────────────────────────────────────────────────────────────────────
// const getDashboardStats = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const isAdminLevel = ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'].includes(user.role);
//     const isViewer     = canViewAllTechnicalReports(user.email);

//     const query = isAdminLevel || isViewer
//       ? { isDeleted: false }
//       : { isDeleted: false, submittedBy: req.user.userId };

//     const [total, pending, approved, rejected, bySeverity] = await Promise.all([
//       EngineeringIncidentReport.countDocuments(query),
//       EngineeringIncidentReport.countDocuments({ ...query, overallStatus: { $in: ['pending_review', 'pending_approval', 'pending_hse', 'submitted'] } }),
//       EngineeringIncidentReport.countDocuments({ ...query, overallStatus: 'approved' }),
//       EngineeringIncidentReport.countDocuments({ ...query, overallStatus: 'rejected' }),
//       EngineeringIncidentReport.aggregate([
//         { $match: query },
//         { $group: { _id: '$severity', count: { $sum: 1 } } }
//       ])
//     ]);

//     res.json({
//       success: true,
//       data:    { total, pending, approved, rejected, bySeverity }
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // DELETE (soft)
// // ─────────────────────────────────────────────────────────────────────────────
// const deleteReport = async (req, res) => {
//   try {
//     const user   = await User.findById(req.user.userId);
//     const report = await EngineeringIncidentReport.findOne({ _id: req.params.id, isDeleted: false });
//     if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

//     const isOwner     = report.submittedBy.toString() === req.user.userId;
//     const isAdminLevel = ['admin', 'ceo'].includes(user.role);
//     // Only allow deletion if pending_review (not yet actioned) or admin
//     const canDelete = isAdminLevel || (isOwner && report.overallStatus === 'pending_review');
//     if (!canDelete)
//       return res.status(403).json({ success: false, message: 'Cannot delete a report that is already being reviewed' });

//     report.isDeleted = true;
//     report.deletedAt = new Date();
//     await report.save();

//     res.json({ success: true, message: 'Report deleted' });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// module.exports = {
//   createReport,
//   getReports,
//   getReportById,
//   processApproval,
//   generateShareLink,
//   getPublicReport,
//   exportPDF,
//   exportExcel,
//   getDashboardStats,
//   deleteReport
// };

