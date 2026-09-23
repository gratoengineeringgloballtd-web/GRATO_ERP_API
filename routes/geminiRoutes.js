const express = require('express');
const router = express.Router();
const geminiController = require('../controllers/geminiController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/advice', authenticateToken, geminiController.getMaintenanceAdvice);
router.post('/enhance-report', authenticateToken, geminiController.enhanceReport);
router.post('/insights', authenticateToken, geminiController.getClusterInsights);
router.post('/chat', authenticateToken, geminiController.chat);

module.exports = router;
