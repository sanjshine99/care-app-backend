// backend/services/socketService.js
// Singleton that holds the Socket.io server instance so services and
// controllers outside the request cycle can emit events to connected clients.

let _io = null;

/**
 * Call once in server.js after the Socket.io server is created.
 */
exports.init = (io) => {
  _io = io;
};

/**
 * Emit an event to a specific authenticated user's room.
 * Silently no-ops if Socket.io has not been initialised yet.
 */
exports.emitToUser = (userId, event, data) => {
  if (!_io) return;
  _io.to(String(userId)).emit(event, data);
};
