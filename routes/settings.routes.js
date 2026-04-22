// backend/routes/settings.routes.js
// Complete settings routes

const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getSettings,
  updateSettings,
  resetSettings,
} = require("../controllers/settingsController");

const cachePrivate = (seconds) => (_req, res, next) => {
  res.set("Cache-Control", `private, max-age=${seconds}`);
  next();
};

const router = express.Router();

// All routes require authentication
router.use(protect);

// Settings CRUD
router.get("/", cachePrivate(300), getSettings); // GET /api/settings — cached 5 min
router.put("/", updateSettings); // PUT /api/settings
router.post("/reset", resetSettings); // POST /api/settings/reset

module.exports = router;
