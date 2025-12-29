// backend/controllers/scheduleAnalysisController.js
// Analyzes why appointments couldn't be scheduled and provides detailed per-care-giver reasons

const CareGiver = require("../models/CareGiver");
const CareReceiver = require("../models/CareReceiver");
const Appointment = require("../models/Appointment");
const Setting = require("../models/Settings");
const Availability = require("../models/Availability");
const moment = require("moment");

/**
 * Analyze why a specific appointment couldn't be scheduled
 * Returns detailed rejection reasons for each care giver
 * @route POST /api/schedule/analyze-unscheduled
 */
exports.analyzeUnscheduledAppointment = async (req, res) => {
  try {
    const { careReceiver: careReceiverId, visit, date } = req.body;

    console.log("\n=== ANALYZING UNSCHEDULED APPOINTMENT ===");
    console.log("Care Receiver ID:", careReceiverId);
    console.log("Visit:", visit);
    console.log("Date:", date);

    // Get care receiver
    const careReceiver = await CareReceiver.findById(careReceiverId);
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        message: "Care receiver not found",
      });
    }

    console.log("Care Receiver:", careReceiver.name);

    // Get settings
    const settings = await Setting.findOne();
    const maxDistance = settings?.maxDistanceKm || 20;
    const maxAppointmentsPerDay = settings?.maxAppointmentsPerDay || 10;
    const travelTimeBuffer = settings?.travelTimeBuffer || 15;

    console.log("Settings:", {
      maxDistance,
      maxAppointmentsPerDay,
      travelTimeBuffer,
    });

    // Get all active care givers
    const careGivers = await CareGiver.find({ isActive: true });
    console.log(`Found ${careGivers.length} active care givers`);

    // Analyze each care giver
    const careGiverAnalysis = await Promise.all(
      careGivers.map(async (careGiver) => {
        const analysis = {
          id: careGiver._id,
          name: careGiver.name,
          email: careGiver.email,
          phone: careGiver.phone,
          canAssign: true,
          rejectionReasons: [],
          matchScore: 100,
          distance: null,
        };

        console.log(`\nAnalyzing ${careGiver.name}...`);

        // Check 1: Gender preference
        if (
          careReceiver.genderPreference &&
          careReceiver.genderPreference !== "No Preference" &&
          careGiver.gender !== careReceiver.genderPreference
        ) {
          analysis.canAssign = false;
          analysis.rejectionReasons.push(
            `Gender mismatch: Care receiver prefers ${careReceiver.genderPreference}, care giver is ${careGiver.gender}`
          );
          analysis.matchScore -= 30;
          console.log("  ❌ Gender mismatch");
        }

        // Check 2: Skills match
        const requiredSkills = visit.requirements || [];
        const missingSkills = requiredSkills.filter(
          (skill) => !careGiver.skills.includes(skill)
        );
        if (missingSkills.length > 0) {
          analysis.canAssign = false;
          analysis.rejectionReasons.push(
            `Missing required skills: ${missingSkills.map((s) => s.replace(/_/g, " ")).join(", ")}`
          );
          analysis.matchScore -= 25 * missingSkills.length;
          console.log("  ❌ Missing skills:", missingSkills);
        }

        // Check 3: Double-handed capability
        if (visit.doubleHanded && careGiver.singleHandedOnly) {
          analysis.canAssign = false;
          analysis.rejectionReasons.push(
            "Care receiver requires double-handed care, but care giver can only do single-handed care"
          );
          analysis.matchScore -= 50;
          console.log("  ❌ Single-handed only");
        }

        // Check 4: Availability on this day
        const appointmentDate = new Date(date);
        const dayOfWeek = appointmentDate.toLocaleDateString("en-GB", {
          weekday: "long",
        });

        // Try to get from Availability collection first
        let availability = await Availability.findOne({
          careGiver: careGiver._id,
          effectiveFrom: { $lte: appointmentDate },
          $or: [
            { effectiveTo: null },
            { effectiveTo: { $gte: appointmentDate } },
          ],
          isActive: true,
        });

        // Fallback to embedded availability
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
          analysis.canAssign = false;
          analysis.rejectionReasons.push("No availability schedule configured");
          analysis.matchScore -= 100;
          console.log("  ❌ No availability");
        } else {
          // Check day availability
          const dayAvailability = availability.schedule?.find(
            (a) => a.dayOfWeek === dayOfWeek
          );

          if (!dayAvailability || dayAvailability.slots.length === 0) {
            analysis.canAssign = false;
            analysis.rejectionReasons.push(`Not available on ${dayOfWeek}s`);
            analysis.matchScore -= 40;
            console.log(`  ❌ Not available on ${dayOfWeek}s`);
          } else {
            // Check if preferred time falls within any slot
            const preferredTime = visit.preferredTime;
            const [hours, minutes] = preferredTime.split(":").map(Number);
            const endMinutes = minutes + visit.duration;
            const endTime = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

            const isWithinSlot = dayAvailability.slots.some((slot) => {
              return preferredTime >= slot.startTime && endTime <= slot.endTime;
            });

            if (!isWithinSlot) {
              analysis.canAssign = false;
              analysis.rejectionReasons.push(
                `Not available at ${preferredTime} (available slots: ${dayAvailability.slots
                  .map((s) => `${s.startTime}-${s.endTime}`)
                  .join(", ")})`
              );
              analysis.matchScore -= 30;
              console.log(`  ❌ Not available at ${preferredTime}`);
            }
          }

          // Check 5: Time off
          const isOnTimeOff = (availability.timeOff || []).some((timeOff) => {
            const startDate = new Date(timeOff.startDate);
            const endDate = new Date(timeOff.endDate);
            return appointmentDate >= startDate && appointmentDate <= endDate;
          });

          if (isOnTimeOff) {
            analysis.canAssign = false;
            analysis.rejectionReasons.push(`On time off during this period`);
            analysis.matchScore -= 100;
            console.log("  ❌ On time off");
          }
        }

        // Check 6: Distance
        if (
          careGiver.coordinates &&
          careGiver.coordinates.coordinates &&
          careReceiver.coordinates &&
          careReceiver.coordinates.coordinates
        ) {
          const distance = calculateDistance(
            careGiver.coordinates.coordinates,
            careReceiver.coordinates.coordinates
          );
          analysis.distance = distance;

          if (distance > maxDistance) {
            analysis.canAssign = false;
            analysis.rejectionReasons.push(
              `Too far away: ${distance.toFixed(1)} km (max: ${maxDistance} km)`
            );
            analysis.matchScore -= 20;
            console.log(`  ❌ Too far: ${distance.toFixed(1)} km`);
          } else {
            // Bonus for being close
            const distanceScore = ((maxDistance - distance) / maxDistance) * 10;
            analysis.matchScore += Math.round(distanceScore);
            console.log(`  ✓ Distance OK: ${distance.toFixed(1)} km`);
          }
        }

        // Check 7: Max appointments per day
        const startOfDay = new Date(appointmentDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(appointmentDate);
        endOfDay.setHours(23, 59, 59, 999);

        const appointmentCount = await Appointment.countDocuments({
          careGiver: careGiver._id,
          date: { $gte: startOfDay, $lte: endOfDay },
          status: { $in: ["scheduled", "in_progress"] },
        });

        if (appointmentCount >= maxAppointmentsPerDay) {
          analysis.canAssign = false;
          analysis.rejectionReasons.push(
            `Already has ${appointmentCount} appointments (max: ${maxAppointmentsPerDay} per day)`
          );
          analysis.matchScore -= 30;
          console.log(
            `  ❌ At max appointments: ${appointmentCount}/${maxAppointmentsPerDay}`
          );
        }

        // Check 8: Schedule conflicts
        const existingAppointments = await Appointment.find({
          careGiver: careGiver._id,
          date: { $gte: startOfDay, $lte: endOfDay },
          status: { $in: ["scheduled", "in_progress"] },
        }).sort({ startTime: 1 });

        const preferredTime = visit.preferredTime;
        const [hours, minutes] = preferredTime.split(":").map(Number);
        const endMinutes = minutes + visit.duration;
        const proposedEnd = `${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`;

        for (const existing of existingAppointments) {
          // Check for time overlap
          if (
            (preferredTime >= existing.startTime &&
              preferredTime < existing.endTime) ||
            (proposedEnd > existing.startTime &&
              proposedEnd <= existing.endTime) ||
            (preferredTime <= existing.startTime &&
              proposedEnd >= existing.endTime)
          ) {
            analysis.canAssign = false;
            analysis.rejectionReasons.push(
              `Schedule conflict: Already has appointment at ${existing.startTime}-${existing.endTime}`
            );
            analysis.matchScore -= 40;
            console.log(
              `  ❌ Conflict at ${existing.startTime}-${existing.endTime}`
            );
            break;
          }

          // Check travel time buffer
          if (
            existing.careReceiver &&
            careReceiver._id.toString() !== existing.careReceiver.toString()
          ) {
            const timeBetweenStart = Math.abs(
              parseTime(preferredTime) - parseTime(existing.endTime)
            );
            const timeBetweenEnd = Math.abs(
              parseTime(proposedEnd) - parseTime(existing.startTime)
            );
            const minTimeBetween = Math.min(timeBetweenStart, timeBetweenEnd);

            if (minTimeBetween < travelTimeBuffer && minTimeBetween > 0) {
              analysis.canAssign = false;
              analysis.rejectionReasons.push(
                `Insufficient travel time: Only ${minTimeBetween} min between appointments (needs ${travelTimeBuffer} min)`
              );
              analysis.matchScore -= 25;
              console.log(
                `  ❌ Insufficient travel time: ${minTimeBetween} min`
              );
              break;
            }
          }
        }

        // Ensure match score doesn't go below 0 or above 100
        analysis.matchScore = Math.max(0, Math.min(100, analysis.matchScore));

        console.log(
          `  Final: ${analysis.canAssign ? "✓ Can assign" : "✗ Cannot assign"} (Score: ${analysis.matchScore}%)`
        );

        return analysis;
      })
    );

    // Sort by match score (best matches first)
    careGiverAnalysis.sort((a, b) => b.matchScore - a.matchScore);

    // Separate can assign vs cannot assign
    const canAssign = careGiverAnalysis.filter((cg) => cg.canAssign);
    const cannotAssign = careGiverAnalysis.filter((cg) => !cg.canAssign);

    console.log(
      `\nResults: ${canAssign.length} can assign, ${cannotAssign.length} cannot`
    );
    console.log("=========================================\n");

    res.json({
      success: true,
      data: {
        careReceiver: {
          id: careReceiver._id,
          name: careReceiver.name,
          genderPreference: careReceiver.genderPreference,
        },
        appointment: {
          date,
          visit,
        },
        careGiverAnalysis,
        summary: {
          totalCareGivers: careGivers.length,
          canAssign: canAssign.length,
          cannotAssign: cannotAssign.length,
          topMatch: canAssign.length > 0 ? canAssign[0] : null,
        },
      },
    });
  } catch (error) {
    console.error("Error analyzing unscheduled appointment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to analyze appointment",
      error: error.message,
    });
  }
};

/**
 * Get assignment reasoning for a scheduled appointment
 * Explains why this specific care giver was chosen
 * @route GET /api/schedule/appointments/:appointmentId/reasoning
 */
exports.getAssignmentReasoning = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const appointment = await Appointment.findById(appointmentId)
      .populate("careReceiver")
      .populate("careGiver")
      .populate("secondaryCareGiver");

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    if (!appointment.careGiver) {
      return res.json({
        success: true,
        data: {
          reasons: ["No care giver assigned yet"],
          isAutoAssigned: false,
        },
      });
    }

    const reasons = [];
    let score = 0;

    // Reason 1: Availability match
    reasons.push(
      `✓ Available on ${moment(appointment.date).format("dddd")} at ${appointment.startTime}`
    );
    score += 20;

    // Reason 2: Skills match
    if (appointment.requirements && appointment.requirements.length > 0) {
      const matchingSkills = appointment.requirements.filter((skill) =>
        appointment.careGiver.skills.includes(skill)
      );
      if (matchingSkills.length === appointment.requirements.length) {
        reasons.push(
          `✓ Has all required skills: ${matchingSkills.map((s) => s.replace(/_/g, " ")).join(", ")}`
        );
        score += 25;
      } else {
        reasons.push(
          `⚠ Has ${matchingSkills.length}/${appointment.requirements.length} required skills`
        );
        score += 10;
      }
    }

    // Reason 3: Preferred care giver
    if (
      appointment.careReceiver.preferredCareGiver &&
      appointment.careReceiver.preferredCareGiver.toString() ===
        appointment.careGiver._id.toString()
    ) {
      reasons.push(`⭐ Is the preferred care giver for this care receiver`);
      score += 30;
    }

    // Reason 4: Gender preference
    if (
      appointment.careReceiver.genderPreference &&
      appointment.careReceiver.genderPreference !== "No Preference"
    ) {
      if (
        appointment.careGiver.gender ===
        appointment.careReceiver.genderPreference
      ) {
        reasons.push(
          `✓ Matches gender preference: ${appointment.careReceiver.genderPreference}`
        );
        score += 15;
      }
    }

    // Reason 5: Distance
    if (
      appointment.careGiver.coordinates &&
      appointment.careReceiver.coordinates
    ) {
      const distance = calculateDistance(
        appointment.careGiver.coordinates.coordinates,
        appointment.careReceiver.coordinates.coordinates
      );
      reasons.push(`✓ Distance: ${distance.toFixed(1)} km (within range)`);
      score += Math.max(0, 10 - distance); // Closer = higher score
    }

    // Reason 6: No schedule conflicts
    reasons.push(`✓ No schedule conflicts at this time`);
    score += 10;

    // Reason 7: Within appointment limits
    reasons.push(`✓ Within daily appointment limit`);
    score += 5;

    res.json({
      success: true,
      data: {
        appointment: {
          id: appointment._id,
          date: appointment.date,
          time: `${appointment.startTime} - ${appointment.endTime}`,
          status: appointment.status,
        },
        careGiver: {
          id: appointment.careGiver._id,
          name: appointment.careGiver.name,
          email: appointment.careGiver.email,
        },
        careReceiver: {
          id: appointment.careReceiver._id,
          name: appointment.careReceiver.name,
        },
        reasons,
        matchScore: Math.min(100, score),
        isAutoAssigned: appointment.status === "scheduled",
      },
    });
  } catch (error) {
    console.error("Error getting assignment reasoning:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get assignment reasoning",
      error: error.message,
    });
  }
};

// Helper function to calculate distance between two coordinates
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
  const distance = R * c;

  return distance;
}

// Helper function to parse time string to minutes
function parseTime(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

module.exports = {
  analyzeUnscheduledAppointment: exports.analyzeUnscheduledAppointment,
  getAssignmentReasoning: exports.getAssignmentReasoning,
};
