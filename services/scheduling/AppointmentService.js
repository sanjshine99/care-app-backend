const Appointment = require("../../models/Appointment");

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
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  return Appointment.findOne({
    careReceiver: careReceiverId,
    date: { $gte: startOfDay, $lte: endOfDay },
    visitNumber,
    status: { $in: ["scheduled", "in_progress", "completed"] },
  });
}

async function create(data) {
  const appointment = await Appointment.create(data);
  return appointment;
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
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

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
  markNeedsReassignment,
  findCareGiverAppointmentsOnDate,
};
