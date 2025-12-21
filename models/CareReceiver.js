const mongoose = require("mongoose");

const careReceiverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      match: [
        /^(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}$/,
        "Please provide a valid UK phone number",
      ],
    },
    address: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      postcode: {
        type: String,
        required: true,
        uppercase: true,
        match: [
          /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i,
          "Please provide a valid UK postcode",
        ],
      },
      full: String,
    },
    coordinates: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Non-binary", "Prefer not to say"],
    },
    genderPreference: {
      type: String,
      enum: ["Male", "Female", "No Preference"],
      default: "No Preference",
    },
    dailyVisits: [
      {
        visitNumber: {
          type: Number,
          required: true,
          min: 1,
          max: 4,
        },
        preferredTime: {
          type: String,
          required: true,
          match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)"],
        },
        duration: {
          type: Number,
          required: true,
          min: [15, "Duration must be at least 15 minutes"],
          max: [120, "Duration cannot exceed 120 minutes (2 hours)"], // UPDATED: Was 240
        },
        requirements: {
          type: [String],
          required: true,
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
        priority: {
          type: Number,
          min: 1,
          max: 5,
          default: 3,
        },
        notes: {
          type: String,
          maxlength: [300, "Notes cannot exceed 300 characters"],
        },
      },
    ],
    preferredCareGiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CareGiver",
    },
    medicalInfo: {
      conditions: [String],
      allergies: [String],
      medications: [
        {
          name: String,
          dosage: String,
          frequency: String,
        },
      ],
      mobilityAids: [String],
      dietaryRequirements: [String],
    },
    emergencyContact: {
      name: {
        type: String,
        required: [true, "Emergency contact name is required"],
      },
      relationship: {
        type: String,
        required: [true, "Emergency contact relationship is required"],
        enum: [
          "Spouse/Partner",
          "Child",
          "Parent",
          "Sibling",
          "Friend",
          "Neighbor",
          "Other Family",
          "Other",
        ],
      },
      phone: {
        type: String,
        required: [true, "Emergency contact phone is required"],
        match: [
          /^(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}$/,
          "Please provide a valid UK phone number",
        ],
      },
      email: {
        type: String,
        match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
careReceiverSchema.index({ coordinates: "2dsphere" }); // Geospatial index
careReceiverSchema.index({ isActive: 1 });
careReceiverSchema.index({ preferredCareGiver: 1 });
careReceiverSchema.index({ "dailyVisits.doubleHanded": 1 });

// Pre-save middleware to generate full address
careReceiverSchema.pre("save", function (next) {
  if (
    this.address &&
    this.address.street &&
    this.address.city &&
    this.address.postcode
  ) {
    this.address.full = `${this.address.street}, ${this.address.city} ${this.address.postcode}, United Kingdom`;
  }

  // Sort daily visits by visit number
  if (this.dailyVisits && this.dailyVisits.length > 0) {
    this.dailyVisits.sort((a, b) => a.visitNumber - b.visitNumber);
  }

  next();
});

// Validation: Ensure daily visits are sequential (1, 2, 3, 4)
careReceiverSchema.pre("save", function (next) {
  if (this.dailyVisits && this.dailyVisits.length > 0) {
    const visitNumbers = this.dailyVisits.map((v) => v.visitNumber);
    const uniqueNumbers = [...new Set(visitNumbers)];

    if (uniqueNumbers.length !== visitNumbers.length) {
      return next(new Error("Duplicate visit numbers found"));
    }

    for (let i = 0; i < uniqueNumbers.length; i++) {
      if (uniqueNumbers[i] !== i + 1) {
        return next(
          new Error("Visit numbers must be sequential starting from 1")
        );
      }
    }
  }
  next();
});

// Virtual for age calculation
careReceiverSchema.virtual("age").get(function () {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
});

// Virtual for total daily care time
careReceiverSchema.virtual("totalDailyCareTime").get(function () {
  if (!this.dailyVisits || this.dailyVisits.length === 0) return 0;
  return this.dailyVisits.reduce((total, visit) => total + visit.duration, 0);
});

// Method to get visit by number
careReceiverSchema.methods.getVisit = function (visitNumber) {
  return this.dailyVisits.find((v) => v.visitNumber === visitNumber);
};

// Ensure virtuals are included in JSON
careReceiverSchema.set("toJSON", { virtuals: true });
careReceiverSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("CareReceiver", careReceiverSchema);
