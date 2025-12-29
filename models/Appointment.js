// Updated Appointment Model - WITH VALIDATION FIELDS

const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    // Care receiver
    careReceiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CareReceiver",
      required: true,
      index: true,
    },

    // Care giver(s)
    careGiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CareGiver",
      required: true,
      index: true,
    },

    secondaryCareGiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CareGiver",
    },

    // NEW: Reference to availability at time of scheduling
    // This preserves the schedule that was valid when appointment was created
    careGiverAvailability: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Availability",
    },

    secondaryCareGiverAvailability: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Availability",
    },

    // Date and time
    date: {
      type: Date,
      required: true,
      index: true,
    },

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

    duration: {
      type: Number, // in minutes
      required: true,
    },

    // Visit details
    visitNumber: {
      type: Number,
      default: 1,
    },

    requirements: {
      type: [String],
      enum: [
        "personal_care",
        "medication_management",
        "dementia_care",
        "mobility_assistance",
        "meal_preparation",
        "companionship",
        "household_tasks",
        "specialized_medical",
      ],
    },

    doubleHanded: {
      type: Boolean,
      default: false,
    },

    // Status
    status: {
      type: String,
      enum: [
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
        "missed",
        "needs_review",
        "needs_reassignment", // ← ADDED FOR VALIDATION SYSTEM
      ],
      default: "scheduled",
      index: true,
    },

    // Notes
    notes: String,

    cancellationReason: String,

    // ========================================
    // NEW FIELDS FOR VALIDATION SYSTEM
    // ========================================
    invalidationReason: {
      type: String,
      // Stores why appointment needs reassignment
      // Example: "Care giver is now on time off; Care receiver changed time"
    },

    invalidatedAt: {
      type: Date,
      // When the conflict was detected
    },
    // ========================================

    // Completion details
    completedAt: Date,

    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
    },

    // Priority
    priority: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },

    // Metadata - Track scheduling context
    schedulingMetadata: {
      scheduledAt: Date,
      scheduledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
      },
      schedulingMethod: {
        type: String,
        enum: ["manual", "automatic", "imported"],
        default: "automatic",
      },
      // Snapshot of availability at scheduling time
      availabilitySnapshot: {
        version: Number,
        effectiveFrom: Date,
        wasWithinWorkingHours: Boolean,
        workingHoursAtScheduling: {
          startTime: String,
          endTime: String,
        },
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
appointmentSchema.index({ date: 1, careGiver: 1 });
appointmentSchema.index({ date: 1, status: 1 });
appointmentSchema.index({ careReceiver: 1, date: 1 });
appointmentSchema.index({ status: 1, date: 1 }); // ← ADDED for validation queries

// Pre-save: Capture availability snapshot
appointmentSchema.pre("save", async function (next) {
  if (this.isNew) {
    try {
      const Availability = mongoose.model("Availability");

      // Get current availability
      const availability = await Availability.getCurrentForCareGiver(
        this.careGiver,
        this.date
      );

      if (availability) {
        // Store reference
        this.careGiverAvailability = availability._id;

        // Store snapshot for historical context
        const dayOfWeek = this.date.toLocaleDateString("en-GB", {
          weekday: "long",
        });
        const daySchedule = availability.schedule.find(
          (s) => s.dayOfWeek === dayOfWeek
        );

        this.schedulingMetadata = {
          scheduledAt: new Date(),
          availabilitySnapshot: {
            version: availability.version,
            effectiveFrom: availability.effectiveFrom,
            wasWithinWorkingHours: daySchedule
              ? daySchedule.slots.some(
                  (slot) =>
                    this.startTime >= slot.startTime &&
                    this.endTime <= slot.endTime
                )
              : false,
            workingHoursAtScheduling:
              daySchedule && daySchedule.slots[0]
                ? {
                    startTime: daySchedule.slots[0].startTime,
                    endTime:
                      daySchedule.slots[daySchedule.slots.length - 1].endTime,
                  }
                : null,
          },
        };
      }
    } catch (error) {
      console.error("Error capturing availability snapshot:", error);
    }
  }
  next();
});

// Method to check if still within care giver's current availability
appointmentSchema.methods.isWithinCurrentAvailability = async function () {
  const Availability = mongoose.model("Availability");
  const currentAvailability = await Availability.getCurrentForCareGiver(
    this.careGiver,
    this.date
  );

  if (!currentAvailability) return false;

  const dayOfWeek = this.date.toLocaleDateString("en-GB", { weekday: "long" });
  return currentAvailability.isAvailableAt(dayOfWeek, this.startTime);
};

// Method to check if availability changed since scheduling
appointmentSchema.methods.hasAvailabilityChanged = async function () {
  if (!this.careGiverAvailability) return false;

  const Availability = mongoose.model("Availability");
  const currentAvailability = await Availability.getCurrentForCareGiver(
    this.careGiver,
    this.date
  );

  // Compare IDs - if different, availability has changed
  return (
    currentAvailability &&
    !currentAvailability._id.equals(this.careGiverAvailability)
  );
};

module.exports = mongoose.model("Appointment", appointmentSchema);
