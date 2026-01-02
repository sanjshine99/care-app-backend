// backend/seedDataFlexible.js
// Enhanced seed script with flexible visit scheduling examples

require("dotenv").config();
const mongoose = require("mongoose");
const CareGiver = require("./models/CareGiver");
const CareReceiver = require("./models/CareReceiver");
const Availability = require("./models/Availability");

// =============================================================================
// CARE GIVERS DATA (Same as before)
// =============================================================================

const careGivers = [
  {
    name: "Mary Johnson",
    email: "mary.johnson@example.com",
    phone: "07700900001",
    dateOfBirth: new Date("1988-03-15"),
    gender: "Female",
    address: {
      street: "123 High Street",
      city: "London",
      postcode: "SW1A 1AA",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1419, 51.5014],
    },
    skills: [
      "personal_care",
      "medication_management",
      "companionship",
      "meal_preparation",
    ],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 10,
    availability: [
      {
        dayOfWeek: "Monday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Tuesday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Wednesday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Thursday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Friday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
    ],
    timeOff: [
      {
        startDate: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(2026, 0, 1, 23, 59, 59, 999)),
        reason: "New Year Holiday",
      },
    ],
    isActive: true,
    notes: "Experienced with dementia care. Prefers morning shifts.",
  },
  {
    name: "John Doe",
    email: "john.doe@example.com",
    phone: "07700900002",
    dateOfBirth: new Date("1985-07-22"),
    gender: "Male",
    address: {
      street: "456 Kings Road",
      city: "London",
      postcode: "SW3 5EP",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1657, 51.4875],
    },
    skills: [
      "personal_care",
      "mobility_assistance",
      "specialized_medical",
      "medication_management",
    ],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 12,
    availability: [
      {
        dayOfWeek: "Monday",
        slots: [{ startTime: "08:00", endTime: "18:00" }],
      },
      {
        dayOfWeek: "Tuesday",
        slots: [{ startTime: "08:00", endTime: "18:00" }],
      },
      {
        dayOfWeek: "Wednesday",
        slots: [{ startTime: "08:00", endTime: "18:00" }],
      },
      {
        dayOfWeek: "Thursday",
        slots: [{ startTime: "08:00", endTime: "18:00" }],
      },
      {
        dayOfWeek: "Friday",
        slots: [{ startTime: "08:00", endTime: "18:00" }],
      },
      {
        dayOfWeek: "Saturday",
        slots: [{ startTime: "09:00", endTime: "15:00" }],
      },
    ],
    timeOff: [],
    isActive: true,
    notes: "Former nurse. Excellent with mobility assistance.",
  },
  {
    name: "Sarah Williams",
    email: "sarah.williams@example.com",
    phone: "07700900003",
    dateOfBirth: new Date("1990-11-08"),
    gender: "Female",
    address: {
      street: "789 Baker Street",
      city: "London",
      postcode: "NW1 6XE",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1586, 51.5237],
    },
    skills: [
      "dementia_care",
      "personal_care",
      "companionship",
      "meal_preparation",
      "household_tasks",
    ],
    canDrive: false,
    singleHandedOnly: false,
    maxCareReceivers: 8,
    availability: [
      {
        dayOfWeek: "Monday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Tuesday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Wednesday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Thursday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Friday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Saturday",
        slots: [{ startTime: "10:00", endTime: "14:00" }],
      },
      {
        dayOfWeek: "Sunday",
        slots: [{ startTime: "10:00", endTime: "14:00" }],
      },
    ],
    timeOff: [
      {
        startDate: new Date(Date.UTC(2026, 0, 15, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(2026, 0, 17, 23, 59, 59, 999)),
        reason: "Personal Leave",
      },
    ],
    isActive: true,
    notes: "Specializes in dementia care. Very patient.",
  },
  {
    name: "David Brown",
    email: "david.brown@example.com",
    phone: "07700900004",
    dateOfBirth: new Date("1982-05-14"),
    gender: "Male",
    address: {
      street: "321 Oxford Street",
      city: "London",
      postcode: "W1D 1BS",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.134, 51.5155],
    },
    skills: [
      "personal_care",
      "mobility_assistance",
      "medication_management",
      "meal_preparation",
    ],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 10,
    availability: [
      {
        dayOfWeek: "Monday",
        slots: [{ startTime: "07:00", endTime: "19:00" }],
      },
      {
        dayOfWeek: "Tuesday",
        slots: [{ startTime: "07:00", endTime: "19:00" }],
      },
      {
        dayOfWeek: "Wednesday",
        slots: [{ startTime: "07:00", endTime: "19:00" }],
      },
      {
        dayOfWeek: "Thursday",
        slots: [{ startTime: "07:00", endTime: "19:00" }],
      },
      {
        dayOfWeek: "Friday",
        slots: [{ startTime: "07:00", endTime: "19:00" }],
      },
    ],
    timeOff: [],
    isActive: true,
    notes: "Very reliable. Good with early/evening shifts.",
  },
  {
    name: "Emma Thompson",
    email: "emma.thompson@example.com",
    phone: "07700900005",
    dateOfBirth: new Date("1992-09-25"),
    gender: "Female",
    address: {
      street: "567 Piccadilly",
      city: "London",
      postcode: "W1J 9LL",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1419, 51.5074],
    },
    skills: [
      "dementia_care",
      "personal_care",
      "mobility_assistance",
      "companionship",
    ],
    canDrive: false,
    singleHandedOnly: false,
    maxCareReceivers: 8,
    availability: [
      {
        dayOfWeek: "Wednesday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Thursday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Friday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Saturday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
      {
        dayOfWeek: "Sunday",
        slots: [{ startTime: "09:00", endTime: "17:00" }],
      },
    ],
    timeOff: [],
    isActive: true,
    notes: "Weekend specialist. Great with elderly clients.",
  },
];

// =============================================================================
// CARE RECEIVERS DATA - WITH FLEXIBLE SCHEDULING
// =============================================================================

const careReceivers = [
  // Example 1: Tuesday & Friday Only (Weekly)
  {
    name: "Robert Smith",
    email: "robert.smith@example.com",
    phone: "07700900101",
    dateOfBirth: new Date("1942-04-10"),
    address: {
      street: "123 Westminster St",
      city: "London",
      postcode: "SW1A 1AA",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1419, 51.5014],
    },
    emergencyContact: {
      name: "Patricia Smith",
      relationship: "Child",
      phone: "07700900201",
    },
    gender: "Male",
    genderPreference: "No Preference",
    dailyVisits: [
      {
        visitNumber: 1,
        preferredTime: "09:00",
        duration: 60,
        requirements: ["personal_care", "medication_management"],
        doubleHanded: false,
        priority: 2,
        notes: "Tuesday & Friday morning visits only",
        // NEW FLEXIBLE SCHEDULING:
        daysOfWeek: ["Tuesday", "Friday"], // Only Tues & Fri
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        recurrenceStartDate: null,
      },
    ],
    notes: "Lives alone. Family visits on weekends. Needs care Tue/Fri only.",
    isActive: true,
  },

  // Example 2: Weekdays Only (Mon-Fri), Multiple Visits
  {
    name: "Margaret Wilson",
    email: "margaret.wilson@example.com",
    phone: "07700900102",
    dateOfBirth: new Date("1938-08-15"),
    address: {
      street: "456 Chelsea Manor St",
      city: "London",
      postcode: "SW3 5RL",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1657, 51.4875],
    },
    emergencyContact: {
      name: "James Wilson",
      relationship: "Child",
      phone: "07700900202",
    },
    gender: "Female",
    genderPreference: "Female",
    dailyVisits: [
      {
        visitNumber: 1,
        preferredTime: "08:00",
        duration: 90,
        requirements: [
          "personal_care",
          "medication_management",
          "meal_preparation",
        ],
        doubleHanded: false,
        priority: 1,
        notes: "Morning routine - weekdays only",
        // Weekdays only:
        daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
      },
      {
        visitNumber: 2,
        preferredTime: "18:00",
        duration: 60,
        requirements: ["meal_preparation", "personal_care"],
        doubleHanded: false,
        priority: 2,
        notes: "Evening routine - weekdays only",
        // Weekdays only:
        daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
      },
    ],
    notes:
      "Son stays on weekends. Weekday care only needed. Prefers female care givers.",
    isActive: true,
  },

  // Example 3: Every Day (All 7 days) - Backward Compatible
  {
    name: "Elizabeth Davies",
    email: "elizabeth.davies@example.com",
    phone: "07700900103",
    dateOfBirth: new Date("1945-02-20"),
    address: {
      street: "789 Kensington High St",
      city: "London",
      postcode: "W8 5SA",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1938, 51.5008],
    },
    emergencyContact: {
      name: "Sarah Davies",
      relationship: "Child",
      phone: "07700900203",
    },
    gender: "Female",
    genderPreference: "No Preference",
    dailyVisits: [
      {
        visitNumber: 1,
        preferredTime: "09:00",
        duration: 45,
        requirements: ["personal_care", "household_tasks"],
        doubleHanded: false,
        priority: 3,
        notes: "Daily morning visit - all 7 days",
        // Every day:
        daysOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
      },
    ],
    notes: "Needs daily check-in. All 7 days per week.",
    isActive: true,
  },

  // Example 4: Biweekly - Monday Only (Every 2 weeks)
  {
    name: "Thomas Anderson",
    email: "thomas.anderson@example.com",
    phone: "07700900104",
    dateOfBirth: new Date("1936-11-30"),
    address: {
      street: "234 Marylebone Road",
      city: "London",
      postcode: "NW1 5LS",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1586, 51.5237],
    },
    emergencyContact: {
      name: "Michael Anderson",
      relationship: "Child",
      phone: "07700900204",
    },
    gender: "Male",
    genderPreference: "Male",
    dailyVisits: [
      {
        visitNumber: 1,
        preferredTime: "10:00",
        duration: 120,
        requirements: [
          "personal_care",
          "mobility_assistance",
          "specialized_medical",
        ],
        doubleHanded: true,
        priority: 1,
        notes: "Deep care session - every other Monday",
        // Biweekly - Monday only:
        daysOfWeek: ["Monday"],
        recurrencePattern: "biweekly",
        recurrenceInterval: 2,
        recurrenceStartDate: new Date("2025-12-30"), // Start on Dec 30, 2025 (Monday)
      },
    ],
    notes: "Intensive care needed every 2 weeks. Double-handed required.",
    isActive: true,
  },

  // Example 5: Weekends Only (Sat-Sun)
  {
    name: "Dorothy Harris",
    email: "dorothy.harris@example.com",
    phone: "07700900105",
    dateOfBirth: new Date("1940-06-12"),
    address: {
      street: "890 Bond Street",
      city: "London",
      postcode: "W1S 1BQ",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.1419, 51.5122],
    },
    emergencyContact: {
      name: "Robert Harris",
      relationship: "Spouse/Partner",
      phone: "07700900205",
    },
    gender: "Female",
    genderPreference: "Female",
    dailyVisits: [
      {
        visitNumber: 1,
        preferredTime: "10:00",
        duration: 60,
        requirements: [
          "companionship",
          "medication_management",
          "household_tasks",
        ],
        doubleHanded: false,
        priority: 3,
        notes: "Weekend companionship when husband is away",
        // Weekends only:
        daysOfWeek: ["Saturday", "Sunday"],
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
      },
    ],
    notes: "Husband is primary carer during week. Weekend support needed.",
    isActive: true,
  },

  // Example 6: Mon/Wed/Fri Pattern
  {
    name: "George Martin",
    email: "george.martin@example.com",
    phone: "07700900106",
    dateOfBirth: new Date("1943-09-18"),
    address: {
      street: "456 Fleet Street",
      city: "London",
      postcode: "EC4A 2AB",
    },
    coordinates: {
      type: "Point",
      coordinates: [-0.107, 51.5144],
    },
    emergencyContact: {
      name: "Linda Martin",
      relationship: "Spouse/Partner",
      phone: "07700900206",
    },
    gender: "Male",
    genderPreference: "No Preference",
    dailyVisits: [
      {
        visitNumber: 1,
        preferredTime: "14:00",
        duration: 60,
        requirements: ["mobility_assistance", "companionship"],
        doubleHanded: false,
        priority: 2,
        notes: "Physiotherapy support days",
        // Mon/Wed/Fri only:
        daysOfWeek: ["Monday", "Wednesday", "Friday"],
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
      },
    ],
    notes: "Has physiotherapy Mon/Wed/Fri. Care aligned with therapy schedule.",
    isActive: true,
  },
];

// =============================================================================
// SEED FUNCTION
// =============================================================================

async function seedDatabase() {
  try {
    console.log("\n========================================");
    console.log("🌱 SEEDING DATABASE (FLEXIBLE SCHEDULING)");
    console.log("========================================\n");

    // Connect to MongoDB
    console.log("📡 Connecting to MongoDB...");
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/care_system_db"
    );
    console.log("✅ Connected to MongoDB\n");

    // Clear existing data
    console.log("🗑️  Clearing existing data...");
    await CareGiver.deleteMany({});
    await CareReceiver.deleteMany({});
    await Availability.deleteMany({});
    console.log("✅ Existing data cleared\n");

    // Insert Care Givers
    console.log("👥 Creating care givers...");
    const createdCareGivers = await CareGiver.insertMany(careGivers);
    console.log(`✅ Created ${createdCareGivers.length} care givers\n`);

    // Create Availability records
    console.log("📅 Creating availability records...");
    for (const cg of createdCareGivers) {
      await Availability.create({
        careGiver: cg._id,
        effectiveFrom: new Date(),
        effectiveTo: null,
        schedule: cg.availability,
        timeOff: cg.timeOff,
        isActive: true,
        notes: "Auto-created during seeding",
        version: 1,
      });
    }
    console.log(
      `✅ Created ${createdCareGivers.length} availability records\n`
    );

    // Set preferred care givers
    const sarahWilliams = createdCareGivers.find(
      (cg) => cg.name === "Sarah Williams"
    );
    if (sarahWilliams) {
      const margaret = careReceivers.find(
        (cr) => cr.name === "Margaret Wilson"
      );
      if (margaret) margaret.preferredCareGiver = sarahWilliams._id;

      const dorothy = careReceivers.find((cr) => cr.name === "Dorothy Harris");
      if (dorothy) dorothy.preferredCareGiver = sarahWilliams._id;
    }

    // Insert Care Receivers
    console.log("🏥 Creating care receivers...");
    const createdCareReceivers = await CareReceiver.insertMany(careReceivers);
    console.log(`✅ Created ${createdCareReceivers.length} care receivers\n`);

    // Summary
    console.log("========================================");
    console.log("✅ SEEDING COMPLETE!");
    console.log("========================================");
    console.log(`Care Givers: ${createdCareGivers.length}`);
    console.log(`Care Receivers: ${createdCareReceivers.length}`);
    console.log("========================================\n");

    // Detailed scheduling patterns
    console.log("📋 FLEXIBLE SCHEDULING PATTERNS:\n");

    createdCareReceivers.forEach((cr) => {
      console.log(`${cr.name}:`);
      cr.dailyVisits.forEach((visit) => {
        const days =
          visit.daysOfWeek.length === 7
            ? "Every day"
            : visit.daysOfWeek.join(", ");
        const pattern =
          visit.recurrencePattern === "weekly"
            ? "every week"
            : visit.recurrencePattern === "biweekly"
              ? "every 2 weeks"
              : visit.recurrencePattern === "monthly"
                ? "every 4 weeks"
                : `every ${visit.recurrenceInterval} weeks`;

        console.log(`   Visit ${visit.visitNumber}: ${visit.preferredTime}`);
        console.log(`      Days: ${days}`);
        console.log(`      Pattern: ${pattern}`);
        console.log(`      Requirements: ${visit.requirements.join(", ")}`);
      });
      console.log();
    });

    console.log("========================================");
    console.log("🎯 SCHEDULING EXAMPLES:");
    console.log("========================================");
    console.log("1️⃣  Robert Smith - Tue & Fri only, weekly");
    console.log("2️⃣  Margaret Wilson - Weekdays only (Mon-Fri), 2 visits/day");
    console.log("3️⃣  Elizabeth Davies - Every day (all 7 days)");
    console.log("4️⃣  Thomas Anderson - Monday only, every 2 weeks");
    console.log("5️⃣  Dorothy Harris - Weekends only (Sat-Sun)");
    console.log("6️⃣  George Martin - Mon/Wed/Fri only");
    console.log("========================================\n");

    console.log("🎯 NEXT STEPS:");
    console.log("   1. Start backend: npm start");
    console.log("   2. Generate schedule for Jan 2026");
    console.log("   3. Observe flexible scheduling in action:");
    console.log("      • Robert: Only Tue & Fri scheduled");
    console.log("      • Margaret: Only weekdays scheduled");
    console.log("      • Elizabeth: Every day scheduled");
    console.log("      • Thomas: Alternating Mondays only");
    console.log("      • Dorothy: Weekends only");
    console.log("      • George: Mon/Wed/Fri only\n");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("📡 Database connection closed");
    process.exit(0);
  }
}

// Run the seed function
seedDatabase();
