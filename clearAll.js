// care-app-backend/clearAll.js
// Clears all collections that seed.js populates. Run before re-seeding.
// Run: node clearAll.js  or  npm run seed:clear

require("dotenv").config();
const mongoose = require("mongoose");
const AdminUser = require("./models/AdminUser");
const CareGiver = require("./models/CareGiver");
const CareReceiver = require("./models/CareReceiver");
const Availability = require("./models/Availability");
const Appointment = require("./models/Appointment");
const Notification = require("./models/Notification");

async function clearAll() {
  try {
    console.log("\nConnecting to MongoDB...");
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/care_system_db"
    );
    console.log("Connected\n");

    const [notif, appt, av, cr, cg, admin] = await Promise.all([
      Notification.countDocuments(),
      Appointment.countDocuments(),
      Availability.countDocuments(),
      CareReceiver.countDocuments(),
      CareGiver.countDocuments(),
      AdminUser.countDocuments(),
    ]);

    console.log("Current counts:");
    console.log(`  Notifications:       ${notif}`);
    console.log(`  Appointments:        ${appt}`);
    console.log(`  Availability:        ${av}`);
    console.log(`  CareReceivers:       ${cr}`);
    console.log(`  CareGivers:          ${cg}`);
    console.log(`  AdminUsers:          ${admin}`);
    console.log("");

    await Promise.all([
      Notification.deleteMany({}),
      Appointment.deleteMany({}),
      Availability.deleteMany({}),
      CareReceiver.deleteMany({}),
      CareGiver.deleteMany({}),
      AdminUser.deleteMany({}),
    ]);

    console.log("All data cleared successfully (matches seed.js collections).");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("Database connection closed");
    process.exit(0);
  }
}

clearAll();
