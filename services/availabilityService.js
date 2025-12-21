// backend/services/availabilityService.js
// UPDATED - Uses Availability Collection instead of embedded

const Availability = require("../models/Availability");
const CareGiver = require("../models/CareGiver");

/**
 * Check if a care giver is available at a specific date and time
 * @param {string} careGiverId - Care giver MongoDB ID
 * @param {Date} appointmentDate - Date of appointment
 * @param {string} startTime - Start time in HH:MM format
 * @param {string} endTime - End time in HH:MM format
 * @returns {Object} { available: boolean, reason: string }
 */
exports.isAvailable = async (
  careGiverId,
  appointmentDate,
  startTime,
  endTime
) => {
  const careGiver = await CareGiver.findById(careGiverId);

  if (!careGiver) {
    return { available: false, reason: "Care giver not found" };
  }

  if (!careGiver.isActive) {
    return { available: false, reason: "Care giver is inactive" };
  }

  // Get current availability from Availability collection
  const availability = await Availability.getCurrentForCareGiver(
    careGiverId,
    appointmentDate
  );

  if (!availability) {
    return { available: false, reason: "No availability schedule found" };
  }

  // Check if on time off
  if (availability.isOnTimeOff(appointmentDate)) {
    return { available: false, reason: "Care giver is on time off" };
  }

  // Get day of week
  const dayOfWeek = appointmentDate.toLocaleDateString("en-GB", {
    weekday: "long",
  });

  // Check if working on this day
  const daySchedule = availability.schedule.find(
    (s) => s.dayOfWeek === dayOfWeek
  );

  if (!daySchedule || daySchedule.slots.length === 0) {
    return { available: false, reason: `Not working on ${dayOfWeek}` };
  }

  // Check if time slot falls within working hours
  const isInWorkingHours = daySchedule.slots.some((slot) => {
    return startTime >= slot.startTime && endTime <= slot.endTime;
  });

  if (!isInWorkingHours) {
    return { available: false, reason: "Outside working hours" };
  }

  return { available: true, reason: "Available" };
};

/**
 * Find all care givers available at a specific date and time
 * @param {Date} appointmentDate - Date of appointment
 * @param {string} startTime - Start time in HH:MM format
 * @param {string} endTime - End time in HH:MM format
 * @param {Object} filters - Additional filters (skills, location, etc.)
 * @returns {Array} Array of available care givers
 */
exports.findAvailableCareGivers = async (
  appointmentDate,
  startTime,
  endTime,
  filters = {}
) => {
  const dayOfWeek = appointmentDate.toLocaleDateString("en-GB", {
    weekday: "long",
  });

  // Build care giver query
  const cgQuery = { isActive: true };

  // Add skill filter if provided
  if (filters.skills && filters.skills.length > 0) {
    cgQuery.skills = { $all: filters.skills };
  }

  // Add location filter if provided (within X km)
  if (filters.coordinates && filters.maxDistance) {
    cgQuery.coordinates = {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: filters.coordinates,
        },
        $maxDistance: filters.maxDistance * 1000, // Convert km to meters
      },
    };
  }

  // Get potential care givers based on basic filters
  const careGivers = await CareGiver.find(cgQuery);

  if (careGivers.length === 0) {
    return [];
  }

  const careGiverIds = careGivers.map((cg) => cg._id);

  // Get current availability for these care givers
  const availabilities = await Availability.find({
    careGiver: { $in: careGiverIds },
    effectiveFrom: { $lte: appointmentDate },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: appointmentDate } }],
    isActive: true,
    "schedule.dayOfWeek": dayOfWeek,
  });

  // Filter by exact time availability and time off
  const availableCareGivers = [];

  for (const availability of availabilities) {
    // Check time off
    if (availability.isOnTimeOff(appointmentDate)) {
      continue;
    }

    // Check if time slot is within working hours
    const daySchedule = availability.schedule.find(
      (s) => s.dayOfWeek === dayOfWeek
    );
    if (!daySchedule) continue;

    const isAvailable = daySchedule.slots.some((slot) => {
      return startTime >= slot.startTime && endTime <= slot.endTime;
    });

    if (isAvailable) {
      // Get full care giver object
      const careGiver = careGivers.find((cg) =>
        cg._id.equals(availability.careGiver)
      );
      if (careGiver) {
        availableCareGivers.push(careGiver);
      }
    }
  }

  return availableCareGivers;
};

/**
 * Check if a care giver has conflicts with existing appointments
 * @param {string} careGiverId - Care giver MongoDB ID
 * @param {Date} appointmentDate - Date of appointment
 * @param {string} startTime - Start time in HH:MM format
 * @param {string} endTime - End time in HH:MM format
 * @returns {Object} { hasConflict: boolean, conflictingAppointment: object }
 */
exports.checkAppointmentConflict = async (
  careGiverId,
  appointmentDate,
  startTime,
  endTime
) => {
  const Appointment = require("../models/Appointment");

  // Create date range for the full day
  const startOfDay = new Date(appointmentDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(appointmentDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Find appointments for this care giver on this date
  const existingAppointments = await Appointment.find({
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
    status: { $in: ["scheduled", "in_progress"] },
  });

  // Check for time conflicts
  for (const apt of existingAppointments) {
    // Check if times overlap
    if (
      (startTime >= apt.startTime && startTime < apt.endTime) ||
      (endTime > apt.startTime && endTime <= apt.endTime) ||
      (startTime <= apt.startTime && endTime >= apt.endTime)
    ) {
      return {
        hasConflict: true,
        conflictingAppointment: apt,
      };
    }
  }

  return { hasConflict: false, conflictingAppointment: null };
};

/**
 * Get care giver's available hours for a specific date
 * @param {string} careGiverId - Care giver MongoDB ID
 * @param {Date} date - Date to check
 * @returns {Array} Array of available time slots
 */
exports.getAvailableSlots = async (careGiverId, date) => {
  const careGiver = await CareGiver.findById(careGiverId);

  if (!careGiver || !careGiver.isActive) {
    return [];
  }

  // Get current availability
  const availability = await Availability.getCurrentForCareGiver(
    careGiverId,
    date
  );

  if (!availability) {
    return [];
  }

  // Check time off
  if (availability.isOnTimeOff(date)) {
    return [];
  }

  const dayOfWeek = date.toLocaleDateString("en-GB", { weekday: "long" });
  const daySchedule = availability.schedule.find(
    (s) => s.dayOfWeek === dayOfWeek
  );

  if (!daySchedule) {
    return [];
  }

  // Get existing appointments for this day
  const Appointment = require("../models/Appointment");

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const appointments = await Appointment.find({
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
    status: { $in: ["scheduled", "in_progress"] },
  }).sort({ startTime: 1 });

  // Calculate available slots by subtracting appointments from working hours
  const availableSlots = [];

  for (const slot of daySchedule.slots) {
    let currentTime = slot.startTime;

    // For each appointment, add the gap before it as available
    for (const apt of appointments) {
      if (apt.startTime > currentTime) {
        availableSlots.push({
          startTime: currentTime,
          endTime: apt.startTime,
        });
      }
      currentTime = apt.endTime > currentTime ? apt.endTime : currentTime;
    }

    // Add remaining time after last appointment
    if (currentTime < slot.endTime) {
      availableSlots.push({
        startTime: currentTime,
        endTime: slot.endTime,
      });
    }
  }

  return availableSlots;
};

/**
 * Calculate total available hours for a care giver in a date range
 * @param {string} careGiverId - Care giver MongoDB ID
 * @param {Date} startDate - Start of date range
 * @param {Date} endDate - End of date range
 * @returns {number} Total available hours
 */
exports.calculateAvailableHours = async (careGiverId, startDate, endDate) => {
  const careGiver = await CareGiver.findById(careGiverId);

  if (!careGiver || !careGiver.isActive) {
    return 0;
  }

  let totalHours = 0;
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    // Get availability for this date
    const availability = await Availability.getCurrentForCareGiver(
      careGiverId,
      currentDate
    );

    if (availability && !availability.isOnTimeOff(currentDate)) {
      const dayOfWeek = currentDate.toLocaleDateString("en-GB", {
        weekday: "long",
      });
      const daySchedule = availability.schedule.find(
        (s) => s.dayOfWeek === dayOfWeek
      );

      if (daySchedule) {
        for (const slot of daySchedule.slots) {
          const [startHours, startMinutes] = slot.startTime
            .split(":")
            .map(Number);
          const [endHours, endMinutes] = slot.endTime.split(":").map(Number);

          const hours =
            (endHours * 60 + endMinutes - startHours * 60 - startMinutes) / 60;
          totalHours += hours;
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return totalHours;
};

/**
 * Get care giver's workload for a specific week
 * @param {string} careGiverId - Care giver MongoDB ID
 * @param {Date} weekStartDate - Start of week (Monday)
 * @returns {Object} Workload statistics
 */
exports.getWeeklyWorkload = async (careGiverId, weekStartDate) => {
  const Appointment = require("../models/Appointment");

  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  // Get scheduled appointments for the week
  const appointments = await Appointment.find({
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: {
      $gte: weekStartDate,
      $lte: weekEndDate,
    },
    status: { $in: ["scheduled", "in_progress"] },
  });

  // Calculate statistics
  let totalScheduledHours = 0;
  let appointmentCount = appointments.length;

  for (const apt of appointments) {
    const [startHours, startMinutes] = apt.startTime.split(":").map(Number);
    const [endHours, endMinutes] = apt.endTime.split(":").map(Number);
    const hours =
      (endHours * 60 + endMinutes - startHours * 60 - startMinutes) / 60;
    totalScheduledHours += hours;
  }

  // Get total available hours for the week
  const totalAvailableHours = await exports.calculateAvailableHours(
    careGiverId,
    weekStartDate,
    weekEndDate
  );

  return {
    totalAvailableHours,
    totalScheduledHours,
    remainingHours: totalAvailableHours - totalScheduledHours,
    appointmentCount,
    utilizationRate:
      totalAvailableHours > 0
        ? ((totalScheduledHours / totalAvailableHours) * 100).toFixed(1)
        : 0,
  };
};

/**
 * Get current availability for a care giver (convenience wrapper)
 * @param {string} careGiverId - Care giver MongoDB ID
 * @param {Date} date - Date to check (default: today)
 * @returns {Object} Availability document or null
 */
exports.getCurrentAvailability = async (careGiverId, date = new Date()) => {
  return await Availability.getCurrentForCareGiver(careGiverId, date);
};

/**
 * Get availability history for a care giver
 * @param {string} careGiverId - Care giver MongoDB ID
 * @returns {Array} Array of availability documents
 */
exports.getAvailabilityHistory = async (careGiverId) => {
  return await Availability.getHistory(careGiverId);
};

module.exports = exports;
