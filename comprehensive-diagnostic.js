/**
 * COMPREHENSIVE DIAGNOSTIC: Elizabeth & Dorothy Unscheduled Mystery
 *
 * Problem: Shows "1 unscheduled" but appointments don't appear in list
 * This will check EVERYTHING to find the issue
 */

require("dotenv").config();
const mongoose = require("mongoose");
const CareReceiver = require("./models/CareReceiver");
const Appointment = require("./models/Appointment");
const Availability = require("./models/Availability");
const CareGiver = require("./models/CareGiver");
const { normalizeTimeToHHMM } = require("./utils/timeUtils");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/caregivingdb";

// Copy of isDateInSchedule
function isDateInSchedule(checkDate, visit, careReceiverCreatedAt) {
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
    console.log(`      No daysOfWeek defined, defaulting to all 7 days`);
    visit.daysOfWeek = dayNames;
  }

  if (!visit.daysOfWeek.includes(dayOfWeek)) {
    return false;
  }

  if (visit.recurrencePattern === "weekly") {
    return true;
  }

  if (
    visit.recurrencePattern === "biweekly" ||
    visit.recurrencePattern === "monthly"
  ) {
    const startDate = new Date(
      visit.recurrenceStartDate || careReceiverCreatedAt,
    );
    startDate.setUTCHours(0, 0, 0, 0);

    const checkUTC = new Date(
      Date.UTC(
        checkDate.getUTCFullYear(),
        checkDate.getUTCMonth(),
        checkDate.getUTCDate(),
      ),
    );

    const daysDiff = Math.floor((checkUTC - startDate) / (24 * 60 * 60 * 1000));
    const weeksDiff = Math.floor(daysDiff / 7);

    const interval = visit.recurrencePattern === "biweekly" ? 2 : 4;
    return weeksDiff % interval === 0;
  }

  return true;
}

async function comprehensiveDiagnostic() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(" Connected to MongoDB\n");

    // Date range
    const startDate = new Date("2026-01-03T00:00:00Z");
    const endDate = new Date("2026-02-02T23:59:59Z");

    console.log(" Date Range: Jan 3 - Feb 2, 2026\n");
    console.log("=".repeat(70));

    // Get Elizabeth and Dorothy
    const names = ["Elizabeth Davies", "Dorothy Harris"];

    for (const name of names) {
      const cr = await CareReceiver.findOne({ name }).lean();

      if (!cr) {
        console.log(`\n ${name} not found in database!\n`);
        continue;
      }

      console.log(`\n${"=".repeat(70)}`);
      console.log(` ${name}`);
      console.log(`${"=".repeat(70)}`);

      console.log(`\nID: ${cr._id}`);
      console.log(`Active: ${cr.isActive}`);
      console.log(`Created: ${cr.createdAt}`);

      // Check daily visits
      console.log(`\n DAILY VISITS CONFIGURATION:`);
      console.log(`Total visits: ${cr.dailyVisits.length}`);

      if (cr.dailyVisits.length === 0) {
        console.log(
          ` NO VISITS CONFIGURED! This is why they show 0 unscheduled.`,
        );
        continue;
      }

      cr.dailyVisits.forEach((visit, idx) => {
        console.log(`\nVisit ${visit.visitNumber}:`);
        console.log(`  Time: ${visit.preferredTime} (${visit.duration} min)`);
        console.log(
          `  Days of week: ${visit.daysOfWeek ? visit.daysOfWeek.join(", ") : " NOT SET"}`,
        );
        console.log(`  Recurrence: ${visit.recurrencePattern}`);
        if (visit.recurrencePattern !== "weekly") {
          console.log(`  Interval: ${visit.recurrenceInterval}`);
          console.log(
            `  Start date: ${visit.recurrenceStartDate || "Not set (uses createdAt)"}`,
          );
        }
        console.log(`  Requirements: ${(visit.requirements || []).join(", ")}`);
        console.log(`  Double-handed: ${visit.doubleHanded}`);
      });

      // Get ALL appointments (including cancelled, missed, etc)
      const allAppointments = await Appointment.find({
        careReceiver: cr._id,
        date: { $gte: startDate, $lte: endDate },
      }).lean();

      console.log(`\n📊 APPOINTMENTS IN DATABASE:`);
      console.log(`Total appointments: ${allAppointments.length}`);

      if (allAppointments.length > 0) {
        // Group by status
        const byStatus = {};
        allAppointments.forEach((apt) => {
          byStatus[apt.status] = (byStatus[apt.status] || 0) + 1;
        });

        console.log("\nBreakdown by status:");
        Object.entries(byStatus).forEach(([status, count]) => {
          console.log(`  ${status}: ${count}`);
        });

        console.log("\nAll appointments:");
        allAppointments.forEach((apt, idx) => {
          const dateStr = apt.date.toISOString().split("T")[0];
          console.log(
            `  ${idx + 1}. ${dateStr} - Visit ${apt.visitNumber} at ${apt.startTime} - Status: ${apt.status}`,
          );
        });
      } else {
        console.log("   No appointments found in this range!");
      }

      // Calculate expected appointments using isDateInSchedule
      console.log(`\n EXPECTED APPOINTMENTS CALCULATION:`);

      const expectedDates = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split("T")[0];
        const utcDay = currentDate.getUTCDay();
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayName = dayNames[utcDay];

        for (const visit of cr.dailyVisits) {
          const shouldHave = isDateInSchedule(currentDate, visit, cr.createdAt);

          if (shouldHave) {
            expectedDates.push({
              date: dateStr,
              dayName,
              visitNumber: visit.visitNumber,
              time: visit.preferredTime,
            });
          }
        }

        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }

      console.log(`Total expected: ${expectedDates.length}`);

      if (expectedDates.length > 0) {
        console.log(`\nFirst 5 expected dates:`);
        expectedDates.slice(0, 5).forEach((exp, idx) => {
          console.log(
            `  ${idx + 1}. ${exp.date} (${exp.dayName}) - Visit ${exp.visitNumber} at ${exp.time}`,
          );
        });

        if (expectedDates.length > 5) {
          console.log(`  ... and ${expectedDates.length - 5} more`);
        }
      }

      // Find which are missing
      console.log(`\n MISSING (UNSCHEDULED) APPOINTMENTS:`);

      const appointmentMap = new Map();
      allAppointments
        .filter((apt) =>
          ["scheduled", "in_progress", "completed"].includes(apt.status),
        )
        .forEach((apt) => {
          const dateKey = apt.date.toISOString().split("T")[0];
          const visitKey = `${dateKey}-${apt.visitNumber}`;
          appointmentMap.set(visitKey, apt);
        });

      const missing = expectedDates.filter((exp) => {
        const visitKey = `${exp.date}-${exp.visitNumber}`;
        return !appointmentMap.has(visitKey);
      });

      console.log(`Total missing: ${missing.length}`);

      if (missing.length > 0) {
        console.log(`\nAll missing appointments:`);
        missing.forEach((m, idx) => {
          console.log(
            `  ${idx + 1}. ${m.date} (${m.dayName}) - Visit ${m.visitNumber} at ${m.time}`,
          );
        });
      } else {
        console.log(` All appointments are scheduled!`);
      }

      // Check if there are care givers available for the missing dates
      if (missing.length > 0) {
        console.log(
          `\n CHECKING CARE GIVER AVAILABILITY FOR FIRST MISSING DATE:`,
        );
        const firstMissing = missing[0];
        const visit = cr.dailyVisits.find(
          (v) => v.visitNumber === firstMissing.visitNumber,
        );

        if (visit) {
          console.log(`\nDate: ${firstMissing.date}`);
          console.log(
            `Visit: ${firstMissing.visitNumber} at ${firstMissing.time} (${visit.duration} min)`,
          );
          console.log(`Requirements: ${(visit.requirements || []).join(", ")}`);

          // Get care givers with required skills
          const careGivers = await CareGiver.find({
            isActive: true,
            skills: { $all: visit.requirements },
          }).lean();

          console.log(
            `\nCare givers with required skills: ${careGivers.length}`,
          );

          if (careGivers.length > 0) {
            console.log("\nChecking each care giver:");

            for (const cg of careGivers) {
              console.log(`\n   ${cg.name}:`);

              // Check if has Availability document
              const checkDate = new Date(firstMissing.date);
              const avail = await Availability.getCurrentForCareGiver(
                cg._id,
                checkDate,
              );

              if (!avail) {
                console.log(`      No Availability document`);
                continue;
              }

              console.log(`      Has Availability document`);

              // Check day schedule
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

              const daySchedule = avail.schedule.find(
                (s) => s.dayOfWeek === dayOfWeek,
              );

              if (!daySchedule || daySchedule.slots.length === 0) {
                console.log(`      Not working on ${dayOfWeek}`);
                continue;
              }

              console.log(
                `      Works on ${dayOfWeek}: ${daySchedule.slots.map((s) => `${s.startTime}-${s.endTime}`).join(", ")}`,
              );

              // Check if time fits
              const [hours, minutes] = visit.preferredTime
                .split(":")
                .map(Number);
              const endMinutes = minutes + visit.duration;
              const endTime = normalizeTimeToHHMM(`${hours + Math.floor(endMinutes / 60)}:${(endMinutes % 60).toString().padStart(2, "0")}`);

              const fitsInSlot = daySchedule.slots.some(
                (slot) =>
                  visit.preferredTime >= slot.startTime &&
                  endTime <= slot.endTime,
              );

              if (fitsInSlot) {
                console.log(
                  `      Time slot fits: ${visit.preferredTime}-${endTime}`,
                );
              } else {
                console.log(
                  `      Time doesn't fit: ${visit.preferredTime}-${endTime}`,
                );
              }
            }
          } else {
            console.log(`   No care givers have the required skills!`);
          }
        }
      }

      console.log("");
    }

    console.log("\n" + "=".repeat(70));
    console.log("DIAGNOSTIC COMPLETE");
    console.log("=".repeat(70) + "\n");
  } catch (error) {
    console.error(" Error:", error);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB\n");
  }
}

comprehensiveDiagnostic();
