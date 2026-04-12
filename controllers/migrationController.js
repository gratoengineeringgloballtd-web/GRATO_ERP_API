const Item = require('../models/Inventory');
const StockTransaction = require('../models/StockTransaction');
const Supplier = require('../models/Supplier');
const User = require('../models/User');
const mongoose = require('mongoose');


/**
 * Helper: Normalize Unit of Measure
 */
const normalizeUOM = (uom) => {
  if (!uom) return 'Each';
  
  const uomMap = {
    'EACH': 'Each',
    'EA': 'Each',
    'PCS': 'Pieces',
    'PC': 'Pieces',
    'PIECE': 'Pieces',
    'LTR': 'Litres',
    'LITRE': 'Litres',
    'LITER': 'Litres',
    'L': 'Litres',
    'KG': 'Kg',
    'KILOGRAM': 'Kg',
    'METER': 'Meters',
    'METRE': 'Meters',
    'M': 'Meters',
    'SET': 'Sets',
    'BOX': 'Boxes',
    'BOXES': 'Boxes',
    'PACK': 'Packs',
    'UNIT': 'Units',
    'PAIR': 'Pairs',
    'REAM': 'Reams'
  };
  
  const normalized = uomMap[uom.toUpperCase()];
  return normalized || 'Each'; // Default to 'Each' if not found
};

/**
 * Helper: Parse Excel date (handles various formats)
 */
const parseExcelDate = (dateStr) => {
  if (!dateStr) return new Date();
  
  // Handle Excel serial dates
  if (typeof dateStr === 'number') {
    return new Date((dateStr - 25569) * 86400 * 1000);
  }
  
  // Handle DD/MM/YYYY or DD-MM-YYYY
  const parts = dateStr.toString().split(/[\/\-]/);
  if (parts.length === 3) {
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // JS months are 0-indexed
    const year = parseInt(parts[2]);
    return new Date(year, month, day);
  }
  
  return new Date(dateStr);
};

/**
 * Helper: Find or create supplier
 */
const findOrCreateSupplier = async (supplierName) => {
  if (!supplierName || supplierName.trim() === '') return null;
  
  const name = supplierName.trim();
  let supplier = await Supplier.findOne({ 
    name: { $regex: new RegExp(`^${name}$`, 'i') } 
  });
  
  if (!supplier) {
    supplier = new Supplier({
      name,
      category: 'General',
      status: 'active',
      autoCreated: true // Flag for tracking
    });
    await supplier.save();
  }
  
  return supplier;
};

/**
 * Helper: Find or create user by name
 */
const findOrCreateUser = async (userName, migrationUserId) => {
  if (!userName || userName.trim() === '') return migrationUserId;
  
  const name = userName.trim();
  let user = await User.findOne({ 
    fullName: { $regex: new RegExp(`^${name}$`, 'i') } 
  });
  
  if (!user) {
    // Return migration user if not found
    return migrationUserId;
  }
  
  return user._id;
};


exports.migrateAvailableStock = async (req, res) => {
  try {
    const parseNumber = (val) => {
      if (val === null || val === undefined || val === '') return 0;
      const num = parseFloat(val.toString().replace(/[^0-9.-]/g, ''));
      return isNaN(num) ? 0 : num;
    };

    const { data, mode = 'update' } = req.body;
    const results = {
      imported: 0,
      updated: 0,
      failed: 0,
      errors: [],
      warnings: [],
      created: [],
      updated_items: [],
      duplicateCodesInUpload: [],
      mode
    };

    const seenCodes = {};
    const duplicateCodeMap = {};

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      try {
        let materialCode = row['Material Code']?.toString().trim();

        if (!materialCode) {
          results.errors.push(`Row ${i + 2}: Missing Material Code`);
          results.failed++;
          continue;
        }

        if (seenCodes[materialCode]) {
          seenCodes[materialCode].count++;
          seenCodes[materialCode].rows.push(i + 2);
          results.warnings.push(
            `Row ${i + 2}: Duplicate code "${materialCode}" found in upload (first seen at row ${seenCodes[materialCode].rows[0]}). ${
              mode === 'create-new' ? 'Will create with suffix.' : 'Last occurrence will overwrite.'
            }`
          );

          if (mode === 'create-new') {
            materialCode = `${materialCode}-V${seenCodes[materialCode].count}`;
          }

          if (!duplicateCodeMap[row['Material Code']]) {
            duplicateCodeMap[row['Material Code']] = [];
          }
          duplicateCodeMap[row['Material Code']].push(i + 2);
        } else {
          seenCodes[materialCode] = { count: 1, rows: [i + 2] };
        }

        const materialCodeValue = row['Material Code']?.toString().trim();
        const supplierValue = row['SUPPLIER']?.toString().trim() || '';
        const standardPriceValue = parseNumber(row['UP']) || parseNumber(row['TP']);

        let item = null;
        if (materialCodeValue) {
          item = await Item.findOne({
            code: materialCodeValue,
            supplier: supplierValue,
            standardPrice: standardPriceValue
          });
        }

        const rawUOM = row['UOM']?.toString().trim() || 'Each';
        const normalizedUOM = normalizeUOM(rawUOM);

        // ✅ parseNumber is declared ONCE above — no duplicate here

        const itemData = {
          code: materialCode,
          description: row['Material Name']?.toString().trim() || 'Unknown',
          category: row['CATEGORY']?.toString().trim() || 'General',
          unitOfMeasure: normalizedUOM,
          stockQuantity: parseNumber(row['ON HAND']),
          standardPrice: parseNumber(row['UP']) || parseNumber(row['TP']),
          averageCost: parseNumber(row['TP']) || parseNumber(row['UP']),
          supplier: row['SUPPLIER']?.toString().trim() || '',
          location: 'Main Warehouse',
          minimumStock: 0,
          reorderPoint: 0,
          isActive: true,
          lastStockUpdate: new Date(),
          createdBy: req.user.userId
        };

        if (mode === 'create-new' || !item) {
          item = new Item(itemData);
          await item.save();
          results.imported++;
          results.created.push({
            code: materialCode,
            description: itemData.description,
            supplier: itemData.supplier,
            standardPrice: itemData.standardPrice,
            uom: normalizedUOM,
            stockQuantity: itemData.stockQuantity,
            row: i + 2
          });
        } else {
          const oldValues = {
            code: item.code,
            description: item.description,
            supplier: item.supplier,
            standardPrice: item.standardPrice,
            stockQuantity: item.stockQuantity
          };
          Object.assign(item, itemData);
          await item.save();
          results.updated++;
          results.updated_items.push({
            code: materialCode,
            description: itemData.description,
            supplier: itemData.supplier,
            standardPrice: itemData.standardPrice,
            oldStock: oldValues.stockQuantity,
            newStock: itemData.stockQuantity,
            row: i + 2
          });
        }

      } catch (error) {
        console.error(`Error processing row ${i + 2}:`, error);
        results.errors.push(`Row ${i + 2}: ${error.message}`); // ✅ was missing
        results.failed++;
      }
    }

    // ✅ Response is NOW here — after the loop, inside the outer try
    const modeLabel =
      mode === 'create-new'
        ? '(CREATE-NEW MODE - duplicates with suffix)'
        : '(UPDATE MODE)';

    res.json({
      success: true,
      message: `Migration completed ${modeLabel}: ${results.imported} created, ${results.updated} updated, ${results.failed} failed. ⚠️ ${results.warnings.length} warnings.`,
      data: results
    });

  } catch (error) {
    console.error('Available stock migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Migration failed',
      error: error.message
    });
  }
};

/**
 * 2. Migrate Inbound History (Creates Historical Transactions)
 */
exports.migrateInbound = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { data } = req.body;
    const results = {
      imported: 0,
      failed: 0,
      errors: [],
      skipped: 0
    };

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      try {
        const materialCode = row['Material Code']?.toString().trim();
        
        if (!materialCode) {
          results.errors.push(`Row ${i + 2}: Missing Material Code`);
          results.failed++;
          continue;
        }

        // Find item
        const item = await Item.findOne({ code: materialCode }).session(session);
        if (!item) {
          results.errors.push(`Row ${i + 2}: Item not found - ${materialCode}`);
          results.failed++;
          continue;
        }

        // Find or create supplier
        const supplier = await findOrCreateSupplier(row['SUPPLIER']);
        
        // Find or create user
        const receivedByUser = await findOrCreateUser(
          row['RECEIVED BY'], 
          req.user.userId
        );

        // Parse values
        const quantity = parseFloat(row['INBOUND']) || 0;
        const unitPrice = parseFloat(row['UP']) || 0;
        const transactionDate = parseExcelDate(row['DATE']);

        if (quantity <= 0) {
          results.skipped++;
          continue;
        }

        // Create inbound transaction (historical - don't update stock)
        const transaction = new StockTransaction({
          transactionType: 'inbound',
          item: item._id,
          quantity,
          unitPrice,
          transactionDate,
          poNumber: row['PO No.']?.toString().trim(),
          supplier: supplier?._id,
          supplierName: row['SUPPLIER']?.toString().trim(),
          receivedBy: receivedByUser,
          initialQuantity: parseFloat(row['INITIAL QTY']) || 0,
          projectName: row['PROJECT']?.toString().trim(),
          comment: row['Comment']?.toString().trim() || 'Historical data migration',
          status: 'completed',
          createdBy: req.user.userId,
          // Note: NOT updating item stock - already set in available stock
          stockBefore: 0, // Historical - unknown
          stockAfter: 0   // Historical - unknown
        });

        await transaction.save({ session });
        results.imported++;

      } catch (error) {
        console.error(`Error processing row ${i + 2}:`, error);
        results.errors.push(`Row ${i + 2}: ${error.message}`);
        results.failed++;
      }
    }

    await session.commitTransaction();
    
    res.json({
      success: true,
      message: `Inbound migration completed: ${results.imported} imported, ${results.skipped} skipped, ${results.failed} failed`,
      data: results
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Inbound migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Migration failed',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

/**
 * 3. Migrate Outbound History (Creates Historical Transactions)
 */
exports.migrateOutbound = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { data } = req.body;
    const results = {
      imported: 0,
      failed: 0,
      errors: [],
      skipped: 0
    };

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      try {
        const description = row['Description']?.toString().trim();
        
        if (!description) {
          results.errors.push(`Row ${i + 2}: Missing Description`);
          results.failed++;
          continue;
        }

        // Try to find item by description or SN
        const item = await Item.findOne({
          $or: [
            { description: { $regex: new RegExp(description, 'i') } },
            { code: row['SN']?.toString().trim() }
          ]
        }).session(session);

        if (!item) {
          results.errors.push(`Row ${i + 2}: Item not found - ${description}`);
          results.failed++;
          continue;
        }

        // Find users
        const requestorUser = await findOrCreateUser(
          row['Requestor'], 
          req.user.userId
        );
        const servedByUser = await findOrCreateUser(
          row['Served By'], 
          req.user.userId
        );

        // Parse values
        const quantity = parseFloat(row['Qty']) || 0;
        const unitPrice = parseFloat(row['UP']) || item.averageCost || 0;
        const transactionDate = parseExcelDate(row['MFR DATE'] || row['DATE INTALLED']);

        if (quantity <= 0) {
          results.skipped++;
          continue;
        }

        // Create outbound transaction (historical - don't update stock)
        const transaction = new StockTransaction({
          transactionType: 'outbound',
          item: item._id,
          quantity,
          unitPrice,
          transactionDate,
          cluster: row['CLUSTER']?.toString().trim(),
          siteName: row['SITE NAME']?.toString().trim(),
          ihsId: row['IHS ID']?.toString().trim(),
          siteId: row['Site ID']?.toString().trim(),
          mfrNumber: row['MFR Number']?.toString().trim(),
          mfrDate: parseExcelDate(row['MFR DATE']),
          projectName: row['PROJECT NAME']?.toString().trim(),
          requestor: requestorUser,
          requestorName: row['Requestor']?.toString().trim(),
          deliveryNote: row['Delivery Note']?.toString().trim(),
          carrierName: row['Carrier Name']?.toString().trim(),
          servedBy: servedByUser,
          servedByName: row['Served By']?.toString().trim(),
          transporter: row['Transporter']?.toString().trim(),
          comment: row['Comment']?.toString().trim() || 'Historical data migration',
          status: 'completed',
          createdBy: req.user.userId,
          // Note: NOT updating item stock - already set in available stock
          stockBefore: 0, // Historical - unknown
          stockAfter: 0   // Historical - unknown
        });

        await transaction.save({ session });
        results.imported++;

      } catch (error) {
        console.error(`Error processing row ${i + 2}:`, error);
        results.errors.push(`Row ${i + 2}: ${error.message}`);
        results.failed++;
      }
    }

    await session.commitTransaction();
    
    res.json({
      success: true,
      message: `Outbound migration completed: ${results.imported} imported, ${results.skipped} skipped, ${results.failed} failed`,
      data: results
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Outbound migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Migration failed',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

/**
 * 4. Migrate Supplier Performance
 */
exports.migrateSuppliers = async (req, res) => {
  try {
    const { data } = req.body;
    const results = {
      imported: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      try {
        const supplierName = row['Supplier Name']?.toString().trim();
        
        if (!supplierName) {
          results.errors.push(`Row ${i + 2}: Missing Supplier Name`);
          results.failed++;
          continue;
        }

        // Find or create supplier
        let supplier = await Supplier.findOne({ 
          name: { $regex: new RegExp(`^${supplierName}$`, 'i') } 
        });

        const supplierData = {
          name: supplierName,
          category: row['Category']?.toString().trim() || 'General',
          performanceMetrics: {
            onTimeDelivery: parseFloat(row['On-Time Delivery (%)']) || 0,
            qualityRating: parseFloat(row['Quality Rating (%)']) || 0,
            costCompliance: parseFloat(row['Cost Compliance (%)']) || 0,
            responsivenessRating: parseFloat(row['Responsiveness Rating (%)']) || 0,
            overallScore: parseFloat(row['Overall Performance Score (%)']) || 0
          },
          remarks: row['Remarks']?.toString().trim() || '',
          status: 'active'
        };

        if (supplier) {
          Object.assign(supplier, supplierData);
          await supplier.save();
          results.updated++;
        } else {
          supplier = new Supplier(supplierData);
          await supplier.save();
          results.imported++;
        }

      } catch (error) {
        console.error(`Error processing row ${i + 2}:`, error);
        results.errors.push(`Row ${i + 2}: ${error.message}`);
        results.failed++;
      }
    }

    res.json({
      success: true,
      message: `Supplier migration completed: ${results.imported} created, ${results.updated} updated, ${results.failed} failed`,
      data: results
    });

  } catch (error) {
    console.error('Supplier migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Migration failed',
      error: error.message
    });
  }
};

/**
 * Validation endpoint - runs before migration
 */
exports.validateMigrationData = async (req, res) => {
  try {
    const { type, data } = req.body;
    const errors = [];
    const warnings = [];

    // Add validation logic based on type
    // This is called from the frontend before actual migration
    
    res.json({
      success: true,
      data: {
        valid: errors.length === 0,
        errors,
        warnings
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Validation failed',
      error: error.message
    });
  }
};

/**
 * Reconciliation endpoint - verifies stock accuracy
 */
exports.reconcileStock = async (req, res) => {
  try {
    const items = await Item.find({ isActive: true });
    const discrepancies = [];

    for (const item of items) {
      // Calculate expected stock from transactions
      const transactions = await StockTransaction.find({ item: item._id });
      
      let calculatedStock = 0;
      transactions.forEach(t => {
        if (t.transactionType === 'inbound') calculatedStock += t.quantity;
        if (t.transactionType === 'outbound') calculatedStock -= t.quantity;
      });

      // Compare with current stock
      if (Math.abs(calculatedStock - item.stockQuantity) > 0.01) {
        discrepancies.push({
          itemCode: item.code,
          description: item.description,
          currentStock: item.stockQuantity,
          calculatedStock,
          difference: item.stockQuantity - calculatedStock
        });
      }
    }

    res.json({
      success: true,
      data: {
        totalItems: items.length,
        discrepancies: discrepancies.length,
        items: discrepancies
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Reconciliation failed',
      error: error.message
    });
  }
};