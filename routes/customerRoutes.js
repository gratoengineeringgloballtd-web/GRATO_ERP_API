const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/fileUpload');

// All routes require authentication
router.use(authMiddleware);

// Debug logging for PO routes
router.use((req, res, next) => {
  if (req.path.includes('purchase-orders')) {
    console.log(`📍 PO Route match: ${req.method} ${req.path}`);
  }
  next();
});

// Dashboard stats
router.get('/dashboard-stats', 
  requireRoles('admin', 'supply_chain', 'finance', 'buyer', 'ceo'),
  customerController.getCustomerDashboardStats
);

// Pending approvals for current user
router.get('/pending-approvals',
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  customerController.getPendingApprovals
);

// Get all customers
router.get('/',
  requireRoles('admin', 'supply_chain', 'finance', 'buyer', 'ceo'),
  customerController.getAllCustomers
);

// Create customer manually
router.post('/',
  requireRoles('admin', 'supply_chain', 'finance', 'it', 'ceo'),
  customerController.createCustomer
);

// Get customer by ID
router.get('/:id',
  requireRoles('admin', 'supply_chain', 'finance', 'buyer', 'ceo'),
  customerController.getCustomerById
);

// Update customer
router.put('/:id',
  requireRoles('admin', 'supply_chain', 'ceo'),
  customerController.updateCustomer
);

// Update customer status
router.patch('/:id/status',
  requireRoles('admin', 'supply_chain', 'ceo'),
  customerController.updateCustomerStatus
);

// Approve customer
router.post('/:id/approve',
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  customerController.approveCustomer
);

// Reject customer
router.post('/:id/reject',
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  customerController.rejectCustomer
);

// Add note to customer
router.post('/:id/notes',
  requireRoles('admin', 'supply_chain', 'finance', 'buyer', 'ceo'),
  customerController.addCustomerNote
);

// ==========================================
// ONBOARDING APPLICATION ROUTES
// ==========================================

// Get all onboarding applications
router.get('/onboarding/applications',
  requireRoles('admin', 'supply_chain', 'ceo'),
  customerController.getOnboardingApplications
);

// Create onboarding application
router.post('/onboarding/applications',
  requireRoles('admin', 'supply_chain', 'ceo'),
  customerController.createOnboardingApplication
);

// Approve onboarding application
router.post('/onboarding/applications/:id/approve',
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  customerController.approveOnboardingApplication
);

// ==========================================
// PURCHASE ORDER ROUTES (Finance)
// ==========================================

// Upload PO for customer
router.post('/:customerId/purchase-orders',
  requireRoles('admin', 'finance', 'ceo'),
  upload.single('file'),
  customerController.uploadPurchaseOrder
);

// Get customer's purchase orders
router.get('/:customerId/purchase-orders',
  requireRoles('admin', 'supply_chain', 'finance', 'buyer', 'ceo'),
  customerController.getCustomerPurchaseOrders
);

// Update PO (full edit)
router.put('/:customerId/purchase-orders/:poId',
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  upload.single('file'),
  customerController.updatePurchaseOrder
);

// Update PO status
router.patch('/:customerId/purchase-orders/:poId',
  requireRoles('admin', 'finance', 'ceo'),
  customerController.updatePurchaseOrderStatus
);

// Delete PO
router.delete('/:customerId/purchase-orders/:poId',
  requireRoles('admin', 'finance', 'ceo'),
  customerController.deletePurchaseOrder
);

module.exports = router;
