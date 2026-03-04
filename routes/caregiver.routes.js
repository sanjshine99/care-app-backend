// backend/routes/caregiver.routes.js
// FIXED - Added schedule endpoint

const express = require("express");
const { protect } = require("../middleware/auth");

// Cache responses that are stable within a window — reduces DB round-trips on repeat navigation
const cachePrivate = (seconds) => (_req, res, next) => {
  res.set("Cache-Control", `private, max-age=${seconds}`);
  next();
};
const {
  getAllCareGivers,
  getCareGiverById,
  createCareGiver,
  updateCareGiver,
  deleteCareGiver,
  getCareGiverSchedule, // NEW
  getCareGiverStats,
} = require("../controllers/careGiverController");

const router = express.Router();

// All routes require authentication
router.use(protect);

// Care giver CRUD routes
router
  .route("/")
  .get(cachePrivate(120), getAllCareGivers) // GET /api/caregivers — cached 2 min (matches React Query staleTime)
  .post(createCareGiver); // POST /api/caregivers

router
  .route("/:id")
  .get(getCareGiverById) // GET /api/caregivers/:id
  .put(updateCareGiver) // PUT /api/caregivers/:id
  .delete(deleteCareGiver); // DELETE /api/caregivers/:id

// Additional routes
router.get("/:id/schedule", getCareGiverSchedule); // NEW: GET /api/caregivers/:id/schedule
router.get("/:id/stats", getCareGiverStats); // GET /api/caregivers/:id/stats

module.exports = router;
