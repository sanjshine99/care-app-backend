const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');
const Notification = require('../models/Notification');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '24h',
  });
};

// Set token in cookie
const sendTokenResponse = (user, statusCode, res) => {
  const token = generateToken(user._id);

  const options = {
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  };

  res.status(statusCode).cookie('token', token, options).json({
    success: true,
    data: {
      user: user.toJSON(),
      token,
    },
  });
};

// @desc    Register new admin user
// @route   POST /api/auth/register
// @access  Public (but should be restricted in production)
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Please provide name, email, and password',
          code: 'MISSING_FIELDS',
        },
      });
    }

    // Check if user already exists
    const existingUser = await AdminUser.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'User with this email already exists',
          code: 'USER_EXISTS',
        },
      });
    }

    // Create user
    const user = await AdminUser.create({
      name,
      email,
      password,
      role: role || 'admin',
    });

    // Create welcome notification
    await Notification.create({
      adminUser: user._id,
      type: 'success',
      priority: 'medium',
      title: 'Welcome to Care Scheduling System',
      message: `Welcome ${user.name}! Your account has been created successfully.`,
      metadata: {
        action: 'user_registered',
        resourceType: 'AdminUser',
        resourceId: user._id,
      },
    });

    sendTokenResponse(user, 201, res);
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Please provide email and password',
          code: 'MISSING_CREDENTIALS',
        },
      });
    }

    // Find user (include password for comparison)
    const user = await AdminUser.findOne({ email }).select('+password');

    if (!user) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
        },
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Your account has been deactivated. Please contact support.',
          code: 'ACCOUNT_DEACTIVATED',
        },
      });
    }

    // Check if account is locked
    if (user.isAccountLocked()) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Your account is temporarily locked due to multiple failed login attempts. Please try again later.',
          code: 'ACCOUNT_LOCKED',
        },
      });
    }

    // Check password
    const isPasswordCorrect = await user.comparePassword(password);

    if (!isPasswordCorrect) {
      // Increment failed login attempts
      await user.incrementLoginAttempts();

      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
        },
      });
    }

    // Reset login attempts and update last login
    await user.resetLoginAttempts();

    // Create login notification
    await Notification.create({
      adminUser: user._id,
      type: 'info',
      priority: 'low',
      title: 'New Login',
      message: `You logged in successfully at ${new Date().toLocaleString('en-GB')}`,
      metadata: {
        action: 'user_login',
        resourceType: 'AdminUser',
        resourceId: user._id,
      },
    });

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// @desc    Logout user / clear cookie
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res, next) => {
  try {
    res.cookie('token', 'none', {
      expires: new Date(Date.now() + 1000),
      httpOnly: true,
    });

    res.status(200).json({
      success: true,
      data: {
        message: 'Logged out successfully',
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await AdminUser.findById(req.user._id);

    res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Change password
// @route   POST /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Please provide current password and new password',
          code: 'MISSING_FIELDS',
        },
      });
    }

    // Get user with password
    const user = await AdminUser.findById(req.user._id).select('+password');

    // Verify current password
    const isPasswordCorrect = await user.comparePassword(currentPassword);

    if (!isPasswordCorrect) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Current password is incorrect',
          code: 'INCORRECT_PASSWORD',
        },
      });
    }

    // Validate new password
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'New password must be at least 8 characters long',
          code: 'INVALID_PASSWORD',
        },
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Create notification
    await Notification.create({
      adminUser: user._id,
      type: 'success',
      priority: 'high',
      title: 'Password Changed',
      message: 'Your password has been changed successfully',
      metadata: {
        action: 'password_changed',
        resourceType: 'AdminUser',
        resourceId: user._id,
      },
    });

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};
