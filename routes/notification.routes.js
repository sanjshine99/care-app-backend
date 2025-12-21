// backend/routes/notification.routes.js
// Complete notification routes

const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getAllNotifications,
  getUnreadCount,
  markAsRead,
  markAsCompleted,
  archiveNotification,
  deleteNotification,
  bulkAction,
  markAllAsRead,
  getStats,
  createTestNotification,
} = require("../controllers/notificationController");

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get notifications
router.get("/", getAllNotifications); // GET /api/notifications
router.get("/unread-count", getUnreadCount); // GET /api/notifications/unread-count
router.get("/stats", getStats); // GET /api/notifications/stats

// Actions on single notification
router.put("/:id/mark-read", markAsRead); // PUT /api/notifications/:id/mark-read
router.put("/:id/mark-completed", markAsCompleted); // PUT /api/notifications/:id/mark-completed
router.put("/:id/archive", archiveNotification); // PUT /api/notifications/:id/archive
router.delete("/:id", deleteNotification); // DELETE /api/notifications/:id

// Bulk actions
router.post("/bulk-action", bulkAction); // POST /api/notifications/bulk-action
router.put("/mark-all-read", markAllAsRead); // PUT /api/notifications/mark-all-read

// Test (development only)
router.post("/test", createTestNotification); // POST /api/notifications/test

module.exports = router;
