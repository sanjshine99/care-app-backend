const ServiceNotRequiredPeriod = require("../models/ServiceNotRequiredPeriod");
const CareReceiver = require("../models/CareReceiver");
const serviceNotRequiredPeriodService = require("../services/serviceNotRequiredPeriodService");
const { SNRError } = serviceNotRequiredPeriodService;
const notificationService = require("../services/notificationService");
const { parseStartOfDayUTC } = require("../utils/dateUtils");
const logger = require("../utils/logger");

function handleSNRError(res, err) {
  if (err instanceof SNRError || err.code === "SNR_OVERLAP") {
    return res.status(err.statusCode || 400).json({
      success: false,
      error: {
        message: err.message,
        code: err.code || "SNR_ERROR",
      },
    });
  }
  return null;
}

exports.listServiceNotRequiredPeriods = async (req, res, next) => {
  try {
    const careReceiver = await CareReceiver.findById(req.params.id).select("_id name");
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: { message: "Care receiver not found", code: "CARE_RECEIVER_NOT_FOUND" },
      });
    }
    const periods = await serviceNotRequiredPeriodService.listByCareReceiver(req.params.id, {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json({ success: true, data: { periods } });
  } catch (error) {
    next(error);
  }
};

exports.createServiceNotRequiredPeriod = async (req, res, next) => {
  try {
    const { startDate, endDate, reasonType, comment } = req.body;
    if (!startDate || !endDate || !reasonType) {
      return res.status(400).json({
        success: false,
        error: { message: "startDate, endDate, and reasonType are required", code: "MISSING_FIELDS" },
      });
    }

    const careReceiver = await CareReceiver.findById(req.params.id).select("_id name");
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: { message: "Care receiver not found", code: "CARE_RECEIVER_NOT_FOUND" },
      });
    }

    if (!ServiceNotRequiredPeriod.REASON_TYPES.includes(reasonType)) {
      return res.status(400).json({
        success: false,
        error: { message: "Invalid reasonType", code: "INVALID_REASON_TYPE" },
      });
    }

    const start = parseStartOfDayUTC(startDate);
    const end = parseStartOfDayUTC(endDate);

    await serviceNotRequiredPeriodService.assertNoOverlap(req.params.id, start, end);

    const inProg = await serviceNotRequiredPeriodService.hasInProgressAppointmentInRange(
      req.params.id,
      start,
      end,
    );
    if (inProg) {
      return res.status(409).json({
        success: false,
        error: {
          message:
            "Cannot add service-not-required period while an appointment is in progress in this date range.",
          code: "IN_PROGRESS_APPOINTMENT",
        },
      });
    }

    let period;
    try {
      period = await ServiceNotRequiredPeriod.create({
        careReceiver: req.params.id,
        startDate: start,
        endDate: end,
        reasonType,
        comment: (comment || "").trim(),
        createdBy: req.user?._id,
      });
    } catch (e) {
      if (e.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          error: { message: e.message, code: "VALIDATION_ERROR" },
        });
      }
      throw e;
    }

    const cancellationReason = serviceNotRequiredPeriodService.buildCancellationReasonText(period);
    const { cancelledCount, cancelledAppointments } =
      await serviceNotRequiredPeriodService.cancelAppointmentsInRange(
        req.params.id,
        start,
        end,
        cancellationReason,
      );

    try {
      if (cancelledCount > 0) {
        await notificationService.notifyServiceNotRequiredCancellations(req.user._id, {
          careReceiverName: careReceiver.name,
          cancelledCount,
          startDate: startDate,
          endDate: endDate,
          reasonType,
        });
      }
    } catch (notifErr) {
      logger.warn("SNR cancellation notification failed", { error: notifErr.message });
    }

    res.status(201).json({
      success: true,
      data: {
        period,
        cancelledCount,
        cancelledAppointments,
      },
    });
  } catch (error) {
    const handled = handleSNRError(res, error);
    if (handled) return;
    next(error);
  }
};

exports.updateServiceNotRequiredPeriod = async (req, res, next) => {
  try {
    const { startDate, endDate, reasonType, comment } = req.body;
    const period = await ServiceNotRequiredPeriod.findOne({
      _id: req.params.periodId,
      careReceiver: req.params.id,
    });
    if (!period) {
      return res.status(404).json({
        success: false,
        error: { message: "Period not found", code: "SNR_PERIOD_NOT_FOUND" },
      });
    }

    const careReceiver = await CareReceiver.findById(req.params.id).select("_id name");
    if (!careReceiver) {
      return res.status(404).json({
        success: false,
        error: { message: "Care receiver not found", code: "CARE_RECEIVER_NOT_FOUND" },
      });
    }

    const nextStart = startDate != null ? parseStartOfDayUTC(startDate) : period.startDate;
    const nextEnd = endDate != null ? parseStartOfDayUTC(endDate) : period.endDate;
    const nextReason = reasonType != null ? reasonType : period.reasonType;
    const nextComment = comment !== undefined ? String(comment).trim() : period.comment;

    if (reasonType != null && !ServiceNotRequiredPeriod.REASON_TYPES.includes(nextReason)) {
      return res.status(400).json({
        success: false,
        error: { message: "Invalid reasonType", code: "INVALID_REASON_TYPE" },
      });
    }

    if (nextReason === "other" && !nextComment) {
      return res.status(400).json({
        success: false,
        error: { message: "Comment is required when reason type is other", code: "COMMENT_REQUIRED" },
      });
    }

    await serviceNotRequiredPeriodService.assertNoOverlap(req.params.id, nextStart, nextEnd, period._id);

    const inProg = await serviceNotRequiredPeriodService.hasInProgressAppointmentInRange(
      req.params.id,
      nextStart,
      nextEnd,
    );
    if (inProg) {
      return res.status(409).json({
        success: false,
        error: {
          message:
            "Cannot extend into dates where an appointment is in progress.",
          code: "IN_PROGRESS_APPOINTMENT",
        },
      });
    }

    period.startDate = nextStart;
    period.endDate = nextEnd;
    period.reasonType = nextReason;
    period.comment = nextComment;
    period.updatedBy = req.user?._id;
    try {
      await period.save();
    } catch (e) {
      if (e.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          error: { message: e.message, code: "VALIDATION_ERROR" },
        });
      }
      throw e;
    }

    const cancellationReason = serviceNotRequiredPeriodService.buildCancellationReasonText(period);
    const { cancelledCount, cancelledAppointments } =
      await serviceNotRequiredPeriodService.cancelAppointmentsInRange(
        req.params.id,
        nextStart,
        nextEnd,
        cancellationReason,
      );

    try {
      if (cancelledCount > 0) {
        await notificationService.notifyServiceNotRequiredCancellations(req.user._id, {
          careReceiverName: careReceiver.name,
          cancelledCount,
          startDate: period.startDate,
          endDate: period.endDate,
          reasonType: period.reasonType,
        });
      }
    } catch (notifErr) {
      logger.warn("SNR cancellation notification failed", { error: notifErr.message });
    }

    res.json({
      success: true,
      data: {
        period,
        cancelledCount,
        cancelledAppointments,
      },
    });
  } catch (error) {
    const handled = handleSNRError(res, error);
    if (handled) return;
    next(error);
  }
};

exports.deleteServiceNotRequiredPeriod = async (req, res, next) => {
  try {
    const period = await ServiceNotRequiredPeriod.findOneAndDelete({
      _id: req.params.periodId,
      careReceiver: req.params.id,
    });
    if (!period) {
      return res.status(404).json({
        success: false,
        error: { message: "Period not found", code: "SNR_PERIOD_NOT_FOUND" },
      });
    }
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    next(error);
  }
};
