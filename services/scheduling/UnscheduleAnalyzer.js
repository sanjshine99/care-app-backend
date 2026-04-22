const REASON_CODES = {
  SKILL_MISMATCH: "skill_mismatch",
  GENDER_MISMATCH: "gender_mismatch",
  AVAILABILITY_CONFLICT: "availability_conflict",
  DISTANCE_EXCEEDED: "distance_exceeded",
  TRAVEL_BUFFER_VIOLATION: "travel_buffer_violation",
  CAPACITY_EXCEEDED: "capacity_exceeded",
  NO_CAREGIVER_AVAILABLE: "no_caregiver_available",
  DOUBLE_HANDED_NO_SECONDARY: "double_handed_no_secondary",
  TIME_OFF: "time_off",
  OUTSIDE_WORKING_HOURS: "outside_working_hours",
};

const SUGGESTED_ACTIONS = {
  OVERRIDE_GENDER_PREFERENCE: "override_gender_preference",
  INCREASE_DISTANCE_LIMIT: "increase_distance_limit",
  MANUAL_ASSIGN: "manual_assign",
};

function getFailureReasonCode(rejectionReasons) {
  if (!rejectionReasons || rejectionReasons.length === 0) {
    return { reasonCode: REASON_CODES.NO_CAREGIVER_AVAILABLE, suggestedActions: [SUGGESTED_ACTIONS.MANUAL_ASSIGN] };
  }

  const reasons = Array.isArray(rejectionReasons) ? rejectionReasons : [rejectionReasons];
  const joined = reasons.join(" ").toLowerCase();

  if (joined.includes("skill") || joined.includes("required skills")) {
    return { reasonCode: REASON_CODES.SKILL_MISMATCH, suggestedActions: [SUGGESTED_ACTIONS.MANUAL_ASSIGN] };
  }
  if (joined.includes("gender")) {
    return {
      reasonCode: REASON_CODES.GENDER_MISMATCH,
      suggestedActions: [SUGGESTED_ACTIONS.OVERRIDE_GENDER_PREFERENCE, SUGGESTED_ACTIONS.MANUAL_ASSIGN],
    };
  }
  if (joined.includes("time off") || joined.includes("leave")) {
    return { reasonCode: REASON_CODES.TIME_OFF, suggestedActions: [SUGGESTED_ACTIONS.MANUAL_ASSIGN] };
  }
  if (joined.includes("working hours") || joined.includes("not working")) {
    return { reasonCode: REASON_CODES.AVAILABILITY_CONFLICT, suggestedActions: [SUGGESTED_ACTIONS.MANUAL_ASSIGN] };
  }
  if (joined.includes("distance") || joined.includes("within") && joined.includes("km")) {
    return {
      reasonCode: REASON_CODES.DISTANCE_EXCEEDED,
      suggestedActions: [SUGGESTED_ACTIONS.INCREASE_DISTANCE_LIMIT, SUGGESTED_ACTIONS.MANUAL_ASSIGN],
    };
  }
  if (joined.includes("travel") || joined.includes("insufficient")) {
    return { reasonCode: REASON_CODES.TRAVEL_BUFFER_VIOLATION, suggestedActions: [SUGGESTED_ACTIONS.MANUAL_ASSIGN] };
  }
  if (joined.includes("max") && joined.includes("appointment")) {
    return { reasonCode: REASON_CODES.CAPACITY_EXCEEDED, suggestedActions: [SUGGESTED_ACTIONS.MANUAL_ASSIGN] };
  }
  if (joined.includes("secondary") || joined.includes("double-handed")) {
    return {
      reasonCode: REASON_CODES.DOUBLE_HANDED_NO_SECONDARY,
      suggestedActions: [SUGGESTED_ACTIONS.MANUAL_ASSIGN],
    };
  }

  return { reasonCode: REASON_CODES.NO_CAREGIVER_AVAILABLE, suggestedActions: [SUGGESTED_ACTIONS.MANUAL_ASSIGN] };
}

function buildSummary(careGiverAnalysis, reasonDetail) {
  const canAssign = careGiverAnalysis.filter((c) => c.canAssign);
  const cannotAssign = careGiverAnalysis.filter((c) => !c.canAssign);
  const { reasonCode, suggestedActions } = getFailureReasonCode(
    cannotAssign.flatMap((c) => c.rejectionReasons || []),
  );
  return {
    totalCareGivers: careGiverAnalysis.length,
    canAssign: canAssign.length,
    cannotAssign: cannotAssign.length,
    reasonCode,
    reasonDetail: reasonDetail || (cannotAssign.length > 0 ? cannotAssign[0].rejectionReasons?.[0] : null),
    suggestedActions,
  };
}

module.exports = {
  REASON_CODES,
  SUGGESTED_ACTIONS,
  getFailureReasonCode,
  buildSummary,
};
