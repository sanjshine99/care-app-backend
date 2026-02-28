// backend/routes/map.routes.js
// Map and location routes

const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getAllLocations,
  calculateDistance,
  findCareGiversNearby,
  getRoute,
  getTodayAppointments,
  regeocodeAllCareGivers,
} = require("../controllers/mapController");

const router = express.Router();

// All routes require authentication
router.use(protect);

// Location endpoints
router.get("/locations", getAllLocations); // GET /api/map/locations
router.get("/today-appointments", getTodayAppointments); // GET /api/map/today-appointments

// Calculation endpoints
router.post("/distance", calculateDistance); // POST /api/map/distance
router.post("/care-givers-nearby", findCareGiversNearby); // POST /api/map/care-givers-nearby
router.post("/route", getRoute); // POST /api/map/route

// One-time admin fix: re-geocode caregivers that have default London coordinates
router.post("/regeocode-caregivers", regeocodeAllCareGivers); // POST /api/map/regeocode-caregivers

module.exports = router;
