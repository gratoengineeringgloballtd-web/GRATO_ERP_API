const SiteAuditChecklist = require('../models/SiteAuditChecklist');
const Site = require('../models/Site');

const buildPagination = (page = 1, limit = 20) => {
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.max(parseInt(limit, 10) || 20, 1);
  return { currentPage, pageSize, skip: (currentPage - 1) * pageSize };
};

exports.getSites = async (req, res) => {
  try {
    const sites = await Site.find({})
      .select('Site_Name IHS_ID_SITE Region Sites_Type Latitude Longitude')
      .sort({ Site_Name: 1 })
      .lean();

    return res.json({ success: true, data: sites });
  } catch (error) {
    console.error('Operations getSites error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load sites' });
  }
};

exports.listAudits = async (req, res) => {
  try {
    const { status, siteId, createdBy, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (siteId) filter.site = siteId;
    if (createdBy) filter.created_by = createdBy;

    const { currentPage, pageSize, skip } = buildPagination(page, limit);

    const [items, total] = await Promise.all([
      SiteAuditChecklist.find(filter)
        .populate('site', 'Site_Name IHS_ID_SITE Region')
        .populate('created_by', 'fullName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      SiteAuditChecklist.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        current: currentPage,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    console.error('Operations listAudits error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load audits' });
  }
};

exports.getAuditById = async (req, res) => {
  try {
    const audit = await SiteAuditChecklist.findById(req.params.id)
      .populate('site', 'Site_Name IHS_ID_SITE Region')
      .populate('created_by', 'fullName email')
      .lean();

    if (!audit) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }

    return res.json({ success: true, data: audit });
  } catch (error) {
    console.error('Operations getAuditById error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load audit' });
  }
};

exports.createAudit = async (req, res) => {
  try {
    const { site: siteId } = req.body;

    const site = await Site.findById(siteId).lean();
    if (!site) {
      return res.status(400).json({ success: false, error: 'Site not found' });
    }

    const audit = new SiteAuditChecklist({
      ...req.body,
      site: siteId,
      site_name: req.body.site_name || site.Site_Name,
      site_code: req.body.site_code || site.IHS_ID_SITE,
      region: req.body.region || site.Region,
      created_by: req.user.userId,
      updated_by: req.user.userId
    });

    await audit.save();
    return res.status(201).json({ success: true, data: audit });
  } catch (error) {
    console.error('Operations createAudit error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create audit' });
  }
};

exports.updateAudit = async (req, res) => {
  try {
    const audit = await SiteAuditChecklist.findById(req.params.id);
    if (!audit) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }

    const isOwner = audit.created_by?.toString() === req.user.userId;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this audit' });
    }

    if (req.body.site && req.body.site !== audit.site.toString()) {
      const site = await Site.findById(req.body.site).lean();
      if (!site) {
        return res.status(400).json({ success: false, error: 'Site not found' });
      }
      audit.site_name = req.body.site_name || site.Site_Name;
      audit.site_code = req.body.site_code || site.IHS_ID_SITE;
      audit.region = req.body.region || site.Region;
    }

    Object.assign(audit, req.body, { updated_by: req.user.userId });
    await audit.save();

    return res.json({ success: true, data: audit });
  } catch (error) {
    console.error('Operations updateAudit error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update audit' });
  }
};

exports.updateAuditStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const audit = await SiteAuditChecklist.findById(req.params.id);

    if (!audit) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }

    const isOwner = audit.created_by?.toString() === req.user.userId;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this audit' });
    }

    audit.status = status;
    audit.updated_by = req.user.userId;
    await audit.save();

    return res.json({ success: true, data: audit });
  } catch (error) {
    console.error('Operations updateAuditStatus error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update audit status' });
  }
};
