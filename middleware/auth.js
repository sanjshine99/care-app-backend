const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');

// Protect routes - require authentication
exports.protect = async (req, res, next) => {
  try {
    let token;

    // 1. Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // 2. Or check for token in cookie
    else if (req.cookies.token) {
      token = req.cookies.token;
    }

    // 3. No token found
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required. Please login.',
          code: 'AUTHENTICATION_REQUIRED',
        },
      });
    }

    try {
      // 4. Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 5. Find user by ID from token (exclude password)
      const user = await AdminUser.findById(decoded.userId).select('-password');

      // 6. Check if user exists and is active
      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            message: 'User no longer exists',
            code: 'USER_NOT_FOUND',
          },
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          error: {
            message: 'Your account has been deactivated',
            code: 'ACCOUNT_DEACTIVATED',
          },
        });
      }

      // 7. Check if account is locked
      if (user.isAccountLocked()) {
        return res.status(401).json({
          success: false,
          error: {
            message: 'Your account is temporarily locked due to multiple failed login attempts. Please try again later.',
            code: 'ACCOUNT_LOCKED',
          },
        });
      }

      // 8. Attach user to request
      req.user = user;
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: {
            message: 'Your session has expired. Please login again.',
            code: 'TOKEN_EXPIRED',
          },
        });
      }

      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: {
            message: 'Invalid authentication token',
            code: 'INVALID_TOKEN',
          },
        });
      }

      throw error;
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: 'Authentication error',
        code: 'AUTH_ERROR',
      },
    });
  }
};

// Authorization - check user role
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED',
        },
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'You do not have permission to perform this action',
          code: 'PERMISSION_DENIED',
        },
      });
    }

    next();
  };
};

// Optional authentication - attach user if token exists, but don't require it
exports.optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.token) {
      token = req.cookies.token;
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await AdminUser.findById(decoded.userId).select('-password');
        
        if (user && user.isActive && !user.isAccountLocked()) {
          req.user = user;
        }
      } catch (error) {
        // Token invalid, but we don't care - just continue without user
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};
