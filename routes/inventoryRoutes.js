const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// Dashboard
router.get('/dashboard',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'buyer'),
  inventoryController.getInventoryDashboard
);

// Available Stock
router.get('/available-stock',
  authMiddleware,
  inventoryController.getAvailableStock
);

// Stock level for specific item
router.get('/stock-level/:itemId',
  authMiddleware,
  inventoryController.getStockLevel
);

// Item Details - NEW ROUTES
router.get('/items/:itemId',
  authMiddleware,
  inventoryController.getItemDetails
);

router.get('/items/:itemId/transactions',
  authMiddleware,
  inventoryController.getItemTransactions
);

router.get('/items/:itemId/stock-movement',
  authMiddleware,
  inventoryController.getItemStockMovement
);

router.get('/items/:itemId/audit',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'buyer'),
  inventoryController.getItemAuditTrail
);

router.get('/items/:itemId/analytics',
  authMiddleware,
  inventoryController.getItemAnalytics
);

router.patch('/items/:itemId',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'buyer'),
  inventoryController.updateItemDetails
);

// Transactions
router.get('/transactions',
  authMiddleware,
  inventoryController.getTransactions
);

router.post('/inbound',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'buyer'),
  inventoryController.recordInbound
);

router.post('/outbound',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'buyer'),
  inventoryController.recordOutbound
);

// Stock Adjustments
router.post('/adjustment',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'buyer'),
  inventoryController.createStockAdjustment
);

router.patch('/adjustment/:adjustmentId/approve',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'buyer'),
  inventoryController.approveStockAdjustment
);

// Reports
router.get('/movement-report',
  authMiddleware,
  inventoryController.getStockMovementReport
);

router.get('/reorder-alerts',
  authMiddleware,
  inventoryController.getReorderAlerts
);

router.get('/valuation',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'buyer'),
  inventoryController.getInventoryValuation
);

// Get all instances for an inventory item
router.get('/items/:itemId/instances',
  authMiddleware,
  async (req, res) => {
    try {
      const instances = await InventoryInstance.find({
        inventoryItem: req.params.itemId
      })
        .populate('assignedTo', 'fullName email')
        .populate('assignedProject', 'name code')
        .sort({ createdAt: -1 });
      
      res.json({
        success: true,
        data: { instances }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch item instances',
        error: error.message
      });
    }
  }
);

// Get instance by asset tag or barcode
router.get('/instances/search',
  authMiddleware,
  async (req, res) => {
    try {
      const { assetTag, barcode } = req.query;
      
      let query = {};
      if (assetTag) query.assetTag = assetTag.toUpperCase();
      if (barcode) query.barcode = barcode;
      
      const instance = await InventoryInstance.findOne(query)
        .populate('inventoryItem')
        .populate('assignedTo', 'fullName email')
        .populate('assignedProject', 'name code');
      
      if (!instance) {
        return res.status(404).json({
          success: false,
          message: 'Instance not found'
        });
      }
      
      res.json({
        success: true,
        data: instance
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to search instance',
        error: error.message
      });
    }
  }
);

module.exports = router;





