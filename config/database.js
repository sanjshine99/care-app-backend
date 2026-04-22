const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(` MongoDB Connected: ${conn.connection.host}`);
    console.log(`📦 Database: ${conn.connection.name}`);

    // Sync indexes for all registered models
    try {
      await conn.connection.syncIndexes();
      console.log("Database indexes synced");
    } catch (syncErr) {
      console.error("syncIndexes error:", syncErr.message);
    }

    // Explicitly ensure CareGiver indexes (2dsphere) — surface any data issues
    const CareGiver = require("../models/CareGiver");
    try {
      await CareGiver.ensureIndexes();
      console.log("CareGiver indexes verified (including 2dsphere)");
    } catch (indexErr) {
      console.error(
        "CRITICAL: Failed to create CareGiver indexes —",
        indexErr.message
      );
      console.error(
        "This likely means some caregivers have invalid coordinates. " +
          "Fix the data, then restart."
      );

      // Identify caregivers with invalid coordinates
      try {
        const badDocs = await CareGiver.find({
          $or: [
            { "coordinates.coordinates": { $exists: false } },
            { "coordinates.coordinates": { $size: 0 } },
            { "coordinates.coordinates.0": { $lt: -180 } },
            { "coordinates.coordinates.0": { $gt: 180 } },
            { "coordinates.coordinates.1": { $lt: -90 } },
            { "coordinates.coordinates.1": { $gt: 90 } },
          ],
        }).select("name coordinates");
        if (badDocs.length > 0) {
          console.error("Caregivers with invalid coordinates:");
          badDocs.forEach((d) =>
            console.error(
              `  - ${d.name} (${d._id}): ${JSON.stringify(d.coordinates)}`
            )
          );
        }
      } catch (diagErr) {
        console.error("Could not run diagnostics:", diagErr.message);
      }
    }

    // Explicitly ensure Appointment indexes (compound unique)
    const Appointment = require("../models/Appointment");
    try {
      await Appointment.ensureIndexes();
      console.log("Appointment indexes verified (including unique compound)");
    } catch (indexErr) {
      console.error(
        "WARNING: Failed to create Appointment indexes —",
        indexErr.message
      );
    }

    // Handle connection events
    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("MongoDB disconnected");
    });

  } catch (error) {
    console.error(" MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
