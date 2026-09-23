const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const aiAssistantController = require('../controllers/aiAssistantController');

// AI Assistant chat endpoint
router.post('/chat', 
  authenticateToken, 
  requireRole(['technician', 'supervisor', 'admin']), 
  aiAssistantController.chat
);

// Get suggested prompts
router.get('/suggestions', 
  authenticateToken, 
  requireRole(['technician', 'supervisor', 'admin']), 
  aiAssistantController.getSuggestions
);

module.exports = router;
