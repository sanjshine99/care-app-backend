const mongoose = require("mongoose");

const schedulingJobSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["schedule_bulk", "schedule_care_receiver", "reschedule_on_cancel"],
    },
    status: {
      type: String,
      required: true,
      enum: ["queued", "running", "completed", "failed"],
      default: "queued",
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    progressPercent: { type: Number, default: 0 },
    totalSteps: { type: Number },
    completedSteps: { type: Number },
    resultSummary: { type: mongoose.Schema.Types.Mixed },
    errorMessage: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

schedulingJobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("SchedulingJob", schedulingJobSchema);
