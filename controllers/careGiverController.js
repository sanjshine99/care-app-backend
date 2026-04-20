// backend/controllers/careGiverController.js
// FIXED - Includes schedule endpoint with secondary care giver support

const CareGiver = require("../models/CareGiver");
const Availability = require("../models/Availability");
const Appointment = require("../models/Appointment");
const logger = require("../utils/logger");
const { normalizeUkPostcode } = require("../utils/ukPostcode");
const { parseStartOfDayUTC, parseEndOfDayUTC, toStartOfDayUTC, toEndOfDayUTC, getDefaultDateRange } = require("../utils/dateUtils");
const {
  revalidateExistingAppointments,
  autoAssignFromUnscheduled,
} = require("../services/caregiverRevalidationService");

// Try to import geocode service, but don't fail if it doesn't exist
let geocodeAddress;
try {
  geocodeAddress = require("../services/mapboxService").geocodeAddress;
} catch (e) {
  geocodeAddress = null;
}

// Escape special regex characters to prevent ReDoS attacks
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// @desc    Get all care givers with filters
// @route   GET /api/caregivers
// @access  Private
const getAllCareGivers = async (req, res, next) => {
  try {
    const {
      search,
      skill,
      isActive,
      canDrive,
      page = 1,
      limit = 100, // INCREASED: Show more care givers in calendar
    } = req.query;
    const query = {};

    if (search) {
      const safeSearch = escapeRegex(String(search).slice(0, 100));
      query.$or = [
        { name: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } },
      ];
    }
    if (skill) query.skills = skill;
    if (isActive !== undefined) query.isActive = isActive === "true";
    if (canDrive !== undefined) query.canDrive = canDrive === "true";

    const total = await CareGiver.countDocuments(query);
    const careGivers = await CareGiver.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    res.json({
      success: true,
      data: {
        careGivers,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single care giver by ID
// @route   GET /api/caregivers/:id
// @access  Private
const getCareGiverById = async (req, res, next) => {
  try {
    const careGiver = await CareGiver.findById(req.params.id);
    if (!careGiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care giver not found",
          code: "CARE_GIVER_NOT_FOUND",
        },
      });
    }
    res.json({ success: true, data: { careGiver } });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new care giver
// @route   POST /api/caregivers
// @access  Private
const createCareGiver = async (req, res, next) => {
  try {
    const { address } = req.body;

    // Normalize time off dates to UTC boundaries
    if (req.body.timeOff && Array.isArray(req.body.timeOff)) {
      req.body.timeOff = req.body.timeOff.map((timeOff) => ({
        startDate: toStartOfDayUTC(timeOff.startDate),
        endDate: toEndOfDayUTC(timeOff.endDate),
        reason: timeOff.reason || "",
      }));
    }

    if (req.body.address?.postcode != null) {
      req.body.address.postcode = normalizeUkPostcode(req.body.address.postcode);
    }

    // GEOCODE WITH FALLBACK
    if (address && address.street && address.city && address.postcode) {
      const fullAddress = `${address.street}, ${address.city} ${address.postcode}, United Kingdom`;
      req.body.address.full = fullAddress;

      if (geocodeAddress && process.env.MAPBOX_API_KEY) {
        try {
          const coordinates = await geocodeAddress(fullAddress);
          req.body.coordinates = {
            type: "Point",
            coordinates: [coordinates.longitude, coordinates.latitude],
          };
          logger.debug("Geocoded address", { address: fullAddress });
        } catch (geoError) {
          logger.warn("Geocoding failed, using default coordinates", { error: geoError.message });
          req.body.coordinates = { type: "Point", coordinates: [-0.1276, 51.5074] };
        }
      } else {
        req.body.coordinates = { type: "Point", coordinates: [-0.1276, 51.5074] };
      }
    } else {
      req.body.coordinates = { type: "Point", coordinates: [-0.1276, 51.5074] };
    }

    const careGiver = await CareGiver.create(req.body);
    logger.info("Care giver created", { id: careGiver._id });

    // AUTO-SYNC AVAILABILITY
    if (careGiver.availability && careGiver.availability.length > 0) {
      try {
        await Availability.create({
          careGiver: careGiver._id,
          schedule: careGiver.availability,
          timeOff: careGiver.timeOff || [],
          effectiveFrom: new Date(),
          isActive: true,
          notes: "Auto-created with care giver",
          version: 1,
        });
      } catch (availError) {
        logger.warn("Availability sync failed on create", { error: availError.message });
      }
    }

    const { start: rangeStart, end: rangeEnd } = getDefaultDateRange(4);
    try {
      const jobQueueService = require("../services/jobQueueService");
      await jobQueueService.enqueue(req.user._id, "schedule_bulk", {
        careReceiverIds: null,
        startDate: rangeStart.toISOString(),
        endDate: rangeEnd.toISOString(),
      });
    } catch (enqueueErr) {
      logger.error("Enqueue schedule_bulk after care giver create failed", { error: enqueueErr.message });
    }

    // Try to immediately fill existing needs_reassignment gaps with the new caregiver
    try {
      const reassignResult = await autoAssignFromUnscheduled(careGiver._id);
      if (reassignResult.assignedCount > 0) {
        logger.info(`Auto-assigned ${reassignResult.assignedCount} appointments to new caregiver ${careGiver.name}`);
      }
    } catch (assignErr) {
      logger.error("Auto-assign after caregiver creation failed", { error: assignErr.message });
    }

    res.status(201).json({
      success: true,
      data: { careGiver },
      message: "Care giver created successfully",
    });
  } catch (error) {
    logger.error("createCareGiver failed", { error: error.message });

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        error: {
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          details: errors,
        },
      });
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        error: {
          message: `Duplicate ${field}`,
          code: "DUPLICATE_ERROR",
          field,
        },
      });
    }

    next(error);
  }
};

// @desc    Update care giver
// @route   PUT /api/caregivers/:id
// @access  Private
const updateCareGiver = async (req, res, next) => {
  try {
    const oldCareGiver = await CareGiver.findById(req.params.id);
    if (!oldCareGiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care giver not found",
          code: "CARE_GIVER_NOT_FOUND",
        },
      });
    }

    // Normalize time off dates to UTC boundaries
    if (req.body.timeOff && Array.isArray(req.body.timeOff)) {
      console.log("\n⏰ Normalizing time off dates to UTC...");
      console.log("Before:", req.body.timeOff);

      req.body.timeOff = req.body.timeOff.map((timeOff) => ({
        startDate: toStartOfDayUTC(timeOff.startDate),
        endDate: toEndOfDayUTC(timeOff.endDate),
        reason: timeOff.reason || "",
      }));

      logger.debug("Time off dates normalized", { count: req.body.timeOff.length });
    }

    const { address } = req.body;

    if (req.body.address?.postcode != null) {
      req.body.address.postcode = normalizeUkPostcode(req.body.address.postcode);
    }

    // Re-geocode if address changed
    if (
      address &&
      (address.street !== oldCareGiver.address?.street ||
        address.city !== oldCareGiver.address?.city ||
        address.postcode !== oldCareGiver.address?.postcode)
    ) {
      const fullAddress = `${address.street}, ${address.city} ${address.postcode}, United Kingdom`;
      req.body.address.full = fullAddress;

      if (geocodeAddress && process.env.MAPBOX_API_KEY) {
        try {
          const coordinates = await geocodeAddress(fullAddress);
          req.body.coordinates = {
            type: "Point",
            coordinates: [coordinates.longitude, coordinates.latitude],
          };
        } catch (geoError) {
          logger.warn("Geocoding failed on update", { error: geoError.message });
          req.body.coordinates = oldCareGiver.coordinates || {
            type: "Point",
            coordinates: [-0.1276, 51.5074],
          };
        }
      } else {
        req.body.coordinates = oldCareGiver.coordinates || {
          type: "Point",
          coordinates: [-0.1276, 51.5074],
        };
      }
    }

    let careGiver = await CareGiver.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    // Detect which scheduling-relevant fields changed
    const changedFields = [];
    if (req.body.skills && JSON.stringify([...req.body.skills].sort()) !== JSON.stringify([...(oldCareGiver.skills || [])].sort())) {
      changedFields.push("skills");
    }
    if (req.body.availability && JSON.stringify(req.body.availability) !== JSON.stringify(oldCareGiver.availability || [])) {
      changedFields.push("availability");
    }
    if (req.body.singleHandedOnly !== undefined && req.body.singleHandedOnly !== oldCareGiver.singleHandedOnly) {
      changedFields.push("singleHandedOnly");
    }
    if (req.body.gender !== undefined && req.body.gender !== oldCareGiver.gender) {
      changedFields.push("gender");
    }
    if (
      req.body.coordinates &&
      JSON.stringify(req.body.coordinates) !== JSON.stringify(oldCareGiver.coordinates)
    ) {
      changedFields.push("address");
    }

    // AUTO-SYNC AVAILABILITY
    if (req.body.availability) {
      try {
        const existing = await Availability.findOne({
          careGiver: careGiver._id,
          isActive: true,
          effectiveTo: null,
        });

        if (existing) {
          existing.schedule = req.body.availability;
          if (req.body.timeOff) existing.timeOff = req.body.timeOff;
          existing.notes = "Updated with care giver";
          await existing.save();
        } else {
          await Availability.create({
            careGiver: careGiver._id,
            schedule: req.body.availability,
            timeOff: req.body.timeOff || [],
            effectiveFrom: new Date(),
            isActive: true,
            notes: "Auto-created on update",
            version: 1,
          });
        }
      } catch (availError) {
        logger.warn("Availability sync error on update", { error: availError.message });
      }
    }

    // AUTO-INVALIDATE appointments that fall in new time off periods
    if (req.body.timeOff && req.body.timeOff.length > 0) {
      try {
        for (const timeOff of req.body.timeOff) {
          await Appointment.updateMany(
            {
              $or: [
                { careGiver: careGiver._id },
                { secondaryCareGiver: careGiver._id },
              ],
              date: { $gte: timeOff.startDate, $lte: timeOff.endDate },
              status: { $in: ["scheduled", "in_progress"] },
            },
            {
              $set: {
                status: "needs_reassignment",
                invalidationReason: `Care giver on time off (${timeOff.reason || "Personal"})`,
                invalidatedAt: new Date(),
              },
            }
          );
        }
        logger.info("Appointments in time off periods marked for reassignment", { careGiverId: careGiver._id });
      } catch (invalidateError) {
        logger.warn("Appointment invalidation error", { error: invalidateError.message });
      }
    }

    // Revalidate existing appointments and auto-assign from unscheduled
    let revalidationResult = null;
    let autoAssignResult = null;

    if (changedFields.length > 0) {
      try {
        revalidationResult = await revalidateExistingAppointments(careGiver._id, changedFields);
        logger.info("Caregiver revalidation complete", {
          careGiverId: careGiver._id,
          changedFields,
          invalidated: revalidationResult.invalidatedCount,
        });

        autoAssignResult = await autoAssignFromUnscheduled(careGiver._id);
        logger.info("Auto-assign from unscheduled complete", {
          careGiverId: careGiver._id,
          assigned: autoAssignResult.assignedCount,
        });
      } catch (revalError) {
        logger.error("Revalidation/auto-assign error", { error: revalError.message });
      }
    }

    const { start: rangeStart, end: rangeEnd } = getDefaultDateRange(4);
    try {
      const jobQueueService = require("../services/jobQueueService");
      await jobQueueService.enqueue(req.user._id, "schedule_bulk", {
        careReceiverIds: null,
        startDate: rangeStart.toISOString(),
        endDate: rangeEnd.toISOString(),
      });
    } catch (enqueueErr) {
      logger.error("Enqueue schedule_bulk after care giver update failed", { error: enqueueErr.message });
    }

    res.json({
      success: true,
      data: { careGiver },
      message: "Care giver updated successfully",
      revalidation: revalidationResult
        ? {
            invalidatedCount: revalidationResult.invalidatedCount,
            reasons: revalidationResult.reasons,
          }
        : null,
      autoAssign: autoAssignResult
        ? { assignedCount: autoAssignResult.assignedCount }
        : null,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        error: {
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          details: Object.values(error.errors).map((e) => e.message),
        },
      });
    }
    next(error);
  }
};

// @desc    Delete care giver
// @route   DELETE /api/caregivers/:id
// @access  Private
const deleteCareGiver = async (req, res, next) => {
  try {
    const careGiver = await CareGiver.findById(req.params.id);
    if (!careGiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care giver not found",
          code: "CARE_GIVER_NOT_FOUND",
        },
      });
    }

    await CareGiver.findByIdAndDelete(req.params.id);
    await Availability.deleteMany({ careGiver: req.params.id });

    // Mark all active appointments as needs_reassignment
    await Appointment.updateMany(
      {
        $or: [
          { careGiver: req.params.id },
          { secondaryCareGiver: req.params.id },
        ],
        status: { $in: ["scheduled", "in_progress"] },
      },
      {
        $set: {
          status: "needs_reassignment",
          invalidationReason: "Care giver was deleted",
          invalidatedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      message: "Care giver deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// NEW: Get care giver's schedule (appointments)
// FIXED: Includes appointments where care giver is SECONDARY
// ========================================
const getCareGiverSchedule = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    logger.debug("Fetching care giver schedule", { id: req.params.id });

    const careGiver = await CareGiver.findById(req.params.id);
    if (!careGiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care giver not found",
          code: "CARE_GIVER_NOT_FOUND",
        },
      });
    }

    // Build query
    const query = {
      // CRITICAL FIX: Include appointments where CG is PRIMARY OR SECONDARY
      $or: [
        { careGiver: req.params.id },
        { secondaryCareGiver: req.params.id },
      ],
    };

    // Add date filter if provided
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // Fetch appointments
    const appointments = await Appointment.find(query)
      .populate("careReceiver", "name phone address")
      .populate("careGiver", "name email phone")
      .populate("secondaryCareGiver", "name email phone")
      .sort({ date: 1, startTime: 1 });

    const primaryCount = appointments.filter(
      (apt) => apt.careGiver && apt.careGiver._id.toString() === req.params.id,
    ).length;
    const secondaryCount = appointments.filter(
      (apt) =>
        apt.secondaryCareGiver &&
        apt.secondaryCareGiver._id.toString() === req.params.id,
    ).length;

    res.json({
      success: true,
      data: {
        appointments,
        careGiver,
        summary: {
          total: appointments.length,
          asPrimary: primaryCount,
          asSecondary: secondaryCount,
        },
      },
    });
  } catch (error) {
    logger.error("getCareGiverSchedule failed", { id: req.params.id, error: error.message });
    next(error);
  }
};
// ========================================

// @desc    Get care giver statistics
// @route   GET /api/caregivers/:id/stats
// @access  Private
const getCareGiverStats = async (req, res, next) => {
  try {
    const careGiver = await CareGiver.findById(req.params.id);
    if (!careGiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care giver not found",
          code: "CARE_GIVER_NOT_FOUND",
        },
      });
    }

    let totalAppointments = 0;
    let completedAppointments = 0;

    try {
      // FIXED: Count appointments where CG is PRIMARY OR SECONDARY
      totalAppointments = await Appointment.countDocuments({
        $or: [
          { careGiver: req.params.id },
          { secondaryCareGiver: req.params.id },
        ],
      });
      completedAppointments = await Appointment.countDocuments({
        $or: [
          { careGiver: req.params.id },
          { secondaryCareGiver: req.params.id },
        ],
        status: "completed",
      });
    } catch (err) {}

    const stats = {
      totalAppointments,
      completedAppointments,
      completionRate:
        totalAppointments > 0
          ? `${((completedAppointments / totalAppointments) * 100).toFixed(1)}%`
          : "0%",
      skills: careGiver.skills.length,
      isActive: careGiver.isActive,
    };

    res.json({
      success: true,
      data: { stats },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllCareGivers,
  getCareGiverById,
  createCareGiver,
  updateCareGiver,
  deleteCareGiver,
  getCareGiverSchedule, // NEW: Export schedule endpoint
  getCareGiverStats,
};
