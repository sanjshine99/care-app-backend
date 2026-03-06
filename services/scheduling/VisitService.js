const CareReceiver = require("../../models/CareReceiver");
const { normalizeTimeToHHMM } = require("../../utils/timeUtils");

function isDateInSchedule(checkDate, visit, careReceiverCreatedAt, careReceiverUpdatedAt) {
  const utcDay = checkDate.getUTCDay();
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dayOfWeek = dayNames[utcDay];

  const daysOfWeek = visit.daysOfWeek && visit.daysOfWeek.length > 0
    ? visit.daysOfWeek
    : dayNames;

  if (!daysOfWeek.includes(dayOfWeek)) {
    return false;
  }

  const checkUTC = Date.UTC(
    checkDate.getUTCFullYear(),
    checkDate.getUTCMonth(),
    checkDate.getUTCDate(),
  );

  const createdUTC = careReceiverCreatedAt
    ? Date.UTC(
        new Date(careReceiverCreatedAt).getUTCFullYear(),
        new Date(careReceiverCreatedAt).getUTCMonth(),
        new Date(careReceiverCreatedAt).getUTCDate(),
      )
    : 0;
  const updatedUTC = careReceiverUpdatedAt
    ? Date.UTC(
        new Date(careReceiverUpdatedAt).getUTCFullYear(),
        new Date(careReceiverUpdatedAt).getUTCMonth(),
        new Date(careReceiverUpdatedAt).getUTCDate(),
      )
    : 0;
  const receiverEffectiveStartUTC = Math.max(createdUTC, updatedUTC);

  const visitStart = visit.startDate || visit.recurrenceStartDate;
  const effectiveStart = visitStart
    ? new Date(visitStart)
    : receiverEffectiveStartUTC
      ? new Date(receiverEffectiveStartUTC)
      : new Date();
  const startUTC = Date.UTC(
    effectiveStart.getUTCFullYear(),
    effectiveStart.getUTCMonth(),
    effectiveStart.getUTCDate(),
  );
  if (checkUTC < startUTC) {
    return false;
  }

  if (visit.recurrenceEndDate) {
    const endDate = new Date(visit.recurrenceEndDate);
    const endUTC = Date.UTC(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth(),
      endDate.getUTCDate(),
    );
    if (checkUTC > endUTC) {
      return false;
    }
  }

  const recurrencePattern = visit.recurrencePattern || "weekly";
  const recurrenceInterval = visit.recurrenceInterval || 1;

  if (recurrencePattern === "weekly" && recurrenceInterval === 1) {
    return true;
  }

  if (
    recurrencePattern === "biweekly" ||
    recurrencePattern === "monthly" ||
    recurrencePattern === "custom"
  ) {
    const startDate = visit.recurrenceStartDate || visit.startDate
      ? new Date(visit.recurrenceStartDate || visit.startDate)
      : receiverEffectiveStartUTC
        ? new Date(receiverEffectiveStartUTC)
        : new Date();
    const startUTCVal = Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate(),
    );
    const daysDiff = Math.floor((checkUTC - startUTCVal) / (24 * 60 * 60 * 1000));
    if (daysDiff < 0) return false;

    if (recurrencePattern === "biweekly") {
      const weeksDiff = Math.floor(daysDiff / 7);
      return weeksDiff % (recurrenceInterval || 1) === 0;
    }
    if (recurrencePattern === "monthly") {
      const monthsDiff =
        (checkDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
        (checkDate.getUTCMonth() - startDate.getUTCMonth());
      const dayOfMonthMatch = checkDate.getUTCDate() === startDate.getUTCDate();
      return dayOfMonthMatch && monthsDiff >= 0 && monthsDiff % (recurrenceInterval || 1) === 0;
    }
    if (recurrencePattern === "custom") {
      return daysDiff % (recurrenceInterval || 1) === 0;
    }
  }

  return true;
}

function resolveTimeWindow(visit) {
  const bufferMinutes = visit.bufferFlexibilityMinutes ?? 0;
  const [hours, minutes] = (visit.preferredTime || "09:00").split(":").map(Number);
  const preferredMinutes = hours * 60 + minutes;
  const startMinutes = Math.max(0, preferredMinutes - bufferMinutes);
  const endMinutes = Math.min(24 * 60 - 1, preferredMinutes + bufferMinutes);
  return {
    preferredMinutes,
    startMinutes,
    endMinutes,
    bufferMinutes,
  };
}

async function getOccurrencesInRange(careReceiverId, startDate, endDate) {
  const careReceiver = await CareReceiver.findById(careReceiverId);
  if (!careReceiver || !careReceiver.dailyVisits?.length) {
    return [];
  }

  const now = new Date();
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const createdAtUTC = careReceiver.createdAt
    ? new Date(
        Date.UTC(
          careReceiver.createdAt.getUTCFullYear(),
          careReceiver.createdAt.getUTCMonth(),
          careReceiver.createdAt.getUTCDate(),
        ),
      )
    : todayUTC;
  const updatedAtUTC = careReceiver.updatedAt
    ? new Date(
        Date.UTC(
          careReceiver.updatedAt.getUTCFullYear(),
          careReceiver.updatedAt.getUTCMonth(),
          careReceiver.updatedAt.getUTCDate(),
        ),
      )
    : createdAtUTC;
  const effectiveStart = new Date(
    Math.max(
      startDate.getTime(),
      createdAtUTC.getTime(),
      updatedAtUTC.getTime(),
      todayUTC.getTime(),
    ),
  );

  const occurrences = [];
  const currentDate = new Date(effectiveStart.getTime());

  while (currentDate <= endDate) {
    for (const visit of careReceiver.dailyVisits) {
      if (
        isDateInSchedule(
          currentDate,
          visit,
          careReceiver.createdAt,
          careReceiver.updatedAt,
        )
      ) {
        const visitObj = visit && typeof visit.toObject === "function" ? visit.toObject() : { ...visit };
        occurrences.push({
          date: new Date(currentDate.getTime()),
          dateStr: currentDate.toISOString().split("T")[0],
          visit: visitObj,
        });
      }
    }
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return { careReceiver, occurrences };
}

module.exports = {
  isDateInSchedule,
  resolveTimeWindow,
  getOccurrencesInRange,
};
