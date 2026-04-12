const Item = require('../models/Item');
const Inventory = require('../models/Inventory');
const InventoryInstance = require('../models/InventoryInstance');
const StockTransaction = require('../models/StockTransaction');
const User = require('../models/User');
const Supplier = require('../models/Supplier');
const StockAdjustment = require('../models/StockAdjustment');


/**
 * Generate transaction number
 */
const generateTransactionNumber = async (transactionType) => {
  try {
    const prefix = transactionType === 'inbound' ? 'IN' :
                  transactionType === 'outbound' ? 'OUT' :
                  transactionType === 'adjustment' ? 'ADJ' : 'TRF';
    
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    
    const count = await StockTransaction.countDocuments({
      transactionType: transactionType,
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), 1),
        $lt: new Date(date.getFullYear(), date.getMonth() + 1, 1)
      }
    });
    
    const sequence = count + 1;
    return `${prefix}-${year}${month}-${sequence.toString().padStart(5, '0')}`;
  } catch (error) {
    console.error('Error generating transaction number:', error);
    const prefix = transactionType?.substring(0, 3).toUpperCase() || 'TXN';
    const timestamp = Date.now().toString().slice(-8);
    return `${prefix}-${timestamp}`;
  }
};


/**
 * Get available stock with filters
 * This reads from Inventory collection
 */
const getAvailableStock = async (req, res) => {
  try {
    const {
      category,
      location,
      lowStock,
      search,
      page = 1,
      limit = 50,
      sortBy = 'description',
      sortOrder = 'asc'
    } = req.query;

    // Build filter - use Inventory model
    let filter = { isActive: true };

    if (category && category !== 'all') {
      filter.category = category;
    }

    if (location) {
      filter.location = location;
    }

    if (lowStock === 'true') {
      filter.$expr = { $lte: ['$stockQuantity', '$reorderPoint'] };
    }

    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    // Get items with stock info from Inventory
    const [items, total] = await Promise.all([
      Inventory.find(filter)
        .select('code description category subcategory unitOfMeasure stockQuantity minimumStock reorderPoint standardPrice averageCost location supplier')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Inventory.countDocuments(filter)
    ]);

    // Calculate stock values
    const itemsWithValues = items.map(item => ({
      ...item,
      stockValue: item.stockQuantity * (item.averageCost || item.standardPrice || 0),
      needsReorder: item.stockQuantity <= item.reorderPoint,
      stockStatus: item.stockQuantity === 0 ? 'out-of-stock' :
                   item.stockQuantity <= item.reorderPoint ? 'low-stock' : 'in-stock'
    }));

    // Calculate summary statistics
    const totalStockValue = itemsWithValues.reduce((sum, item) => sum + item.stockValue, 0);
    const lowStockCount = itemsWithValues.filter(item => item.needsReorder).length;
    const outOfStockCount = itemsWithValues.filter(item => item.stockQuantity === 0).length;

    res.json({
      success: true,
      data: {
        items: itemsWithValues,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / parseInt(limit)),
          count: itemsWithValues.length,
          totalRecords: total
        },
        summary: {
          totalItems: total,
          totalStockValue,
          lowStockCount,
          outOfStockCount,
          averageStockValue: total > 0 ? totalStockValue / total : 0
        }
      }
    });
  } catch (error) {
    console.error('Get available stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available stock',
      error: error.message
    });
  }
};

/**
 * FIXED: Record inbound transaction
 */
const recordInbound = async (req, res) => {
  try {
    console.log('=== INBOUND TRANSACTION DEBUG ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('User:', req.user.userId);
    
    const user = await User.findById(req.user.userId);
    console.log('User found:', user ? user.fullName : 'NOT FOUND');
    
    const {
      itemId,
      quantity,
      unitPrice,
      poNumber,
      supplierId,
      supplierName,
      grnNumber,
      inspectionStatus,
      transactionDate,
      comment,
      receivedBy,
      itemInstances
    } = req.body;

    console.log('Searching for itemId:', itemId);
    console.log('ItemId type:', typeof itemId);
    console.log('ItemId length:', itemId?.length);

    // CRITICAL: Check if itemId is valid ObjectId
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      console.error('Invalid ObjectId format:', itemId);
      return res.status(400).json({
        success: false,
        message: 'Invalid item ID format'
      });
    }

    // Try to find in Item collection (catalog)
    console.log('Searching in Item collection...');
    let itemFromCatalog = await Item.findById(itemId);
    console.log('Item from catalog:', itemFromCatalog ? {
      _id: itemFromCatalog._id,
      code: itemFromCatalog.code,
      description: itemFromCatalog.description
    } : 'NOT FOUND');

    // Also try finding in Inventory collection (just in case)
    if (!itemFromCatalog) {
      console.log('Not found in Item, checking Inventory collection...');
      const inventoryItem = await Inventory.findById(itemId);
      console.log('Inventory item:', inventoryItem ? {
        _id: inventoryItem._id,
        code: inventoryItem.code,
        description: inventoryItem.description
      } : 'NOT FOUND');
      
      if (inventoryItem) {
        // If found in Inventory, use it as the catalog item
        itemFromCatalog = inventoryItem;
      }
    }

    // If still not found, check all Items to debug
    if (!itemFromCatalog) {
      console.log('Item not found anywhere. Checking all items...');
      const allItems = await Item.find({}).limit(5);
      console.log('Sample items in database:', allItems.map(i => ({
        _id: i._id.toString(),
        code: i.code,
        description: i.description
      })));
      
      const allInventory = await Inventory.find({}).limit(5);
      console.log('Sample inventory in database:', allInventory.map(i => ({
        _id: i._id.toString(),
        code: i.code,
        description: i.description
      })));
      
      return res.status(404).json({
        success: false,
        message: 'Item not found in catalog or inventory',
        debug: {
          searchedId: itemId,
          searchedIdType: typeof itemId,
          itemsCount: await Item.countDocuments({}),
          inventoryCount: await Inventory.countDocuments({})
        }
      });
    }

    console.log('✓ Item found successfully');

    // Parse itemInstances if it's a string
    let parsedInstances = [];
    if (itemInstances) {
      try {
        parsedInstances = typeof itemInstances === 'string' 
          ? JSON.parse(itemInstances) 
          : itemInstances;
        console.log('Parsed instances:', parsedInstances.length);
      } catch (err) {
        console.error('Error parsing item instances:', err);
      }
    }

    // Get supplier info
    let supplierData = {
      id: null,
      name: supplierName
    };

    if (supplierId) {
      try {
        const supplier = await Supplier.findById(supplierId);
        if (supplier) {
          supplierData = {
            id: supplier._id,
            name: supplier.name || supplier.fullName || supplierName
          };
          console.log('Supplier found:', supplierData.name);
        }
      } catch (err) {
        console.log('Supplier lookup failed:', err.message);
      }
    }

    // Find or create inventory record
    let inventoryItem = await Inventory.findOne({ 
      code: itemFromCatalog.code,
      isActive: true 
    }).sort({ createdAt: -1 });

    if (!inventoryItem) {
      console.log('Creating new inventory record for:', itemFromCatalog.code);
      
      inventoryItem = new Inventory({
        code: itemFromCatalog.code,
        description: itemFromCatalog.description,
        category: itemFromCatalog.category,
        subcategory: itemFromCatalog.subcategory,
        unitOfMeasure: itemFromCatalog.unitOfMeasure,
        itemType: itemFromCatalog.itemType,
        imageUrl: itemFromCatalog.imageUrl,
        standardPrice: itemFromCatalog.standardPrice || unitPrice,
        supplier: itemFromCatalog.supplier || supplierName,
        specifications: itemFromCatalog.specifications,
        stockQuantity: 0,
        minimumStock: 0,
        reorderPoint: 0,
        averageCost: 0,
        createdBy: req.user.userId,
        requestId: itemFromCatalog.requestId
      });
      
      await inventoryItem.save();
      console.log('✓ New inventory item created:', inventoryItem._id);
    } else {
      console.log('✓ Using existing inventory item:', inventoryItem._id);
    }

    const stockBefore = inventoryItem.stockQuantity || 0;
    console.log('Stock before:', stockBefore);

    // Generate transaction number
    const transactionNumber = await generateTransactionNumber('inbound');
    console.log('Generated transaction number:', transactionNumber);

    // Create inbound transaction
    const transaction = new StockTransaction({
      transactionNumber,
      transactionType: 'inbound',
      item: inventoryItem._id,
      quantity: parseFloat(quantity),
      unitPrice: parseFloat(unitPrice),
      transactionDate: transactionDate || new Date(),
      poNumber,
      supplier: supplierData.id,
      supplierName: supplierData.name,
      grnNumber,
      inspectionStatus: inspectionStatus || 'not-required',
      initialQuantity: parseFloat(quantity),
      receivedBy: receivedBy || req.user.userId,
      comment,
      stockBefore,
      stockAfter: stockBefore + parseFloat(quantity),
      status: 'completed',
      createdBy: req.user.userId
    });

    await transaction.save();
    console.log('✓ Transaction saved:', transaction.transactionNumber);

    // Update inventory stock
    const oldStockQuantity = inventoryItem.stockQuantity || 0;
    const oldAverageCost = inventoryItem.averageCost || 0;
    
    inventoryItem.stockQuantity = (inventoryItem.stockQuantity || 0) + parseFloat(quantity);
    inventoryItem.lastStockUpdate = new Date();
    
    // Update average cost
    if (oldStockQuantity > 0) {
      const oldTotalValue = oldStockQuantity * oldAverageCost;
      const newValue = parseFloat(quantity) * parseFloat(unitPrice);
      const totalValue = oldTotalValue + newValue;
      inventoryItem.averageCost = totalValue / inventoryItem.stockQuantity;
    } else {
      inventoryItem.averageCost = parseFloat(unitPrice);
    }
    
    await inventoryItem.save();
    console.log('✓ Inventory updated - New stock:', inventoryItem.stockQuantity);

    // Create inventory instances if provided
    const createdInstances = [];
    if (parsedInstances && parsedInstances.length > 0) {
      console.log('Creating item instances:', parsedInstances.length);
      
      for (let i = 0; i < parsedInstances.length; i++) {
        const instanceData = parsedInstances[i];
        
        // Handle image upload if exists
        let imageUrl = null;
        let imagePublicId = null;
        
        // Check if req.files exists (for multer)
        if (req.files && req.files[`instanceImage_${i}`]) {
          const imageFile = req.files[`instanceImage_${i}`];
          console.log('Processing image for instance', i, ':', imageFile);
          
          // If using cloudinary
          if (typeof cloudinary !== 'undefined') {
            try {
              const result = await cloudinary.uploader.upload(imageFile[0].path, {
                folder: 'inventory_instances',
                resource_type: 'image'
              });
              imageUrl = result.secure_url;
              imagePublicId = result.public_id;
            } catch (uploadErr) {
              console.error('Image upload error:', uploadErr);
            }
          }
        }
        
        const instance = new InventoryInstance({
          inventoryItem: inventoryItem._id,
          instanceId: instanceData.instanceId,
          assetTag: instanceData.assetTag || null,
          barcode: instanceData.barcode || null,
          serialNumber: instanceData.serialNumber || null,
          condition: instanceData.condition || 'new',
          location: instanceData.location || 'Main Warehouse',
          status: 'available',
          acquisitionDate: new Date(),
          acquisitionCost: parseFloat(unitPrice),
          supplier: supplierData.id,
          poNumber,
          imageUrl,
          imagePublicId,
          notes: instanceData.notes,
          createdBy: req.user.userId
        });
        
        await instance.save();
        createdInstances.push(instance);
      }
      
      console.log('✓ Created instances:', createdInstances.length);
    }

    // Populate transaction details
    await transaction.populate([
      { path: 'item', select: 'code description category unitOfMeasure' },
      { path: 'supplier', select: 'name' },
      { path: 'receivedBy', select: 'fullName email' },
      { path: 'createdBy', select: 'fullName email' }
    ]);

    console.log('=== INBOUND TRANSACTION SUCCESS ===');

    res.status(201).json({
      success: true,
      message: 'Inbound transaction recorded successfully',
      data: {
        transaction,
        inventoryItem: {
          _id: inventoryItem._id,
          code: inventoryItem.code,
          description: inventoryItem.description,
          newStockLevel: inventoryItem.stockQuantity,
          newAverageCost: inventoryItem.averageCost
        },
        instancesCreated: createdInstances.length,
        instances: createdInstances.map(inst => ({
          _id: inst._id,
          assetTag: inst.assetTag,
          barcode: inst.barcode,
          instanceId: inst.instanceId
        }))
      }
    });
  } catch (error) {
    console.error('=== INBOUND TRANSACTION ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to record inbound transaction',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};


/**
 * FIXED: Record outbound - handles items from both Item catalog and Inventory
 */
const recordOutbound = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    const {
      itemId,
      quantity,
      requisitionNumber,
      projectId,
      projectName,
      cluster,
      siteName,
      ihsId,
      siteId,
      mfrNumber,
      mfrDate,
      requestorId,
      requestorName,
      deliveryNote,
      carrier,
      carrierName,
      transporter,
      servedById,
      servedByName,
      transactionDate,
      comment
    } = req.body;

    console.log('=== OUTBOUND TRANSACTION DEBUG ===');
    console.log('Received itemId:', itemId);
    console.log('Quantity:', quantity);
    console.log('User:', user.fullName);

    // STEP 1: Try to find the item - check BOTH collections
    let itemFromCatalog = null;
    let inventoryItem = null;
    let itemData = null;
    let stockSource = null;

    // First, try Item catalog
    try {
      itemFromCatalog = await Item.findById(itemId);
      if (itemFromCatalog) {
        console.log('✓ Found in Item catalog:', itemFromCatalog.code, itemFromCatalog.description);
        itemData = itemFromCatalog;
        stockSource = 'catalog';
      }
    } catch (err) {
      console.log('Not in Item catalog, checking Inventory...');
    }

    // If not in Item catalog, try Inventory collection
    if (!itemFromCatalog) {
      try {
        inventoryItem = await Inventory.findById(itemId);
        if (inventoryItem) {
          console.log('✓ Found in Inventory:', inventoryItem.code, inventoryItem.description);
          itemData = inventoryItem;
          stockSource = 'inventory';
        }
      } catch (err) {
        console.log('Not in Inventory either');
      }
    } else {
      // If found in catalog, also check if there's an inventory record
      // (catalog items might have a corresponding inventory record)
      try {
        inventoryItem = await Inventory.findOne({ code: itemFromCatalog.code });
        if (inventoryItem) {
          console.log('✓ Also found corresponding inventory record');
          // Use inventory for stock tracking if it exists
          itemData = inventoryItem;
          stockSource = 'inventory';
        }
      } catch (err) {
        // No inventory record, use catalog item
        console.log('No corresponding inventory record');
      }
    }

    // If not found in either, return error
    if (!itemData) {
      console.error('❌ Item not found in either catalog or inventory:', itemId);
      return res.status(404).json({
        success: false,
        message: 'Item not found. Please ensure the item exists in the system.',
        debug: {
          itemId: itemId,
          checkedCatalog: !!itemFromCatalog,
          checkedInventory: !!inventoryItem
        }
      });
    }

    console.log('Item data loaded:', itemData.code, 'from', stockSource);

    // STEP 2: Check stock availability
    const currentStock = itemData.stockQuantity || 0;
    const requestedQty = parseFloat(quantity);

    console.log('Current stock:', currentStock);
    console.log('Requested quantity:', requestedQty);

    if (currentStock < requestedQty) {
      console.error('❌ Insufficient stock');
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${currentStock}, Requested: ${requestedQty}`,
        data: {
          available: currentStock,
          requested: requestedQty,
          shortage: requestedQty - currentStock
        }
      });
    }

    // STEP 3: Get stock before transaction
    const stockBefore = currentStock;
    console.log('Stock before:', stockBefore);

    // STEP 4: Generate transaction number
    const transactionNumber = await generateTransactionNumber('outbound');
    console.log('✓ Transaction number generated:', transactionNumber);

    // STEP 5: Create outbound transaction
    // Always reference the inventory item if it exists, otherwise reference catalog item
    const transactionItemRef = inventoryItem ? inventoryItem._id : itemFromCatalog._id;

    const transaction = new StockTransaction({
      transactionNumber,
      transactionType: 'outbound',
      item: transactionItemRef,
      quantity: requestedQty,
      unitPrice: itemData.averageCost || itemData.standardPrice || 0,
      transactionDate: transactionDate || new Date(),
      requisitionNumber,
      project: projectId,
      projectName,
      cluster,
      siteName,
      ihsId,
      siteId,
      mfrNumber,
      mfrDate,
      requestor: requestorId,
      requestorName,
      deliveryNote,
      carrier,
      carrierName,
      transporter,
      servedBy: servedById || req.user.userId,
      servedByName: servedByName || user.fullName,
      comment,
      stockBefore,
      stockAfter: stockBefore - requestedQty,
      status: 'completed',
      createdBy: req.user.userId
    });

    await transaction.save();
    console.log('✓ Transaction saved:', transaction.transactionNumber);

    // STEP 6: Update stock in the appropriate collection
    itemData.stockQuantity = currentStock - requestedQty;
    itemData.lastStockUpdate = new Date();
    await itemData.save();
    
    console.log('✓ Stock updated. New stock:', itemData.stockQuantity);
    console.log('Updated in:', stockSource);

    // STEP 7: Populate transaction details
    await transaction.populate([
      { path: 'item', select: 'code description category unitOfMeasure' },
      { path: 'project', select: 'name code' },
      { path: 'requestor', select: 'fullName email' },
      { path: 'servedBy', select: 'fullName email' },
      { path: 'createdBy', select: 'fullName email' }
    ]);

    console.log('=== OUTBOUND TRANSACTION COMPLETE ===');

    res.status(201).json({
      success: true,
      message: 'Outbound transaction recorded successfully',
      data: {
        transaction,
        itemData: {
          _id: itemData._id,
          code: itemData.code,
          description: itemData.description,
          newStockLevel: itemData.stockQuantity,
          stockSource: stockSource
        }
      }
    });
  } catch (error) {
    console.error('=== OUTBOUND TRANSACTION ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to record outbound transaction',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};


/**
 * Get all transactions with filters
 */
const getTransactions = async (req, res) => {
  try {
    const {
      type,
      itemId,
      startDate,
      endDate,
      status,
      page = 1,
      limit = 50
    } = req.query;

    // Build filter
    let filter = {};

    if (type && type !== 'all') {
      filter.transactionType = type;
    }

    if (itemId) {
      filter.item = itemId;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.transactionDate = {};
      if (startDate) filter.transactionDate.$gte = new Date(startDate);
      if (endDate) filter.transactionDate.$lte = new Date(endDate);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [transactions, total] = await Promise.all([
      StockTransaction.find(filter)
        .populate('item', 'code description category unitOfMeasure')
        .populate('supplier', 'name')
        .populate('project', 'name code')
        .populate('createdBy', 'fullName email')
        .populate('receivedBy', 'fullName')
        .populate('servedBy', 'fullName')
        .sort({ transactionDate: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      StockTransaction.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / parseInt(limit)),
          count: transactions.length,
          totalRecords: total
        }
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

/**
 * Get stock level for specific item
 */
const getStockLevel = async (req, res) => {
  try {
    const { itemId } = req.params;

    const item = await Item.findById(itemId)
      .select('code description stockQuantity minimumStock reorderPoint averageCost standardPrice location')
      .lean();

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Get recent transactions
    const recentTransactions = await StockTransaction.find({ item: itemId })
      .sort({ transactionDate: -1 })
      .limit(10)
      .select('transactionType quantity transactionDate transactionNumber')
      .lean();

    // Calculate stock value
    const stockValue = item.stockQuantity * (item.averageCost || item.standardPrice || 0);

    res.json({
      success: true,
      data: {
        item,
        stockValue,
        needsReorder: item.stockQuantity <= item.reorderPoint,
        recentTransactions
      }
    });
  } catch (error) {
    console.error('Get stock level error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stock level',
      error: error.message
    });
  }
};

/**
 * Create stock adjustment
 */
const createStockAdjustment = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    const {
      itemId,
      adjustmentType,
      quantityAfter,
      reason,
      detailedNotes,
      physicalCount
    } = req.body;

    // Validate item
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    const quantityBefore = item.stockQuantity;
    const unitPrice = item.averageCost || item.standardPrice || 0;

    // Create adjustment
    const adjustment = new StockAdjustment({
      item: itemId,
      adjustmentType,
      quantityBefore,
      quantityAfter: parseFloat(quantityAfter),
      variance: parseFloat(quantityAfter) - quantityBefore,
      valueBefore: quantityBefore * unitPrice,
      valueAfter: parseFloat(quantityAfter) * unitPrice,
      valueVariance: (parseFloat(quantityAfter) - quantityBefore) * unitPrice,
      reason,
      detailedNotes,
      physicalCount,
      requestedBy: req.user.userId,
      requestedByName: user.fullName || user.email,
      status: 'pending'
    });

    await adjustment.save();
    await adjustment.populate('item', 'code description category');

    res.status(201).json({
      success: true,
      message: 'Stock adjustment created successfully. Awaiting approval.',
      data: adjustment
    });
  } catch (error) {
    console.error('Create stock adjustment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create stock adjustment',
      error: error.message
    });
  }
};

/**
 * Approve stock adjustment
 */
const approveStockAdjustment = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const { adjustmentId } = req.params;
    const { approved, rejectionReason } = req.body;

    const adjustment = await StockAdjustment.findById(adjustmentId);
    if (!adjustment) {
      return res.status(404).json({
        success: false,
        message: 'Stock adjustment not found'
      });
    }

    if (adjustment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Adjustment has already been processed'
      });
    }

    if (approved) {
      // Update item stock
      const item = await Item.findById(adjustment.item);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: 'Item not found'
        });
      }

      const stockBefore = item.stockQuantity;
      item.stockQuantity = adjustment.quantityAfter;
      item.lastStockUpdate = new Date();
      await item.save();

      // Create corresponding transaction
      const transaction = new StockTransaction({
        transactionType: 'adjustment',
        item: adjustment.item,
        quantity: Math.abs(adjustment.variance),
        unitPrice: item.averageCost || item.standardPrice || 0,
        comment: `Stock adjustment: ${adjustment.reason}`,
        stockBefore,
        stockAfter: adjustment.quantityAfter,
        status: 'completed',
        createdBy: adjustment.requestedBy,
        approvedBy: req.user.userId,
        approvalDate: new Date()
      });
      await transaction.save();

      adjustment.status = 'approved';
      adjustment.approvedBy = req.user.userId;
      adjustment.approvedByName = user.fullName || user.email;
      adjustment.approvalDate = new Date();
    } else {
      adjustment.status = 'rejected';
      adjustment.rejectionReason = rejectionReason;
      adjustment.approvedBy = req.user.userId;
      adjustment.approvedByName = user.fullName || user.email;
      adjustment.approvalDate = new Date();
    }

    await adjustment.save();
    await adjustment.populate('item', 'code description');

    res.json({
      success: true,
      message: `Stock adjustment ${approved ? 'approved' : 'rejected'} successfully`,
      data: adjustment
    });
  } catch (error) {
    console.error('Approve stock adjustment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process stock adjustment',
      error: error.message
    });
  }
};

/**
 * Get stock movement report
 */
const getStockMovementReport = async (req, res) => {
  try {
    const { startDate, endDate, itemId, category } = req.query;

    // Build filter
    let filter = {};
    if (startDate || endDate) {
      filter.transactionDate = {};
      if (startDate) filter.transactionDate.$gte = new Date(startDate);
      if (endDate) filter.transactionDate.$lte = new Date(endDate);
    }

    // Get transactions
    let transactionsQuery = StockTransaction.find(filter)
      .populate('item', 'code description category unitOfMeasure');

    if (itemId) {
      transactionsQuery = transactionsQuery.where('item').equals(itemId);
    }

    const transactions = await transactionsQuery.lean();

    // Filter by category if specified
    let filteredTransactions = transactions;
    if (category && category !== 'all') {
      filteredTransactions = transactions.filter(t => t.item?.category === category);
    }

    // Calculate summary
    const summary = {
      totalInbound: 0,
      totalOutbound: 0,
      totalAdjustments: 0,
      inboundValue: 0,
      outboundValue: 0,
      netMovement: 0,
      netValue: 0
    };

    filteredTransactions.forEach(t => {
      const value = t.quantity * t.unitPrice;
      
      if (t.transactionType === 'inbound') {
        summary.totalInbound += t.quantity;
        summary.inboundValue += value;
      } else if (t.transactionType === 'outbound') {
        summary.totalOutbound += t.quantity;
        summary.outboundValue += value;
      } else if (t.transactionType === 'adjustment') {
        summary.totalAdjustments += Math.abs(t.quantity);
      }
    });

    summary.netMovement = summary.totalInbound - summary.totalOutbound;
    summary.netValue = summary.inboundValue - summary.outboundValue;

    res.json({
      success: true,
      data: {
        transactions: filteredTransactions,
        summary,
        period: {
          startDate: startDate || 'All time',
          endDate: endDate || 'Present'
        }
      }
    });
  } catch (error) {
    console.error('Get stock movement report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate stock movement report',
      error: error.message
    });
  }
};

/**
 * Get reorder alerts
 */
const getReorderAlerts = async (req, res) => {
  try {
    const items = await Item.find({
      isActive: true,
      $expr: { $lte: ['$stockQuantity', '$reorderPoint'] }
    })
      .select('code description category stockQuantity minimumStock reorderPoint supplier location')
      .sort({ stockQuantity: 1 })
      .lean();

    const alerts = items.map(item => ({
      ...item,
      deficit: item.reorderPoint - item.stockQuantity,
      priority: item.stockQuantity === 0 ? 'critical' :
                item.stockQuantity < item.minimumStock ? 'high' : 'medium'
    }));

    res.json({
      success: true,
      data: {
        alerts,
        summary: {
          total: alerts.length,
          critical: alerts.filter(a => a.priority === 'critical').length,
          high: alerts.filter(a => a.priority === 'high').length,
          medium: alerts.filter(a => a.priority === 'medium').length
        }
      }
    });
  } catch (error) {
    console.error('Get reorder alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reorder alerts',
      error: error.message
    });
  }
};

/**
 * Get inventory valuation
 */
const getInventoryValuation = async (req, res) => {
  try {
    const { category, location } = req.query;

    let filter = { isActive: true };
    if (category && category !== 'all') filter.category = category;
    if (location) filter.location = location;

    const items = await Item.find(filter)
      .select('code description category stockQuantity averageCost standardPrice location')
      .lean();

    // Calculate values
    const valuationData = items.map(item => {
      const unitCost = item.averageCost || item.standardPrice || 0;
      const totalValue = item.stockQuantity * unitCost;
      
      return {
        ...item,
        unitCost,
        totalValue
      };
    });

    // Calculate summary by category
    const categoryBreakdown = {};
    valuationData.forEach(item => {
      if (!categoryBreakdown[item.category]) {
        categoryBreakdown[item.category] = {
          totalQuantity: 0,
          totalValue: 0,
          itemCount: 0
        };
      }
      categoryBreakdown[item.category].totalQuantity += item.stockQuantity;
      categoryBreakdown[item.category].totalValue += item.totalValue;
      categoryBreakdown[item.category].itemCount += 1;
    });

    const totalValue = valuationData.reduce((sum, item) => sum + item.totalValue, 0);
    const totalItems = valuationData.length;
    const totalQuantity = valuationData.reduce((sum, item) => sum + item.stockQuantity, 0);

    res.json({
      success: true,
      data: {
        items: valuationData,
        summary: {
          totalValue,
          totalItems,
          totalQuantity,
          averageValue: totalItems > 0 ? totalValue / totalItems : 0
        },
        categoryBreakdown
      }
    });
  } catch (error) {
    console.error('Get inventory valuation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate inventory valuation',
      error: error.message
    });
  }
};

/**
 * Get inventory dashboard statistics
 */
const getInventoryDashboard = async (req, res) => {
  try {
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get active inventory items count (from Inventory, not Item)
    const totalItems = await Inventory.countDocuments({ isActive: true });

    // Get low stock items
    const lowStockItems = await Inventory.countDocuments({
      isActive: true,
      $expr: { $lte: ['$stockQuantity', '$reorderPoint'] }
    });

    // Get out of stock items
    const outOfStockItems = await Inventory.countDocuments({
      isActive: true,
      stockQuantity: 0
    });

    // Get total stock value from Inventory
    const items = await Inventory.find({ isActive: true })
      .select('stockQuantity averageCost standardPrice')
      .lean();
    
    const totalStockValue = items.reduce((sum, item) => {
      const cost = item.averageCost || item.standardPrice || 0;
      return sum + (item.stockQuantity * cost);
    }, 0);

    // Get recent transactions
    const recentTransactions = await StockTransaction.find({
      transactionDate: { $gte: thirtyDaysAgo }
    });

    const inboundCount = recentTransactions.filter(t => t.transactionType === 'inbound').length;
    const outboundCount = recentTransactions.filter(t => t.transactionType === 'outbound').length;

    // Get pending adjustments
    const pendingAdjustments = await StockAdjustment.countDocuments({ status: 'pending' });

    res.json({
      success: true,
      data: {
        summary: {
          totalItems,
          lowStockItems,
          outOfStockItems,
          totalStockValue,
          pendingAdjustments
        },
        recentActivity: {
          inboundCount,
          outboundCount,
          period: '30 days'
        }
      }
    });
  } catch (error) {
    console.error('Get inventory dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory dashboard',
      error: error.message
    });
  }
};

/**
 * Get item details by ID (checks both Item catalog and Inventory)
 */
const getItemDetails = async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: 'Item ID is required'
      });
    }

    // Try to find in Inventory first (actual stock)
    let item = await Inventory.findById(itemId)
      .populate('createdBy', 'fullName email')
      .populate('lastUpdatedBy', 'fullName email')
      .populate('requestId', 'requestNumber description')
      .lean();

    // If not found in Inventory, check Item catalog
    if (!item) {
      const catalogItem = await Item.findById(itemId)
        .populate('createdBy', 'fullName email')
        .lean();
      
      if (catalogItem) {
        // Return catalog item with zero stock
        item = {
          ...catalogItem,
          stockQuantity: 0,
          minimumStock: 0,
          reorderPoint: 0,
          averageCost: catalogItem.standardPrice || 0,
          location: 'Not Yet Received',
          isInCatalogOnly: true
        };
      }
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Calculate additional metrics
    const stockValue = item.stockQuantity * (item.averageCost || item.standardPrice || 0);
    const needsReorder = item.stockQuantity <= item.reorderPoint;
    const stockStatus = item.stockQuantity === 0 ? 'out-of-stock' :
                       item.stockQuantity <= item.reorderPoint ? 'low-stock' : 'in-stock';

    // Get transaction count (only if in inventory)
    const transactionCount = item.isInCatalogOnly ? 0 : 
      await StockTransaction.countDocuments({ item: itemId });

    // Get last inbound and outbound dates
    const lastInbound = !item.isInCatalogOnly ? await StockTransaction.findOne({ 
      item: itemId, 
      transactionType: 'inbound' 
    })
      .sort({ transactionDate: -1 })
      .select('transactionDate')
      .lean() : null;

    const lastOutbound = !item.isInCatalogOnly ? await StockTransaction.findOne({ 
      item: itemId, 
      transactionType: 'outbound' 
    })
      .sort({ transactionDate: -1 })
      .select('transactionDate')
      .lean() : null;

    res.json({
      success: true,
      data: {
        ...item,
        stockValue,
        needsReorder,
        stockStatus,
        transactionCount,
        lastInboundDate: lastInbound?.transactionDate,
        lastOutboundDate: lastOutbound?.transactionDate
      }
    });
  } catch (error) {
    console.error('Get item details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch item details',
      error: error.message
    });
  }
};


/**
 * Get item transaction history
 */
const getItemTransactions = async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      page = 1,
      limit = 20,
      sortBy = 'transactionDate',
      sortOrder = 'desc',
      type
    } = req.query;

    // Build filter
    let filter = { item: itemId };
    if (type && type !== 'all') {
      filter.transactionType = type;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [transactions, total] = await Promise.all([
      StockTransaction.find(filter)
        .populate('item', 'code description unitOfMeasure')
        .populate('supplier', 'name contactPerson')
        .populate('project', 'name code')
        .populate('createdBy', 'fullName email')
        .populate('receivedBy', 'fullName')
        .populate('servedBy', 'fullName')
        .populate('requestor', 'fullName')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      StockTransaction.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / parseInt(limit)),
          count: transactions.length,
          totalRecords: total
        }
      }
    });
  } catch (error) {
    console.error('Get item transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch item transactions',
      error: error.message
    });
  }
};

/**
 * Get item stock movement timeline
 */
const getItemStockMovement = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { period = '30days' } = req.query;

    // Calculate date range
    let startDate = new Date();
    switch (period) {
      case '7days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    // Get transactions within period
    const movements = await StockTransaction.find({
      item: itemId,
      transactionDate: { $gte: startDate }
    })
      .populate('createdBy', 'fullName')
      .populate('receivedBy', 'fullName')
      .populate('servedBy', 'fullName')
      .sort({ transactionDate: -1 })
      .lean();

    // Format for timeline
    const formattedMovements = movements.map(m => ({
      date: m.transactionDate,
      type: m.transactionType,
      quantity: m.quantity,
      reference: m.poNumber || m.requisitionNumber || m.grnNumber || m.transactionNumber,
      notes: m.comment || `${m.transactionType} transaction`,
      user: m.receivedBy || m.servedBy || m.createdBy,
      stockBefore: m.stockBefore,
      stockAfter: m.stockAfter
    }));

    // Calculate summary
    const summary = {
      totalInbound: 0,
      totalOutbound: 0,
      totalAdjustments: 0,
      netChange: 0
    };

    movements.forEach(m => {
      if (m.transactionType === 'inbound') {
        summary.totalInbound += m.quantity;
      } else if (m.transactionType === 'outbound') {
        summary.totalOutbound += m.quantity;
      } else if (m.transactionType === 'adjustment') {
        summary.totalAdjustments += 1;
      }
    });

    summary.netChange = summary.totalInbound - summary.totalOutbound;

    res.json({
      success: true,
      data: {
        movements: formattedMovements,
        summary,
        period: {
          startDate,
          endDate: new Date()
        }
      }
    });
  } catch (error) {
    console.error('Get item stock movement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stock movement',
      error: error.message
    });
  }
};

/**
 * Get item audit trail
 */
const getItemAuditTrail = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Get all transactions for audit
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [auditRecords, total] = await Promise.all([
      StockTransaction.find({ item: itemId })
        .populate('item', 'code description')
        .populate('createdBy', 'fullName email')
        .populate('approvedBy', 'fullName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      StockTransaction.countDocuments({ item: itemId })
    ]);

    // Get stock adjustments
    const adjustments = await StockAdjustment.find({ item: itemId })
      .populate('requestedBy', 'fullName')
      .populate('approvedBy', 'fullName')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        transactions: auditRecords,
        adjustments,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / parseInt(limit)),
          count: auditRecords.length,
          totalRecords: total
        }
      }
    });
  } catch (error) {
    console.error('Get item audit trail error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit trail',
      error: error.message
    });
  }
};

/**
 * Get item analytics
 */
const getItemAnalytics = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { period = '90days' } = req.query;

    // Calculate date range
    let startDate = new Date();
    switch (period) {
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '6months':
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      case '1year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 90);
    }

    // Get transactions within period
    const transactions = await StockTransaction.find({
      item: itemId,
      transactionDate: { $gte: startDate }
    }).lean();

    // Calculate consumption rate
    const outboundTransactions = transactions.filter(t => t.transactionType === 'outbound');
    const totalOutbound = outboundTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const daysInPeriod = Math.ceil((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const averageDailyConsumption = totalOutbound / daysInPeriod;

    // Calculate reorder frequency
    const inboundTransactions = transactions.filter(t => t.transactionType === 'inbound');
    const averageOrderQuantity = inboundTransactions.length > 0
      ? inboundTransactions.reduce((sum, t) => sum + t.quantity, 0) / inboundTransactions.length
      : 0;

    // Get item current stock
    const item = await Item.findById(itemId).select('stockQuantity reorderPoint').lean();

    // Calculate days until reorder
    const daysUntilReorder = averageDailyConsumption > 0
      ? Math.floor((item.stockQuantity - item.reorderPoint) / averageDailyConsumption)
      : null;

    // Group transactions by month
    const monthlyData = {};
    transactions.forEach(t => {
      const month = new Date(t.transactionDate).toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyData[month]) {
        monthlyData[month] = { inbound: 0, outbound: 0, adjustments: 0 };
      }
      if (t.transactionType === 'inbound') {
        monthlyData[month].inbound += t.quantity;
      } else if (t.transactionType === 'outbound') {
        monthlyData[month].outbound += t.quantity;
      } else {
        monthlyData[month].adjustments += 1;
      }
    });

    res.json({
      success: true,
      data: {
        consumptionAnalysis: {
          totalOutbound,
          averageDailyConsumption: averageDailyConsumption.toFixed(2),
          daysInPeriod,
          daysUntilReorder
        },
        orderingAnalysis: {
          totalOrders: inboundTransactions.length,
          averageOrderQuantity: averageOrderQuantity.toFixed(2),
          lastOrderDate: inboundTransactions[0]?.transactionDate
        },
        monthlyTrends: monthlyData,
        currentStock: item.stockQuantity,
        reorderPoint: item.reorderPoint
      }
    });
  } catch (error) {
    console.error('Get item analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch item analytics',
      error: error.message
    });
  }
};

/**
 * Update item details
 */
const updateItemDetails = async (req, res) => {
  try {
    const { itemId } = req.params;
    const updates = req.body;

    // Validate item exists
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Fields that should not be updated via this endpoint
    const protectedFields = ['stockQuantity', 'averageCost', 'lastStockUpdate', 'createdBy'];
    protectedFields.forEach(field => delete updates[field]);

    // Update item
    Object.assign(item, updates);
    item.lastUpdatedBy = req.user.userId;
    await item.save();

    await item.populate([
      { path: 'createdBy', select: 'fullName email' },
      { path: 'lastUpdatedBy', select: 'fullName email' }
    ]);

    res.json({
      success: true,
      message: 'Item details updated successfully',
      data: item
    });
  } catch (error) {
    console.error('Update item details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update item details',
      error: error.message
    });
  }
};

module.exports = {
  getAvailableStock,
  recordInbound,
  recordOutbound,
  getTransactions,
  getStockLevel,
  createStockAdjustment,
  approveStockAdjustment,
  getStockMovementReport,
  getReorderAlerts,
  getInventoryValuation,
  getInventoryDashboard,
  generateTransactionNumber,

  getItemDetails,
  getItemTransactions,
  getItemStockMovement,
  getItemAuditTrail,
  getItemAnalytics,
  updateItemDetails
};