const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(` MongoDB Connected: ${conn.connection.host}`);
    console.log(`📦 Database: ${conn.connection.name}`);

    // Ensure all schema-defined indexes (including 2dsphere) exist in the database
    await conn.connection.syncIndexes();
    console.log("Database indexes synced");

    // Verify critical 2dsphere index exists — scheduling depends on $near queries
    try {
      const CareGiver = require("../models/CareGiver");
      const indexes = await CareGiver.collection.getIndexes();
      const has2dsphere = Object.values(indexes).some((idx) =>
        Object.values(idx).includes("2dsphere")
      );
      if (!has2dsphere) {
        console.error(
          "CRITICAL: Missing 2dsphere index on caregivers collection — scheduling geo-queries will fail"
        );
      }
    } catch (indexErr) {
      console.error("Could not verify 2dsphere index:", indexErr.message);
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
