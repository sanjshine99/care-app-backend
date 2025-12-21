const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema(
  {
    // Singleton identifier - always use this ID
    _id: {
      type: String,
      default: 'system_settings',
    },
    
    // Scheduling settings
    scheduling: {
      maxDistanceKm: {
        type: Number,
        default: 20,
        min: [1, 'Maximum distance must be at least 1 km'],
        max: [100, 'Maximum distance cannot exceed 100 km'],
      },
      travelTimeBufferMinutes: {
        type: Number,
        default: 15,
        min: [0, 'Buffer cannot be negative'],
        max: [60, 'Buffer cannot exceed 60 minutes'],
      },
      autoScheduleEnabled: {
        type: Boolean,
        default: true,
      },
      preferredCareGiverWeight: {
        type: Number,
        default: 0.3,
        min: [0, 'Weight must be between 0 and 1'],
        max: [1, 'Weight must be between 0 and 1'],
      },
      distanceWeight: {
        type: Number,
        default: 0.4,
        min: [0, 'Weight must be between 0 and 1'],
        max: [1, 'Weight must be between 0 and 1'],
      },
      availabilityWeight: {
        type: Number,
        default: 0.3,
        min: [0, 'Weight must be between 0 and 1'],
        max: [1, 'Weight must be between 0 and 1'],
      },
    },
    
    // Notification settings
    notifications: {
      enabled: {
        type: Boolean,
        default: true,
      },
      autoArchiveDays: {
        type: Number,
        default: 30,
        min: [1, 'Must be at least 1 day'],
        max: [365, 'Cannot exceed 365 days'],
      },
      autoDeleteDays: {
        type: Number,
        default: 90,
        min: [1, 'Must be at least 1 day'],
        max: [365, 'Cannot exceed 365 days'],
      },
      emailNotifications: {
        type: Boolean,
        default: false, // Future feature
      },
      pushNotifications: {
        type: Boolean,
        default: false, // Future feature
      },
    },
    
    // Working hours
    workingHours: {
      start: {
        type: String,
        default: '07:00',
        match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'],
      },
      end: {
        type: String,
        default: '22:00',
        match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'],
      },
    },
    
    // Care giver limits
    careGiverLimits: {
      maxCareReceivers: {
        type: Number,
        default: 10,
        min: [1, 'Must be at least 1'],
        max: [20, 'Cannot exceed 20'],
      },
      maxDailyAppointments: {
        type: Number,
        default: 8,
        min: [1, 'Must be at least 1'],
        max: [16, 'Cannot exceed 16'],
      },
    },
    
    // Visit duration limits
    visitDuration: {
      min: {
        type: Number,
        default: 15,
        min: [15, 'Minimum visit must be at least 15 minutes'],
      },
      max: {
        type: Number,
        default: 240,
        min: [30, 'Maximum visit must be at least 30 minutes'],
        max: [480, 'Maximum visit cannot exceed 480 minutes (8 hours)'],
      },
      defaultDuration: {
        type: Number,
        default: 60,
        min: [15, 'Default duration must be at least 15 minutes'],
      },
    },
    
    // System info
    systemInfo: {
      organizationName: {
        type: String,
        default: 'Care Scheduling System',
        maxlength: [100, 'Organization name cannot exceed 100 characters'],
      },
      timezone: {
        type: String,
        default: 'Europe/London',
      },
      currency: {
        type: String,
        default: 'GBP',
      },
      dateFormat: {
        type: String,
        default: 'DD/MM/YYYY',
        enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
      },
      timeFormat: {
        type: String,
        default: '24h',
        enum: ['12h', '24h'],
      },
    },
    
    // Last updated info
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminUser',
    },
  },
  {
    timestamps: true,
  }
);

// Static method to get settings (singleton)
systemSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findById('system_settings');
  
  // Create default settings if they don't exist
  if (!settings) {
    settings = await this.create({ _id: 'system_settings' });
  }
  
  return settings;
};

// Static method to update settings
systemSettingsSchema.statics.updateSettings = async function (updates, userId) {
  let settings = await this.findById('system_settings');
  
  if (!settings) {
    settings = await this.create({ _id: 'system_settings' });
  }
  
  // Update only provided fields
  Object.keys(updates).forEach((key) => {
    if (updates[key] !== undefined) {
      settings[key] = updates[key];
    }
  });
  
  settings.lastUpdatedBy = userId;
  await settings.save();
  
  return settings;
};

// Validation: Ensure weights sum to 1.0
systemSettingsSchema.pre('save', function (next) {
  const { preferredCareGiverWeight, distanceWeight, availabilityWeight } = this.scheduling;
  
  const totalWeight = preferredCareGiverWeight + distanceWeight + availabilityWeight;
  
  if (Math.abs(totalWeight - 1.0) > 0.01) {
    return next(new Error('Scheduling weights must sum to 1.0'));
  }
  
  next();
});

// Validation: working hours end must be after start
systemSettingsSchema.pre('save', function (next) {
  const [startHour, startMin] = this.workingHours.start.split(':').map(Number);
  const [endHour, endMin] = this.workingHours.end.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  if (endMinutes <= startMinutes) {
    return next(new Error('Working hours end time must be after start time'));
  }
  
  next();
});

// Method to reset to defaults
systemSettingsSchema.methods.resetToDefaults = async function () {
  const defaults = new mongoose.model('SystemSettings')();
  
  this.scheduling = defaults.scheduling;
  this.notifications = defaults.notifications;
  this.workingHours = defaults.workingHours;
  this.careGiverLimits = defaults.careGiverLimits;
  this.visitDuration = defaults.visitDuration;
  
  await this.save();
  return this;
};

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
