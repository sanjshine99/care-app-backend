// backend/routes/availability.routes.js
// NEW FILE - Routes for managing availability versions

const express = require("express");
const { protect } = require("../middleware/auth");
const Availability = require("../models/Availability");
const CareGiver = require("../models/CareGiver");

const router = express.Router();

// All routes require authentication
router.use(protect);

// @desc    Get current availability for a care giver
// @route   GET /api/availability/caregiver/:careGiverId/current
// @access  Private
router.get("/caregiver/:careGiverId/current", async (req, res, next) => {
  try {
    const { careGiverId } = req.params;
    const { date } = req.query;

    const checkDate = date ? new Date(date) : new Date();

    const availability = await Availability.getCurrentForCareGiver(
      careGiverId,
      checkDate
    );

    if (!availability) {
      return res.status(404).json({
        success: false,
        error: {
          message: "No availability found for this care giver",
          code: "AVAILABILITY_NOT_FOUND",
        },
      });
    }

    res.json({
      success: true,
      data: { availability },
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get availability history for a care giver
// @route   GET /api/availability/caregiver/:careGiverId/history
// @access  Private
router.get("/caregiver/:careGiverId/history", async (req, res, next) => {
  try {
    const { careGiverId } = req.params;

    const history = await Availability.getHistory(careGiverId);

    res.json({
      success: true,
      data: {
        history,
        total: history.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create new availability version
// @route   POST /api/availability/caregiver/:careGiverId/version
// @access  Private
router.post("/caregiver/:careGiverId/version", async (req, res, next) => {
  try {
    const { careGiverId } = req.params;
    const { schedule, timeOff, effectiveFrom, notes } = req.body;

    // Verify care giver exists
    const careGiver = await CareGiver.findById(careGiverId);
    if (!careGiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care giver not found",
          code: "CARE_GIVER_NOT_FOUND",
        },
      });
    }

    // Create new version (automatically closes old ones)
    const availability = await Availability.createNewVersion(
      careGiverId,
      {
        schedule: schedule || [],
        timeOff: timeOff || [],
      },
      effectiveFrom ? new Date(effectiveFrom) : new Date()
    );

    // Update notes if provided
    if (notes) {
      availability.notes = notes;
      availability.createdBy = req.user._id;
      await availability.save();
    }

    // Also update embedded data for backward compatibility (temporary)
    await CareGiver.findByIdAndUpdate(careGiverId, {
      availability: schedule || [],
      timeOff: timeOff || [],
    });

    res.status(201).json({
      success: true,
      data: { availability },
      message: `Availability version ${availability.version} created successfully`,
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update current availability (creates new version)
// @route   PUT /api/availability/caregiver/:careGiverId
// @access  Private
router.put("/caregiver/:careGiverId", async (req, res, next) => {
  try {
    const { careGiverId } = req.params;
    const { schedule, timeOff, notes } = req.body;

    // This is just an alias for creating a new version effective immediately
    const availability = await Availability.createNewVersion(
      careGiverId,
      {
        schedule: schedule || [],
        timeOff: timeOff || [],
      },
      new Date()
    );

    if (notes) {
      availability.notes = notes;
      availability.createdBy = req.user._id;
      await availability.save();
    }

    // Also update embedded data for backward compatibility
    await CareGiver.findByIdAndUpdate(careGiverId, {
      availability: schedule || [],
      timeOff: timeOff || [],
    });

    res.json({
      success: true,
      data: { availability },
      message: "Availability updated successfully",
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get availability at specific date (historical)
// @route   GET /api/availability/caregiver/:careGiverId/at-date
// @access  Private
router.get("/caregiver/:careGiverId/at-date", async (req, res, next) => {
  try {
    const { careGiverId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Date parameter is required",
          code: "MISSING_DATE",
        },
      });
    }

    const availability = await Availability.getAtDate(
      careGiverId,
      new Date(date)
    );

    if (!availability) {
      return res.status(404).json({
        success: false,
        error: {
          message: "No availability found for this date",
          code: "AVAILABILITY_NOT_FOUND",
        },
      });
    }

    res.json({
      success: true,
      data: { availability },
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Check if care giver is available at specific time
// @route   GET /api/availability/caregiver/:careGiverId/check
// @access  Private
router.get("/caregiver/:careGiverId/check", async (req, res, next) => {
  try {
    const { careGiverId } = req.params;
    const { date, dayOfWeek, time } = req.query;

    const checkDate = date ? new Date(date) : new Date();

    const availability = await Availability.getCurrentForCareGiver(
      careGiverId,
      checkDate
    );

    if (!availability) {
      return res.json({
        success: true,
        data: {
          available: false,
          reason: "No availability schedule found",
        },
      });
    }

    // Check time off
    if (availability.isOnTimeOff(checkDate)) {
      return res.json({
        success: true,
        data: {
          available: false,
          reason: "Care giver is on time off",
        },
      });
    }

    // Check working hours
    const day =
      dayOfWeek || checkDate.toLocaleDateString("en-GB", { weekday: "long" });
    const isAvailable = availability.isAvailableAt(day, time);

    res.json({
      success: true,
      data: {
        available: isAvailable,
        reason: isAvailable ? "Available" : "Outside working hours",
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
