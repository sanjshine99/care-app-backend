// backend/services/settingsService.js
// Settings service with caching for performance

const Settings = require("../models/Settings");

// In-memory cache
let settingsCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Get settings (with caching)
 */
exports.getSettings = async () => {
  const now = Date.now();

  // Return cached settings if fresh
  if (settingsCache && cacheTimestamp && now - cacheTimestamp < CACHE_TTL) {
    return settingsCache;
  }

  // Fetch fresh settings
  const settings = await Settings.getSettings();

  // Update cache
  settingsCache = settings;
  cacheTimestamp = now;

  return settings;
};

/**
 * Update settings and invalidate cache
 */
exports.updateSettings = async (updates, userId) => {
  const settings = await Settings.updateSettings(updates, userId);

  // Invalidate cache
  settingsCache = settings;
  cacheTimestamp = Date.now();

  return settings;
};

/**
 * Clear settings cache (force refresh)
 */
exports.clearCache = () => {
  settingsCache = null;
  cacheTimestamp = null;
};

/**
 * Get specific setting value
 */
exports.getSetting = async (path, defaultValue = null) => {
  const settings = await exports.getSettings();
  const value = settings.get(path);
  return value !== null ? value : defaultValue;
};

/**
 * Get scheduling settings (commonly used)
 */
exports.getSchedulingSettings = async () => {
  const settings = await exports.getSettings();
  return settings.scheduling;
};

/**
 * Get notification settings
 */
exports.getNotificationSettings = async () => {
  const settings = await exports.getSettings();
  return settings.notifications;
};

/**
 * Get system settings
 */
exports.getSystemSettings = async () => {
  const settings = await exports.getSettings();
  return settings.system;
};

module.exports = exports;
