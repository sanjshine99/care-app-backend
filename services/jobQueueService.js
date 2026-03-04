const SchedulingJob = require("../models/SchedulingJob");
const logger = require("../utils/logger");

async function enqueue(userId, type, payload = {}) {
  const job = await SchedulingJob.create({
    userId,
    type,
    status: "queued",
    payload,
  });
  return job;
}

async function getById(jobId) {
  return SchedulingJob.findById(jobId).lean();
}

async function getActiveByUserId(userId) {
  return SchedulingJob.find({
    userId,
    status: { $in: ["queued", "running"] },
  })
    .select("_id type status payload startedAt createdAt")
    .sort({ createdAt: -1 })
    .lean();
}

async function claimNext() {
  const job = await SchedulingJob.findOneAndUpdate(
    { status: "queued" },
    { status: "running", startedAt: new Date() },
    { new: true },
  );
  return job;
}

async function updateProgress(jobId, updates) {
  const allowed = [
    "progressPercent",
    "totalSteps",
    "completedSteps",
    "resultSummary",
  ];
  const payload = {};
  allowed.forEach((key) => {
    if (updates[key] !== undefined) payload[key] = updates[key];
  });
  if (Object.keys(payload).length === 0) return null;
  return SchedulingJob.findByIdAndUpdate(jobId, payload, { new: true });
}

async function complete(jobId, resultSummary = {}) {
  return SchedulingJob.findByIdAndUpdate(
    jobId,
    {
      status: "completed",
      progressPercent: 100,
      resultSummary,
      finishedAt: new Date(),
    },
    { new: true },
  );
}

async function fail(jobId, errorMessage) {
  return SchedulingJob.findByIdAndUpdate(
    jobId,
    {
      status: "failed",
      errorMessage: errorMessage || "Job failed",
      finishedAt: new Date(),
    },
    { new: true },
  );
}

module.exports = {
  enqueue,
  getById,
  getActiveByUserId,
  claimNext,
  updateProgress,
  complete,
  fail,
};
