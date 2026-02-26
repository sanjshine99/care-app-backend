// backend/services/schedulingService.js
// CORRECTED - UTC timezone + Proper preferred days validation + Double-handed care

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
 * FIXED: Check if a date matches the visit's schedule preferences
 * Uses UTC dates to avoid timezone issues
 *
 * @param {Date} checkDate - The date to check (as Date object)
 * @param {Object} visit - The visit object with daysOfWeek, recurrencePattern, etc.
 * @param {Date} careReceiverCreatedAt - When care receiver was created (for recurrence start)
 * @returns {boolean} - True if visit should occur on this date
 */
function isDateInSchedule(
  checkDate,
  visit,
  careReceiverCreatedAt,
  careReceiverUpdatedAt,
) {
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

  if (!visit.daysOfWeek || visit.daysOfWeek.length === 0) {
    console.log(
      `  Warning: No daysOfWeek defined for visit ${visit.visitNumber}, defaulting to all days`,
    );
    visit.daysOfWeek = dayNames;
  }

  if (!visit.daysOfWeek.includes(dayOfWeek)) {
    return false;
  }

  const checkUTC = Date.UTC(
    checkDate.getUTCFullYear(),
    checkDate.getUTCMonth(),
    checkDate.getUTCDate(),
  );

  const createdUTC = careReceiverCreatedAt
    ? Date.UTC(
        new Date(careReceiverCreatedAt).getUTCFullYear(),
        new Date(careReceiverCreatedAt).getUTCMonth(),
        new Date(careReceiverCreatedAt).getUTCDate(),
      )
    : 0;
  const updatedUTC = careReceiverUpdatedAt
    ? Date.UTC(
        new Date(careReceiverUpdatedAt).getUTCFullYear(),
        new Date(careReceiverUpdatedAt).getUTCMonth(),
        new Date(careReceiverUpdatedAt).getUTCDate(),
      )
    : 0;
  const receiverEffectiveStartUTC = Math.max(createdUTC, updatedUTC);

  const effectiveStart = visit.recurrenceStartDate
    ? new Date(visit.recurrenceStartDate)
    : receiverEffectiveStartUTC
      ? new Date(receiverEffectiveStartUTC)
      : new Date();
  const startUTC = Date.UTC(
    effectiveStart.getUTCFullYear(),
    effectiveStart.getUTCMonth(),
    effectiveStart.getUTCDate(),
  );
  if (checkUTC < startUTC) {
    return false;
  }

  if (visit.recurrenceEndDate) {
    const endDate = new Date(visit.recurrenceEndDate);
    const endUTC = Date.UTC(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth(),
      endDate.getUTCDate(),
    );
    if (checkUTC > endUTC) {
      return false;
    }
  }

  // Get recurrence pattern (default to weekly)
  const recurrencePattern = visit.recurrencePattern || "weekly";
  const recurrenceInterval = visit.recurrenceInterval || 1;

  // Weekly pattern - day is already validated above, and we're on or after start
  if (recurrencePattern === "weekly" && recurrenceInterval === 1) {
    return true;
  }

  if (
    recurrencePattern === "biweekly" ||
    recurrencePattern === "monthly" ||
    recurrencePattern === "custom"
  ) {
    const startDate = visit.recurrenceStartDate
      ? new Date(visit.recurrenceStartDate)
      : receiverEffectiveStartUTC
        ? new Date(receiverEffectiveStartUTC)
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
        reason: `No active care givers have all required skills: [${visit.requirements.join(", ")}]`,
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
    }
  }

  if (scoredCareGivers.length === 0) {
    return {
      careGiver: null,
      reason: "All care givers are unavailable or have conflicts",
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

      // Check if double-handed care required
      if (visit.doubleHanded) {
        console.log(`[Schedule] 🤝 DOUBLE-HANDED CARE REQUIRED`);
      }

      // Find primary care giver
      const primaryCGResult = await findBestCareGiver(
        careReceiver,
        visit,
        currentDate,
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

      let secondaryCareGiver = null;

      // Find SECOND care giver if double-handed
      if (visit.doubleHanded) {
        const secondaryCGResult = await findSecondaryCareGiver(
          careReceiver,
          visit,
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

      // Calculate end time
      const [hours, minutes] = visit.preferredTime.split(":").map(Number);
      const endMinutes = minutes + visit.duration;
      const endTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

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
            algorithmVersion: "3.0-preferred-days-fixed",
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
