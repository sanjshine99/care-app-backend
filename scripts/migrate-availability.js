// backend/scripts/migrate-availability.js
// Migration Script: Move Availability to Separate Collection
// Run this ONCE to migrate existing data

require("dotenv").config();
const mongoose = require("mongoose");
const CareGiver = require("../models/CareGiver");
const Availability = require("../models/Availability");

async function migrateAvailabilityData() {
  console.log("🚀 Starting Availability Migration...\n");

  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(" Connected to MongoDB\n");
    console.log(`📦 Database: ${mongoose.connection.name}\n`);

    // Get all care givers
    const careGivers = await CareGiver.find();
    console.log(`📊 Found ${careGivers.length} care givers to migrate\n`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const cg of careGivers) {
      try {
        console.log(`Processing: ${cg.name} (${cg.email})...`);

        // Check if already migrated
        const existing = await Availability.findOne({
          careGiver: cg._id,
          effectiveTo: null,
        });

        if (existing) {
          console.log(`  ⏭️  Already migrated, skipping`);
          skipped++;
          continue;
        }

        // Check if has availability data
        if (!cg.availability || cg.availability.length === 0) {
          console.log(`    No availability data, skipping`);
          skipped++;
          continue;
        }

        // Create availability record
        const availability = await Availability.create({
          careGiver: cg._id,
          effectiveFrom: cg.createdAt || new Date(),
          effectiveTo: null,
          schedule: cg.availability.map((day) => ({
            dayOfWeek: day.dayOfWeek,
            slots: day.slots.map((slot) => ({
              startTime: slot.startTime,
              endTime: slot.endTime,
            })),
          })),
          timeOff: (cg.timeOff || []).map((to) => ({
            startDate: to.startDate,
            endDate: to.endDate,
            reason: to.reason || "",
          })),
          isActive: true,
          version: 1,
          notes: "Migrated from embedded data",
        });

        console.log(
          `   Migrated (ID: ${availability._id}, Version: ${availability.version})`,
        );
        migrated++;
      } catch (error) {
        console.log(`   Error: ${error.message}`);
        errors++;
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 Migration Summary:");
    console.log("=".repeat(60));
    console.log(`Total Care Givers: ${careGivers.length}`);
    console.log(` Migrated: ${migrated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(` Errors: ${errors}`);
    console.log("=".repeat(60) + "\n");

    if (migrated > 0) {
      console.log(" Migration completed successfully!\n");
      console.log("📝 Next Steps:");
      console.log(
        "1. Run verification: node scripts/migrate-availability.js verify",
      );
      console.log('2. Check MongoDB for "availabilities" collection');
      console.log("3. Update backend services to use Availability collection");
      console.log("4. Test scheduling with new structure");
      console.log("5. After 1 month, consider removing embedded data\n");
    } else {
      console.log("ℹ️  No data was migrated\n");
    }
  } catch (error) {
    console.error(" Migration failed:", error.message);
    console.error("Stack:", error.stack);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log(" Database connection closed\n");
  }
}

// Verification function - Check migration results
async function verifyMigration() {
  console.log("\n Verifying Migration...\n");

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`📦 Database: ${mongoose.connection.name}\n`);

  const careGiversCount = await CareGiver.countDocuments();
  const availabilityCount = await Availability.countDocuments({
    effectiveTo: null,
  });
  const totalAvailability = await Availability.countDocuments();

  console.log("📊 Statistics:");
  console.log(`Care Givers: ${careGiversCount}`);
  console.log(`Current Availability Records: ${availabilityCount}`);
  console.log(
    `Total Availability Records (including history): ${totalAvailability}`,
  );

  if (availabilityCount < careGiversCount) {
    console.log(
      `\n  ${careGiversCount - availabilityCount} care givers missing availability`,
    );

    // Find which care givers are missing
    const careGivers = await CareGiver.find();
    console.log("\nMissing Availability:");
    for (const cg of careGivers) {
      const avail = await Availability.findOne({
        careGiver: cg._id,
        effectiveTo: null,
      });
      if (!avail) {
        console.log(`  - ${cg.name} (${cg.email})`);
      }
    }
  } else {
    console.log("\n All care givers have availability records");
  }

  // Sample check
  const sample = await Availability.findOne({ effectiveTo: null }).populate(
    "careGiver",
    "name email",
  );

  if (sample) {
    console.log("\n Sample Record:");
    console.log(
      `Care Giver: ${sample.careGiver.name} (${sample.careGiver.email})`,
    );
    console.log(`Version: ${sample.version}`);
    console.log(`Effective From: ${sample.effectiveFrom.toISOString()}`);
    console.log(`Effective To: ${sample.effectiveTo || "Current"}`);
    console.log(`Working Days: ${sample.schedule.length}`);
    console.log(`Time Off Periods: ${sample.timeOff.length}`);
    console.log(`Is Active: ${sample.isActive}`);
  }

  // Check for multiple versions
  const versionsCheck = await Availability.aggregate([
    {
      $group: {
        _id: "$careGiver",
        count: { $sum: 1 },
        maxVersion: { $max: "$version" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (versionsCheck.length > 0) {
    console.log(
      `\n📚 ${versionsCheck.length} care giver(s) have multiple availability versions (history)`,
    );
  }

  console.log("\n Verification complete");
  await mongoose.connection.close();
}

// Rollback function - In case you need to undo
async function rollbackMigration() {
  console.log("\n  Rolling back migration...\n");

  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.question(
    "Are you sure you want to delete all migrated availability records? (yes/no): ",
    async (answer) => {
      if (answer.toLowerCase() !== "yes") {
        console.log("Rollback cancelled");
        readline.close();
        return;
      }

      await mongoose.connect(process.env.MONGODB_URI);

      const result = await Availability.deleteMany({
        notes: "Migrated from embedded data",
      });

      console.log(
        `\n Deleted ${result.deletedCount} migrated availability records`,
      );

      await mongoose.connection.close();
      console.log(" Rollback complete\n");
      readline.close();
      process.exit(0);
    },
  );
}

// Export functions
module.exports = {
  migrateAvailabilityData,
  verifyMigration,
  rollbackMigration,
};

// Run migration if called directly
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case "migrate":
      migrateAvailabilityData()
        .then(() => process.exit(0))
        .catch((err) => {
          console.error(err);
          process.exit(1);
        });
      break;

    case "verify":
      verifyMigration()
        .then(() => process.exit(0))
        .catch((err) => {
          console.error(err);
          process.exit(1);
        });
      break;

    case "rollback":
      rollbackMigration();
      break;

    default:
      console.log("\n📚 Availability Migration Tool\n");
      console.log("Usage:");
      console.log(
        "  node scripts/migrate-availability.js migrate   - Run migration",
      );
      console.log(
        "  node scripts/migrate-availability.js verify    - Verify results",
      );
      console.log(
        "  node scripts/migrate-availability.js rollback  - Undo migration (careful!)\n",
      );
      process.exit(0);
  }
}
