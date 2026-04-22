const Appointment = require("../models/Appointment");
const settingsService = require("./settingsService");
const { calculateDistance, findBestCareGiver } = require("./schedulingService");
const logger = require("../utils/logger");

/**
 * Revalidate all future scheduled appointments for a care receiver
 * after their profile changed. Marks invalid ones as needs_reassignment.
 */
async function revalidateAppointmentsForCareReceiver(careReceiverId, changedFields, updatedCareReceiver) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  const appointments = await Appointment.find({
    careReceiver: careReceiverId,
    status: { $in: ["scheduled"] },
    date: { $gte: now },
  }).populate("careGiver", "coordinates gender skills singleHandedOnly name")
    .populate("secondaryCareGiver", "coordinates gender skills singleHandedOnly name");

  if (appointments.length === 0) {
    return { invalidatedCount: 0, reasons: [] };
  }

  const settings = await settingsService.getSchedulingSettings();
  const maxDistanceKm = settings.maxDistanceKm || 20;

  // Build a visit lookup from the updated care receiver
  const visitByNumber = new Map();
  for (const visit of updatedCareReceiver.dailyVisits || []) {
    visitByNumber.set(visit.visitNumber, visit);
  }

  const invalidated = [];
  const reasons = [];

  for (const apt of appointments) {
    const reason = checkAppointmentValidity(apt, updatedCareReceiver, changedFields, maxDistanceKm, visitByNumber);
    if (reason) {
      invalidated.push({ _id: apt._id, reason, visitNumber: apt.visitNumber });
      reasons.push(reason);
    }
  }

  if (invalidated.length > 0) {
    const bulkOps = invalidated.map((item) => {
      const updateFields = {
        status: "needs_reassignment",
        invalidationReason: item.reason,
        invalidatedAt: new Date(),
      };

      // Sync requirements/doubleHanded from updated visit definition
      const visit = visitByNumber.get(item.visitNumber);
      if (visit) {
        if (visit.requirements) updateFields.requirements = visit.requirements;
        if (visit.doubleHanded !== undefined) updateFields.doubleHanded = visit.doubleHanded;
      }

      return {
        updateOne: {
          filter: { _id: item._id },
          update: { $set: updateFields },
        },
      };
    });

    await Appointment.bulkWrite(bulkOps);

    logger.info("Appointments invalidated after care receiver update", {
      careReceiverId,
      changedFields,
      invalidatedCount: invalidated.length,
    });
  }

  return { invalidatedCount: invalidated.length, reasons };
}

/**
 * Check if a single appointment is still valid after care receiver profile changed.
 * Returns a reason string if invalid, or null if still valid.
 */
function checkAppointmentValidity(appointment, careReceiver, changedFields, maxDistanceKm, visitByNumber) {
  const careGiver = appointment.careGiver;
  if (!careGiver) return "Care giver not found";

  // Address/distance check
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
        return `Care receiver moved ${distance.toFixed(1)}km from care giver (max: ${maxDistanceKm}km)`;
      }
    }

    // Also check secondary caregiver distance
    const secondaryCG = appointment.secondaryCareGiver;
    if (secondaryCG && careReceiver.coordinates?.coordinates && secondaryCG.coordinates?.coordinates) {
      const dist2 = calculateDistance(
        careReceiver.coordinates.coordinates,
        secondaryCG.coordinates.coordinates
      );
      if (dist2 > maxDistanceKm) {
        return `Care receiver moved ${dist2.toFixed(1)}km from secondary care giver (max: ${maxDistanceKm}km)`;
      }
    }
  }

  // Gender preference check
  if (changedFields.includes("genderPreference")) {
    if (
      careReceiver.genderPreference &&
      careReceiver.genderPreference !== "No Preference" &&
      careGiver.gender !== careReceiver.genderPreference
    ) {
      return `Care giver gender (${careGiver.gender}) does not match new preference (${careReceiver.genderPreference})`;
    }

    // Also check secondary
    const secondaryCG = appointment.secondaryCareGiver;
    if (
      secondaryCG &&
      careReceiver.genderPreference &&
      careReceiver.genderPreference !== "No Preference" &&
      secondaryCG.gender !== careReceiver.genderPreference
    ) {
      return `Secondary care giver gender (${secondaryCG.gender}) does not match new preference (${careReceiver.genderPreference})`;
    }
  }

  // Requirements check (per-visit)
  if (changedFields.includes("requirements")) {
    const visit = visitByNumber.get(appointment.visitNumber);
    if (visit) {
      const newRequirements = visit.requirements || [];
      const missing = newRequirements.filter((r) => !careGiver.skills.includes(r));
      if (missing.length > 0) {
        return `Care giver missing newly required skill(s): ${missing.join(", ")}`;
      }

      // Check secondary too
      const secondaryCG = appointment.secondaryCareGiver;
      if (secondaryCG) {
        const missing2 = newRequirements.filter((r) => !secondaryCG.skills.includes(r));
        if (missing2.length > 0) {
          return `Secondary care giver missing newly required skill(s): ${missing2.join(", ")}`;
        }
      }
    }
  }

  // Double-handed check (per-visit)
  if (changedFields.includes("doubleHanded")) {
    const visit = visitByNumber.get(appointment.visitNumber);
    if (visit && visit.doubleHanded && careGiver.singleHandedOnly) {
      return "Visit now requires double-handed care but care giver is single-handed only";
    }

    const secondaryCG = appointment.secondaryCareGiver;
    if (visit && visit.doubleHanded && secondaryCG && secondaryCG.singleHandedOnly) {
      return "Visit now requires double-handed care but secondary care giver is single-handed only";
    }
  }

  return null;
}

/**
 * Try to auto-reassign invalidated appointments for a care receiver.
 */
async function autoReassignInvalidatedAppointments(careReceiverId) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  const appointments = await Appointment.find({
    careReceiver: careReceiverId,
    status: "needs_reassignment",
    date: { $gte: now },
  })
    .populate("careReceiver", "coordinates dailyVisits genderPreference name preferredCareGiver gender")
    .sort({ date: 1 });

  if (appointments.length === 0) {
    return { reassignedCount: 0, failedCount: 0 };
  }

  let reassignedCount = 0;
  let failedCount = 0;

  for (const apt of appointments) {
    const careReceiver = apt.careReceiver;
    if (!careReceiver) {
      failedCount++;
      continue;
    }

    // Reconstruct visit object for findBestCareGiver
    const visit = {
      visitNumber: apt.visitNumber,
      requirements: apt.requirements || [],
      doubleHanded: apt.doubleHanded || false,
      preferredTime: apt.startTime,
      duration: apt.duration,
    };

    try {
      const result = await findBestCareGiver(careReceiver, visit, apt.date);
      if (result && result.careGiver) {
        await Appointment.updateOne(
          { _id: apt._id },
          {
            $set: {
              status: "scheduled",
              careGiver: result.careGiver._id,
              invalidationReason: null,
              invalidatedAt: null,
            },
          }
        );
        reassignedCount++;
      } else {
        failedCount++;
      }
    } catch (err) {
      logger.warn("Auto-reassign failed for appointment", {
        appointmentId: apt._id,
        error: err.message,
      });
      failedCount++;
    }
  }

  if (reassignedCount > 0) {
    logger.info("Auto-reassigned appointments after care receiver update", {
      careReceiverId,
      reassignedCount,
      failedCount,
    });
  }

  return { reassignedCount, failedCount };
}

module.exports = {
  revalidateAppointmentsForCareReceiver,
  autoReassignInvalidatedAppointments,
};
