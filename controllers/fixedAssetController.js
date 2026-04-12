const FixedAsset = require('../models/FixedAsset');
const Inventory = require('../models/Inventory');
const User = require('../models/User');
const Supplier = require('../models/Supplier');
const bwipjs = require('bwip-js');

/**
 * Get next available asset tag
 */
const getNextAssetTag = async () => {
  const lastAsset = await FixedAsset.findOne().sort({ assetTag: -1 }).select('assetTag');
  
  if (!lastAsset) {
    return '0001';
  }
  
  const lastNumber = parseInt(lastAsset.assetTag);
  const nextNumber = lastNumber + 1;
  
  if (nextNumber > 3000) {
    throw new Error('Asset tag limit (3000) reached. Please contact system administrator.');
  }
  
  return String(nextNumber).padStart(4, '0');
};

/**
 * Generate barcode for asset tag
 */
const generateBarcode = async (assetTag) => {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: assetTag,
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: 'center'
    });
    
    return png.toString('base64');
  } catch (error) {
    console.error('Barcode generation error:', error);
    return null;
  }
};

/**
 * Register new fixed asset
 * IMPORTANT: This removes the item from inventory once registered as fixed asset
 */
const registerAsset = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    const {
      itemId,
      assetName,
      assetDescription,
      serialNumber,
      modelNumber,
      manufacturer,
      acquisitionDate,
      acquisitionCost,
      supplierId,
      supplierName,
      poNumber,
      invoiceNumber,
      warrantyExpiry,
      depreciationMethod,
      usefulLifeYears,
      salvageValue,
      assignedToId,
      assignedToName,
      assignedDepartment,
      assignedLocation,
      condition,
      physicalLocation,
      notes,
      customAssetTag
    } = req.body;

    console.log('=== REGISTERING FIXED ASSET ===');
    console.log('Item ID:', itemId);

    // STEP 1: Find item in Inventory (not Item catalog)
    const inventoryItem = await Inventory.findById(itemId);
    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    console.log('✓ Found inventory item:', inventoryItem.code);

    // STEP 2: Validate supplier if provided
    let supplierData = null;
    if (supplierId) {
      supplierData = await Supplier.findById(supplierId);
      if (!supplierData) {
        console.warn('Supplier not found, using supplied name');
      }
    }

    // STEP 3: Get next asset tag or use custom
    let assetTag;
    if (customAssetTag) {
      const existing = await FixedAsset.findOne({ assetTag: customAssetTag });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Asset tag ${customAssetTag} is already in use`
        });
      }
      assetTag = customAssetTag;
    } else {
      assetTag = await getNextAssetTag();
    }

    console.log('✓ Asset tag assigned:', assetTag);

    // STEP 4: Generate barcode
    const barcodeData = await generateBarcode(assetTag);
    const barcode = barcodeData ? `data:image/png;base64,${barcodeData}` : null;

    // STEP 5: Validate assigned user if provided
    let assignedUser = null;
    if (assignedToId) {
      assignedUser = await User.findById(assignedToId);
      if (!assignedUser) {
        return res.status(400).json({
          success: false,
          message: 'Assigned user not found'
        });
      }
    }

    // STEP 6: Create fixed asset
    const asset = new FixedAsset({
      assetTag,
      barcode,
      item: itemId,
      assetName: assetName || inventoryItem.description,
      assetDescription: assetDescription || inventoryItem.specifications,
      serialNumber,
      modelNumber,
      manufacturer,
      acquisitionDate: acquisitionDate || new Date(),
      acquisitionCost: parseFloat(acquisitionCost),
      supplier: supplierId,
      supplierName: supplierName || supplierData?.name || inventoryItem.supplier,
      poNumber,
      invoiceNumber,
      warrantyExpiry,
      depreciationMethod: depreciationMethod || 'straight-line',
      usefulLifeYears: parseInt(usefulLifeYears) || 5,
      salvageValue: parseFloat(salvageValue) || 0,
      depreciationStartDate: acquisitionDate || new Date(),
      condition: condition || 'good',
      status: assignedToId ? 'in-use' : 'active',
      physicalLocation: physicalLocation || {},
      notes,
      createdBy: req.user.userId
    });

    // STEP 7: Set initial assignment if provided
    if (assignedToId && assignedUser) {
      asset.currentAssignment = {
        assignedTo: assignedToId,
        assignedToName: assignedToName || assignedUser.fullName,
        assignedDepartment: assignedDepartment || assignedUser.department,
        assignedLocation: assignedLocation,
        assignmentDate: new Date()
      };
      
      asset.assignmentHistory.push({
        assignedTo: assignedToId,
        assignedToName: assignedToName || assignedUser.fullName,
        department: assignedDepartment || assignedUser.department,
        location: assignedLocation,
        assignmentDate: new Date(),
        assignedBy: req.user.userId
      });
    }

    await asset.save();
    console.log('✓ Fixed asset created:', asset.assetTag);

    // STEP 8: CRITICAL - Remove item from inventory
    // Mark as fixed asset and reduce stock to 0
    inventoryItem.isFixedAsset = true;
    inventoryItem.assetTag = assetTag;
    inventoryItem.stockQuantity = 0; // Remove from available inventory
    inventoryItem.isActive = false; // Deactivate from inventory
    inventoryItem.lastUpdatedBy = req.user.userId;
    inventoryItem.assetDetails = {
      acquisitionDate: acquisitionDate || new Date(),
      acquisitionCost: parseFloat(acquisitionCost),
      depreciationMethod: depreciationMethod || 'straight-line',
      usefulLifeYears: parseInt(usefulLifeYears) || 5,
      salvageValue: parseFloat(salvageValue) || 0,
      assignedTo: assignedToId || null,
      assignedLocation: assignedLocation,
      condition: condition || 'good'
    };
    
    await inventoryItem.save();
    console.log('✓ Inventory item updated and removed from stock');

    // STEP 9: Populate references
    await asset.populate([
      { path: 'item', select: 'code description category' },
      { path: 'supplier', select: 'name email phone' },
      { path: 'currentAssignment.assignedTo', select: 'fullName email department' },
      { path: 'createdBy', select: 'fullName email' }
    ]);

    console.log('=== FIXED ASSET REGISTRATION COMPLETE ===');

    res.status(201).json({
      success: true,
      message: 'Fixed asset registered successfully. Item removed from inventory.',
      data: asset
    });
  } catch (error) {
    console.error('=== REGISTER ASSET ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to register fixed asset',
      error: error.message
    });
  }
};

/**
 * Get all fixed assets with filters
 */
const getAssets = async (req, res) => {
  try {
    const {
      status,
      condition,
      assignedTo,
      category,
      search,
      page = 1,
      limit = 50,
      sortBy = 'assetTag',
      sortOrder = 'asc'
    } = req.query;

    console.log('=== FETCHING ASSETS ===');
    console.log('Filters:', { status, condition, search, page, limit });

    // Build filter
    let filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (condition && condition !== 'all') {
      filter.condition = condition;
    }

    if (assignedTo) {
      filter['currentAssignment.assignedTo'] = assignedTo;
    }

    if (search) {
      filter.$or = [
        { assetTag: { $regex: search, $options: 'i' } },
        { assetName: { $regex: search, $options: 'i' } },
        { serialNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    // Get assets
    const [assets, total] = await Promise.all([
      FixedAsset.find(filter)
        .populate('item', 'code description category')
        .populate('currentAssignment.assignedTo', 'fullName email department')
        .populate('supplier', 'name')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      FixedAsset.countDocuments(filter)
    ]);

    console.log('✓ Found assets:', assets.length);

    // Add calculated fields
    const assetsWithCalculations = assets.map(asset => {
      const years = (Date.now() - new Date(asset.acquisitionDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const annualDepreciation = (asset.acquisitionCost - asset.salvageValue) / asset.usefulLifeYears;
      const accumulatedDepreciation = Math.min(annualDepreciation * years, asset.acquisitionCost - asset.salvageValue);
      const currentBookValue = Math.max(0, asset.acquisitionCost - accumulatedDepreciation);

      return {
        ...asset,
        currentBookValue,
        accumulatedDepreciation,
        isOverdue: asset.nextInspectionDue && new Date(asset.nextInspectionDue) < new Date()
      };
    });

    // Filter by category if provided (after population)
    let filteredAssets = assetsWithCalculations;
    if (category && category !== 'all') {
      filteredAssets = assetsWithCalculations.filter(a => a.item?.category === category);
    }

    res.json({
      success: true,
      data: {
        assets: filteredAssets,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / parseInt(limit)),
          count: filteredAssets.length,
          totalRecords: total
        }
      }
    });
  } catch (error) {
    console.error('=== GET ASSETS ERROR ===');
    console.error('Error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch fixed assets',
      error: error.message
    });
  }
};

/**
 * Get asset by tag
 */
const getAssetByTag = async (req, res) => {
  try {
    const { assetTag } = req.params;

    const asset = await FixedAsset.findOne({ assetTag })
      .populate('item', 'code description category unitOfMeasure specifications')
      .populate('supplier', 'name email phone')
      .populate('currentAssignment.assignedTo', 'fullName email department phone')
      .populate('assignmentHistory.assignedTo', 'fullName email')
      .populate('assignmentHistory.assignedBy', 'fullName')
      .populate('createdBy', 'fullName email')
      .populate('lastUpdatedBy', 'fullName email');

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Calculate depreciation
    const years = (Date.now() - new Date(asset.acquisitionDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const annualDepreciation = (asset.acquisitionCost - asset.salvageValue) / asset.usefulLifeYears;
    const accumulatedDepreciation = Math.min(annualDepreciation * years, asset.acquisitionCost - asset.salvageValue);
    const currentBookValue = Math.max(0, asset.acquisitionCost - accumulatedDepreciation);

    res.json({
      success: true,
      data: {
        ...asset.toObject(),
        currentBookValue,
        accumulatedDepreciation,
        annualDepreciation,
        remainingLife: Math.max(0, asset.usefulLifeYears - years)
      }
    });
  } catch (error) {
    console.error('Get asset by tag error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch asset',
      error: error.message
    });
  }
};

/**
 * Update asset details
 */
const updateAsset = async (req, res) => {
  try {
    const { assetTag } = req.params;
    const updateData = req.body;

    const asset = await FixedAsset.findOne({ assetTag });
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'assetName', 'assetDescription', 'serialNumber', 'modelNumber',
      'manufacturer', 'condition', 'notes', 'physicalLocation',
      'warrantyExpiry', 'usefulLifeYears', 'salvageValue'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        asset[field] = updateData[field];
      }
    });

    asset.lastUpdatedBy = req.user.userId;
    await asset.save();

    await asset.populate([
      { path: 'item', select: 'code description category' },
      { path: 'currentAssignment.assignedTo', select: 'fullName email' }
    ]);

    res.json({
      success: true,
      message: 'Asset updated successfully',
      data: asset
    });
  } catch (error) {
    console.error('Update asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update asset',
      error: error.message
    });
  }
};

/**
 * Assign asset to user
 */
const assignAsset = async (req, res) => {
  try {
    const { assetTag } = req.params;
    const {
      assignedToId,
      assignedToName,
      department,
      location,
      notes
    } = req.body;

    const asset = await FixedAsset.findOne({ assetTag });
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Verify user exists
    const assignee = await User.findById(assignedToId);
    if (!assignee) {
      return res.status(404).json({
        success: false,
        message: 'Assignee user not found'
      });
    }

    // Use the assign method
    await asset.assign(
      assignedToId,
      assignedToName || assignee.fullName,
      department || assignee.department,
      location,
      req.user.userId,
      notes
    );

    await asset.populate([
      { path: 'item', select: 'code description' },
      { path: 'currentAssignment.assignedTo', select: 'fullName email department' }
    ]);

    res.json({
      success: true,
      message: 'Asset assigned successfully',
      data: asset
    });
  } catch (error) {
    console.error('Assign asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign asset',
      error: error.message
    });
  }
};

/**
 * Return asset (unassign)
 */
const returnAsset = async (req, res) => {
  try {
    const { assetTag } = req.params;
    const { returnNotes, condition } = req.body;

    const asset = await FixedAsset.findOne({ assetTag });
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    if (!asset.currentAssignment.assignedTo) {
      return res.status(400).json({
        success: false,
        message: 'Asset is not currently assigned'
      });
    }

    // Update assignment history
    const lastAssignment = asset.assignmentHistory[asset.assignmentHistory.length - 1];
    if (lastAssignment) {
      lastAssignment.returnDate = new Date();
      lastAssignment.notes = returnNotes || lastAssignment.notes;
    }

    // Clear current assignment
    asset.currentAssignment = {
      assignedTo: null,
      assignedToName: null,
      assignedDepartment: null,
      assignedLocation: null,
      assignmentDate: null
    };

    asset.status = 'active';
    if (condition) {
      asset.condition = condition;
    }
    asset.lastUpdatedBy = req.user.userId;

    await asset.save();

    res.json({
      success: true,
      message: 'Asset returned successfully',
      data: asset
    });
  } catch (error) {
    console.error('Return asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to return asset',
      error: error.message
    });
  }
};

/**
 * Add maintenance record
 */
const addMaintenance = async (req, res) => {
  try {
    const { assetTag } = req.params;
    const {
      date,
      maintenanceType,
      description,
      cost,
      performedBy,
      vendor,
      nextServiceDue,
      attachments
    } = req.body;

    const asset = await FixedAsset.findOne({ assetTag });
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    const maintenanceRecord = {
      date: date || new Date(),
      maintenanceType,
      description,
      cost: parseFloat(cost) || 0,
      performedBy,
      vendor,
      nextServiceDue,
      attachments: attachments || []
    };

    await asset.addMaintenance(maintenanceRecord);

    res.json({
      success: true,
      message: 'Maintenance record added successfully',
      data: asset
    });
  } catch (error) {
    console.error('Add maintenance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add maintenance record',
      error: error.message
    });
  }
};

/**
 * Dispose asset
 */
const disposeAsset = async (req, res) => {
  try {
    const { assetTag } = req.params;
    const {
      disposalDate,
      disposalMethod,
      disposalReason,
      disposalValue
    } = req.body;

    const asset = await FixedAsset.findOne({ assetTag });
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    if (asset.status === 'disposed') {
      return res.status(400).json({
        success: false,
        message: 'Asset has already been disposed'
      });
    }

    const disposalData = {
      disposalDate: disposalDate || new Date(),
      disposalMethod,
      disposalReason,
      disposalValue: parseFloat(disposalValue) || 0
    };

    await asset.dispose(disposalData, req.user.userId);

    res.json({
      success: true,
      message: 'Asset disposed successfully',
      data: asset
    });
  } catch (error) {
    console.error('Dispose asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to dispose asset',
      error: error.message
    });
  }
};

/**
 * Get depreciation schedule
 */
const getDepreciationSchedule = async (req, res) => {
  try {
    const { assetTag } = req.params;

    const asset = await FixedAsset.findOne({ assetTag })
      .populate('item', 'code description');

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    if (asset.depreciationMethod === 'none') {
      return res.json({
        success: true,
        message: 'No depreciation applicable for this asset',
        data: null
      });
    }

    const schedule = [];
    const annualDepreciation = (asset.acquisitionCost - asset.salvageValue) / asset.usefulLifeYears;
    const startDate = new Date(asset.acquisitionDate);

    for (let year = 0; year < asset.usefulLifeYears; year++) {
      const yearStart = new Date(startDate);
      yearStart.setFullYear(yearStart.getFullYear() + year);
      
      const yearEnd = new Date(startDate);
      yearEnd.setFullYear(yearEnd.getFullYear() + year + 1);

      const accumulatedAtStart = annualDepreciation * year;
      const accumulatedAtEnd = annualDepreciation * (year + 1);
      const bookValueAtStart = asset.acquisitionCost - accumulatedAtStart;
      const bookValueAtEnd = Math.max(asset.salvageValue, asset.acquisitionCost - accumulatedAtEnd);

      schedule.push({
        year: year + 1,
        periodStart: yearStart,
        periodEnd: yearEnd,
        bookValueStart: bookValueAtStart,
        depreciation: annualDepreciation,
        accumulatedDepreciation: accumulatedAtEnd,
        bookValueEnd: bookValueAtEnd
      });
    }

    res.json({
      success: true,
      data: {
        asset: {
          assetTag: asset.assetTag,
          assetName: asset.assetName,
          acquisitionCost: asset.acquisitionCost,
          salvageValue: asset.salvageValue,
          usefulLifeYears: asset.usefulLifeYears,
          depreciationMethod: asset.depreciationMethod
        },
        schedule
      }
    });
  } catch (error) {
    console.error('Get depreciation schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate depreciation schedule',
      error: error.message
    });
  }
};

/**
 * Generate asset barcode
 */
const generateAssetBarcode = async (req, res) => {
  try {
    const { assetTag } = req.params;

    const asset = await FixedAsset.findOne({ assetTag });
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Regenerate barcode if needed
    if (!asset.barcode) {
      const barcodeData = await generateBarcode(assetTag);
      if (barcodeData) {
        asset.barcode = `data:image/png;base64,${barcodeData}`;
        await asset.save();
      }
    }

    res.json({
      success: true,
      data: {
        assetTag: asset.assetTag,
        barcode: asset.barcode,
        assetName: asset.assetName
      }
    });
  } catch (error) {
    console.error('Generate barcode error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate barcode',
      error: error.message
    });
  }
};

/**
 * Get asset dashboard statistics
 */
const getAssetDashboard = async (req, res) => {
  try {
    const totalAssets = await FixedAsset.countDocuments();
    const activeAssets = await FixedAsset.countDocuments({ status: 'active' });
    const inUseAssets = await FixedAsset.countDocuments({ status: 'in-use' });
    const inMaintenanceAssets = await FixedAsset.countDocuments({ status: 'in-maintenance' });
    const disposedAssets = await FixedAsset.countDocuments({ status: 'disposed' });

    // Get overdue inspections
    const overdueInspections = await FixedAsset.countDocuments({
      nextInspectionDue: { $lt: new Date() },
      status: { $nin: ['disposed', 'retired'] }
    });

    // Calculate total values
    const assets = await FixedAsset.find({ status: { $nin: ['disposed', 'retired'] } })
      .select('acquisitionCost acquisitionDate usefulLifeYears salvageValue');

    let totalAcquisitionValue = 0;
    let totalCurrentValue = 0;

    assets.forEach(asset => {
      totalAcquisitionValue += asset.acquisitionCost;
      
      // Calculate current book value
      const years = (Date.now() - new Date(asset.acquisitionDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const annualDepreciation = (asset.acquisitionCost - asset.salvageValue) / asset.usefulLifeYears;
      const accumulated = Math.min(annualDepreciation * years, asset.acquisitionCost - asset.salvageValue);
      const currentValue = Math.max(0, asset.acquisitionCost - accumulated);
      
      totalCurrentValue += currentValue;
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalAssets,
          activeAssets,
          inUseAssets,
          inMaintenanceAssets,
          disposedAssets,
          overdueInspections
        },
        valuation: {
          totalAcquisitionValue,
          totalCurrentValue,
          totalDepreciation: totalAcquisitionValue - totalCurrentValue
        }
      }
    });
  } catch (error) {
    console.error('Get asset dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch asset dashboard',
      error: error.message
    });
  }
};

/**
 * Get available asset tags
 */
const getAvailableAssetTags = async (req, res) => {
  try {
    const usedTags = await FixedAsset.find().select('assetTag').lean();
    const usedTagNumbers = usedTags.map(t => parseInt(t.assetTag));
    
    const availableTags = [];
    for (let i = 1; i <= 3000; i++) {
      if (!usedTagNumbers.includes(i)) {
        availableTags.push(String(i).padStart(4, '0'));
      }
    }

    res.json({
      success: true,
      data: {
        totalAvailable: availableTags.length,
        nextAvailable: availableTags[0] || null,
        availableTags: availableTags.slice(0, 100) // Return first 100
      }
    });
  } catch (error) {
    console.error('Get available asset tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available asset tags',
      error: error.message
    });
  }
};

module.exports = {
  registerAsset,
  getAssets,
  getAssetByTag,
  updateAsset,
  assignAsset,
  returnAsset,
  addMaintenance,
  disposeAsset,
  getDepreciationSchedule,
  generateAssetBarcode,
  getAssetDashboard,
  getAvailableAssetTags,
  getNextAssetTag
};


