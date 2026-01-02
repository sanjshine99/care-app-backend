// backend/controllers/careGiverController.js
// FIXED - Includes schedule endpoint with secondary care giver support

const CareGiver = require("../models/CareGiver");
const Availability = require("../models/Availability");
const Appointment = require("../models/Appointment");

// Try to import geocode service, but don't fail if it doesn't exist
let geocodeAddress;
try {
  geocodeAddress = require("../services/mapboxService").geocodeAddress;
} catch (e) {
  geocodeAddress = null;
}

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
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
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
    console.log("\n=== CREATE CARE GIVER ===");
    const { address } = req.body;

    // Normalize time off dates to UTC midnight
    if (req.body.timeOff && Array.isArray(req.body.timeOff)) {
      console.log("⏰ Normalizing time off dates to UTC...");
      req.body.timeOff = req.body.timeOff.map((timeOff) => {
        const startDate = new Date(timeOff.startDate);
        startDate.setUTCHours(0, 0, 0, 0);

        const endDate = new Date(timeOff.endDate);
        endDate.setUTCHours(23, 59, 59, 999);

        return {
          startDate: startDate,
          endDate: endDate,
          reason: timeOff.reason || "",
        };
      });

      console.log(
        "✅ Normalized time off:",
        req.body.timeOff.map((to) => ({
          start: to.startDate.toISOString().split("T")[0],
          end: to.endDate.toISOString().split("T")[0],
          reason: to.reason,
        }))
      );
    }

    // GEOCODE WITH FALLBACK
    if (address && address.street && address.city && address.postcode) {
      const fullAddress = `${address.street}, ${address.city} ${address.postcode}`;
      req.body.address.full = fullAddress;

      if (geocodeAddress && process.env.MAPBOX_ACCESS_TOKEN) {
        try {
          console.log("🗺️ Geocoding:", fullAddress);
          const coordinates = await geocodeAddress(fullAddress);
          req.body.coordinates = coordinates;
          console.log("✅ Geocoded successfully");
        } catch (geoError) {
          console.log("⚠️ Geocoding failed:", geoError.message);
          console.log("📍 Using default coordinates (London)");
          req.body.coordinates = {
            type: "Point",
            coordinates: [-0.1276, 51.5074],
          };
        }
      } else {
        console.log("📍 No geocoding service - using default coordinates");
        req.body.coordinates = {
          type: "Point",
          coordinates: [-0.1276, 51.5074],
        };
      }
    } else {
      console.log("📍 No address - using default coordinates");
      req.body.coordinates = {
        type: "Point",
        coordinates: [-0.1276, 51.5074],
      };
    }

    // CREATE CARE GIVER
    console.log("💾 Creating care giver...");
    const careGiver = await CareGiver.create(req.body);
    console.log("✅ Created:", careGiver._id);

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
        console.log("✅ Availability synced");
      } catch (availError) {
        console.log("⚠️ Availability sync failed:", availError.message);
      }
    }

    res.status(201).json({
      success: true,
      data: { careGiver },
      message: "Care giver created successfully",
    });
  } catch (error) {
    console.error("❌ ERROR:", error.message);

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
    let careGiver = await CareGiver.findById(req.params.id);
    if (!careGiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care giver not found",
          code: "CARE_GIVER_NOT_FOUND",
        },
      });
    }

    // Normalize time off dates to UTC midnight
    if (req.body.timeOff && Array.isArray(req.body.timeOff)) {
      console.log("\n⏰ Normalizing time off dates to UTC...");
      console.log("Before:", req.body.timeOff);

      req.body.timeOff = req.body.timeOff.map((timeOff) => {
        const startDate = new Date(timeOff.startDate);
        startDate.setUTCHours(0, 0, 0, 0);

        const endDate = new Date(timeOff.endDate);
        endDate.setUTCHours(23, 59, 59, 999);

        return {
          startDate: startDate,
          endDate: endDate,
          reason: timeOff.reason || "",
        };
      });

      console.log("✅ Normalized time off dates:");
      req.body.timeOff.forEach((to, idx) => {
        console.log(
          `   ${idx + 1}. ${to.startDate.toISOString()} → ${to.endDate.toISOString()} (${to.reason})`
        );
      });
    }

    const { address } = req.body;

    // Re-geocode if address changed
    if (
      address &&
      (address.street !== careGiver.address?.street ||
        address.city !== careGiver.address?.city ||
        address.postcode !== careGiver.address?.postcode)
    ) {
      const fullAddress = `${address.street}, ${address.city} ${address.postcode}`;
      req.body.address.full = fullAddress;

      if (geocodeAddress && process.env.MAPBOX_ACCESS_TOKEN) {
        try {
          const coordinates = await geocodeAddress(fullAddress);
          req.body.coordinates = coordinates;
        } catch (geoError) {
          console.log("Geocoding failed, using default coordinates");
          req.body.coordinates = careGiver.coordinates || {
            type: "Point",
            coordinates: [-0.1276, 51.5074],
          };
        }
      } else {
        req.body.coordinates = careGiver.coordinates || {
          type: "Point",
          coordinates: [-0.1276, 51.5074],
        };
      }
    }

    careGiver = await CareGiver.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    // AUTO-SYNC AVAILABILITY
    if (req.body.availability) {
      try {
        const existing = await Availability.findOne({
          careGiver: careGiver._id,
          isActive: true,
        });

        if (existing) {
          existing.schedule = req.body.availability;
          if (req.body.timeOff) existing.timeOff = req.body.timeOff;
          existing.notes = "Updated with care giver";
          await existing.save();
          console.log("✅ Availability updated");
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
          console.log("✅ Availability created");
        }
      } catch (availError) {
        console.log("Availability sync error:", availError.message);
      }
    }

    res.json({
      success: true,
      data: { careGiver },
      message: "Care giver updated successfully",
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

    console.log(`\n[CG Schedule] Fetching schedule for CG: ${req.params.id}`);

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

    console.log(`[CG Schedule] Query:`, JSON.stringify(query));

    // Fetch appointments
    const appointments = await Appointment.find(query)
      .populate("careReceiver", "name phone address")
      .populate("careGiver", "name email phone")
      .populate("secondaryCareGiver", "name email phone")
      .sort({ date: 1, startTime: 1 });

    console.log(`[CG Schedule] Found ${appointments.length} appointments`);

    // Log which appointments are primary vs secondary
    const primaryCount = appointments.filter(
      (apt) => apt.careGiver && apt.careGiver._id.toString() === req.params.id
    ).length;
    const secondaryCount = appointments.filter(
      (apt) =>
        apt.secondaryCareGiver &&
        apt.secondaryCareGiver._id.toString() === req.params.id
    ).length;

    console.log(
      `[CG Schedule] Primary: ${primaryCount}, Secondary: ${secondaryCount}`
    );

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
    console.error("[CG Schedule] Error:", error);
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
