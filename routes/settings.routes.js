// backend/routes/settings.routes.js
// Complete settings routes

const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getSettings,
  updateSettings,
  resetSettings,
} = require("../controllers/settingsController");

const router = express.Router();

// All routes require authentication
router.use(protect);

// Settings CRUD
router.get("/", getSettings); // GET /api/settings
router.put("/", updateSettings); // PUT /api/settings
router.post("/reset", resetSettings); // POST /api/settings/reset

module.exports = router;
