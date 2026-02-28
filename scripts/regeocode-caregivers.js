// scripts/regeocode-caregivers.js
// Run this once to fix caregivers that were saved with default London coordinates
// Usage: node scripts/regeocode-caregivers.js

require("dotenv").config();
const mongoose = require("mongoose");
const CareGiver = require("../models/CareGiver");
const { geocodeAddress } = require("../services/mapboxService");

const DEFAULT_LONDON = [-0.1276, 51.5074];

function isDefaultCoords(coords) {
  if (!coords || !Array.isArray(coords) || coords.length < 2) return true;
  return coords[0] === DEFAULT_LONDON[0] && coords[1] === DEFAULT_LONDON[1];
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }
  if (!process.env.MAPBOX_API_KEY) {
    console.error("MAPBOX_API_KEY not set");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const careGivers = await CareGiver.find({});
  const toFix = careGivers.filter((cg) =>
    isDefaultCoords(cg.coordinates?.coordinates)
  );

  console.log(`Total caregivers: ${careGivers.length}`);
  console.log(`With default London coords (need re-geocoding): ${toFix.length}\n`);

  if (toFix.length === 0) {
    console.log("Nothing to fix.");
    await mongoose.disconnect();
    return;
  }

  let success = 0;
  let failed = 0;

  for (const cg of toFix) {
    const fullAddress =
      cg.address?.full ||
      `${cg.address?.street}, ${cg.address?.city} ${cg.address?.postcode}, United Kingdom`;

    try {
      const coords = await geocodeAddress(fullAddress);
      cg.coordinates = {
        type: "Point",
        coordinates: [coords.longitude, coords.latitude],
      };
      await cg.save();
      console.log(`✓ ${cg.name} → [${coords.longitude.toFixed(4)}, ${coords.latitude.toFixed(4)}]`);
      success++;
    } catch (err) {
      console.error(`✗ ${cg.name} (${fullAddress}): ${err.message}`);
      failed++;
    }

    // Small delay to avoid Mapbox rate limits
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\nDone: ${success} updated, ${failed} failed`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
