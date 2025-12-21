// backend/controllers/mapController.js
// Map locations and routes controller

const CareGiver = require("../models/CareGiver");
const CareReceiver = require("../models/CareReceiver");
const Appointment = require("../models/Appointment");
const mapboxService = require("../services/mapboxService");

// @desc    Get all locations (care givers and care receivers)
// @route   GET /api/map/locations
// @access  Private
exports.getAllLocations = async (req, res, next) => {
  try {
    // Get all active care givers with coordinates
    const careGivers = await CareGiver.find({
      isActive: true,
      coordinates: { $exists: true, $ne: null },
    }).select("name email phone gender skills canDrive coordinates address");

    // Get all active care receivers with coordinates
    const careReceivers = await CareReceiver.find({
      isActive: true,
      coordinates: { $exists: true, $ne: null },
    }).select(
      "name email phone genderPreference dailyVisits coordinates address"
    );

    // Format for frontend
    const locations = {
      careGivers: careGivers.map((cg) => ({
        id: cg._id,
        name: cg.name,
        email: cg.email,
        phone: cg.phone,
        gender: cg.gender,
        skills: cg.skills,
        canDrive: cg.canDrive,
        coordinates: {
          longitude: cg.coordinates.coordinates[0],
          latitude: cg.coordinates.coordinates[1],
        },
        address: cg.address,
        type: "caregiver",
      })),
      careReceivers: careReceivers.map((cr) => ({
        id: cr._id,
        name: cr.name,
        email: cr.email,
        phone: cr.phone,
        genderPreference: cr.genderPreference,
        dailyVisits: cr.dailyVisits?.length || 0,
        coordinates: {
          longitude: cr.coordinates.coordinates[0],
          latitude: cr.coordinates.coordinates[1],
        },
        address: cr.address,
        type: "carereceiver",
      })),
    };

    res.json({
      success: true,
      data: {
        locations,
        stats: {
          totalCareGivers: careGivers.length,
          totalCareReceivers: careReceivers.length,
          total: careGivers.length + careReceivers.length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Calculate distance between two points
// @route   POST /api/map/distance
// @access  Private
exports.calculateDistance = async (req, res, next) => {
  try {
    const { from, to } = req.body;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: {
          message: "From and to coordinates are required",
          code: "MISSING_COORDINATES",
        },
      });
    }

    const result = await mapboxService.calculateDistance(from, to);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Find care givers within radius of a point
// @route   POST /api/map/care-givers-nearby
// @access  Private
exports.findCareGiversNearby = async (req, res, next) => {
  try {
    const { longitude, latitude, radiusKm = 10 } = req.body;

    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Longitude and latitude are required",
          code: "MISSING_COORDINATES",
        },
      });
    }

    const careGivers = await mapboxService.findCareGiversWithinRadius(
      { longitude, latitude },
      radiusKm
    );

    res.json({
      success: true,
      data: {
        careGivers,
        count: careGivers.length,
        radiusKm,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get route between multiple points
// @route   POST /api/map/route
// @access  Private
exports.getRoute = async (req, res, next) => {
  try {
    const { coordinates } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          message: "At least 2 coordinate pairs are required",
          code: "INVALID_COORDINATES",
        },
      });
    }

    const route = await mapboxService.getRouteGeometry(coordinates);

    res.json({
      success: true,
      data: route,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get appointments for today with locations
// @route   GET /api/map/today-appointments
// @access  Private
exports.getTodayAppointments = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const appointments = await Appointment.find({
      date: { $gte: today, $lt: tomorrow },
      status: { $in: ["scheduled", "in_progress"] },
    })
      .populate("careGiver", "name coordinates")
      .populate("careReceiver", "name coordinates")
      .sort({ startTime: 1 });

    const appointmentsWithLocations = appointments
      .filter(
        (apt) => apt.careGiver?.coordinates && apt.careReceiver?.coordinates
      )
      .map((apt) => ({
        id: apt._id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        duration: apt.duration,
        status: apt.status,
        careGiver: {
          id: apt.careGiver._id,
          name: apt.careGiver.name,
          coordinates: {
            longitude: apt.careGiver.coordinates.coordinates[0],
            latitude: apt.careGiver.coordinates.coordinates[1],
          },
        },
        careReceiver: {
          id: apt.careReceiver._id,
          name: apt.careReceiver.name,
          coordinates: {
            longitude: apt.careReceiver.coordinates.coordinates[0],
            latitude: apt.careReceiver.coordinates.coordinates[1],
          },
        },
      }));

    res.json({
      success: true,
      data: {
        appointments: appointmentsWithLocations,
        count: appointmentsWithLocations.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
