// APPROACH 1: Separate Availability Collection with History

const mongoose = require("mongoose");

// New Collection: Availability
const availabilitySchema = new mongoose.Schema(
  {
    careGiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CareGiver",
      required: true,
      index: true,
    },

    // Version/effective date
    effectiveFrom: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    effectiveTo: {
      type: Date,
      default: null, // null = current/active
      index: true,
    },

    // Weekly schedule
    schedule: [
      {
        dayOfWeek: {
          type: String,
          enum: [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ],
          required: true,
        },
        slots: [
          {
            startTime: {
              type: String,
              required: true,
              match: /^([01]\d|2[0-3]):([0-5]\d)$/,
            },
            endTime: {
              type: String,
              required: true,
              match: /^([01]\d|2[0-3]):([0-5]\d)$/,
            },
          },
        ],
      },
    ],

    // Time off periods
    timeOff: [
      {
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        reason: String,
      },
    ],

    // Status
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
    },

    notes: String,

    // Version tracking
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
availabilitySchema.index({ careGiver: 1, effectiveTo: 1, isActive: 1 });
availabilitySchema.index({ careGiver: 1, effectiveFrom: 1 });

// Get current availability for a care giver
availabilitySchema.statics.getCurrentForCareGiver = async function (
  careGiverId,
  date = new Date()
) {
  return await this.findOne({
    careGiver: careGiverId,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
    isActive: true,
  }).sort({ effectiveFrom: -1 });
};

// Get availability at specific date (for historical reference)
availabilitySchema.statics.getAtDate = async function (careGiverId, date) {
  return await this.findOne({
    careGiver: careGiverId,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
  }).sort({ effectiveFrom: -1 });
};

// Get all history for care giver
availabilitySchema.statics.getHistory = async function (careGiverId) {
  return await this.find({
    careGiver: careGiverId,
  }).sort({ effectiveFrom: -1 });
};

// Create new version (closes old, creates new)
availabilitySchema.statics.createNewVersion = async function (
  careGiverId,
  newSchedule,
  effectiveFrom = new Date()
) {
  // Close current availability
  await this.updateMany(
    {
      careGiver: careGiverId,
      effectiveTo: null,
      isActive: true,
    },
    {
      effectiveTo: effectiveFrom,
      isActive: false,
    }
  );

  // Create new availability
  const lastVersion = await this.findOne({ careGiver: careGiverId }).sort({
    version: -1,
  });
  const nextVersion = lastVersion ? lastVersion.version + 1 : 1;

  return await this.create({
    careGiver: careGiverId,
    effectiveFrom,
    effectiveTo: null,
    schedule: newSchedule.schedule,
    timeOff: newSchedule.timeOff,
    isActive: true,
    version: nextVersion,
  });
};

// Method to check if available at specific time
availabilitySchema.methods.isAvailableAt = function (dayOfWeek, time) {
  const daySchedule = this.schedule.find((s) => s.dayOfWeek === dayOfWeek);
  if (!daySchedule) return false;

  return daySchedule.slots.some((slot) => {
    return time >= slot.startTime && time <= slot.endTime;
  });
};

// Method to check time off
availabilitySchema.methods.isOnTimeOff = function (date) {
  return this.timeOff.some((to) => {
    return date >= to.startDate && date <= to.endDate;
  });
};

module.exports = mongoose.model("Availability", availabilitySchema);
