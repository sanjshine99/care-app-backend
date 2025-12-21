// backend/controllers/settingsController.js
// Settings management controller

const Settings = require("../models/Settings");
const settingsService = require("../services/settingsService");

// @desc    Get system settings
// @route   GET /api/settings
// @access  Private
exports.getSettings = async (req, res, next) => {
  try {
    const settings = await settingsService.getSettings();

    res.json({
      success: true,
      data: { settings },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update system settings
// @route   PUT /api/settings
// @access  Private
exports.updateSettings = async (req, res, next) => {
  try {
    const updates = req.body;

    // Validate scheduling settings
    if (updates.scheduling) {
      const {
        maxDistanceKm,
        travelTimeBufferMinutes,
        maxAppointmentsPerDay,
        defaultAppointmentDuration,
      } = updates.scheduling;

      if (
        maxDistanceKm !== undefined &&
        (maxDistanceKm < 1 || maxDistanceKm > 100)
      ) {
        return res.status(400).json({
          success: false,
          error: {
            message: "Maximum distance must be between 1 and 100 km",
            code: "INVALID_MAX_DISTANCE",
          },
        });
      }

      if (
        travelTimeBufferMinutes !== undefined &&
        (travelTimeBufferMinutes < 0 || travelTimeBufferMinutes > 60)
      ) {
        return res.status(400).json({
          success: false,
          error: {
            message: "Travel time buffer must be between 0 and 60 minutes",
            code: "INVALID_TRAVEL_BUFFER",
          },
        });
      }

      if (
        maxAppointmentsPerDay !== undefined &&
        (maxAppointmentsPerDay < 1 || maxAppointmentsPerDay > 20)
      ) {
        return res.status(400).json({
          success: false,
          error: {
            message: "Maximum appointments per day must be between 1 and 20",
            code: "INVALID_MAX_APPOINTMENTS",
          },
        });
      }

      if (
        defaultAppointmentDuration !== undefined &&
        (defaultAppointmentDuration < 15 || defaultAppointmentDuration > 240)
      ) {
        return res.status(400).json({
          success: false,
          error: {
            message:
              "Default appointment duration must be between 15 and 240 minutes",
            code: "INVALID_DURATION",
          },
        });
      }
    }

    const settings = await settingsService.updateSettings(
      updates,
      req.user._id
    );

    res.json({
      success: true,
      data: { settings },
      message: "Settings updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset settings to defaults
// @route   POST /api/settings/reset
// @access  Private
exports.resetSettings = async (req, res, next) => {
  try {
    // Delete existing settings
    await Settings.findByIdAndDelete("system_settings");

    // Create new default settings
    const settings = await Settings.create({ _id: "system_settings" });

    // Update cache
    settingsService.clearCache();

    res.json({
      success: true,
      data: { settings },
      message: "Settings reset to defaults",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
