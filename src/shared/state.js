/**
 * Shared state for tracking connected devices
 * This is used by both socket handlers and API routes
 */

// Map of socket.id -> deviceId
const connectedDevices = new Map();

// Map of requestId -> { deviceId, timeoutId, adminSocket }
const pendingPings = new Map();

module.exports = { connectedDevices, pendingPings };
