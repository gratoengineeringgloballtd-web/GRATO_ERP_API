const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const { handleMulterError, cleanupTempFiles, validateFiles } = require('../middlewares/uploadMiddleware');
const actionItemController = require('../controllers/actionItemController');

// Import new approval controllers
const {
  submitCompletionForAssignee,
  approveL1WithGrade,
  approveL2Review,
  approveL3Final
} = require('../controllers/approvalController');

// Import reporting controllers
const {
  getTeamTasks,
  getDepartmentTasks,
  getMyPendingApprovals,
  exportTeamReport
} = require('../controllers/teamReportingController');

// ============================================
// REPORTING ROUTES (for supervisors & dept heads)
// ============================================

// Get all tasks for supervisor's direct reports
router.get(
  '/reports/team',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  getTeamTasks
);

// Get all tasks for department head's entire department
router.get(
  '/reports/department',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  getDepartmentTasks
);

// Get my pending approvals (at any level)
router.get(
  '/reports/my-approvals',
  authMiddleware,
  getMyPendingApprovals
);

// Export team report
router.get(
  '/reports/team/export',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  exportTeamReport
);

// ============================================
// THREE-LEVEL APPROVAL ROUTES (NEW)
// ============================================

// Submit completion - Initialize approval chain
router.post(
  '/:id/assignee/submit-completion',
  authMiddleware,
  upload.array('documents', 10),
  handleMulterError,
  validateFiles,
  submitCompletionForAssignee,
  cleanupTempFiles
);

// Level 1: Immediate supervisor grades
router.post(
  '/:id/assignee/:assigneeId/approve-l1',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  approveL1WithGrade
);

// Level 2: Supervisor's supervisor reviews
router.post(
  '/:id/assignee/:assigneeId/approve-l2',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  approveL2Review
);

// Level 3: Project creator gives final approval
router.post(
  '/:id/assignee/:assigneeId/approve-l3',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  approveL3Final
);

// ============================================
// EXISTING ROUTES (kept for backward compatibility)
// ============================================

// Statistics
router.get(
  '/stats',
  authMiddleware,
  actionItemController.getActionItemStats
);

// Project-specific routes
router.get(
  '/project/:projectId',
  authMiddleware,
  actionItemController.getProjectActionItems
);

// Supervisor approves/rejects TASK CREATION
router.post(
  '/:id/approve-creation',
  authMiddleware,
  actionItemController.processCreationApproval
);

// // Milestone-specific routes
// router.get(
//   '/milestone/:milestoneId',
//   authMiddleware,
//   actionItemController.getMilestoneTasks
// );

// router.post(
//   '/milestone/task',
//   authMiddleware,
//   requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
//   actionItemController.createTaskUnderMilestone
// );

// ============================================
// Milestone-specific routes
// ============================================
router.get(
  '/milestone/:milestoneId',
  authMiddleware,
  actionItemController.getMilestoneTasks
);

router.post(
  '/milestone/task',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  actionItemController.createTaskUnderMilestone
);

// NEW: Sub-milestone routes
router.post(
  '/sub-milestone-task',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  actionItemController.createTaskUnderSubMilestone
);

router.get(
  '/sub-milestone/:subMilestoneId',
  authMiddleware,
  actionItemController.getSubMilestoneTasks
);

// Personal task creation
router.post(
  '/personal',
  authMiddleware,
  actionItemController.createPersonalTask
);

// Reassign task
router.post(
  '/:id/reassign',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  actionItemController.reassignTask
);

// Progress and status updates
router.patch(
  '/:id/progress',
  authMiddleware,
  actionItemController.updateProgress
);

router.patch(
  '/:id/status',
  authMiddleware,
  actionItemController.updateStatus
);

// CRUD operations
router.get(
  '/',
  authMiddleware,
  actionItemController.getActionItems
);

router.get(
  '/:id',
  authMiddleware,
  actionItemController.getActionItem
);

router.post(
  '/',
  authMiddleware,
  actionItemController.createActionItem
);

router.put(
  '/:id',
  authMiddleware,
  actionItemController.updateActionItem
);

router.delete(
  '/:id',
  authMiddleware,
  actionItemController.deleteActionItem
);

// ============================================
// DEPRECATED ROUTES (to be removed in future)
// These are replaced by the new 3-level approval system
// ============================================

// OLD: Single-level approval (kept for backward compatibility)
router.post(
  '/:id/assignee/:assigneeId/approve-completion',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  (req, res) => {
    res.status(410).json({
      success: false,
      message: 'This endpoint is deprecated. Please use the new 3-level approval system: /approve-l1, /approve-l2, /approve-l3',
      migration: {
        oldEndpoint: '/approve-completion',
        newEndpoints: [
          'POST /:id/assignee/:assigneeId/approve-l1 (grade task)',
          'POST /:id/assignee/:assigneeId/approve-l2 (review)',
          'POST /:id/assignee/:assigneeId/approve-l3 (final approval)'
        ]
      }
    });
  }
);

router.post(
  '/:id/assignee/:assigneeId/reject-completion',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  (req, res) => {
    res.status(410).json({
      success: false,
      message: 'This endpoint is deprecated. Rejections are now handled at each approval level (L1, L2, L3) with decision="reject"'
    });
  }
);

// Download completion document
router.get(
  '/download/:taskId/:documentId',
  authMiddleware,
  async (req, res) => {
    try {
      const { taskId, documentId } = req.params;
      
      const task = await ActionItem.findById(taskId);
      if (!task) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }
      
      // Find the document across all assignees
      let document = null;
      for (const assignee of task.assignedTo) {
        document = assignee.completionDocuments?.find(
          doc => doc.publicId === documentId
        );
        if (document) break;
      }
      
      if (!document) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      
      const filePath = path.join(__dirname, '..', document.localPath || document.url);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'File not found on server' });
      }
      
      res.download(filePath, document.name);
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ success: false, message: 'Download failed' });
    }
  }
);

module.exports = router;