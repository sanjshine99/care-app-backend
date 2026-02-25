// backend/services/schedulingService.js
// CORRECTED - UTC timezone + Proper preferred days validation + Double-handed care

const Availability = require("../models/Availability");
const CareGiver = require("../models/CareGiver");
const CareReceiver = require("../models/CareReceiver");
const Appointment = require("../models/Appointment");
const settingsService = require("./settingsService");

// ─── In-run caches ───────────────────────────────────────────────────────────
// Availability records are immutable during a scheduling run.
// Keyed by `${careGiverId}_${dateStr}` → Availability document (or null).
const _availabilityCache = new Map();

function _clearRunCaches() {
  _availabilityCache.clear();
}

async function _getCachedAvailability(careGiverId, date) {
  const dateStr = date.toISOString().split("T")[0];
  const key = `${careGiverId}_${dateStr}`;
  if (!_availabilityCache.has(key)) {
    const av = await Availability.getCurrentForCareGiver(careGiverId, date);
    _availabilityCache.set(key, av);
  }
  return _availabilityCache.get(key);
}

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
 * FIXED: Check if a date matches the visit's schedule preferences
 * Uses UTC dates to avoid timezone issues
 *
 * @param {Date} checkDate - The date to check (as Date object)
 * @param {Object} visit - The visit object with daysOfWeek, recurrencePattern, etc.
 * @param {Date} careReceiverCreatedAt - When care receiver was created (for recurrence start)
 * @returns {boolean} - True if visit should occur on this date
 */
function isDateInSchedule(checkDate, visit, careReceiverCreatedAt) {
  // Get day of week using UTC (0=Sunday, 1=Monday, ..., 6=Saturday)
  const utcDay = checkDate.getUTCDay();
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

  // Check if visit has daysOfWeek defined
  if (!visit.daysOfWeek || visit.daysOfWeek.length === 0) {
    console.log(
      `  Warning: No daysOfWeek defined for visit ${visit.visitNumber}, defaulting to all days`,
    );
    // If no daysOfWeek specified, default to all 7 days
    visit.daysOfWeek = dayNames;
  }

  // First check: Is this day of week in the allowed days?
  if (!visit.daysOfWeek.includes(dayOfWeek)) {
    return false; // Not in allowed days
  }

  // Get recurrence pattern (default to weekly)
  const recurrencePattern = visit.recurrencePattern || "weekly";
  const recurrenceInterval = visit.recurrenceInterval || 1;

  // Weekly pattern - day is already validated above
  if (recurrencePattern === "weekly" && recurrenceInterval === 1) {
    return true; // Day matches, and it's weekly
  }

  // For biweekly, monthly, or custom intervals, we need a start date
  if (
    recurrencePattern === "biweekly" ||
    recurrencePattern === "monthly" ||
    recurrencePattern === "custom"
  ) {
    const startDate = visit.recurrenceStartDate
      ? new Date(visit.recurrenceStartDate)
      : careReceiverCreatedAt
        ? new Date(careReceiverCreatedAt)
        : new Date();

    // Normalize both dates to UTC midnight for accurate comparison
    const startUTC = Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate(),
    );

    const checkUTC = Date.UTC(
      checkDate.getUTCFullYear(),
      checkDate.getUTCMonth(),
      checkDate.getUTCDate(),
    );

    // Calculate difference in days
    const daysDiff = Math.floor((checkUTC - startUTC) / (24 * 60 * 60 * 1000));

    if (daysDiff < 0) {
      return false; // Before start date
    }

    // For biweekly: check if it's the right week
    if (recurrencePattern === "biweekly") {
      const weeksDiff = Math.floor(daysDiff / 7);
      return weeksDiff % recurrenceInterval === 0;
    }

    // For monthly: check if it's the right month interval
    if (recurrencePattern === "monthly") {
      const monthsDiff =
        (checkDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
        (checkDate.getUTCMonth() - startDate.getUTCMonth());
      return monthsDiff >= 0 && monthsDiff % recurrenceInterval === 0;
    }

    // For custom: use days-based interval
    if (recurrencePattern === "custom") {
      return daysDiff % recurrenceInterval === 0;
    }
  }

  // Default: if day matches and pattern is not recognized, allow it
  return true;
}

/**
 * Check if care giver is available.
 *
 * Performance: accepts two optional cache objects to avoid repeated DB
 * round-trips when called many times per scheduling run:
 *   - careGiverObj  — pre-fetched CareGiver document (skips findById)
 *   - dayApptCache  — Map<careGiverId → appointments[]> for the current day
 *                     (skips Appointment.find; updated by the caller after
 *                     each new appointment is created)
 */
async function isCareGiverAvailable(
  careGiverId,
  date,
  startTime,
  endTime,
  careReceiverLocation,
  excludeAppointmentId = null,
  { careGiverObj = null, dayApptCache = null } = {},
) {
  const result = {
    available: false,
    reason: "",
    conflicts: [],
  };

  const settings = await settingsService.getSchedulingSettings();
  const travelTimeBuffer = settings.travelTimeBufferMinutes || 15;
  const maxAppointmentsPerDay = settings.maxAppointmentsPerDay || 8;

  // Use pre-fetched caregiver when available; fall back to DB lookup
  const careGiver = careGiverObj || (await CareGiver.findById(careGiverId));
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

  // Get availability — use module-level cache so the same record is not
  // re-fetched for every time-slot attempt on the same caregiver + day
  const availability = await _getCachedAvailability(careGiverId, date);

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

  if (availability && availability.schedule && availability.schedule.length > 0) {
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
  } else if (careGiver.availability && careGiver.availability.length > 0) {
    // Fall back to embedded availability on the CareGiver document
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

  // ── Appointment conflict check ────────────────────────────────────────────
  // Use the day-level appointment cache when provided so the same DB query is
  // not repeated for every time-slot attempt on the same caregiver + day.
  let existingAppointments;
  const cgKey = careGiverId.toString();

  if (dayApptCache && dayApptCache.has(cgKey)) {
    existingAppointments = dayApptCache.get(cgKey);
    if (excludeAppointmentId) {
      existingAppointments = existingAppointments.filter(
        (a) => !a._id.equals(excludeAppointmentId),
      );
    }
  } else {
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

    existingAppointments = await Appointment.find(query)
      .populate("careReceiver", "name coordinates")
      .sort({ startTime: 1 });

    // Populate the cache so subsequent checks for this caregiver skip the query
    if (dayApptCache) {
      dayApptCache.set(cgKey, existingAppointments);
    }
  }

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
 * Generate alternative time slots sorted by proximity to preferred time.
 * Used as fallback when the preferred time is unavailable.
 *
 * @param {Object} visit - The visit object with preferredTime and duration
 * @param {number} intervalMinutes - Step size between alternative times (default 30)
 * @param {number} maxAlternatives - Max number of alternatives to generate (default 10)
 * @returns {string[]} Array of time strings (HH:MM) ordered closest-first from preferred
 */
function generateAlternativeTimes(visit, intervalMinutes = 30, maxAlternatives = 10) {
  const [prefHours, prefMinutes] = visit.preferredTime.split(":").map(Number);
  const prefTotalMinutes = prefHours * 60 + prefMinutes;

  // Ensure visit ends before 22:00 and starts no earlier than 07:00
  const workStart = 7 * 60; // 07:00
  const workEnd = 22 * 60 - visit.duration; // Latest possible start time

  const alternatives = [];

  // Interleave later and earlier times, sorted by proximity to preferred
  for (
    let delta = intervalMinutes;
    alternatives.length < maxAlternatives;
    delta += intervalMinutes
  ) {
    const later = prefTotalMinutes + delta;
    const earlier = prefTotalMinutes - delta;

    const hasLater = later <= workEnd;
    const hasEarlier = earlier >= workStart;

    if (!hasLater && !hasEarlier) break;

    if (hasLater) {
      const h = Math.floor(later / 60);
      const m = later % 60;
      alternatives.push(`${h}:${m.toString().padStart(2, "0")}`);
    }

    if (hasEarlier && alternatives.length < maxAlternatives) {
      const h = Math.floor(earlier / 60);
      const m = earlier % 60;
      alternatives.push(`${h}:${m.toString().padStart(2, "0")}`);
    }
  }

  return alternatives;
}

/**
 * Find best care giver for a visit.
 * Tries the preferred time first; if no caregiver is available, searches
 * alternative time slots in 30-minute increments closest to preferred time.
 *
 * @param {string|null} forcedTime - When set, only this time is tried (used for
 *   double-handed secondary caregiver to match the primary's scheduled time).
 * @param {Map|null} dayApptCache - Per-day appointment cache shared across
 *   all availability checks on the same date. Eliminates repeated DB queries
 *   for the same caregiver when trying multiple time slots.
 */
async function findBestCareGiver(
  careReceiver,
  visit,
  date,
  excludeCareGiverId = null,
  forcedTime = null,
  dayApptCache = null,
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
    return {
      careGiver: null,
      scheduledTime: null,
      reason: `No care givers with required skills within ${maxDistanceKm}km`,
    };
  }

  // Determine which times to try:
  // - If forcedTime is set (e.g. secondary caregiver must match primary), only try that time
  // - Otherwise try preferred time first, then alternatives sorted by proximity
  const timesToTry = forcedTime
    ? [forcedTime]
    : [visit.preferredTime, ...generateAlternativeTimes(visit)];

  for (const tryTime of timesToTry) {
    const [hours, minutes] = tryTime.split(":").map(Number);
    const endMinutes = minutes + visit.duration;
    const tryEndTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

    const scoredCareGivers = [];

    for (const cg of potentialCareGivers) {
      const availabilityCheck = await isCareGiverAvailable(
        cg._id,
        date,
        tryTime,
        tryEndTime,
        careReceiver.coordinates.coordinates,
        null,
        { careGiverObj: cg, dayApptCache },
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
      }
    }

    if (scoredCareGivers.length > 0) {
      scoredCareGivers.sort((a, b) => a.score - b.score);
      const selected = scoredCareGivers[0];

      if (tryTime !== visit.preferredTime) {
        console.log(
          `[Find Best] Using alternative time ${tryTime} (preferred was ${visit.preferredTime})`,
        );
      }

      console.log(`[Find Best]  Selected: ${selected.careGiver.name} at ${tryTime}`);
      return {
        careGiver: selected.careGiver,
        scheduledTime: tryTime,
        scheduledEndTime: tryEndTime,
        reason: null,
      };
    }
  }

  return {
    careGiver: null,
    scheduledTime: null,
    reason: "All care givers are unavailable at all time slots",
  };
}

/**
 * Find SECOND care giver for double-handed care.
 * Must be available at the same time as the primary caregiver.
 *
 * @param {string} scheduledTime - The time already chosen for the primary caregiver
 * @param {Map|null} dayApptCache - Shared per-day appointment cache
 */
async function findSecondaryCareGiver(
  careReceiver,
  visit,
  date,
  primaryCareGiverId,
  scheduledTime,
  dayApptCache = null,
) {
  console.log(
    `\n[Find Secondary] Looking for SECOND care giver (double-handed)`,
  );
  console.log(`[Find Secondary] Primary CG: ${primaryCareGiverId}`);
  console.log(`[Find Secondary] Must match time: ${scheduledTime}`);

  // Force the same time as the primary caregiver
  const result = await findBestCareGiver(
    careReceiver,
    visit,
    date,
    primaryCareGiverId,
    scheduledTime,
    dayApptCache,
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

  // Create a copy of startDate to avoid mutation
  const currentDate = new Date(startDate.getTime());

  // Per-day appointment cache: Map<careGiverId → appointments[]>
  // Reset for each new date so it always reflects the actual DB state.
  // After each successful Appointment.create we append to the cache so
  // subsequent checks within the same day see the freshly created record
  // without an extra round-trip to MongoDB.
  let dayApptCache = new Map();
  let lastProcessedDate = null;

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const dayName = formatDateForLog(currentDate);

    // New calendar day — discard stale appointment cache
    if (dateStr !== lastProcessedDate) {
      dayApptCache = new Map();
      lastProcessedDate = dateStr;
    }

    console.log(`\n--- Processing Date: ${dateStr} (${dayName}) ---`);

    for (const visit of careReceiver.dailyVisits) {
      // FIXED: Use isDateInSchedule() instead of shouldVisitOccur()
      if (!isDateInSchedule(currentDate, visit, careReceiver.createdAt)) {
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

      // Check if double-handed care required
      if (visit.doubleHanded) {
        console.log(`[Schedule] 🤝 DOUBLE-HANDED CARE REQUIRED`);
      }

      // Find primary care giver (tries preferred time first, then alternatives)
      const primaryCGResult = await findBestCareGiver(
        careReceiver,
        visit,
        currentDate,
        null,
        null,
        dayApptCache,
      );

      if (!primaryCGResult.careGiver) {
        console.log(`[Schedule]  Failed: ${primaryCGResult.reason}`);
        failed.push({
          visit,
          date: dateStr,
          reason: primaryCGResult.reason,
        });
        continue;
      }

      // Use the actual time the caregiver was found available at
      const scheduledTime = primaryCGResult.scheduledTime || visit.preferredTime;

      let secondaryCareGiver = null;

      // Find SECOND care giver if double-handed — must match the primary's scheduled time
      if (visit.doubleHanded) {
        const secondaryCGResult = await findSecondaryCareGiver(
          careReceiver,
          visit,
          currentDate,
          primaryCGResult.careGiver._id,
          scheduledTime,
          dayApptCache,
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

      // Calculate end time from the actual scheduled time (may differ from preferred)
      const [hours, minutes] = scheduledTime.split(":").map(Number);
      const endMinutes = minutes + visit.duration;
      const endTime = primaryCGResult.scheduledEndTime ||
        `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

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
        //  FIXED: Check for duplicate appointments before creating
        const existingAppointment = await Appointment.findOne({
          careReceiver: careReceiver._id,
          date: utcAppointmentDate,
          visitNumber: visit.visitNumber,
          status: { $in: ["scheduled", "in_progress", "completed"] },
        });

        if (existingAppointment) {
          console.log(
            `⏭️  Skipping ${dayName} Visit ${visit.visitNumber} - appointment already exists`,
          );
          continue;
        }

        const appointmentData = {
          careReceiver: careReceiver._id,
          careGiver: primaryCGResult.careGiver._id,
          date: utcAppointmentDate,
          startTime: scheduledTime,
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
            algorithmVersion: "3.2-appointment-cache",
            preferredTime: visit.preferredTime,
            usedAlternativeTime: scheduledTime !== visit.preferredTime,
          },
        };

        // Add secondary care giver if double-handed
        if (secondaryCareGiver) {
          appointmentData.secondaryCareGiver = secondaryCareGiver._id;
        }

        const appointment = await Appointment.create(appointmentData);

        scheduled.push(appointment);

        // ── Update day appointment cache ───────────────────────────────────
        // Build a lean object matching the shape that isCareGiverAvailable
        // reads from the cache (startTime, endTime, careReceiver.coordinates).
        const cacheEntry = {
          _id: appointment._id,
          startTime: scheduledTime,
          endTime,
          status: "scheduled",
          careReceiver: {
            name: careReceiver.name,
            coordinates: careReceiver.coordinates,
          },
        };

        const addToCache = (cgId) => {
          const key = cgId.toString();
          const list = dayApptCache.get(key) || [];
          list.push(cacheEntry);
          list.sort((a, b) => a.startTime.localeCompare(b.startTime));
          dayApptCache.set(key, list);
        };

        addToCache(primaryCGResult.careGiver._id);
        if (secondaryCareGiver) addToCache(secondaryCareGiver._id);
        // ─────────────────────────────────────────────────────────────────

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
 * Bulk schedule for multiple care receivers.
 * Clears the availability cache at the start so each run works with fresh data.
 */
async function bulkSchedule(careReceiverIds, startDate, endDate) {
  _clearRunCaches();
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
