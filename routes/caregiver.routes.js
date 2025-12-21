// backend/routes/caregiver.routes.js
// Complete routes for care giver management

const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getAllCareGivers,
  getCareGiverById,
  createCareGiver,
  updateCareGiver,
  deleteCareGiver,
  getCareGiverStats,
} = require("../controllers/careGiverController");

const router = express.Router();

// All routes require authentication
router.use(protect);

// CRUD routes
router
  .route("/")
  .get(getAllCareGivers) // GET /api/caregivers
  .post(createCareGiver); // POST /api/caregivers

router
  .route("/:id")
  .get(getCareGiverById) // GET /api/caregivers/:id
  .put(updateCareGiver) // PUT /api/caregivers/:id
  .delete(deleteCareGiver); // DELETE /api/caregivers/:id

// Stats route (must be BEFORE /:id to avoid conflict)
router.get("/:id/stats", getCareGiverStats); // GET /api/caregivers/:id/stats

module.exports = router;
