// backend/routes/schedule.routes.js
// UPDATED - Added fresh data endpoints

const express = require("express");
const { protect } = require("../middleware/auth");
const {
  generateSchedule,
  getAllAppointments,
  getUnscheduled,
  findAvailableForManual,
  getFreshCareReceiverData,
  createManualAppointment,
  updateAppointmentStatus,
  deleteAppointment,
  getScheduleStats,
} = require("../controllers/scheduleController");

const router = express.Router();

// All routes require authentication
router.use(protect);

// Schedule generation
router.post("/generate", generateSchedule);

// Appointments
router.get("/appointments", getAllAppointments);
router.post("/appointments/manual", createManualAppointment);
router.patch("/appointments/:id/status", updateAppointmentStatus);
router.delete("/appointments/:id", deleteAppointment);

// Utilities
router.get("/unscheduled", getUnscheduled); // UPDATED - Returns fresh data
router.post("/find-available", findAvailableForManual); // UPDATED - Uses fresh data
router.get("/care-receiver/:id/fresh", getFreshCareReceiverData); // NEW - Get fresh care receiver data
router.get("/stats", getScheduleStats);

module.exports = router;
