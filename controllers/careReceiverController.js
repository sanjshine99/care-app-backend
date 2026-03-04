// backend/controllers/careReceiverController.js
// Complete CRUD operations for care receivers

const CareReceiver = require("../models/CareReceiver");
const { geocodeAddress } = require("../services/mapboxService");
const {
  notifyRecurringVisitsAdded,
} = require("../services/notificationService");
const logger = require("../utils/logger");

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// @desc    Get all care receivers
// @route   GET /api/carereceivers
// @access  Private
exports.getAllCareReceivers = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      isActive,
      doubleHanded,
      genderPreference,
    } = req.query;

    // Build query
    const query = {};

    // Search by name — escape input to prevent ReDoS attacks
    if (search) {
      const safeSearch = escapeRegex(String(search).slice(0, 100));
      query.name = { $regex: safeSearch, $options: "i" };
    }

    // Filter by status
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Filter by double-handed requirement
    if (doubleHanded) {
      query["dailyVisits.doubleHanded"] = doubleHanded === "true";
    }

    // Filter by gender preference
    if (genderPreference) {
      query.genderPreference = genderPreference;
    }

    // Execute query with pagination
    const total = await CareReceiver.countDocuments(query);
    const careReceivers = await CareReceiver.find(query)
      .populate("preferredCareGiver", "name email")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    res.json({
      success: true,
      data: {
        careReceivers,
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

// @desc    Get single care receiver by ID
// @route   GET /api/carereceivers/:id
// @access  Private
exports.getCareReceiverById = async (req, res, next) => {
  try {
    const careReceiver = await CareReceiver.findById(req.params.id).populate(
      "preferredCareGiver",
      "name email phone skills",
    );

    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    res.json({
      success: true,
      data: { careReceiver },
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: {
          message: "Invalid care receiver ID",
          code: "INVALID_ID",
        },
      });
    }
    next(error);
  }
};

// @desc    Create new care receiver
// @route   POST /api/carereceivers
// @access  Private
exports.createCareReceiver = async (req, res, next) => {
  try {
    // Validate required fields
    const requiredFields = [
      "name",
      "phone",
      "address",
      "dateOfBirth",
      "emergencyContact",
    ];
    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({
          success: false,
          error: {
            message: `${field} is required`,
            code: "MISSING_FIELD",
          },
        });
      }
    }

    // Geocode address
    const { street, city, postcode } = req.body.address;
    const fullAddress = `${street}, ${city} ${postcode}, United Kingdom`;

    try {
      const coordinates = await geocodeAddress(fullAddress);
      req.body.coordinates = {
        type: "Point",
        coordinates: [coordinates.longitude, coordinates.latitude],
      };
    } catch (geocodeError) {
      logger.warn("Geocoding failed on create", { address: fullAddress, error: geocodeError.message });
      return res.status(400).json({
        success: false,
        error: {
          message:
            "Could not geocode address. Please check the address is valid.",
          code: "GEOCODING_FAILED",
        },
      });
    }

    // Validate daily visits duration (15-120 minutes)
    if (req.body.dailyVisits) {
      for (const visit of req.body.dailyVisits) {
        if (visit.duration < 15 || visit.duration > 120) {
          return res.status(400).json({
            success: false,
            error: {
              message: "Visit duration must be between 15 and 120 minutes",
              code: "INVALID_DURATION",
            },
          });
        }
        const buf = visit.bufferFlexibilityMinutes;
        if (buf != null && (typeof buf !== "number" || buf < 0 || buf > 60)) {
          return res.status(400).json({
            success: false,
            error: {
              message: "Arrival window (buffer flexibility) must be a number between 0 and 60",
              code: "INVALID_BUFFER_FLEXIBILITY",
            },
          });
        }
      }
    }

    // Create care receiver
    const careReceiver = await CareReceiver.create(req.body);
    logger.info("Care receiver created", { id: careReceiver._id });

    // Populate preferred care giver if exists
    await careReceiver.populate("preferredCareGiver", "name email");

    const hasRecurringVisits =
      careReceiver.dailyVisits && careReceiver.dailyVisits.length > 0;
    if (hasRecurringVisits) {
      await notifyRecurringVisitsAdded(req.user._id, careReceiver.name);
      res.status(201).json({
        success: true,
        data: { careReceiver },
        message: "Care receiver created successfully",
        scheduleGenerationQueued: true,
      });
      const jobQueueService = require("../services/jobQueueService");
      jobQueueService
        .enqueue(req.user._id, "schedule_care_receiver", {
          careReceiverId: careReceiver._id,
          careReceiverName: careReceiver.name,
        })
        .catch((err) => logger.error("Enqueue schedule job failed", { error: err.message }));
    } else {
      res.status(201).json({
        success: true,
        data: { careReceiver },
        message: "Care receiver created successfully",
      });
    }
  } catch (error) {
    logger.error("Create care receiver error", { error: error.message });

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        error: {
          message: errors[0],
          code: "VALIDATION_ERROR",
        },
      });
    }
    next(error);
  }
};

// @desc    Update care receiver
// @route   PUT /api/carereceivers/:id
// @access  Private
exports.updateCareReceiver = async (req, res, next) => {
  try {

    let careReceiver = await CareReceiver.findById(req.params.id);

    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    // If address changed, re-geocode
    if (req.body.address) {
      const addressChanged =
        req.body.address.street !== careReceiver.address.street ||
        req.body.address.city !== careReceiver.address.city ||
        req.body.address.postcode !== careReceiver.address.postcode;

      if (addressChanged) {
        const { street, city, postcode } = req.body.address;
        const fullAddress = `${street}, ${city} ${postcode}, United Kingdom`;

        try {
          const coordinates = await geocodeAddress(fullAddress);
          req.body.coordinates = {
            type: "Point",
            coordinates: [coordinates.longitude, coordinates.latitude],
          };
        } catch (geocodeError) {
          logger.warn("Re-geocoding failed on update", { address: fullAddress, error: geocodeError.message });
          return res.status(400).json({
            success: false,
            error: {
              message: "Could not geocode new address",
              code: "GEOCODING_FAILED",
            },
          });
        }
      }
    }

    // Validate daily visits duration
    if (req.body.dailyVisits) {
      for (const visit of req.body.dailyVisits) {
        if (visit.duration < 15 || visit.duration > 120) {
          return res.status(400).json({
            success: false,
            error: {
              message: "Visit duration must be between 15 and 120 minutes",
              code: "INVALID_DURATION",
            },
          });
        }
        const buf = visit.bufferFlexibilityMinutes;
        if (buf != null && (typeof buf !== "number" || buf < 0 || buf > 60)) {
          return res.status(400).json({
            success: false,
            error: {
              message: "Arrival window (buffer flexibility) must be a number between 0 and 60",
              code: "INVALID_BUFFER_FLEXIBILITY",
            },
          });
        }
      }
    }

    // Cancel only appointments for visits whose schedule changed (or were removed).
    // Adding new visits should not invalidate existing appointments.
    const oldVisits = careReceiver.dailyVisits || [];
    const newVisits = req.body.dailyVisits || [];
    const oldById = new Map(oldVisits.map((v) => [String(v._id), v]));
    const newIds = new Set(
      (newVisits || [])
        .filter((v) => v._id)
        .map((v) => String(v._id))
    );
    const changedVisitNumbers = [];

    for (const newV of newVisits) {
      const id = newV._id && String(newV._id);
      if (!id || !oldById.has(id)) continue;
      const oldV = oldById.get(id);
      const oldDays = (oldV.daysOfWeek || []).slice().sort();
      const newDays = (newV.daysOfWeek || []).slice().sort();
      if (
        JSON.stringify(oldDays) !== JSON.stringify(newDays) ||
        oldV.preferredTime !== newV.preferredTime ||
        oldV.duration !== newV.duration
      ) {
        changedVisitNumbers.push(oldV.visitNumber);
      }
    }
    for (const oldV of oldVisits) {
      const id = oldV._id && String(oldV._id);
      if (id && !newIds.has(id)) {
        changedVisitNumbers.push(oldV.visitNumber);
      }
    }

    // Update
    careReceiver = await CareReceiver.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      },
    ).populate("preferredCareGiver", "name email");

    logger.info("Care receiver updated", { id: req.params.id });

    if (changedVisitNumbers.length > 0) {
      const Appointment = require("../models/Appointment");
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const cancelResult = await Appointment.updateMany(
        {
          careReceiver: req.params.id,
          visitNumber: { $in: changedVisitNumbers },
          date: { $gte: today },
          status: { $in: ["scheduled", "in_progress"] },
        },
        {
          $set: {
            status: "cancelled",
            cancellationReason: "Care receiver visit schedule was changed",
            invalidationReason: null,
            invalidatedAt: null,
          },
        }
      );
      logger.info("Appointments cancelled after visit schedule change", {
        careReceiverId: req.params.id,
        modifiedCount: cancelResult.modifiedCount,
        visitNumbers: changedVisitNumbers,
      });
    }

    const hasRecurringVisits =
      req.body.dailyVisits && req.body.dailyVisits.length > 0;
    if (hasRecurringVisits) {
      await notifyRecurringVisitsAdded(req.user._id, careReceiver.name);
      res.json({
        success: true,
        data: { careReceiver },
        message: "Care receiver updated successfully",
        scheduleGenerationQueued: true,
      });
      const jobQueueService = require("../services/jobQueueService");
      jobQueueService
        .enqueue(req.user._id, "schedule_care_receiver", {
          careReceiverId: careReceiver._id,
          careReceiverName: careReceiver.name,
        })
        .catch((err) => logger.error("Enqueue schedule job failed", { error: err.message }));
    } else {
      res.json({
        success: true,
        data: { careReceiver },
        message: "Care receiver updated successfully",
      });
    }
  } catch (error) {
    logger.error("Update care receiver error", { error: error.message });

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        error: {
          message: errors[0],
          code: "VALIDATION_ERROR",
        },
      });
    }
    next(error);
  }
};

// @desc    Delete care receiver
// @route   DELETE /api/carereceivers/:id
// @access  Private
exports.deleteCareReceiver = async (req, res, next) => {
  try {
    const careReceiver = await CareReceiver.findById(req.params.id);

    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    // Check for existing appointments
    const Appointment = require("../models/Appointment");
    const hasAppointments = await Appointment.countDocuments({
      careReceiver: req.params.id,
      status: { $in: ["scheduled", "in_progress"] },
    });

    if (hasAppointments > 0) {
      return res.status(400).json({
        success: false,
        error: {
          message: `Cannot delete care receiver with ${hasAppointments} active appointment(s)`,
          code: "HAS_APPOINTMENTS",
        },
      });
    }

    await CareReceiver.findByIdAndDelete(req.params.id);
    logger.info("Care receiver deleted", { id: req.params.id });

    res.json({
      success: true,
      message: "Care receiver deleted successfully",
    });
  } catch (error) {
    logger.error("Delete care receiver error", { error: error.message });
    next(error);
  }
};

// @desc    Get care receiver's schedule/appointments
// @route   GET /api/carereceivers/:id/schedule
// @access  Private
exports.getCareReceiverSchedule = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const careReceiver = await CareReceiver.findById(req.params.id);
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    const Appointment = require("../models/Appointment");

    const query = { careReceiver: req.params.id };

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const appointments = await Appointment.find(query)
      .populate("careGiver", "name email phone")
      .populate("secondaryCareGiver", "name email phone")
      .sort({ date: 1, startTime: 1 });

    res.json({
      success: true,
      data: {
        careReceiver: {
          id: careReceiver._id,
          name: careReceiver.name,
          dailyVisits: careReceiver.dailyVisits,
        },
        appointments,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get care receiver statistics
// @route   GET /api/carereceivers/:id/stats
// @access  Private
exports.getCareReceiverStats = async (req, res, next) => {
  try {
    const careReceiver = await CareReceiver.findById(req.params.id);
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    const Appointment = require("../models/Appointment");

    // Get appointment statistics
    const [totalAppointments, completedAppointments, upcomingAppointments] =
      await Promise.all([
        Appointment.countDocuments({ careReceiver: req.params.id }),
        Appointment.countDocuments({
          careReceiver: req.params.id,
          status: "completed",
        }),
        Appointment.countDocuments({
          careReceiver: req.params.id,
          status: "scheduled",
          date: { $gte: new Date() },
        }),
      ]);

    const stats = {
      totalDailyVisits: careReceiver.dailyVisits.length,
      totalDailyCareTime: careReceiver.totalDailyCareTime,
      doubleHandedVisits: careReceiver.dailyVisits.filter((v) => v.doubleHanded)
        .length,
      appointments: {
        total: totalAppointments,
        completed: completedAppointments,
        upcoming: upcomingAppointments,
      },
    };

    res.json({
      success: true,
      data: { stats },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Find suitable care givers for care receiver
// @route   GET /api/carereceivers/:id/suitable-caregivers
// @access  Private
exports.getSuitableCareGivers = async (req, res, next) => {
  try {
    const careReceiver = await CareReceiver.findById(req.params.id);
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    const CareGiver = require("../models/CareGiver");
    const { visitNumber, maxDistance = 15 } = req.query;

    // Get specific visit or all visits
    const visits = visitNumber
      ? [
          careReceiver.dailyVisits.find(
            (v) => v.visitNumber === parseInt(visitNumber),
          ),
        ]
      : careReceiver.dailyVisits;

    if (!visits[0]) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Visit not found",
          code: "VISIT_NOT_FOUND",
        },
      });
    }

    const results = [];

    for (const visit of visits) {
      // Build query
      const query = {
        isActive: true,
        skills: { $all: visit.requirements },
      };

      // Add gender preference if specified
      if (careReceiver.genderPreference !== "No Preference") {
        query.gender = careReceiver.genderPreference;
      }

      // Add single-handed filter
      if (!visit.doubleHanded) {
        query.singleHandedOnly = false;
      }

      // Add location filter
      query.coordinates = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: careReceiver.coordinates.coordinates,
          },
          $maxDistance: maxDistance * 1000, // km to meters
        },
      };

      const careGivers = await CareGiver.find(query)
        .select("name email phone skills canDrive coordinates")
        .limit(20);

      // Calculate distance for each
      const careGiversWithDistance = careGivers.map((cg) => {
        const distance = calculateDistance(
          careReceiver.coordinates.coordinates,
          cg.coordinates.coordinates,
        );
        return {
          ...cg.toObject(),
          distance: distance.toFixed(2),
        };
      });

      results.push({
        visit: {
          visitNumber: visit.visitNumber,
          time: visit.preferredTime,
          duration: visit.duration,
          requirements: visit.requirements,
          doubleHanded: visit.doubleHanded,
        },
        suitableCareGivers: careGiversWithDistance,
      });
    }

    res.json({
      success: true,
      data: { results },
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to calculate distance between two points
function calculateDistance(coords1, coords2) {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;

  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = exports;
