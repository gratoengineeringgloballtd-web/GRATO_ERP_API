const Item = require('../models/Item');
const ItemRequest = require('../models/ItemRequest');
const User = require('../models/User');
const Counter = require('../models/Counter');
const { sendEmail } = require('../services/emailService');

const CATEGORY_CODE_MAP = {
  'IT Accessories': 'IT',
  'Office Supplies': 'OFF',
  'Equipment': 'EQP',
  'Consumables': 'CON',
  'Software': 'SW',
  'Hardware': 'HW',
  'Furniture': 'FUR',
  'Civil Works': 'CW',
  'Security': 'SE',
  'Rollout': 'RO',
  'Safety Equipment': 'SAF',
  'Maintenance Supplies': 'MNT',
  'Personal Accessories': 'PA',
  'Spares': 'SPR',
  'Expense': 'EX',
  'Other': 'OTH'
};

const SUBCATEGORIES = {
  'IT Accessories': ['Input Devices', 'Displays', 'Storage Devices', 'Cables & Connectors', 'Other IT'],
  'Office Supplies': ['Paper Products', 'Writing Materials', 'Filing & Organization', 'Presentation Materials'],
  'Equipment': ['Audio/Visual', 'Computing Equipment', 'Telecommunication', 'Other Equipment'],
  'Hardware': ['Memory', 'Storage', 'Processors', 'Motherboards', 'Other Hardware'],
  'Consumables': ['Printer Supplies', 'Cleaning Supplies', 'Kitchen Supplies', 'Other Consumables'],
  'Software': ['Operating Systems', 'Applications', 'Utilities', 'Other Software'],
  'Furniture': ['Office Chairs', 'Desks', 'Storage', 'Meeting Room', 'Other Furniture'],
  'Safety Equipment': ['PPE', 'First Aid', 'Fire Safety', 'Other Safety'],
  'Maintenance Supplies': ['Cleaning', 'Repair Tools', 'Spare Parts', 'Other Maintenance'],
  'Personal Accessories': ['Electronics', 'Household Items', 'Personal Care', 'Entertainment', 'Other Personal'],
  'Spares': ['Spares'],
  'Civil Works': ['Civil Works'],
  'Security': ['Security'],
  'Rollout': ['Rollout'],
  'Other': ['Miscellaneous']
};

const DEFAULT_PAGINATION = {
  page: 1,
  limit: 20
};

/**
 * Generate unique item code based on category using atomic counter
 * @param {string} category 
 * @returns {Promise<string>} 
 */
const generateItemCodeAtomic = async (category) => {
  try {
    const prefix = CATEGORY_CODE_MAP[category] || 'ITM';
    
    // Atomically increment the counter for this prefix
    const counter = await Counter.findOneAndUpdate(
      { _id: `item_${prefix}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    
    const code = `${prefix}-${String(counter.seq).padStart(3, '0')}`;
    
    // Verify uniqueness (extra safety check)
    const existing = await Item.findOne({ code });
    if (existing) {
      // If somehow exists, recursively try again
      console.warn(`Code ${code} already exists, regenerating...`);
      return generateItemCodeAtomic(category);
    }
    
    return code;
    
  } catch (error) {
    console.error('Error generating item code:', error);
    throw new Error('Failed to generate item code');
  }
};

/**
 * Check if user has supply chain permissions
 * @param {Object} user 
 * @returns {boolean} 
 */
const hasSupplyChainPermissions = (user) => {
  return ['admin', 'supply_chain'].includes(user.role) || 
         user.department === 'Business Development & Supply Chain';
};

/**
 * Build search filter for items
 * @param {Object} query 
 * @returns {Object} 
 */
const buildItemFilter = (query) => {
  const { category, isActive, search } = query;
  let filter = {};
  
  if (category && category !== 'all') {
    filter.category = category;
  }
  
  if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  }
  
  if (search) {
    filter.$or = [
      { description: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } },
      { specifications: { $regex: search, $options: 'i' } }
    ];
  }

  return filter;
};

/**
 * Build pagination object
 * @param {number} page
 * @param {number} limit 
 * @param {number} total 
 * @param {number} count 
 * @returns {Object} 
 */
const buildPagination = (page, limit, total, count) => ({
  current: parseInt(page),
  total: Math.ceil(total / limit),
  count,
  totalRecords: total
});

/**
 * Handle safe field updates
 * @param {Object} item 
 * @param {Object} updateData 
 * @param {Array} allowedFields 
 */
const updateItemFields = (item, updateData, allowedFields) => {
  allowedFields.forEach(field => {
    if (updateData[field] !== undefined) {
      if (field === 'standardPrice' && updateData[field]) {
        item[field] = parseFloat(updateData[field]);
      } else if (field === 'subcategory') {
        item[field] = updateData[field] || undefined;
      } else {
        item[field] = updateData[field];
      }
    }
  });
  item.lastUpdated = new Date();
};

/**
 * Get all items with filtering and pagination
 */
const getAllItems = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      category, 
      isActive, 
      search 
    } = req.query;

    // Build filter
    const filter = buildItemFilter({ category, isActive, search });

    // Parse pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Get total count
    const total = await Item.countDocuments(filter);

    // Get items with pagination
    const items = await Item.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Build pagination info
    const pagination = buildPagination(pageNum, limitNum, total, items.length);

    res.json({
      success: true,
      items: items,
      pagination,
      total: items.length
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch items',
      error: error.message
    });
  }
};

/**
 * Get active items only (for forms and dropdowns)
 */
const getActiveItems = async (req, res) => {
  try {
    const { category } = req.query;
    
    let filter = { isActive: true };
    if (category && category !== 'all') {
      filter.category = category;
    }

    const items = await Item.find(filter)
      .select('code description category subcategory unitOfMeasure standardPrice')
      .sort({ category: 1, description: 1 });

    res.json({
      success: true,
      data: items
    });

  } catch (error) {
    console.error('Get active items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active items',
      error: error.message
    });
  }
};

/**
 * Get single item by ID
 */
const getItemById = async (req, res) => {
  try {
    const item = await Item.findById(req.params.id)
      .populate('createdBy', 'fullName email')
      .populate('requestId');

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    res.json({
      success: true,
      data: item
    });

  } catch (error) {
    console.error('Get item by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch item',
      error: error.message
    });
  }
};

/**
 * Create new item (Supply Chain only) - WITH RETRY LOGIC
 */
const createItem = async (req, res) => {
  const maxRetries = 3;
  let lastError;

  try {
    const user = await User.findById(req.user.userId);
    
    if (!hasSupplyChainPermissions(user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only supply chain team can create items.'
      });
    }

    const {
      description,
      category,
      subcategory,
      unitOfMeasure,
      itemType,
      imageUrl,
      standardPrice,
      supplier,
      specifications,
      requestId
    } = req.body;

    // Retry logic for code generation
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const code = await generateItemCodeAtomic(category);

        const item = new Item({
          code,
          description,
          category,
          subcategory: subcategory || undefined,
          unitOfMeasure,
          itemType: itemType || 'expense',
          imageUrl: imageUrl || undefined,
          standardPrice: standardPrice ? parseFloat(standardPrice) : undefined,
          supplier,
          specifications,
          createdBy: req.user.userId,
          requestId,
          isActive: true
        });

        await item.save();
        await item.populate('createdBy', 'fullName email');

        return res.status(201).json({
          success: true,
          message: 'Item created successfully',
          data: item
        });

      } catch (error) {
        lastError = error;
        
        // If it's a duplicate key error and we have retries left, try again
        if (error.code === 11000 && attempt < maxRetries - 1) {
          console.warn(`Duplicate code detected on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
          continue;
        }
        
        // If it's not a duplicate error or we're out of retries, throw
        throw error;
      }
    }

    // If we exhausted all retries
    throw lastError;

  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create item',
      error: error.message
    });
  }
};

/**
 * Update existing item (Supply Chain only)
 */
const updateItem = async (req, res) => {
  try {
    console.log('Update item request:', {
      params: req.params,
      body: req.body,
      userId: req.user?.userId
    });
    
    const user = await User.findById(req.user.userId);
    
    if (!hasSupplyChainPermissions(user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only supply chain team can update items.'
      });
    }

    const item = await Item.findById(req.params.id);
    if (!item) {
      console.log('Item not found with ID:', req.params.id);
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    console.log('Found item:', item._id);

    const allowedFields = [
      'description', 'category', 'subcategory', 'unitOfMeasure',
      'itemType', 'imageUrl', 'standardPrice', 'supplier', 'specifications'
    ];

    updateItemFields(item, req.body, allowedFields);
    item.lastUpdatedBy = req.user.userId;
    
    console.log('Updated item before save:', item);
    
    await item.save();
    await item.populate('createdBy', 'fullName email');

    res.json({
      success: true,
      message: 'Item updated successfully',
      data: item
    });

  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update item',
      error: error.message
    });
  }
};

/**
 * Toggle item active status (Supply Chain only)
 */
const toggleItemStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    if (!hasSupplyChainPermissions(user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only supply chain team can toggle item status.'
      });
    }

    const { isActive } = req.body;
    
    const item = await Item.findByIdAndUpdate(
      req.params.id,
      { 
        isActive: isActive,
        lastUpdated: new Date()
      },
      { new: true }
    ).populate('createdBy', 'fullName email');

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    res.json({
      success: true,
      message: `Item ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: item
    });

  } catch (error) {
    console.error('Toggle item status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle item status',
      error: error.message
    });
  }
};

/**
 * Delete item (Supply Chain only)
 */
const deleteItem = async (req, res) => {
  try {
    console.log('Delete item request - params:', req.params, 'id:', req.params.id);
    
    // Validate item ID
    if (!req.params.id || req.params.id === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Invalid item ID provided'
      });
    }

    const user = await User.findById(req.user.userId);
    
    if (!hasSupplyChainPermissions(user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only supply chain team can delete items.'
      });
    }

    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Clean up associated image file if exists
    if (item.imageUrl) {
      try {
        const fs = require('fs');
        const path = require('path');
        
        // Check if it's a local file (not a base64 or external URL)
        if (item.imageUrl && !item.imageUrl.startsWith('data:') && !item.imageUrl.startsWith('http')) {
          const imagePath = path.join(__dirname, '../uploads/attachments', item.imageUrl);
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
            console.log('Deleted associated image file:', item.imageUrl);
          }
        }
      } catch (fileError) {
        console.warn('Failed to delete associated image file:', fileError.message);
        // Continue with item deletion even if file cleanup fails
      }
    }

    await Item.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Item deleted successfully'
    });

  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete item',
      error: error.message
    });
  }
};

/**
 * Search items with query
 */
const searchItems = async (req, res) => {
  try {
    const { q, category, limit = 20 } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    let filter = {
      isActive: true,
      $or: [
        { description: { $regex: q, $options: 'i' } },
        { code: { $regex: q, $options: 'i' } },
        { specifications: { $regex: q, $options: 'i' } }
      ]
    };

    if (category && category !== 'all') {
      filter.category = category;
    }

    const items = await Item.find(filter)
      .select('code description category subcategory unitOfMeasure standardPrice')
      .limit(parseInt(limit))
      .sort({ description: 1 });

    res.json({
      success: true,
      data: items,
      count: items.length
    });

  } catch (error) {
    console.error('Search items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search items',
      error: error.message
    });
  }
};

/**
 * Get categories and subcategories with statistics
 */
const getCategories = async (req, res) => {
  try {
    const categoryStats = await Item.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        subcategories: SUBCATEGORIES,
        categoryStats
      }
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories',
      error: error.message
    });
  }
};

/**
 * Submit new item request (Employee)
 */
const requestNewItem = async (req, res) => {
  try {
    const employee = await User.findById(req.user.userId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const {
      description,
      category,
      subcategory,
      unitOfMeasure,
      justification,
      estimatedPrice,
      preferredSupplier,
      urgency,
      additionalNotes
    } = req.body;

    // Validation
    if (!justification || justification.length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Justification must be at least 20 characters long'
      });
    }

    const itemRequest = new ItemRequest({
      employee: req.user.userId,
      description,
      category,
      subcategory: subcategory || undefined,
      unitOfMeasure,
      justification,
      estimatedPrice: estimatedPrice ? parseFloat(estimatedPrice) : undefined,
      preferredSupplier,
      urgency,
      additionalNotes,
      department: employee.department,
      requestedBy: employee.fullName || employee.email,
      status: 'pending'
    });

    await itemRequest.save();
    await itemRequest.populate('employee', 'fullName email department');

    res.status(201).json({
      success: true,
      message: 'Item request submitted successfully',
      data: itemRequest
    });

  } catch (error) {
    console.error('Request new item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit item request',
      error: error.message
    });
  }
};

/**
 * Get item requests based on user role
 */
const getItemRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const { status = 'all', page = 1, limit = 20 } = req.query;

    let filter = {};
    
    // Role-based access control
    if (user.role === 'admin' || hasSupplyChainPermissions(user)) {
      // Admin and supply chain see all requests
    } else if (user.role === 'employee') {
      // Employees see only their own requests
      filter.employee = req.user.userId;
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    if (status !== 'all') {
      filter.status = status;
    }

    const [requests, total] = await Promise.all([
      ItemRequest.find(filter)
        .populate('employee', 'fullName email department')
        .populate('createdItem', 'code description')
        .populate('supplyChainReview.reviewedBy', 'fullName')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit),
      ItemRequest.countDocuments(filter)
    ]);

    const pagination = buildPagination(page, limit, total, requests.length);

    res.json({
      success: true,
      data: requests,
      pagination
    });

  } catch (error) {
    console.error('Get item requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch item requests',
      error: error.message
    });
  }
};

/**
 * Get employee's own item requests
 */
const getEmployeeItemRequests = async (req, res) => {
  try {
    const { status = 'all', page = 1, limit = 20 } = req.query;
    
    let filter = { employee: req.user.userId };
    
    if (status !== 'all') {
      filter.status = status;
    }

    const [requests, total] = await Promise.all([
      ItemRequest.find(filter)
        .populate('employee', 'fullName email department')
        .populate('createdItem', 'code description')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit),
      ItemRequest.countDocuments(filter)
    ]);

    const pagination = buildPagination(page, limit, total, requests.length);

    res.json({
      success: true,
      data: { requests, pagination }
    });

  } catch (error) {
    console.error('Get employee item requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your item requests',
      error: error.message
    });
  }
};

/**
 * Process item request (Supply Chain)
 */
const processItemRequest = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const { requestId } = req.params;
    const { action, itemData, rejectionReason } = req.body;

    if (!hasSupplyChainPermissions(user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only supply chain team can process item requests.'
      });
    }

    const itemRequest = await ItemRequest.findById(requestId)
      .populate('employee', 'fullName email department');

    if (!itemRequest) {
      return res.status(404).json({
        success: false,
        message: 'Item request not found'
      });
    }

    if (itemRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Item request has already been processed'
      });
    }

    let newItem = null;

    // Process based on action
    switch (action) {
      case 'create_item':
        const code = await generateItemCodeAtomic(itemData.category);
        
        newItem = new Item({
          code,
          description: itemData.description,
          category: itemData.category,
          subcategory: itemData.subcategory || undefined,
          unitOfMeasure: itemData.unitOfMeasure,
          standardPrice: itemData.standardPrice ? parseFloat(itemData.standardPrice) : undefined,
          supplier: itemData.supplier,
          specifications: itemData.specifications,
          createdBy: req.user.userId,
          requestId: itemRequest._id,
          isActive: true
        });

        await newItem.save();

        itemRequest.status = 'completed';
        itemRequest.createdItem = newItem._id;
        itemRequest.itemCode = newItem.code;
        itemRequest.response = `Item has been added to the database with code: ${newItem.code}`;
        itemRequest.supplyChainReview = {
          reviewedBy: req.user.userId,
          decision: 'create_item',
          comments: 'Item created and added to database',
          reviewDate: new Date()
        };
        break;

      case 'approve':
        itemRequest.status = 'approved';
        itemRequest.response = 'Request approved but item not yet added to database';
        itemRequest.supplyChainReview = {
          reviewedBy: req.user.userId,
          decision: 'approve',
          comments: 'Request approved for future consideration',
          reviewDate: new Date()
        };
        break;

      case 'reject':
        itemRequest.status = 'rejected';
        itemRequest.response = rejectionReason || 'Request has been rejected';
        itemRequest.supplyChainReview = {
          reviewedBy: req.user.userId,
          decision: 'reject',
          comments: rejectionReason,
          reviewDate: new Date()
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action specified'
        });
    }

    await itemRequest.save();

    res.json({
      success: true,
      message: `Item request ${action}d successfully`,
      data: {
        request: itemRequest,
        item: newItem
      }
    });

  } catch (error) {
    console.error('Process item request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process item request',
      error: error.message
    });
  }
};

/**
 * Validate items for purchase requisition
 */
const validateItems = async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        message: 'Items array is required'
      });
    }

    const itemIds = items.map(item => item.itemId);

    const validItems = await Item.find({
      _id: { $in: itemIds },
      isActive: true
    }).select('_id code description category subcategory unitOfMeasure standardPrice');

    const foundIds = validItems.map(item => item._id.toString());
    const invalidItems = items.filter(item => !foundIds.includes(item.itemId));

    res.json({
      success: true,
      data: {
        validItems,
        invalidItems: invalidItems.map(item => ({
          itemId: item.itemId,
          description: item.description,
          reason: 'Item not found or inactive in database'
        })),
        validCount: validItems.length,
        invalidCount: invalidItems.length
      }
    });

  } catch (error) {
    console.error('Validate items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate items',
      error: error.message
    });
  }
};

/**
 * Import items (placeholder for future implementation)
 */
const importItems = async (req, res) => {
  try {
    // TODO: Implement CSV/Excel import functionality
    res.json({
      success: true,
      message: 'Import functionality not yet implemented',
      data: { imported: 0, errors: [], skipped: 0 }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to import items',
      error: error.message
    });
  }
};

/**
 * Export items (placeholder for future implementation)
 */
const exportItems = async (req, res) => {
  try {
    // TODO: Implement CSV/Excel export functionality
    res.json({
      success: true,
      message: 'Export functionality not yet implemented',
      data: null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to export items',
      error: error.message
    });
  }
};

/**
 * Upload item image
 * @param {object} req 
 * @param {object} res 
 */
const uploadItemImage = async (req, res) => {
  try {
    console.log('Upload request received:', {
      file: req.file ? { 
        filename: req.file.filename, 
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      } : null,
      body: req.body
    });

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file uploaded'
      });
    }

    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (!allowedMimes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only JPEG, PNG, and GIF images are allowed.'
      });
    }

    const fs = require('fs');
    const path = require('path');
    
    const timestamp = Date.now();
    const ext = path.extname(req.file.originalname);
    const baseFilename = path.basename(req.file.filename, path.extname(req.file.filename));
    const finalFilename = `item_${timestamp}_${baseFilename}${ext}`;
    
    const tempPath = req.file.path;
    const permanentDir = path.join(__dirname, '../uploads/attachments');
    const permanentPath = path.join(permanentDir, finalFilename);
    
    if (!fs.existsSync(permanentDir)) {
      fs.mkdirSync(permanentDir, { recursive: true });
    }
    
    fs.renameSync(tempPath, permanentPath);
    
    console.log('File moved from temp to permanent storage:', {
      from: tempPath,
      to: permanentPath,
      finalFilename
    });

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        filename: finalFilename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        imageUrl: finalFilename
      }
    });

  } catch (error) {
    console.error('Image upload error:', error);
    
    if (req.file && req.file.path && require('fs').existsSync(req.file.path)) {
      try {
        require('fs').unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp file:', cleanupError.message);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
};

module.exports = {
  // Item management
  getAllItems,
  getActiveItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  toggleItemStatus,
  searchItems,
  getCategories,
  uploadItemImage,
  
  // Item requests
  requestNewItem,
  getItemRequests,
  processItemRequest,
  getEmployeeItemRequests,
  
  // Import/Export
  importItems,
  exportItems,
  
  // Utilities
  validateItems
};










// const Item = require('../models/Item');
// const ItemRequest = require('../models/ItemRequest');
// const User = require('../models/User');
// const { sendEmail } = require('../services/emailService');

// const CATEGORY_CODE_MAP = {
//   'IT Accessories': 'IT',
//   'Office Supplies': 'OFF',
//   'Equipment': 'EQP',
//   'Consumables': 'CON',
//   'Software': 'SW',
//   'Hardware': 'HW',
//   'Furniture': 'FUR',
//   'Safety Equipment': 'SAF',
//   'Maintenance Supplies': 'MNT',
//   'Personal Accessories': 'PA',
//   'Spares': 'SPR',
//   'Expense': 'EX',
//   'Other': 'OTH'
// };

// const SUBCATEGORIES = {
//   'IT Accessories': ['Input Devices', 'Displays', 'Storage Devices', 'Cables & Connectors', 'Other IT'],
//   'Office Supplies': ['Paper Products', 'Writing Materials', 'Filing & Organization', 'Presentation Materials'],
//   'Equipment': ['Audio/Visual', 'Computing Equipment', 'Telecommunication', 'Other Equipment'],
//   'Hardware': ['Memory', 'Storage', 'Processors', 'Motherboards', 'Other Hardware'],
//   'Consumables': ['Printer Supplies', 'Cleaning Supplies', 'Kitchen Supplies', 'Other Consumables'],
//   'Software': ['Operating Systems', 'Applications', 'Utilities', 'Other Software'],
//   'Furniture': ['Office Chairs', 'Desks', 'Storage', 'Meeting Room', 'Other Furniture'],
//   'Safety Equipment': ['PPE', 'First Aid', 'Fire Safety', 'Other Safety'],
//   'Maintenance Supplies': ['Cleaning', 'Repair Tools', 'Spare Parts', 'Other Maintenance'],
//   'Personal Accessories': ['Electronics', 'Household Items', 'Personal Care', 'Entertainment', 'Other Personal'],
//   'Spares': ['Spares'],
//   'Other': ['Miscellaneous']
// };

// const DEFAULT_PAGINATION = {
//   page: 1,
//   limit: 20
// };

// /**
//  * Generate unique item code based on category
//  * @param {string} category 
//  * @returns {Promise<string>} 
//  */
// const generateItemCode = async (category) => {
//   try {
//     const prefix = CATEGORY_CODE_MAP[category] || 'ITM';
//     const count = await Item.countDocuments({ category }) + 1;
//     const number = String(count).padStart(3, '0');
//     return `${prefix}-${number}`;
//   } catch (error) {
//     console.error('Error generating item code:', error);
//     throw new Error('Failed to generate item code');
//   }
// };

// /**
//  * Check if user has supply chain permissions
//  * @param {Object} user 
//  * @returns {boolean} 
//  */
// const hasSupplyChainPermissions = (user) => {
//   return ['admin', 'supply_chain'].includes(user.role) || 
//          user.department === 'Business Development & Supply Chain';
// };

// /**
//  * Build search filter for items
//  * @param {Object} query 
//  * @returns {Object} 
//  */
// const buildItemFilter = (query) => {
//   const { category, isActive, search } = query;
//   let filter = {};
  
//   if (category && category !== 'all') {
//     filter.category = category;
//   }
  
//   if (isActive !== undefined) {
//     filter.isActive = isActive === 'true';
//   }
  
//   if (search) {
//     filter.$or = [
//       { description: { $regex: search, $options: 'i' } },
//       { code: { $regex: search, $options: 'i' } },
//       { specifications: { $regex: search, $options: 'i' } }
//     ];
//   }

//   return filter;
// };

// /**
//  * Build pagination object
//  * @param {number} page
//  * @param {number} limit 
//  * @param {number} total 
//  * @param {number} count 
//  * @returns {Object} 
//  */
// const buildPagination = (page, limit, total, count) => ({
//   current: parseInt(page),
//   total: Math.ceil(total / limit),
//   count,
//   totalRecords: total
// });

// /**
//  * Handle safe field updates
//  * @param {Object} item 
//  * @param {Object} updateData 
//  * @param {Array} allowedFields 
//  */
// const updateItemFields = (item, updateData, allowedFields) => {
//   allowedFields.forEach(field => {
//     if (updateData[field] !== undefined) {
//       if (field === 'standardPrice' && updateData[field]) {
//         item[field] = parseFloat(updateData[field]);
//       } else if (field === 'subcategory') {
//         item[field] = updateData[field] || undefined;
//       } else {
//         item[field] = updateData[field];
//       }
//     }
//   });
//   item.lastUpdated = new Date();
// };

// /**
//  * Get all items with filtering and pagination
//  */
// const getAllItems = async (req, res) => {
//   try {
//     const { 
//       page = 1, 
//       limit = 20, 
//       category, 
//       isActive, 
//       search 
//     } = req.query;

//     // Build filter
//     const filter = buildItemFilter({ category, isActive, search });

//     // Parse pagination
//     const pageNum = Math.max(1, parseInt(page));
//     const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
//     const skip = (pageNum - 1) * limitNum;

//     // Get total count
//     const total = await Item.countDocuments(filter);

//     // Get items with pagination
//     const items = await Item.find(filter)
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limitNum)
//       .lean();

//     // Build pagination info
//     const pagination = buildPagination(pageNum, limitNum, total, items.length);

//     res.json({
//       success: true,
//       items: items,
//       pagination,
//       total: items.length
//     });
//   } catch (error) {
//     console.error('Error fetching items:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch items',
//       error: error.message
//     });
//   }
// };


// /**
//  * Get active items only (for forms and dropdowns)
//  */
// const getActiveItems = async (req, res) => {
//   try {
//     const { category } = req.query;
    
//     let filter = { isActive: true };
//     if (category && category !== 'all') {
//       filter.category = category;
//     }

//     const items = await Item.find(filter)
//       .select('code description category subcategory unitOfMeasure standardPrice')
//       .sort({ category: 1, description: 1 });

//     res.json({
//       success: true,
//       data: items
//     });

//   } catch (error) {
//     console.error('Get active items error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch active items',
//       error: error.message
//     });
//   }
// };

// /**
//  * Get single item by ID
//  */
// const getItemById = async (req, res) => {
//   try {
//     const item = await Item.findById(req.params.id)
//       .populate('createdBy', 'fullName email')
//       .populate('requestId');

//     if (!item) {
//       return res.status(404).json({
//         success: false,
//         message: 'Item not found'
//       });
//     }

//     res.json({
//       success: true,
//       data: item
//     });

//   } catch (error) {
//     console.error('Get item by ID error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch item',
//       error: error.message
//     });
//   }
// };

// /**
//  * Create new item (Supply Chain only)
//  */
// const createItem = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
    
//     if (!hasSupplyChainPermissions(user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Only supply chain team can create items.'
//       });
//     }

//     const {
//       description,
//       category,
//       subcategory,
//       unitOfMeasure,
//       itemType,
//       imageUrl,
//       standardPrice,
//       supplier,
//       specifications,
//       requestId
//     } = req.body;

//     const code = await generateItemCode(category);

//     const item = new Item({
//       code,
//       description,
//       category,
//       subcategory: subcategory || undefined,
//       unitOfMeasure,
//       itemType: itemType || 'expense',
//       imageUrl: imageUrl || undefined,
//       standardPrice: standardPrice ? parseFloat(standardPrice) : undefined,
//       supplier,
//       specifications,
//       createdBy: req.user.userId,
//       requestId,
//       isActive: true
//     });

//     await item.save();
//     await item.populate('createdBy', 'fullName email');

//     res.status(201).json({
//       success: true,
//       message: 'Item created successfully',
//       data: item
//     });

//   } catch (error) {
//     console.error('Create item error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create item',
//       error: error.message
//     });
//   }
// };

// /**
//  * Update existing item (Supply Chain only)
//  */
// const updateItem = async (req, res) => {
//   try {
//     console.log('Update item request:', {
//       params: req.params,
//       body: req.body,
//       userId: req.user?.userId
//     });
    
//     const user = await User.findById(req.user.userId);
    
//     if (!hasSupplyChainPermissions(user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Only supply chain team can update items.'
//       });
//     }

//     const item = await Item.findById(req.params.id);
//     if (!item) {
//       console.log('Item not found with ID:', req.params.id);
//       return res.status(404).json({
//         success: false,
//         message: 'Item not found'
//       });
//     }

//     console.log('Found item:', item._id);

//     const allowedFields = [
//       'description', 'category', 'subcategory', 'unitOfMeasure',
//       'itemType', 'imageUrl', 'standardPrice', 'supplier', 'specifications'
//     ];

//     updateItemFields(item, req.body, allowedFields);
//     item.lastUpdatedBy = req.user.userId;
    
//     console.log('Updated item before save:', item);
    
//     await item.save();
//     await item.populate('createdBy', 'fullName email');

//     res.json({
//       success: true,
//       message: 'Item updated successfully',
//       data: item
//     });

//   } catch (error) {
//     console.error('Update item error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update item',
//       error: error.message
//     });
//   }
// };

// /**
//  * Toggle item active status (Supply Chain only)
//  */
// const toggleItemStatus = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
    
//     if (!hasSupplyChainPermissions(user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Only supply chain team can toggle item status.'
//       });
//     }

//     const { isActive } = req.body;
    
//     const item = await Item.findByIdAndUpdate(
//       req.params.id,
//       { 
//         isActive: isActive,
//         lastUpdated: new Date()
//       },
//       { new: true }
//     ).populate('createdBy', 'fullName email');

//     if (!item) {
//       return res.status(404).json({
//         success: false,
//         message: 'Item not found'
//       });
//     }

//     res.json({
//       success: true,
//       message: `Item ${isActive ? 'activated' : 'deactivated'} successfully`,
//       data: item
//     });

//   } catch (error) {
//     console.error('Toggle item status error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to toggle item status',
//       error: error.message
//     });
//   }
// };

// /**
//  * Delete item (Supply Chain only)
//  */
// const deleteItem = async (req, res) => {
//   try {
//     console.log('Delete item request - params:', req.params, 'id:', req.params.id);
    
//     // Validate item ID
//     if (!req.params.id || req.params.id === 'undefined') {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid item ID provided'
//       });
//     }

//     const user = await User.findById(req.user.userId);
    
//     if (!hasSupplyChainPermissions(user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Only supply chain team can delete items.'
//       });
//     }

//     const item = await Item.findById(req.params.id);
//     if (!item) {
//       return res.status(404).json({
//         success: false,
//         message: 'Item not found'
//       });
//     }

//     // Clean up associated image file if exists
//     if (item.imageUrl) {
//       try {
//         const fs = require('fs');
//         const path = require('path');
        
//         // Check if it's a local file (not a base64 or external URL)
//         if (item.imageUrl && !item.imageUrl.startsWith('data:') && !item.imageUrl.startsWith('http')) {
//           const imagePath = path.join(__dirname, '../uploads/attachments', item.imageUrl);
//           if (fs.existsSync(imagePath)) {
//             fs.unlinkSync(imagePath);
//             console.log('Deleted associated image file:', item.imageUrl);
//           }
//         }
//       } catch (fileError) {
//         console.warn('Failed to delete associated image file:', fileError.message);
//         // Continue with item deletion even if file cleanup fails
//       }
//     }

//     await Item.findByIdAndDelete(req.params.id);

//     res.json({
//       success: true,
//       message: 'Item deleted successfully'
//     });

//   } catch (error) {
//     console.error('Delete item error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete item',
//       error: error.message
//     });
//   }
// };

// /**
//  * Search items with query
//  */
// const searchItems = async (req, res) => {
//   try {
//     const { q, category, limit = 20 } = req.query;

//     if (!q || q.length < 2) {
//       return res.status(400).json({
//         success: false,
//         message: 'Search query must be at least 2 characters'
//       });
//     }

//     let filter = {
//       isActive: true,
//       $or: [
//         { description: { $regex: q, $options: 'i' } },
//         { code: { $regex: q, $options: 'i' } },
//         { specifications: { $regex: q, $options: 'i' } }
//       ]
//     };

//     if (category && category !== 'all') {
//       filter.category = category;
//     }

//     const items = await Item.find(filter)
//       .select('code description category subcategory unitOfMeasure standardPrice')
//       .limit(parseInt(limit))
//       .sort({ description: 1 });

//     res.json({
//       success: true,
//       data: items,
//       count: items.length
//     });

//   } catch (error) {
//     console.error('Search items error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to search items',
//       error: error.message
//     });
//   }
// };

// /**
//  * Get categories and subcategories with statistics
//  */
// const getCategories = async (req, res) => {
//   try {
//     const categoryStats = await Item.aggregate([
//       { $match: { isActive: true } },
//       {
//         $group: {
//           _id: '$category',
//           count: { $sum: 1 }
//         }
//       },
//       { $sort: { _id: 1 } }
//     ]);

//     res.json({
//       success: true,
//       data: {
//         subcategories: SUBCATEGORIES,
//         categoryStats
//       }
//     });

//   } catch (error) {
//     console.error('Get categories error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch categories',
//       error: error.message
//     });
//   }
// };

// /**
//  * Submit new item request (Employee)
//  */
// const requestNewItem = async (req, res) => {
//   try {
//     const employee = await User.findById(req.user.userId);
//     if (!employee) {
//       return res.status(404).json({
//         success: false,
//         message: 'Employee not found'
//       });
//     }

//     const {
//       description,
//       category,
//       subcategory,
//       unitOfMeasure,
//       justification,
//       estimatedPrice,
//       preferredSupplier,
//       urgency,
//       additionalNotes
//     } = req.body;

//     // Validation
//     if (!justification || justification.length < 20) {
//       return res.status(400).json({
//         success: false,
//         message: 'Justification must be at least 20 characters long'
//       });
//     }

//     const itemRequest = new ItemRequest({
//       employee: req.user.userId,
//       description,
//       category,
//       subcategory: subcategory || undefined,
//       unitOfMeasure,
//       justification,
//       estimatedPrice: estimatedPrice ? parseFloat(estimatedPrice) : undefined,
//       preferredSupplier,
//       urgency,
//       additionalNotes,
//       department: employee.department,
//       requestedBy: employee.fullName || employee.email,
//       status: 'pending'
//     });

//     await itemRequest.save();
//     await itemRequest.populate('employee', 'fullName email department');

//     res.status(201).json({
//       success: true,
//       message: 'Item request submitted successfully',
//       data: itemRequest
//     });

//   } catch (error) {
//     console.error('Request new item error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to submit item request',
//       error: error.message
//     });
//   }
// };

// /**
//  * Get item requests based on user role
//  */
// const getItemRequests = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const { status = 'all', page = 1, limit = 20 } = req.query;

//     let filter = {};
    
//     // Role-based access control
//     if (user.role === 'admin' || hasSupplyChainPermissions(user)) {
//       // Admin and supply chain see all requests
//     } else if (user.role === 'employee') {
//       // Employees see only their own requests
//       filter.employee = req.user.userId;
//     } else {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Insufficient permissions.'
//       });
//     }

//     if (status !== 'all') {
//       filter.status = status;
//     }

//     const [requests, total] = await Promise.all([
//       ItemRequest.find(filter)
//         .populate('employee', 'fullName email department')
//         .populate('createdItem', 'code description')
//         .populate('supplyChainReview.reviewedBy', 'fullName')
//         .sort({ createdAt: -1 })
//         .limit(limit * 1)
//         .skip((page - 1) * limit),
//       ItemRequest.countDocuments(filter)
//     ]);

//     const pagination = buildPagination(page, limit, total, requests.length);

//     res.json({
//       success: true,
//       data: requests,
//       pagination
//     });

//   } catch (error) {
//     console.error('Get item requests error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch item requests',
//       error: error.message
//     });
//   }
// };

// /**
//  * Get employee's own item requests
//  */
// const getEmployeeItemRequests = async (req, res) => {
//   try {
//     const { status = 'all', page = 1, limit = 20 } = req.query;
    
//     let filter = { employee: req.user.userId };
    
//     if (status !== 'all') {
//       filter.status = status;
//     }

//     const [requests, total] = await Promise.all([
//       ItemRequest.find(filter)
//         .populate('employee', 'fullName email department')
//         .populate('createdItem', 'code description')
//         .sort({ createdAt: -1 })
//         .limit(limit * 1)
//         .skip((page - 1) * limit),
//       ItemRequest.countDocuments(filter)
//     ]);

//     const pagination = buildPagination(page, limit, total, requests.length);

//     res.json({
//       success: true,
//       data: { requests, pagination }
//     });

//   } catch (error) {
//     console.error('Get employee item requests error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch your item requests',
//       error: error.message
//     });
//   }
// };

// /**
//  * Process item request (Supply Chain)
//  */
// const processItemRequest = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const { requestId } = req.params;
//     const { action, itemData, rejectionReason } = req.body;

//     if (!hasSupplyChainPermissions(user)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Only supply chain team can process item requests.'
//       });
//     }

//     const itemRequest = await ItemRequest.findById(requestId)
//       .populate('employee', 'fullName email department');

//     if (!itemRequest) {
//       return res.status(404).json({
//         success: false,
//         message: 'Item request not found'
//       });
//     }

//     if (itemRequest.status !== 'pending') {
//       return res.status(400).json({
//         success: false,
//         message: 'Item request has already been processed'
//       });
//     }

//     let newItem = null;

//     // Process based on action
//     switch (action) {
//       case 'create_item':
//         const code = await generateItemCode(itemData.category);
        
//         newItem = new Item({
//           code,
//           description: itemData.description,
//           category: itemData.category,
//           subcategory: itemData.subcategory || undefined,
//           unitOfMeasure: itemData.unitOfMeasure,
//           standardPrice: itemData.standardPrice ? parseFloat(itemData.standardPrice) : undefined,
//           supplier: itemData.supplier,
//           specifications: itemData.specifications,
//           createdBy: req.user.userId,
//           requestId: itemRequest._id,
//           isActive: true
//         });

//         await newItem.save();

//         itemRequest.status = 'completed';
//         itemRequest.createdItem = newItem._id;
//         itemRequest.itemCode = newItem.code;
//         itemRequest.response = `Item has been added to the database with code: ${newItem.code}`;
//         itemRequest.supplyChainReview = {
//           reviewedBy: req.user.userId,
//           decision: 'create_item',
//           comments: 'Item created and added to database',
//           reviewDate: new Date()
//         };
//         break;

//       case 'approve':
//         itemRequest.status = 'approved';
//         itemRequest.response = 'Request approved but item not yet added to database';
//         itemRequest.supplyChainReview = {
//           reviewedBy: req.user.userId,
//           decision: 'approve',
//           comments: 'Request approved for future consideration',
//           reviewDate: new Date()
//         };
//         break;

//       case 'reject':
//         itemRequest.status = 'rejected';
//         itemRequest.response = rejectionReason || 'Request has been rejected';
//         itemRequest.supplyChainReview = {
//           reviewedBy: req.user.userId,
//           decision: 'reject',
//           comments: rejectionReason,
//           reviewDate: new Date()
//         };
//         break;

//       default:
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid action specified'
//         });
//     }

//     await itemRequest.save();

//     res.json({
//       success: true,
//       message: `Item request ${action}d successfully`,
//       data: {
//         request: itemRequest,
//         item: newItem
//       }
//     });

//   } catch (error) {
//     console.error('Process item request error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process item request',
//       error: error.message
//     });
//   }
// };

// /**
//  * Validate items for purchase requisition
//  */
// // In your itemController.js, update the validateItems function:

// const validateItems = async (req, res) => {
//   try {
//     const { items } = req.body; // Get items array instead of itemIds

//     if (!items || !Array.isArray(items)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Items array is required'
//       });
//     }

//     // Extract itemId from each item in the array
//     const itemIds = items.map(item => item.itemId);

//     const validItems = await Item.find({
//       _id: { $in: itemIds },
//       isActive: true
//     }).select('_id code description category subcategory unitOfMeasure standardPrice');

//     const foundIds = validItems.map(item => item._id.toString());
//     const invalidItems = items.filter(item => !foundIds.includes(item.itemId));

//     res.json({
//       success: true,
//       data: {
//         validItems,
//         invalidItems: invalidItems.map(item => ({
//           itemId: item.itemId,
//           description: item.description,
//           reason: 'Item not found or inactive in database'
//         })),
//         validCount: validItems.length,
//         invalidCount: invalidItems.length
//       }
//     });

//   } catch (error) {
//     console.error('Validate items error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to validate items',
//       error: error.message
//     });
//   }
// };

// /**
//  * Import items (placeholder for future implementation)
//  */
// const importItems = async (req, res) => {
//   try {
//     // TODO: Implement CSV/Excel import functionality
//     res.json({
//       success: true,
//       message: 'Import functionality not yet implemented',
//       data: { imported: 0, errors: [], skipped: 0 }
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to import items',
//       error: error.message
//     });
//   }
// };

// /**
//  * Export items (placeholder for future implementation)
//  */
// const exportItems = async (req, res) => {
//   try {
//     // TODO: Implement CSV/Excel export functionality
//     res.json({
//       success: true,
//       message: 'Export functionality not yet implemented',
//       data: null
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to export items',
//       error: error.message
//     });
//   }
// };


// /**
//  * Upload item image
//  * @param {object} req 
//  * @param {object} res 
//  */
// const uploadItemImage = async (req, res) => {
//   try {
//     console.log('Upload request received:', {
//       file: req.file ? { 
//         filename: req.file.filename, 
//         originalname: req.file.originalname,
//         mimetype: req.file.mimetype,
//         size: req.file.size,
//         path: req.file.path
//       } : null,
//       body: req.body
//     });

//     // Check if file was uploaded
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No image file uploaded'
//       });
//     }

//     // Validate file type
//     const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
//     if (!allowedMimes.includes(req.file.mimetype)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid file type. Only JPEG, PNG, and GIF images are allowed.'
//       });
//     }

//     const fs = require('fs');
//     const path = require('path');
    
//     // Generate a unique filename for the permanent storage
//     const timestamp = Date.now();
//     const ext = path.extname(req.file.originalname);
//     const baseFilename = path.basename(req.file.filename, path.extname(req.file.filename));
//     const finalFilename = `item_${timestamp}_${baseFilename}${ext}`;
    
//     // Define paths
//     const tempPath = req.file.path;
//     const permanentDir = path.join(__dirname, '../uploads/attachments');
//     const permanentPath = path.join(permanentDir, finalFilename);
    
//     // Ensure attachments directory exists
//     if (!fs.existsSync(permanentDir)) {
//       fs.mkdirSync(permanentDir, { recursive: true });
//     }
    
//     // Move file from temp to permanent location
//     fs.renameSync(tempPath, permanentPath);
    
//     console.log('File moved from temp to permanent storage:', {
//       from: tempPath,
//       to: permanentPath,
//       finalFilename
//     });

//     // Return the uploaded file information
//     res.json({
//       success: true,
//       message: 'Image uploaded successfully',
//       data: {
//         filename: finalFilename,
//         originalName: req.file.originalname,
//         mimetype: req.file.mimetype,
//         size: req.file.size,
//         imageUrl: finalFilename // This will be used to store in item record
//       }
//     });

//   } catch (error) {
//     console.error('Image upload error:', error);
    
//     // Clean up temp file if it exists
//     if (req.file && req.file.path && require('fs').existsSync(req.file.path)) {
//       try {
//         require('fs').unlinkSync(req.file.path);
//       } catch (cleanupError) {
//         console.warn('Failed to cleanup temp file:', cleanupError.message);
//       }
//     }
    
//     res.status(500).json({
//       success: false,
//       message: 'Failed to upload image',
//       error: error.message
//     });
//   }
// };

// module.exports = {
//   // Item management
//   getAllItems,
//   getActiveItems,
//   getItemById,
//   createItem,
//   updateItem,
//   deleteItem,
//   toggleItemStatus,
//   searchItems,
//   getCategories,
//   uploadItemImage,
  
//   // Item requests
//   requestNewItem,
//   getItemRequests,
//   processItemRequest,
//   getEmployeeItemRequests,
  
//   // Import/Export
//   importItems,
//   exportItems,
  
//   // Utilities
//   validateItems
// };




