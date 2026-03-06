// Shared constants for the care platform

// Appointment statuses considered "active" (occupy a scheduling slot)
exports.ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "in_progress", "completed"];

// Statuses visible in calendar view (includes cancelled for user awareness)
exports.CALENDAR_VISIBLE_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"];
