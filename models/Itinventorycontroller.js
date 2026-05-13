    /**
 * itInventoryController.js
 *
 * CRUD + stats for the IT Inventory collection.
 * Intended to be mounted at /api/it-inventory by the Express app.
 */

const ITInventory = require('../models/ITInventory');
const User        = require('../models/User');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise a flat form submission into the nested schema shape.
 * Accepts both nested objects (from JSON body) and flat keys (from FormData).
 */
const buildItemData = (body, userId) => {
  const {
    itemName, category, subcategory, brand, model, serialNumber,
    status, condition, location,
    // purchaseInfo can arrive flat or nested
    purchaseDate, purchasePrice, supplier, warrantyExpiry, invoiceNumber,
    // stockInfo can arrive flat or nested
    quantity, minStockLevel, maxStockLevel, reorderPoint,
    specifications, notes, assignedTo, sourceRequest
  } = body;

  const purchaseInfo = body.purchaseInfo ?? {
    purchaseDate:   purchaseDate   || undefined,
    purchasePrice:  purchasePrice  !== undefined ? Number(purchasePrice) : 0,
    supplier:       supplier       || undefined,
    warrantyExpiry: warrantyExpiry || undefined,
    invoiceNumber:  invoiceNumber  || undefined
  };

  const stockInfo = body.stockInfo ?? {
    quantity:      quantity      !== undefined ? Number(quantity)      : 1,
    minStockLevel: minStockLevel !== undefined ? Number(minStockLevel) : 1,
    maxStockLevel: maxStockLevel !== undefined ? Number(maxStockLevel) : 10,
    reorderPoint:  reorderPoint  !== undefined ? Number(reorderPoint)  : 2
  };

  let parsedSpecs = specifications;
  if (typeof specifications === 'string') {
    try { parsedSpecs = JSON.parse(specifications); } catch { parsedSpecs = {}; }
  }

  return {
    itemName, category, subcategory, brand, model, serialNumber,
    status, condition, location,
    purchaseInfo, stockInfo,
    specifications: parsedSpecs,
    notes,
    assignedTo:    assignedTo    || null,
    sourceRequest: sourceRequest || null,
    updatedBy:     userId
  };
};

// ─── GET /api/it-inventory ────────────────────────────────────────────────────
const getInventory = async (req, res) => {
  try {
    const {
      category, status, location, lowStock, search,
      page = 1, limit = 50,
      startDate, endDate,
      sortBy = 'createdAt', sortOrder = 'desc'
    } = req.query;

    const filter = {};

    if (category && category !== 'all') filter.category = category;
    if (status   && status   !== 'all') filter.status   = status;
    if (location && location !== 'all') filter.location = location;

    if (lowStock === 'true') {
      filter.$expr = { $lte: ['$stockInfo.quantity', '$stockInfo.minStockLevel'] };
    }

    if (startDate || endDate) {
      filter['purchaseInfo.purchaseDate'] = {};
      if (startDate) filter['purchaseInfo.purchaseDate'].$gte = new Date(startDate);
      if (endDate)   filter['purchaseInfo.purchaseDate'].$lte = new Date(endDate);
    }

    if (search) {
      filter.$text = { $search: search };
    }

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [items, totalCount] = await Promise.all([
      ITInventory.find(filter)
        .populate('assignedTo', 'fullName email department employeeId')
        .populate('createdBy',  'fullName')
        .populate('updatedBy',  'fullName')
        .sort(sort)
        .limit(Number(limit))
        .skip((Number(page) - 1) * Number(limit)),
      ITInventory.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data:    items,
      pagination: {
        current:      Number(page),
        total:        Math.ceil(totalCount / Number(limit)),
        count:        items.length,
        totalRecords: totalCount
      }
    });
  } catch (error) {
    console.error('getInventory error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory', error: error.message });
  }
};

// ─── GET /api/it-inventory/stats ─────────────────────────────────────────────
const getInventoryStats = async (req, res) => {
  try {
    const [
      totalItems,
      byStatus,
      byCategory,
      lowStockItems,
      totalValue
    ] = await Promise.all([
      ITInventory.countDocuments(),
      ITInventory.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      ITInventory.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]),
      ITInventory.countDocuments({
        $expr: { $lte: ['$stockInfo.quantity', '$stockInfo.minStockLevel'] }
      }),
      ITInventory.aggregate([
        { $group: { _id: null, total: { $sum: '$purchaseInfo.purchasePrice' } } }
      ])
    ]);

    const statusMap  = Object.fromEntries(byStatus.map(s => [s._id, s.count]));
    const categoryMap = Object.fromEntries(byCategory.map(c => [c._id, c.count]));

    res.json({
      success: true,
      data: {
        totalItems,
        available:   statusMap.available   || 0,
        assigned:    statusMap.assigned    || 0,
        maintenance: statusMap.maintenance || 0,
        retired:     statusMap.retired     || 0,
        lowStock:    lowStockItems,
        totalValue:  totalValue[0]?.total  || 0,
        byCategory:  categoryMap
      }
    });
  } catch (error) {
    console.error('getInventoryStats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory stats', error: error.message });
  }
};

// ─── GET /api/it-inventory/:id ────────────────────────────────────────────────
const getInventoryItem = async (req, res) => {
  try {
    const item = await ITInventory.findById(req.params.id)
      .populate('assignedTo',   'fullName email department employeeId')
      .populate('sourceRequest', 'ticketNumber title requestType')
      .populate('createdBy',    'fullName')
      .populate('updatedBy',    'fullName');

    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('getInventoryItem error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory item', error: error.message });
  }
};

// ─── POST /api/it-inventory ───────────────────────────────────────────────────
const createInventoryItem = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !['it', 'admin', 'ceo'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const data = buildItemData(req.body, req.user.userId);
    data.createdBy = req.user.userId;

    const item = new ITInventory(data);
    await item.save();
    await item.populate('assignedTo', 'fullName email department employeeId');

    res.status(201).json({
      success: true,
      message: 'Inventory item created successfully',
      data:    item
    });
  } catch (error) {
    console.error('createInventoryItem error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'An item with that serial number or code already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create inventory item', error: error.message });
  }
};

// ─── PUT /api/it-inventory/:id ────────────────────────────────────────────────
const updateInventoryItem = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !['it', 'admin', 'ceo'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const item = await ITInventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const updates = buildItemData(req.body, req.user.userId);

    // Track assignment date when assignedTo changes
    if (updates.assignedTo && updates.assignedTo.toString() !== item.assignedTo?.toString()) {
      updates.assignedDate = new Date();
    }
    if (!updates.assignedTo) {
      updates.assignedDate = null;
    }

    Object.assign(item, updates);
    await item.save();
    await item.populate('assignedTo', 'fullName email department employeeId');

    res.json({
      success: true,
      message: 'Inventory item updated successfully',
      data:    item
    });
  } catch (error) {
    console.error('updateInventoryItem error:', error);
    res.status(500).json({ success: false, message: 'Failed to update inventory item', error: error.message });
  }
};

// ─── DELETE /api/it-inventory/:id ─────────────────────────────────────────────
const deleteInventoryItem = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !['it', 'admin', 'ceo'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const item = await ITInventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    res.json({ success: true, message: 'Inventory item deleted successfully' });
  } catch (error) {
    console.error('deleteInventoryItem error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete inventory item', error: error.message });
  }
};

// ─── POST /api/it-inventory/:id/maintenance ───────────────────────────────────
const addMaintenanceRecord = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !['it', 'admin', 'ceo'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const item = await ITInventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const { date, type, description, technician, cost, nextMaintenanceDate } = req.body;
    item.maintenanceHistory.push({ date, type, description, technician, cost, nextMaintenanceDate });

    // Auto-flip status to maintenance when a repair record is added
    if (type === 'Repair' && item.status === 'available') {
      item.status = 'maintenance';
    }

    item.updatedBy = req.user.userId;
    await item.save();

    res.json({
      success: true,
      message: 'Maintenance record added',
      data:    item
    });
  } catch (error) {
    console.error('addMaintenanceRecord error:', error);
    res.status(500).json({ success: false, message: 'Failed to add maintenance record', error: error.message });
  }
};

// ─── GET /api/it-inventory/locations ─────────────────────────────────────────
const getLocations = async (req, res) => {
  try {
    const locations = await ITInventory.distinct('location');
    res.json({ success: true, data: locations.filter(Boolean).sort() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch locations', error: error.message });
  }
};

module.exports = {
  getInventory,
  getInventoryStats,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  addMaintenanceRecord,
  getLocations
};