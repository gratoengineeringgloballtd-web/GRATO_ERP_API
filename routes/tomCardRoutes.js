const express = require('express');
const router  = express.Router();
const { uploadTomCard }    = require('../config/upload');
const { importFromBuffer } = require('../services/tomCardImportService');
const { fireSystemAlert }  = require('../services/alertService');
const TomCardTransaction   = require('../models/TomCardTransaction');
const { TomCardMapping, TomCardUpload } = require('../models/TomCardMapping');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');

const ROLES = ['diesel_manager', 'admin', 'finance'];

// POST /api/diesel/tomcard/upload
//
// BUG FIX: "The \"path\" argument must be of type string. Received undefined"
//   uploadTomCard (config/upload.js) uses multer.memoryStorage(), which only
//   ever sets req.file.buffer — never req.file.path (that's diskStorage-only).
//   This route used to call importTomCardFile(req.file.path, ...), and
//   importTomCardFile did fs.readFileSync(filePath, ...) — with filePath
//   always undefined, that throws immediately. Now calls importFromBuffer
//   with req.file.buffer directly (no disk I/O), mirroring the same fix
//   already applied to the CMS upload route.
router.post('/upload',
  authenticateToken, requireRole(ROLES),
  uploadTomCard.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const { cycle_key } = req.body;
    let result;
    try {
      result = await importFromBuffer(
        req.file.buffer,
        req.user._id || req.user.userId,
        cycle_key || null,
        req.file.originalname
      );
    } catch (err) {
      await fireSystemAlert('IMPORT_ERROR', 'critical',
        `Tom Card Import Failed — ${req.file.originalname}`, err.message,
        { filename: req.file.originalname }, null);
      return res.status(422).json({ success: false, message: err.message });
    }
    res.status(201).json({ success: true, message: 'Tom Card statement imported', data: result });
  })
);

// GET /api/diesel/tomcard/transactions
router.get('/transactions',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const { cycle_key, card_num, cluster, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (cycle_key) filter.cycle_key = cycle_key;
    if (card_num)  filter.card_num  = card_num;
    if (cluster)   filter.cluster   = cluster;
    const [txns, total] = await Promise.all([
      TomCardTransaction.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(+limit).lean(),
      TomCardTransaction.countDocuments(filter),
    ]);
    res.json({ success: true, data: txns, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) } });
  })
);

// GET /api/diesel/tomcard/summary/:cycle_key — Totals by card and station
router.get('/summary/:cycle_key',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const [byCard, byStation, cycleTotal] = await Promise.all([
      TomCardTransaction.getCycleTotals(req.params.cycle_key),
      TomCardTransaction.getStationTotals(req.params.cycle_key),
      TomCardTransaction.aggregate([
        { $match: { cycle_key: req.params.cycle_key } },
        { $group: { _id: null, total_liters: { $sum: '$quantity_l' }, total_cfa: { $sum: '$amount_cfa' }, count: { $sum: 1 } } },
      ]),
    ]);
    res.json({
      success: true,
      data: {
        cycle_key: req.params.cycle_key,
        total_liters:    cycleTotal[0]?.total_liters  || 0,
        total_amount_cfa: cycleTotal[0]?.total_cfa    || 0,
        total_transactions: cycleTotal[0]?.count      || 0,
        by_card:    byCard,
        by_station: byStation,
      },
    });
  })
);

// GET /api/diesel/tomcard/mappings — List all card→cluster mappings
router.get('/mappings',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const mappings = await TomCardMapping.find().sort({ card_num: 1 }).lean();
    res.json({ success: true, data: mappings });
  })
);

// POST /api/diesel/tomcard/mappings — Create / update a mapping
router.post('/mappings',
  authenticateToken, requireRole(['admin']),
  asyncHandler(async (req, res) => {
    const { card_num, card_label, cluster, site_ids, station_hint, truck_plate, driver_name, notes } = req.body;
    if (!card_num) return res.status(400).json({ success: false, message: 'card_num is required' });

    const mapping = await TomCardMapping.findOneAndUpdate(
      { card_num },
      { $set: { card_num, card_label, cluster, site_ids, station_hint, truck_plate, driver_name, notes, is_active: true, updated_by: req.user._id || req.user.userId } },
      { upsert: true, new: true }
    );

    // Retroactively update unlinked transactions with this card
    if (cluster || site_ids?.length) {
      await TomCardTransaction.updateMany(
        { card_num, mapping_confidence: { $in: ['unlinked', 'station_match'] } },
        { $set: { cluster: cluster || null, site_id: site_ids?.[0] || null, mapping_confidence: 'mapped' } }
      );
    }

    res.json({ success: true, message: 'Mapping saved', data: mapping });
  })
);

// DELETE /api/diesel/tomcard/mappings/:card_num
router.delete('/mappings/:card_num',
  authenticateToken, requireRole(['admin']),
  asyncHandler(async (req, res) => {
    await TomCardMapping.findOneAndUpdate({ card_num: req.params.card_num }, { $set: { is_active: false } });
    res.json({ success: true, message: 'Mapping deactivated' });
  })
);

// GET /api/diesel/tomcard/unmapped — Cards/stations with weak or no site
// mapping, ranked by liters purchased so admins can prioritize which
// mappings to add first. Without this, an 'unlinked' or 'station_match'
// transaction is invisible — it just quietly drops out of the reconciliation
// triangle (CycleReconciliation.tomcard_purchased and the field-vs-card
// variance check never see it).
router.get('/unmapped',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const { cycle_key } = req.query;
    const match = { mapping_confidence: { $ne: 'mapped' } };
    if (cycle_key) match.cycle_key = cycle_key;

    const rows = await TomCardTransaction.aggregate([
      { $match: match },
      { $group: {
          _id: { card_num: '$card_num', station_name: '$station_name' },
          mapping_confidence: { $first: '$mapping_confidence' },
          total_liters: { $sum: '$quantity_l' },
          total_cfa:    { $sum: '$amount_cfa' },
          transactions: { $sum: 1 },
          last_seen:    { $max: '$date' },
        } },
      { $sort: { total_liters: -1 } },
      { $limit: 100 },
      { $project: {
          _id: 0,
          card_num: '$_id.card_num',
          station_name: '$_id.station_name',
          mapping_confidence: 1,
          total_liters: 1,
          total_cfa: 1,
          transactions: 1,
          last_seen: 1,
        } },
    ]);

    const totalUnmappedLiters = rows.reduce((s, r) => s + (r.total_liters || 0), 0);
    res.json({
      success: true,
      data: rows,
      summary: {
        distinct_unmapped_cards: rows.length,
        total_unmapped_liters: totalUnmappedLiters,
      },
    });
  })
);

// GET /api/diesel/tomcard/uploads — Upload history
router.get('/uploads',
  authenticateToken, requireRole(ROLES),
  asyncHandler(async (req, res) => {
    const uploads = await TomCardUpload.find().sort({ createdAt: -1 }).limit(30)
      .populate('uploaded_by', 'fullName').lean();
    res.json({ success: true, data: uploads });
  })
);

module.exports = router;

