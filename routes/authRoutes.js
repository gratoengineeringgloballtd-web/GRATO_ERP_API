const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { sendEmail } = require('../services/emailService');
const authController = require('../controllers/authController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const User = require('../models/User');
const QuarterlyKPI = require('../models/QuarterlyKPI');


router.post('/login', authController.login);
router.post('/logout', authMiddleware, authController.logout);

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .populate('supervisor', 'fullName email position')
            .populate('departmentHead', 'fullName email position')
            .select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        let kpiStatus = null;
        if (user.role !== 'supplier') {
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const quarter = `Q${Math.ceil(month / 3)}-${year}`;
            const kpi = await QuarterlyKPI.findOne({ employee: user._id, quarter, year }).select('approvalStatus submittedAt');
            kpiStatus = {
                quarter,
                year,
                hasKpi: !!kpi,
                isSubmitted: kpi ? kpi.approvalStatus !== 'draft' : false,
                approvalStatus: kpi?.approvalStatus || null,
                submittedAt: kpi?.submittedAt || null
            };
        }

        res.json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                department: user.department,
                position: user.position,
                hierarchyLevel: user.hierarchyLevel,
                approvalCapacities: user.approvalCapacities,
                kpiStatus,
                signature: user.signature?.url ? {
                    url: user.signature.url,
                    uploadedAt: user.signature.uploadedAt
                } : null,
                supervisor: user.supervisor,
                departmentHead: user.departmentHead,
                permissions: user.permissions
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user',
            error: error.message
        });
    }
});


// Create user with hierarchy (Admin only)
router.post('/users/create-with-hierarchy', 
    authMiddleware, 
    requireRoles('admin'), 
    authController.createUserWithHierarchy
);

// Get available positions
router.get('/positions/available', 
    authMiddleware, 
    requireRoles('admin'), 
    authController.getAvailablePositions
);

// Get potential supervisors for position
router.get('/positions/supervisors', 
    authMiddleware, 
    requireRoles('admin'), 
    authController.getPotentialSupervisorsForPosition
);



// Update user supervisor (Admin only)
router.put('/users/:userId/supervisor', 
    authMiddleware, 
    requireRoles('admin'), 
    authController.updateUserSupervisor
);

// Get user's direct reports
router.get('/users/direct-reports', 
    authMiddleware, 
    authController.getDirectReports
);

// Get my approval chain
router.get('/workflow/my-chain', 
    authMiddleware, 
    authController.getMyApprovalChain
);

// Preview workflow
router.get('/workflow/preview', 
    authMiddleware, 
    authController.previewWorkflow
);

// Validate user hierarchy (Admin only)
router.get('/users/:userId/validate-hierarchy', 
    authMiddleware, 
    requireRoles('admin'), 
    authController.validateUserHierarchy
);

// ==========================================
// USER QUERIES
// ==========================================

// Get all active users
router.get('/active-users', 
    authMiddleware, 
    authController.getActiveUsers
);

// Get all supervisors (for dropdowns)
router.get('/supervisors', authMiddleware, async (req, res) => {
    try {
        const supervisors = await User.find({
            isActive: true,
            $or: [
                { approvalCapacities: { $exists: true, $ne: [] } },
                { directReports: { $exists: true, $ne: [] } }
            ]
        })
        .select('_id fullName email department position directReports')
        .lean();

        res.json({
            success: true,
            data: supervisors
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch supervisors',
            error: error.message
        });
    }
});

// Get user by email
router.get('/user-by-email', authMiddleware, async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        const user = await User.findOne({
            email: email.toLowerCase(),
            isActive: true
        }).select('_id fullName email department position role hierarchyLevel');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found or not active'
            });
        }

        res.json({
            success: true,
            data: user
        });

    } catch (error) {
        console.error('Find user by email error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to find user',
            error: error.message
        });
    }
});

// Get departments list
router.get('/departments', authMiddleware, async (req, res) => {
    try {
        const departments = await User.distinct('department');
        res.json({
            success: true,
            data: departments.filter(dept => dept)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch departments',
            error: error.message
        });
    }
});

// ==========================================
// ADMIN USER MANAGEMENT
// ==========================================

// Get all users (Admin only)
router.get('/users', authMiddleware, async (req, res) => {
    try {
        const { role, department, page = 1, limit = 50, search } = req.query;

        let query = {};

        if (role) query.role = role;
        if (department) query.department = department;

        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { position: { $regex: search, $options: 'i' } }
            ];
        }

        const users = await User.find(query)
            .populate('supervisor', 'fullName email')
            .populate('departmentHead', 'fullName email')
            .select('-password')
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(query);

        res.json({
            success: true,
            data: {
                users,
                totalPages: Math.ceil(total / limit),
                currentPage: parseInt(page),
                totalUsers: total
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users',
            error: error.message
        });
    }
});

// Get specific user (Admin only)
router.get('/users/:userId', authMiddleware, requireRoles('admin'), async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findById(userId)
            .populate('supervisor', 'fullName email position')
            .populate('departmentHead', 'fullName email position')
            .populate('directReports', 'fullName email position')
            .select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: { user }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user',
            error: error.message
        });
    }
});

// Update user (Admin only)
router.put('/users/:userId', authMiddleware, requireRoles('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        const updateData = req.body;

        // Remove sensitive fields
        delete updateData.password;
        delete updateData._id;
        delete updateData.__v;
        delete updateData.hierarchyPath; // Recalculated automatically

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true, runValidators: true }
        )
        .select('-password')
        .populate('supervisor', 'fullName email')
        .populate('departmentHead', 'fullName email');

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'User updated successfully',
            data: updatedUser
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update user',
            error: error.message
        });
    }
});

// Toggle user status (Admin only)
router.put('/users/:userId/status', authMiddleware, requireRoles('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        const { isActive } = req.body;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { isActive },
            { new: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
            data: updatedUser
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update user status',
            error: error.message
        });
    }
});

// Delete user (Admin only)
router.delete('/users/:userId', authMiddleware, requireRoles('admin'), async (req, res) => {
    try {
        const { userId } = req.params;

        // Prevent deletion of last admin
        const user = await User.findById(userId);
        if (user && user.role === 'admin') {
            const adminCount = await User.countDocuments({ role: 'admin', isActive: true });
            if (adminCount <= 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete the last admin user'
                });
            }
        }

        // Remove from supervisor's directReports
        if (user.supervisor) {
            await User.findByIdAndUpdate(user.supervisor, {
                $pull: { directReports: userId }
            });
        }

        const deletedUser = await User.findByIdAndDelete(userId);

        if (!deletedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'User deleted successfully',
            data: { deletedUserId: userId }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete user',
            error: error.message
        });
    }
});

// ==========================================
// ORGANIZATIONAL CHARTS & REPORTING
// ==========================================

// Get organization chart
router.get('/org-chart', authMiddleware, async (req, res) => {
    try {
        const { departmentFilter } = req.query;

        let query = { isActive: true };
        if (departmentFilter) query.department = departmentFilter;

        const users = await User.find(query)
            .populate('supervisor', 'fullName email position')
            .populate('directReports', 'fullName email position department')
            .select('fullName email position department hierarchyLevel approvalCapacities supervisor directReports')
            .sort({ hierarchyLevel: -1 });

        // Build tree structure
        const buildTree = (users, parentId = null) => {
            return users
                .filter(u => {
                    const supervisorId = u.supervisor?._id?.toString();
                    return parentId ? supervisorId === parentId : !supervisorId;
                })
                .map(user => ({
                    id: user._id,
                    name: user.fullName,
                    email: user.email,
                    position: user.position,
                    department: user.department,
                    hierarchyLevel: user.hierarchyLevel,
                    approvalCapacities: user.approvalCapacities,
                    children: buildTree(users, user._id.toString())
                }));
        };

        const orgChart = buildTree(users);

        res.json({
            success: true,
            data: orgChart
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch org chart',
            error: error.message
        });
    }
});


// ==========================================
// SUPPLIER PASSWORD RESET
// ==========================================

// Request password reset
router.post('/supplier/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    const supplier = await User.findOne({ 
      email: email.toLowerCase(),
      role: 'supplier'
    });
    
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'No supplier account found with this email'
      });
    }
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour
    
    supplier.supplierStatus.verificationToken = resetToken;
    supplier.supplierStatus.verificationTokenExpiry = resetTokenExpiry;
    await supplier.save();
    
    const resetUrl = `${process.env.CLIENT_URL}/supplier/reset-password/${resetToken}`;
    
    await sendEmail({
      to: email,
      subject: 'Password Reset Request - Grato Hub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>Dear ${supplier.supplierDetails.contactName},</p>
          <p>We received a request to reset your password for your Grato Hub supplier account.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #1890ff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
          
          <p>Best regards,<br>Grato IT Team</p>
        </div>
      `
    });
    
    res.json({
      success: true,
      message: 'Password reset link sent to your email'
    });
    
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
});

// Reset password with token
router.post('/supplier/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }
    
    const supplier = await User.findOne({
      role: 'supplier',
      'supplierStatus.verificationToken': token,
      'supplierStatus.verificationTokenExpiry': { $gt: Date.now() }
    });
    
    if (!supplier) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }
    
    // Update password
    supplier.password = newPassword;
    supplier.supplierStatus.verificationToken = undefined;
    supplier.supplierStatus.verificationTokenExpiry = undefined;
    await supplier.save();
    
    res.json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
    
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
});

// Change password (authenticated supplier)
router.post('/supplier/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    const supplier = await User.findById(req.user.userId);
    
    if (!supplier || supplier.role !== 'supplier') {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    // Verify current password
    const isValidPassword = await supplier.comparePassword(currentPassword);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }
    
    supplier.password = newPassword;
    await supplier.save();
    
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
    
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

module.exports = router;




