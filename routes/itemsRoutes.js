const express = require('express');
const router = express.Router();
const itemController = require('../controllers/itemController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const uploadMiddleware = require('../middlewares/uploadMiddleware');


router.get('/', 
  authMiddleware, 
  itemController.getAllItems
);

router.get('/active', 
  authMiddleware, 
  itemController.getActiveItems
);

router.get('/categories', 
  authMiddleware, 
  itemController.getCategories
);

// Upload item image
router.post('/upload-image', 
  authMiddleware, 
  requireRoles('admin', 'supply_chain'),
  uploadMiddleware.single('image'),
  itemController.uploadItemImage
);

// Search items
router.get('/search', 
  authMiddleware, 
  itemController.searchItems
);

router.post('/import', 
  authMiddleware, 
  requireRoles('admin', 'supply_chain'),
  itemController.importItems
);

router.get('/export', 
  authMiddleware, 
  requireRoles('admin', 'supply_chain'),
  itemController.exportItems
);


router.post('/validate', authMiddleware, async (req, res) => {
  try {
    const { itemIds } = req.body;
    
    if (!itemIds || !Array.isArray(itemIds)) {
      return res.status(400).json({
        success: false,
        message: 'itemIds array is required'
      });
    }

    console.log('Validating item IDs:', itemIds);

    // Import your Item model
    const Item = require('../models/Item'); 
    
    const items = await Item.find({ 
      _id: { $in: itemIds },
      isActive: true 
    }).select('_id code description');

    console.log('Found items:', items.length);

    // Check if all requested items were found
    const foundItemIds = items.map(item => item._id.toString());
    const missingItems = itemIds.filter(id => !foundItemIds.includes(id));

    if (missingItems.length > 0) {
      console.log('Missing items:', missingItems);
      return res.status(400).json({
        success: false,
        valid: false,
        message: `Items not found: ${missingItems.join(', ')}`,
        missingItems: missingItems
      });
    }

    res.json({
      success: true,
      valid: true,
      message: 'All items are valid',
      validatedItems: items
    });

  } catch (error) {
    console.error('Item validation error:', error);
    res.status(500).json({
      success: false,
      valid: false,
      message: 'Failed to validate items',
      error: error.message
    });
  }
});

// Submit new item request (Employee)
router.post('/requests', 
  authMiddleware, 
  itemController.requestNewItem
);

// Get item requests (role-based access)
router.get('/requests', 
  authMiddleware, 
  itemController.getItemRequests
);

// Get employee's own item requests
router.get('/requests/employee', 
  authMiddleware, 
  itemController.getEmployeeItemRequests
);

// Process item request (Supply Chain only)
router.patch('/requests/:requestId', 
  authMiddleware, 
  requireRoles('admin', 'supply_chain'),
  itemController.processItemRequest
);


// Get item by ID
router.get('/:id', 
  authMiddleware, 
  itemController.getItemById
);

// Create new item (Supply Chain only)
router.post('/', 
  authMiddleware, 
  requireRoles('admin', 'supply_chain'),
  itemController.createItem
);

// Update item (Supply Chain only)
router.put('/:id', 
  authMiddleware, 
  requireRoles('admin', 'supply_chain'),
  itemController.updateItem
);

// Toggle item status (Supply Chain only)
router.patch('/:id/status', 
  authMiddleware, 
  requireRoles('admin', 'supply_chain'),
  itemController.toggleItemStatus
);

// Delete item (Supply Chain only)
router.delete('/:id', 
  authMiddleware, 
  requireRoles('admin', 'supply_chain'),
  itemController.deleteItem
);

module.exports = router;