const express = require('express');
const router = express.Router();
const fixedAssetController = require('../controllers/fixedAssetController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// Dashboard
router.get('/dashboard',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  fixedAssetController.getAssetDashboard
);

// Asset management
router.post('/register',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  fixedAssetController.registerAsset
);

router.get('/',
  authMiddleware,
  fixedAssetController.getAssets
);

router.get('/available-tags',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  fixedAssetController.getAvailableAssetTags
);

router.get('/:assetTag',
  authMiddleware,
  fixedAssetController.getAssetByTag
);

router.put('/:assetTag',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  fixedAssetController.updateAsset
);

// Assignment
router.post('/:assetTag/assign',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'hr'),
  fixedAssetController.assignAsset
);

router.post('/:assetTag/return',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'hr'),
  fixedAssetController.returnAsset
);

// Maintenance
router.post('/:assetTag/maintenance',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'it'),
  fixedAssetController.addMaintenance
);

// Disposal
router.post('/:assetTag/dispose',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  fixedAssetController.disposeAsset
);

// Reports
router.get('/:assetTag/depreciation-schedule',
  authMiddleware,
  fixedAssetController.getDepreciationSchedule
);

router.get('/:assetTag/barcode',
  authMiddleware,
  fixedAssetController.generateAssetBarcode
);

module.exports = router;