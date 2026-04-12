const jwt = require('jsonwebtoken');
const User = require('../models/User');

// HELPER FUNCTION: Debug supplier data
const debugSupplierAuth = (req, supplier) => {
  console.log('=== SUPPLIER AUTH DEBUG ===');
  console.log('Token user ID:', req.user?.userId);
  console.log('Supplier found:', {
    id: supplier._id.toString(),
    email: supplier.email,
    role: supplier.role,
    fullName: supplier.fullName,
    isActive: supplier.isActive,
    supplierStatus: supplier.supplierStatus,
    supplierDetails: supplier.supplierDetails ? {
      companyName: supplier.supplierDetails.companyName,
      supplierType: supplier.supplierDetails.supplierType
    } : null
  });
  console.log('=============================');
};

exports.supplierAuthMiddleware = async (req, res, next) => {
  try {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route - No token provided'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user exists and is a supplier
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists'
      });
    }

    // FIXED: More flexible supplier role checking
    const validSupplierRoles = ['supplier', 'vendor', 'external_supplier'];
    if (!validSupplierRoles.includes(currentUser.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access restricted to suppliers only',
        debug: {
          userRole: currentUser.role,
          userId: currentUser._id,
          validRoles: validSupplierRoles
        }
      });
    }

    // Debug supplier data
    debugSupplierAuth(req, currentUser);

    // FIXED: Set supplier context with comprehensive data
    req.supplier = {
      userId: currentUser._id,
      id: currentUser._id, 
      role: currentUser.role,
      email: currentUser.email,
      fullName: currentUser.fullName,
      companyName: currentUser.supplierDetails?.companyName || currentUser.fullName,
      supplierType: currentUser.supplierDetails?.supplierType,
      accountStatus: currentUser.supplierStatus?.accountStatus || 'pending',
      isVerified: currentUser.supplierStatus?.emailVerified || currentUser.isEmailVerified || false,
      isActive: currentUser.isActive !== false, 
      phone: currentUser.phone,
      address: currentUser.supplierDetails?.address,
      registrationDate: currentUser.createdAt,
      
      // Additional supplier details for completeness
      supplierDetails: currentUser.supplierDetails,
      supplierStatus: currentUser.supplierStatus,
      
      // Helper methods
      canSubmitQuotes: function() {
        return this.isActive && this.accountStatus === 'approved' && this.isVerified;
      },
      
      getDisplayName: function() {
        return this.companyName || this.fullName;
      }
    };

    // Also set as user for compatibility with existing middleware chains
    req.user = {
      userId: currentUser._id,
      id: currentUser._id,
      role: currentUser.role,
      email: currentUser.email,
      fullName: currentUser.fullName,
      department: 'supplier', 
      isActive: currentUser.isActive
    };

    console.log('Supplier authenticated successfully:', req.supplier.userId);
    next();

  } catch (error) {
    console.error('Supplier authentication error:', error.message);
    
    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please log in again.',
        code: 'TOKEN_EXPIRED'
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. Please log in again.',
        code: 'INVALID_TOKEN'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Authentication failed'
    });
  }
};

// Middleware to require active supplier status - ENHANCED
exports.requireActiveSupplier = (req, res, next) => {
  if (!req.supplier) {
    return res.status(401).json({
      success: false,
      message: 'Supplier authentication required'
    });
  }

  // Check if supplier is active
  if (!req.supplier.isActive) {
    return res.status(403).json({
      success: false,
      message: 'Your supplier account is not active. Please contact administrator.',
      code: 'ACCOUNT_INACTIVE',
      details: {
        accountStatus: req.supplier.accountStatus,
        isVerified: req.supplier.isVerified
      }
    });
  }

  // Check if supplier is approved
  const validStatuses = ['approved', 'active']; 
  if (!validStatuses.includes(req.supplier.accountStatus)) {
    return res.status(403).json({
      success: false,
      message: `Your supplier account is ${req.supplier.accountStatus}. Only approved suppliers can access this resource.`,
      code: 'ACCOUNT_NOT_APPROVED',
      details: {
        currentStatus: req.supplier.accountStatus,
        requiredStatus: 'approved'
      }
    });
  }

  // Check if email is verified 
  if (!req.supplier.isVerified) {
    console.warn(`Supplier ${req.supplier.userId} accessing resource with unverified email`);
    
  }

  console.log('Active supplier check passed for:', req.supplier.userId);
  next();
};

// Middleware to require specific supplier type
exports.requireSupplierType = (...types) => {
  return (req, res, next) => {
    if (!req.supplier) {
      return res.status(401).json({
        success: false,
        message: 'Supplier authentication required'
      });
    }

    if (!req.supplier.supplierType) {
      return res.status(403).json({
        success: false,
        message: 'Supplier type not set. Please complete your profile.',
        code: 'SUPPLIER_TYPE_MISSING'
      });
    }

    if (!types.includes(req.supplier.supplierType)) {
      return res.status(403).json({
        success: false,
        message: `Access restricted to ${types.join(', ')} suppliers only. Your type: ${req.supplier.supplierType}`,
        code: 'SUPPLIER_TYPE_RESTRICTED',
        details: {
          yourType: req.supplier.supplierType,
          allowedTypes: types
        }
      });
    }
    
    next();
  };
};

// Combined middleware for both regular users and suppliers
exports.combinedAuthMiddleware = async (req, res, next) => {
  try {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route - No token provided'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user exists
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists'
      });
    }

    // Set appropriate user context based on role
    const supplierRoles = ['supplier', 'vendor', 'external_supplier'];
    
    if (supplierRoles.includes(currentUser.role)) {
      // Set supplier context
      req.supplier = {
        userId: currentUser._id,
        id: currentUser._id,
        role: currentUser.role,
        email: currentUser.email,
        fullName: currentUser.fullName,
        companyName: currentUser.supplierDetails?.companyName || currentUser.fullName,
        supplierType: currentUser.supplierDetails?.supplierType,
        accountStatus: currentUser.supplierStatus?.accountStatus || 'pending',
        isVerified: currentUser.supplierStatus?.emailVerified || currentUser.isEmailVerified || false,
        isActive: currentUser.isActive !== false,
        phone: currentUser.phone,
        supplierDetails: currentUser.supplierDetails,
        supplierStatus: currentUser.supplierStatus
      };
      
      req.userType = 'supplier';
      
      // Also set user for compatibility
      req.user = {
        userId: currentUser._id,
        role: currentUser.role,
        email: currentUser.email,
        fullName: currentUser.fullName,
        department: 'supplier'
      };
      
    } else {
      // Set regular user context
      req.user = {
        userId: currentUser._id,
        id: currentUser._id,
        role: currentUser.role,
        department: currentUser.department,
        email: currentUser.email,
        fullName: currentUser.fullName,
        isActive: currentUser.isActive
      };
      
      req.userType = 'employee';
    }

    console.log(`Combined auth successful - User type: ${req.userType}, User ID: ${currentUser._id}`);
    next();

  } catch (error) {
    console.error('Combined authentication error:', error.message);
    
    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please log in again.',
        code: 'TOKEN_EXPIRED'
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. Please log in again.',
        code: 'INVALID_TOKEN'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Authentication failed'
    });
  }
};

// Enhanced supplier permission checker
exports.checkSupplierPermissions = (permissions = []) => {
  return (req, res, next) => {
    if (!req.supplier) {
      return res.status(401).json({
        success: false,
        message: 'Supplier authentication required'
      });
    }

    // Check specific permissions
    const hasPermission = permissions.every(permission => {
      switch (permission) {
        case 'submit_quotes':
          return req.supplier.canSubmitQuotes ? req.supplier.canSubmitQuotes() : 
                 (req.supplier.isActive && req.supplier.accountStatus === 'approved');
        
        case 'view_rfqs':
          return req.supplier.isActive;
        
        case 'submit_invoices':
          return req.supplier.isActive && req.supplier.accountStatus === 'approved';
        
        case 'update_profile':
          return req.supplier.isActive;
        
        default:
          return true; // Unknown permission defaults to allowed
      }
    });

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient supplier permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredPermissions: permissions
      });
    }

    next();
  };
};

// Debug middleware for supplier authentication issues
exports.debugSupplierAuth = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('=== SUPPLIER AUTH DEBUG MIDDLEWARE ===');
    console.log('Headers:', req.headers.authorization ? 'Token present' : 'No token');
    console.log('Supplier in request:', !!req.supplier);
    console.log('User in request:', !!req.user);
    
    if (req.supplier) {
      console.log('Supplier details:', {
        userId: req.supplier.userId,
        email: req.supplier.email,
        role: req.supplier.role,
        isActive: req.supplier.isActive,
        accountStatus: req.supplier.accountStatus
      });
    }
    
    if (req.user) {
      console.log('User details:', {
        userId: req.user.userId,
        email: req.user.email,
        role: req.user.role,
        userType: req.userType
      });
    }
    console.log('========================================');
  }
  
  next();
};




