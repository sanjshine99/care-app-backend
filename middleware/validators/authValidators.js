const { body, validationResult } = require("express-validator");

// Shared error handler — returns 400 with validation errors array
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      },
    });
  }
  next();
};

// POST /api/auth/login
exports.loginRules = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Must be a valid email address")
    .normalizeEmail(),
  body("password")
    .trim()
    .notEmpty().withMessage("Password is required")
    .isLength({ min: 1 }).withMessage("Password cannot be empty"),
  handleValidationErrors,
];

// POST /api/auth/change-password
exports.changePasswordRules = [
  body("currentPassword")
    .trim()
    .notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .trim()
    .notEmpty().withMessage("New password is required")
    .isLength({ min: 8 }).withMessage("New password must be at least 8 characters")
    .matches(/[A-Z]/).withMessage("New password must contain at least one uppercase letter")
    .matches(/[0-9]/).withMessage("New password must contain at least one number")
    .matches(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/).withMessage("New password must contain at least one special character"),
  handleValidationErrors,
];
