const AIAssistantService = require('../services/AIAssistantService');
const logger = require('../utils/logger');

/**
 * Handle AI assistant chat for technicians
 * POST /api/ai-assistant/chat
 */
exports.chat = async (req, res) => {
  try {
    const { message, conversationHistory } = req.body;
    const userId = req.user.userId;

    if (!message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Message is required' 
      });
    }

    // Process the message
    const response = await AIAssistantService.chat(message, userId);

    res.json({ 
      success: true, 
      data: response 
    });
  } catch (error) {
    logger.error('AI Assistant chat error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to process chat message' 
    });
  }
};

/**
 * Get suggested prompts/quick actions for technicians
 * GET /api/ai-assistant/suggestions
 */
exports.getSuggestions = async (req, res) => {
  try {
    const suggestions = [
      { 
        id: 1, 
        text: "Show my pending tasks", 
        icon: "tasks",
        category: "tasks"
      },
      { 
        id: 2, 
        text: "What parts do I need?", 
        icon: "tools",
        category: "parts"
      },
      { 
        id: 3, 
        text: "Show my assigned sites", 
        icon: "map-marker-alt",
        category: "sites"
      },
      { 
        id: 4, 
        text: "Help with generator maintenance", 
        icon: "question-circle",
        category: "help"
      },
      { 
        id: 5, 
        text: "Show completed tasks this month", 
        icon: "check-circle",
        category: "tasks"
      },
      { 
        id: 6, 
        text: "Request a part", 
        icon: "plus-circle",
        category: "parts"
      }
    ];

    res.json({ 
      success: true, 
      data: suggestions 
    });
  } catch (error) {
    logger.error('Get suggestions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch suggestions' 
    });
  }
};

module.exports = exports;
