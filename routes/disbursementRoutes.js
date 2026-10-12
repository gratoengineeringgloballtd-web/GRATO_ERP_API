const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const CashRequest = require('../models/CashRequest');

/**
 * @route   GET /api/disbursements/dashboard-stats
 * @desc    Counts for the main dashboard's Disbursements badge.
 *          pending = approved cash requests still waiting for (more) money
 *          to be disbursed; total = every request that has reached the
 *          disbursement stage.
 * @access  Private (Finance, Admin, CEO)
 */
router.get(
  '/dashboard-stats',
  authMiddleware,
  requireRoles('finance', 'admin', 'ceo'),
  async (req, res) => {
    try {
      const [pending, total] = await Promise.all([
        CashRequest.countDocuments({ status: { $in: ['approved', 'partially_disbursed'] } }),
        CashRequest.countDocuments({
          status: { $in: ['approved', 'partially_disbursed', 'fully_disbursed', 'disbursed', 'completed'] }
        })
      ]);

      res.json({ success: true, data: { pending, total } });
    } catch (error) {
      console.error('Disbursement dashboard stats error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch disbursement stats' });
    }
  }
);

module.exports = router;
