const mongoose = require("mongoose");
const { toStartOfDayUTC } = require("../utils/dateUtils");

const REASON_TYPES = ["hospitalised", "unwell", "other"];

const serviceNotRequiredPeriodSchema = new mongoose.Schema(
  {
    careReceiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CareReceiver",
      required: true,
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    reasonType: {
      type: String,
      enum: REASON_TYPES,
      required: true,
    },
    comment: {
      type: String,
      maxlength: 280,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
    },
  },
  { timestamps: true },
);

serviceNotRequiredPeriodSchema.index({ careReceiver: 1, startDate: 1 });
serviceNotRequiredPeriodSchema.index({ careReceiver: 1, endDate: 1 });

serviceNotRequiredPeriodSchema.pre("validate", function normalizeBounds(next) {
  if (this.startDate) {
    this.startDate = toStartOfDayUTC(this.startDate);
  }
  if (this.endDate) {
    this.endDate = toStartOfDayUTC(this.endDate);
  }
  next();
});

serviceNotRequiredPeriodSchema.pre("validate", function validateComment(next) {
  if (this.reasonType === "other" && (!this.comment || !String(this.comment).trim())) {
    this.invalidate("comment", "Comment is required when reason type is other");
  }
  next();
});

serviceNotRequiredPeriodSchema.pre("validate", function validateRangeOrder(next) {
  if (this.startDate && this.endDate && this.endDate < this.startDate) {
    this.invalidate("endDate", "End date must be on or after start date");
  }
  next();
});

const ServiceNotRequiredPeriod = mongoose.model(
  "ServiceNotRequiredPeriod",
  serviceNotRequiredPeriodSchema,
);
ServiceNotRequiredPeriod.REASON_TYPES = REASON_TYPES;
module.exports = ServiceNotRequiredPeriod;
