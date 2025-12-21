// backend/services/schedulingService.js
// FIXED - Now enforces maxAppointmentsPerDay setting

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

/**
 * Check if care giver is available - WITH ALL SETTINGS
 */
async function isCareGiverAvailable(
  careGiverId,
  date,
  startTime,
  endTime,
  careReceiverLocation
) {
  const result = {
    available: false,
    reason: "",
    conflicts: [],
  };

  // Get settings
  const settings = await settingsService.getSchedulingSettings();
  const travelTimeBuffer = settings.travelTimeBufferMinutes || 15;
  const maxAppointmentsPerDay = settings.maxAppointmentsPerDay || 8;

  console.log(
    `[Settings] Travel buffer: ${travelTimeBuffer} min, Max appointments/day: ${maxAppointmentsPerDay}`
  );

  // 1. Check care giver exists and is active
  const careGiver = await CareGiver.findById(careGiverId);
  if (!careGiver || !careGiver.isActive) {
    result.reason = careGiver
      ? "Care giver is inactive"
      : "Care giver not found";
    console.log(`[Availability Check] ${result.reason} for ${careGiverId}`);
    return result;
  }

  // 2. Try to get availability from Availability collection
  let availability = await Availability.getCurrentForCareGiver(
    careGiverId,
    date
  );

  // 3. FALLBACK: If no availability document or incomplete, use embedded availability
  if (
    !availability ||
    !availability.schedule ||
    availability.schedule.length === 0
  ) {
    console.log(
      `[Availability Check] Using embedded availability for ${careGiver.name}`
    );

    // Check embedded time off
    if (careGiver.timeOff && careGiver.timeOff.length > 0) {
      for (const timeOff of careGiver.timeOff) {
        const timeOffStart = new Date(timeOff.startDate);
        const timeOffEnd = new Date(timeOff.endDate);
        if (date >= timeOffStart && date <= timeOffEnd) {
          result.reason = "Care giver is on time off";
          console.log(
            `[Availability Check] ${result.reason} for ${careGiver.name}`
          );
          return result;
        }
      }
    }

    // Use embedded availability schedule
    if (careGiver.availability && careGiver.availability.length > 0) {
      const dayOfWeek = date.toLocaleDateString("en-GB", { weekday: "long" });
      const daySchedule = careGiver.availability.find(
        (a) => a.dayOfWeek === dayOfWeek
      );

      if (!daySchedule || daySchedule.slots.length === 0) {
        result.reason = `Not working on ${dayOfWeek}`;
        console.log(`[Availability Check] ${result.reason}`);
        return result;
      }

      const isInWorkingHours = daySchedule.slots.some(
        (slot) => startTime >= slot.startTime && endTime <= slot.endTime
      );

      if (!isInWorkingHours) {
        result.reason = "Outside working hours";
        console.log(`[Availability Check] ${result.reason}`);
        return result;
      }
    } else {
      result.reason = "No availability schedule defined";
      console.log(`[Availability Check] ${result.reason}`);
      return result;
    }
  } else {
    // Use Availability collection data
    console.log(
      `[Availability Check] Using Availability collection for ${careGiver.name}`
    );

    // Check time off
    if (availability.isOnTimeOff(date)) {
      result.reason = "Care giver is on time off";
      console.log(`[Availability Check] ${result.reason}`);
      return result;
    }

    // Check working hours
    const dayOfWeek = date.toLocaleDateString("en-GB", { weekday: "long" });
    const daySchedule = availability.schedule.find(
      (s) => s.dayOfWeek === dayOfWeek
    );

    if (!daySchedule || daySchedule.slots.length === 0) {
      result.reason = `Not working on ${dayOfWeek}`;
      console.log(`[Availability Check] ${result.reason}`);
      return result;
    }

    const isInWorkingHours = daySchedule.slots.some(
      (slot) => startTime >= slot.startTime && endTime <= slot.endTime
    );

    if (!isInWorkingHours) {
      result.reason = "Outside working hours";
      console.log(`[Availability Check] ${result.reason}`);
      return result;
    }
  }

  // 4. Check appointment conflicts
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const existingAppointments = await Appointment.find({
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ["scheduled", "in_progress"] },
  })
    .populate("careReceiver", "name coordinates")
    .sort({ startTime: 1 });

  console.log(
    `[Availability Check] Found ${existingAppointments.length} existing appointments`
  );

  // NEW: Check max appointments per day BEFORE checking conflicts
  if (existingAppointments.length >= maxAppointmentsPerDay) {
    result.reason = `Already has ${existingAppointments.length} appointments (max ${maxAppointmentsPerDay} per day)`;
    console.log(`[Availability Check] ❌ ${result.reason}`);
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
      console.log(
        `[Availability Check] Time conflict: ${apt.startTime}-${apt.endTime}`
      );
      return result;
    }
  }

  // 5. Check travel time conflicts WITH BUFFER FROM SETTINGS
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

      const requiredTime = travelTime + travelTimeBuffer;

      const [lastEndH, lastEndM] = lastAppointment.endTime
        .split(":")
        .map(Number);
      const [newStartH, newStartM] = startTime.split(":").map(Number);
      const gapMinutes =
        newStartH * 60 + newStartM - (lastEndH * 60 + lastEndM);

      if (gapMinutes < requiredTime) {
        result.reason = "Insufficient travel time from previous appointment";
        result.conflicts.push({
          type: "travel_time_before",
          requiredTime: requiredTime,
          availableTime: gapMinutes,
          travelTime: travelTime,
          buffer: travelTimeBuffer,
        });
        console.log(
          `[Availability Check] Travel time conflict: need ${requiredTime}min (${travelTime}min travel + ${travelTimeBuffer}min buffer), have ${gapMinutes}min`
        );
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

      const requiredTime = travelTime + travelTimeBuffer;

      const [newEndH, newEndM] = endTime.split(":").map(Number);
      const [nextStartH, nextStartM] = nextAppointment.startTime
        .split(":")
        .map(Number);
      const gapMinutes =
        nextStartH * 60 + nextStartM - (newEndH * 60 + newEndM);

      if (gapMinutes < requiredTime) {
        result.reason = "Insufficient travel time to next appointment";
        result.conflicts.push({
          type: "travel_time_after",
          requiredTime: requiredTime,
          availableTime: gapMinutes,
          travelTime: travelTime,
          buffer: travelTimeBuffer,
        });
        console.log(
          `[Availability Check] Travel time conflict to next: need ${requiredTime}min (${travelTime}min travel + ${travelTimeBuffer}min buffer), have ${gapMinutes}min`
        );
        return result;
      }
    }
  }

  result.available = true;
  result.reason = "Available";
  console.log(
    `[Availability Check] ✅ ${careGiver.name} is available (${existingAppointments.length}/${maxAppointmentsPerDay} appointments)`
  );
  return result;
}

/**
 * Find best care giver for a visit - WITH MAX DISTANCE FROM SETTINGS
 */
async function findBestCareGiver(careReceiver, visit, date) {
  console.log(
    `\n[Find Best] Looking for care giver for Visit ${visit.visitNumber} on ${date.toISOString().split("T")[0]}`
  );
  console.log(`[Find Best] Requirements: ${visit.requirements.join(", ")}`);

  // Get settings
  const settings = await settingsService.getSchedulingSettings();
  const maxDistanceKm = settings.maxDistanceKm || 20;
  const maxDistanceMeters = maxDistanceKm * 1000;
  console.log(`[Settings] Using max distance: ${maxDistanceKm} km`);

  const query = {
    isActive: true,
    skills: { $all: visit.requirements },
  };

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
    `[Find Best] Found ${potentialCareGivers.length} care givers with required skills within ${maxDistanceKm}km`
  );

  if (potentialCareGivers.length === 0) {
    console.log(
      "[Find Best] ❌ No care givers have required skills within distance limit"
    );
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
    console.log(`\n[Find Best] Checking ${cg.name}...`);

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

      console.log(
        `[Find Best] ✅ ${cg.name} is available, distance: ${distance.toFixed(2)}km, score: ${score.toFixed(2)}`
      );
      scoredCareGivers.push({ careGiver: cg, score, distance });
    } else {
      console.log(
        `[Find Best] ❌ ${cg.name} not available: ${availabilityCheck.reason}`
      );
    }
  }

  if (scoredCareGivers.length === 0) {
    console.log("[Find Best] ❌ No available care givers found");
    return {
      careGiver: null,
      reason: "All care givers are unavailable or have conflicts",
    };
  }

  scoredCareGivers.sort((a, b) => a.score - b.score);
  console.log(`[Find Best] ✅ Selected: ${scoredCareGivers[0].careGiver.name}`);
  return { careGiver: scoredCareGivers[0].careGiver, reason: null };
}

/**
 * Schedule all daily visits for a care receiver for a date range
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
      console.log(
        `\nProcessing Visit ${visit.visitNumber} (${visit.preferredTime})`
      );

      const bestCareGiverResult = await findBestCareGiver(
        careReceiver,
        visit,
        currentDate
      );

      if (bestCareGiverResult.careGiver) {
        const [hours, minutes] = visit.preferredTime.split(":").map(Number);
        const endMinutes = minutes + visit.duration;
        const endTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

        try {
          const appointment = await Appointment.create({
            careReceiver: careReceiver._id,
            careGiver: bestCareGiverResult.careGiver._id,
            date: new Date(currentDate),
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
              algorithmVersion: "2.0",
            },
          });

          scheduled.push(appointment);
          console.log(
            `✅ Scheduled with ${bestCareGiverResult.careGiver.name}`
          );
        } catch (error) {
          console.error(`❌ Failed to create appointment: ${error.message}`);
          failed.push({
            visit,
            date: dateStr,
            reason: error.message,
          });
        }
      } else {
        console.log(`❌ Failed: ${bestCareGiverResult.reason}`);
        failed.push({
          visit,
          date: dateStr,
          reason: bestCareGiverResult.reason,
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log(`\n========================================`);
  console.log(`SCHEDULING COMPLETE: ${careReceiver.name}`);
  console.log(`Scheduled: ${scheduled.length}`);
  console.log(`Failed: ${failed.length}`);
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
};
