const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    adminUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: [true, 'Admin user is required'],
    },
    type: {
      type: String,
      enum: ['success', 'error', 'warning', 'info'],
      required: [true, 'Notification type is required'],
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      maxlength: [500, 'Message cannot exceed 500 characters'],
    },
    metadata: {
      action: String,
      resourceType: String,
      resourceId: mongoose.Schema.Types.ObjectId,
      count: Number,
      details: mongoose.Schema.Types.Mixed,
    },
    status: {
      type: String,
      enum: ['unread', 'read', 'archived', 'completed'],
      default: 'unread',
    },
    actionRequired: {
      type: Boolean,
      default: false,
    },
    actionUrl: String,
    actionLabel: String,
    readAt: Date,
    completedAt: Date,
    archivedAt: Date,
    expiresAt: {
      type: Date,
      default: function () {
        // Auto-delete after 90 days
        return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
notificationSchema.index({ adminUser: 1, status: 1 });
notificationSchema.index({ adminUser: 1, createdAt: -1 });
notificationSchema.index({ status: 1 });
notificationSchema.index({ priority: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-deletion

// Method to mark as read
notificationSchema.methods.markAsRead = async function () {
  if (this.status === 'unread') {
    this.status = 'read';
    this.readAt = new Date();
    await this.save();
  }
};

// Method to mark as completed
notificationSchema.methods.markAsCompleted = async function () {
  this.status = 'completed';
  this.completedAt = new Date();
  await this.save();
};

// Method to archive
notificationSchema.methods.archive = async function () {
  this.status = 'archived';
  this.archivedAt = new Date();
  await this.save();
};

// Static method to create notification
notificationSchema.statics.createNotification = async function (notificationData) {
  try {
    const notification = await this.create(notificationData);
    
    // Emit WebSocket event (handled in controller/service)
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

// Static method to get unread count for user
notificationSchema.statics.getUnreadCount = async function (userId) {
  return await this.countDocuments({
    adminUser: userId,
    status: 'unread',
  });
};

// Static method to get notifications for user with pagination
notificationSchema.statics.getUserNotifications = async function (
  userId,
  { page = 1, limit = 20, status = null }
) {
  const query = { adminUser: userId };
  
  if (status) {
    query.status = status;
  }
  
  const notifications = await this.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  
  const total = await this.countDocuments(query);
  
  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

// Static method to bulk update notifications
notificationSchema.statics.bulkAction = async function (userId, action, notificationIds) {
  const updateData = {};
  
  switch (action) {
    case 'mark_read':
      updateData.status = 'read';
      updateData.readAt = new Date();
      break;
    case 'mark_complete':
      updateData.status = 'completed';
      updateData.completedAt = new Date();
      break;
    case 'archive':
      updateData.status = 'archived';
      updateData.archivedAt = new Date();
      break;
    default:
      throw new Error('Invalid bulk action');
  }
  
  const result = await this.updateMany(
    {
      _id: { $in: notificationIds },
      adminUser: userId,
    },
    { $set: updateData }
  );
  
  return result;
};

// Static method to auto-archive old notifications
notificationSchema.statics.autoArchiveOld = async function (daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  const result = await this.updateMany(
    {
      status: { $in: ['read', 'completed'] },
      createdAt: { $lt: cutoffDate },
    },
    {
      $set: {
        status: 'archived',
        archivedAt: new Date(),
      },
    }
  );
  
  return result;
};

module.exports = mongoose.model('Notification', notificationSchema);
