const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const unifiedSupplierController = require('../controllers/unifiedSupplierController');
const contractController = require('../controllers/contractController');
const supplierInvoiceController = require('../controllers/supplierInvoiceController');
const supplierOnboardingController = require('../controllers/supplierOnboardingController');
const supplierRfqController = require('../controllers/supplierRfqController');
const supplierApprovalController = require('../controllers/supplierApprovalController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const { 
  supplierAuthMiddleware, 
  requireActiveSupplier, 
  requireSupplierType,
  combinedAuthMiddleware 
} = require('../middlewares/supplierAuthMiddleware');
const upload = require('../middlewares/uploadMiddleware');

// ===============================
// SUPPLIER REGISTRATION & AUTH
// ===============================

router.post('/register-onboard',
  upload.fields([
    { name: 'businessRegistrationCertificate', maxCount: 1 },
    { name: 'taxClearanceCertificate', maxCount: 1 },
    { name: 'bankStatement', maxCount: 1 },
    { name: 'insuranceCertificate', maxCount: 1 },
    { name: 'additionalDocuments', maxCount: 5 }
  ]),
  unifiedSupplierController.registerAndOnboardSupplier
);

router.post('/register', supplierController.registerSupplier);
router.get('/verify-email/:token', supplierController.verifySupplierEmail);
router.post('/login', supplierController.loginSupplier);

// ===============================
// SUPPLIER APPROVAL WORKFLOW ROUTES
// IMPORTANT: These must come BEFORE /:supplierId routes
// ===============================

/**
 * Get approval statistics
 * MUST be before /:supplierId to avoid treating 'statistics' as an ID
 */
router.get('/admin/approvals/statistics',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierApprovalController.getSupplierApprovalStats
);

// In suppliers.js routes
router.get('/files/signed-url',
  combinedAuthMiddleware, 
  supplierInvoiceController.getSignedFileUrl
);

router.get('/files/proxy',
  combinedAuthMiddleware,
  supplierInvoiceController.proxyFile
);

router.post('/admin/files/make-public',
  authMiddleware,
  requireRoles('admin'),
  supplierInvoiceController.makeFilePublic
);

/**
 * Get approval dashboard data
 * MUST be before /:supplierId
 */
router.get('/admin/approvals/dashboard',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierApprovalController.getSupplierApprovalDashboard
);

/**
 * Get suppliers pending approval for current user
 */
router.get('/admin/approvals/pending',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierApprovalController.getPendingApprovalsForUser
);

/**
 * Bulk process supplier approvals
 * MUST be before /:supplierId
 */
router.post('/admin/approvals/bulk-process',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierApprovalController.bulkProcessSupplierApprovals
);

/**
 * Get supplier approval timeline
 * This uses :supplierId/timeline pattern, so it's safe
 */
router.get('/admin/approvals/:supplierId/timeline',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierApprovalController.getSupplierApprovalTimeline
);

/**
 * Process supplier approval/rejection
 * This uses :supplierId/decision pattern, so it's safe
 */
router.post('/admin/approvals/:supplierId/decision',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierApprovalController.processSupplierApproval
);

/**
 * Get single supplier with full approval details
 * This must come AFTER all specific routes like /statistics, /dashboard, /pending, /bulk-process
 */
router.get('/admin/approvals/:supplierId',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierApprovalController.getSupplierWithApprovalDetails
);

// ===============================
// SUPPLY CHAIN COORDINATOR ROUTES (WITH DOCUMENT SIGNING)
// ===============================

// Get invoices pending supply chain assignment
router.get('/supply-chain/invoices/pending',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'ceo'),
  supplierInvoiceController.getSupplierInvoicesPendingSupplyChainAssignment
);

// Download invoice for signing (Supply Chain & Approvers)
router.get('/invoices/:invoiceId/download-for-signing',
  authMiddleware,
  supplierInvoiceController.downloadInvoiceForSigning
);

// Assign invoice to department WITH signed document upload
router.post('/supply-chain/invoices/:invoiceId/assign',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'ceo'),
  upload.fields([
    { name: 'signedDocument', maxCount: 1 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  supplierInvoiceController.assignSupplierInvoiceBySupplyChain
);

// Reject invoice (Supply Chain Coordinator)
router.post('/supply-chain/invoices/:invoiceId/reject',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'ceo'),
  supplierInvoiceController.rejectSupplierInvoiceBySupplyChain
);

// Bulk assign invoices (Supply Chain Coordinator)
router.post('/supply-chain/invoices/bulk-assign',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'ceo'),
  supplierInvoiceController.bulkAssignSupplierInvoicesBySupplyChain
);

// Get Supply Chain dashboard statistics
router.get('/supply-chain/dashboard/stats',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'ceo'),
  supplierInvoiceController.getSupplyChainDashboardStats
);

// ===============================
// SUPERVISOR/APPROVER ROUTES (WITH DOCUMENT SIGNING)
// ===============================

// Get pending supplier approvals for user
router.get('/supervisor/pending',
  authMiddleware,
  requireRoles('supervisor', 'admin', 'finance', 'hr', 'it', 'technical', 'ceo'),
  supplierInvoiceController.getPendingSupplierApprovalsForUser
);

// Process supplier invoice approval/rejection WITH signed document
router.put('/supervisor/invoices/:invoiceId/decision',
  authMiddleware,
  requireRoles('supervisor', 'admin', 'finance', 'hr', 'it', 'technical', 'ceo'),
  upload.fields([
    { name: 'signedDocument', maxCount: 1 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  supplierInvoiceController.processSupplierApprovalStep
);

// ===============================
// SUPPLIER PROFILE MANAGEMENT
// ===============================

router.get('/dashboard',
  supplierAuthMiddleware,
  requireActiveSupplier,
  unifiedSupplierController.getSupplierDashboard
);

router.get('/profile', 
  supplierAuthMiddleware, 
  supplierController.getSupplierProfile
);

router.put('/profile', 
  supplierAuthMiddleware, 
  requireActiveSupplier,
  supplierController.updateSupplierProfile
);

// ===============================
// SUPPLIER RFQ ROUTES
// ===============================

router.get('/rfq-requests',
  supplierAuthMiddleware,
  requireActiveSupplier,
  supplierRfqController.getSupplierRfqRequests
);

router.get('/rfq-requests/:rfqId',
  supplierAuthMiddleware,
  requireActiveSupplier,
  supplierRfqController.getSupplierRfqById
);

router.post('/rfq-requests/:rfqId/submit-quote',
  supplierAuthMiddleware,
  requireActiveSupplier,
  upload.fields([
    { name: 'quoteDocuments', maxCount: 5 },
    { name: 'technicalSpecs', maxCount: 10 },
    { name: 'certificates', maxCount: 5 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  supplierRfqController.submitQuote
);

router.get('/quotes',
  supplierAuthMiddleware,
  requireActiveSupplier,
  supplierRfqController.getSupplierQuotes
);

// ===============================
// ADMIN OPERATIONS
// IMPORTANT: Specific routes before parameterized routes
// ===============================

router.post('/bulk-import',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'ceo'),
  unifiedSupplierController.bulkImportSuppliers
);

// This route was conflicting - use the approval workflow route instead
// router.post('/:supplierId/approve-reject',
//   authMiddleware,
//   requireRoles('admin', 'supply_chain', 'finance'),
//   supplierApprovalController.processSupplierApproval
// );

router.get('/admin/all',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'),
  supplierController.getAllSuppliers
);

router.put('/admin/:supplierId/status',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierController.updateSupplierStatus
);

// ===============================
// SUPPLIER ONBOARDING ADMIN ROUTES
// ===============================

router.get('/admin/onboarding/applications',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierOnboardingController.getAllApplications
);

router.get('/admin/onboarding/statistics',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierOnboardingController.getOnboardingStatistics
);

router.put('/admin/onboarding/applications/bulk-update',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierOnboardingController.bulkUpdateApplications
);

router.get('/admin/onboarding/export',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierOnboardingController.exportApplications
);

router.get('/admin/onboarding/applications/:applicationId',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierOnboardingController.getApplicationById
);

router.put('/admin/onboarding/applications/:applicationId/status',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierOnboardingController.updateApplicationStatus
);

router.post('/admin/onboarding/applications/:applicationId/notes',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierOnboardingController.addReviewNote
);

router.post('/admin/onboarding/applications/:applicationId/documents',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  upload.fields([
    { name: 'documents', maxCount: 10 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  supplierOnboardingController.uploadAdditionalDocuments
);

router.get('/admin/onboarding/applications/:applicationId/documents/:documentId',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance', 'ceo'),
  supplierOnboardingController.downloadDocument
);

// ===============================
// CONTRACT MANAGEMENT
// ===============================

router.post('/contracts',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'ceo'),
  contractController.createContract
);

router.post('/contracts/:contractId/link-invoice',
  authMiddleware,
  requireRoles('admin', 'finance', 'ceo'),
  contractController.linkInvoiceToContract
);

router.delete('/contracts/:contractId/invoices/:invoiceId',
  authMiddleware,
  requireRoles('admin', 'finance', 'ceo'),
  contractController.unlinkInvoiceFromContract
);

router.get('/contracts/:contractId/with-invoices',
  authMiddleware,
  contractController.getContractWithInvoices
);

// ===============================
// SUPPLIER INVOICE SUBMISSION
// ===============================

router.post('/invoices',
  supplierAuthMiddleware,
  requireActiveSupplier,
  upload.fields([
    { name: 'invoiceFile', maxCount: 1 },
    { name: 'poFile', maxCount: 1 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  supplierInvoiceController.submitSupplierInvoice
);

router.get('/invoices',
  supplierAuthMiddleware,
  requireActiveSupplier,
  supplierInvoiceController.getSupplierInvoices
);

router.get('/invoices/:invoiceId',
  combinedAuthMiddleware,
  supplierInvoiceController.getSupplierInvoiceDetails
);

// ===============================
// FINANCE ADMIN ROUTES
// ===============================

router.get('/admin/invoices',
  authMiddleware,
  requireRoles('admin', 'finance', 'ceo'),
  supplierInvoiceController.getSupplierInvoicesForFinance
);

router.put('/admin/invoices/:invoiceId/details',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  supplierInvoiceController.updateSupplierInvoiceDetails
);

router.post('/admin/invoices/:invoiceId/process-and-assign',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  async (req, res) => {
    const { department, comments, updateDetails } = req.body;
    req.body = { department, comments, updateDetails };
    return supplierInvoiceController.assignSupplierInvoiceToDepartment(req, res);
  }
);

router.post('/admin/invoices/:invoiceId/assign',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  supplierInvoiceController.assignSupplierInvoiceToDepartment
);

router.post('/admin/invoices/bulk-assign',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  supplierInvoiceController.bulkAssignSupplierInvoices
);

router.post('/admin/invoices/:invoiceId/payment',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  supplierInvoiceController.processSupplierInvoicePayment
);

router.put('/admin/invoices/:invoiceId/process',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  supplierInvoiceController.markSupplierInvoiceAsProcessed
);

router.get('/admin/analytics',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  supplierInvoiceController.getSupplierInvoiceAnalytics
);

// ===============================
// PARAMETERIZED ROUTES
// MUST COME LAST to avoid conflicts
// ===============================

/**
 * Get complete supplier profile
 * MUST come after all specific routes
 */
router.get('/:supplierId/complete-profile',
  authMiddleware,
  unifiedSupplierController.getCompleteSupplierProfile
);

/**
 * Update supplier profile
 * MUST come after all specific routes
 */
router.put('/:supplierId/profile',
  authMiddleware,
  unifiedSupplierController.updateSupplierProfile
);

/**
 * Get supplier contracts
 * MUST come after all specific routes
 */
router.get('/:supplierId/contracts',
  authMiddleware,
  contractController.getSupplierContracts
);

module.exports = router;






