const CareGiver = require("../../models/CareGiver");
const settingsService = require("../settingsService");

async function getEligibleCaregivers(visit, careReceiver, excludeCareGiverId = null) {
  const settings = await settingsService.getSchedulingSettings();
  const maxDistanceKm = settings?.maxDistanceKm ?? 20;
  const maxDistanceMeters = maxDistanceKm * 1000;

  const query = {
    isActive: true,
    skills: { $all: visit.requirements || [] },
  };

  if (excludeCareGiverId) {
    query._id = { $ne: excludeCareGiverId };
  }

  if (careReceiver.genderPreference && careReceiver.genderPreference !== "No Preference") {
    query.gender = careReceiver.genderPreference;
  }

  if (visit.doubleHanded) {
    query.singleHandedOnly = false;
  }

  if (
    !careReceiver.coordinates ||
    !careReceiver.coordinates.coordinates ||
    careReceiver.coordinates.coordinates.length < 2
  ) {
    return { caregivers: [], reason: "Care receiver has no valid location coordinates" };
  }

  query.coordinates = {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: careReceiver.coordinates.coordinates,
      },
      $maxDistance: maxDistanceMeters,
    },
  };

  const caregivers = await CareGiver.find(query).limit(50).lean();
  return { caregivers, reason: null };
}

function getMaxAppointmentsPerDay(careGiver, settings) {
  const perDay = careGiver && careGiver.maxAppointmentsPerDay;
  if (perDay != null && perDay >= 1 && perDay <= 20) {
    return perDay;
  }
  return (settings && settings.maxAppointmentsPerDay) || 8;
}

module.exports = {
  getEligibleCaregivers,
  getMaxAppointmentsPerDay,
};
