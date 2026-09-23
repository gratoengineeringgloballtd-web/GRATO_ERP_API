const express = require('express');
const router = express.Router();
const Part = require('../models/Part');
const PartRequest = require('../models/PartRequest'); // Added model
const User = require('../models/User'); // Added for notifications/checks
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');

// Get all parts with optional filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search, category, status, needsReorder } = req.query;

    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { part_number: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (category) {
      filter.category = category;
    }

    if (status) {
      filter.status = status;
    }

    if (needsReorder === 'true') {
      filter.$expr = { $lte: ['$inventory.stock', '$inventory.reorder_point'] };
    }

    const parts = await Part.find(filter)
      .populate('created_by', 'fullName email')
      .populate('last_updated_by', 'fullName email')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: parts,
      count: parts.length
    });
  } catch (error) {
    logger.error('Error fetching parts:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error fetching parts data',
      details: error.message 
    });
  }
});

// Get parts statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const [
      totalParts,
      categories,
      lowStockParts,
      outOfStockParts,
      totalValue,
      categoryStats
    ] = await Promise.all([
      Part.countDocuments({ status: 'active' }),
      Part.distinct('category'),
      Part.countDocuments({
        $expr: { $lte: ['$inventory.stock', '$inventory.reorder_point'] },
        status: 'active'
      }),
      Part.countDocuments({
        'inventory.stock': 0,
        status: 'active'
      }),
      Part.aggregate([
        { $match: { status: 'active' } },
        {
          $group: {
            _id: null,
            totalValue: {
              $sum: { $multiply: ['$inventory.stock', '$pricing.unit_cost'] }
            }
          }
        }
      ]),
      Part.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    ]);

    res.json({
      success: true,
      stats: {
        totalParts,
        categories: categories.filter(c => c),
        lowStockParts,
        outOfStockParts,
        totalValue: totalValue[0]?.totalValue || 0,
        categoryStats
      }
    });
  } catch (error) {
    logger.error('Error fetching parts statistics:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error fetching parts statistics',
      details: error.message 
    });
  }
});

// Upload parts data
router.post('/upload', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const data = req.body;

    if (!Array.isArray(data)) {
      return res.status(400).json({ 
        success: false,
        error: 'Request body must be an array of part objects'
      });
    }

    if (data.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No valid data provided for upload'
      });
    }

    // Validate that all records have required fields
    const invalidRecords = data.filter(part => 
      !part.name || !part.part_number || !part.category
    );
    
    if (invalidRecords.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: `${invalidRecords.length} records missing required fields (name, part_number, or category)`
      });
    }

    // Clean and process the data
    const cleanedData = data.map(part => {
      const { key, rowNumber, ...cleanPart } = part;

      // Set default values
      if (!cleanPart.inventory) {
        cleanPart.inventory = {};
      }
      cleanPart.inventory.stock = cleanPart.inventory.stock || cleanPart.stock || 0;
      cleanPart.inventory.min_stock_level = cleanPart.inventory.min_stock_level || 10;
      cleanPart.inventory.max_stock_level = cleanPart.inventory.max_stock_level || 100;
      cleanPart.inventory.reorder_point = cleanPart.inventory.reorder_point || 20;

      if (!cleanPart.pricing) {
        cleanPart.pricing = {};
      }
      cleanPart.pricing.unit_cost = cleanPart.pricing.unit_cost || 0;
      cleanPart.pricing.currency = cleanPart.pricing.currency || 'XAF';

      if (!cleanPart.usage_stats) {
        cleanPart.usage_stats = {
          total_used: 0,
          monthly_usage: 0,
          average_monthly_usage: 0
        };
      }

      // Set status and created_by
      cleanPart.status = cleanPart.status || 'active';
      cleanPart.created_by = req.user.userId;

      // Convert numeric strings to numbers
      const numericFields = ['stock', 'min_stock_level', 'max_stock_level', 'reorder_point', 'unit_cost'];
      numericFields.forEach(field => {
        if (cleanPart[field] && !isNaN(cleanPart[field])) {
          cleanPart[field] = Number(cleanPart[field]);
        }
      });

      return cleanPart;
    });

    // Track new categories
    const existingCategories = await Part.distinct('category');
    const newCategories = [...new Set(cleanedData.map(p => p.category))]
      .filter(cat => !existingCategories.includes(cat));

    // Process valid data using bulkWrite
    const operations = cleanedData.map(part => ({
      updateOne: {
        filter: { part_number: part.part_number },
        update: { $set: part },
        upsert: true
      }
    }));

    const result = await Part.bulkWrite(operations);

    logger.info('Parts upload completed', {
      inserted: result.upsertedCount,
      modified: result.modifiedCount,
      total: cleanedData.length,
      uploadedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Data processed successfully',
      inserted: result.upsertedCount || 0,
      modified: result.modifiedCount || 0,
      totalProcessed: cleanedData.length,
      newCategories: newCategories.length > 0 ? newCategories : undefined
    });

  } catch (error) {
    logger.error('Parts upload error:', error);

    if (error.code === 11000) {
      res.status(400).json({ 
        success: false,
        error: 'Duplicate part_number found in upload data',
        details: error.message 
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'Server error processing parts data',
        details: error.message 
      });
    }
  }
});

// Get specific part
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const part = await Part.findById(req.params.id)
      .populate('created_by', 'fullName email')
      .populate('last_updated_by', 'fullName email');

    if (!part) {
      return res.status(404).json({ 
        success: false,
        error: 'Part not found' 
      });
    }

    res.json({ 
      success: true, 
      data: part
    });
  } catch (error) {
    logger.error('Error fetching part:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error fetching part data',
      details: error.message 
    });
  }
});

// Create new part
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const partData = {
      ...req.body,
      created_by: req.user.userId
    };

    const part = new Part(partData);
    await part.save();

    logger.info('Part created', {
      partId: part._id,
      partNumber: part.part_number,
      createdBy: req.user.userId
    });

    res.status(201).json({
      success: true,
      data: part,
      message: 'Part created successfully'
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Part number already exists'
      });
    }

    logger.error('Create part error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error creating part',
      details: error.message 
    });
  }
});

// Update part
router.put('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      last_updated_by: req.user.userId
    };

    const part = await Part.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!part) {
      return res.status(404).json({
        success: false,
        error: 'Part not found'
      });
    }

    logger.info('Part updated', {
      partId: part._id,
      partNumber: part.part_number,
      updatedBy: req.user.userId
    });

    res.json({
      success: true,
      data: part,
      message: 'Part updated successfully'
    });
  } catch (error) {
    logger.error('Update part error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error updating part',
      details: error.message 
    });
  }
});

// Delete part
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const part = await Part.findByIdAndDelete(req.params.id);

    if (!part) {
      return res.status(404).json({
        success: false,
        error: 'Part not found'
      });
    }

    logger.info('Part deleted', {
      partId: req.params.id,
      partNumber: part.part_number,
      deletedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Part deleted successfully'
    });
  } catch (error) {
    logger.error('Delete part error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error deleting part',
      details: error.message 
    });
  }
});

// Get parts needing reorder
router.get('/maintenance/reorder-needed', authenticateToken, async (req, res) => {
  try {
    const parts = await Part.findPartsNeedingReorder()
      .select('name part_number category inventory pricing');

    res.json({
      success: true,
      data: parts,
      count: parts.length
    });
  } catch (error) {
    logger.error('Error fetching parts needing reorder:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error fetching parts needing reorder',
      details: error.message 
    });
  }
});

// ==========================================
// PART REQUESTS
// ==========================================

// Create part request
router.post('/requests', authenticateToken, async (req, res) => {
  try {
    const { items, urgency, notes, site } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required and cannot be empty'
      });
    }

    // Enrich items with part details
    const enrichedItems = await Promise.all(items.map(async (item) => {
      const part = await Part.findById(item.part);
      if (!part) throw new Error(`Part not found: ${item.part}`);
      return {
        part: item.part,
        part_name: part.name,
        part_number: part.part_number,
        quantity: item.quantity
      };
    }));

    const request = new PartRequest({
      technician: req.user.userId,
      items: enrichedItems,
      urgency: urgency || 'medium',
      notes,
      site,
      status: 'pending'
    });

    await request.save();

    // TODO: Notify supervisor (future enhancement)
    
    logger.info('Part request created', {
      requestId: request.request_id,
      technician: req.user.userId
    });

    res.status(201).json({
      success: true,
      message: 'Part request submitted successfully',
      data: request
    });
  } catch (error) {
    logger.error('Error creating part request:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error creating part request',
      details: error.message 
    });
  }
});

// Get my requests (Technician)
router.get('/requests/my', authenticateToken, async (req, res) => {
  try {
    const requests = await PartRequest.find({ technician: req.user.userId })
      .sort({ createdAt: -1 })
      .populate('items.part', 'name part_number description category');

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    logger.error('Error fetching my part requests:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch requests' 
    });
  }
});

// Get all requests (Supervisor/Admin)
router.get('/requests/all', authenticateToken, requireRole(['admin', 'supervisor']), async (req, res) => {
  try {
    const { status, urgency } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (urgency) filter.urgency = urgency;

    // Supervisors should ideally see requests from their technicians, but for now allow all or filter TBD
    // If supervisor, maybe filter by technicians they supervise? 
    // For simplicity, let's keep it open or check role.
    
    const requests = await PartRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('technician', 'fullName email phone')
      .populate('items.part', 'name part_number inventory');

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    logger.error('Error fetching all part requests:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch requests' 
    });
  }
});

module.exports = router;


