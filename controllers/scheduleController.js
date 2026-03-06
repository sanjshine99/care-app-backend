// backend/controllers/scheduleController.js
// FINAL CLEAN VERSION - Time off bug fixed, no duplicates

const Appointment = require("../models/Appointment");
const CareReceiver = require("../models/CareReceiver");
const CareGiver = require("../models/CareGiver");
const Availability = require("../models/Availability");
const {
  scheduleForCareReceiver,
  bulkSchedule,
  findBestCareGiver,
  findSecondaryCareGiver,
  isDateInSchedule,
  isCareGiverAvailable,
  calculateDistance,
} = require("../services/schedulingService");
const notificationService = require("../services/notificationService");
const settingsService = require("../services/settingsService");
const { normalizeTimeToHHMM } = require("../utils/timeUtils");
const { parseStartOfDayUTC, parseEndOfDayUTC, toDateString, getDayOfWeekUTC, toStartOfDayUTC, toEndOfDayUTC, toUTCDateValue, todayUTC } = require("../utils/dateUtils");
const { ACTIVE_APPOINTMENT_STATUSES, CALENDAR_VISIBLE_STATUSES } = require("../utils/constants");
const logger = require("../utils/logger");

// =============================================================================
// SCHEDULE GENERATION (POST ONLY)
// =============================================================================

// @desc    Generate schedule for care receiver(s) - enqueues job, returns jobId
// @route   POST /api/schedule/generate
// @access  Private
exports.generateSchedule = async (req, res, next) => {
  try {
    const jobQueueService = require("../services/jobQueueService");
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

    const start = parseStartOfDayUTC(startDate);
    const end = parseEndOfDayUTC(endDate);

    if (start > end) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Start date must be before end date",
          code: "INVALID_DATE_RANGE",
        },
      });
    }

    const job = await jobQueueService.enqueue(req.user._id, "schedule_bulk", {
      careReceiverIds: careReceiverIds || null,
      careReceiverId: careReceiverId || null,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    logger.info("Schedule generation job enqueued", {
      jobId: job._id,
      userId: req.user?._id,
    });

    res.status(202).json({
      success: true,
      data: {
        jobId: job._id,
        status: "queued",
        message: "Schedule generation started. Poll GET /api/schedule/jobs/:jobId for progress.",
      },
    });
  } catch (error) {
    logger.error("Schedule generation enqueue failed", { error: error.message });
    next(error);
  }
};

// @desc    Get job progress and result
// @route   GET /api/schedule/jobs/:jobId
// @access  Private
exports.getJobProgress = async (req, res, next) => {
  try {
    const jobQueueService = require("../services/jobQueueService");
    const job = await jobQueueService.getById(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { message: "Job not found", code: "JOB_NOT_FOUND" },
      });
    }
    if (job.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: { message: "Forbidden", code: "FORBIDDEN" },
      });
    }
    res.json({
      success: true,
      data: {
        jobId: job._id,
        type: job.type,
        status: job.status,
        progressPercent: job.progressPercent ?? 0,
        totalSteps: job.totalSteps,
        completedSteps: job.completedSteps,
        resultSummary: job.resultSummary,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get active scheduling jobs for current user (queued or running)
// @route   GET /api/schedule/jobs/active
// @access  Private
exports.getActiveJobs = async (req, res, next) => {
  try {
    const jobQueueService = require("../services/jobQueueService");
    const jobs = await jobQueueService.getActiveByUserId(req.user._id);
    const schedulingInProgress = jobs.map((job) => {
      const payload = job.payload || {};
      const careReceiverId = payload.careReceiverId || payload.careReceiverIds?.[0];
      return {
        jobId: job._id,
        type: job.type,
        status: job.status,
        careReceiverId: careReceiverId?.toString?.() || careReceiverId,
        startDate: payload.startDate,
        endDate: payload.endDate,
        startedAt: job.startedAt,
        createdAt: job.createdAt,
      };
    });
    res.json({
      success: true,
      data: {
        jobs,
        schedulingInProgress,
      },
    });
  } catch (error) {
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
    } else {
      // Default: show calendar-visible statuses only (hide needs_reassignment/needs_review)
      query.status = { $in: CALENDAR_VISIBLE_STATUSES };
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
      ` Fetched ${appointments.length} appointments (total: ${total})`,
    );
    console.log(" NO GENERATION OCCURRED");
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
    console.error(" Error in getAllAppointments:", error.message);
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
  console.log("  THIS ENDPOINT ONLY CALCULATES - NO GENERATION");

  try {
    const { startDate, endDate, summaryOnly } = req.query;

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
    const skipReasons = summaryOnly === "true" || summaryOnly === true;

    const todayDate = todayUTC();

    const jobQueueService = require("../services/jobQueueService");
    const activeJobs = await jobQueueService.getActiveByUserId(req.user._id);
    const schedulingInProgress = [];
    for (const job of activeJobs) {
      const payload = job.payload || {};
      const ids = payload.careReceiverId
        ? [payload.careReceiverId]
        : payload.careReceiverIds || [];
      for (const id of ids) {
        if (id) {
          schedulingInProgress.push({
            jobId: job._id,
            careReceiverId: id.toString(),
            startedAt: job.startedAt,
          });
        }
      }
    }

    console.log("📥 Calculating unscheduled appointments...", skipReasons ? "(summaryOnly)" : "");

    // Select only the fields needed for unscheduled calculation to reduce memory usage
    const careReceivers = await CareReceiver.find({ isActive: true })
      .select("_id name dailyVisits genderPreference address coordinates createdAt updatedAt")
      .lean();
    const careReceiverIds = careReceivers.map((cr) => cr._id);

    // Only count active appointments — cancelled/needs_reassignment/missed
    // should NOT prevent a visit from appearing as unscheduled
    const activeStatuses = ["scheduled", "in_progress", "completed"];
    const allAppointments = await Appointment.find({
      careReceiver: { $in: careReceiverIds },
      date: { $gte: start, $lte: end },
      status: { $in: activeStatuses },
    })
      .select("_id careReceiver date visitNumber status")
      .lean();

    const appointmentsByCr = new Map();
    allAppointments.forEach((apt) => {
      const key = apt.careReceiver.toString();
      if (!appointmentsByCr.has(key)) {
        appointmentsByCr.set(key, []);
      }
      appointmentsByCr.get(key).push(apt);
    });

    const unscheduled = [];

    for (const cr of careReceivers) {
      if (!cr.dailyVisits || cr.dailyVisits.length === 0) {
        continue;
      }

      const existingAppointments =
        appointmentsByCr.get(cr._id.toString()) || [];

      const createdAtUTC = cr.createdAt
        ? new Date(toUTCDateValue(cr.createdAt))
        : todayDate;
      const effectiveStart = new Date(
        Math.max(
          start.getTime(),
          createdAtUTC.getTime(),
          todayDate.getTime(),
        ),
      );

      const dates = [];
      const currentDate = new Date(effectiveStart);
      while (currentDate <= end) {
        dates.push(new Date(currentDate));
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }

      const appointmentMap = new Map();
      existingAppointments.forEach((apt) => {
        const dateKey = toDateString(apt.date);
        const visitKey = `${dateKey}-${apt.visitNumber}`;
        appointmentMap.set(visitKey, apt);
      });

      let expectedCount = 0;
      const details = [];

      for (const date of dates) {
        const dateStr = toDateString(date);

        for (const visit of cr.dailyVisits) {
          const shouldHaveAppointment = isDateInSchedule(
            date,
            visit,
            cr.createdAt,
            cr.updatedAt,
          );

          if (shouldHaveAppointment) {
            expectedCount++;

            const visitKey = `${dateStr}-${visit.visitNumber}`;

            if (!appointmentMap.has(visitKey)) {
              const reason = skipReasons
                ? "Not yet scheduled"
                : await findSchedulingFailureReason(cr, visit, date);

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
          expected: expectedCount,
          actual: existingAppointments.length,
          missing: details.length,
          details: details,
        });
      }
    }

    console.log(
      ` Calculated ${unscheduled.length} care receivers with unscheduled appointments`,
    );
    console.log(" NO GENERATION OCCURRED");
    console.log("========================================\n");

    res.json({
      success: true,
      data: {
        unscheduled,
        total: unscheduled.length,
        schedulingInProgress,
      },
    });
  } catch (error) {
    console.error(" Error in getUnscheduled:", error.message);
    console.log("========================================\n");
    next(error);
  }
};

// @desc    Analyze why a specific appointment couldn't be scheduled
// @route   POST /api/schedule/analyze-unscheduled
// @access  Private
exports.analyzeUnscheduled = async (req, res, next) => {
  console.log("\n POST /schedule/analyze-unscheduled CALLED");

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
    const totalMinutes = hours * 60 + minutes + visit.duration;
    if (totalMinutes > 24 * 60) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Visit extends past midnight. Adjust preferred time or duration.",
          code: "OVERNIGHT_VISIT",
        },
      });
    }
    const endHour = Math.floor(totalMinutes / 60);
    const endMin = totalMinutes % 60;
    const endTime = `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;

    // Get all active care givers
    const allCareGivers = await CareGiver.find({ isActive: true }).lean();

    const settings = await settingsService.getSchedulingSettings();
    const maxDistanceKm = settings.maxDistanceKm ?? 20;

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
        s.toLowerCase().replace(/ /g, "_"),
      );
      const normalizedRequired = (visit.requirements || []).map((r) =>
        r.toLowerCase().replace(/ /g, "_"),
      );

      const missingSkills = normalizedRequired.filter(
        (req) => !normalizedCgSkills.includes(req),
      );

      if (missingSkills.length > 0) {
        analysis.canAssign = false;
        analysis.rejectionReasons.push(
          `Missing required skills: ${missingSkills.map((s) => s.replace(/_/g, " ")).join(", ")}`,
        );
        analysis.matchScore -= 30;
      }

      // Check gender preference (generation never considers opposite gender)
      if (
        careReceiver.genderPreference &&
        careReceiver.genderPreference !== "No Preference" &&
        cg.gender.toLowerCase() !== careReceiver.genderPreference.toLowerCase()
      ) {
        analysis.canAssign = false;
        analysis.rejectionReasons.push(
          `Gender mismatch: Care receiver prefers ${careReceiver.genderPreference}, care giver is ${cg.gender}`,
        );
        analysis.matchScore -= 10;
      }

      // Check availability (same logic as schedule generation: travel time, max appointments)
      const appointmentDate = new Date(date);
      const careReceiverLocation =
        careReceiver.coordinates?.coordinates ?? [];
      let availabilityCheck;

      if (
        !careReceiverLocation ||
        careReceiverLocation.length < 2
      ) {
        availabilityCheck = {
          available: false,
          reason:
            "Care receiver has no valid location coordinates — re-save their address to geocode it",
        };
      } else {
        availabilityCheck = await isCareGiverAvailable(
          cg._id,
          appointmentDate,
          visit.preferredTime,
          endTime,
          careReceiverLocation,
          null,
        );
      }

      if (!availabilityCheck.available) {
        analysis.canAssign = false;
        analysis.rejectionReasons.push(availabilityCheck.reason);
        analysis.matchScore -= 40;
      } else if (
        cg.coordinates?.coordinates &&
        careReceiver.coordinates?.coordinates?.length >= 2
      ) {
        analysis.distance = calculateDistance(
          cg.coordinates.coordinates,
          careReceiver.coordinates.coordinates,
        );
      }

      if (
        analysis.distance != null &&
        analysis.distance > maxDistanceKm
      ) {
        analysis.canAssign = false;
        analysis.rejectionReasons.push(
          `Beyond maximum allowed distance (${maxDistanceKm} km)`,
        );
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

    console.log(` Analyzed ${careGiverAnalysis.length} care givers`);
    console.log(
      `   Can assign: ${careGiverAnalysis.filter((a) => a.canAssign).length}`,
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
    console.error(" Error in analyzeUnscheduled:", error);
    next(error);
  }
};

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

    const [totalAppointments, scheduled, completed, cancelled, missed, needsReassignment] =
      await Promise.all([
        Appointment.countDocuments(query),
        Appointment.countDocuments({ ...query, status: "scheduled" }),
        Appointment.countDocuments({ ...query, status: "completed" }),
        Appointment.countDocuments({ ...query, status: "cancelled" }),
        Appointment.countDocuments({ ...query, status: "missed" }),
        Appointment.countDocuments({ ...query, status: "needs_reassignment" }),
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
          needsReassignment,
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
      careReceiver.coordinates?.coordinates || "None",
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
      careReceiver.genderPreference || "None",
    );
    console.log("  Address:", careReceiver.address?.full || "No address");
    console.log(
      "  Coordinates:",
      careReceiver.coordinates?.coordinates || "No coordinates",
    );

    const appointmentDate = new Date(date);
    const startTimeNorm = normalizeTimeToHHMM(startTime);
    const endTimeNorm = normalizeTimeToHHMM(endTime);

    const careReceiverLocation =
      careReceiver.coordinates?.coordinates ?? [];
    if (!careReceiverLocation.length || careReceiverLocation.length < 2) {
      return res.json({
        success: true,
        data: {
          availableCareGivers: [],
          total: 0,
          careReceiverPreferences: {
            genderPreference: careReceiver.genderPreference,
            requirements: requirements,
            doubleHanded: doubleHanded,
          },
        },
      });
    }

    // STEP 2: Get ALL active care givers
    const allCareGivers = await CareGiver.find({ isActive: true }).lean();
    console.log(`Found ${allCareGivers.length} active care givers`);

    const settings = await settingsService.getSchedulingSettings();
    const maxDistanceKm = settings.maxDistanceKm ?? 20;

    const normalizedRequirements =
      requirements && requirements.length > 0
        ? requirements.map((r) => r.toLowerCase().replace(/ /g, "_"))
        : [];
    const hasGenderPreference =
      careReceiver.genderPreference &&
      careReceiver.genderPreference.toLowerCase() !== "no preference" &&
      careReceiver.genderPreference.toLowerCase() !== "no_preference";

    const availableCareGivers = [];
    const unavailableCareGivers = [];

    for (const cg of allCareGivers) {
      if (normalizedRequirements.length > 0) {
        const normalizedSkills = (cg.skills || []).map((s) =>
          s.toLowerCase().replace(/ /g, "_"),
        );
        const hasAllSkills = normalizedRequirements.every((req) =>
          normalizedSkills.includes(req),
        );
        if (!hasAllSkills) {
          unavailableCareGivers.push({
            careGiver: { ...cg, distance: null, travelTime: null },
            reason: "Missing required skills",
          });
          continue;
        }
      }

      if (hasGenderPreference) {
        const cgGender = (cg.gender || "").toLowerCase();
        const pref = careReceiver.genderPreference.toLowerCase();
        if (cgGender !== pref) {
          unavailableCareGivers.push({
            careGiver: { ...cg, distance: null, travelTime: null },
            reason: "Does not match gender preference",
          });
          continue;
        }
      }

      if (doubleHanded && cg.singleHandedOnly === true) {
        unavailableCareGivers.push({
          careGiver: { ...cg, distance: null, travelTime: null },
          reason: "Single-handed only (double-handed visit required)",
        });
        continue;
      }

      const availabilityCheck = await isCareGiverAvailable(
        cg._id,
        appointmentDate,
        startTimeNorm,
        endTimeNorm,
        careReceiverLocation,
        null,
      );

      if (!availabilityCheck.available) {
        unavailableCareGivers.push({
          careGiver: { ...cg, distance: null, travelTime: null },
          reason: availabilityCheck.reason || "Not available",
        });
        continue;
      }

      let distance = null;
      if (
        cg.coordinates?.coordinates &&
        careReceiver.coordinates?.coordinates?.length >= 2
      ) {
        distance = calculateDistance(
          cg.coordinates.coordinates,
          careReceiver.coordinates.coordinates,
        );
      }
      if (distance != null && distance > maxDistanceKm) {
        unavailableCareGivers.push({
          careGiver: { ...cg, distance, travelTime: null },
          reason: `Outside max distance (${distance.toFixed(1)} km)`,
        });
        continue;
      }

      availableCareGivers.push({
        ...cg,
        distance,
        travelTime: null,
      });
    }

    console.log("\n--- FINAL RESULTS ---");
    console.log(`Total available: ${availableCareGivers.length} care givers`);
    console.log(`Total unavailable: ${unavailableCareGivers.length} care givers`);
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
        unavailableCareGivers,
        total: availableCareGivers.length,
        careReceiverPreferences: {
          genderPreference: careReceiver.genderPreference,
          requirements: requirements,
          doubleHanded: doubleHanded,
        },
      },
    });
  } catch (error) {
    console.error(" Error finding available care givers:", error);
    next(error);
  }
};

// Helper function - Second instance (used by findAvailableForManual)
async function checkCareGiverAvailabilityForManual(
  careGiverId,
  date,
  startTime,
  endTime,
  careReceiver,
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

  // ========================================
  // FIX: Check time off from CareGiver FIRST
  // ========================================
  const isOnTimeOff = (careGiver.timeOff || []).some((to) => {
    const toStart = toStartOfDayUTC(to.startDate);
    const toEnd = toEndOfDayUTC(to.endDate);
    const checkDate = toStartOfDayUTC(date);
    return checkDate >= toStart && checkDate <= toEnd;
  });

  if (isOnTimeOff) {
    console.log(
      `   ${careGiver.name} is on time off on ${toDateString(date)}`,
    );
    return { available: false, reason: "On time off" };
  }
  // ========================================

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
    };
  }

  if (!availability) {
    return { available: false, reason: "No availability schedule" };
  }

  // Check working hours
  const dayOfWeek = getDayOfWeekUTC(date);
  const daySchedule = availability.schedule.find(
    (s) => s.dayOfWeek === dayOfWeek,
  );

  if (!daySchedule || daySchedule.slots.length === 0) {
    return { available: false, reason: `Not working on ${dayOfWeek}` };
  }

  const isInWorkingHours = daySchedule.slots.some((slot) => {
    return startTime >= slot.startTime && endTime <= slot.endTime;
  });

  if (!isInWorkingHours) {
    console.log(
      `    Working hours: ${daySchedule.slots.map((s) => `${s.startTime}-${s.endTime}`).join(", ")}`,
    );
    console.log(`    Requested: ${startTime}-${endTime}`);
    return { available: false, reason: "Outside working hours" };
  }

  // FRESH: Check conflicts with current appointments
  const startOfDay = toStartOfDayUTC(date);
  const endOfDay = toEndOfDayUTC(date);

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
      careReceiver.coordinates.coordinates,
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

    const normalizedStartTime = normalizeTimeToHHMM(startTime);
    const normalizedEndTime = normalizeTimeToHHMM(endTime);

    // Validate startTime < endTime
    const [startH, startM] = normalizedStartTime.split(":").map(Number);
    const [endH, endM] = normalizedEndTime.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    if (endMinutes <= startMinutes) {
      return res.status(400).json({
        success: false,
        error: {
          message: "End time must be after start time",
          code: "INVALID_TIME_RANGE",
        },
      });
    }

    // Check for duplicate appointment in same slot
    const appointmentDate = parseStartOfDayUTC(date);
    const existing = await Appointment.findOne({
      careReceiver: careReceiverId,
      date: appointmentDate,
      visitNumber: visitNumber || 1,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: {
          message: "An appointment already exists for this care receiver on this date and visit number.",
          code: "DUPLICATE_APPOINTMENT",
        },
      });
    }

    const appointment = await Appointment.create({
      careReceiver: careReceiverId,
      careGiver: careGiverId,
      secondaryCareGiver: secondaryCareGiverId || undefined,
      date: appointmentDate,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
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
// HELPER FUNCTIONS
// =============================================================================

// Helper to find why scheduling failed (ANALYSIS ONLY - NO CREATION)
async function findSchedulingFailureReason(careReceiver, visit, date) {
  try {
    //  FIXED: Don't pass time parameters - findBestCareGiver calculates them from visit
    // The 4th parameter is excludeCareGiverId, not startTime!
    const bestCareGiver = await findBestCareGiver(
      careReceiver,
      visit,
      date,
      // Don't pass excludeCareGiverId unless we actually want to exclude a care giver
    );

    if (bestCareGiver.careGiver) {
      return "Available care giver found but not auto-scheduled";
    }

    return bestCareGiver.reason || "No available care giver found";
  } catch (error) {
    return "Unable to determine reason";
  }
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
exports.validateSchedule = async (req, res, next) => {
  console.log("\n POST /schedule/validate CALLED");
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

    const start = parseStartOfDayUTC(startDate);
    const end = parseEndOfDayUTC(endDate);

    // Clean up pre-existing duplicate active appointments in the range
    const duplicates = await Appointment.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end },
          status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        },
      },
      {
        $group: {
          _id: {
            careReceiver: "$careReceiver",
            date: "$date",
            visitNumber: "$visitNumber",
          },
          count: { $sum: 1 },
          ids: { $push: "$_id" },
          createdAts: { $push: "$createdAt" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    if (duplicates.length > 0) {
      const cancelOps = [];
      for (const dup of duplicates) {
        const sorted = dup.ids
          .map((id, i) => ({ id, createdAt: dup.createdAts[i] }))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        // Keep newest, cancel the rest
        for (const d of sorted.slice(1)) {
          cancelOps.push({
            updateOne: {
              filter: { _id: d.id },
              update: {
                $set: {
                  status: "cancelled",
                  cancellationReason:
                    "Duplicate appointment cleaned up during validation",
                },
              },
            },
          });
        }
      }
      if (cancelOps.length > 0) {
        await Appointment.bulkWrite(cancelOps, { ordered: false });
        console.log(
          `[Validate] Cleaned up ${cancelOps.length} duplicate appointments`,
        );
      }
    }

    // Get all scheduled appointments in range
    const appointments = await Appointment.find({
      date: { $gte: start, $lte: end },
      status: { $in: ["scheduled", "needs_reassignment"] },
    })
      .populate("careReceiver", "name dailyVisits genderPreference coordinates")
      .populate(
        "careGiver",
        "name email availability timeOff coordinates isActive",
      )
      .populate(
        "secondaryCareGiver",
        "name email availability timeOff coordinates isActive",
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

      // Check 3: TIME OFF - UTC comparison
      if (apt.careGiver && apt.careGiver.isActive && apt.careGiver.timeOff) {
        const utcAppointmentDate = toUTCDateValue(apt.date);

        for (const timeOff of apt.careGiver.timeOff) {
          const utcStart = toUTCDateValue(timeOff.startDate);
          const utcEnd = toUTCDateValue(timeOff.endDate) + (24 * 60 * 60 * 1000 - 1); // end of day

          if (utcAppointmentDate >= utcStart && utcAppointmentDate <= utcEnd) {
            const reason = timeOff.reason || "Personal";
            issues.push(`Care giver is now on time off (${reason})`);
            console.log(
              `   Appointment on ${toDateString(apt.date)} - Care giver on time off`,
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

        // Check secondary care giver time off (UTC comparison)
        if (apt.secondaryCareGiver.timeOff) {
          const utcAppointmentDate = toUTCDateValue(apt.date);

          for (const timeOff of apt.secondaryCareGiver.timeOff) {
            const utcStart = toUTCDateValue(timeOff.startDate);
            const utcEnd = toUTCDateValue(timeOff.endDate) + (24 * 60 * 60 * 1000 - 1);

            if (utcAppointmentDate >= utcStart && utcAppointmentDate <= utcEnd) {
              const reason = timeOff.reason || "Personal";
              issues.push(
                `Secondary care giver is now on time off (${reason})`,
              );
              break;
            }
          }
        }
      } else if (apt.doubleHanded && !apt.secondaryCareGiver) {
        issues.push(
          "Double-handed care required but no secondary care giver assigned",
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
        try {
          await apt.save();
        } catch (saveErr) {
          if (saveErr.code === 11000) {
            console.warn(
              `[Validate] Duplicate key on save for ${apt._id}, skipping`,
            );
            continue;
          }
          throw saveErr;
        }

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
          `   CONFLICT: ${apt.careReceiver?.name} on ${toDateString(apt.date)} - ${issues.join("; ")}`,
        );
      } else {
        // Still valid - ensure status is scheduled
        if (apt.status === "needs_reassignment") {
          apt.status = "scheduled";
          apt.invalidationReason = null;
          apt.invalidatedAt = null;
          try {
            await apt.save();
            updatedCount++;
            console.log(
              `   RESOLVED: ${apt.careReceiver?.name} on ${toDateString(apt.date)} - back to scheduled`,
            );
          } catch (saveErr) {
            if (saveErr.code === 11000) {
              // Another active appointment already exists for this slot — cancel this duplicate
              apt.status = "cancelled";
              apt.cancellationReason =
                "Duplicate appointment detected during validation";
              apt.invalidationReason = null;
              apt.invalidatedAt = null;
              await apt.save();
              console.warn(
                `[Validate] Cancelled duplicate appointment ${apt._id} for ${apt.careReceiver?.name} on ${toDateString(apt.date)}`,
              );
            } else {
              throw saveErr;
            }
          }
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

    console.log(`\n Validation complete:`);
    console.log(`   Valid: ${validAppointments.length}`);
    console.log(`   Invalid: ${invalidAppointments.length}`);
    console.log(`   Updated: ${updatedCount}\n`);

    // ========================================
    // AUTO-ASSIGNMENT PHASE
    // Attempt to reassign needs_reassignment appointments
    // ========================================
    const autoAssignedAppointments = [];
    const MAX_AUTO_ASSIGN = 100;

    const needsReassignment = await Appointment.find({
      date: { $gte: start, $lte: end },
      status: "needs_reassignment",
    })
      .populate("careReceiver", "name dailyVisits genderPreference coordinates preferredCareGiver")
      .limit(MAX_AUTO_ASSIGN)
      .sort({ date: 1 });

    console.log(`[Auto-Assign] Found ${needsReassignment.length} needs_reassignment appointments to attempt`);

    const bulkOps = [];

    for (const apt of needsReassignment) {
      if (!apt.careReceiver || !apt.careReceiver.coordinates?.coordinates) continue;

      const visit = {
        visitNumber: apt.visitNumber || 1,
        preferredTime: apt.startTime,
        duration: apt.duration,
        requirements: apt.requirements || [],
        doubleHanded: apt.doubleHanded || false,
        priority: apt.priority || 3,
      };

      try {
        const result = await findBestCareGiver(apt.careReceiver, visit, apt.date);

        if (result.careGiver) {
          let secondaryCareGiver = null;

          if (apt.doubleHanded) {
            const secondaryResult = await findSecondaryCareGiver(
              apt.careReceiver,
              visit,
              apt.date,
              result.careGiver._id
            );
            if (!secondaryResult.careGiver) {
              console.log(`[Auto-Assign] Skipping ${apt.careReceiver.name} - no secondary caregiver for double-handed`);
              continue;
            }
            secondaryCareGiver = secondaryResult.careGiver._id;
          }

          const updateFields = {
            status: "scheduled",
            careGiver: result.careGiver._id,
            invalidationReason: null,
            invalidatedAt: null,
          };
          if (secondaryCareGiver) {
            updateFields.secondaryCareGiver = secondaryCareGiver;
          }

          bulkOps.push({
            updateOne: {
              filter: { _id: apt._id },
              update: { $set: updateFields },
            },
          });

          autoAssignedAppointments.push({
            _id: apt._id,
            careReceiver: apt.careReceiver.name,
            careGiver: result.careGiver.name,
            date: apt.date,
            startTime: apt.startTime,
          });

          console.log(`[Auto-Assign] Assigned ${apt.careReceiver.name} on ${toDateString(apt.date)} to ${result.careGiver.name}`);
        }
      } catch (assignError) {
        console.error(`[Auto-Assign] Error for appointment ${apt._id}:`, assignError.message);
      }
    }

    if (bulkOps.length > 0) {
      try {
        await Appointment.bulkWrite(bulkOps, { ordered: false });
      } catch (bulkErr) {
        if (
          bulkErr.code === 11000 ||
          bulkErr.writeErrors?.some((e) => e.code === 11000)
        ) {
          console.warn(
            `[Auto-Assign] Some assignments skipped due to duplicate slots`,
          );
        } else {
          throw bulkErr;
        }
      }
    }

    const remainingInvalid = invalidAppointments.length - autoAssignedAppointments.length;
    console.log(`[Auto-Assign] Auto-assigned: ${autoAssignedAppointments.length}, Remaining invalid: ${Math.max(0, remainingInvalid)}\n`);

    res.json({
      success: true,
      data: {
        summary: {
          total: appointments.length,
          valid: validAppointments.length,
          invalid: invalidAppointments.length,
          updated: updatedCount,
          autoAssigned: autoAssignedAppointments.length,
        },
        invalidAppointments: invalidAppointments,
        validAppointments: validAppointments,
        autoAssignedAppointments: autoAssignedAppointments,
      },
      message:
        invalidAppointments.length > 0
          ? autoAssignedAppointments.length > 0
            ? `Found ${invalidAppointments.length} conflicts, auto-assigned ${autoAssignedAppointments.length}`
            : `Found ${invalidAppointments.length} appointments that need reassignment`
          : autoAssignedAppointments.length > 0
            ? `All valid. Auto-assigned ${autoAssignedAppointments.length} previously unassigned appointment(s)`
            : `All appointments are valid`,
    });
  } catch (error) {
    console.error(" Error in validateSchedule:", error);
    next(error);
  }
};

// =============================================================================
// EXPORTS (ALL FUNCTIONS EXPORTED)
// =============================================================================

module.exports = {
  generateSchedule: exports.generateSchedule,
  getJobProgress: exports.getJobProgress,
  getActiveJobs: exports.getActiveJobs,
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
