const User = require('../models/User');
const { 
  findPersonByEmail, 
  getAllAvailablePositions,
  getPotentialSupervisors,
  getApprovalChainFromStructure,
  ENHANCED_DEPARTMENT_STRUCTURE
} = require('../config/departmentStructure');

/**
 * Get all available positions for user creation
 */
const getAvailablePositions = async (req, res) => {
  try {
    const positions = getAllAvailablePositions();

    // Check which positions are already filled
    const existingUsers = await User.find({ 
      role: { $ne: 'supplier' } 
    }).select('email position department');

    const existingEmails = new Set(existingUsers.map(u => u.email));

    const availablePositions = positions.map(pos => ({
      ...pos,
      isFilled: pos.email ? existingEmails.has(pos.email) : false,
      canCreateMultiple: pos.allowMultiple
    }));

    res.json({
      success: true,
      data: availablePositions
    });

  } catch (error) {
    console.error('Get available positions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch positions',
      error: error.message
    });
  }
};

/**
 * Enhanced user creation with automatic hierarchy setup
 */
const createUserWithHierarchy = async (req, res) => {
  try {
    const {
      email,
      password,
      fullName,
      department,
      position,
      supervisorEmail // For dynamic supervisor positions (Field Technicians, etc.)
    } = req.body;

    console.log('=== CREATING USER WITH HIERARCHY ===');
    console.log('Email:', email);
    console.log('Position:', position);
    console.log('Department:', department);

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Validate position exists in structure
    const allPositions = getAllAvailablePositions();
    const positionData = allPositions.find(p => 
      p.position === position && p.department === department
    );

    if (!positionData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid position or department'
      });
    }

    // Check if position is already filled (unless multiple allowed)
    if (!positionData.allowMultiple && positionData.email) {
      const existingInPosition = await User.findOne({ 
        email: positionData.email,
        isActive: true 
      });

      if (existingInPosition) {
        return res.status(400).json({
          success: false,
          message: 'This position is already filled'
        });
      }
    }

    // Determine supervisor
    let supervisorId = null;
    let supervisorUser = null;

    if (positionData.dynamicSupervisor && supervisorEmail) {
      // For positions with dynamic supervisors (Field Technicians)
      supervisorUser = await User.findOne({ email: supervisorEmail });
      
      if (!supervisorUser) {
        return res.status(400).json({
          success: false,
          message: 'Selected supervisor not found'
        });
      }

      supervisorId = supervisorUser._id;

    } else if (positionData.reportsTo) {
      // Standard hierarchy from structure
      supervisorUser = await User.findOne({ email: positionData.reportsTo });
      
      if (supervisorUser) {
        supervisorId = supervisorUser._id;
      }
    }

    // Determine role and departmentRole
    let role = 'employee';
    let departmentRole = 'staff';

    if (positionData.isDepartmentHead) {
      role = email === 'kelvin.eyong@gratoglobal.com' ? 'admin' : 'supervisor';
      departmentRole = 'head';
    } else if (positionData.specialRole === 'buyer') {
      role = 'employee';
      departmentRole = 'buyer';
    } else if (positionData.specialRole === 'finance') {
      role = 'finance';
      departmentRole = 'staff';
    } else if (positionData.canSupervise && positionData.canSupervise.length > 0) {
      role = 'supervisor';
      departmentRole = positionData.approvalAuthority === 'coordinator' ? 'coordinator' : 'supervisor';
    }

    // Get department head
    const deptHeadEmail = positionData.isDepartmentHead 
      ? null 
      : ENHANCED_DEPARTMENT_STRUCTURE[department]?.head?.email;

    const departmentHead = deptHeadEmail 
      ? await User.findOne({ email: deptHeadEmail })
      : null;

    // Set permissions
    const permissions = getPermissionsForRole(role, departmentRole);

    // Create user
    const userData = {
      email,
      password,
      fullName,
      role,
      department,
      position,
      departmentRole,
      hierarchyLevel: positionData.hierarchyLevel,
      supervisor: supervisorId,
      departmentHead: departmentHead?._id,
      permissions,
      isActive: true
    };

    // Add buyer details if applicable
    if (positionData.buyerConfig) {
      userData.buyerDetails = {
        specializations: positionData.buyerConfig.specializations,
        maxOrderValue: positionData.buyerConfig.maxOrderValue,
        workload: {
          currentAssignments: 0,
          monthlyTarget: 50
        },
        performance: {
          completedOrders: 0,
          averageProcessingTime: 0,
          customerSatisfactionRating: 5
        },
        availability: {
          isAvailable: true
        }
      };
    }

    const newUser = new User(userData);
    await newUser.save();

    // Add to supervisor's directReports
    if (supervisorUser) {
      if (!supervisorUser.directReports.includes(newUser._id)) {
        supervisorUser.directReports.push(newUser._id);
        await supervisorUser.save();
      }
    }

    // Generate approval chain for reference
    const approvalChain = getApprovalChainFromStructure(email);

    console.log('✅ User created successfully');
    console.log(`Supervisor: ${supervisorUser?.fullName || 'None'}`);
    console.log(`Dept Head: ${departmentHead?.fullName || 'None'}`);
    console.log(`Approval Chain: ${approvalChain.length} levels`);

    res.status(201).json({
      success: true,
      message: 'User created successfully with hierarchy',
      data: {
        user: {
          _id: newUser._id,
          email: newUser.email,
          fullName: newUser.fullName,
          role: newUser.role,
          department: newUser.department,
          position: newUser.position,
          hierarchyLevel: newUser.hierarchyLevel
        },
        supervisor: supervisorUser ? {
          _id: supervisorUser._id,
          fullName: supervisorUser.fullName,
          email: supervisorUser.email
        } : null,
        approvalChain: approvalChain.map(step => ({
          level: step.level,
          approver: step.approver.name,
          role: step.approver.role
        }))
      }
    });

  } catch (error) {
    console.error('Create user with hierarchy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  }
};

/**
 * Get potential supervisors for a position
 */
const getPotentialSupervisorsForPosition = async (req, res) => {
  try {
    const { department, position } = req.query;

    if (!department || !position) {
      return res.status(400).json({
        success: false,
        message: 'Department and position are required'
      });
    }

    const potentialSupervisors = getPotentialSupervisors(department, position);

    if (potentialSupervisors.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No supervisors found for this position'
      });
    }

    // Get actual users
    const supervisorUsers = await User.find({
      email: { $in: potentialSupervisors.map(s => s.email) },
      isActive: true
    }).select('fullName email position department directReports');

    res.json({
      success: true,
      data: supervisorUsers.map(user => ({
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        position: user.position,
        currentReports: user.directReports.length
      }))
    });

  } catch (error) {
    console.error('Get potential supervisors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supervisors',
      error: error.message
    });
  }
};

/**
 * Get user's direct reports (for evaluations)
 */
const getDirectReports = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId)
      .populate({
        path: 'directReports',
        match: { isActive: true },
        select: 'fullName email department position hierarchyLevel'
      });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user.directReports || []
    });

  } catch (error) {
    console.error('Get direct reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch direct reports',
      error: error.message
    });
  }
};

/**
 * Get user's approval chain
 */
const getMyApprovalChain = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const approvalChain = getApprovalChainFromStructure(user.email);

    res.json({
      success: true,
      data: approvalChain
    });

  } catch (error) {
    console.error('Get approval chain error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approval chain',
      error: error.message
    });
  }
};

/**
 * Get approval chain for specific user (admin only)
 */
const getUserApprovalChain = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const approvalChain = getApprovalChainFromStructure(user.email);

    res.json({
      success: true,
      data: {
        user: {
          fullName: user.fullName,
          email: user.email,
          position: user.position,
          department: user.department
        },
        approvalChain
      }
    });

  } catch (error) {
    console.error('Get user approval chain error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approval chain',
      error: error.message
    });
  }
};

/**
 * Helper: Get permissions based on role
 */
const getPermissionsForRole = (role, departmentRole) => {
  if (role === 'admin') {
    return [
      'all_access',
      'user_management',
      'team_management',
      'financial_approval',
      'executive_decisions',
      'system_settings'
    ];
  }

  if (role === 'finance') {
    return [
      'financial_approval',
      'budget_management',
      'invoice_processing',
      'team_data_access',
      'financial_reports'
    ];
  }

  if (role === 'supervisor' || departmentRole === 'coordinator' || departmentRole === 'head') {
    return [
      'team_management',
      'approvals',
      'team_data_access',
      'behavioral_evaluations',
      'performance_reviews'
    ];
  }

  if (departmentRole === 'buyer') {
    return [
      'procurement',
      'vendor_management',
      'order_processing',
      'basic_access',
      'requisition_handling'
    ];
  }

  // Default employee permissions
  return [
    'basic_access',
    'submit_requests',
    'view_own_data'
  ];
};

module.exports = {
  getAvailablePositions,
  createUserWithHierarchy,
  getPotentialSupervisorsForPosition,
  getDirectReports,
  getMyApprovalChain,
  getUserApprovalChain
};