// backend/services/notificationService.js
// Service to create notifications from system events

const Notification = require("../models/Notification");

/**
 * Create notification for schedule generation
 */
exports.notifyScheduleGenerated = async (userId, scheduleResults) => {
  const { totalScheduled, totalFailed, careReceiversProcessed } =
    scheduleResults;

  let type = "success";
  let priority = "medium";
  let title = "Schedule Generated Successfully";
  let message = `Generated ${totalScheduled} appointments for ${careReceiversProcessed} care receivers.`;

  if (totalFailed > 0) {
    type = "warning";
    priority = "high";
    title = "Schedule Generated with Warnings";
    message = `Generated ${totalScheduled} appointments, but ${totalFailed} appointments failed to schedule.`;
  }

  if (totalScheduled === 0 && totalFailed > 0) {
    type = "error";
    priority = "critical";
    title = "Schedule Generation Failed";
    message = `Failed to schedule ${totalFailed} appointments. Please review and schedule manually.`;
  }

  await Notification.create({
    adminUser: userId,
    type,
    priority,
    title,
    message,
    metadata: {
      action: "schedule_generated",
      resourceType: "schedule",
      count: totalScheduled,
      details: {
        scheduled: totalScheduled,
        failed: totalFailed,
        careReceivers: careReceiversProcessed,
      },
    },
    actionRequired: totalFailed > 0,
    actionUrl: "/schedule",
    actionLabel: totalFailed > 0 ? "View Unscheduled" : "View Schedule",
  });
};

/**
 * Create notification for unscheduled appointments
 */
exports.notifyUnscheduledAppointments = async (
  userId,
  unscheduledCount,
  careReceiverName = null
) => {
  const message = careReceiverName
    ? `${careReceiverName} has ${unscheduledCount} unscheduled appointments that need attention.`
    : `There are ${unscheduledCount} unscheduled appointments that need attention.`;

  await Notification.create({
    adminUser: userId,
    type: "warning",
    priority: unscheduledCount > 10 ? "high" : "medium",
    title: "Unscheduled Appointments",
    message,
    metadata: {
      action: "unscheduled_appointments",
      resourceType: "appointment",
      count: unscheduledCount,
      details: {
        careReceiverName,
      },
    },
    actionRequired: true,
    actionUrl: "/schedule?tab=unscheduled",
    actionLabel: "Schedule Manually",
  });
};

/**
 * Create notification for manual appointment scheduled
 */
exports.notifyManualSchedule = async (userId, appointmentDetails) => {
  await Notification.create({
    adminUser: userId,
    type: "success",
    priority: "low",
    title: "Appointment Scheduled",
    message: `Successfully scheduled ${appointmentDetails.careReceiverName} with ${appointmentDetails.careGiverName} on ${appointmentDetails.date}.`,
    metadata: {
      action: "manual_schedule",
      resourceType: "appointment",
      resourceId: appointmentDetails.appointmentId,
      details: appointmentDetails,
    },
    actionRequired: false,
    actionUrl: `/schedule`,
    actionLabel: "View Calendar",
  });
};

/**
 * Create notification for care giver availability changes
 */
exports.notifyCareGiverAvailabilityChanged = async (
  userId,
  careGiverName,
  affectedAppointments = 0
) => {
  let message = `${careGiverName}'s availability has been updated.`;

  if (affectedAppointments > 0) {
    message += ` This may affect ${affectedAppointments} existing appointments.`;
  }

  await Notification.create({
    adminUser: userId,
    type: affectedAppointments > 0 ? "warning" : "info",
    priority: affectedAppointments > 0 ? "high" : "low",
    title: "Care Giver Availability Updated",
    message,
    metadata: {
      action: "availability_changed",
      resourceType: "caregiver",
      count: affectedAppointments,
      details: {
        careGiverName,
      },
    },
    actionRequired: affectedAppointments > 0,
    actionUrl: affectedAppointments > 0 ? "/schedule" : "/caregivers",
    actionLabel:
      affectedAppointments > 0 ? "Review Schedule" : "View Care Givers",
  });
};

/**
 * Create notification for upcoming appointments
 */
exports.notifyUpcomingAppointments = async (userId, appointmentsToday) => {
  await Notification.create({
    adminUser: userId,
    type: "info",
    priority: "medium",
    title: "Today's Schedule",
    message: `You have ${appointmentsToday} appointments scheduled for today.`,
    metadata: {
      action: "daily_schedule",
      resourceType: "appointment",
      count: appointmentsToday,
    },
    actionRequired: false,
    actionUrl: "/schedule",
    actionLabel: "View Schedule",
  });
};

/**
 * Create notification for missed appointments
 */
exports.notifyMissedAppointment = async (userId, appointmentDetails) => {
  await Notification.create({
    adminUser: userId,
    type: "error",
    priority: "critical",
    title: "Missed Appointment",
    message: `Appointment with ${appointmentDetails.careReceiverName} was missed on ${appointmentDetails.date} at ${appointmentDetails.time}.`,
    metadata: {
      action: "missed_appointment",
      resourceType: "appointment",
      resourceId: appointmentDetails.appointmentId,
      details: appointmentDetails,
    },
    actionRequired: true,
    actionUrl: `/schedule`,
    actionLabel: "Reschedule",
  });
};

/**
 * Create notification for care receiver added
 */
exports.notifyCareReceiverAdded = async (
  userId,
  careReceiverName,
  dailyVisitsCount
) => {
  await Notification.create({
    adminUser: userId,
    type: "success",
    priority: "low",
    title: "New Care Receiver Added",
    message: `${careReceiverName} has been added with ${dailyVisitsCount} daily visit(s). Schedule appointments to get started.`,
    metadata: {
      action: "care_receiver_added",
      resourceType: "carereceiver",
      details: {
        careReceiverName,
        dailyVisitsCount,
      },
    },
    actionRequired: true,
    actionUrl: "/schedule/generate",
    actionLabel: "Generate Schedule",
  });
};

/**
 * Create notification when recurring visits are added/updated (auto-scheduling in progress)
 */
exports.notifyRecurringVisitsAdded = async (userId, careReceiverName) => {
  await Notification.create({
    adminUser: userId,
    type: "info",
    priority: "medium",
    title: "Recurring Visits Updated",
    message: `Recurring visits added for ${careReceiverName}. Auto-scheduling in progress.`,
    metadata: {
      action: "recurring_visits_added",
      resourceType: "carereceiver",
      details: {
        careReceiverName,
      },
    },
    actionRequired: false,
    actionUrl: "/carereceivers",
    actionLabel: "View Care Receivers",
  });
};

/**
 * Create notification when schedule generation completes for a single care receiver
 * Includes careReceiverId in metadata so frontend can match and show counts toast.
 */
exports.notifyScheduleGeneratedForCareReceiver = async (
  userId,
  careReceiverId,
  careReceiverName,
  scheduledCount,
  failedCount
) => {
  let type = "success";
  let priority = "medium";
  let title = "Schedule Generated";
  let message = `Schedule generated for ${careReceiverName}: ${scheduledCount} appointments assigned.`;

  if (failedCount > 0) {
    type = "warning";
    priority = "high";
    title = "Schedule Generated with Gaps";
    message = `Schedule generated for ${careReceiverName}: ${scheduledCount} appointments assigned, ${failedCount} could not be assigned.`;
  }

  const isTotalFailure = scheduledCount === 0 && failedCount > 0;
  if (isTotalFailure) {
    type = "error";
    priority = "critical";
    title = "Schedule Generation Failed";
    message = `Failed to assign appointments for ${careReceiverName}. ${failedCount} need attention.`;
  }

  await Notification.create({
    adminUser: userId,
    type,
    priority,
    title,
    message,
    metadata: {
      action: isTotalFailure ? "schedule_generation_failed" : "schedule_generated",
      resourceType: "schedule",
      resourceId: careReceiverId,
      count: scheduledCount,
      details: {
        careReceiverId: careReceiverId?.toString?.() || careReceiverId,
        scheduled: scheduledCount,
        failed: failedCount,
      },
    },
    actionRequired: failedCount > 0,
    actionUrl: failedCount > 0 ? "/schedule?tab=unscheduled" : "/schedule",
    actionLabel: failedCount > 0 ? "View Unscheduled" : "View Schedule",
  });
};

/**
 * Create notification when auto-scheduling fails for a care receiver
 */
exports.notifyScheduleGenerationFailed = async (
  userId,
  careReceiverId,
  careReceiverName,
  errorMessage
) => {
  const userMessage = `Auto-scheduling failed for ${careReceiverName}. ` +
    `Please try again or use manual scheduling to assign care givers.`;

  await Notification.create({
    adminUser: userId,
    type: "error",
    priority: "critical",
    title: "Auto-Scheduling Failed",
    message: userMessage,
    metadata: {
      action: "schedule_generation_failed",
      resourceType: "carereceiver",
      resourceId: careReceiverId,
      details: {
        careReceiverId: careReceiverId?.toString?.() || careReceiverId,
        careReceiverName,
        errorMessage, // raw error preserved for debugging
      },
    },
    actionRequired: true,
    actionUrl: "/schedule",
    actionLabel: "View Schedule",
  });
};

/**
 * Create notification for care giver added
 */
exports.notifyCareGiverAdded = async (userId, careGiverName, skillsCount) => {
  await Notification.create({
    adminUser: userId,
    type: "success",
    priority: "low",
    title: "New Care Giver Added",
    message: `${careGiverName} has been added with ${skillsCount} skill(s) and is now available for scheduling.`,
    metadata: {
      action: "care_giver_added",
      resourceType: "caregiver",
      details: {
        careGiverName,
        skillsCount,
      },
    },
    actionRequired: false,
    actionUrl: "/caregivers",
    actionLabel: "View Care Givers",
  });
};

/**
 * Create notification for scheduling conflicts
 */
exports.notifySchedulingConflict = async (userId, conflictDetails) => {
  const userMessage = conflictDetails.userMessage ||
    `A scheduling conflict was detected. Please review the affected appointments.`;

  await Notification.create({
    adminUser: userId,
    type: "warning",
    priority: "high",
    title: "Scheduling Conflict Detected",
    message: userMessage,
    metadata: {
      action: "scheduling_conflict",
      resourceType: "appointment",
      details: conflictDetails, // raw details preserved for debugging
    },
    actionRequired: true,
    actionUrl: "/schedule",
    actionLabel: "Resolve Conflict",
  });
};

/**
 * Create system notification
 */
exports.notifySystem = async (
  userId,
  { type, priority, title, message, actionUrl, actionLabel }
) => {
  await Notification.create({
    adminUser: userId,
    type: type || "info",
    priority: priority || "medium",
    title,
    message,
    metadata: {
      action: "system_notification",
      resourceType: "system",
    },
    actionRequired: !!actionUrl,
    actionUrl,
    actionLabel,
  });
};

/**
 * Bulk create notifications for multiple users
 */
exports.notifyMultipleUsers = async (userIds, notificationData) => {
  const notifications = userIds.map((userId) => ({
    adminUser: userId,
    ...notificationData,
  }));

  await Notification.insertMany(notifications);
};

module.exports = exports;
