const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const subMilestoneController = require('../controllers/subMilestoneController');

// ========== SUB-MILESTONE MANAGEMENT ==========

// Get milestone hierarchy (with all sub-milestones)
router.get(
  '/:projectId/milestones/:milestoneId/hierarchy',
  authMiddleware,
  subMilestoneController.getMilestoneHierarchy
);

// Create sub-milestone under milestone or another sub-milestone
router.post(
  '/:projectId/milestones/:milestoneId/sub-milestones',
  authMiddleware,
  subMilestoneController.createSubMilestone
);

// Update sub-milestone
router.put(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId',
  authMiddleware,
  subMilestoneController.updateSubMilestone
);

// Delete sub-milestone
router.delete(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId',
  authMiddleware,
  subMilestoneController.deleteSubMilestone
);

// Update sub-milestone progress (recalculate from tasks)
router.patch(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId/progress',
  authMiddleware,
  subMilestoneController.updateSubMilestoneProgress
);

// Complete sub-milestone
router.post(
  '/:projectId/milestones/:milestoneId/sub-milestones/:subMilestoneId/complete',
  authMiddleware,
  subMilestoneController.completeSubMilestone
);

module.exports = router;