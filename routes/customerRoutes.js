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
  requireRoles('admin', 'supply_chain', 'finance', 'buyer'),
  customerController.getCustomerDashboardStats
);

// Pending approvals for current user
router.get('/pending-approvals',
  requireRoles('admin', 'supply_chain', 'finance'),
  customerController.getPendingApprovals
);

// Get all customers
router.get('/',
  requireRoles('admin', 'supply_chain', 'finance', 'buyer'),
  customerController.getAllCustomers
);

// Create customer manually
router.post('/',
  requireRoles('admin', 'supply_chain', 'finance', 'it'),
  customerController.createCustomer
);

// Get customer by ID
router.get('/:id',
  requireRoles('admin', 'supply_chain', 'finance', 'buyer'),
  customerController.getCustomerById
);

// Update customer
router.put('/:id',
  requireRoles('admin', 'supply_chain'),
  customerController.updateCustomer
);

// Update customer status
router.patch('/:id/status',
  requireRoles('admin', 'supply_chain'),
  customerController.updateCustomerStatus
);

// Approve customer
router.post('/:id/approve',
  requireRoles('admin', 'supply_chain', 'finance'),
  customerController.approveCustomer
);

// Reject customer
router.post('/:id/reject',
  requireRoles('admin', 'supply_chain', 'finance'),
  customerController.rejectCustomer
);

// Add note to customer
router.post('/:id/notes',
  requireRoles('admin', 'supply_chain', 'finance', 'buyer'),
  customerController.addCustomerNote
);

// ==========================================
// ONBOARDING APPLICATION ROUTES
// ==========================================

// Get all onboarding applications
router.get('/onboarding/applications',
  requireRoles('admin', 'supply_chain'),
  customerController.getOnboardingApplications
);

// Create onboarding application
router.post('/onboarding/applications',
  requireRoles('admin', 'supply_chain'),
  customerController.createOnboardingApplication
);

// Approve onboarding application
router.post('/onboarding/applications/:id/approve',
  requireRoles('admin', 'supply_chain', 'finance'),
  customerController.approveOnboardingApplication
);

// ==========================================
// PURCHASE ORDER ROUTES (Finance)
// ==========================================

// Upload PO for customer
router.post('/:customerId/purchase-orders',
  requireRoles('admin', 'finance'),
  upload.single('file'),
  customerController.uploadPurchaseOrder
);

// Get customer's purchase orders
router.get('/:customerId/purchase-orders',
  requireRoles('admin', 'supply_chain', 'finance', 'buyer'),
  customerController.getCustomerPurchaseOrders
);

// Update PO (full edit)
router.put('/:customerId/purchase-orders/:poId',
  requireRoles('admin', 'supply_chain', 'finance'),
  upload.single('file'),
  customerController.updatePurchaseOrder
);

// Update PO status
router.patch('/:customerId/purchase-orders/:poId',
  requireRoles('admin', 'finance'),
  customerController.updatePurchaseOrderStatus
);

// Delete PO
router.delete('/:customerId/purchase-orders/:poId',
  requireRoles('admin', 'finance'),
  customerController.deletePurchaseOrder
);

module.exports = router;
