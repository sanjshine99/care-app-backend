// Canonical date utilities — single source of truth for all date handling
// Contract: API communication uses YYYY-MM-DD strings, internal processing uses UTC Date objects

/**
 * Parse a date string to start of day in UTC (00:00:00.000)
 */
exports.parseStartOfDayUTC = (dateStr) => {
  const d = new Date(dateStr);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Parse a date string to end of day in UTC (23:59:59.999)
 */
exports.parseEndOfDayUTC = (dateStr) => {
  const d = new Date(dateStr);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

/**
 * Convert a Date object to YYYY-MM-DD string (always UTC-based)
 */
exports.toDateString = (date) => {
  return date.toISOString().split("T")[0];
};

/**
 * Get the UTC day-of-week name from a Date object
 * Replaces .toLocaleDateString("en-GB", {weekday: "long"}) which is locale/timezone dependent
 */
exports.getDayOfWeekUTC = (date) => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[date.getUTCDay()];
};

/**
 * Normalize a Date to UTC midnight (start of day)
 */
exports.toStartOfDayUTC = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Normalize a Date to UTC end of day
 */
exports.toEndOfDayUTC = (date) => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

/**
 * Get a UTC date value for date-only comparisons (no time component)
 */
exports.toUTCDateValue = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/**
 * Get default scheduling date range (today to N weeks ahead)
 */
exports.getDefaultDateRange = (weeks = 8) => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + weeks * 7);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
};

/**
 * Get today as UTC midnight
 */
exports.todayUTC = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
