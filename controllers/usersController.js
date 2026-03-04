const crypto = require('crypto');
const AdminUser = require('../models/AdminUser');

const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateRandomPassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
  }
  return result;
}

exports.getAllUsers = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (search && search.trim()) {
      query.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const total = await AdminUser.countDocuments(query);
    const users = await AdminUser.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10))
      .skip((parseInt(page, 10) - 1) * parseInt(limit, 10))
      .lean();

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(total / parseInt(limit, 10)) || 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getUserById = async (req, res, next) => {
  try {
    const user = await AdminUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'User not found',
          code: 'USER_NOT_FOUND',
        },
      });
    }
    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

exports.createUser = async (req, res, next) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Please provide name and email',
          code: 'MISSING_FIELDS',
        },
      });
    }

    const existingUser = await AdminUser.findOne({ email: email.trim().toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'User with this email already exists',
          code: 'USER_EXISTS',
        },
      });
    }

    const temporaryPassword = generateRandomPassword(12);
    const user = await AdminUser.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: temporaryPassword,
      role: 'admin',
    });

    res.status(201).json({
      success: true,
      data: {
        user: user.toJSON(),
        temporaryPassword,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { name, email, isActive } = req.body;
    const user = await AdminUser.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'User not found',
          code: 'USER_NOT_FOUND',
        },
      });
    }

    if (name !== undefined) user.name = name.trim();
    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const existing = await AdminUser.findOne({ email: normalizedEmail });
        if (existing) {
          return res.status(400).json({
            success: false,
            error: {
              message: 'Another user with this email already exists',
              code: 'USER_EXISTS',
            },
          });
        }
        user.email = normalizedEmail;
      }
    }
    if (typeof isActive === 'boolean') user.isActive = isActive;

    await user.save();

    res.status(200).json({
      success: true,
      data: { user: user.toJSON() },
    });
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const user = await AdminUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'User not found',
          code: 'USER_NOT_FOUND',
        },
      });
    }

    const temporaryPassword = generateRandomPassword(12);
    user.password = temporaryPassword;
    await user.save();

    res.status(200).json({
      success: true,
      data: {
        user: user.toJSON(),
        temporaryPassword,
      },
    });
  } catch (error) {
    next(error);
  }
};
