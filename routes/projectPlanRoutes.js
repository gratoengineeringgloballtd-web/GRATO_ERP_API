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
  requireRoles('admin', 'buyer', 'supply_chain', 'project'), 
  projectPlanController.getMyPendingApprovals
);

router.get(
  '/all', 
  authMiddleware, 
  requireRoles('admin', 'buyer', 'supply_chain', 'project'), 
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
  requireRoles('admin', 'buyer', 'supply_chain', 'project'), 
  projectPlanController.approveProjectPlan
);

router.post(
  '/:id/reject', 
  authMiddleware, 
  requireRoles('admin', 'buyer', 'supply_chain', 'project'), 
  projectPlanController.rejectProjectPlan
);

// Update and delete (BEFORE /:id GET route)
router.put('/:id', authMiddleware, projectPlanController.updateProjectPlan);
router.delete('/:id', authMiddleware, projectPlanController.deleteProjectPlan);

// Completion item tracking (BEFORE /:id GET route)
router.post(
  '/:planId/completion-items/:itemId/complete',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'project'),
  projectPlanController.markCompletionItemComplete
);

router.post(
  '/:planId/completion-items/:itemId/uncomplete',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'project'),
  projectPlanController.unmarkCompletionItemComplete
);

// ========================================
// Dynamic Routes - MUST BE LAST
// ========================================
// Get single project plan by ID (MUST BE LAST)
router.get('/:id', authMiddleware, projectPlanController.getProjectPlanById);

module.exports = router;









// const express = require('express');
// const router = express.Router();
// const projectPlanController = require('../controllers/projectPlanController');
// const { requireRoles, authMiddleware } = require('../middlewares/authMiddleware');

// // ========================================
// // Employee Routes
// // ========================================
// router.get('/my-plans', authMiddleware, projectPlanController.getMyProjectPlans);
// router.get('/stats', authMiddleware, projectPlanController.getStatistics);
// router.post('/', authMiddleware, projectPlanController.createProjectPlan);
// router.put('/:id', authMiddleware, projectPlanController.updateProjectPlan);
// router.delete('/:id', authMiddleware, projectPlanController.deleteProjectPlan);
// router.get('/:id', authMiddleware, projectPlanController.getProjectPlanById);

// // Submit for approval
// router.post('/:id/submit', authMiddleware, projectPlanController.submitProjectPlan);

// // ========================================
// // Approver Routes (Project Coordinator & Head of Business)
// // ========================================
// router.get(
//   '/pending-approvals', 
//   authMiddleware,
//   requireRoles('admin', 'project', 'supply_chain'), // Christabel (buyer role) and Kelvin
//   projectPlanController.getMyPendingApprovals
// );

// router.get(
//   '/all', 
//   authMiddleware, 
//   requireRoles('admin', 'project', 'supply_chain'), // Christabel and Kelvin can view all
//   projectPlanController.getAllProjectPlans
// );

// router.post(
//   '/:id/approve', 
//   authMiddleware, 
//   requireRoles('admin', 'project', 'supply_chain'), // Christabel and Kelvin can approve
//   projectPlanController.approveProjectPlan
// );

// router.post(
//   '/:id/reject', 
//   authMiddleware, 
//   requireRoles('admin', 'project', 'supply_chain'), // Christabel and Kelvin can reject
//   projectPlanController.rejectProjectPlan
// );

// module.exports = router;




