const express = require('express');
const router = express.Router();
const projectPlanController = require('../controllers/projectPlanController');
const { requireRoles, authMiddleware } = require('../middlewares/authMiddleware');

// ========================================
// IMPORTANT: Specific routes MUST come BEFORE dynamic routes
// ========================================

// Employee Routes - Statistics (BEFORE /:id)
router.get('/stats', authMiddleware, projectPlanController.getStatistics);

// Employee Routes - My Plans (BEFORE /:id)
router.get('/my-plans', authMiddleware, projectPlanController.getMyProjectPlans);

// Approver Routes - MUST be BEFORE /:id route
router.get(
  '/pending-approvals', 
  authMiddleware,
  requireRoles('admin', 'buyer', 'supply_chain', 'project', 'ceo'), 
  projectPlanController.getMyPendingApprovals
);

router.get(
  '/all', 
  authMiddleware, 
  requireRoles('admin', 'buyer', 'supply_chain', 'project', 'ceo'), 
  projectPlanController.getAllProjectPlans
);

// ========================================
// Employee Routes - Create, Update, Delete
// ========================================
router.post('/', authMiddleware, projectPlanController.createProjectPlan);

// Submit for approval (BEFORE /:id route)
router.post('/:id/submit', authMiddleware, projectPlanController.submitProjectPlan);

// Approval actions (BEFORE /:id route)
router.post(
  '/:id/approve', 
  authMiddleware, 
  requireRoles('admin', 'buyer', 'supply_chain', 'project', 'ceo'), 
  projectPlanController.approveProjectPlan
);

router.post(
  '/:id/reject', 
  authMiddleware, 
  requireRoles('admin', 'buyer', 'supply_chain', 'project', 'ceo'), 
  projectPlanController.rejectProjectPlan
);

// Update and delete (BEFORE /:id GET route)
router.put('/:id', authMiddleware, projectPlanController.updateProjectPlan);
router.delete('/:id', authMiddleware, projectPlanController.deleteProjectPlan);

// Completion item tracking (BEFORE /:id GET route)
router.post(
  '/:planId/completion-items/:itemId/complete',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'project', 'ceo'),
  projectPlanController.markCompletionItemComplete
);

router.post(
  '/:planId/completion-items/:itemId/uncomplete',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'project', 'ceo'),
  projectPlanController.unmarkCompletionItemComplete
);

// ========================================
// Dynamic Routes - MUST BE LAST
// ========================================
// Get single project plan by ID (MUST BE LAST)
router.get('/:id', authMiddleware, projectPlanController.getProjectPlanById);

module.exports = router;




