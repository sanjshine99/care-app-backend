const ServiceNotRequiredPeriod = require("../models/ServiceNotRequiredPeriod");
const Appointment = require("../models/Appointment");
const { toStartOfDayUTC, toUTCDateValue } = require("../utils/dateUtils");

const SNR_CANCEL_STATUSES = ["scheduled", "in_progress", "needs_reassignment", "needs_review"];

class SNRError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "SNRError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function dateCoveredByAnyPeriod(periodsLean, utcDay) {
  const d = toUTCDateValue(utcDay);
  return periodsLean.some(
    (p) => toUTCDateValue(p.startDate) <= d && toUTCDateValue(p.endDate) >= d,
  );
}

function groupPeriodsByCareReceiver(periodsLean) {
  const map = new Map();
  for (const p of periodsLean) {
    const key = p.careReceiver.toString();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return map;
}

function buildCancellationReasonText({ reasonType, comment }) {
  const tail = comment && String(comment).trim() ? String(comment).trim() : "n/a";
  return `Service not required (${reasonType}): ${tail}`;
}

async function listByCareReceiver(careReceiverId, { startDate, endDate } = {}) {
  const query = { careReceiver: careReceiverId };
  if (startDate && endDate) {
    const rangeStart = toStartOfDayUTC(startDate);
    const rangeEnd = toStartOfDayUTC(endDate);
    query.startDate = { $lte: rangeEnd };
    query.endDate = { $gte: rangeStart };
  }
  return ServiceNotRequiredPeriod.find(query).sort({ startDate: -1 }).lean();
}

async function assertNoOverlap(careReceiverId, startDate, endDate, excludeId = null) {
  const start = toStartOfDayUTC(startDate);
  const end = toStartOfDayUTC(endDate);
  const q = {
    careReceiver: careReceiverId,
    startDate: { $lte: end },
    endDate: { $gte: start },
  };
  if (excludeId) {
    q._id = { $ne: excludeId };
  }
  const hit = await ServiceNotRequiredPeriod.findOne(q).select("_id").lean();
  if (hit) {
    throw new SNRError("SNR_OVERLAP", "This date range overlaps an existing service-not-required period", 409);
  }
}

async function findCoveringPeriod(careReceiverId, utcDay) {
  const day = toStartOfDayUTC(utcDay);
  return ServiceNotRequiredPeriod.findOne({
    careReceiver: careReceiverId,
    startDate: { $lte: day },
    endDate: { $gte: day },
  }).lean();
}

async function loadOverlappingPeriodsForCareReceiver(careReceiverId, rangeStart, rangeEnd) {
  const start = toStartOfDayUTC(rangeStart);
  const end = toStartOfDayUTC(rangeEnd);
  return ServiceNotRequiredPeriod.find({
    careReceiver: careReceiverId,
    startDate: { $lte: end },
    endDate: { $gte: start },
  })
    .select("careReceiver startDate endDate reasonType comment")
    .lean();
}

async function loadOverlappingPeriodsForReceivers(careReceiverIds, rangeStart, rangeEnd) {
  if (!careReceiverIds.length) return [];
  const start = toStartOfDayUTC(rangeStart);
  const end = toStartOfDayUTC(rangeEnd);
  return ServiceNotRequiredPeriod.find({
    careReceiver: { $in: careReceiverIds },
    startDate: { $lte: end },
    endDate: { $gte: start },
  })
    .select("careReceiver startDate endDate reasonType comment")
    .lean();
}

async function hasInProgressAppointmentInRange(careReceiverId, startDate, endDate) {
  const start = toStartOfDayUTC(startDate);
  const end = toStartOfDayUTC(endDate);
  const hit = await Appointment.findOne({
    careReceiver: careReceiverId,
    date: { $gte: start, $lte: end },
    status: "in_progress",
  })
    .select("_id")
    .lean();
  return !!hit;
}

async function cancelAppointmentsInRange(careReceiverId, startDate, endDate, cancellationReason) {
  const start = toStartOfDayUTC(startDate);
  const end = toStartOfDayUTC(endDate);
  const docs = await Appointment.find({
    careReceiver: careReceiverId,
    date: { $gte: start, $lte: end },
    status: { $in: SNR_CANCEL_STATUSES },
  })
    .populate("careGiver", "name")
    .select("_id date visitNumber careGiver")
    .lean();

  if (docs.length === 0) {
    return { cancelledCount: 0, cancelledAppointments: [] };
  }

  const ops = docs.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: {
        $set: {
          status: "cancelled",
          cancellationReason,
        },
      },
    },
  }));

  await Appointment.bulkWrite(ops, { ordered: false });

  const cancelledAppointments = docs.map((d) => ({
    _id: d._id,
    date: d.date,
    visitNumber: d.visitNumber,
    careGiverName: d.careGiver?.name || null,
  }));

  return { cancelledCount: docs.length, cancelledAppointments };
}

module.exports = {
  SNRError,
  SNR_CANCEL_STATUSES,
  dateCoveredByAnyPeriod,
  groupPeriodsByCareReceiver,
  buildCancellationReasonText,
  listByCareReceiver,
  assertNoOverlap,
  findCoveringPeriod,
  loadOverlappingPeriodsForCareReceiver,
  loadOverlappingPeriodsForReceivers,
  hasInProgressAppointmentInRange,
  cancelAppointmentsInRange,
};
