const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const CareGiver = require("../models/CareGiver");
const { geocodeAddress } = require("../services/mapboxService");

// @desc    Test database connection
// @route   GET /api/diagnostic/db
// @access  Public
router.get("/db", async (req, res) => {
  try {
    const dbStatus = {
      connected: mongoose.connection.readyState === 1,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      states: {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
      },
    };

    // Try to count documents
    const careGiversCount = await CareGiver.countDocuments();

    res.json({
      success: true,
      database: dbStatus,
      collections: {
        careGivers: careGiversCount,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// @desc    Test Mapbox geocoding
// @route   GET /api/diagnostic/mapbox
// @access  Public
router.get("/mapbox", async (req, res) => {
  try {
    const testAddress = "10 Downing Street, London, SW1A 2AA, United Kingdom";

    const hasKey = !!process.env.MAPBOX_API_KEY;
    const keyPreview = process.env.MAPBOX_API_KEY
      ? process.env.MAPBOX_API_KEY.substring(0, 10) + "..."
      : "NOT SET";

    if (!hasKey) {
      return res.json({
        success: false,
        mapbox: {
          configured: false,
          key: "NOT SET",
          error: "MAPBOX_API_KEY environment variable is not set",
        },
      });
    }

    const result = await geocodeAddress(testAddress);

    res.json({
      success: true,
      mapbox: {
        configured: true,
        keyPreview,
        testAddress,
        result,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      mapbox: {
        configured: !!process.env.MAPBOX_API_KEY,
        error: error.message,
      },
    });
  }
});

// @desc    Create test care giver
// @route   POST /api/diagnostic/test-create
// @access  Public
router.post("/test-create", async (req, res) => {
  try {
    console.log("\n🧪 TEST CREATE CARE GIVER");

    // Create with minimal data
    const testData = {
      name: "Test Care Giver " + Date.now(),
      email: `test${Date.now()}@example.com`,
      phone: "07123456789",
      address: {
        street: "10 Downing Street",
        city: "London",
        postcode: "SW1A 2AA",
      },
      coordinates: {
        type: "Point",
        coordinates: [-0.127758, 51.503364], // Pre-geocoded
      },
      gender: "Female",
      dateOfBirth: new Date("1990-01-01"),
      skills: ["personal_care"],
      canDrive: true,
    };

    console.log("💾 Creating test care giver...");
    const careGiver = await CareGiver.create(testData);
    console.log("✅ Created:", careGiver._id);

    // Verify it exists
    const verification = await CareGiver.findById(careGiver._id);
    console.log("🔍 Verification:", verification ? "FOUND" : "NOT FOUND");

    // Count all
    const count = await CareGiver.countDocuments();
    console.log("📊 Total count:", count);

    res.json({
      success: true,
      message: "Test care giver created successfully",
      careGiver: {
        id: careGiver._id,
        name: careGiver.name,
        email: careGiver.email,
      },
      verification: !!verification,
      totalCount: count,
    });
  } catch (error) {
    console.error("❌ Test create failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

// @desc    List all care givers (diagnostic)
// @route   GET /api/diagnostic/list
// @access  Public
router.get("/list", async (req, res) => {
  try {
    const careGivers = await CareGiver.find()
      .select("name email createdAt")
      .limit(50);
    const count = await CareGiver.countDocuments();

    res.json({
      success: true,
      count,
      careGivers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// @desc    Delete all test care givers
// @route   DELETE /api/diagnostic/cleanup
// @access  Public
router.delete("/cleanup", async (req, res) => {
  try {
    const result = await CareGiver.deleteMany({
      name: { $regex: /^Test Care Giver/ },
    });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} test care givers`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
