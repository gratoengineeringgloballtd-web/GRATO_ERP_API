// controllers/tenderController.js
const mongoose = require('mongoose');
const Tender   = require('../models/Tender');
const RFQ      = require('../models/RFQ');
const Quote    = require('../models/Quote');
const User     = require('../models/User');
const { sendEmail } = require('../services/emailService');

// Reuse the same 3-level PO approval chain config
const { getPOApprovalChain } = require('../config/poApprovalChain');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const generateTenderNumber = async () => {
  const count = await Tender.countDocuments();
  return `GESPT${String(count + 1).padStart(2, '0')}`;
};

const authorise = (user) =>
  user && (
    ['buyer', 'supply_chain', 'admin'].includes(user.role) ||
    user.departmentRole === 'buyer'
  );

// Build the 3-step approval chain from poApprovalChain config.
// We pass the requester's department so Level 1 resolves to the right dept head.
const buildTenderApprovalChain = (department) => {
  const chain = getPOApprovalChain(department || 'IT');
  return chain.map((step, i) => ({
    level:    step.level,
    approver: {
      name:       step.approver,
      email:      step.email,
      role:       step.role,
      department: step.department
    },
    status:        'pending',
    activatedDate: i === 0 ? new Date() : null,
    notificationSent: false
  }));
};

// ─────────────────────────────────────────────
// GET /api/tenders
// ─────────────────────────────────────────────
exports.getTenders = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!authorise(user))
      return res.status(403).json({ success: false, message: 'Access denied' });

    const { status, search, page = 1, limit = 30 } = req.query;
    const query = {};

    if (user.role === 'buyer' || user.departmentRole === 'buyer')
      query.createdBy = req.user.userId;

    if (status) query.status = status;
    if (search) {
      query.$or = [
        { tenderNumber:  { $regex: search, $options: 'i' } },
        { title:         { $regex: search, $options: 'i' } },
        { requesterName: { $regex: search, $options: 'i' } }
      ];
    }

    const [tenders, total] = await Promise.all([
      Tender.find(query)
        .populate('requisitionId', 'title requisitionNumber')
        .populate('rfqId',         'rfqNumber title')
        .populate('purchaseOrderId','poNumber status')
        .populate('createdBy',     'fullName')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit)),
      Tender.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: tenders,
      pagination: {
        current:      parseInt(page),
        total:        Math.ceil(total / parseInt(limit)),
        totalRecords: total
      }
    });
  } catch (err) {
    console.error('getTenders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch tenders', error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/tenders/rfqs-available
// ─────────────────────────────────────────────
exports.getAvailableRFQsForTender = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!authorise(user))
      return res.status(403).json({ success: false, message: 'Access denied' });

    const tenderedRFQIds = (await Tender.find({ rfqId: { $exists: true, $ne: null } }).select('rfqId'))
      .map(t => t.rfqId?.toString()).filter(Boolean);

    const rfqIdsWithQuotes = await Quote.distinct('rfqId');
    const available = rfqIdsWithQuotes.filter(id => !tenderedRFQIds.includes(id.toString()));

    const rfqQuery = { _id: { $in: available } };
    if (user.role === 'buyer' || user.departmentRole === 'buyer')
      rfqQuery.buyerId = req.user.userId;

    const rfqs = await RFQ.find(rfqQuery)
      .populate('requisitionId', 'title requisitionNumber itemCategory department')
      .populate('buyerId', 'fullName');

    const enriched = await Promise.all(rfqs.map(async rfq => {
      const quoteCount = await Quote.countDocuments({ rfqId: rfq._id });
      return {
        id:               rfq._id,
        rfqNumber:        rfq.rfqNumber,
        title:            rfq.title,
        requisitionTitle: rfq.requisitionId?.title,
        itemCategory:     rfq.requisitionId?.itemCategory,
        department:       rfq.requisitionId?.department,
        quoteCount,
        responseDeadline:    rfq.responseDeadline,
        expectedDeliveryDate:rfq.expectedDeliveryDate,
        paymentTerms:        rfq.paymentTerms,
        deliveryLocation:    rfq.deliveryLocation,
        specialRequirements: rfq.specialRequirements
      };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('getAvailableRFQsForTender:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch RFQs', error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/tenders/:tenderId
// ─────────────────────────────────────────────
exports.getTenderById = async (req, res) => {
  try {
    const tender = await Tender.findById(req.params.tenderId)
      .populate('requisitionId', 'title requisitionNumber department employee')
      .populate('rfqId',         'rfqNumber title')
      .populate('createdBy',     'fullName email')
      .populate('purchaseOrderId', 'poNumber status totalAmount')
      .populate('approvalChain.decidedBy', 'fullName email signature');

    if (!tender)
      return res.status(404).json({ success: false, message: 'Tender not found' });

    res.json({ success: true, data: tender });
  } catch (err) {
    console.error('getTenderById:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch tender', error: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /api/tenders/from-rfq/:rfqId
// ─────────────────────────────────────────────
exports.createTenderFromRFQ = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!authorise(user))
      return res.status(403).json({ success: false, message: 'Access denied' });

    const { rfqId } = req.params;
    const {
      awardedSupplierName, awardedSupplierId,
      budget, costSavings, costAvoidance,
      deliveryTerms, paymentTerms, warranty, commercialTerms,
      technicalRecommendation, procurementRecommendation
    } = req.body;

    const rfq = await RFQ.findById(rfqId)
      .populate('requisitionId', 'title requisitionNumber department itemCategory expectedDate employee')
      .populate('buyerId', 'fullName email department');

    if (!rfq)
      return res.status(404).json({ success: false, message: 'RFQ not found' });

    const quotes = await Quote.find({ rfqId })
      .populate('supplierId', 'fullName email supplierDetails');

    if (quotes.length === 0)
      return res.status(400).json({
        success: false,
        message: 'No supplier quotes found for this RFQ. Suppliers must submit quotes before a tender can be created.'
      });

    const supplierQuotes = quotes.map(q => ({
      supplierId:           q.supplierId?._id,
      supplierName:         q.supplierId?.supplierDetails?.companyName || q.supplierId?.fullName || 'Unknown',
      supplierEmail:        q.supplierId?.email || '',
      items:                (q.items || []).map(item => ({
        description:    item.description,
        quantity:       item.quantity,
        unitPrice:      item.unitPrice  || 0,
        totalAmount:    item.totalPrice || (item.quantity * (item.unitPrice || 0)),
        negotiatedTotal:item.totalPrice || (item.quantity * (item.unitPrice || 0))
      })),
      grandTotal:           q.totalAmount || 0,
      negotiatedGrandTotal: q.totalAmount || 0,
      deliveryTerms: q.deliveryTerms || '',
      paymentTerms:  q.paymentTerms  || '',
      warranty:      q.warranty      || '',
      notes:         q.supplierNotes || ''
    }));

    const requisition  = rfq.requisitionId;
    const department   = rfq.buyerId?.department || requisition?.department || 'IT';
    const tenderNumber = await generateTenderNumber();

    const tender = new Tender({
      tenderNumber,
      source:        'rfq',
      rfqId:         rfq._id,
      requisitionId: requisition?._id,
      title:         rfq.title || requisition?.title || 'Tender',
      itemCategory:  requisition?.itemCategory || '',
      date:          new Date(),
      requiredDate:  rfq.expectedDeliveryDate || requisition?.expectedDate,
      requesterName:       rfq.buyerId?.fullName || user.fullName,
      requesterDepartment: department,
      commercialTerms:     commercialTerms || rfq.specialRequirements || '',
      supplierQuotes,
      deliveryTerms:  deliveryTerms || '',
      paymentTerms:   paymentTerms  || rfq.paymentTerms || '',
      warranty:       warranty      || '',
      awardedSupplierId:   awardedSupplierId   || null,
      awardedSupplierName: awardedSupplierName || '',
      budget:       Number(budget)        || 0,
      costSavings:  Number(costSavings)   || 0,
      costAvoidance:Number(costAvoidance) || 0,
      technicalRecommendation:   technicalRecommendation   || '',
      procurementRecommendation: procurementRecommendation || '',
      status:    'draft',
      createdBy: req.user.userId
    });

    await tender.save();
    res.status(201).json({ success: true, message: 'Tender created from RFQ', data: tender });
  } catch (err) {
    console.error('createTenderFromRFQ:', err);
    if (err.name === 'ValidationError')
      return res.status(400).json({ success: false, message: 'Validation failed', error: err.message });
    res.status(500).json({ success: false, message: 'Failed to create tender', error: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /api/tenders/manual
// ─────────────────────────────────────────────
exports.createTenderManually = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!authorise(user))
      return res.status(403).json({ success: false, message: 'Access denied' });

    const {
      title, itemCategory, requiredDate,
      requesterName, requesterDepartment, commercialTerms,
      supplierQuotes,
      deliveryTerms, paymentTerms, warranty,
      awardedSupplierName, awardedSupplierId,
      budget, costSavings, costAvoidance,
      technicalRecommendation, procurementRecommendation,
      requisitionId
    } = req.body;

    if (!title)        return res.status(400).json({ success: false, message: 'Title is required' });
    if (!requesterName)return res.status(400).json({ success: false, message: 'Requester name is required' });
    if (!supplierQuotes || supplierQuotes.length === 0)
      return res.status(400).json({ success: false, message: 'At least one supplier quote is required' });

    const tenderNumber = await generateTenderNumber();

    const tender = new Tender({
      tenderNumber,
      source:       'manual',
      requisitionId:requisitionId || undefined,
      title,
      itemCategory: itemCategory || '',
      date:         new Date(),
      requiredDate: requiredDate ? new Date(requiredDate) : undefined,
      requesterName,
      requesterDepartment: requesterDepartment || '',
      commercialTerms:     commercialTerms     || '',
      supplierQuotes: supplierQuotes.map(sq => ({
        supplierId:           sq.supplierId  || undefined,
        supplierName:         sq.supplierName,
        supplierEmail:        sq.supplierEmail || '',
        items: (sq.items || []).map(item => ({
          description:    item.description,
          quantity:       Number(item.quantity)        || 0,
          unitPrice:      Number(item.unitPrice)       || 0,
          totalAmount:    Number(item.totalAmount)     || 0,
          negotiatedTotal:Number(item.negotiatedTotal) || 0
        })),
        grandTotal:           Number(sq.grandTotal)           || 0,
        negotiatedGrandTotal: Number(sq.negotiatedGrandTotal) || 0,
        deliveryTerms: sq.deliveryTerms || '',
        paymentTerms:  sq.paymentTerms  || '',
        warranty:      sq.warranty      || '',
        notes:         sq.notes         || ''
      })),
      deliveryTerms,
      paymentTerms,
      warranty,
      awardedSupplierId:   awardedSupplierId   || undefined,
      awardedSupplierName: awardedSupplierName || '',
      budget:       Number(budget)        || 0,
      costSavings:  Number(costSavings)   || 0,
      costAvoidance:Number(costAvoidance) || 0,
      technicalRecommendation:   technicalRecommendation   || '',
      procurementRecommendation: procurementRecommendation || '',
      status:    'draft',
      createdBy: req.user.userId
    });

    await tender.save();
    res.status(201).json({ success: true, message: 'Tender created', data: tender });
  } catch (err) {
    console.error('createTenderManually:', err);
    if (err.name === 'ValidationError')
      return res.status(400).json({ success: false, message: 'Validation failed', error: err.message });
    res.status(500).json({ success: false, message: 'Failed to create tender', error: err.message });
  }
};

// ─────────────────────────────────────────────
// PUT /api/tenders/:tenderId
// ─────────────────────────────────────────────
exports.updateTender = async (req, res) => {
  try {
    const tender = await Tender.findById(req.params.tenderId);
    if (!tender)
      return res.status(404).json({ success: false, message: 'Tender not found' });
    if (tender.status !== 'draft')
      return res.status(400).json({ success: false, message: 'Only draft tenders can be edited' });

    const allowed = [
      'title','itemCategory','requiredDate','requesterName','requesterDepartment',
      'commercialTerms','supplierQuotes','deliveryTerms','paymentTerms','warranty',
      'awardedSupplierName','awardedSupplierId','budget','costSavings','costAvoidance',
      'technicalRecommendation','procurementRecommendation'
    ];
    allowed.forEach(key => { if (req.body[key] !== undefined) tender[key] = req.body[key]; });
    await tender.save();

    res.json({ success: true, message: 'Tender updated', data: tender });
  } catch (err) {
    console.error('updateTender:', err);
    res.status(500).json({ success: false, message: 'Failed to update tender', error: err.message });
  }
};

// ─────────────────────────────────────────────
// PATCH /api/tenders/:tenderId/status
// KEY LOGIC: when moving to pending_approval → build approval chain + notify L1
// when a direct approve/reject is sent (admin) → shortcut through chain
// ─────────────────────────────────────────────
exports.updateTenderStatus = async (req, res) => {
  try {
    const { status, department } = req.body;
    const validStatuses = ['draft','pending_approval','approved','rejected','awarded'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ success: false, message: `Invalid status: ${status}` });

    const tender = await Tender.findById(req.params.tenderId);
    if (!tender)
      return res.status(404).json({ success: false, message: 'Tender not found' });

    // ── Draft → Pending Approval: build the 3-level chain ──────────────────
    if (status === 'pending_approval' && tender.status === 'draft') {
      const dept = department || tender.requesterDepartment || 'IT';
      try {
        const chain = buildTenderApprovalChain(dept);
        tender.approvalChain        = chain;
        tender.currentApprovalLevel = 1;
      } catch (chainErr) {
        console.error('Chain build error:', chainErr.message);
        // Fallback: still set pending_approval even if chain lookup fails
        tender.approvalChain        = [];
        tender.currentApprovalLevel = 0;
      }

      tender.status = 'pending_approval';
      await tender.save();

      // Notify Level-1 approver
      if (tender.approvalChain.length > 0) {
        const step1 = tender.approvalChain.find(s => s.level === 1);
        if (step1) await _notifyApprover(tender, step1);
      }

      return res.json({
        success: true,
        message: 'Tender submitted for approval',
        data: tender
      });
    }

    // ── Admin shortcut approve/reject ──────────────────────────────────────
    tender.status = status;
    if (status === 'approved' || status === 'rejected') {
      // Mark every pending step as the new status
      (tender.approvalChain || []).forEach(step => {
        if (step.status === 'pending') {
          step.status     = status;
          step.actionDate = new Date();
          step.actionTime = new Date().toTimeString().split(' ')[0];
        }
      });
    }
    await tender.save();

    res.json({ success: true, message: `Tender status updated to ${status}`, data: tender });
  } catch (err) {
    console.error('updateTenderStatus:', err);
    res.status(500).json({ success: false, message: 'Failed to update status', error: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /api/tenders/:tenderId/approve
// Individual approver processes their step
// ─────────────────────────────────────────────
exports.processTenderApproval = async (req, res) => {
  try {
    const { decision, comments } = req.body;   // decision: 'approved' | 'rejected'
    if (!['approved','rejected'].includes(decision))
      return res.status(400).json({ success: false, message: "Decision must be 'approved' or 'rejected'" });

    const tender = await Tender.findById(req.params.tenderId);
    if (!tender)
      return res.status(404).json({ success: false, message: 'Tender not found' });
    if (tender.status !== 'pending_approval')
      return res.status(400).json({ success: false, message: 'Tender is not pending approval' });

    const user = await User.findById(req.user.userId).populate('signature');
    if (!user)
      return res.status(401).json({ success: false, message: 'User not found' });

    // Find the current pending step for this user
    const step = tender.approvalChain.find(
      s => s.level === tender.currentApprovalLevel &&
           s.status === 'pending' &&
           s.approver.email.toLowerCase() === user.email.toLowerCase()
    );

    if (!step)
      return res.status(403).json({
        success: false,
        message: 'You are not authorised to approve at this stage or it has already been processed'
      });

    // Record decision + capture signature path snapshot
    step.status     = decision;
    step.comments   = comments || '';
    step.actionDate = new Date();
    step.actionTime = new Date().toTimeString().split(' ')[0];
    step.decidedBy  = user._id;
    // Capture the approver's signature local path at signing time
    step.signaturePath = user.signature?.localPath || user.signature?.url || null;

    if (decision === 'rejected') {
      // ── Rejected: end the chain ──────────────────────────────────────────
      tender.status              = 'rejected';
      tender.currentApprovalLevel = 0;
      await tender.save();

      // Notify creator
      await _notifyCreator(tender, 'rejected', user, comments);

      return res.json({
        success: true,
        message: 'Tender rejected',
        data: tender
      });
    }

    // ── Approved: advance chain ──────────────────────────────────────────────
    const nextLevel = tender.currentApprovalLevel + 1;
    const nextStep  = tender.approvalChain.find(s => s.level === nextLevel);

    if (nextStep) {
      // More approvers pending
      tender.currentApprovalLevel = nextLevel;
      nextStep.activatedDate      = new Date();
      nextStep.notificationSent   = false;
      await tender.save();
      await _notifyApprover(tender, nextStep);

      return res.json({
        success: true,
        message: `Level ${step.level} approved — notified Level ${nextLevel} approver`,
        data: tender
      });
    }

    // ── All levels approved ────────────────────────────────────────────────
    tender.status              = 'approved';
    tender.currentApprovalLevel = 0;
    await tender.save();

    await _notifyCreator(tender, 'approved', user, comments);

    return res.json({
      success: true,
      message: 'Tender fully approved',
      data: tender
    });
  } catch (err) {
    console.error('processTenderApproval:', err);
    res.status(500).json({ success: false, message: 'Failed to process approval', error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/tenders/pending-my-approval
// Returns tenders awaiting the calling user's signature
// ─────────────────────────────────────────────
exports.getTendersPendingMyApproval = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user)
      return res.status(401).json({ success: false, message: 'User not found' });

    const tenders = await Tender.find({
      status: 'pending_approval',
      approvalChain: {
        $elemMatch: {
          'approver.email': user.email,
          status:           'pending'
        }
      }
    })
      .populate('createdBy', 'fullName email')
      .populate('requisitionId', 'title requisitionNumber')
      .sort({ createdAt: -1 });

    // Only return those where this user IS the current level
    const mine = tenders.filter(t =>
      t.currentApprovalLevel > 0 &&
      t.approvalChain.some(
        s => s.level === t.currentApprovalLevel &&
             s.status === 'pending' &&
             s.approver.email.toLowerCase() === user.email.toLowerCase()
      )
    );

    res.json({ success: true, data: mine, count: mine.length });
  } catch (err) {
    console.error('getTendersPendingMyApproval:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch tenders', error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/tenders/:tenderId/pdf
// Generate the Tender Approval Form PDF
// ─────────────────────────────────────────────
exports.generateTenderPDF = async (req, res) => {
  try {
    const tender = await Tender.findById(req.params.tenderId)
      .populate('createdBy', 'fullName email')
      .populate('approvalChain.decidedBy', 'fullName email signature');

    if (!tender)
      return res.status(404).json({ success: false, message: 'Tender not found' });

    const pdfService = require('../services/pdfService');
    const result     = await pdfService.generateTenderApprovalFormPDF(tender.toObject());

    if (!result.success)
      throw new Error(result.error || 'PDF generation failed');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', result.buffer.length);
    res.send(result.buffer);
  } catch (err) {
    console.error('generateTenderPDF:', err);
    res.status(500).json({ success: false, message: 'Failed to generate PDF', error: err.message });
  }
};

// ─────────────────────────────────────────────
// DELETE /api/tenders/:tenderId  (draft only)
// ─────────────────────────────────────────────
exports.deleteTender = async (req, res) => {
  try {
    const tender = await Tender.findById(req.params.tenderId);
    if (!tender)
      return res.status(404).json({ success: false, message: 'Tender not found' });
    if (tender.status !== 'draft')
      return res.status(400).json({ success: false, message: 'Only draft tenders can be deleted' });
    await Tender.findByIdAndDelete(req.params.tenderId);
    res.json({ success: true, message: 'Tender deleted' });
  } catch (err) {
    console.error('deleteTender:', err);
    res.status(500).json({ success: false, message: 'Failed to delete tender', error: err.message });
  }
};

// ─────────────────────────────────────────────
// Internal email helpers
// ─────────────────────────────────────────────
async function _notifyApprover(tender, step) {
  try {
    await sendEmail({
      to: step.approver.email,
      subject: `Tender Approval Required — ${tender.tenderNumber}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#fff3cd;padding:20px;border-radius:8px;border-left:4px solid #ffc107;">
            <h2>Tender Approval Required — Level ${step.level}</h2>
            <p>Dear ${step.approver.name},</p>
            <p>A tender has been submitted for your approval.</p>
            <table style="width:100%;border-collapse:collapse;background:#fff;padding:16px;border-radius:6px;">
              <tr><td style="padding:6px 0;"><strong>Tender Number:</strong></td><td>${tender.tenderNumber}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Title:</strong></td><td>${tender.title}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Requested By:</strong></td><td>${tender.requesterName}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Department:</strong></td><td>${tender.requesterDepartment || '—'}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Budget:</strong></td><td>XAF ${(tender.budget || 0).toLocaleString()}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Awarded Supplier:</strong></td><td>${tender.awardedSupplierName || '—'}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Your Level:</strong></td><td>Level ${step.level} — ${step.approver.role}</td></tr>
            </table>
            <div style="text-align:center;margin:24px 0;">
              <a href="${process.env.CLIENT_URL || process.env.FRONTEND_URL}/supervisor/tender-approvals/${tender._id}"
                 style="background:#28a745;color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;">
                Review &amp; Sign Tender
              </a>
            </div>
            <p style="color:#666;font-size:11px;">This is an automated notification.</p>
          </div>
        </div>
      `
    });
    step.notificationSent   = true;
    step.notificationSentAt = new Date();
    console.log(`✅ Tender approval notification sent to ${step.approver.email}`);
  } catch (err) {
    console.error('_notifyApprover error:', err.message);
  }
}

async function _notifyCreator(tender, outcome, decidedByUser, comments) {
  try {
    const creator = await User.findById(tender.createdBy).select('email fullName');
    if (!creator) return;

    const color   = outcome === 'approved' ? '#52c41a' : '#ff4d4f';
    const heading = outcome === 'approved' ? '✅ Tender Fully Approved' : '❌ Tender Rejected';

    await sendEmail({
      to:      creator.email,
      subject: `${heading} — ${tender.tenderNumber}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#f6ffed;padding:20px;border-radius:8px;border-left:4px solid ${color};">
            <h2 style="color:${color};">${heading}</h2>
            <p>Dear ${creator.fullName},</p>
            <p>Your tender <strong>${tender.tenderNumber}</strong> has been <strong>${outcome}</strong>.</p>
            ${comments ? `<blockquote style="border-left:3px solid #ccc;padding:8px 12px;color:#555;">${comments}</blockquote>` : ''}
            <p>Decided by: <strong>${decidedByUser.fullName}</strong></p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('_notifyCreator error:', err.message);
  }
}










// // controllers/tenderController.js
// const mongoose = require('mongoose');
// const Tender = require('../models/Tender');
// const RFQ    = require('../models/RFQ');
// const Quote  = require('../models/Quote');
// const User   = require('../models/User');

// // ─────────────────────────────────────────────
// // Helpers
// // ─────────────────────────────────────────────
// const generateTenderNumber = async () => {
//   const count = await Tender.countDocuments();
//   return `GESPT${String(count + 1).padStart(2, '0')}`;
// };

// const authorise = (user) => {
//   if (!user) return false;
//   return ['buyer', 'supply_chain', 'admin'].includes(user.role) ||
//          user.departmentRole === 'buyer';
// };

// // ─────────────────────────────────────────────
// // GET /api/tenders
// // ─────────────────────────────────────────────
// exports.getTenders = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!authorise(user)) return res.status(403).json({ success: false, message: 'Access denied' });

//     const { status, search, page = 1, limit = 30 } = req.query;
//     const query = {};

//     // Buyers only see their own; SC/admin see all
//     if (user.role === 'buyer' || user.departmentRole === 'buyer') {
//       query.createdBy = req.user.userId;
//     }
//     if (status) query.status = status;
//     if (search) {
//       query.$or = [
//         { tenderNumber:  { $regex: search, $options: 'i' } },
//         { title:         { $regex: search, $options: 'i' } },
//         { requesterName: { $regex: search, $options: 'i' } }
//       ];
//     }

//     const [tenders, total] = await Promise.all([
//       Tender.find(query)
//         .populate('requisitionId', 'title requisitionNumber')
//         .populate('rfqId', 'rfqNumber title')
//         .populate('purchaseOrderId', 'poNumber status')
//         .populate('createdBy', 'fullName')
//         .sort({ createdAt: -1 })
//         .limit(parseInt(limit))
//         .skip((parseInt(page) - 1) * parseInt(limit)),
//       Tender.countDocuments(query)
//     ]);

//     res.json({
//       success: true,
//       data: tenders,
//       pagination: { current: parseInt(page), total: Math.ceil(total / parseInt(limit)), totalRecords: total }
//     });
//   } catch (err) {
//     console.error('getTenders error:', err);
//     res.status(500).json({ success: false, message: 'Failed to fetch tenders', error: err.message });
//   }
// };

// // ─────────────────────────────────────────────
// // GET /api/tenders/rfqs-available
// // RFQs that have ≥1 quote but no tender yet
// // ─────────────────────────────────────────────
// exports.getAvailableRFQsForTender = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!authorise(user)) return res.status(403).json({ success: false, message: 'Access denied' });

//     // RFQ ids that already have a tender
//     const tenderedRFQIds = (await Tender.find({ rfqId: { $exists: true, $ne: null } }).select('rfqId'))
//       .map(t => t.rfqId?.toString()).filter(Boolean);

//     // Distinct RFQ ids that have quotes
//     const rfqIdsWithQuotes = await Quote.distinct('rfqId');
//     const available = rfqIdsWithQuotes.filter(id => !tenderedRFQIds.includes(id.toString()));

//     // Scope to buyer's own RFQs unless admin/SC
//     const rfqQuery = { _id: { $in: available } };
//     if (user.role === 'buyer' || user.departmentRole === 'buyer') {
//       rfqQuery.buyerId = req.user.userId;
//     }

//     const rfqs = await RFQ.find(rfqQuery)
//       .populate('requisitionId', 'title requisitionNumber itemCategory department')
//       .populate('buyerId', 'fullName');

//     const enriched = await Promise.all(rfqs.map(async rfq => {
//       const quoteCount = await Quote.countDocuments({ rfqId: rfq._id });
//       return {
//         id: rfq._id,
//         rfqNumber: rfq.rfqNumber,
//         title: rfq.title,
//         requisitionTitle: rfq.requisitionId?.title,
//         itemCategory: rfq.requisitionId?.itemCategory,
//         department: rfq.requisitionId?.department,
//         quoteCount,
//         responseDeadline: rfq.responseDeadline,
//         expectedDeliveryDate: rfq.expectedDeliveryDate,
//         paymentTerms: rfq.paymentTerms,
//         deliveryLocation: rfq.deliveryLocation,
//         specialRequirements: rfq.specialRequirements
//       };
//     }));

//     res.json({ success: true, data: enriched });
//   } catch (err) {
//     console.error('getAvailableRFQsForTender error:', err);
//     res.status(500).json({ success: false, message: 'Failed to fetch RFQs', error: err.message });
//   }
// };

// // ─────────────────────────────────────────────
// // GET /api/tenders/:tenderId
// // ─────────────────────────────────────────────
// exports.getTenderById = async (req, res) => {
//   try {
//     const tender = await Tender.findById(req.params.tenderId)
//       .populate('requisitionId', 'title requisitionNumber department employee')
//       .populate('rfqId', 'rfqNumber title')
//       .populate('createdBy', 'fullName email')
//       .populate('purchaseOrderId', 'poNumber status totalAmount');

//     if (!tender) return res.status(404).json({ success: false, message: 'Tender not found' });

//     res.json({ success: true, data: tender });
//   } catch (err) {
//     console.error('getTenderById error:', err);
//     res.status(500).json({ success: false, message: 'Failed to fetch tender', error: err.message });
//   }
// };

// // ─────────────────────────────────────────────
// // POST /api/tenders/from-rfq/:rfqId
// // Build a tender automatically from quotes
// // ─────────────────────────────────────────────
// exports.createTenderFromRFQ = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!authorise(user)) return res.status(403).json({ success: false, message: 'Access denied' });

//     const { rfqId } = req.params;
//     const {
//       awardedSupplierName, awardedSupplierId,
//       budget, costSavings, costAvoidance,
//       deliveryTerms, paymentTerms, warranty, commercialTerms,
//       technicalRecommendation, procurementRecommendation
//     } = req.body;

//     const rfq = await RFQ.findById(rfqId)
//       .populate('requisitionId', 'title requisitionNumber department itemCategory expectedDate employee')
//       .populate('buyerId', 'fullName email department');

//     if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found' });

//     const quotes = await Quote.find({ rfqId })
//       .populate('supplierId', 'fullName email supplierDetails');

//     if (quotes.length === 0) {
//       return res.status(400).json({ success: false, message: 'No supplier quotes found for this RFQ. Suppliers must submit quotes before a tender can be created.' });
//     }

//     // Build supplier quotes array from actual quote submissions
//     const supplierQuotes = quotes.map(q => {
//       const grandTotal = q.totalAmount || 0;
//       return {
//         supplierId:   q.supplierId?._id,
//         supplierName: q.supplierId?.supplierDetails?.companyName || q.supplierId?.fullName || q.supplierDetails?.name || 'Unknown',
//         supplierEmail:q.supplierId?.email || q.supplierDetails?.email || '',
//         items: (q.items || []).map(item => ({
//           description:    item.description,
//           quantity:       item.quantity,
//           unitPrice:      item.unitPrice  || 0,
//           totalAmount:    item.totalPrice || (item.quantity * (item.unitPrice || 0)),
//           negotiatedTotal:item.totalPrice || (item.quantity * (item.unitPrice || 0))
//         })),
//         grandTotal,
//         negotiatedGrandTotal: grandTotal,
//         deliveryTerms: q.deliveryTerms || '',
//         paymentTerms:  q.paymentTerms  || '',
//         warranty:      q.warranty      || '',
//         notes:         q.supplierNotes || ''
//       };
//     });

//     const requisition  = rfq.requisitionId;
//     const tenderNumber = await generateTenderNumber();

//     const tender = new Tender({
//       tenderNumber,
//       source:       'rfq',
//       rfqId:        rfq._id,
//       requisitionId:requisition?._id,
//       title:        rfq.title || requisition?.title || 'Tender',
//       itemCategory: requisition?.itemCategory || '',
//       date:         new Date(),
//       requiredDate: rfq.expectedDeliveryDate || requisition?.expectedDate,
//       requesterName:       rfq.buyerId?.fullName || user.fullName || 'Unknown',
//       requesterDepartment: rfq.buyerId?.department || requisition?.department || '',
//       commercialTerms:     commercialTerms || rfq.specialRequirements || '',
//       supplierQuotes,
//       deliveryTerms:  deliveryTerms || rfq.deliveryLocation || '',
//       paymentTerms:   paymentTerms  || rfq.paymentTerms || '30 days',
//       warranty:       warranty      || '',
//       awardedSupplierId:   awardedSupplierId   || null,
//       awardedSupplierName: awardedSupplierName || '',
//       budget:       Number(budget)       || 0,
//       costSavings:  Number(costSavings)  || 0,
//       costAvoidance:Number(costAvoidance)|| 0,
//       technicalRecommendation:   technicalRecommendation   || '',
//       procurementRecommendation: procurementRecommendation || '',
//       status:    'draft',
//       createdBy: req.user.userId
//     });

//     await tender.save();

//     res.status(201).json({ success: true, message: 'Tender created from RFQ', data: tender });
//   } catch (err) {
//     console.error('createTenderFromRFQ error:', err);
//     if (err.name === 'ValidationError') {
//       return res.status(400).json({ success: false, message: 'Validation failed', error: err.message });
//     }
//     res.status(500).json({ success: false, message: 'Failed to create tender', error: err.message });
//   }
// };

// // ─────────────────────────────────────────────
// // POST /api/tenders/manual
// // ─────────────────────────────────────────────
// exports.createTenderManually = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!authorise(user)) return res.status(403).json({ success: false, message: 'Access denied' });

//     const {
//       title, itemCategory, requiredDate,
//       requesterName, requesterDepartment, commercialTerms,
//       supplierQuotes,
//       deliveryTerms, paymentTerms, warranty,
//       awardedSupplierName, awardedSupplierId,
//       budget, costSavings, costAvoidance,
//       technicalRecommendation, procurementRecommendation,
//       requisitionId
//     } = req.body;

//     if (!title)        return res.status(400).json({ success: false, message: 'Title is required' });
//     if (!requesterName)return res.status(400).json({ success: false, message: 'Requester name is required' });
//     if (!supplierQuotes || supplierQuotes.length === 0) {
//       return res.status(400).json({ success: false, message: 'At least one supplier quote is required' });
//     }

//     const tenderNumber = await generateTenderNumber();

//     const tender = new Tender({
//       tenderNumber,
//       source: 'manual',
//       requisitionId: requisitionId || undefined,
//       title,
//       itemCategory:  itemCategory  || '',
//       date:          new Date(),
//       requiredDate:  requiredDate  ? new Date(requiredDate) : undefined,
//       requesterName,
//       requesterDepartment: requesterDepartment || '',
//       commercialTerms:     commercialTerms     || '',
//       supplierQuotes: supplierQuotes.map(sq => ({
//         supplierId:           sq.supplierId || undefined,
//         supplierName:         sq.supplierName,
//         supplierEmail:        sq.supplierEmail || '',
//         items:                (sq.items || []).map(item => ({
//           description:    item.description,
//           quantity:       Number(item.quantity)       || 0,
//           unitPrice:      Number(item.unitPrice)      || 0,
//           totalAmount:    Number(item.totalAmount)    || 0,
//           negotiatedTotal:Number(item.negotiatedTotal)|| 0
//         })),
//         grandTotal:           Number(sq.grandTotal)           || 0,
//         negotiatedGrandTotal: Number(sq.negotiatedGrandTotal) || 0,
//         deliveryTerms: sq.deliveryTerms || '',
//         paymentTerms:  sq.paymentTerms  || '',
//         warranty:      sq.warranty      || '',
//         notes:         sq.notes         || ''
//       })),
//       deliveryTerms,
//       paymentTerms,
//       warranty,
//       awardedSupplierId:   awardedSupplierId   || undefined,
//       awardedSupplierName: awardedSupplierName || '',
//       budget:       Number(budget)       || 0,
//       costSavings:  Number(costSavings)  || 0,
//       costAvoidance:Number(costAvoidance)|| 0,
//       technicalRecommendation:   technicalRecommendation   || '',
//       procurementRecommendation: procurementRecommendation || '',
//       status:    'draft',
//       createdBy: req.user.userId
//     });

//     await tender.save();

//     res.status(201).json({ success: true, message: 'Tender created', data: tender });
//   } catch (err) {
//     console.error('createTenderManually error:', err);
//     if (err.name === 'ValidationError') {
//       return res.status(400).json({ success: false, message: 'Validation failed', error: err.message });
//     }
//     res.status(500).json({ success: false, message: 'Failed to create tender', error: err.message });
//   }
// };

// // ─────────────────────────────────────────────
// // PUT /api/tenders/:tenderId
// // ─────────────────────────────────────────────
// exports.updateTender = async (req, res) => {
//   try {
//     const tender = await Tender.findById(req.params.tenderId);
//     if (!tender) return res.status(404).json({ success: false, message: 'Tender not found' });
//     if (tender.status !== 'draft') {
//       return res.status(400).json({ success: false, message: 'Only draft tenders can be edited' });
//     }

//     const allowed = [
//       'title', 'itemCategory', 'requiredDate', 'requesterName', 'requesterDepartment',
//       'commercialTerms', 'supplierQuotes', 'deliveryTerms', 'paymentTerms', 'warranty',
//       'awardedSupplierName', 'awardedSupplierId', 'budget', 'costSavings', 'costAvoidance',
//       'technicalRecommendation', 'procurementRecommendation'
//     ];

//     allowed.forEach(key => { if (req.body[key] !== undefined) tender[key] = req.body[key]; });
//     await tender.save();

//     res.json({ success: true, message: 'Tender updated', data: tender });
//   } catch (err) {
//     console.error('updateTender error:', err);
//     res.status(500).json({ success: false, message: 'Failed to update tender', error: err.message });
//   }
// };

// // ─────────────────────────────────────────────
// // PATCH /api/tenders/:tenderId/status
// // ─────────────────────────────────────────────
// exports.updateTenderStatus = async (req, res) => {
//   try {
//     const { status } = req.body;
//     const validStatuses = ['draft', 'pending_approval', 'approved', 'rejected', 'awarded'];
//     if (!validStatuses.includes(status)) {
//       return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
//     }

//     const tender = await Tender.findByIdAndUpdate(req.params.tenderId, { status }, { new: true });
//     if (!tender) return res.status(404).json({ success: false, message: 'Tender not found' });

//     res.json({ success: true, message: `Tender status updated to ${status}`, data: tender });
//   } catch (err) {
//     console.error('updateTenderStatus error:', err);
//     res.status(500).json({ success: false, message: 'Failed to update status', error: err.message });
//   }
// };

// // ─────────────────────────────────────────────
// // DELETE /api/tenders/:tenderId  (draft only)
// // ─────────────────────────────────────────────
// exports.deleteTender = async (req, res) => {
//   try {
//     const tender = await Tender.findById(req.params.tenderId);
//     if (!tender) return res.status(404).json({ success: false, message: 'Tender not found' });
//     if (tender.status !== 'draft') {
//       return res.status(400).json({ success: false, message: 'Only draft tenders can be deleted' });
//     }
//     await Tender.findByIdAndDelete(req.params.tenderId);
//     res.json({ success: true, message: 'Tender deleted' });
//   } catch (err) {
//     console.error('deleteTender error:', err);
//     res.status(500).json({ success: false, message: 'Failed to delete tender', error: err.message });
//   }
// };