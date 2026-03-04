function sortCandidatesByPriority(candidates, visitPriority) {
  return [...candidates].sort((a, b) => {
    const priorityA = a.visitPriority ?? 3;
    const priorityB = b.visitPriority ?? 3;
    if (priorityA !== priorityB) return priorityA - priorityB;
    const distA = a.distance ?? a.score ?? 999;
    const distB = b.distance ?? b.score ?? 999;
    return distA - distB;
  });
}

async function findBumpableAppointment(appointmentService, careGiverId, date, newPriority) {
  const appointments = await appointmentService.findCareGiverAppointmentsOnDate(
    careGiverId,
    date,
  );
  for (const apt of appointments) {
    const aptPriority = apt.priority ?? 3;
    if (newPriority < aptPriority) {
      return apt;
    }
  }
  return null;
}

module.exports = {
  sortCandidatesByPriority,
  findBumpableAppointment,
};
