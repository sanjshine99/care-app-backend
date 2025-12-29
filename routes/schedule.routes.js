// backend/routes/schedule.routes.js
// COMPLETE - With validation endpoint

const express = require("express");
const { protect } = require("../middleware/auth");
const scheduleController = require("../controllers/scheduleController");
const scheduleAnalysisController = require("../controllers/scheduleAnalysisController");

const router = express.Router();

// All routes require authentication
router.use(protect);

// ========================================
// SCHEDULE GENERATION
// ========================================
router.post("/generate", scheduleController.generateSchedule);

// ========================================
// APPOINTMENTS
// ========================================
// Get all appointments
router.get("/appointments", scheduleController.getAllAppointments);

// Create manual appointment
router.post("/appointments/manual", scheduleController.createManualAppointment);

// Update appointment status
router.patch(
  "/appointments/:id/status",
  scheduleController.updateAppointmentStatus
);

// Delete appointment
router.delete("/appointments/:id", scheduleController.deleteAppointment);

// Get appointment assignment reasoning
router.get(
  "/appointments/:appointmentId/reasoning",
  scheduleAnalysisController.getAssignmentReasoning
);

// ========================================
// SCHEDULE VALIDATION
// ========================================
// Validate schedule for conflicts
router.post("/validate", protect, scheduleController.validateSchedule);

// ========================================
// UNSCHEDULED & ANALYSIS
// ========================================
// Get unscheduled appointments
router.get("/unscheduled", scheduleController.getUnscheduled);

// Analyze why appointment couldn't be scheduled
router.post(
  "/analyze-unscheduled",
  scheduleAnalysisController.analyzeUnscheduledAppointment
);

// ========================================
// MANUAL SCHEDULING
// ========================================
// Find available care givers for manual scheduling
router.post("/find-available", scheduleController.findAvailableForManual);

// Get fresh care receiver data
router.get(
  "/care-receiver/:id/fresh",
  scheduleController.getFreshCareReceiverData
);

// ========================================
// STATISTICS
// ========================================
// Get schedule stats
router.get("/stats", scheduleController.getScheduleStats);

module.exports = router;
