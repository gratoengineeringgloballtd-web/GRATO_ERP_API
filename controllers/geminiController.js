const GeminiService = require('../services/GeminiService');

exports.getMaintenanceAdvice = async (req, res) => {
  try {
    const { taskDetails } = req.body;
    if (!taskDetails) {
      return res.status(400).json({ success: false, message: 'taskDetails is required' });
    }
    const advice = await GeminiService.generateMaintenanceAdvice(taskDetails);
    res.json({ success: true, data: advice });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.enhanceReport = async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes) {
      return res.status(400).json({ success: false, message: 'notes is required' });
    }
    const report = await GeminiService.enhanceReport(notes);
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getClusterInsights = async (req, res) => {
  try {
    const { stats } = req.body;
    if (!stats) {
      return res.status(400).json({ success: false, message: 'stats is required' });
    }
    const insights = await GeminiService.analyzeClusterPerformance(stats);
    res.json({ success: true, data: insights });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.chat = async (req, res) => {
  try {
    const { message } = req.body;
    const role = req.user ? req.user.role : 'user';

    if (!message) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }
    const reply = await GeminiService.chat(message, role);
    res.json({ success: true, data: reply });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
