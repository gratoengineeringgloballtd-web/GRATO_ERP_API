const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.authMiddleware = async (req, res, next) => {
  try {
    let token;
    
    // 1. Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route - No token provided'
      });
    }

    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded token:', decoded);
    
    // 3. Check if user exists
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists'
      });
    }

    // 4. Add user to request - FIXED: Always set req.user for valid users
    req.user = {
      userId: currentUser._id.toString(), // Ensure it's a string
      id: currentUser._id.toString(), // Add compatibility property
      _id: currentUser._id,
      role: currentUser.role,
      department: currentUser.department,
      email: currentUser.email,
      fullName: currentUser.fullName
    };

    // 5. Check role-specific restrictions
    if (currentUser.role === 'supplier') {
      // For suppliers, exclude from regular employee functions
      // But still set req.user for supplier-specific endpoints
      if (!req.path.includes('/supplier/')) {
        return res.status(403).json({
          success: false,
          message: 'Suppliers should use supplier-specific endpoints'
        });
      }
    }
    
    console.log('Authenticated user:', req.user);
    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    
    // Handle specific JWT errors
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
      error: error.message
    });
  }
};

exports.requireRoles = (...roles) => {
  return (req, res, next) => {
    console.log('Checking roles:', { 
      requiredRoles: roles, 
      userRole: req.user?.role,
      userId: req.user?.userId,
      roleIncludes: roles.includes(req.user?.role),
      rolesArray: Array.isArray(roles),
      roleType: typeof req.user?.role,
      roleLength: req.user?.role?.length
    });
    
    // Check if req.user exists
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route. Required roles: ${roles.join(', ')}`
      });
    }
    next();
  };
};



