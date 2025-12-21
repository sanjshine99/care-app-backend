// backend/models/Settings.js
// System settings model - stores configuration that affects scheduling

const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    // Singleton pattern - only one settings document
    _id: {
      type: String,
      default: "system_settings",
    },

    // Scheduling Settings
    scheduling: {
      maxDistanceKm: {
        type: Number,
        default: 20,
        min: 1,
        max: 100,
        description: "Maximum distance in km for care giver assignment",
      },

      travelTimeBufferMinutes: {
        type: Number,
        default: 15,
        min: 0,
        max: 60,
        description: "Buffer time in minutes between appointments for travel",
      },

      autoScheduleEnabled: {
        type: Boolean,
        default: true,
        description: "Enable automatic scheduling",
      },

      preferLocalCareGivers: {
        type: Boolean,
        default: true,
        description: "Prefer care givers closer to care receiver",
      },

      requireSkillMatch: {
        type: Boolean,
        default: true,
        description: "Require exact skill match for scheduling",
      },

      allowDoubleBooking: {
        type: Boolean,
        default: false,
        description: "Allow care giver to have overlapping appointments",
      },

      maxAppointmentsPerDay: {
        type: Number,
        default: 8,
        min: 1,
        max: 20,
        description: "Maximum appointments per care giver per day",
      },

      defaultAppointmentDuration: {
        type: Number,
        default: 60,
        min: 15,
        max: 240,
        description: "Default appointment duration in minutes",
      },
    },

    // Notification Settings
    notifications: {
      scheduleGeneratedNotify: {
        type: Boolean,
        default: true,
        description: "Notify when schedule is generated",
      },

      unscheduledNotify: {
        type: Boolean,
        default: true,
        description: "Notify about unscheduled appointments",
      },

      missedAppointmentNotify: {
        type: Boolean,
        default: true,
        description: "Notify about missed appointments",
      },

      notificationRetentionDays: {
        type: Number,
        default: 90,
        min: 7,
        max: 365,
        description: "Days to keep notifications before auto-delete",
      },
    },

    // System Settings
    system: {
      workingHoursStart: {
        type: String,
        default: "07:00",
        description: "System working hours start time",
      },

      workingHoursEnd: {
        type: String,
        default: "22:00",
        description: "System working hours end time",
      },

      timezone: {
        type: String,
        default: "Europe/London",
        description: "System timezone",
      },

      dateFormat: {
        type: String,
        default: "DD/MM/YYYY",
        enum: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"],
        description: "Date format for display",
      },

      timeFormat: {
        type: String,
        default: "24h",
        enum: ["12h", "24h"],
        description: "Time format for display",
      },
    },

    // Metadata
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
    },
  },
  {
    timestamps: true,
  }
);

// Static method to get settings (with caching)
settingsSchema.statics.getSettings = async function () {
  let settings = await this.findById("system_settings");

  // Create default settings if not exist
  if (!settings) {
    settings = await this.create({ _id: "system_settings" });
  }

  return settings;
};

// Static method to update settings
settingsSchema.statics.updateSettings = async function (updates, userId) {
  let settings = await this.findById("system_settings");

  if (!settings) {
    settings = await this.create({ _id: "system_settings" });
  }

  // Update nested fields
  if (updates.scheduling) {
    settings.scheduling = { ...settings.scheduling, ...updates.scheduling };
  }

  if (updates.notifications) {
    settings.notifications = {
      ...settings.notifications,
      ...updates.notifications,
    };
  }

  if (updates.system) {
    settings.system = { ...settings.system, ...updates.system };
  }

  settings.lastUpdatedBy = userId;
  await settings.save();

  return settings;
};

// Method to get specific setting value
settingsSchema.methods.get = function (path) {
  const keys = path.split(".");
  let value = this;

  for (const key of keys) {
    value = value[key];
    if (value === undefined) return null;
  }

  return value;
};

// Export model
module.exports = mongoose.model("Settings", settingsSchema);
