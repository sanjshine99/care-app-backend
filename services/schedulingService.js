// backend/services/schedulingService.js
// FIXED - UTC timezone + DOUBLE-HANDED CARE support

const Availability = require("../models/Availability");
const CareGiver = require("../models/CareGiver");
const CareReceiver = require("../models/CareReceiver");
const Appointment = require("../models/Appointment");
const settingsService = require("./settingsService");

/**
 * Calculate travel time between two locations
 */
async function calculateTravelTime(coords1, coords2) {
  try {
    const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;

    if (!mapboxToken) {
      console.warn("Mapbox token not found, using distance-based estimate");
      return estimateTravelTimeFromDistance(coords1, coords2);
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords1[0]},${coords1[1]};${coords2[0]},${coords2[1]}?access_token=${mapboxToken}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.routes && data.routes[0]) {
      const durationSeconds = data.routes[0].duration;
      return Math.ceil(durationSeconds / 60);
    }

    return estimateTravelTimeFromDistance(coords1, coords2);
  } catch (error) {
    console.error("Travel time calculation error:", error.message);
    return estimateTravelTimeFromDistance(coords1, coords2);
  }
}

/**
 * Estimate travel time from distance (fallback)
 */
function estimateTravelTimeFromDistance(coords1, coords2) {
  const distance = calculateDistance(coords1, coords2);
  return Math.ceil((distance / 30) * 60);
}

/**
 * Calculate distance between two points in km
 */
function calculateDistance(coords1, coords2) {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;

  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// NEW: Check if visit should occur on specific date
function shouldVisitOccur(visit, checkDate, careReceiverCreatedAt) {
  const dayOfWeek = checkDate.toLocaleDateString("en-GB", { weekday: "long" });

  const daysOfWeek = visit.daysOfWeek || [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  if (!daysOfWeek.includes(dayOfWeek)) {
    return false;
  }

  const recurrencePattern = visit.recurrencePattern || "weekly";

  if (recurrencePattern === "weekly") {
    return true;
  }

  if (
    recurrencePattern === "biweekly" ||
    recurrencePattern === "monthly" ||
    recurrencePattern === "custom"
  ) {
    const startDate =
      visit.recurrenceStartDate || careReceiverCreatedAt || new Date();
    const recurrenceInterval = visit.recurrenceInterval || 1;

    const checkDateStart = new Date(checkDate);
    checkDateStart.setHours(0, 0, 0, 0);

    const startDateStart = new Date(startDate);
    startDateStart.setHours(0, 0, 0, 0);

    const weeksDiff = Math.floor(
      (checkDateStart - startDateStart) / (7 * 24 * 60 * 60 * 1000)
    );

    return weeksDiff >= 0 && weeksDiff % recurrenceInterval === 0;
  }

  return true;
}

/**
 * Check if care giver is available
 */
async function isCareGiverAvailable(
  careGiverId,
  date,
  startTime,
  endTime,
  careReceiverLocation,
  excludeAppointmentId = null // NEW: Exclude specific appointment when checking (for secondary CG)
) {
  const result = {
    available: false,
    reason: "",
    conflicts: [],
  };

  const settings = await settingsService.getSchedulingSettings();
  const travelTimeBuffer = settings.travelTimeBufferMinutes || 15;
  const maxAppointmentsPerDay = settings.maxAppointmentsPerDay || 8;

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
      checkDate.getUTCDate()
    );

    for (const timeOff of careGiver.timeOff) {
      const timeOffStartDate = new Date(timeOff.startDate);
      const utcStart = Date.UTC(
        timeOffStartDate.getUTCFullYear(),
        timeOffStartDate.getUTCMonth(),
        timeOffStartDate.getUTCDate()
      );

      const timeOffEndDate = new Date(timeOff.endDate);
      const utcEnd = Date.UTC(
        timeOffEndDate.getUTCFullYear(),
        timeOffEndDate.getUTCMonth(),
        timeOffEndDate.getUTCDate(),
        23,
        59,
        59,
        999
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
    date
  );

  if (
    !availability ||
    !availability.schedule ||
    availability.schedule.length === 0
  ) {
    if (careGiver.availability && careGiver.availability.length > 0) {
      const dayOfWeek = date.toLocaleDateString("en-GB", { weekday: "long" });
      const daySchedule = careGiver.availability.find(
        (a) => a.dayOfWeek === dayOfWeek
      );

      if (!daySchedule || daySchedule.slots.length === 0) {
        result.reason = `Not working on ${dayOfWeek}`;
        return result;
      }

      const isInWorkingHours = daySchedule.slots.some(
        (slot) => startTime >= slot.startTime && endTime <= slot.endTime
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
    const dayOfWeek = date.toLocaleDateString("en-GB", { weekday: "long" });
    const daySchedule = availability.schedule.find(
      (s) => s.dayOfWeek === dayOfWeek
    );

    if (!daySchedule || daySchedule.slots.length === 0) {
      result.reason = `Not working on ${dayOfWeek}`;
      return result;
    }

    const isInWorkingHours = daySchedule.slots.some(
      (slot) => startTime >= slot.startTime && endTime <= slot.endTime
    );

    if (!isInWorkingHours) {
      result.reason = "Outside working hours";
      return result;
    }
  }

  // Check appointment conflicts
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const query = {
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ["scheduled", "in_progress"] },
  };

  // NEW: Exclude specific appointment if checking for secondary CG
  if (excludeAppointmentId) {
    query._id = { $ne: excludeAppointmentId };
  }

  const existingAppointments = await Appointment.find(query)
    .populate("careReceiver", "name coordinates")
    .sort({ startTime: 1 });

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
    (apt) => apt.endTime <= startTime
  );
  const appointmentsAfter = existingAppointments.filter(
    (apt) => apt.startTime >= endTime
  );

  if (appointmentsBefore.length > 0) {
    const lastAppointment = appointmentsBefore[appointmentsBefore.length - 1];
    if (lastAppointment.careReceiver?.coordinates) {
      const travelTime = await calculateTravelTime(
        lastAppointment.careReceiver.coordinates.coordinates,
        careReceiverLocation
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
        nextAppointment.careReceiver.coordinates.coordinates
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
 * Find best care giver for a visit
 */
async function findBestCareGiver(
  careReceiver,
  visit,
  date,
  excludeCareGiverId = null
) {
  console.log(
    `\n[Find Best] Looking for care giver for Visit ${visit.visitNumber}`
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

  // NEW: Exclude specific care giver (for finding secondary CG)
  if (excludeCareGiverId) {
    query._id = { $ne: excludeCareGiverId };
  }

  if (careReceiver.genderPreference !== "No Preference") {
    query.gender = careReceiver.genderPreference;
  }

  if (!visit.doubleHanded) {
    query.singleHandedOnly = false;
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
    `[Find Best] Found ${potentialCareGivers.length} potential care givers`
  );

  if (potentialCareGivers.length === 0) {
    return {
      careGiver: null,
      reason: `No care givers with required skills within ${maxDistanceKm}km`,
    };
  }

  const [hours, minutes] = visit.preferredTime.split(":").map(Number);
  const endMinutes = minutes + visit.duration;
  const endTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

  const scoredCareGivers = [];

  for (const cg of potentialCareGivers) {
    const availabilityCheck = await isCareGiverAvailable(
      cg._id,
      date,
      visit.preferredTime,
      endTime,
      careReceiver.coordinates.coordinates
    );

    if (availabilityCheck.available) {
      const distance = calculateDistance(
        careReceiver.coordinates.coordinates,
        cg.coordinates.coordinates
      );

      let score = distance;
      if (
        careReceiver.preferredCareGiver &&
        cg._id.equals(careReceiver.preferredCareGiver)
      ) {
        score -= 10;
      }

      scoredCareGivers.push({ careGiver: cg, score, distance });
    }
  }

  if (scoredCareGivers.length === 0) {
    return {
      careGiver: null,
      reason: "All care givers are unavailable or have conflicts",
    };
  }

  scoredCareGivers.sort((a, b) => a.score - b.score);
  console.log(`[Find Best] ✅ Selected: ${scoredCareGivers[0].careGiver.name}`);
  return { careGiver: scoredCareGivers[0].careGiver, reason: null };
}

// ========================================
// NEW: Find SECOND care giver for double-handed care
// ========================================
async function findSecondaryCareGiver(
  careReceiver,
  visit,
  date,
  primaryCareGiverId
) {
  console.log(
    `\n[Find Secondary] Looking for SECOND care giver (double-handed)`
  );
  console.log(`[Find Secondary] Primary CG: ${primaryCareGiverId}`);

  // Find second care giver, excluding the primary one
  const result = await findBestCareGiver(
    careReceiver,
    visit,
    date,
    primaryCareGiverId
  );

  if (result.careGiver) {
    console.log(
      `[Find Secondary] ✅ Found secondary: ${result.careGiver.name}`
    );
  } else {
    console.log(`[Find Secondary] ❌ No secondary care giver available`);
  }

  return result;
}
// ========================================

/**
 * Schedule all daily visits for a care receiver for a date range
 * ENHANCED: Supports flexible scheduling + double-handed care
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
    `Period: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`
  );
  console.log(`========================================\n`);

  const scheduled = [];
  const failed = [];

  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split("T")[0];
    console.log(`\n--- Processing Date: ${dateStr} ---`);

    for (const visit of careReceiver.dailyVisits) {
      // Check if visit should occur on this date
      if (!shouldVisitOccur(visit, currentDate, careReceiver.createdAt)) {
        console.log(
          `[Schedule] ⏭️ Visit ${visit.visitNumber} does not occur on ${dateStr} (not in schedule)`
        );
        continue;
      }

      console.log(
        `\n[Schedule] Processing Visit ${visit.visitNumber} (${visit.preferredTime})`
      );

      // Check if double-handed care required
      if (visit.doubleHanded) {
        console.log(`[Schedule] 🤝 DOUBLE-HANDED CARE REQUIRED`);
      }

      // Find primary care giver
      const primaryCGResult = await findBestCareGiver(
        careReceiver,
        visit,
        currentDate
      );

      if (!primaryCGResult.careGiver) {
        console.log(`[Schedule] ❌ Failed: ${primaryCGResult.reason}`);
        failed.push({
          visit,
          date: dateStr,
          reason: primaryCGResult.reason,
        });
        continue;
      }

      let secondaryCareGiver = null;

      // ========================================
      // NEW: Find SECOND care giver if double-handed
      // ========================================
      if (visit.doubleHanded) {
        const secondaryCGResult = await findSecondaryCareGiver(
          careReceiver,
          visit,
          currentDate,
          primaryCGResult.careGiver._id
        );

        if (!secondaryCGResult.careGiver) {
          console.log(
            `[Schedule] ❌ Failed: ${secondaryCGResult.reason} (secondary CG not found)`
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
          `[Schedule] 🤝 Double-handed: ${primaryCGResult.careGiver.name} + ${secondaryCareGiver.name}`
        );
      }
      // ========================================

      // Calculate end time
      const [hours, minutes] = visit.preferredTime.split(":").map(Number);
      const endMinutes = minutes + visit.duration;
      const endTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

      // Normalize appointment date to UTC midnight
      const appointmentDate = new Date(currentDate);
      const utcAppointmentDate = new Date(
        Date.UTC(
          appointmentDate.getFullYear(),
          appointmentDate.getMonth(),
          appointmentDate.getDate()
        )
      );

      try {
        const appointmentData = {
          careReceiver: careReceiver._id,
          careGiver: primaryCGResult.careGiver._id,
          date: utcAppointmentDate,
          startTime: visit.preferredTime,
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
            algorithmVersion: "2.1-double-handed",
          },
        };

        // Add secondary care giver if double-handed
        if (secondaryCareGiver) {
          appointmentData.secondaryCareGiver = secondaryCareGiver._id;
        }

        const appointment = await Appointment.create(appointmentData);

        scheduled.push(appointment);

        if (secondaryCareGiver) {
          console.log(
            `✅ Scheduled (DOUBLE-HANDED) with ${primaryCGResult.careGiver.name} + ${secondaryCareGiver.name}`
          );
        } else {
          console.log(`✅ Scheduled with ${primaryCGResult.careGiver.name}`);
        }
      } catch (error) {
        console.error(`❌ Failed to create appointment: ${error.message}`);
        failed.push({
          visit,
          date: dateStr,
          reason: error.message,
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
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
  shouldVisitOccur,
  findSecondaryCareGiver, // NEW: Export for use in other modules
};
