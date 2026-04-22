// backend/routes/carereceiver.routes.js
// Complete CRUD and care request routes

const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getAllCareReceivers,
  getCareReceiverById,
  createCareReceiver,
  updateCareReceiver,
  deleteCareReceiver,
  getCareReceiverSchedule,
  getCareReceiverStats,
  getSuitableCareGivers,
} = require("../controllers/careReceiverController");
const {
  listServiceNotRequiredPeriods,
  createServiceNotRequiredPeriod,
  updateServiceNotRequiredPeriod,
  deleteServiceNotRequiredPeriod,
} = require("../controllers/serviceNotRequiredPeriodController");

const router = express.Router();

// All routes require authentication
router.use(protect);

// Care receiver CRUD routes
router
  .route("/")
  .get(getAllCareReceivers) // GET /api/carereceivers
  .post(createCareReceiver); // POST /api/carereceivers

// Service not required (specific paths before generic /:id)
router.get("/:id/service-not-required", listServiceNotRequiredPeriods);
router.post("/:id/service-not-required", createServiceNotRequiredPeriod);
router.patch("/:id/service-not-required/:periodId", updateServiceNotRequiredPeriod);
router.delete("/:id/service-not-required/:periodId", deleteServiceNotRequiredPeriod);

router
  .route("/:id")
  .get(getCareReceiverById) // GET /api/carereceivers/:id
  .put(updateCareReceiver) // PUT /api/carereceivers/:id
  .delete(deleteCareReceiver); // DELETE /api/carereceivers/:id

// Additional routes
router.get("/:id/schedule", getCareReceiverSchedule); // GET /api/carereceivers/:id/schedule
router.get("/:id/stats", getCareReceiverStats); // GET /api/carereceivers/:id/stats
router.get("/:id/suitable-caregivers", getSuitableCareGivers); // GET /api/carereceivers/:id/suitable-caregivers

module.exports = router;
