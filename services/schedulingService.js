// backend/services/schedulingService.js
// Uses scheduling/ services: TravelCalculator, VisitService, CaregiverService, AppointmentService

const Availability = require("../models/Availability");
const CareGiver = require("../models/CareGiver");
const CareReceiver = require("../models/CareReceiver");
const Appointment = require("../models/Appointment");
const settingsService = require("./settingsService");
const { normalizeTimeToHHMM } = require("../utils/timeUtils");
const TravelCalculator = require("./scheduling/TravelCalculator");
const VisitService = require("./scheduling/VisitService");
const CaregiverService = require("./scheduling/CaregiverService");
const AppointmentService = require("./scheduling/AppointmentService");

const calculateTravelTime = TravelCalculator.calculateTravelTime.bind(TravelCalculator);
const calculateDistance = TravelCalculator.calculateDistance.bind(TravelCalculator);

const isDateInSchedule = VisitService.isDateInSchedule.bind(VisitService);

/**
 * Check if care giver is available
 */
async function isCareGiverAvailable(
  careGiverId,
  date,
  startTime,
  endTime,
  careReceiverLocation,
  excludeAppointmentId = null,
) {
  const result = {
    available: false,
    reason: "",
    conflicts: [],
  };

  const settings = await settingsService.getSchedulingSettings();
  const travelTimeBuffer = settings.travelTimeBufferMinutes || 15;

  const careGiver = await CareGiver.findById(careGiverId);
  if (!careGiver || !careGiver.isActive) {
    result.reason = careGiver
      ? "Care giver is inactive"
      : "Care giver not found";
    return result;
  }

  // Check time off with UTC comparison
  if (careGiver.timeOff && careGiver.timeOff.length > 0) {
    const checkDate = new Date(date);
    const utcCheckDate = Date.UTC(
      checkDate.getUTCFullYear(),
      checkDate.getUTCMonth(),
      checkDate.getUTCDate(),
    );

    for (const timeOff of careGiver.timeOff) {
      const timeOffStartDate = new Date(timeOff.startDate);
      const utcStart = Date.UTC(
        timeOffStartDate.getUTCFullYear(),
        timeOffStartDate.getUTCMonth(),
        timeOffStartDate.getUTCDate(),
      );

      const timeOffEndDate = new Date(timeOff.endDate);
      const utcEnd = Date.UTC(
        timeOffEndDate.getUTCFullYear(),
        timeOffEndDate.getUTCMonth(),
        timeOffEndDate.getUTCDate(),
        23,
        59,
        59,
        999,
      );

      const isInRange = utcCheckDate >= utcStart && utcCheckDate <= utcEnd;

      if (isInRange) {
        result.reason = `Care giver is on time off (${timeOff.reason || "Personal"})`;
        return result;
      }
    }
  }

  // Get availability
  let availability = await Availability.getCurrentForCareGiver(
    careGiverId,
    date,
  );

  if (
    !availability ||
    !availability.schedule ||
    availability.schedule.length === 0
  ) {
    if (careGiver.availability && careGiver.availability.length > 0) {
      // Use UTC day of week
      const utcDay = date.getUTCDay();
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dayOfWeek = dayNames[utcDay];

      const daySchedule = careGiver.availability.find(
        (a) => a.dayOfWeek === dayOfWeek,
      );

      if (!daySchedule || daySchedule.slots.length === 0) {
        result.reason = `Not working on ${dayOfWeek}`;
        return result;
      }

      const isInWorkingHours = daySchedule.slots.some(
        (slot) => startTime >= slot.startTime && endTime <= slot.endTime,
      );

      if (!isInWorkingHours) {
        result.reason = "Outside working hours";
        return result;
      }
    } else {
      result.reason = "No availability schedule defined";
      return result;
    }
  } else {
    // Use UTC day of week
    const utcDay = date.getUTCDay();
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayOfWeek = dayNames[utcDay];

    const daySchedule = availability.schedule.find(
      (s) => s.dayOfWeek === dayOfWeek,
    );

    if (!daySchedule || daySchedule.slots.length === 0) {
      result.reason = `Not working on ${dayOfWeek}`;
      return result;
    }

    const isInWorkingHours = daySchedule.slots.some(
      (slot) => startTime >= slot.startTime && endTime <= slot.endTime,
    );

    if (!isInWorkingHours) {
      result.reason = "Outside working hours";
      return result;
    }
  }

  // Check appointment conflicts
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const query = {
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ["scheduled", "in_progress"] },
  };

  if (excludeAppointmentId) {
    query._id = { $ne: excludeAppointmentId };
  }

  const existingAppointments = await Appointment.find(query)
    .populate("careReceiver", "name coordinates")
    .sort({ startTime: 1 });

  const maxAppointmentsPerDay = CaregiverService.getMaxAppointmentsPerDay(careGiver, settings);
  if (existingAppointments.length >= maxAppointmentsPerDay) {
    result.reason = `Already has ${existingAppointments.length} appointments (max ${maxAppointmentsPerDay})`;
    return result;
  }

  // Check time overlaps
  for (const apt of existingAppointments) {
    if (
      (startTime >= apt.startTime && startTime < apt.endTime) ||
      (endTime > apt.startTime && endTime <= apt.endTime) ||
      (startTime <= apt.startTime && endTime >= apt.endTime)
    ) {
      result.reason = "Time slot conflicts with existing appointment";
      result.conflicts.push({ type: "time_overlap", appointment: apt });
      return result;
    }
  }

  // Check travel time conflicts
  const appointmentsBefore = existingAppointments.filter(
    (apt) => apt.endTime <= startTime,
  );
  const appointmentsAfter = existingAppointments.filter(
    (apt) => apt.startTime >= endTime,
  );

  if (appointmentsBefore.length > 0) {
    const lastAppointment = appointmentsBefore[appointmentsBefore.length - 1];
    if (lastAppointment.careReceiver?.coordinates) {
      const travelTime = await calculateTravelTime(
        lastAppointment.careReceiver.coordinates.coordinates,
        careReceiverLocation,
      );

      const [lastHours, lastMinutes] = lastAppointment.endTime
        .split(":")
        .map(Number);
      const [newHours, newMinutes] = startTime.split(":").map(Number);
      const lastEndMinutes = lastHours * 60 + lastMinutes;
      const newStartMinutes = newHours * 60 + newMinutes;
      const gapMinutes = newStartMinutes - lastEndMinutes;
      const requiredGap = travelTime + travelTimeBuffer;

      if (gapMinutes < requiredGap) {
        result.reason = `Insufficient travel time from previous appointment (needs ${requiredGap} min, has ${gapMinutes} min)`;
        result.conflicts.push({
          type: "travel_time",
          appointment: lastAppointment,
          requiredGap,
          actualGap: gapMinutes,
        });
        return result;
      }
    }
  }

  if (appointmentsAfter.length > 0) {
    const nextAppointment = appointmentsAfter[0];
    if (nextAppointment.careReceiver?.coordinates) {
      const travelTime = await calculateTravelTime(
        careReceiverLocation,
        nextAppointment.careReceiver.coordinates.coordinates,
      );

      const [newHours, newMinutes] = endTime.split(":").map(Number);
      const [nextHours, nextMinutes] = nextAppointment.startTime
        .split(":")
        .map(Number);
      const newEndMinutes = newHours * 60 + newMinutes;
      const nextStartMinutes = nextHours * 60 + nextMinutes;
      const gapMinutes = nextStartMinutes - newEndMinutes;
      const requiredGap = travelTime + travelTimeBuffer;

      if (gapMinutes < requiredGap) {
        result.reason = `Insufficient travel time to next appointment (needs ${requiredGap} min, has ${gapMinutes} min)`;
        result.conflicts.push({
          type: "travel_time",
          appointment: nextAppointment,
          requiredGap,
          actualGap: gapMinutes,
        });
        return result;
      }
    }
  }

  result.available = true;
  result.reason = "Available";
  return result;
}

/**
 * Build a user-facing summary of why no care giver was available (counts per reason).
 * @param {string[]} reasons - List of reason strings from isCareGiverAvailable
 * @returns {string} e.g. "No care giver available: 2 not working on Saturday, 1 on time off (Personal)"
 */
function buildUnavailabilityReasonSummary(reasons) {
  if (!reasons || reasons.length === 0) {
    return "All care givers are unavailable or have conflicts";
  }
  const counts = {};
  for (const r of reasons) {
    counts[r] = (counts[r] || 0) + 1;
  }
  const maxReasonsToShow = 5;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const shown = entries.slice(0, maxReasonsToShow);
  const parts = shown.map(([reason, count]) => `${reason} (${count})`);
  const rest = entries.length - maxReasonsToShow;
  if (rest > 0) {
    parts.push(`${rest} other reason${rest !== 1 ? "s" : ""}`);
  }
  return `No care giver available: ${parts.join("; ")}`;
}

/**
 * Find best care giver for a visit
 */
async function findBestCareGiver(
  careReceiver,
  visit,
  date,
  excludeCareGiverId = null,
) {
  console.log(
    `\n[Find Best] Looking for care giver for Visit ${visit.visitNumber}`,
  );
  console.log(`[Find Best] Requirements: ${visit.requirements.join(", ")}`);

  if (excludeCareGiverId) {
    console.log(`[Find Best] Excluding care giver: ${excludeCareGiverId}`);
  }

  const settings = await settingsService.getSchedulingSettings();
  const maxDistanceKm = settings.maxDistanceKm || 20;
  const maxDistanceMeters = maxDistanceKm * 1000;

  const query = {
    isActive: true,
    skills: { $all: visit.requirements },
  };

  if (excludeCareGiverId) {
    query._id = { $ne: excludeCareGiverId };
  }

  if (careReceiver.genderPreference !== "No Preference") {
    query.gender = careReceiver.genderPreference;
  }

  // For double-handed visits, only use care givers who can work in pairs
  // (singleHandedOnly = false means they CAN do double-handed care)
  if (visit.doubleHanded) {
    query.singleHandedOnly = false;
  }
  // For non-double-handed visits, all care givers are eligible (including singleHandedOnly=true)

  // Guard: care receiver must have valid coordinates for $near query
  if (
    !careReceiver.coordinates ||
    !careReceiver.coordinates.coordinates ||
    careReceiver.coordinates.coordinates.length < 2
  ) {
    return {
      careGiver: null,
      reason:
        "Care receiver has no valid location coordinates — re-save their address to geocode it",
    };
  }

  query.coordinates = {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: careReceiver.coordinates.coordinates,
      },
      $maxDistance: maxDistanceMeters,
    },
  };

  const potentialCareGivers = await CareGiver.find(query).limit(50);
  console.log(
    `[Find Best] Found ${potentialCareGivers.length} potential care givers`,
  );

  if (potentialCareGivers.length === 0) {
    // Determine if the problem is missing skills/gender/active or purely distance
    const skillsOnlyQuery = {
      isActive: true,
      skills: { $all: visit.requirements },
    };
    if (excludeCareGiverId) skillsOnlyQuery._id = { $ne: excludeCareGiverId };
    if (careReceiver.genderPreference !== "No Preference") {
      skillsOnlyQuery.gender = careReceiver.genderPreference;
    }
    if (visit.doubleHanded) skillsOnlyQuery.singleHandedOnly = false;
    const anyWithSkills = await CareGiver.countDocuments(skillsOnlyQuery);

    if (anyWithSkills === 0) {
      return {
        careGiver: null,
        reason:
          "No available care givers have all the required skills for this visit.",
      };
    }
    return {
      careGiver: null,
      reason: `${anyWithSkills} care giver(s) have the required skills but none are within ${maxDistanceKm}km of this care receiver`,
    };
  }

  const [hours, minutes] = visit.preferredTime.split(":").map(Number);
  const endMinutes = minutes + visit.duration;
  const endTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

  const scoredCareGivers = [];
  const unavailabilityReasons = [];

  for (const cg of potentialCareGivers) {
    const availabilityCheck = await isCareGiverAvailable(
      cg._id,
      date,
      visit.preferredTime,
      endTime,
      careReceiver.coordinates.coordinates,
    );

    if (availabilityCheck.available) {
      const distance = calculateDistance(
        careReceiver.coordinates.coordinates,
        cg.coordinates.coordinates,
      );

      let score = distance;
      if (
        careReceiver.preferredCareGiver &&
        cg._id.equals(careReceiver.preferredCareGiver)
      ) {
        score -= 10;
      }

      scoredCareGivers.push({ careGiver: cg, score, distance });
    } else {
      unavailabilityReasons.push(
        availabilityCheck.reason || "Unavailable",
      );
    }
  }

  if (scoredCareGivers.length === 0) {
    const reasonSummary = buildUnavailabilityReasonSummary(unavailabilityReasons);
    return {
      careGiver: null,
      reason: reasonSummary,
    };
  }

  scoredCareGivers.sort((a, b) => a.score - b.score);
  console.log(`[Find Best]  Selected: ${scoredCareGivers[0].careGiver.name}`);
  return { careGiver: scoredCareGivers[0].careGiver, reason: null };
}

/**
 * Find SECOND care giver for double-handed care
 */
async function findSecondaryCareGiver(
  careReceiver,
  visit,
  date,
  primaryCareGiverId,
) {
  console.log(
    `\n[Find Secondary] Looking for SECOND care giver (double-handed)`,
  );
  console.log(`[Find Secondary] Primary CG: ${primaryCareGiverId}`);

  const result = await findBestCareGiver(
    careReceiver,
    visit,
    date,
    primaryCareGiverId,
  );

  if (result.careGiver) {
    console.log(`[Find Secondary]  Found secondary: ${result.careGiver.name}`);
  } else {
    console.log(`[Find Secondary]  No secondary care giver available`);
  }

  return result;
}

/**
 * Format date for logging
 */
function formatDateForLog(date) {
  const utcDay = date.getUTCDay();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return `${dayNames[utcDay]} ${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Schedule all daily visits for a care receiver for a date range
 * FIXED: Uses isDateInSchedule() to properly validate preferred days
 */
async function scheduleForCareReceiver(careReceiverId, startDate, endDate) {
  const careReceiver = await CareReceiver.findById(careReceiverId);

  if (!careReceiver) {
    throw new Error("Care receiver not found");
  }

  if (!careReceiver.dailyVisits || careReceiver.dailyVisits.length === 0) {
    throw new Error("Care receiver has no daily visits defined");
  }

  console.log(`\n========================================`);
  console.log(`SCHEDULING: ${careReceiver.name}`);
  console.log(
    `Period: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`,
  );
  console.log(`========================================\n`);

  const scheduled = [];
  const failed = [];

  const now = new Date();
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const createdAtUTC = careReceiver.createdAt
    ? new Date(
        Date.UTC(
          careReceiver.createdAt.getUTCFullYear(),
          careReceiver.createdAt.getUTCMonth(),
          careReceiver.createdAt.getUTCDate(),
        ),
      )
    : todayUTC;
  const updatedAtUTC = careReceiver.updatedAt
    ? new Date(
        Date.UTC(
          careReceiver.updatedAt.getUTCFullYear(),
          careReceiver.updatedAt.getUTCMonth(),
          careReceiver.updatedAt.getUTCDate(),
        ),
      )
    : createdAtUTC;
  const effectiveStart = new Date(
    Math.max(
      startDate.getTime(),
      createdAtUTC.getTime(),
      updatedAtUTC.getTime(),
      todayUTC.getTime(),
    ),
  );

  const currentDate = new Date(effectiveStart.getTime());

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const dayName = formatDateForLog(currentDate);

    console.log(`\n--- Processing Date: ${dateStr} (${dayName}) ---`);

    for (const visit of careReceiver.dailyVisits) {
      if (!isDateInSchedule(
        currentDate,
        visit,
        careReceiver.createdAt,
        careReceiver.updatedAt,
      )) {
        const visitDays = visit.daysOfWeek
          ? visit.daysOfWeek.join("/")
          : "all days";
        console.log(
          `[Schedule] ⏭️  Skipping ${dayName} - Visit ${visit.visitNumber} not scheduled (schedule: ${visitDays})`,
        );
        continue;
      }

      console.log(
        `\n[Schedule] ✓ Processing Visit ${visit.visitNumber} (${visit.preferredTime}) - matches schedule`,
      );

      if (visit.doubleHanded) {
        console.log(`[Schedule] 🤝 DOUBLE-HANDED CARE REQUIRED`);
      }

      let primaryCGResult = { careGiver: null, reason: "No care giver available at preferred time or within arrival window." };
      let chosenStartTime = visit.preferredTime;
      const bufferMin = visit.bufferFlexibilityMinutes ?? 0;

      if (bufferMin > 0) {
        const [prefH, prefM] = visit.preferredTime.split(":").map(Number);
        const preferredMinutes = prefH * 60 + prefM;
        const maxEndMinutes = 24 * 60 - (visit.duration || 0);
        const candidateMinutes = [
          preferredMinutes,
          Math.max(0, preferredMinutes - bufferMin),
          Math.min(maxEndMinutes, preferredMinutes + bufferMin),
        ];
        const uniqueMinutes = [...new Set(candidateMinutes)].sort((a, b) => a - b);

        for (const startMins of uniqueMinutes) {
          const h = Math.floor(startMins / 60);
          const m = startMins % 60;
          const candidateTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          const result = await findBestCareGiver(
            careReceiver,
            { ...visit, preferredTime: candidateTime },
            currentDate,
          );
          if (result.careGiver) {
            primaryCGResult = result;
            chosenStartTime = candidateTime;
            break;
          }
        }
      } else {
        primaryCGResult = await findBestCareGiver(
          careReceiver,
          visit,
          currentDate,
        );
        chosenStartTime = visit.preferredTime;
      }

      if (!primaryCGResult.careGiver) {
        console.log(`[Schedule]  Failed: ${primaryCGResult.reason}`);
        failed.push({
          visit,
          date: dateStr,
          reason: primaryCGResult.reason,
        });
        continue;
      }

      let secondaryCareGiver = null;

      if (visit.doubleHanded) {
        const secondaryCGResult = await findSecondaryCareGiver(
          careReceiver,
          { ...visit, preferredTime: chosenStartTime },
          currentDate,
          primaryCGResult.careGiver._id,
        );

        if (!secondaryCGResult.careGiver) {
          console.log(
            `[Schedule]  Failed: ${secondaryCGResult.reason} (secondary CG not found)`,
          );
          failed.push({
            visit,
            date: dateStr,
            reason: `Primary CG found, but no secondary CG available: ${secondaryCGResult.reason}`,
          });
          continue;
        }

        secondaryCareGiver = secondaryCGResult.careGiver;
        console.log(
          `[Schedule] 🤝 Double-handed: ${primaryCGResult.careGiver.name} + ${secondaryCareGiver.name}`,
        );
      }

      const [chosenHours, chosenMinutes] = chosenStartTime.split(":").map(Number);
      const endMinutes = chosenMinutes + visit.duration;
      const endTime = normalizeTimeToHHMM(
        `${chosenHours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`,
      );

      // Normalize appointment date to UTC midnight
      const appointmentDate = new Date(currentDate);
      const utcAppointmentDate = new Date(
        Date.UTC(
          appointmentDate.getUTCFullYear(),
          appointmentDate.getUTCMonth(),
          appointmentDate.getUTCDate(),
        ),
      );

      try {
        const existingAppointment = await AppointmentService.findExistingSlot(
          careReceiver._id,
          utcAppointmentDate,
          visit.visitNumber,
        );

        if (existingAppointment) {
          continue;
        }

        const appointmentData = {
          careReceiver: careReceiver._id,
          careGiver: primaryCGResult.careGiver._id,
          date: utcAppointmentDate,
          startTime: normalizeTimeToHHMM(chosenStartTime),
          endTime,
          duration: visit.duration,
          visitNumber: visit.visitNumber,
          requirements: visit.requirements,
          doubleHanded: visit.doubleHanded || false,
          priority: visit.priority || 3,
          notes: visit.notes || "",
          status: "scheduled",
          schedulingMetadata: {
            scheduledAt: new Date(),
            schedulingMethod: "automatic",
            algorithmVersion: "3.0-preferred-days-fixed",
          },
        };

        if (secondaryCareGiver) {
          appointmentData.secondaryCareGiver = secondaryCareGiver._id;
        }

        const appointment = await AppointmentService.create(appointmentData);

        scheduled.push(appointment);

        if (secondaryCareGiver) {
          console.log(
            ` Scheduled (DOUBLE-HANDED) with ${primaryCGResult.careGiver.name} + ${secondaryCareGiver.name}`,
          );
        } else {
          console.log(` Scheduled with ${primaryCGResult.careGiver.name}`);
        }
      } catch (error) {
        console.error(` Failed to create appointment: ${error.message}`);
        failed.push({
          visit,
          date: dateStr,
          reason: error.message,
        });
      }
    }

    // Move to next day
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  console.log(`\n========================================`);
  console.log(`SCHEDULING COMPLETE: ${careReceiver.name}`);
  console.log(`Scheduled: ${scheduled.length}`);
  console.log(`Skipped/Failed: ${failed.length}`);
  console.log(`========================================\n`);

  return { scheduled, failed };
}

/**
 * Bulk schedule for multiple care receivers
 */
async function bulkSchedule(careReceiverIds, startDate, endDate) {
  const results = [];

  for (const id of careReceiverIds) {
    try {
      const result = await scheduleForCareReceiver(id, startDate, endDate);
      results.push({
        careReceiverId: id,
        ...result,
      });
    } catch (error) {
      results.push({
        careReceiverId: id,
        scheduled: [],
        failed: [],
        error: error.message,
      });
    }
  }

  return results;
}

module.exports = {
  scheduleForCareReceiver,
  bulkSchedule,
  findBestCareGiver,
  isCareGiverAvailable,
  calculateDistance,
  calculateTravelTime,
  isDateInSchedule, // NEW: Export for testing
  findSecondaryCareGiver,
};
