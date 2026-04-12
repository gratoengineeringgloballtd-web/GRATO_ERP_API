const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Site = require('../models/Site');
const Maintenance = require('../models/Maintenance');
const Part = require('../models/Part');
const Cluster = require('../models/Cluster');
const Generator = require('../models/Generator');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');

// All admin routes require admin role
router.use(authenticateToken);
router.use(requireRole(['admin']));

// ============================================================
// ADMIN DASHBOARD
// ============================================================
/**
 * Get admin dashboard statistics
 * GET /api/admin/dashboard
 */
router.get('/dashboard', async (req, res) => {
  console.log('\n========== ADMIN DASHBOARD ==========');
  
  try {
    const [
      usersStats,
      sitesStats,
      maintenanceStats,
      recentActivity
    ] = await Promise.all([
      // User statistics
      User.aggregate([
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Site statistics
      Site.aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            by_region: [
              {
                $group: {
                  _id: '$Region',
                  count: { $sum: 1 }
                }
              },
              { $sort: { count: -1 } }
            ]
          }
        }
      ]),
      
      // Maintenance statistics
      Maintenance.aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            by_status: [
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 }
                }
              }
            ],
            active: [
              {
                $match: {
                  status: { $in: ['approved', 'in_progress'] }
                }
              },
              { $count: 'count' }
            ],
            pending: [
              {
                $match: { status: 'pending_approval' }
              },
              { $count: 'count' }
            ]
          }
        }
      ]),
      
      // Recent activity (last 10 activities)
      Maintenance.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('technician', 'fullName')
        .select('maintenance_id site_id status createdAt')
        .lean()
    ]);

    const activeUsers = await User.countDocuments({ isActive: true });
    const totalUsers = await User.countDocuments();

    // Format response
    const dashboard = {
      users: {
        total: totalUsers,
        active: activeUsers,
        by_role: usersStats.map(u => ({
          role: u._id,
          count: u.count
        }))
      },
      sites: {
        total: sitesStats[0].total[0]?.count || 0,
        by_region: sitesStats[0].by_region.map(r => ({
          region: r._id || 'Unknown',
          count: r.count
        }))
      },
      maintenance: {
        total: maintenanceStats[0].total[0]?.count || 0,
        active: maintenanceStats[0].active[0]?.count || 0,
        pending: maintenanceStats[0].pending[0]?.count || 0,
        by_status: maintenanceStats[0].by_status.map(s => ({
          status: s._id,
          count: s.count
        }))
      },
      recent_activity: recentActivity.map(activity => ({
        type: 'maintenance',
        message: `${activity.technician?.fullName || 'Unknown'} submitted maintenance for ${activity.site_id}`,
        timestamp: activity.createdAt
      })),
      alerts: {
        count: 0 // Can be expanded with actual alerts logic
      }
    };

    console.log('✓ Dashboard data compiled');
    console.log('========== SUCCESS ==========\n');

    res.json({
      success: true,
      data: dashboard
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    logger.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load dashboard data'
    });
  }
});


/**
 * Get all users with pagination and filters
 * GET /api/admin/users
 */
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

/**
 * Create new user
 * POST /api/admin/users
 */
router.post('/users', async (req, res) => {
  console.log('\n========== CREATE USER ==========');
  
  try {
    const { fullName, email, phone, role, password, isActive = true } = req.body;

    // Validate required fields
    if (!fullName || !email || !role || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      fullName,
      email,
      phone,
      role,
      password: hashedPassword,
      isActive
    });

    await user.save();

    console.log('✓ User created:', user.email);
    logger.info('User created by admin', {
      created_user: user.email,
      role: user.role,
      admin: req.user.userId
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive
      }
    });

  } catch (error) {
    console.error('Create user error:', error);
    logger.error('Create user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

/**
 * Update user
 * PUT /api/admin/users/:userId
 */
router.put('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, phone, role, isActive } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update fields
    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (phone !== undefined) user.phone = phone;
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;

    await user.save();

    logger.info('User updated by admin', {
      user_id: userId,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive
      }
    });

  } catch (error) {
    logger.error('Update user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
});

/**
 * Delete user
 * DELETE /api/admin/users/:userId
 */
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    logger.warn('User deleted by admin', {
      deleted_user: user.email,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

/**
 * Toggle user active status
 * PATCH /api/admin/users/:userId/toggle-status
 */
router.patch('/users/:userId/toggle-status', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    logger.info('User status toggled', {
      user_id: userId,
      new_status: user.isActive,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'}`,
      data: {
        isActive: user.isActive
      }
    });

  } catch (error) {
    logger.error('Toggle user status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle user status'
    });
  }
});

/**
 * Reset user password
 * POST /api/admin/users/:userId/reset-password
 */
router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    await user.save();

    logger.warn('Password reset by admin', {
      user_id: userId,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
});


/**
 * Get all sites with pagination and filters
 * GET /api/admin/sites
 */
router.get('/sites', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, region } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (region) query.Region = region;
    if (search) {
      query.$or = [
        { IHS_ID_SITE: { $regex: search, $options: 'i' } },
        { Site_Name: { $regex: search, $options: 'i' } }
      ];
    }

    const [sites, total] = await Promise.all([
      Site.find(query)
        .sort({ IHS_ID_SITE: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Site.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: sites,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Get sites error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sites'
    });
  }
});

/**
 * Create new site
 * POST /api/admin/sites
 */
router.post('/sites', async (req, res) => {
  try {
    const {
      IHS_ID_SITE,
      Site_Name,
      Region,
      GRATO_Cluster,
      Latitude,
      Longitude,
      Technician_Name
    } = req.body;

    if (!IHS_ID_SITE || !Site_Name) {
      return res.status(400).json({
        success: false,
        error: 'Site ID and Name are required'
      });
    }

    // Check if site exists
    const existing = await Site.findOne({ IHS_ID_SITE });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Site with this ID already exists'
      });
    }

    const site = new Site({
      IHS_ID_SITE,
      Site_Name,
      Region,
      GRATO_Cluster,
      Latitude: Latitude ? parseFloat(Latitude) : undefined,
      Longitude: Longitude ? parseFloat(Longitude) : undefined,
      Technician_Name
    });

    await site.save();

    logger.info('Site created by admin', {
      site_id: IHS_ID_SITE,
      admin: req.user.userId
    });

    res.status(201).json({
      success: true,
      message: 'Site created successfully',
      data: site
    });

  } catch (error) {
    logger.error('Create site error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create site'
    });
  }
});

/**
 * Update site
 * PUT /api/admin/sites/:siteId
 */
router.put('/sites/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const updates = req.body;

    const site = await Site.findOne({ IHS_ID_SITE: siteId });
    if (!site) {
      return res.status(404).json({
        success: false,
        error: 'Site not found'
      });
    }

    // Update fields
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined && key !== 'IHS_ID_SITE') {
        site[key] = updates[key];
      }
    });

    await site.save();

    logger.info('Site updated by admin', {
      site_id: siteId,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'Site updated successfully',
      data: site
    });

  } catch (error) {
    logger.error('Update site error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update site'
    });
  }
});

/**
 * Delete site
 * DELETE /api/admin/sites/:siteId
 */
router.delete('/sites/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;

    const site = await Site.findOneAndDelete({ IHS_ID_SITE: siteId });
    if (!site) {
      return res.status(404).json({
        success: false,
        error: 'Site not found'
      });
    }

    logger.warn('Site deleted by admin', {
      site_id: siteId,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'Site deleted successfully'
    });

  } catch (error) {
    logger.error('Delete site error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete site'
    });
  }
});


/**
 * Get all maintenance records
 * GET /api/admin/maintenance
 */
router.get('/maintenance', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (status) query.status = status;

    const [maintenance, total] = await Promise.all([
      Maintenance.find(query)
        .populate('technician', 'fullName email')
        .populate('supervisor', 'fullName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Maintenance.countDocuments(query)
    ]);

    // Enrich with site details
    const enriched = await Promise.all(
      maintenance.map(async (m) => {
        const site = await Site.findOne({ IHS_ID_SITE: m.site_id })
          .select('Site_Name Region GRATO_Cluster')
          .lean();

        return {
          ...m,
          site_details: site
        };
      })
    );

    res.json({
      success: true,
      data: enriched,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Get maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch maintenance records'
    });
  }
});

/**
 * Update maintenance status
 * PATCH /api/admin/maintenance/:maintenanceId/status
 */
router.patch('/maintenance/:maintenanceId/status', async (req, res) => {
  try {
    const { maintenanceId } = req.params;
    const { status } = req.body;

    const validStatuses = ['draft', 'pending_approval', 'approved', 'rejected', 'in_progress', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    const maintenance = await Maintenance.findById(maintenanceId);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    maintenance.status = status;
    if (status === 'approved') {
      maintenance.reviewed_by = req.user.userId;
      maintenance.reviewed_at = new Date();
    } else if (status === 'completed') {
      maintenance.completed_at = new Date();
    }

    await maintenance.save();

    logger.info('Maintenance status updated by admin', {
      maintenance_id: maintenanceId,
      new_status: status,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: {
        maintenance_id: maintenance.maintenance_id,
        status: maintenance.status
      }
    });

  } catch (error) {
    logger.error('Update maintenance status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update status'
    });
  }
});

/**
 * Delete maintenance record
 * DELETE /api/admin/maintenance/:maintenanceId
 */
router.delete('/maintenance/:maintenanceId', async (req, res) => {
  try {
    const { maintenanceId } = req.params;

    const maintenance = await Maintenance.findByIdAndDelete(maintenanceId);
    if (!maintenance) {
      return res.status(404).json({
        success: false,
        error: 'Maintenance record not found'
      });
    }

    logger.warn('Maintenance deleted by admin', {
      maintenance_id: maintenance.maintenance_id,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'Maintenance record deleted successfully'
    });

  } catch (error) {
    logger.error('Delete maintenance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete maintenance'
    });
  }
});


/**
 * Get all parts
 * GET /api/admin/parts
 */
router.get('/parts', async (req, res) => {
  try {
    const { page = 1, limit = 20, category } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (category) query.category = category;

    const [parts, total] = await Promise.all([
      Part.find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Part.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: parts,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Get parts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch parts'
    });
  }
});

/**
 * Create new part
 * POST /api/admin/parts
 */
router.post('/parts', async (req, res) => {
  try {
    const {
      name,
      part_number,
      category,
      description,
      unit_price,
      stock,
      minimum_stock,
      supplier
    } = req.body;

    if (!name || !category) {
      return res.status(400).json({
        success: false,
        error: 'Name and category are required'
      });
    }

    const part = new Part({
      name,
      part_number,
      category,
      description,
      unit_price: unit_price ? parseFloat(unit_price) : undefined,
      stock: stock ? parseInt(stock) : 0,
      minimum_stock: minimum_stock ? parseInt(minimum_stock) : 0,
      supplier
    });

    await part.save();

    logger.info('Part created by admin', {
      part_id: part._id,
      admin: req.user.userId
    });

    res.status(201).json({
      success: true,
      message: 'Part created successfully',
      data: part
    });

  } catch (error) {
    logger.error('Create part error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create part'
    });
  }
});

/**
 * Update part
 * PUT /api/admin/parts/:partId
 */
router.put('/parts/:partId', async (req, res) => {
  try {
    const { partId } = req.params;
    const updates = req.body;

    const part = await Part.findById(partId);
    if (!part) {
      return res.status(404).json({
        success: false,
        error: 'Part not found'
      });
    }

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        part[key] = updates[key];
      }
    });

    await part.save();

    logger.info('Part updated by admin', {
      part_id: partId,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'Part updated successfully',
      data: part
    });

  } catch (error) {
    logger.error('Update part error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update part'
    });
  }
});

/**
 * Delete part
 * DELETE /api/admin/parts/:partId
 */
router.delete('/parts/:partId', async (req, res) => {
  try {
    const { partId } = req.params;

    const part = await Part.findByIdAndDelete(partId);
    if (!part) {
      return res.status(404).json({
        success: false,
        error: 'Part not found'
      });
    }

    logger.warn('Part deleted by admin', {
      part_id: partId,
      admin: req.user.userId
    });

    res.json({
      success: true,
      message: 'Part deleted successfully'
    });

  } catch (error) {
    logger.error('Delete part error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete part'
    });
  }
});

module.exports = router;