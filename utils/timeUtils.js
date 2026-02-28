/**
 * Normalizes a time string to HH:MM (zero-padded hour and minute).
 * Accepts "9:30", "09:30", "9:5" and returns "09:30", "09:30", "09:05".
 * Invalid or missing input returns "00:00" to avoid breaking callers.
 *
 * @param {string} timeStr - Time string in H:MM or HH:MM format
 * @returns {string} "HH:MM" (00:00 to 23:59)
 */
function normalizeTimeToHHMM(timeStr) {
  if (timeStr == null || typeof timeStr !== "string") {
    return "00:00";
  }
  const parts = timeStr.trim().split(":");
  if (parts.length < 2) {
    return "00:00";
  }
  const hour = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

module.exports = { normalizeTimeToHHMM };
