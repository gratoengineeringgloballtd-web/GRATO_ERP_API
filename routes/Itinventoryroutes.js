/**
 * itInventoryRoutes.js
 *
 * Mount this in your main Express app:
 *   const itInventoryRoutes = require('./routes/itInventoryRoutes');
 *   app.use('/api/it-inventory', itInventoryRoutes);
 */

const express = require('express');
const router  = express.Router();

const {
  getInventory,
  getInventoryStats,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  addMaintenanceRecord,
  getLocations
} = require('../controllers/itInventoryController');

const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// ─── Static routes first (prevents /stats etc. being swallowed by /:id) ──────

// GET  /api/it-inventory/stats
router.get('/stats',
  authMiddleware,
  requireRoles('it', 'admin', 'ceo'),
  getInventoryStats
);

// GET  /api/it-inventory/locations
router.get('/locations',
  authMiddleware,
  requireRoles('it', 'admin', 'ceo'),
  getLocations
);

// ─── Collection routes ─────────────────────────────────────────────────────────

// GET  /api/it-inventory
router.get('/',
  authMiddleware,
  requireRoles('it', 'admin', 'ceo'),
  getInventory
);

// POST /api/it-inventory
router.post('/',
  authMiddleware,
  requireRoles('it', 'admin', 'ceo'),
  createInventoryItem
);

// ─── Item routes ───────────────────────────────────────────────────────────────

// GET    /api/it-inventory/:id
router.get('/:id',
  authMiddleware,
  requireRoles('it', 'admin', 'ceo'),
  getInventoryItem
);

// PUT    /api/it-inventory/:id
router.put('/:id',
  authMiddleware,
  requireRoles('it', 'admin', 'ceo'),
  updateInventoryItem
);

// DELETE /api/it-inventory/:id
router.delete('/:id',
  authMiddleware,
  requireRoles('it', 'admin', 'ceo'),
  deleteInventoryItem
);

// POST   /api/it-inventory/:id/maintenance
router.post('/:id/maintenance',
  authMiddleware,
  requireRoles('it', 'admin', 'ceo'),
  addMaintenanceRecord
);

module.exports = router;