const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const subMilestoneController = require('../controllers/subMilestoneController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const pmReviewController = require('../controllers/pmMilestoneReviewController');

console.log('📋 Loading project routes...');

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Get supervisor's assigned milestones
router.get(
  '/my-milestones',
  projectController.getSupervisorMilestones
);

// Get project statistics
router.get(
  '/stats', 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'),
  projectController.getProjectStats
);

// Get dashboard stats
router.get(
  '/dashboard-stats', 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'),
  projectController.getDashboardStats
);

// Get active projects only
router.get(
  '/active',
  projectController.getActiveProjects
);

// Search projects
router.get(
  '/search',
  projectController.searchProjects
);

// Get user's projects
router.get(
  '/my-projects', 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'),
  projectController.getUserProjects
);

// Get projects by department (keyword 'department')
router.get(
  '/department/:department',
  projectController.getProjectsByDepartment
);

// Get all projects with filtering
// This handles: GET /api/projects?isDraft=false
router.get(
  '/',
  projectController.getProjects
);

// Create project
router.post(
  '/', 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'),
  projectController.createProject
);

// Get project analytics
router.get(
  '/:projectId/analytics',
  projectController.getProjectAnalytics
);

// Get projects with milestones pending PM review
router.get(
  '/pm/pending-review',
  requireRoles('employee', 'manager', 'admin', 'supply_chain', 'project', 'ceo'),
  pmReviewController.getProjectsPendingReview
);

// Approve milestone with PM KPI linking
router.post(
  '/:projectId/milestones/:milestoneId/pm-approve',
  requireRoles('employee', 'manager', 'admin', 'supply_chain', 'project', 'ceo'),
  pmReviewController.approveMilestoneWithKPIs
);

// Reject milestone
router.post(
  '/:projectId/milestones/:milestoneId/pm-reject',
  requireRoles('employee', 'manager', 'admin', 'supply_chain', 'project', 'ceo'),
  pmReviewController.rejectMilestone
);

// Bulk approve milestones
router.post(
  '/:projectId/milestones/pm-bulk-approve',
  requireRoles('employee', 'manager', 'admin', 'supply_chain', 'project', 'ceo'),
  pmReviewController.bulkApproveMilestones
);

// Get milestone details with tasks
router.get(
  '/:projectId/milestones/:milestoneId',
  projectController.getMilestoneDetails
);

router.get(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId/hierarchy',
  subMilestoneController.getSubMilestoneHierarchy
);

// Get milestone hierarchy (with all sub-milestones)
router.get(
  '/:projectId/milestones/:milestoneId/hierarchy',
  subMilestoneController.getMilestoneHierarchy
);

// Complete milestone
router.post(
  '/:projectId/milestones/:milestoneId/complete',
  projectController.completeMilestone
);

// Update milestone progress
router.patch(
  '/:projectId/milestones/:milestoneId/progress',
  projectController.updateProjectProgress
);

// ========== SUB-MILESTONE MANAGEMENT ==========

// Create sub-milestone under milestone or another sub-milestone
router.post(
  '/:projectId/milestones/:milestoneId/sub-milestones',
  subMilestoneController.createSubMilestone
);

// Update sub-milestone
router.put(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId',
  subMilestoneController.updateSubMilestone
);

// Delete sub-milestone
router.delete(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId',
  subMilestoneController.deleteSubMilestone
);

// Update sub-milestone progress
router.patch(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId/progress',
  subMilestoneController.updateSubMilestoneProgress
);

// Complete sub-milestone
router.post(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId/complete',
  subMilestoneController.completeSubMilestone
);

// ========== PROJECT RISK MANAGEMENT ==========

// Add risk to project
router.post(
  '/:projectId/risks',
  projectController.addProjectRisk
);

// Update risk status
router.patch(
  '/:projectId/risks/:riskId/status',
  projectController.updateRiskStatus
);

// ========== PROJECT ISSUE MANAGEMENT ==========

// Add issue to project
router.post(
  '/:projectId/issues',
  projectController.addProjectIssue
);

// Resolve issue
router.patch(
  '/:projectId/issues/:issueId/resolve',
  projectController.resolveIssue
);

// ========== CHANGE REQUEST MANAGEMENT ==========

// Add change request
router.post(
  '/:projectId/change-requests',
  projectController.addChangeRequest
);

// Process change request
router.post(
  '/:projectId/change-requests/:changeRequestId/process',
  requireRoles('admin', 'supply_chain', 'project', 'manager', 'ceo'),
  projectController.processChangeRequest
);

// ========== MEETING MANAGEMENT ==========

// Log meeting
router.post(
  '/:projectId/meetings',
  projectController.logProjectMeeting
);

// ========== PROJECT CRUD OPERATIONS ==========

// Update project
router.put(
  '/:projectId',
  projectController.updateProject
);

// Update project status
router.patch(
  '/:projectId/status', 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'),
  projectController.updateProjectStatus
);

// Update project progress
router.patch(
  '/:projectId/progress',
  projectController.updateProjectProgress
);

// Delete project
router.delete(
  '/:projectId',
  projectController.deleteProject
);

// Get project by ID (MUST BE LAST - catches any remaining /:projectId patterns)
router.get(
  '/:projectId',
  projectController.getProjectById
);

console.log('✅ Project routes loaded');

module.exports = router;




