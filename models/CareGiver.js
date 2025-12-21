const mongoose = require('mongoose');

const careGiverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      match: [
        /^(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}$/,
        'Please provide a valid UK phone number',
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
          'Please provide a valid UK postcode',
        ],
      },
      full: String, // Auto-generated full address
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    gender: {
      type: String,
      required: [true, 'Gender is required'],
      enum: ['Male', 'Female', 'Non-binary', 'Prefer not to say'],
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required'],
    },
    skills: {
      type: [String],
      required: [true, 'At least one skill is required'],
      enum: [
        'personal_care',
        'medication_management',
        'dementia_care',
        'mobility_assistance',
        'meal_preparation',
        'companionship',
        'household_tasks',
        'specialized_medical',
      ],
      validate: {
        validator: function (v) {
          return v && v.length > 0;
        },
        message: 'At least one skill must be selected',
      },
    },
    canDrive: {
      type: Boolean,
      default: false,
    },
    maxCareReceivers: {
      type: Number,
      default: 10,
      min: [1, 'Must handle at least 1 care receiver'],
      max: [20, 'Cannot exceed 20 care receivers'],
    },
    availability: [
      {
        dayOfWeek: {
          type: String,
          enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          required: true,
        },
        slots: [
          {
            startTime: {
              type: String,
              required: true,
              match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'],
            },
            endTime: {
              type: String,
              required: true,
              match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'],
            },
          },
        ],
      },
    ],
    timeOff: [
      {
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        reason: String,
      },
    ],
    singleHandedOnly: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
careGiverSchema.index({ email: 1 });
careGiverSchema.index({ coordinates: '2dsphere' }); // Geospatial index for location queries
careGiverSchema.index({ skills: 1 });
careGiverSchema.index({ isActive: 1 });
careGiverSchema.index({ canDrive: 1 });

// Pre-save middleware to generate full address
careGiverSchema.pre('save', function (next) {
  if (this.address && this.address.street && this.address.city && this.address.postcode) {
    this.address.full = `${this.address.street}, ${this.address.city} ${this.address.postcode}, United Kingdom`;
  }
  next();
});

// Virtual for age calculation
careGiverSchema.virtual('age').get(function () {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
});

// Method to check if available on a specific day/time
careGiverSchema.methods.isAvailableAt = function (dayOfWeek, time) {
  const dayAvailability = this.availability.find((a) => a.dayOfWeek === dayOfWeek);
  if (!dayAvailability) return false;

  return dayAvailability.slots.some((slot) => {
    return time >= slot.startTime && time <= slot.endTime;
  });
};

// Method to check if on time off
careGiverSchema.methods.isOnTimeOff = function (date) {
  return this.timeOff.some((timeOff) => {
    return date >= timeOff.startDate && date <= timeOff.endDate;
  });
};

// Ensure virtuals are included in JSON
careGiverSchema.set('toJSON', { virtuals: true });
careGiverSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('CareGiver', careGiverSchema);
