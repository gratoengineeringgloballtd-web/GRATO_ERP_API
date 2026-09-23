const TechnicianSiteAudit = require('../models/TechnicianSiteAudit');

const buildPagination = (page = 1, limit = 20) => {
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.max(parseInt(limit, 10) || 20, 1);
  return { currentPage, pageSize, skip: (currentPage - 1) * pageSize };
};

exports.listAudits = async (req, res) => {
  try {
    const { status, siteId, createdBy, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (siteId) filter.site_id_ihs = siteId;
    if (createdBy) filter.created_by = createdBy;
    const { currentPage, pageSize, skip } = buildPagination(page, limit);
    const [items, total] = await Promise.all([
      TechnicianSiteAudit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      TechnicianSiteAudit.countDocuments(filter)
    ]);
    return res.json({
      success: true,
      data: items,
      pagination: { current: currentPage, pageSize, total, pages: Math.ceil(total / pageSize) }
    });
  } catch (error) {
    console.error('Technician listAudits error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load audits' });
  }
};

exports.getAuditById = async (req, res) => {
  try {
    const audit = await TechnicianSiteAudit.findById(req.params.id).lean();
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found' });
    return res.json({ success: true, data: audit });
  } catch (error) {
    console.error('Technician getAuditById error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load audit' });
  }
};

exports.createAudit = async (req, res) => {
  try {
    const { site_id_ihs, client_id } = req.body;
    if (!site_id_ihs) {
      return res.status(400).json({ success: false, error: 'Site ID (IHS) is required' });
    }

    // ── Offline-sync idempotency guard ──────────────────────────────────────
    // The mobile app generates a stable client_id per submission (before it
    // ever tries the network) and re-sends the same payload+client_id if a
    // queued sync retries. If we already have a record with this client_id,
    // the earlier attempt actually succeeded — just return it instead of
    // creating a duplicate audit.
    if (client_id) {
      const existing = await TechnicianSiteAudit.findOne({ client_id });
      if (existing) {
        return res.status(200).json({ success: true, data: existing });
      }
    }

    const audit = new TechnicianSiteAudit({
      ...req.body,
      client_id,
      created_by: req.user.userId,
      updated_by: req.user.userId
    });
    await audit.save();
    return res.status(201).json({ success: true, data: audit });
  } catch (error) {
    console.error('Technician createAudit error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create audit' });
  }
};

exports.updateAudit = async (req, res) => {
  try {
    const audit = await TechnicianSiteAudit.findById(req.params.id);
    if (!audit) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }

    // FIX: Compare both .toString() to handle ObjectId vs string mismatch.
    // Also normalise: the JWT puts userId in req.user.userId but some tokens
    // may use req.user.id — accept either.
    const requesterId = (req.user.userId || req.user.id || '').toString();
    const ownerId = (audit.created_by || '').toString();
    const isOwner = ownerId === requesterId;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this audit' });
    }

    Object.assign(audit, req.body, { updated_by: requesterId });
    await audit.save();
    return res.json({ success: true, data: audit });
  } catch (error) {
    console.error('Technician updateAudit error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update audit' });
  }
};

exports.updateAuditStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const audit = await TechnicianSiteAudit.findById(req.params.id);
    if (!audit) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }
    const requesterId = (req.user.userId || req.user.id || '').toString();
    const ownerId = (audit.created_by || '').toString();
    const isOwner = ownerId === requesterId;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this audit' });
    }
    audit.status = status;
    audit.updated_by = requesterId;
    await audit.save();
    return res.json({ success: true, data: audit });
  } catch (error) {
    console.error('Technician updateAuditStatus error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update audit status' });
  }
};
