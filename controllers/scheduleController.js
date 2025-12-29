// backend/controllers/scheduleController.js
// FINAL CLEAN VERSION - No duplicates, all functions exported properly

const Appointment = require("../models/Appointment");
const CareReceiver = require("../models/CareReceiver");
const CareGiver = require("../models/CareGiver");
const Availability = require("../models/Availability");
const {
  scheduleForCareReceiver,
  bulkSchedule,
  findBestCareGiver,
} = require("../services/schedulingService");
const notificationService = require("../services/notificationService");

// =============================================================================
// SCHEDULE GENERATION (POST ONLY)
// =============================================================================

// @desc    Generate schedule for care receiver(s)
// @route   POST /api/schedule/generate
// @access  Private
exports.generateSchedule = async (req, res, next) => {
  console.log("\n========================================");
  console.log("🟢 POST /schedule/generate CALLED");
  console.log("========================================");
  console.log("⚠️  THIS IS THE ONLY ENDPOINT THAT GENERATES");
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  console.log("🔄 STARTING SCHEDULE GENERATION...");

  try {
    const { careReceiverIds, careReceiverId, startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Start date and end date are required",
          code: "MISSING_DATES",
        },
      });
    }

    // FIXED: Set start to beginning of day, end to END of day
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0); // Start of day

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // END of day (includes entire day)

    console.log("Start date:", start.toISOString());
    console.log("End date:", end.toISOString());

    if (start > end) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Start date must be before end date",
          code: "INVALID_DATE_RANGE",
        },
      });
    }

    let results;

    if (careReceiverId) {
      console.log(`📝 Generating for single care receiver: ${careReceiverId}`);
      results = [await scheduleForCareReceiver(careReceiverId, start, end)];
    } else if (careReceiverIds && careReceiverIds.length > 0) {
      console.log(`📝 Generating for ${careReceiverIds.length} care receivers`);
      results = await bulkSchedule(careReceiverIds, start, end);
    } else {
      console.log("📝 Generating for ALL active care receivers");
      const allCareReceivers = await CareReceiver.find({ isActive: true });
      const ids = allCareReceivers.map((cr) => cr._id.toString());
      results = await bulkSchedule(ids, start, end);
    }

    const summary = {
      totalScheduled: results.reduce(
        (sum, r) => sum + (r.scheduled?.length || 0),
        0
      ),
      totalFailed: results.reduce((sum, r) => sum + (r.failed?.length || 0), 0),
      careReceiversProcessed: results.length,
    };

    console.log("✅ GENERATION COMPLETE");
    console.log(`   Scheduled: ${summary.totalScheduled}`);
    console.log(`   Failed: ${summary.totalFailed}`);
    console.log("========================================\n");

    // Create notification
    try {
      await notificationService.notifyScheduleGenerated(req.user?._id, summary);
    } catch (notifError) {
      console.error("Failed to create notification:", notifError.message);
    }

    res.json({
      success: true,
      data: { results, summary },
      message: `Scheduled ${summary.totalScheduled} appointments, ${summary.totalFailed} failed`,
    });
  } catch (error) {
    console.error("❌ Error in generateSchedule:", error);
    console.log("========================================\n");
    next(error);
  }
};

// =============================================================================
// READ OPERATIONS (GET ONLY - NO GENERATION)
// =============================================================================

// @desc    Get all appointments with filters
// @route   GET /api/schedule/appointments
// @access  Private
exports.getAllAppointments = async (req, res, next) => {
  console.log("\n========================================");
  console.log("🔵 GET /schedule/appointments CALLED");
  console.log("========================================");
  console.log("Query params:", req.query);
  console.log("⚠️  THIS ENDPOINT ONLY FETCHES - NO GENERATION");

  try {
    const {
      startDate,
      endDate,
      careGiverId,
      careReceiverId,
      status,
      page = 1,
      limit = 100,
    } = req.query;

    const query = {};

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    if (careGiverId) {
      query.$or = [
        { careGiver: careGiverId },
        { secondaryCareGiver: careGiverId },
      ];
    }

    if (careReceiverId) {
      query.careReceiver = careReceiverId;
    }

    if (status) {
      query.status = status;
    }

    console.log("📥 Fetching appointments from database...");
    const total = await Appointment.countDocuments(query);

    const appointments = await Appointment.find(query)
      .populate("careReceiver", "name address phone")
      .populate("careGiver", "name email phone")
      .populate("secondaryCareGiver", "name email phone")
      .sort({ date: 1, startTime: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log(
      `✅ Fetched ${appointments.length} appointments (total: ${total})`
    );
    console.log("✅ NO GENERATION OCCURRED");
    console.log("========================================\n");

    res.json({
      success: true,
      data: {
        appointments,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("❌ Error in getAllAppointments:", error.message);
    console.log("========================================\n");
    next(error);
  }
};

// @desc    Get unscheduled appointments with detailed reasons
// @route   GET /api/schedule/unscheduled
// @access  Private
exports.getUnscheduled = async (req, res, next) => {
  console.log("\n========================================");
  console.log("🔵 GET /schedule/unscheduled CALLED");
  console.log("========================================");
  console.log("Query params:", req.query);
  console.log("⚠️  THIS ENDPOINT ONLY CALCULATES - NO GENERATION");

  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Start date and end date are required",
          code: "MISSING_DATES",
        },
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    console.log("📥 Calculating unscheduled appointments...");

    // FRESH: Query all active care receivers
    const careReceivers = await CareReceiver.find({ isActive: true }).lean();
    const unscheduled = [];

    for (const cr of careReceivers) {
      if (!cr.dailyVisits || cr.dailyVisits.length === 0) {
        continue;
      }

      // Get all dates in range
      const dates = [];
      const currentDate = new Date(start);
      while (currentDate <= end) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Get existing appointments
      const existingAppointments = await Appointment.find({
        careReceiver: cr._id,
        date: { $gte: start, $lte: end },
      }).lean();

      // Build map of existing appointments by date and visit number
      const appointmentMap = new Map();
      existingAppointments.forEach((apt) => {
        const dateKey = apt.date.toISOString().split("T")[0];
        const visitKey = `${dateKey}-${apt.visitNumber}`;
        appointmentMap.set(visitKey, apt);
      });

      // Find missing appointments with reasons
      const details = [];
      for (const date of dates) {
        const dateStr = date.toISOString().split("T")[0];

        for (const visit of cr.dailyVisits) {
          const visitKey = `${dateStr}-${visit.visitNumber}`;

          if (!appointmentMap.has(visitKey)) {
            // This appointment is missing - analyze why
            const reason = await findSchedulingFailureReason(cr, visit, date);

            details.push({
              date: dateStr,
              visitNumber: visit.visitNumber,
              preferredTime: visit.preferredTime,
              duration: visit.duration,
              requirements: visit.requirements,
              doubleHanded: visit.doubleHanded,
              priority: visit.priority,
              notes: visit.notes,
              reason: reason,
            });
          }
        }
      }

      if (details.length > 0) {
        unscheduled.push({
          careReceiver: {
            id: cr._id,
            name: cr.name,
            dailyVisits: cr.dailyVisits.length,
            genderPreference: cr.genderPreference,
            address: cr.address,
            coordinates: cr.coordinates,
          },
          expected: dates.length * cr.dailyVisits.length,
          actual: existingAppointments.length,
          missing: details.length,
          details: details,
        });
      }
    }

    console.log(
      `✅ Calculated ${unscheduled.length} care receivers with unscheduled appointments`
    );
    console.log("✅ NO GENERATION OCCURRED");
    console.log("========================================\n");

    res.json({
      success: true,
      data: {
        unscheduled,
        total: unscheduled.length,
      },
    });
  } catch (error) {
    console.error("❌ Error in getUnscheduled:", error.message);
    console.log("========================================\n");
    next(error);
  }
};

// ADD THIS TO scheduleController.js
// Place it after the getUnscheduled function

// @desc    Analyze why a specific appointment couldn't be scheduled
// @route   POST /api/schedule/analyze-unscheduled
// @access  Private
exports.analyzeUnscheduled = async (req, res, next) => {
  console.log("\n🔍 POST /schedule/analyze-unscheduled CALLED");

  try {
    const { careReceiver: careReceiverId, visit, date } = req.body;

    if (!careReceiverId || !visit || !date) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Missing required fields: careReceiver, visit, date",
          code: "MISSING_FIELDS",
        },
      });
    }

    // Get care receiver
    const careReceiver = await CareReceiver.findById(careReceiverId).lean();
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    // Calculate end time
    const [hours, minutes] = visit.preferredTime.split(":").map(Number);
    const endMinutes = minutes + visit.duration;
    const endTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

    // Get all active care givers
    const allCareGivers = await CareGiver.find({ isActive: true }).lean();

    // Analyze each care giver
    const careGiverAnalysis = [];

    for (const cg of allCareGivers) {
      const analysis = {
        _id: cg._id,
        name: cg.name,
        email: cg.email,
        phone: cg.phone,
        skills: cg.skills,
        gender: cg.gender,
        canAssign: true,
        rejectionReasons: [],
        matchScore: 100,
        distance: null,
      };

      // Check skills
      const normalizedCgSkills = cg.skills.map((s) =>
        s.toLowerCase().replace(/ /g, "_")
      );
      const normalizedRequired = (visit.requirements || []).map((r) =>
        r.toLowerCase().replace(/ /g, "_")
      );

      const missingSkills = normalizedRequired.filter(
        (req) => !normalizedCgSkills.includes(req)
      );

      if (missingSkills.length > 0) {
        analysis.canAssign = false;
        analysis.rejectionReasons.push(
          `Missing required skills: ${missingSkills.map((s) => s.replace(/_/g, " ")).join(", ")}`
        );
        analysis.matchScore -= 30;
      }

      // Check gender preference
      if (
        careReceiver.genderPreference &&
        careReceiver.genderPreference !== "no_preference" &&
        cg.gender.toLowerCase() !== careReceiver.genderPreference.toLowerCase()
      ) {
        analysis.rejectionReasons.push(
          `Gender mismatch (preference: ${careReceiver.genderPreference}, care giver: ${cg.gender})`
        );
        analysis.matchScore -= 10;
      }

      // Check availability
      const appointmentDate = new Date(date);
      const availabilityCheck = await checkCareGiverAvailabilityFresh(
        cg._id,
        appointmentDate,
        visit.preferredTime,
        endTime,
        careReceiver
      );

      if (!availabilityCheck.available) {
        analysis.canAssign = false;
        analysis.rejectionReasons.push(availabilityCheck.reason);
        analysis.matchScore -= 40;
      } else {
        analysis.distance = availabilityCheck.distance;
      }

      // Ensure score is between 0-100
      analysis.matchScore = Math.max(0, Math.min(100, analysis.matchScore));

      careGiverAnalysis.push(analysis);
    }

    // Sort: Available first, then by match score
    careGiverAnalysis.sort((a, b) => {
      if (a.canAssign !== b.canAssign) {
        return a.canAssign ? -1 : 1;
      }
      return b.matchScore - a.matchScore;
    });

    console.log(`✅ Analyzed ${careGiverAnalysis.length} care givers`);
    console.log(
      `   Can assign: ${careGiverAnalysis.filter((a) => a.canAssign).length}`
    );

    res.json({
      success: true,
      data: {
        careReceiver: {
          id: careReceiver._id,
          name: careReceiver.name,
          genderPreference: careReceiver.genderPreference,
        },
        visit: visit,
        date: date,
        careGiverAnalysis: careGiverAnalysis,
        summary: {
          total: careGiverAnalysis.length,
          available: careGiverAnalysis.filter((a) => a.canAssign).length,
          unavailable: careGiverAnalysis.filter((a) => !a.canAssign).length,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error in analyzeUnscheduled:", error);
    next(error);
  }
};

// Helper function (reuse the one we already have)
async function checkCareGiverAvailabilityFresh(
  careGiverId,
  date,
  startTime,
  endTime,
  careReceiver
) {
  const careGiver = await CareGiver.findById(careGiverId).lean();

  if (!careGiver || !careGiver.isActive) {
    return {
      available: false,
      reason: careGiver ? "Inactive" : "Care giver not found",
    };
  }

  let availability = await Availability.findOne({
    careGiver: careGiverId,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
    isActive: true,
  }).lean();

  if (
    !availability &&
    careGiver.availability &&
    careGiver.availability.length > 0
  ) {
    availability = {
      schedule: careGiver.availability,
      timeOff: careGiver.timeOff || [],
    };
  }

  if (!availability) {
    return { available: false, reason: "No availability schedule" };
  }

  const isOnTimeOff = (availability.timeOff || []).some((to) => {
    const startDate = new Date(to.startDate);
    const endDate = new Date(to.endDate);
    return date >= startDate && date <= endDate;
  });

  if (isOnTimeOff) {
    return { available: false, reason: "On time off" };
  }

  const dayOfWeek = date.toLocaleDateString("en-GB", { weekday: "long" });
  const daySchedule = availability.schedule.find(
    (s) => s.dayOfWeek === dayOfWeek
  );

  if (!daySchedule || daySchedule.slots.length === 0) {
    return { available: false, reason: `Not working on ${dayOfWeek}` };
  }

  const isInWorkingHours = daySchedule.slots.some((slot) => {
    return startTime >= slot.startTime && endTime <= slot.endTime;
  });

  if (!isInWorkingHours) {
    return { available: false, reason: "Outside working hours" };
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const conflicts = await Appointment.find({
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ["scheduled", "in_progress"] },
  }).lean();

  for (const apt of conflicts) {
    if (
      (startTime >= apt.startTime && startTime < apt.endTime) ||
      (endTime > apt.startTime && endTime <= apt.endTime) ||
      (startTime <= apt.startTime && endTime >= apt.endTime)
    ) {
      return { available: false, reason: "Has conflicting appointment" };
    }
  }

  let distance = null;
  if (
    careGiver.coordinates?.coordinates &&
    careReceiver.coordinates?.coordinates
  ) {
    distance = calculateDistance(
      careGiver.coordinates.coordinates,
      careReceiver.coordinates.coordinates
    );
  }

  return {
    available: true,
    distance: distance,
  };
}

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

// @desc    Get schedule statistics
// @route   GET /api/schedule/stats
// @access  Private
exports.getScheduleStats = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const query = {};
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const [totalAppointments, scheduled, completed, cancelled, missed] =
      await Promise.all([
        Appointment.countDocuments(query),
        Appointment.countDocuments({ ...query, status: "scheduled" }),
        Appointment.countDocuments({ ...query, status: "completed" }),
        Appointment.countDocuments({ ...query, status: "cancelled" }),
        Appointment.countDocuments({ ...query, status: "missed" }),
      ]);

    const completionRate =
      totalAppointments > 0
        ? ((completed / totalAppointments) * 100).toFixed(1)
        : 0;

    res.json({
      success: true,
      data: {
        stats: {
          total: totalAppointments,
          scheduled,
          completed,
          cancelled,
          missed,
          completionRate: `${completionRate}%`,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get fresh care receiver data for manual scheduling
// @route   GET /api/schedule/care-receiver/:id/fresh
// @access  Private
exports.getFreshCareReceiverData = async (req, res, next) => {
  try {
    console.log("\n=== GET FRESH CARE RECEIVER DATA ===");

    // Force fresh query from database (no cache)
    const careReceiver = await CareReceiver.findById(req.params.id).lean();

    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    console.log("Fresh care receiver data loaded:", careReceiver.name);
    console.log("Daily visits:", careReceiver.dailyVisits?.length || 0);
    console.log("Gender preference:", careReceiver.genderPreference || "None");
    console.log(
      "Coordinates:",
      careReceiver.coordinates?.coordinates || "None"
    );
    console.log("===================================\n");

    res.json({
      success: true,
      data: { careReceiver },
    });
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// MANUAL SCHEDULING (POST - CREATES APPOINTMENTS)
// =============================================================================

// @desc    Find available care givers for manual scheduling (FRESH DATA)
// @route   POST /api/schedule/find-available
// @access  Private
exports.findAvailableForManual = async (req, res, next) => {
  try {
    const {
      careReceiverId,
      date,
      startTime,
      endTime,
      requirements,
      doubleHanded,
    } = req.body;

    console.log("\n=== FIND AVAILABLE CARE GIVERS (FRESH DATA) ===");
    console.log("Date:", date);
    console.log("Time:", startTime, "-", endTime);
    console.log("Requirements:", requirements);
    console.log("Double-handed:", doubleHanded);

    if (!careReceiverId || !date || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Missing required fields",
          code: "MISSING_FIELDS",
        },
      });
    }

    // STEP 1: Get FRESH care receiver data from database
    console.log("\n--- STEP 1: Fetching FRESH care receiver data ---");
    const careReceiver = await CareReceiver.findById(careReceiverId).lean();

    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    console.log("Care Receiver:", careReceiver.name);
    console.log(
      "  Gender Preference:",
      careReceiver.genderPreference || "None"
    );
    console.log("  Address:", careReceiver.address?.full || "No address");
    console.log(
      "  Coordinates:",
      careReceiver.coordinates?.coordinates || "No coordinates"
    );

    const appointmentDate = new Date(date);

    // STEP 2: Get ALL active care givers with FRESH data
    console.log("\n--- STEP 2: Fetching ALL active care givers (FRESH) ---");
    const allCareGivers = await CareGiver.find({ isActive: true }).lean();
    console.log(`Found ${allCareGivers.length} active care givers in database`);

    // Log each care giver's current skills
    allCareGivers.forEach((cg) => {
      console.log(`\n${cg.name}:`);
      console.log(`  Skills: [${cg.skills.join(", ")}]`);
      console.log(`  Gender: ${cg.gender}`);
      console.log(`  Can Drive: ${cg.canDrive}`);
      console.log(`  Address: ${cg.address?.city || "Unknown"}`);
      console.log(
        `  Working Days: ${cg.availability?.length || 0} days configured`
      );
    });

    // STEP 3: Filter by skills (if requirements provided)
    console.log("\n--- STEP 3: Filtering by skills ---");
    let potentialCareGivers = allCareGivers;

    if (requirements && requirements.length > 0) {
      console.log("Filtering for requirements:", requirements);

      potentialCareGivers = allCareGivers.filter((cg) => {
        // Normalize both requirement and skill names
        const normalizedSkills = cg.skills.map((s) =>
          s.toLowerCase().replace(/ /g, "_")
        );
        const normalizedRequirements = requirements.map((r) =>
          r.toLowerCase().replace(/ /g, "_")
        );

        const hasAllSkills = normalizedRequirements.every((req) =>
          normalizedSkills.includes(req)
        );

        console.log(`\n  ${cg.name}:`);
        console.log(`    Has: [${normalizedSkills.join(", ")}]`);
        console.log(`    Needs: [${normalizedRequirements.join(", ")}]`);
        console.log(`    Match: ${hasAllSkills ? "✅ YES" : "❌ NO"}`);

        return hasAllSkills;
      });

      console.log(
        `\nAfter skill filtering: ${potentialCareGivers.length} care givers qualify`
      );
    } else {
      console.log("No skill requirements - all care givers qualify");
    }

    // STEP 4: Check each care giver's FRESH availability
    console.log("\n--- STEP 4: Checking availability for each care giver ---");
    const availableCareGivers = [];

    for (const cg of potentialCareGivers) {
      console.log(`\n>>> Checking ${cg.name}...`);

      const availabilityCheck = await checkCareGiverAvailabilityFresh(
        cg._id,
        appointmentDate,
        startTime,
        endTime,
        careReceiver
      );

      console.log(
        `    Available: ${availabilityCheck.available ? "✅ YES" : "❌ NO"}`
      );
      if (!availabilityCheck.available) {
        console.log(`    Reason: ${availabilityCheck.reason}`);
      } else {
        console.log(
          `    Distance: ${availabilityCheck.distance?.toFixed(2)} km`
        );
        console.log(
          `    Travel Time: ~${availabilityCheck.travelTime} minutes`
        );
      }

      if (availabilityCheck.available) {
        availableCareGivers.push({
          ...cg,
          distance: availabilityCheck.distance,
          travelTime: availabilityCheck.travelTime,
          availabilityDetails: availabilityCheck.details,
        });
      }
    }

    console.log("\n--- FINAL RESULTS ---");
    console.log(`Total available: ${availableCareGivers.length} care givers`);
    if (availableCareGivers.length > 0) {
      console.log("Available care givers:");
      availableCareGivers.forEach((cg) => {
        console.log(`  - ${cg.name} (${cg.distance?.toFixed(1)} km away)`);
      });
    }
    console.log("==========================================\n");

    res.json({
      success: true,
      data: {
        availableCareGivers,
        total: availableCareGivers.length,
        careReceiverPreferences: {
          genderPreference: careReceiver.genderPreference,
          requirements: requirements,
          doubleHanded: doubleHanded,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error finding available care givers:", error);
    next(error);
  }
};

// @desc    Create manual appointment
// @route   POST /api/schedule/appointments/manual
// @access  Private
exports.createManualAppointment = async (req, res, next) => {
  try {
    const {
      careReceiverId,
      careGiverId,
      secondaryCareGiverId,
      date,
      startTime,
      endTime,
      duration,
      visitNumber,
      requirements,
      doubleHanded,
      priority,
      notes,
    } = req.body;

    // Validate required fields
    if (!careReceiverId || !careGiverId || !date || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Missing required fields",
          code: "MISSING_FIELDS",
        },
      });
    }

    // Verify care receiver exists
    const careReceiver = await CareReceiver.findById(careReceiverId);
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care receiver not found",
          code: "CARE_RECEIVER_NOT_FOUND",
        },
      });
    }

    // Verify care giver exists
    const careGiver = await CareGiver.findById(careGiverId);
    if (!careGiver) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Care giver not found",
          code: "CARE_GIVER_NOT_FOUND",
        },
      });
    }

    // Create appointment
    const appointment = await Appointment.create({
      careReceiver: careReceiverId,
      careGiver: careGiverId,
      secondaryCareGiver: secondaryCareGiverId || undefined,
      date: new Date(date),
      startTime,
      endTime,
      duration: duration || 60,
      visitNumber: visitNumber || 1,
      requirements: requirements || [],
      doubleHanded: doubleHanded || false,
      priority: priority || 3,
      notes: notes || "",
      status: "scheduled",
      schedulingMetadata: {
        scheduledAt: new Date(),
        scheduledBy: req.user?._id,
        schedulingMethod: "manual",
      },
    });

    await appointment.populate("careReceiver careGiver secondaryCareGiver");

    // Create notification
    try {
      await notificationService.notifyManualSchedule(req.user?._id, {
        appointmentId: appointment._id,
        careReceiverName: careReceiver.name,
        careGiverName: careGiver.name,
        date: date,
        time: startTime,
      });
    } catch (notifError) {
      console.error("Failed to create notification:", notifError.message);
    }

    res.status(201).json({
      success: true,
      data: { appointment },
      message: "Appointment created successfully",
    });
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// UPDATE/DELETE OPERATIONS
// =============================================================================

// @desc    Update appointment status
// @route   PATCH /api/schedule/appointments/:id/status
// @access  Private
exports.updateAppointmentStatus = async (req, res, next) => {
  try {
    const { status, cancellationReason } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Status is required",
          code: "MISSING_STATUS",
        },
      });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Appointment not found",
          code: "APPOINTMENT_NOT_FOUND",
        },
      });
    }

    appointment.status = status;

    if (status === "cancelled" && cancellationReason) {
      appointment.cancellationReason = cancellationReason;
    }

    if (status === "completed") {
      appointment.completedAt = new Date();
      appointment.completedBy = req.user?._id;
    }

    await appointment.save();

    res.json({
      success: true,
      data: { appointment },
      message: "Appointment status updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete appointment
// @route   DELETE /api/schedule/appointments/:id
// @access  Private
exports.deleteAppointment = async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Appointment not found",
          code: "APPOINTMENT_NOT_FOUND",
        },
      });
    }

    await Appointment.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Appointment deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// HELPER FUNCTIONS (DEFINED ONCE)
// =============================================================================

// Helper to find why scheduling failed (ANALYSIS ONLY - NO CREATION)
async function findSchedulingFailureReason(careReceiver, visit, date) {
  try {
    const [hours, minutes] = visit.preferredTime.split(":").map(Number);
    const endMinutes = minutes + visit.duration;
    const endTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

    const bestCareGiver = await findBestCareGiver(
      careReceiver,
      visit,
      date,
      visit.preferredTime,
      endTime
    );

    if (bestCareGiver.careGiver) {
      return "Available care giver found but not auto-scheduled";
    }

    return bestCareGiver.reason || "No available care giver found";
  } catch (error) {
    return "Unable to determine reason";
  }
}

// Helper to check care giver availability with FRESH data
async function checkCareGiverAvailabilityFresh(
  careGiverId,
  date,
  startTime,
  endTime,
  careReceiver
) {
  console.log(`    Checking availability...`);

  // FRESH: Re-query care giver to get latest data
  const careGiver = await CareGiver.findById(careGiverId).lean();

  if (!careGiver || !careGiver.isActive) {
    return {
      available: false,
      reason: careGiver ? "Inactive" : "Care giver not found",
    };
  }

  // FRESH: Get current availability from Availability collection
  let availability = await Availability.findOne({
    careGiver: careGiverId,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
    isActive: true,
  }).lean();

  // Fallback to embedded availability if collection is empty
  if (
    !availability &&
    careGiver.availability &&
    careGiver.availability.length > 0
  ) {
    console.log(`    Using embedded availability`);
    availability = {
      schedule: careGiver.availability,
      timeOff: careGiver.timeOff || [],
    };
  }

  if (!availability) {
    return { available: false, reason: "No availability schedule" };
  }

  // Check time off
  const isOnTimeOff = (availability.timeOff || []).some((to) => {
    const startDate = new Date(to.startDate);
    const endDate = new Date(to.endDate);
    return date >= startDate && date <= endDate;
  });

  if (isOnTimeOff) {
    return { available: false, reason: "On time off" };
  }

  // Check working hours
  const dayOfWeek = date.toLocaleDateString("en-GB", { weekday: "long" });
  const daySchedule = availability.schedule.find(
    (s) => s.dayOfWeek === dayOfWeek
  );

  if (!daySchedule || daySchedule.slots.length === 0) {
    return { available: false, reason: `Not working on ${dayOfWeek}` };
  }

  const isInWorkingHours = daySchedule.slots.some((slot) => {
    return startTime >= slot.startTime && endTime <= slot.endTime;
  });

  if (!isInWorkingHours) {
    console.log(
      `    Working hours: ${daySchedule.slots.map((s) => `${s.startTime}-${s.endTime}`).join(", ")}`
    );
    console.log(`    Requested: ${startTime}-${endTime}`);
    return { available: false, reason: "Outside working hours" };
  }

  // FRESH: Check conflicts with current appointments
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const conflicts = await Appointment.find({
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ["scheduled", "in_progress"] },
  }).lean();

  for (const apt of conflicts) {
    if (
      (startTime >= apt.startTime && startTime < apt.endTime) ||
      (endTime > apt.startTime && endTime <= apt.endTime) ||
      (startTime <= apt.startTime && endTime >= apt.endTime)
    ) {
      return { available: false, reason: "Has conflicting appointment" };
    }
  }

  // Calculate distance with FRESH coordinates
  let distance = null;
  let travelTime = null;

  if (
    careGiver.coordinates?.coordinates &&
    careReceiver.coordinates?.coordinates
  ) {
    distance = calculateDistance(
      careGiver.coordinates.coordinates,
      careReceiver.coordinates.coordinates
    );
    travelTime = Math.ceil((distance / 40) * 60); // Assume 40 km/h average

    console.log(`    Distance calculated: ${distance.toFixed(2)} km`);
  } else {
    console.log(`    Distance: Cannot calculate (missing coordinates)`);
  }

  return {
    available: true,
    distance: distance,
    travelTime: travelTime,
    details: {
      workingHours: daySchedule.slots[0],
      conflicts: conflicts.length,
      dayOfWeek: dayOfWeek,
    },
  };
}

// Calculate distance between two coordinates
function calculateDistance(coords1, coords2) {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  const R = 6371; // Earth's radius in km
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

// Calculate duration between start and end time
function calculateDuration(startTime, endTime) {
  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  return endHours * 60 + endMinutes - (startHours * 60 + startMinutes);
}

// @desc    Validate all scheduled appointments and detect conflicts
// @route   POST /api/schedule/validate
// @access  Private
// FIXED validateSchedule - Only flags REAL conflicts
// Replace the validateSchedule function in scheduleController.js

exports.validateSchedule = async (req, res, next) => {
  console.log("\n🔍 POST /schedule/validate CALLED");
  console.log("Validating all scheduled appointments...");

  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Start date and end date are required",
          code: "MISSING_DATES",
        },
      });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Get all scheduled appointments in range
    const appointments = await Appointment.find({
      date: { $gte: start, $lte: end },
      status: { $in: ["scheduled", "needs_reassignment"] },
    })
      .populate("careReceiver", "name dailyVisits genderPreference coordinates")
      .populate(
        "careGiver",
        "name email availability timeOff coordinates isActive"
      )
      .populate(
        "secondaryCareGiver",
        "name email availability timeOff coordinates isActive"
      );

    console.log(`Found ${appointments.length} appointments to validate`);

    const invalidAppointments = [];
    const validAppointments = [];
    let updatedCount = 0;

    for (const apt of appointments) {
      const issues = [];

      // ========================================
      // CRITICAL CHECKS ONLY
      // ========================================

      // Check 1: Care receiver still exists
      if (!apt.careReceiver) {
        issues.push("Care receiver no longer exists");
      }

      // Check 2: Care giver still exists and is active
      if (!apt.careGiver) {
        issues.push("Care giver no longer exists");
      } else if (!apt.careGiver.isActive) {
        issues.push("Care giver is now inactive");
      }

      // Check 3: TIME OFF - Most important check
      if (apt.careGiver && apt.careGiver.isActive && apt.careGiver.timeOff) {
        const appointmentDate = new Date(apt.date);

        for (const timeOff of apt.careGiver.timeOff) {
          const timeOffStart = new Date(timeOff.startDate);
          timeOffStart.setHours(0, 0, 0, 0);

          const timeOffEnd = new Date(timeOff.endDate);
          timeOffEnd.setHours(23, 59, 59, 999);

          // Check if appointment date falls within time off period
          if (
            appointmentDate >= timeOffStart &&
            appointmentDate <= timeOffEnd
          ) {
            const reason = timeOff.reason || "Personal";
            issues.push(`Care giver is now on time off (${reason})`);
            console.log(
              `  ❌ Appointment on ${apt.date.toISOString().split("T")[0]} - Care giver on time off`
            );
            break;
          }
        }
      }

      // Check 4: Secondary care giver (if double-handed)
      if (apt.doubleHanded && apt.secondaryCareGiver) {
        if (!apt.secondaryCareGiver.isActive) {
          issues.push("Secondary care giver is now inactive");
        }

        // Check secondary care giver time off
        if (apt.secondaryCareGiver.timeOff) {
          const appointmentDate = new Date(apt.date);

          for (const timeOff of apt.secondaryCareGiver.timeOff) {
            const timeOffStart = new Date(timeOff.startDate);
            timeOffStart.setHours(0, 0, 0, 0);

            const timeOffEnd = new Date(timeOff.endDate);
            timeOffEnd.setHours(23, 59, 59, 999);

            if (
              appointmentDate >= timeOffStart &&
              appointmentDate <= timeOffEnd
            ) {
              const reason = timeOff.reason || "Personal";
              issues.push(
                `Secondary care giver is now on time off (${reason})`
              );
              break;
            }
          }
        }
      } else if (apt.doubleHanded && !apt.secondaryCareGiver) {
        issues.push(
          "Double-handed care required but no secondary care giver assigned"
        );
      }

      // ========================================
      // NOTE: We do NOT check for:
      // - Availability schedule changes (too strict)
      // - Care receiver time preference changes (too strict)
      // - Skills changes (unless critical)
      //
      // These should only be flagged if explicitly requested
      // or as warnings, not as "needs reassignment"
      // ========================================

      // Update appointment status
      if (issues.length > 0) {
        // Mark as needs reassignment
        apt.status = "needs_reassignment";
        apt.invalidationReason = issues.join("; ");
        apt.invalidatedAt = new Date();
        await apt.save();

        invalidAppointments.push({
          _id: apt._id,
          careReceiver: apt.careReceiver?.name,
          careGiver: apt.careGiver?.name,
          date: apt.date,
          startTime: apt.startTime,
          endTime: apt.endTime,
          issues: issues,
        });

        updatedCount++;
        console.log(
          `  ❌ CONFLICT: ${apt.careReceiver?.name} on ${apt.date.toISOString().split("T")[0]} - ${issues.join("; ")}`
        );
      } else {
        // Still valid - ensure status is scheduled
        if (apt.status === "needs_reassignment") {
          apt.status = "scheduled";
          apt.invalidationReason = null;
          apt.invalidatedAt = null;
          await apt.save();
          updatedCount++;
          console.log(
            `  ✅ RESOLVED: ${apt.careReceiver?.name} on ${apt.date.toISOString().split("T")[0]} - back to scheduled`
          );
        }

        validAppointments.push({
          _id: apt._id,
          careReceiver: apt.careReceiver?.name,
          careGiver: apt.careGiver?.name,
          date: apt.date,
          startTime: apt.startTime,
        });
      }
    }

    console.log(`\n✅ Validation complete:`);
    console.log(`   Valid: ${validAppointments.length}`);
    console.log(`   Invalid: ${invalidAppointments.length}`);
    console.log(`   Updated: ${updatedCount}\n`);

    res.json({
      success: true,
      data: {
        summary: {
          total: appointments.length,
          valid: validAppointments.length,
          invalid: invalidAppointments.length,
          updated: updatedCount,
        },
        invalidAppointments: invalidAppointments,
        validAppointments: validAppointments,
      },
      message:
        invalidAppointments.length > 0
          ? `Found ${invalidAppointments.length} appointments that need reassignment`
          : `All appointments are valid`,
    });
  } catch (error) {
    console.error("❌ Error in validateSchedule:", error);
    next(error);
  }
};

// =============================================================================
// EXPORTS (ALL FUNCTIONS EXPORTED)
// =============================================================================

module.exports = {
  generateSchedule: exports.generateSchedule,
  getAllAppointments: exports.getAllAppointments,
  getUnscheduled: exports.getUnscheduled,
  getScheduleStats: exports.getScheduleStats,
  getFreshCareReceiverData: exports.getFreshCareReceiverData,
  findAvailableForManual: exports.findAvailableForManual,
  createManualAppointment: exports.createManualAppointment,
  updateAppointmentStatus: exports.updateAppointmentStatus,
  deleteAppointment: exports.deleteAppointment,
  validateSchedule: exports.validateSchedule,
};
