const { body, query, validationResult } = require("express-validator");

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

// POST /api/schedule/generate
exports.generateScheduleRules = [
  body("startDate")
    .notEmpty().withMessage("startDate is required")
    .isISO8601().withMessage("startDate must be a valid ISO 8601 date (YYYY-MM-DD)"),
  body("endDate")
    .notEmpty().withMessage("endDate is required")
    .isISO8601().withMessage("endDate must be a valid ISO 8601 date (YYYY-MM-DD)")
    .custom((endDate, { req }) => {
      if (new Date(endDate) <= new Date(req.body.startDate)) {
        throw new Error("endDate must be after startDate");
      }
      return true;
    }),
  body("careReceiverIds")
    .optional()
    .isArray().withMessage("careReceiverIds must be an array")
    .custom((ids) => {
      if (ids && ids.length > 100) throw new Error("Cannot schedule more than 100 care receivers at once");
      return true;
    }),
  handleValidationErrors,
];

// GET /api/schedule/unscheduled
exports.getUnscheduledRules = [
  query("startDate")
    .notEmpty().withMessage("startDate is required")
    .isISO8601().withMessage("startDate must be a valid ISO 8601 date"),
  query("endDate")
    .notEmpty().withMessage("endDate is required")
    .isISO8601().withMessage("endDate must be a valid ISO 8601 date"),
  handleValidationErrors,
];

// POST /api/schedule/validate
exports.validateScheduleRules = [
  body("startDate")
    .notEmpty().withMessage("startDate is required")
    .isISO8601().withMessage("startDate must be a valid ISO 8601 date"),
  body("endDate")
    .notEmpty().withMessage("endDate is required")
    .isISO8601().withMessage("endDate must be a valid ISO 8601 date"),
  handleValidationErrors,
];
