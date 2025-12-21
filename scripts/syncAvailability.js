// backend/scripts/syncAvailability.js
// Creates Availability documents for all care givers that don't have one

const mongoose = require("mongoose");
require("dotenv").config();

const CareGiver = require("../models/CareGiver");
const Availability = require("../models/Availability");

async function syncAvailability() {
  try {
    console.log("🔄 Syncing Availability Documents...\n");
    console.log("Connecting to database...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected!\n");

    // Get all care givers
    const careGivers = await CareGiver.find({});
    console.log(`Found ${careGivers.length} care giver(s)\n`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const cg of careGivers) {
      console.log(`========================================`);
      console.log(`Processing: ${cg.name}`);
      console.log(`ID: ${cg._id}`);
      console.log(`========================================`);

      // Check if has embedded availability
      if (!cg.availability || cg.availability.length === 0) {
        console.log("⚠️  No embedded availability data - SKIPPING");
        console.log("   (Please add availability to this care giver first)\n");
        skipped++;
        continue;
      }

      console.log(`📅 Embedded availability: ${cg.availability.length} day(s)`);
      cg.availability.forEach((day) => {
        console.log(`   ${day.dayOfWeek}: ${day.slots.length} slot(s)`);
      });

      if (cg.timeOff && cg.timeOff.length > 0) {
        console.log(`🏖️  Time off: ${cg.timeOff.length} period(s)`);
      }

      // Check if Availability document exists
      const existingAvailability = await Availability.findOne({
        careGiver: cg._id,
        isActive: true,
      });

      if (existingAvailability) {
        console.log(
          `\n📝 Availability document exists (ID: ${existingAvailability._id})`
        );
        console.log(
          `   Current schedule: ${existingAvailability.schedule.length} day(s)`
        );

        // Check if needs update
        if (existingAvailability.schedule.length !== cg.availability.length) {
          console.log("   ⚠️  Schedule length mismatch - UPDATING...");

          existingAvailability.schedule = cg.availability;
          existingAvailability.timeOff = cg.timeOff || [];
          existingAvailability.notes = "Updated by sync script";
          await existingAvailability.save();

          console.log(`   ✅ Updated to ${cg.availability.length} day(s)`);
          updated++;
        } else {
          console.log("   ✅ Already up to date - SKIPPING");
          skipped++;
        }
      } else {
        console.log("\n❌ No Availability document found - CREATING...");

        const newAvailability = await Availability.create({
          careGiver: cg._id,
          schedule: cg.availability,
          timeOff: cg.timeOff || [],
          effectiveFrom: cg.createdAt || new Date(),
          isActive: true,
          notes: "Created by sync script",
          version: 1,
        });

        console.log(
          `✅ Created Availability document (ID: ${newAvailability._id})`
        );
        console.log(`   Schedule: ${newAvailability.schedule.length} day(s)`);
        created++;
      }

      console.log(); // Empty line for readability
    }

    console.log("========================================");
    console.log("📊 SYNC COMPLETE!");
    console.log("========================================");
    console.log(`✅ Created: ${created}`);
    console.log(`📝 Updated: ${updated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`📁 Total processed: ${careGivers.length}`);
    console.log("========================================\n");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.connection.close();
    console.log("Database connection closed");
  }
}

// Run the sync
syncAvailability();
