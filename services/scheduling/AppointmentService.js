const Appointment = require("../../models/Appointment");
const { toStartOfDayUTC, toEndOfDayUTC } = require("../../utils/dateUtils");
const { ACTIVE_APPOINTMENT_STATUSES } = require("../../utils/constants");

async function findByCareReceiverAndDateRange(careReceiverId, startDate, endDate, options = {}) {
  const query = {
    careReceiver: careReceiverId,
    date: { $gte: startDate, $lte: endDate },
  };
  if (options.status) {
    query.status = Array.isArray(options.status) ? { $in: options.status } : options.status;
  }
  return Appointment.find(query)
    .sort({ date: 1, startTime: 1 })
    .lean();
}

async function findExistingSlot(careReceiverId, date, visitNumber) {
  const startOfDay = toStartOfDayUTC(date);
  const endOfDay = toEndOfDayUTC(date);

  return Appointment.findOne({
    careReceiver: careReceiverId,
    date: { $gte: startOfDay, $lte: endOfDay },
    visitNumber,
    status: { $in: ACTIVE_APPOINTMENT_STATUSES },
  });
}

async function create(data) {
  const appointment = await Appointment.create(data);
  return appointment;
}

async function createSafe(data) {
  try {
    return await Appointment.create(data);
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate — already scheduled by a concurrent process
      const existing = await Appointment.findOne({
        careReceiver: data.careReceiver,
        date: data.date,
        visitNumber: data.visitNumber,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      });
      return existing;
    }
    throw err;
  }
}

async function markNeedsReassignment(appointmentId, reason) {
  return Appointment.findByIdAndUpdate(
    appointmentId,
    {
      status: "needs_reassignment",
      invalidationReason: reason,
      invalidatedAt: new Date(),
    },
    { new: true },
  );
}

async function findCareGiverAppointmentsOnDate(careGiverId, date, excludeAppointmentId = null) {
  const startOfDay = toStartOfDayUTC(date);
  const endOfDay = toEndOfDayUTC(date);

  const query = {
    $or: [{ careGiver: careGiverId }, { secondaryCareGiver: careGiverId }],
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ["scheduled", "in_progress"] },
  };
  if (excludeAppointmentId) {
    query._id = { $ne: excludeAppointmentId };
  }

  return Appointment.find(query)
    .populate("careReceiver", "name coordinates")
    .sort({ startTime: 1 });
}

module.exports = {
  findByCareReceiverAndDateRange,
  findExistingSlot,
  create,
  createSafe,
  markNeedsReassignment,
  findCareGiverAppointmentsOnDate,
};
