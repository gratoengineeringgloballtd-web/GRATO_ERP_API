const express = require('express');
const router = express.Router();
const suggestionController = require('../controllers/suggestionController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

// IMPORTANT: More specific routes MUST come before parameterized routes

// Analytics and stats routes (before :suggestionId)
router.get('/analytics/dashboard', 
  authMiddleware,
  suggestionController.getDashboardStats
);

// Role-based listing route (before :suggestionId)
router.get('/role', 
  authMiddleware,
  suggestionController.getSuggestionsByRole
);

// Admin routes (before :suggestionId)
router.get('/admin', 
  authMiddleware, 
  requireRoles('admin'), 
  suggestionController.getAllSuggestions
);

// Create new suggestion
router.post('/', 
  authMiddleware, 
  upload.array('attachments', 5),
  suggestionController.createSuggestion
);

// Get specific suggestion details - THIS MUST COME AFTER SPECIFIC ROUTES
router.get('/:suggestionId', 
  authMiddleware,
  suggestionController.getSuggestionDetails
);

// Voting routes
router.post('/:suggestionId/vote', 
  authMiddleware,
  suggestionController.voteSuggestion
);

router.delete('/:suggestionId/vote', 
  authMiddleware,
  suggestionController.removeVote
);

// Comment routes
router.post('/:suggestionId/comments', 
  authMiddleware,
  suggestionController.addComment
);

router.get('/:suggestionId/comments', 
  authMiddleware,
  suggestionController.getComments
);

// HR routes
router.put('/hr/:suggestionId/review', 
  authMiddleware, 
  requireRoles('hr', 'admin'), 
  suggestionController.processHRReview
);

router.put('/hr/:suggestionId/status', 
  authMiddleware, 
  requireRoles('hr', 'admin'), 
  suggestionController.updateSuggestionStatus
);

// Management routes
router.put('/management/:suggestionId/implementation', 
  authMiddleware, 
  requireRoles('admin'), 
  suggestionController.updateImplementationStatus
);

module.exports = router;

