// ═══════════════════════════════════════════════════════════════════════════
// FILE: controllers/documentSigningController.js
// ═══════════════════════════════════════════════════════════════════════════

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const SignableDocument = require('../models/SignableDocument');
const User = require('../models/User');
const { SharePointFile, SharePointFolder } = require('../models/SharePoint');
const { buildSignerChain, previewHierarchicalChain } = require('../config/documentSigningChain');
const { flattenSignedPDF, generatePreviewPDF, getPdfMetadata } = require('../services/pdfSigningService');
const emailSvc = require('../services/documentSigningEmailService');

const toObjectId = (id) => new mongoose.Types.ObjectId(id);

// Roles that bypass ownership/chain restrictions, matching EnhancedProtectedRoute
const OVERRIDE_ROLES = ['admin', 'it', 'ceo'];
const hasOverrideAuthority = (user) => OVERRIDE_ROLES.includes(user.role);

// ═══════════════════════════════════════════════════════════════════════════
// 1. UPLOAD — create a draft SignableDocument from an uploaded PDF
// ═══════════════════════════════════════════════════════════════════════════

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No PDF file provided' });
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ success: false, message: 'Only PDF files are supported for signing' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    // ── Read bytes ────────────────────────────────────────────────────────────
    // This route's multer instance uses memoryStorage (see documentSigningRoutes.js),
    // so req.file.path does NOT exist — only req.file.buffer does. We still check
    // req.file.path as a fallback in case the multer config is ever swapped to
    // diskStorage/Cloudinary elsewhere.
    let fileBytes;
    if (req.file.buffer) {
      fileBytes = req.file.buffer;
    } else if (req.file.path && fs.existsSync(req.file.path)) {
      fileBytes = fs.readFileSync(req.file.path);
    } else {
      return res.status(400).json({ success: false, message: 'Could not read uploaded file' });
    }

    let metadata;
    try {
      metadata = await getPdfMetadata(fileBytes);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'File is not a valid PDF', error: e.message });
    }

    // ── Persist the buffer to disk ───────────────────────────────────────────
    // We need a STABLE, web-fetchable path: the browser's PDF.js loader and the
    // backend's pdf-lib flattening step both need to read this file later, long
    // after this request has finished (req.file.buffer is gone by then).
    // This mirrors how app.js already serves /uploads as static files.
    const isAlreadyRemote = !!(req.file.path && req.file.path.startsWith('http'));
    let storedPath;
    let storageType;

    if (isAlreadyRemote) {
      // Multer config was swapped to Cloudinary elsewhere — use the URL as-is.
      storedPath = req.file.path;
      storageType = 'cloudinary';
    } else {
      const signingUploadsDir = path.join(__dirname, '..', 'uploads', 'e-signature-originals');
      if (!fs.existsSync(signingUploadsDir)) fs.mkdirSync(signingUploadsDir, { recursive: true });

      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const diskFilename = `${Date.now()}-${safeName}`;
      const diskPath = path.join(signingUploadsDir, diskFilename);
      fs.writeFileSync(diskPath, fileBytes);

      // Served via the existing app.use('/uploads', express.static(...)) mount in app.js.
      // BACKEND_URL should be your API origin (e.g. https://api.example.com or http://localhost:5000) —
      // NOT the frontend URL, since this is fetched directly by PDF.js in the browser.
      const backendBase = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
      storedPath = `${backendBase}/uploads/e-signature-originals/${diskFilename}`;
      storageType = 'local';
    }

    // ── Store original via SharePoint integration ───────────────────────────
    // Land it in a per-user "Pending Signatures" staging area within their
    // own department folder if one exists; otherwise fall back to a direct
    // SharePointFile record without a folder linkage (folderId is required
    // by the schema, so we lazily create a department staging folder).
    let stagingFolder = await SharePointFolder.findOne({
      name: `${user.department || 'General'} — E-Signature Documents`
    });

    if (!stagingFolder) {
      stagingFolder = await new SharePointFolder({
        name: `${user.department || 'General'} — E-Signature Documents`,
        description: 'Auto-created staging area for documents sent through the e-signature portal.',
        department: user.department || 'Company',
        privacyLevel: 'department',
        createdBy: user._id,
        accessControl: {
          allowedDepartments: user.department ? [user.department] : [],
          allowedUsers: [user._id],
          invitedUsers: [],
          blockedUsers: []
        }
      }).save();
    }

    const sharepointFile = await new SharePointFile({
      folderId: stagingFolder._id,
      name: req.file.originalname,
      description: 'Uploaded for e-signature processing',
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: storedPath,
      publicId: req.file.filename || req.file.public_id || null,
      storageType,
      uploadedBy: user._id,
      tags: ['e-signature', 'pending-signature']
    }).save();

    stagingFolder.fileCount += 1;
    stagingFolder.totalSize += req.file.size;
    stagingFolder.lastModified = new Date();
    await stagingFolder.save();

    const signableDoc = new SignableDocument({
      title: req.body.title || req.file.originalname.replace(/\.pdf$/i, ''),
      description: req.body.description || '',
      initiator: user._id,
      originalFile: {
        sharepointFileId: sharepointFile._id,
        name: req.file.originalname,
        path: storedPath,
        publicId: req.file.filename || req.file.public_id || null,
        storageType,
        size: req.file.size,
        pageCount: metadata.pageCount
      },
      status: 'draft',
      chainMode: 'hierarchical', // default; can be changed before submission
      signers: [],
      fields: []
    });

    signableDoc.addAudit('created', { byUser: user._id, meta: { pageCount: metadata.pageCount } });
    await signableDoc.save();

    // Hand back page dimensions too — the placement canvas needs these to
    // scale normalized coordinates correctly when rendering each page.
    res.status(201).json({
      success: true,
      message: 'PDF uploaded — ready for field placement',
      data: {
        document: signableDoc,
        pages: metadata.pages,
        defaultHierarchicalChain: previewHierarchicalChain(user.email)
      }
    });
  } catch (error) {
    console.error('uploadDocument error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload document', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. FIELD PLACEMENT — save/replace the full field list for a draft document
// ═══════════════════════════════════════════════════════════════════════════

const saveFields = async (req, res) => {
  try {
    const { fields } = req.body;
    if (!Array.isArray(fields)) {
      return res.status(400).json({ success: false, message: 'fields must be an array' });
    }

    const doc = await SignableDocument.findById(req.params.documentId);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (doc.initiator.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the initiator can edit field placement' });
    }
    if (doc.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot edit fields — document is ${doc.status}` });
    }

    // Basic shape validation per field
    for (const [i, f] of fields.entries()) {
      if (!f.page || f.x === undefined || f.y === undefined || !f.width || !f.height || !f.assignedSignerLevel) {
        return res.status(400).json({ success: false, message: `Field ${i + 1} is missing required properties` });
      }
      if (f.page > doc.originalFile.pageCount) {
        return res.status(400).json({ success: false, message: `Field ${i + 1} references page ${f.page}, but document only has ${doc.originalFile.pageCount} pages` });
      }
    }

    doc.fields = fields.map(f => ({
      page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
      type: f.type || 'signature',
      assignedSignerLevel: f.assignedSignerLevel,
      label: f.label || '',
      required: f.required !== false
    }));

    doc.addAudit('field_added', { byUser: req.user.userId, meta: { fieldCount: doc.fields.length } });
    await doc.save();

    res.json({ success: true, message: 'Fields saved', data: doc });
  } catch (error) {
    console.error('saveFields error:', error);
    res.status(500).json({ success: false, message: 'Failed to save fields', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. CHAIN CONFIGURATION — set chainMode + signer order before submission
// ═══════════════════════════════════════════════════════════════════════════

const configureChain = async (req, res) => {
  try {
    const { chainMode, signers } = req.body; // signers: [{ userId, isExtra }]

    const doc = await SignableDocument.findById(req.params.documentId);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (doc.initiator.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the initiator can configure the signing chain' });
    }
    if (doc.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Cannot configure chain — document is ${doc.status}` });
    }

    const initiator = await User.findById(req.user.userId);
    const result = await buildSignerChain({
      initiatorEmail: initiator.email,
      chainMode,
      requestedSigners: signers || []
    });

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }

    doc.chainMode = chainMode;
    doc.signers = result.signers;
    doc.addAudit('chain_built', { byUser: req.user.userId, meta: { chainMode, signerCount: result.signers.length } });
    await doc.save();

    res.json({ success: true, message: 'Signing chain configured', data: doc });
  } catch (error) {
    console.error('configureChain error:', error);
    res.status(500).json({ success: false, message: 'Failed to configure chain', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. SUBMIT — lock the document, notify the first signer
// ═══════════════════════════════════════════════════════════════════════════

const submitDocument = async (req, res) => {
  try {
    const doc = await SignableDocument.findById(req.params.documentId).populate('initiator', 'fullName email');
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (doc.initiator._id.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the initiator can submit this document' });
    }
    if (doc.status !== 'draft') {
      return res.status(400).json({ success: false, message: `Document already ${doc.status}` });
    }
    if (doc.signers.length === 0) {
      return res.status(400).json({ success: false, message: 'Configure the signing chain before submitting' });
    }

    const integrity = doc.validateChainIntegrity();
    if (!integrity.valid) {
      return res.status(400).json({ success: false, message: integrity.error });
    }

    doc.status = 'pending_signatures';
    doc.currentLevel = 1;
    doc.submittedAt = new Date();

    const firstSigner = doc.signers.find(s => s.level === 1);
    firstSigner.notifiedAt = new Date();

    doc.addAudit('submitted', { byUser: req.user.userId });
    doc.addAudit('signer_notified', { byUser: req.user.userId, meta: { level: 1, signerEmail: firstSigner.email } });
    await doc.save();

    emailSvc.sendSigningRequest(firstSigner, doc).catch(e => console.error('Failed to send signing email:', e.message));

    res.json({ success: true, message: 'Document submitted for signing', data: doc });
  } catch (error) {
    console.error('submitDocument error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit document', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. PUBLIC NO-LOGIN SIGNING ROUTES (token-based)
// ═══════════════════════════════════════════════════════════════════════════

/** Resolve + validate a signer's token. Shared by getSigningSession / signDocument / rejectDocument. */
const resolveSignerByToken = async (documentId, token) => {
  const doc = await SignableDocument.findById(documentId).populate('initiator', 'fullName email');
  if (!doc) return { error: 'Document not found', status: 404 };

  const signer = doc.signers.find(s => s.accessToken === token);
  if (!signer) return { error: 'Invalid or expired signing link', status: 404 };

  return { doc, signer };
};

/** GET /api/sign/:documentId/:token — fetch what this signer needs to see */
const getSigningSession = async (req, res) => {
  try {
    const { documentId, token } = req.params;
    const { doc, signer, error, status } = await resolveSignerByToken(documentId, token);
    if (error) return res.status(status).json({ success: false, message: error });

    if (doc.status === 'rejected') {
      return res.status(410).json({ success: false, message: 'This document was rejected and is no longer active.' });
    }
    if (doc.status === 'cancelled') {
      return res.status(410).json({ success: false, message: 'This document was cancelled by the initiator.' });
    }
    if (doc.status === 'completed') {
      return res.json({
        success: true,
        data: { documentTitle: doc.title, status: 'completed', message: 'This document has already been fully signed.' }
      });
    }
    if (signer.status === 'signed') {
      return res.json({
        success: true,
        data: { documentTitle: doc.title, status: 'already_signed', message: 'You have already signed this document.', signedAt: signer.signedAt }
      });
    }
    if (doc.currentLevel !== signer.level) {
      return res.json({
        success: true,
        data: {
          documentTitle: doc.title,
          status: 'not_your_turn',
          message: `Waiting on signer(s) ahead of you (currently level ${doc.currentLevel} of ${doc.signers.length}).`,
          yourLevel: signer.level,
          currentLevel: doc.currentLevel
        }
      });
    }

    doc.addAudit('viewed', { byEmail: signer.email, ipAddress: req.ip });
    await doc.save();

    res.json({
      success: true,
      data: {
        documentTitle: doc.title,
        description: doc.description,
        initiatorName: doc.initiator?.fullName,
        status: 'ready_to_sign',
        signer: { name: signer.name, level: signer.level, totalLevels: doc.signers.length },
        originalFile: { path: doc.originalFile.path, pageCount: doc.originalFile.pageCount },
        fields: doc.getFieldsForLevel(signer.level)
      }
    });
  } catch (error) {
    console.error('getSigningSession error:', error);
    res.status(500).json({ success: false, message: 'Failed to load signing session', error: error.message });
  }
};

/** POST /api/sign/:documentId/:token — submit filled field values, advance chain */
const signDocument = async (req, res) => {
  try {
    const { documentId, token } = req.params;
    const { filledFields } = req.body; // [{ fieldId, value }]

    const { doc, signer, error, status } = await resolveSignerByToken(documentId, token);
    if (error) return res.status(status).json({ success: false, message: error });

    if (doc.status !== 'pending_signatures') {
      return res.status(400).json({ success: false, message: `Document is ${doc.status} — cannot sign` });
    }
    if (doc.currentLevel !== signer.level) {
      return res.status(409).json({ success: false, message: 'It is not yet your turn to sign' });
    }
    if (signer.status !== 'pending') {
      return res.status(400).json({ success: false, message: `You have already ${signer.status} this document` });
    }

    const myFields = doc.getFieldsForLevel(signer.level);
    const requiredFieldIds = myFields.filter(f => f.required).map(f => f._id.toString());
    const providedIds = new Set((filledFields || []).map(f => f.fieldId));

    for (const reqId of requiredFieldIds) {
      if (!providedIds.has(reqId)) {
        return res.status(400).json({ success: false, message: 'All required fields must be filled before signing' });
      }
    }

    for (const ff of filledFields || []) {
      const field = doc.fields.find(f => f._id.toString() === ff.fieldId);
      if (!field || field.assignedSignerLevel !== signer.level) continue; // ignore fields not belonging to this signer
      field.value = ff.value;
      field.filledAt = new Date();
    }

    signer.status = 'signed';
    signer.signedAt = new Date();
    signer.ipAddress = req.ip;

    doc.addAudit('signed', { byEmail: signer.email, ipAddress: req.ip, meta: { level: signer.level } });

    const { completed, nextSigner } = doc.advanceToNextLevel();

    if (completed) {
      // ── Flatten and store the final signed PDF ────────────────────────────
      try {
        const flattenedBytes = await flattenSignedPDF(doc);
        const outputDir = path.join(__dirname, '..', 'uploads', 'signed-documents');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `signed_${doc._id}_${Date.now()}.pdf`);
        fs.writeFileSync(outputPath, flattenedBytes);

        // Store via SharePoint integration alongside the original
        const originalSPFile = await SharePointFile.findById(doc.originalFile.sharepointFileId);
        const finalSPFile = await new SharePointFile({
          folderId: originalSPFile ? originalSPFile.folderId : undefined,
          name: `SIGNED_${doc.originalFile.name}`,
          description: `Fully executed version of "${doc.title}"`,
          mimetype: 'application/pdf',
          size: flattenedBytes.length,
          path: outputPath,
          storageType: 'local',
          uploadedBy: doc.initiator,
          tags: ['e-signature', 'completed', 'final']
        }).save();

        doc.finalSignedFile = {
          sharepointFileId: finalSPFile._id,
          path: outputPath,
          storageType: 'local',
          generatedAt: new Date()
        };

        doc.addAudit('completed', { meta: { finalFileId: finalSPFile._id } });
      } catch (flattenErr) {
        console.error('PDF flattening failed:', flattenErr);
        // Don't fail the signing action itself — the signature was recorded;
        // flattening can be retried via an admin action if needed.
        doc.addAudit('completed', { meta: { flattenError: flattenErr.message } });
      }
    } else if (nextSigner) {
      nextSigner.notifiedAt = new Date();
      doc.addAudit('signer_notified', { meta: { level: nextSigner.level, signerEmail: nextSigner.email } });
    }

    await doc.save();

    // ── Notifications (fire-and-forget) ──────────────────────────────────────
    const initiator = await User.findById(doc.initiator);
    emailSvc.sendProgressUpdate(initiator.email, initiator.fullName, doc, signer).catch(e => console.error(e.message));

    if (completed) {
      emailSvc.sendCompletionNotice(initiator.email, initiator.fullName, doc).catch(e => console.error(e.message));
    } else if (nextSigner) {
      emailSvc.sendSigningRequest(nextSigner, doc).catch(e => console.error(e.message));
    }

    res.json({
      success: true,
      message: completed ? 'Document fully signed and completed' : 'Signature recorded — next signer notified',
      data: { completed, nextLevel: nextSigner?.level || null }
    });
  } catch (error) {
    console.error('signDocument error:', error);
    res.status(500).json({ success: false, message: 'Failed to record signature', error: error.message });
  }
};

/** POST /api/sign/:documentId/:token/reject — decline to sign, kill the chain */
const rejectDocument = async (req, res) => {
  try {
    const { documentId, token } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A rejection reason is required' });
    }

    const { doc, signer, error, status } = await resolveSignerByToken(documentId, token);
    if (error) return res.status(status).json({ success: false, message: error });

    if (doc.status !== 'pending_signatures') {
      return res.status(400).json({ success: false, message: `Document is ${doc.status} — cannot reject` });
    }
    if (doc.currentLevel !== signer.level) {
      return res.status(409).json({ success: false, message: 'It is not yet your turn in the chain' });
    }

    signer.status = 'rejected';
    signer.rejectedAt = new Date();
    signer.rejectionReason = reason.trim();
    signer.ipAddress = req.ip;

    doc.status = 'rejected';
    doc.rejectedBy = signer.user;
    doc.rejectedAt = new Date();
    doc.rejectionReason = reason.trim();

    doc.addAudit('rejected', { byEmail: signer.email, ipAddress: req.ip, meta: { level: signer.level, reason: reason.trim() } });
    await doc.save();

    const initiator = await User.findById(doc.initiator);
    emailSvc.sendRejectionNotice(initiator.email, initiator.fullName, doc, signer, reason.trim())
      .catch(e => console.error('Failed to send rejection email:', e.message));

    res.json({ success: true, message: 'Document rejected — the initiator has been notified' });
  } catch (error) {
    console.error('rejectDocument error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject document', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 6. RESUBMISSION — clone a rejected document into a fresh one
// ═══════════════════════════════════════════════════════════════════════════

const resubmitDocument = async (req, res) => {
  try {
    const original = await SignableDocument.findById(req.params.documentId);
    if (!original) return res.status(404).json({ success: false, message: 'Document not found' });
    if (original.initiator.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the initiator can resubmit this document' });
    }
    if (original.status !== 'rejected') {
      return res.status(400).json({ success: false, message: 'Only rejected documents can be resubmitted' });
    }

    // Clone as a new draft — original is left completely untouched for history.
    const clone = new SignableDocument({
      title: req.body.title || original.title,
      description: req.body.description || original.description,
      initiator: original.initiator,
      originalFile: original.originalFile, // reuse same uploaded PDF unless they re-upload separately
      status: 'draft',
      chainMode: original.chainMode,
      signers: [], // must be reconfigured — roles/availability may have changed
      fields: original.fields.map(f => ({ // carry over placement as a starting point
        page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
        type: f.type, assignedSignerLevel: f.assignedSignerLevel, label: f.label, required: f.required
      })),
      resubmittedFrom: original._id
    });

    clone.addAudit('resubmitted_from', { byUser: req.user.userId, meta: { originalId: original._id } });
    await clone.save();

    original.resubmittedAs = clone._id;
    original.addAudit('resubmitted_as', { byUser: req.user.userId, meta: { newId: clone._id } });
    await original.save();

    res.status(201).json({ success: true, message: 'New draft created from rejected document', data: clone });
  } catch (error) {
    console.error('resubmitDocument error:', error);
    res.status(500).json({ success: false, message: 'Failed to resubmit document', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 7. ADMIN / IT / CEO OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════

/** Force the current level to be marked signed by an admin, advancing the chain. */
const forceAdvance = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!hasOverrideAuthority(user)) {
      return res.status(403).json({ success: false, message: 'Only admin, IT, or CEO can force-advance a signing chain' });
    }

    const doc = await SignableDocument.findById(req.params.documentId).populate('initiator', 'fullName email');
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (doc.status !== 'pending_signatures') {
      return res.status(400).json({ success: false, message: `Cannot force-advance — document is ${doc.status}` });
    }

    const currentSigner = doc.getCurrentSigner();
    if (!currentSigner) return res.status(400).json({ success: false, message: 'No active signer found at current level' });

    currentSigner.status = 'signed';
    currentSigner.signedAt = new Date();
    currentSigner.forcedBy = user._id;
    currentSigner.forcedAt = new Date();

    doc.addAudit('forced_sign', { byUser: user._id, meta: { level: currentSigner.level, originalSignerEmail: currentSigner.email, reason: req.body.reason || '' } });

    const { completed, nextSigner } = doc.advanceToNextLevel();
    if (!completed && nextSigner) {
      nextSigner.notifiedAt = new Date();
      doc.addAudit('signer_notified', { meta: { level: nextSigner.level, signerEmail: nextSigner.email } });
    }
    await doc.save();

    emailSvc.sendOverrideNotice(doc.initiator.email, doc.initiator.fullName, doc, 'Force-advanced signature', user)
      .catch(e => console.error(e.message));

    if (completed) {
      try {
        const flattenedBytes = await flattenSignedPDF(doc);
        const outputDir = path.join(__dirname, '..', 'uploads', 'signed-documents');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `signed_${doc._id}_${Date.now()}.pdf`);
        fs.writeFileSync(outputPath, flattenedBytes);
        doc.finalSignedFile = { path: outputPath, storageType: 'local', generatedAt: new Date() };
        await doc.save();
      } catch (e) { console.error('Flatten on force-advance failed:', e.message); }
      emailSvc.sendCompletionNotice(doc.initiator.email, doc.initiator.fullName, doc).catch(e => console.error(e.message));
    } else if (nextSigner) {
      emailSvc.sendSigningRequest(nextSigner, doc).catch(e => console.error(e.message));
    }

    res.json({ success: true, message: 'Signer force-advanced', data: doc });
  } catch (error) {
    console.error('forceAdvance error:', error);
    res.status(500).json({ success: false, message: 'Failed to force-advance', error: error.message });
  }
};

/** Reassign the CURRENT pending signer to a different user (e.g. someone left the company). */
const reassignSigner = async (req, res) => {
  try {
    const { newUserId } = req.body;
    const user = await User.findById(req.user.userId);
    if (!hasOverrideAuthority(user)) {
      return res.status(403).json({ success: false, message: 'Only admin, IT, or CEO can reassign a signer' });
    }

    const doc = await SignableDocument.findById(req.params.documentId);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (doc.status !== 'pending_signatures') {
      return res.status(400).json({ success: false, message: `Cannot reassign — document is ${doc.status}` });
    }

    const currentSigner = doc.getCurrentSigner();
    if (!currentSigner) return res.status(400).json({ success: false, message: 'No active signer at current level' });

    const newUser = await User.findById(newUserId);
    if (!newUser || !newUser.isActive) return res.status(400).json({ success: false, message: 'Replacement user not found or inactive' });

    const originalUser = currentSigner.user;
    currentSigner.reassignedFrom = originalUser;
    currentSigner.user = newUser._id;
    currentSigner.name = newUser.fullName;
    currentSigner.email = newUser.email;
    currentSigner.role = newUser.position || newUser.role;
    currentSigner.department = newUser.department || '';
    currentSigner.accessToken = doc.generateSignerToken(); // invalidate old link
    currentSigner.notifiedAt = new Date();

    doc.addAudit('reassigned', { byUser: user._id, meta: { level: currentSigner.level, from: originalUser, to: newUser._id } });
    await doc.save();

    emailSvc.sendSigningRequest(currentSigner, doc).catch(e => console.error(e.message));

    res.json({ success: true, message: `Signer reassigned to ${newUser.fullName}`, data: doc });
  } catch (error) {
    console.error('reassignSigner error:', error);
    res.status(500).json({ success: false, message: 'Failed to reassign signer', error: error.message });
  }
};

const cancelDocument = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const doc = await SignableDocument.findById(req.params.documentId);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    const isInitiator = doc.initiator.toString() === req.user.userId;
    if (!isInitiator && !hasOverrideAuthority(user)) {
      return res.status(403).json({ success: false, message: 'No permission to cancel this document' });
    }
    if (!['draft', 'pending_signatures'].includes(doc.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel — document is already ${doc.status}` });
    }

    doc.status = 'cancelled';
    doc.cancelledAt = new Date();
    doc.addAudit('cancelled', { byUser: req.user.userId, meta: { reason: req.body.reason || '' } });
    await doc.save();

    res.json({ success: true, message: 'Document cancelled' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to cancel document', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 8. STANDARD CRUD / LISTING (authenticated app routes)
// ═══════════════════════════════════════════════════════════════════════════

const getMyDocuments = async (req, res) => {
  try {
    const { role: filterRole, status } = req.query; // filterRole: 'initiated' | 'to_sign' | 'all'
    const userId = toObjectId(req.user.userId);
    const user = await User.findById(req.user.userId);
    const query = { $or: [] };

    if (!filterRole || filterRole === 'all' || filterRole === 'initiated') {
      query.$or.push({ initiator: userId });
    }
    if (!filterRole || filterRole === 'all' || filterRole === 'to_sign') {
      query.$or.push({ 'signers.user': userId });
    }
    if (status) query.status = status;

    const docs = await SignableDocument.find(query)
      .populate('initiator', 'fullName email department')
      .sort({ createdAt: -1 });

    // ── Strip other people's access tokens ──────────────────────────────────
    // Without this, anyone who can see a document in this list (e.g. a fellow
    // signer, or an admin browsing "all") would also receive every OTHER
    // signer's no-login signing token in the same response — letting them
    // sign on someone else's behalf. Only the initiator and admin/IT/CEO see
    // tokens at all, and even then only because they need them for support
    // purposes; everyone else gets every token blanked out.
    const sanitized = docs.map(doc => {
      const docObj = doc.toObject();
      const isInitiator = docObj.initiator?._id?.toString() === req.user.userId;
      if (!isInitiator && !hasOverrideAuthority(user)) {
        docObj.signers = docObj.signers.map(s => ({ ...s, accessToken: undefined }));
      }
      return docObj;
    });

    res.json({ success: true, data: sanitized, count: sanitized.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch documents', error: error.message });
  }
};

/**
 * GET /api/document-signing/documents/:documentId/my-signing-link
 *
 * Lets a logged-in user who IS a signer on this document fetch their own
 * no-login signing URL on demand, without needing to dig up the original
 * email. Returns ONLY the caller's own token — never anyone else's, and
 * not at all if it isn't currently their turn (mirrors the same gating
 * logic as getSigningSession, so this can't be used to jump the queue).
 */
const getMySigningLink = async (req, res) => {
  try {
    const doc = await SignableDocument.findById(req.params.documentId);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    const mySigner = doc.signers.find(s => s.user.toString() === req.user.userId);
    if (!mySigner) {
      return res.status(403).json({ success: false, message: 'You are not a signer on this document' });
    }

    if (doc.status !== 'pending_signatures') {
      return res.status(400).json({
        success: false,
        message: `This document is ${doc.status} — there is nothing to sign right now.`
      });
    }

    res.json({
      success: true,
      data: {
        token: mySigner.accessToken,
        isYourTurn: doc.currentLevel === mySigner.level,
        yourLevel: mySigner.level,
        currentLevel: doc.currentLevel,
        signingUrl: `/sign/${doc._id}/${mySigner.accessToken}`
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch signing link', error: error.message });
  }
};

const getDocumentDetails = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const doc = await SignableDocument.findById(req.params.documentId)
      .populate('initiator', 'fullName email department')
      .populate('signers.user', 'fullName email department')
      .populate('auditTrail.byUser', 'fullName email');

    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    const isInitiator = doc.initiator._id.toString() === req.user.userId;
    const isSigner = doc.signers.some(s => s.user?._id?.toString() === req.user.userId);

    if (!isInitiator && !isSigner && !hasOverrideAuthority(user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Strip access tokens from the response unless the requester is the initiator/admin
    // (signers should only ever get their own token via email, not via this endpoint)
    const docObj = doc.toObject();
    if (!isInitiator && !hasOverrideAuthority(user)) {
      docObj.signers = docObj.signers.map(s => ({ ...s, accessToken: undefined }));
    }

    res.json({ success: true, data: docObj });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch document', error: error.message });
  }
};

const getHierarchicalChainPreview = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const chain = previewHierarchicalChain(user.email);
    res.json({ success: true, data: chain });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to preview chain', error: error.message });
  }
};

const downloadFinalDocument = async (req, res) => {
  try {
    const doc = await SignableDocument.findById(req.params.documentId);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (doc.status !== 'completed' || !doc.finalSignedFile?.path) {
      return res.status(400).json({ success: false, message: 'Final signed PDF is not yet available' });
    }

    doc.addAudit('downloaded', { byUser: req.user.userId });
    await doc.save();

    if (doc.finalSignedFile.storageType === 'cloudinary') {
      return res.redirect(doc.finalSignedFile.path);
    }
    if (!fs.existsSync(doc.finalSignedFile.path)) {
      return res.status(404).json({ success: false, message: 'Signed file not found on disk' });
    }
    res.download(doc.finalSignedFile.path, `SIGNED_${doc.title}.pdf`);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to download document', error: error.message });
  }
};

module.exports = {
  uploadDocument,
  saveFields,
  configureChain,
  submitDocument,
  getSigningSession,
  signDocument,
  rejectDocument,
  resubmitDocument,
  forceAdvance,
  reassignSigner,
  cancelDocument,
  getMyDocuments,
  getMySigningLink,
  getDocumentDetails,
  getHierarchicalChainPreview,
  downloadFinalDocument
};










// // ═══════════════════════════════════════════════════════════════════════════
// // FILE: controllers/documentSigningController.js
// // ═══════════════════════════════════════════════════════════════════════════

// const mongoose = require('mongoose');
// const fs = require('fs');
// const path = require('path');
// const SignableDocument = require('../models/SignableDocument');
// const User = require('../models/User');
// const { SharePointFile, SharePointFolder } = require('../models/SharePoint');
// const { buildSignerChain, previewHierarchicalChain } = require('../config/documentSigningChain');
// const { flattenSignedPDF, generatePreviewPDF, getPdfMetadata } = require('../services/pdfSigningService');
// const emailSvc = require('../services/documentSigningEmailService');

// const toObjectId = (id) => new mongoose.Types.ObjectId(id);

// // Roles that bypass ownership/chain restrictions, matching EnhancedProtectedRoute
// const OVERRIDE_ROLES = ['admin', 'it', 'ceo'];
// const hasOverrideAuthority = (user) => OVERRIDE_ROLES.includes(user.role);

// // ═══════════════════════════════════════════════════════════════════════════
// // 1. UPLOAD — create a draft SignableDocument from an uploaded PDF
// // ═══════════════════════════════════════════════════════════════════════════

// const uploadDocument = async (req, res) => {
//   try {
//     if (!req.file) return res.status(400).json({ success: false, message: 'No PDF file provided' });
//     if (req.file.mimetype !== 'application/pdf') {
//       return res.status(400).json({ success: false, message: 'Only PDF files are supported for signing' });
//     }

//     const user = await User.findById(req.user.userId);
//     if (!user) return res.status(401).json({ success: false, message: 'User not found' });

//     // ── Read bytes ────────────────────────────────────────────────────────────
//     // This route's multer instance uses memoryStorage (see documentSigningRoutes.js),
//     // so req.file.path does NOT exist — only req.file.buffer does. We still check
//     // req.file.path as a fallback in case the multer config is ever swapped to
//     // diskStorage/Cloudinary elsewhere.
//     let fileBytes;
//     if (req.file.buffer) {
//       fileBytes = req.file.buffer;
//     } else if (req.file.path && fs.existsSync(req.file.path)) {
//       fileBytes = fs.readFileSync(req.file.path);
//     } else {
//       return res.status(400).json({ success: false, message: 'Could not read uploaded file' });
//     }

//     let metadata;
//     try {
//       metadata = await getPdfMetadata(fileBytes);
//     } catch (e) {
//       return res.status(400).json({ success: false, message: 'File is not a valid PDF', error: e.message });
//     }

//     // ── Persist the buffer to disk ───────────────────────────────────────────
//     // We need a STABLE, web-fetchable path: the browser's PDF.js loader and the
//     // backend's pdf-lib flattening step both need to read this file later, long
//     // after this request has finished (req.file.buffer is gone by then).
//     // This mirrors how app.js already serves /uploads as static files.
//     const isAlreadyRemote = !!(req.file.path && req.file.path.startsWith('http'));
//     let storedPath;
//     let storageType;

//     if (isAlreadyRemote) {
//       // Multer config was swapped to Cloudinary elsewhere — use the URL as-is.
//       storedPath = req.file.path;
//       storageType = 'cloudinary';
//     } else {
//       const signingUploadsDir = path.join(__dirname, '..', 'uploads', 'e-signature-originals');
//       if (!fs.existsSync(signingUploadsDir)) fs.mkdirSync(signingUploadsDir, { recursive: true });

//       const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
//       const diskFilename = `${Date.now()}-${safeName}`;
//       const diskPath = path.join(signingUploadsDir, diskFilename);
//       fs.writeFileSync(diskPath, fileBytes);

//       // Served via the existing app.use('/uploads', express.static(...)) mount in app.js.
//       // BACKEND_URL should be your API origin (e.g. https://api.example.com or http://localhost:5000) —
//       // NOT the frontend URL, since this is fetched directly by PDF.js in the browser.
//       const backendBase = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
//       storedPath = `${backendBase}/uploads/e-signature-originals/${diskFilename}`;
//       storageType = 'local';
//     }

//     // ── Store original via SharePoint integration ───────────────────────────
//     // Land it in a per-user "Pending Signatures" staging area within their
//     // own department folder if one exists; otherwise fall back to a direct
//     // SharePointFile record without a folder linkage (folderId is required
//     // by the schema, so we lazily create a department staging folder).
//     let stagingFolder = await SharePointFolder.findOne({
//       name: `${user.department || 'General'} — E-Signature Documents`
//     });

//     if (!stagingFolder) {
//       stagingFolder = await new SharePointFolder({
//         name: `${user.department || 'General'} — E-Signature Documents`,
//         description: 'Auto-created staging area for documents sent through the e-signature portal.',
//         department: user.department || 'Company',
//         privacyLevel: 'department',
//         createdBy: user._id,
//         accessControl: {
//           allowedDepartments: user.department ? [user.department] : [],
//           allowedUsers: [user._id],
//           invitedUsers: [],
//           blockedUsers: []
//         }
//       }).save();
//     }

//     const sharepointFile = await new SharePointFile({
//       folderId: stagingFolder._id,
//       name: req.file.originalname,
//       description: 'Uploaded for e-signature processing',
//       mimetype: req.file.mimetype,
//       size: req.file.size,
//       path: storedPath,
//       publicId: req.file.filename || req.file.public_id || null,
//       storageType,
//       uploadedBy: user._id,
//       tags: ['e-signature', 'pending-signature']
//     }).save();

//     stagingFolder.fileCount += 1;
//     stagingFolder.totalSize += req.file.size;
//     stagingFolder.lastModified = new Date();
//     await stagingFolder.save();

//     const signableDoc = new SignableDocument({
//       title: req.body.title || req.file.originalname.replace(/\.pdf$/i, ''),
//       description: req.body.description || '',
//       initiator: user._id,
//       originalFile: {
//         sharepointFileId: sharepointFile._id,
//         name: req.file.originalname,
//         path: storedPath,
//         publicId: req.file.filename || req.file.public_id || null,
//         storageType,
//         size: req.file.size,
//         pageCount: metadata.pageCount
//       },
//       status: 'draft',
//       chainMode: 'hierarchical', // default; can be changed before submission
//       signers: [],
//       fields: []
//     });

//     signableDoc.addAudit('created', { byUser: user._id, meta: { pageCount: metadata.pageCount } });
//     await signableDoc.save();

//     // Hand back page dimensions too — the placement canvas needs these to
//     // scale normalized coordinates correctly when rendering each page.
//     res.status(201).json({
//       success: true,
//       message: 'PDF uploaded — ready for field placement',
//       data: {
//         document: signableDoc,
//         pages: metadata.pages,
//         defaultHierarchicalChain: previewHierarchicalChain(user.email)
//       }
//     });
//   } catch (error) {
//     console.error('uploadDocument error:', error);
//     res.status(500).json({ success: false, message: 'Failed to upload document', error: error.message });
//   }
// };

// // ═══════════════════════════════════════════════════════════════════════════
// // 2. FIELD PLACEMENT — save/replace the full field list for a draft document
// // ═══════════════════════════════════════════════════════════════════════════

// const saveFields = async (req, res) => {
//   try {
//     const { fields } = req.body;
//     if (!Array.isArray(fields)) {
//       return res.status(400).json({ success: false, message: 'fields must be an array' });
//     }

//     const doc = await SignableDocument.findById(req.params.documentId);
//     if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
//     if (doc.initiator.toString() !== req.user.userId) {
//       return res.status(403).json({ success: false, message: 'Only the initiator can edit field placement' });
//     }
//     if (doc.status !== 'draft') {
//       return res.status(400).json({ success: false, message: `Cannot edit fields — document is ${doc.status}` });
//     }

//     // Basic shape validation per field
//     for (const [i, f] of fields.entries()) {
//       if (!f.page || f.x === undefined || f.y === undefined || !f.width || !f.height || !f.assignedSignerLevel) {
//         return res.status(400).json({ success: false, message: `Field ${i + 1} is missing required properties` });
//       }
//       if (f.page > doc.originalFile.pageCount) {
//         return res.status(400).json({ success: false, message: `Field ${i + 1} references page ${f.page}, but document only has ${doc.originalFile.pageCount} pages` });
//       }
//     }

//     doc.fields = fields.map(f => ({
//       page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
//       type: f.type || 'signature',
//       assignedSignerLevel: f.assignedSignerLevel,
//       label: f.label || '',
//       required: f.required !== false
//     }));

//     doc.addAudit('field_added', { byUser: req.user.userId, meta: { fieldCount: doc.fields.length } });
//     await doc.save();

//     res.json({ success: true, message: 'Fields saved', data: doc });
//   } catch (error) {
//     console.error('saveFields error:', error);
//     res.status(500).json({ success: false, message: 'Failed to save fields', error: error.message });
//   }
// };

// // ═══════════════════════════════════════════════════════════════════════════
// // 3. CHAIN CONFIGURATION — set chainMode + signer order before submission
// // ═══════════════════════════════════════════════════════════════════════════

// const configureChain = async (req, res) => {
//   try {
//     const { chainMode, signers } = req.body; // signers: [{ userId, isExtra }]

//     const doc = await SignableDocument.findById(req.params.documentId);
//     if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
//     if (doc.initiator.toString() !== req.user.userId) {
//       return res.status(403).json({ success: false, message: 'Only the initiator can configure the signing chain' });
//     }
//     if (doc.status !== 'draft') {
//       return res.status(400).json({ success: false, message: `Cannot configure chain — document is ${doc.status}` });
//     }

//     const initiator = await User.findById(req.user.userId);
//     const result = await buildSignerChain({
//       initiatorEmail: initiator.email,
//       chainMode,
//       requestedSigners: signers || []
//     });

//     if (!result.success) {
//       return res.status(400).json({ success: false, message: result.error });
//     }

//     doc.chainMode = chainMode;
//     doc.signers = result.signers;
//     doc.addAudit('chain_built', { byUser: req.user.userId, meta: { chainMode, signerCount: result.signers.length } });
//     await doc.save();

//     res.json({ success: true, message: 'Signing chain configured', data: doc });
//   } catch (error) {
//     console.error('configureChain error:', error);
//     res.status(500).json({ success: false, message: 'Failed to configure chain', error: error.message });
//   }
// };

// // ═══════════════════════════════════════════════════════════════════════════
// // 4. SUBMIT — lock the document, notify the first signer
// // ═══════════════════════════════════════════════════════════════════════════

// const submitDocument = async (req, res) => {
//   try {
//     const doc = await SignableDocument.findById(req.params.documentId).populate('initiator', 'fullName email');
//     if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
//     if (doc.initiator._id.toString() !== req.user.userId) {
//       return res.status(403).json({ success: false, message: 'Only the initiator can submit this document' });
//     }
//     if (doc.status !== 'draft') {
//       return res.status(400).json({ success: false, message: `Document already ${doc.status}` });
//     }
//     if (doc.signers.length === 0) {
//       return res.status(400).json({ success: false, message: 'Configure the signing chain before submitting' });
//     }

//     const integrity = doc.validateChainIntegrity();
//     if (!integrity.valid) {
//       return res.status(400).json({ success: false, message: integrity.error });
//     }

//     doc.status = 'pending_signatures';
//     doc.currentLevel = 1;
//     doc.submittedAt = new Date();

//     const firstSigner = doc.signers.find(s => s.level === 1);
//     firstSigner.notifiedAt = new Date();

//     doc.addAudit('submitted', { byUser: req.user.userId });
//     doc.addAudit('signer_notified', { byUser: req.user.userId, meta: { level: 1, signerEmail: firstSigner.email } });
//     await doc.save();

//     emailSvc.sendSigningRequest(firstSigner, doc).catch(e => console.error('Failed to send signing email:', e.message));

//     res.json({ success: true, message: 'Document submitted for signing', data: doc });
//   } catch (error) {
//     console.error('submitDocument error:', error);
//     res.status(500).json({ success: false, message: 'Failed to submit document', error: error.message });
//   }
// };

// // ═══════════════════════════════════════════════════════════════════════════
// // 5. PUBLIC NO-LOGIN SIGNING ROUTES (token-based)
// // ═══════════════════════════════════════════════════════════════════════════

// /** Resolve + validate a signer's token. Shared by getSigningSession / signDocument / rejectDocument. */
// const resolveSignerByToken = async (documentId, token) => {
//   const doc = await SignableDocument.findById(documentId).populate('initiator', 'fullName email');
//   if (!doc) return { error: 'Document not found', status: 404 };

//   const signer = doc.signers.find(s => s.accessToken === token);
//   if (!signer) return { error: 'Invalid or expired signing link', status: 404 };

//   return { doc, signer };
// };

// /** GET /api/sign/:documentId/:token — fetch what this signer needs to see */
// const getSigningSession = async (req, res) => {
//   try {
//     const { documentId, token } = req.params;
//     const { doc, signer, error, status } = await resolveSignerByToken(documentId, token);
//     if (error) return res.status(status).json({ success: false, message: error });

//     if (doc.status === 'rejected') {
//       return res.status(410).json({ success: false, message: 'This document was rejected and is no longer active.' });
//     }
//     if (doc.status === 'cancelled') {
//       return res.status(410).json({ success: false, message: 'This document was cancelled by the initiator.' });
//     }
//     if (doc.status === 'completed') {
//       return res.json({
//         success: true,
//         data: { documentTitle: doc.title, status: 'completed', message: 'This document has already been fully signed.' }
//       });
//     }
//     if (signer.status === 'signed') {
//       return res.json({
//         success: true,
//         data: { documentTitle: doc.title, status: 'already_signed', message: 'You have already signed this document.', signedAt: signer.signedAt }
//       });
//     }
//     if (doc.currentLevel !== signer.level) {
//       return res.json({
//         success: true,
//         data: {
//           documentTitle: doc.title,
//           status: 'not_your_turn',
//           message: `Waiting on signer(s) ahead of you (currently level ${doc.currentLevel} of ${doc.signers.length}).`,
//           yourLevel: signer.level,
//           currentLevel: doc.currentLevel
//         }
//       });
//     }

//     doc.addAudit('viewed', { byEmail: signer.email, ipAddress: req.ip });
//     await doc.save();

//     res.json({
//       success: true,
//       data: {
//         documentTitle: doc.title,
//         description: doc.description,
//         initiatorName: doc.initiator?.fullName,
//         status: 'ready_to_sign',
//         signer: { name: signer.name, level: signer.level, totalLevels: doc.signers.length },
//         originalFile: { path: doc.originalFile.path, pageCount: doc.originalFile.pageCount },
//         fields: doc.getFieldsForLevel(signer.level)
//       }
//     });
//   } catch (error) {
//     console.error('getSigningSession error:', error);
//     res.status(500).json({ success: false, message: 'Failed to load signing session', error: error.message });
//   }
// };

// /** POST /api/sign/:documentId/:token — submit filled field values, advance chain */
// const signDocument = async (req, res) => {
//   try {
//     const { documentId, token } = req.params;
//     const { filledFields } = req.body; // [{ fieldId, value }]

//     const { doc, signer, error, status } = await resolveSignerByToken(documentId, token);
//     if (error) return res.status(status).json({ success: false, message: error });

//     if (doc.status !== 'pending_signatures') {
//       return res.status(400).json({ success: false, message: `Document is ${doc.status} — cannot sign` });
//     }
//     if (doc.currentLevel !== signer.level) {
//       return res.status(409).json({ success: false, message: 'It is not yet your turn to sign' });
//     }
//     if (signer.status !== 'pending') {
//       return res.status(400).json({ success: false, message: `You have already ${signer.status} this document` });
//     }

//     const myFields = doc.getFieldsForLevel(signer.level);
//     const requiredFieldIds = myFields.filter(f => f.required).map(f => f._id.toString());
//     const providedIds = new Set((filledFields || []).map(f => f.fieldId));

//     for (const reqId of requiredFieldIds) {
//       if (!providedIds.has(reqId)) {
//         return res.status(400).json({ success: false, message: 'All required fields must be filled before signing' });
//       }
//     }

//     for (const ff of filledFields || []) {
//       const field = doc.fields.find(f => f._id.toString() === ff.fieldId);
//       if (!field || field.assignedSignerLevel !== signer.level) continue; // ignore fields not belonging to this signer
//       field.value = ff.value;
//       field.filledAt = new Date();
//     }

//     signer.status = 'signed';
//     signer.signedAt = new Date();
//     signer.ipAddress = req.ip;

//     doc.addAudit('signed', { byEmail: signer.email, ipAddress: req.ip, meta: { level: signer.level } });

//     const { completed, nextSigner } = doc.advanceToNextLevel();

//     if (completed) {
//       // ── Flatten and store the final signed PDF ────────────────────────────
//       try {
//         const flattenedBytes = await flattenSignedPDF(doc);
//         const outputDir = path.join(__dirname, '..', 'uploads', 'signed-documents');
//         if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
//         const outputPath = path.join(outputDir, `signed_${doc._id}_${Date.now()}.pdf`);
//         fs.writeFileSync(outputPath, flattenedBytes);

//         // Store via SharePoint integration alongside the original
//         const originalSPFile = await SharePointFile.findById(doc.originalFile.sharepointFileId);
//         const finalSPFile = await new SharePointFile({
//           folderId: originalSPFile ? originalSPFile.folderId : undefined,
//           name: `SIGNED_${doc.originalFile.name}`,
//           description: `Fully executed version of "${doc.title}"`,
//           mimetype: 'application/pdf',
//           size: flattenedBytes.length,
//           path: outputPath,
//           storageType: 'local',
//           uploadedBy: doc.initiator,
//           tags: ['e-signature', 'completed', 'final']
//         }).save();

//         doc.finalSignedFile = {
//           sharepointFileId: finalSPFile._id,
//           path: outputPath,
//           storageType: 'local',
//           generatedAt: new Date()
//         };

//         doc.addAudit('completed', { meta: { finalFileId: finalSPFile._id } });
//       } catch (flattenErr) {
//         console.error('PDF flattening failed:', flattenErr);
//         // Don't fail the signing action itself — the signature was recorded;
//         // flattening can be retried via an admin action if needed.
//         doc.addAudit('completed', { meta: { flattenError: flattenErr.message } });
//       }
//     } else if (nextSigner) {
//       nextSigner.notifiedAt = new Date();
//       doc.addAudit('signer_notified', { meta: { level: nextSigner.level, signerEmail: nextSigner.email } });
//     }

//     await doc.save();

//     // ── Notifications (fire-and-forget) ──────────────────────────────────────
//     const initiator = await User.findById(doc.initiator);
//     emailSvc.sendProgressUpdate(initiator.email, initiator.fullName, doc, signer).catch(e => console.error(e.message));

//     if (completed) {
//       emailSvc.sendCompletionNotice(initiator.email, initiator.fullName, doc).catch(e => console.error(e.message));
//     } else if (nextSigner) {
//       emailSvc.sendSigningRequest(nextSigner, doc).catch(e => console.error(e.message));
//     }

//     res.json({
//       success: true,
//       message: completed ? 'Document fully signed and completed' : 'Signature recorded — next signer notified',
//       data: { completed, nextLevel: nextSigner?.level || null }
//     });
//   } catch (error) {
//     console.error('signDocument error:', error);
//     res.status(500).json({ success: false, message: 'Failed to record signature', error: error.message });
//   }
// };

// /** POST /api/sign/:documentId/:token/reject — decline to sign, kill the chain */
// const rejectDocument = async (req, res) => {
//   try {
//     const { documentId, token } = req.params;
//     const { reason } = req.body;
//     if (!reason || !reason.trim()) {
//       return res.status(400).json({ success: false, message: 'A rejection reason is required' });
//     }

//     const { doc, signer, error, status } = await resolveSignerByToken(documentId, token);
//     if (error) return res.status(status).json({ success: false, message: error });

//     if (doc.status !== 'pending_signatures') {
//       return res.status(400).json({ success: false, message: `Document is ${doc.status} — cannot reject` });
//     }
//     if (doc.currentLevel !== signer.level) {
//       return res.status(409).json({ success: false, message: 'It is not yet your turn in the chain' });
//     }

//     signer.status = 'rejected';
//     signer.rejectedAt = new Date();
//     signer.rejectionReason = reason.trim();
//     signer.ipAddress = req.ip;

//     doc.status = 'rejected';
//     doc.rejectedBy = signer.user;
//     doc.rejectedAt = new Date();
//     doc.rejectionReason = reason.trim();

//     doc.addAudit('rejected', { byEmail: signer.email, ipAddress: req.ip, meta: { level: signer.level, reason: reason.trim() } });
//     await doc.save();

//     const initiator = await User.findById(doc.initiator);
//     emailSvc.sendRejectionNotice(initiator.email, initiator.fullName, doc, signer, reason.trim())
//       .catch(e => console.error('Failed to send rejection email:', e.message));

//     res.json({ success: true, message: 'Document rejected — the initiator has been notified' });
//   } catch (error) {
//     console.error('rejectDocument error:', error);
//     res.status(500).json({ success: false, message: 'Failed to reject document', error: error.message });
//   }
// };

// // ═══════════════════════════════════════════════════════════════════════════
// // 6. RESUBMISSION — clone a rejected document into a fresh one
// // ═══════════════════════════════════════════════════════════════════════════

// const resubmitDocument = async (req, res) => {
//   try {
//     const original = await SignableDocument.findById(req.params.documentId);
//     if (!original) return res.status(404).json({ success: false, message: 'Document not found' });
//     if (original.initiator.toString() !== req.user.userId) {
//       return res.status(403).json({ success: false, message: 'Only the initiator can resubmit this document' });
//     }
//     if (original.status !== 'rejected') {
//       return res.status(400).json({ success: false, message: 'Only rejected documents can be resubmitted' });
//     }

//     // Clone as a new draft — original is left completely untouched for history.
//     const clone = new SignableDocument({
//       title: req.body.title || original.title,
//       description: req.body.description || original.description,
//       initiator: original.initiator,
//       originalFile: original.originalFile, // reuse same uploaded PDF unless they re-upload separately
//       status: 'draft',
//       chainMode: original.chainMode,
//       signers: [], // must be reconfigured — roles/availability may have changed
//       fields: original.fields.map(f => ({ // carry over placement as a starting point
//         page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
//         type: f.type, assignedSignerLevel: f.assignedSignerLevel, label: f.label, required: f.required
//       })),
//       resubmittedFrom: original._id
//     });

//     clone.addAudit('resubmitted_from', { byUser: req.user.userId, meta: { originalId: original._id } });
//     await clone.save();

//     original.resubmittedAs = clone._id;
//     original.addAudit('resubmitted_as', { byUser: req.user.userId, meta: { newId: clone._id } });
//     await original.save();

//     res.status(201).json({ success: true, message: 'New draft created from rejected document', data: clone });
//   } catch (error) {
//     console.error('resubmitDocument error:', error);
//     res.status(500).json({ success: false, message: 'Failed to resubmit document', error: error.message });
//   }
// };

// // ═══════════════════════════════════════════════════════════════════════════
// // 7. ADMIN / IT / CEO OVERRIDES
// // ═══════════════════════════════════════════════════════════════════════════

// /** Force the current level to be marked signed by an admin, advancing the chain. */
// const forceAdvance = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!hasOverrideAuthority(user)) {
//       return res.status(403).json({ success: false, message: 'Only admin, IT, or CEO can force-advance a signing chain' });
//     }

//     const doc = await SignableDocument.findById(req.params.documentId).populate('initiator', 'fullName email');
//     if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
//     if (doc.status !== 'pending_signatures') {
//       return res.status(400).json({ success: false, message: `Cannot force-advance — document is ${doc.status}` });
//     }

//     const currentSigner = doc.getCurrentSigner();
//     if (!currentSigner) return res.status(400).json({ success: false, message: 'No active signer found at current level' });

//     currentSigner.status = 'signed';
//     currentSigner.signedAt = new Date();
//     currentSigner.forcedBy = user._id;
//     currentSigner.forcedAt = new Date();

//     doc.addAudit('forced_sign', { byUser: user._id, meta: { level: currentSigner.level, originalSignerEmail: currentSigner.email, reason: req.body.reason || '' } });

//     const { completed, nextSigner } = doc.advanceToNextLevel();
//     if (!completed && nextSigner) {
//       nextSigner.notifiedAt = new Date();
//       doc.addAudit('signer_notified', { meta: { level: nextSigner.level, signerEmail: nextSigner.email } });
//     }
//     await doc.save();

//     emailSvc.sendOverrideNotice(doc.initiator.email, doc.initiator.fullName, doc, 'Force-advanced signature', user)
//       .catch(e => console.error(e.message));

//     if (completed) {
//       try {
//         const flattenedBytes = await flattenSignedPDF(doc);
//         const outputDir = path.join(__dirname, '..', 'uploads', 'signed-documents');
//         if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
//         const outputPath = path.join(outputDir, `signed_${doc._id}_${Date.now()}.pdf`);
//         fs.writeFileSync(outputPath, flattenedBytes);
//         doc.finalSignedFile = { path: outputPath, storageType: 'local', generatedAt: new Date() };
//         await doc.save();
//       } catch (e) { console.error('Flatten on force-advance failed:', e.message); }
//       emailSvc.sendCompletionNotice(doc.initiator.email, doc.initiator.fullName, doc).catch(e => console.error(e.message));
//     } else if (nextSigner) {
//       emailSvc.sendSigningRequest(nextSigner, doc).catch(e => console.error(e.message));
//     }

//     res.json({ success: true, message: 'Signer force-advanced', data: doc });
//   } catch (error) {
//     console.error('forceAdvance error:', error);
//     res.status(500).json({ success: false, message: 'Failed to force-advance', error: error.message });
//   }
// };

// /** Reassign the CURRENT pending signer to a different user (e.g. someone left the company). */
// const reassignSigner = async (req, res) => {
//   try {
//     const { newUserId } = req.body;
//     const user = await User.findById(req.user.userId);
//     if (!hasOverrideAuthority(user)) {
//       return res.status(403).json({ success: false, message: 'Only admin, IT, or CEO can reassign a signer' });
//     }

//     const doc = await SignableDocument.findById(req.params.documentId);
//     if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
//     if (doc.status !== 'pending_signatures') {
//       return res.status(400).json({ success: false, message: `Cannot reassign — document is ${doc.status}` });
//     }

//     const currentSigner = doc.getCurrentSigner();
//     if (!currentSigner) return res.status(400).json({ success: false, message: 'No active signer at current level' });

//     const newUser = await User.findById(newUserId);
//     if (!newUser || !newUser.isActive) return res.status(400).json({ success: false, message: 'Replacement user not found or inactive' });

//     const originalUser = currentSigner.user;
//     currentSigner.reassignedFrom = originalUser;
//     currentSigner.user = newUser._id;
//     currentSigner.name = newUser.fullName;
//     currentSigner.email = newUser.email;
//     currentSigner.role = newUser.position || newUser.role;
//     currentSigner.department = newUser.department || '';
//     currentSigner.accessToken = doc.generateSignerToken(); // invalidate old link
//     currentSigner.notifiedAt = new Date();

//     doc.addAudit('reassigned', { byUser: user._id, meta: { level: currentSigner.level, from: originalUser, to: newUser._id } });
//     await doc.save();

//     emailSvc.sendSigningRequest(currentSigner, doc).catch(e => console.error(e.message));

//     res.json({ success: true, message: `Signer reassigned to ${newUser.fullName}`, data: doc });
//   } catch (error) {
//     console.error('reassignSigner error:', error);
//     res.status(500).json({ success: false, message: 'Failed to reassign signer', error: error.message });
//   }
// };

// const cancelDocument = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const doc = await SignableDocument.findById(req.params.documentId);
//     if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

//     const isInitiator = doc.initiator.toString() === req.user.userId;
//     if (!isInitiator && !hasOverrideAuthority(user)) {
//       return res.status(403).json({ success: false, message: 'No permission to cancel this document' });
//     }
//     if (!['draft', 'pending_signatures'].includes(doc.status)) {
//       return res.status(400).json({ success: false, message: `Cannot cancel — document is already ${doc.status}` });
//     }

//     doc.status = 'cancelled';
//     doc.cancelledAt = new Date();
//     doc.addAudit('cancelled', { byUser: req.user.userId, meta: { reason: req.body.reason || '' } });
//     await doc.save();

//     res.json({ success: true, message: 'Document cancelled' });
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Failed to cancel document', error: error.message });
//   }
// };

// // ═══════════════════════════════════════════════════════════════════════════
// // 8. STANDARD CRUD / LISTING (authenticated app routes)
// // ═══════════════════════════════════════════════════════════════════════════

// const getMyDocuments = async (req, res) => {
//   try {
//     const { role: filterRole, status } = req.query; // filterRole: 'initiated' | 'to_sign' | 'all'
//     const userId = toObjectId(req.user.userId);
//     const query = { $or: [] };

//     if (!filterRole || filterRole === 'all' || filterRole === 'initiated') {
//       query.$or.push({ initiator: userId });
//     }
//     if (!filterRole || filterRole === 'all' || filterRole === 'to_sign') {
//       query.$or.push({ 'signers.user': userId });
//     }
//     if (status) query.status = status;

//     const docs = await SignableDocument.find(query)
//       .populate('initiator', 'fullName email department')
//       .sort({ createdAt: -1 });

//     res.json({ success: true, data: docs, count: docs.length });
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Failed to fetch documents', error: error.message });
//   }
// };

// const getDocumentDetails = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const doc = await SignableDocument.findById(req.params.documentId)
//       .populate('initiator', 'fullName email department')
//       .populate('signers.user', 'fullName email department')
//       .populate('auditTrail.byUser', 'fullName email');

//     if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

//     const isInitiator = doc.initiator._id.toString() === req.user.userId;
//     const isSigner = doc.signers.some(s => s.user?._id?.toString() === req.user.userId);

//     if (!isInitiator && !isSigner && !hasOverrideAuthority(user)) {
//       return res.status(403).json({ success: false, message: 'Access denied' });
//     }

//     // Strip access tokens from the response unless the requester is the initiator/admin
//     // (signers should only ever get their own token via email, not via this endpoint)
//     const docObj = doc.toObject();
//     if (!isInitiator && !hasOverrideAuthority(user)) {
//       docObj.signers = docObj.signers.map(s => ({ ...s, accessToken: undefined }));
//     }

//     res.json({ success: true, data: docObj });
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Failed to fetch document', error: error.message });
//   }
// };

// const getHierarchicalChainPreview = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const chain = previewHierarchicalChain(user.email);
//     res.json({ success: true, data: chain });
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Failed to preview chain', error: error.message });
//   }
// };

// const downloadFinalDocument = async (req, res) => {
//   try {
//     const doc = await SignableDocument.findById(req.params.documentId);
//     if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
//     if (doc.status !== 'completed' || !doc.finalSignedFile?.path) {
//       return res.status(400).json({ success: false, message: 'Final signed PDF is not yet available' });
//     }

//     doc.addAudit('downloaded', { byUser: req.user.userId });
//     await doc.save();

//     if (doc.finalSignedFile.storageType === 'cloudinary') {
//       return res.redirect(doc.finalSignedFile.path);
//     }
//     if (!fs.existsSync(doc.finalSignedFile.path)) {
//       return res.status(404).json({ success: false, message: 'Signed file not found on disk' });
//     }
//     res.download(doc.finalSignedFile.path, `SIGNED_${doc.title}.pdf`);
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Failed to download document', error: error.message });
//   }
// };

// module.exports = {
//   uploadDocument,
//   saveFields,
//   configureChain,
//   submitDocument,
//   getSigningSession,
//   signDocument,
//   rejectDocument,
//   resubmitDocument,
//   forceAdvance,
//   reassignSigner,
//   cancelDocument,
//   getMyDocuments,
//   getDocumentDetails,
//   getHierarchicalChainPreview,
//   downloadFinalDocument
// };