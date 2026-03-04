const jobQueueService = require("../services/jobQueueService");
const { scheduleForCareReceiver } = require("../services/schedulingService");
const notificationService = require("../services/notificationService");
const socketService = require("../services/socketService");
const CareReceiver = require("../models/CareReceiver");
const logger = require("../utils/logger");

const POLL_INTERVAL_MS = 3000;
const DEFAULT_SCHEDULE_WEEKS = 8;

function getDefaultDateRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + DEFAULT_SCHEDULE_WEEKS * 7);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

async function resolveCareReceiverIds(payload) {
  const { careReceiverIds, careReceiverId } = payload || {};
  if (careReceiverIds && Array.isArray(careReceiverIds) && careReceiverIds.length > 0) {
    return careReceiverIds;
  }
  if (careReceiverId) {
    return [careReceiverId];
  }
  const careReceivers = await CareReceiver.find({
    "dailyVisits.0": { $exists: true },
  })
    .select("_id")
    .lean();
  return careReceivers.map((cr) => cr._id);
}

async function processScheduleCareReceiver(job) {
  const { _id: jobId, userId, payload } = job;
  const careReceiverId = payload?.careReceiverId;
  const careReceiverName = payload?.careReceiverName || "Care receiver";

  if (!careReceiverId) {
    await jobQueueService.fail(jobId, "Missing careReceiverId in payload");
    await notificationService.notifyScheduleGenerationFailed(
      userId,
      careReceiverId,
      careReceiverName,
      "Missing care receiver ID"
    );
    return;
  }

  const { start, end } = getDefaultDateRange();

  try {
    const result = await scheduleForCareReceiver(careReceiverId, start, end);
    const scheduledCount = (result.scheduled || []).length;
    const failedCount = (result.failed || []).length;

    await jobQueueService.complete(jobId, {
      careReceiverId,
      scheduled: scheduledCount,
      failed: failedCount,
    });

    await notificationService.notifyScheduleGeneratedForCareReceiver(
      userId,
      careReceiverId,
      careReceiverName,
      scheduledCount,
      failedCount
    );

    socketService.emitToUser(userId.toString(), "schedule_job_completed", {
      jobId,
      type: "schedule_care_receiver",
      resultSummary: { scheduled: scheduledCount, failed: failedCount },
      startDate: start.toISOString?.() ? start.toISOString().split("T")[0] : undefined,
      endDate: end.toISOString?.() ? end.toISOString().split("T")[0] : undefined,
    });

    logger.info("Schedule job completed (schedule_care_receiver)", {
      jobId,
      careReceiverId,
      scheduled: scheduledCount,
      failed: failedCount,
    });
  } catch (err) {
    const errorMessage = err?.message || String(err);
    await jobQueueService.fail(jobId, errorMessage);
    await notificationService.notifyScheduleGenerationFailed(
      userId,
      careReceiverId,
      careReceiverName,
      errorMessage
    );
    logger.error("Schedule job failed (schedule_care_receiver)", {
      jobId,
      careReceiverId,
      error: errorMessage,
    });
  }
}

async function processScheduleBulk(job) {
  const { _id: jobId, userId, payload } = job;
  const startDate = payload?.startDate ? new Date(payload.startDate) : getDefaultDateRange().start;
  const endDate = payload?.endDate ? new Date(payload.endDate) : getDefaultDateRange().end;

  let careReceiverIds;
  try {
    careReceiverIds = await resolveCareReceiverIds(payload);
  } catch (err) {
    const errorMessage = err?.message || "Failed to resolve care receiver list";
    await jobQueueService.fail(jobId, errorMessage);
    await notificationService.notifyScheduleGenerated(userId, {
      totalScheduled: 0,
      totalFailed: 0,
      careReceiversProcessed: 0,
    });
    logger.error("Schedule job failed (schedule_bulk): resolve ids", { jobId, error: errorMessage });
    return;
  }

  if (!careReceiverIds || careReceiverIds.length === 0) {
    await jobQueueService.complete(jobId, {
      totalScheduled: 0,
      totalFailed: 0,
      careReceiversProcessed: 0,
    });
    logger.info("Schedule job completed (schedule_bulk): no care receivers", { jobId });
    return;
  }

  const totalSteps = careReceiverIds.length;
  const startDateStr = startDate.toISOString?.() ? startDate.toISOString().split("T")[0] : undefined;
  const endDateStr = endDate.toISOString?.() ? endDate.toISOString().split("T")[0] : undefined;

  try {
    const results = [];
    let totalScheduled = 0;
    let totalFailed = 0;
    let completedSteps = 0;

    for (const careReceiverId of careReceiverIds) {
      let result;
      try {
        result = await scheduleForCareReceiver(careReceiverId, startDate, endDate);
      } catch (err) {
        result = {
          scheduled: [],
          failed: [],
          error: err?.message || String(err),
        };
      }
      const scheduledCount = (result.scheduled || []).length;
      const failedCount = (result.failed || []).length;
      results.push({ careReceiverId, ...result });
      totalScheduled += scheduledCount;
      totalFailed += failedCount;
      completedSteps += 1;

      const resultSummary = {
        totalScheduled,
        totalFailed,
        careReceiversProcessed: completedSteps,
        results,
      };
      const progressPercent = Math.round((completedSteps / totalSteps) * 100);
      await jobQueueService.updateProgress(jobId, {
        completedSteps,
        totalSteps,
        progressPercent,
        resultSummary,
      });
      socketService.emitToUser(userId.toString(), "schedule_progress", {
        jobId,
        type: "schedule_bulk",
        careReceiverId,
        scheduled: scheduledCount,
        failed: failedCount,
        resultSummary,
        startDate: startDateStr,
        endDate: endDateStr,
      });
    }

    const resultSummary = {
      totalScheduled,
      totalFailed,
      careReceiversProcessed: results.length,
      results,
    };
    await jobQueueService.complete(jobId, resultSummary);
    await notificationService.notifyScheduleGenerated(userId, {
      totalScheduled,
      totalFailed,
      careReceiversProcessed: results.length,
    });

    socketService.emitToUser(userId.toString(), "schedule_job_completed", {
      jobId,
      type: "schedule_bulk",
      resultSummary: { totalScheduled, totalFailed, careReceiversProcessed: results.length },
      startDate: startDateStr,
      endDate: endDateStr,
    });

    logger.info("Schedule job completed (schedule_bulk)", {
      jobId,
      totalScheduled,
      totalFailed,
      careReceiversProcessed: results.length,
    });
  } catch (err) {
    const errorMessage = err?.message || String(err);
    await jobQueueService.fail(jobId, errorMessage);
    await notificationService.notifyScheduleGenerated(userId, {
      totalScheduled: 0,
      totalFailed: 1,
      careReceiversProcessed: 0,
    });
    logger.error("Schedule job failed (schedule_bulk)", { jobId, error: errorMessage });
  }
}

async function processNextJob() {
  let job;
  try {
    job = await jobQueueService.claimNext();
  } catch (err) {
    logger.error("claimNext failed", { error: err?.message });
    return;
  }

  if (!job) return;

  const { type } = job;
  if (type === "schedule_care_receiver") {
    await processScheduleCareReceiver(job);
  } else if (type === "schedule_bulk") {
    await processScheduleBulk(job);
  } else {
    await jobQueueService.fail(job._id, `Unknown job type: ${type}`);
    logger.warn("Unknown job type", { jobId: job._id, type });
  }
}

let pollTimer = null;

function start() {
  if (pollTimer) return;
  logger.info("Schedule job worker started", { pollIntervalMs: POLL_INTERVAL_MS });

  const run = () => {
    processNextJob().finally(() => {
      pollTimer = setTimeout(run, POLL_INTERVAL_MS);
    });
  };
  pollTimer = setTimeout(run, POLL_INTERVAL_MS);
}

function stop() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
    logger.info("Schedule job worker stopped");
  }
}

module.exports = { start, stop };
