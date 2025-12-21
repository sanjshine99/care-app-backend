// backend/controllers/notificationController.js
// Complete notification management

const Notification = require("../models/Notification");

// @desc    Get all notifications for current user
// @route   GET /api/notifications
// @access  Private
exports.getAllNotifications = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      priority,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query
    const query = { adminUser: req.user._id };

    if (status) {
      query.status = status;
    }

    if (type) {
      query.type = type;
    }

    if (priority) {
      query.priority = priority;
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Get notifications
    const notifications = await Notification.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get unread notification count
// @route   GET /api/notifications/unread-count
// @access  Private
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.getUnreadCount(req.user._id);

    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/mark-read
// @access  Private
exports.markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      adminUser: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Notification not found",
          code: "NOTIFICATION_NOT_FOUND",
        },
      });
    }

    await notification.markAsRead();

    res.json({
      success: true,
      data: { notification },
      message: "Notification marked as read",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark notification as completed
// @route   PUT /api/notifications/:id/mark-completed
// @access  Private
exports.markAsCompleted = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      adminUser: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Notification not found",
          code: "NOTIFICATION_NOT_FOUND",
        },
      });
    }

    await notification.markAsCompleted();

    res.json({
      success: true,
      data: { notification },
      message: "Notification marked as completed",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Archive notification
// @route   PUT /api/notifications/:id/archive
// @access  Private
exports.archiveNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      adminUser: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Notification not found",
          code: "NOTIFICATION_NOT_FOUND",
        },
      });
    }

    await notification.archive();

    res.json({
      success: true,
      data: { notification },
      message: "Notification archived",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
exports.deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      adminUser: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Notification not found",
          code: "NOTIFICATION_NOT_FOUND",
        },
      });
    }

    res.json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Bulk action on notifications
// @route   POST /api/notifications/bulk-action
// @access  Private
exports.bulkAction = async (req, res, next) => {
  try {
    const { action, notificationIds } = req.body;

    if (!action || !notificationIds || notificationIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Action and notification IDs are required",
          code: "MISSING_FIELDS",
        },
      });
    }

    const result = await Notification.bulkAction(
      req.user._id,
      action,
      notificationIds
    );

    res.json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount,
      },
      message: `${result.modifiedCount} notification(s) updated`,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/mark-all-read
// @access  Private
exports.markAllAsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      {
        adminUser: req.user._id,
        status: "unread",
      },
      {
        $set: {
          status: "read",
          readAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount,
      },
      message: `${result.modifiedCount} notification(s) marked as read`,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get notification statistics
// @route   GET /api/notifications/stats
// @access  Private
exports.getStats = async (req, res, next) => {
  try {
    const [total, unread, read, archived, byType, byPriority, actionRequired] =
      await Promise.all([
        Notification.countDocuments({ adminUser: req.user._id }),
        Notification.countDocuments({
          adminUser: req.user._id,
          status: "unread",
        }),
        Notification.countDocuments({
          adminUser: req.user._id,
          status: "read",
        }),
        Notification.countDocuments({
          adminUser: req.user._id,
          status: "archived",
        }),
        Notification.aggregate([
          { $match: { adminUser: req.user._id } },
          { $group: { _id: "$type", count: { $sum: 1 } } },
        ]),
        Notification.aggregate([
          { $match: { adminUser: req.user._id } },
          { $group: { _id: "$priority", count: { $sum: 1 } } },
        ]),
        Notification.countDocuments({
          adminUser: req.user._id,
          actionRequired: true,
          status: { $in: ["unread", "read"] },
        }),
      ]);

    // Format aggregated data
    const typeStats = {};
    byType.forEach((item) => {
      typeStats[item._id] = item.count;
    });

    const priorityStats = {};
    byPriority.forEach((item) => {
      priorityStats[item._id] = item.count;
    });

    res.json({
      success: true,
      data: {
        stats: {
          total,
          unread,
          read,
          archived,
          actionRequired,
          byType: typeStats,
          byPriority: priorityStats,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create test notification (for development)
// @route   POST /api/notifications/test
// @access  Private
exports.createTestNotification = async (req, res, next) => {
  try {
    const notification = await Notification.create({
      adminUser: req.user._id,
      type: "info",
      priority: "medium",
      title: "Test Notification",
      message:
        "This is a test notification created at " + new Date().toLocaleString(),
      actionRequired: false,
    });

    res.status(201).json({
      success: true,
      data: { notification },
      message: "Test notification created",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
