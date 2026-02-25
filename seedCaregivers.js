// seedCaregivers.js
// Seeds ONLY the 3 Leeds caregivers (does NOT touch care receivers).
//
// WHY THIS SCRIPT EXISTS
// ─────────────────────
// The 15 Leeds care receivers collectively need all 8 skills:
//   personal_care, medication_management, dementia_care, mobility_assistance,
//   meal_preparation, companionship, household_tasks, specialized_medical
//
// If the 3 caregivers are missing any of those skills the scheduler can never
// assign them, resulting in "Could Not Schedule" even though capacity is fine.
//
// This script creates 3 caregivers whose skills together cover every
// requirement used by the 15 receivers, and places them in sensible Leeds
// locations so they fall within the default 20 km search radius.
//
// Usage:
//   node seedCaregivers.js

require("dotenv").config();
const mongoose = require("mongoose");
const CareGiver = require("./models/CareGiver");
const Availability = require("./models/Availability");

// ---------------------------------------------------------------------------
// 3 Leeds caregivers — skills designed to cover all receiver requirements
// ---------------------------------------------------------------------------

const SEVEN_DAY_AVAILABILITY = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
].map((dayOfWeek) => ({
  dayOfWeek,
  slots: [{ startTime: "07:00", endTime: "18:00" }],
}));

const careGivers = [
  // ── Caregiver 1 ─────────────────────────────────────────────────────────
  // Female, Leeds city centre. Covers dementia_care, medication_management,
  // household_tasks, companionship — the skills most needed by female-preferred
  // receivers (Alice, Rose, Ethel, Clara, Violet).
  {
    name: "Sarah Mitchell",
    email: "sarah.mitchell@example.com",
    phone: "07800100001",
    dateOfBirth: new Date("1988-04-12"),
    gender: "Female",
    address: {
      street: "10 Boar Lane",
      city: "Leeds",
      postcode: "LS1 5DA",
    },
    coordinates: {
      type: "Point",
      coordinates: [-1.5472, 53.7975], // Leeds city centre
    },
    skills: [
      "personal_care",
      "medication_management",
      "dementia_care",
      "household_tasks",
      "companionship",
    ],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: SEVEN_DAY_AVAILABILITY,
    timeOff: [],
    isActive: true,
    notes:
      "City-centre base. Specialist in dementia care and medication routines.",
  },

  // ── Caregiver 2 ─────────────────────────────────────────────────────────
  // Male, West Leeds. Covers specialized_medical, mobility_assistance,
  // meal_preparation — skills needed by Percy (stroke), Henry/Ernest/Horace
  // (mobility) and several meal-prep receivers. Only male caregiver, so Percy
  // Mills (Male preference) can be assigned here.
  {
    name: "James Cooper",
    email: "james.cooper@example.com",
    phone: "07800100002",
    dateOfBirth: new Date("1985-09-30"),
    gender: "Male",
    address: {
      street: "5 Tong Road",
      city: "Leeds",
      postcode: "LS12 1HT",
    },
    coordinates: {
      type: "Point",
      coordinates: [-1.5874, 53.7932], // West Leeds / Wortley
    },
    skills: [
      "personal_care",
      "mobility_assistance",
      "specialized_medical",
      "meal_preparation",
      "medication_management",
    ],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: SEVEN_DAY_AVAILABILITY,
    timeOff: [],
    isActive: true,
    notes:
      "Former NHS healthcare assistant. Specialist in post-stroke and mobility care.",
  },

  // ── Caregiver 3 ─────────────────────────────────────────────────────────
  // Female, North-East Leeds. Second caregiver with dementia_care so Ethel
  // and Muriel (both need dementia_care on the same days) can be split across
  // two caregivers instead of queuing on one. Also covers mobility_assistance
  // and meal_preparation as backup.
  {
    name: "Emily Watson",
    email: "emily.watson@example.com",
    phone: "07800100003",
    dateOfBirth: new Date("1992-02-17"),
    gender: "Female",
    address: {
      street: "15 Harehills Avenue",
      city: "Leeds",
      postcode: "LS8 4ER",
    },
    coordinates: {
      type: "Point",
      coordinates: [-1.523, 53.8178], // Harehills / Chapel Allerton area
    },
    skills: [
      "personal_care",
      "meal_preparation",
      "dementia_care",
      "household_tasks",
      "mobility_assistance",
    ],
    canDrive: false,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: SEVEN_DAY_AVAILABILITY,
    timeOff: [],
    isActive: true,
    notes:
      "North-east Leeds specialist. Dementia-trained and experienced with mobility aids.",
  },
];

// ---------------------------------------------------------------------------
// Skill coverage summary (printed at runtime for verification)
// ---------------------------------------------------------------------------

const ALL_SKILLS = [
  "personal_care",
  "medication_management",
  "dementia_care",
  "mobility_assistance",
  "meal_preparation",
  "companionship",
  "household_tasks",
  "specialized_medical",
];

function printSkillCoverage(createdCareGivers) {
  console.log("\nSKILL COVERAGE CHECK:");
  console.log("─".repeat(55));

  for (const skill of ALL_SKILLS) {
    const covered = createdCareGivers.filter((cg) =>
      cg.skills.includes(skill),
    );
    const names = covered.map((cg) => cg.name.split(" ")[0]).join(", ");
    const status = covered.length > 0 ? "✓" : "✗ MISSING";
    console.log(
      `  ${status.padEnd(10)} ${skill.padEnd(25)} → ${names || "NOBODY"}`,
    );
  }

  const uncovered = ALL_SKILLS.filter(
    (skill) => !createdCareGivers.some((cg) => cg.skills.includes(skill)),
  );

  if (uncovered.length > 0) {
    console.log(`\n  WARNING: ${uncovered.length} skill(s) have no coverage!`);
    console.log(
      "  Appointments requiring these skills will always fail:\n ",
      uncovered.join(", "),
    );
  } else {
    console.log("\n  All 8 skills are covered.");
  }
}

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

async function seedCareGivers() {
  try {
    console.log("\n" + "=".repeat(55));
    console.log("  SEEDING CAREGIVERS (Leeds — 3 caregivers)");
    console.log("=".repeat(55) + "\n");

    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/care_system_db",
    );
    console.log("Connected to MongoDB\n");

    // Remove only caregivers and their availability records.
    // Care receivers are left untouched.
    console.log("Removing existing caregivers and availability records...");
    const deletedCG = await CareGiver.deleteMany({});
    const deletedAV = await Availability.deleteMany({});
    console.log(
      `  Removed ${deletedCG.deletedCount} caregivers, ${deletedAV.deletedCount} availability records\n`,
    );

    // Insert caregivers
    console.log("Creating caregivers...");
    const createdCareGivers = await CareGiver.insertMany(careGivers);
    console.log(`  Created ${createdCareGivers.length} caregivers\n`);

    // Create availability records
    console.log("Creating availability records...");
    for (const cg of createdCareGivers) {
      await Availability.create({
        careGiver: cg._id,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
        schedule: cg.availability,
        timeOff: [],
        isActive: true,
        notes: "07:00–18:00 every day",
        version: 1,
      });
    }
    console.log(
      `  Created ${createdCareGivers.length} availability records\n`,
    );

    // Print skill coverage for verification
    printSkillCoverage(createdCareGivers);

    // Summary table
    console.log("\n" + "=".repeat(55));
    console.log("CAREGIVERS CREATED:");
    console.log("─".repeat(55));
    for (const cg of createdCareGivers) {
      console.log(`  ${cg.gender.padEnd(7)} ${cg.name}`);
      console.log(`           ${cg.skills.join(", ")}`);
    }

    console.log("\n" + "=".repeat(55));
    console.log("NEXT STEPS:");
    console.log("─".repeat(55));
    console.log("  1. Start (or restart) the backend: npm start");
    console.log("  2. Generate a schedule for your date range");
    console.log("  3. Expect significantly fewer unscheduled appointments");
    console.log(
      "     (remaining gaps are true capacity limits or gender/time\n" +
        "      constraints that cannot be resolved automatically)\n",
    );
  } catch (error) {
    console.error("Error seeding caregivers:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("Database connection closed.");
    process.exit(0);
  }
}

seedCareGivers();
