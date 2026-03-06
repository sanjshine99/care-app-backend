const CareGiver = require("../models/CareGiver");
const CareReceiver = require("../models/CareReceiver");
const Appointment = require("../models/Appointment");
const settingsService = require("./settingsService");
const { isCareGiverAvailable, calculateDistance } = require("./schedulingService");
const logger = require("../utils/logger");
const { todayUTC } = require("../utils/dateUtils");

/**
 * Revalidate all future scheduled appointments for a caregiver
 * after their profile changed. Marks invalid ones as needs_reassignment.
 */
async function revalidateExistingAppointments(careGiverId, changedFields) {
  const now = todayUTC();

  const appointments = await Appointment.find({
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    status: { $in: ["scheduled"] },
    date: { $gte: now },
  }).populate("careReceiver", "coordinates dailyVisits genderPreference name");

  if (appointments.length === 0) {
    return { invalidatedCount: 0, reasons: [] };
  }

  const careGiver = await CareGiver.findById(careGiverId);
  const settings = await settingsService.getSchedulingSettings();
  const maxDistanceKm = settings.maxDistanceKm || 20;

  const invalidated = [];
  const reasons = [];

  for (const apt of appointments) {
    const reason = await checkAppointmentValidity(apt, careGiver, changedFields, maxDistanceKm);
    if (reason) {
      invalidated.push({ _id: apt._id, reason });
      reasons.push(reason);
    }
  }

  if (invalidated.length > 0) {
    await Appointment.bulkWrite(
      invalidated.map((item) => ({
        updateOne: {
          filter: { _id: item._id },
          update: {
            $set: {
              status: "needs_reassignment",
              invalidationReason: item.reason,
              invalidatedAt: new Date(),
            },
          },
        },
      }))
    );

    logger.info("Appointments invalidated after caregiver update", {
      careGiverId,
      changedFields,
      invalidatedCount: invalidated.length,
    });
  }

  return { invalidatedCount: invalidated.length, reasons };
}

/**
 * Check if a single appointment is still valid for the updated caregiver.
 * Returns a reason string if invalid, or null if still valid.
 */
async function checkAppointmentValidity(appointment, careGiver, changedFields, maxDistanceKm) {
  const careReceiver = appointment.careReceiver;
  if (!careReceiver) return "Care receiver not found";

  // Skills check
  if (changedFields.includes("skills")) {
    const required = appointment.requirements || [];
    const missing = required.filter((r) => !careGiver.skills.includes(r));
    if (missing.length > 0) {
      return `Caregiver no longer has required skill(s): ${missing.join(", ")}`;
    }
  }

  // Distance check
  if (changedFields.includes("address")) {
    if (
      careReceiver.coordinates?.coordinates &&
      careGiver.coordinates?.coordinates
    ) {
      const distance = calculateDistance(
        careReceiver.coordinates.coordinates,
        careGiver.coordinates.coordinates
      );
      if (distance > maxDistanceKm) {
        return `Caregiver is now ${distance.toFixed(1)}km away (max: ${maxDistanceKm}km)`;
      }
    }
  }

  // Single-handed check for double-handed appointments
  if (changedFields.includes("singleHandedOnly")) {
    if (careGiver.singleHandedOnly && appointment.doubleHanded) {
      return "Caregiver is now single-handed only but appointment requires double-handed care";
    }
  }

  // Gender check
  if (changedFields.includes("gender")) {
    if (
      careReceiver.genderPreference &&
      careReceiver.genderPreference !== "No Preference" &&
      careReceiver.genderPreference !== "no_preference" &&
      careGiver.gender !== careReceiver.genderPreference
    ) {
      return "Care giver gender no longer matches care receiver preference";
    }
  }

  // Availability schedule check
  if (changedFields.includes("availability")) {
    try {
      const availCheck = await isCareGiverAvailable(
        careGiver._id,
        appointment.date,
        appointment.startTime,
        appointment.endTime,
        careReceiver.coordinates?.coordinates
      );
      if (!availCheck.available) {
        return `Care giver no longer available: ${availCheck.reason || "schedule changed"}`;
      }
    } catch (err) {
      logger.warn("Availability check failed during revalidation", { error: err.message });
    }
  }

  return null;
}

/**
 * Try to auto-assign unscheduled/needs_reassignment appointments
 * to the updated caregiver.
 */
async function autoAssignFromUnscheduled(careGiverId) {
  const now = todayUTC();

  const careGiver = await CareGiver.findById(careGiverId);
  if (!careGiver || !careGiver.isActive) {
    return { assignedCount: 0 };
  }

  const settings = await settingsService.getSchedulingSettings();
  const maxDistanceKm = settings.maxDistanceKm || 20;

  // Find needs_reassignment appointments (not already assigned to this caregiver)
  const candidates = await Appointment.find({
    status: "needs_reassignment",
    date: { $gte: now },
    careGiver: { $ne: careGiverId },
  })
    .populate("careReceiver", "coordinates dailyVisits genderPreference name preferredCareGiver")
    .limit(50)
    .sort({ date: 1 });

  if (candidates.length === 0) {
    return { assignedCount: 0 };
  }

  const assigned = [];

  for (const apt of candidates) {
    const careReceiver = apt.careReceiver;
    if (!careReceiver) continue;

    // Quick pre-checks before expensive availability call

    // Skills match
    const required = apt.requirements || [];
    if (!required.every((r) => careGiver.skills.includes(r))) continue;

    // Gender preference — compare caregiver's gender against care receiver's preference
    if (
      careReceiver.genderPreference &&
      careReceiver.genderPreference !== "No Preference" &&
      careReceiver.genderPreference !== "no_preference" &&
      careGiver.gender !== careReceiver.genderPreference
    ) continue;

    // Double-handed check
    if (apt.doubleHanded && careGiver.singleHandedOnly) continue;

    // Distance check
    if (
      careReceiver.coordinates?.coordinates &&
      careGiver.coordinates?.coordinates
    ) {
      const distance = calculateDistance(
        careReceiver.coordinates.coordinates,
        careGiver.coordinates.coordinates
      );
      if (distance > maxDistanceKm) continue;
    } else {
      continue;
    }

    // Full availability check (time conflicts, travel time, etc.)
    const availCheck = await isCareGiverAvailable(
      careGiverId,
      apt.date,
      apt.startTime,
      apt.endTime,
      careReceiver.coordinates.coordinates
    );

    if (availCheck.available) {
      assigned.push(apt._id);
    }
  }

  if (assigned.length > 0) {
    await Appointment.updateMany(
      { _id: { $in: assigned } },
      {
        $set: {
          status: "scheduled",
          careGiver: careGiverId,
          invalidationReason: null,
          invalidatedAt: null,
        },
      }
    );

    logger.info("Auto-assigned unscheduled appointments to updated caregiver", {
      careGiverId,
      assignedCount: assigned.length,
    });
  }

  return { assignedCount: assigned.length };
}

module.exports = {
  revalidateExistingAppointments,
  autoAssignFromUnscheduled,
};
