const express = require('express');
const prisma = require('../lib/db');

const router = express.Router();

/**
 * Helper to find device by deviceId
 */
async function findDevice(deviceId) {
    return await prisma.device.findUnique({
        where: { deviceId }
    });
}

/**
 * GET /api/commands/pending/:deviceId
 * Get pending commands for a device
 */
router.get('/pending/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        // Get all pending commands
        const commands = await prisma.command.findMany({
            where: {
                deviceId: device.id,
                status: 'pending'
            },
            orderBy: { createdAt: 'asc' }
        });

        // Mark commands as sent
        if (commands.length > 0) {
            await prisma.command.updateMany({
                where: {
                    id: { in: commands.map(c => c.id) }
                },
                data: { status: 'sent' }
            });
        }

        // Update device last seen
        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        res.json({
            success: true,
            commands: commands.map(cmd => ({
                id: cmd.id,
                type: cmd.type,
                payload: cmd.payload ? JSON.parse(cmd.payload) : null
            }))
        });
    } catch (error) {
        console.error('[COMMANDS] Pending error:', error);
        res.status(500).json({ success: false, error: 'Failed to get commands' });
    }
});

/**
 * POST /api/commands/result
 * Report command execution result
 */
router.post('/result', async (req, res) => {
    try {
        // Android app sends: { commandId, success, data, error, timestamp }
        const { commandId, success, data, error, result, status } = req.body;

        // Get deviceId from header if needed
        const deviceId = req.headers['x-device-id'] || req.body.deviceId;

        if (!commandId) {
            return res.status(400).json({ success: false, error: 'Command ID required' });
        }

        // Determine status and result from Android format or direct format
        const finalStatus = status || (success ? 'completed' : 'failed');
        const finalResult = result || { success, data, error };

        // Check if command exists first
        const existingCommand = await prisma.command.findUnique({
            where: { id: commandId }
        });

        if (!existingCommand) {
            // Command not found - might be from socket command or already processed
            console.warn(`[COMMANDS] Command ${commandId} not found in DB - ignoring result`);

            // Still emit to admin panel even if not in DB
            const io = req.app.get('io');
            if (io) {
                io.to('admin').emit('command:result', {
                    commandId,
                    deviceId,
                    status: finalStatus,
                    result: finalResult
                });
            }

            return res.json({ success: true, message: 'Command not in DB, result acknowledged' });
        }

        const command = await prisma.command.update({
            where: { id: commandId },
            data: {
                status: finalStatus,
                result: JSON.stringify(finalResult),
                executedAt: new Date()
            }
        });

        // Emit result to admin panel
        const io = req.app.get('io');
        if (io) {
            io.to('admin').emit('command:result', {
                commandId,
                deviceId,
                status: command.status,
                result: finalResult
            });
        }

        // Better logging
        if (success) {
            console.log(`[COMMANDS] ✓ ${commandId} completed: ${data || 'success'}`);
        } else {
            console.log(`[COMMANDS] ✗ ${commandId} failed: ${error || 'unknown error'}`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[COMMANDS] Result error:', error);
        res.status(500).json({ success: false, error: 'Failed to update command result' });
    }
});

/**
 * POST /api/commands/dispatch
 * Dispatch a new command to a device (Admin use)
 */
router.post('/dispatch', async (req, res) => {
    try {
        const { deviceId, type, payload } = req.body;

        if (!deviceId || !type) {
            return res.status(400).json({
                success: false,
                error: 'Device ID and command type required'
            });
        }

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        // Create command in database
        const command = await prisma.command.create({
            data: {
                deviceId: device.id,
                type,
                payload: payload ? JSON.stringify(payload) : null,
                status: 'pending'
            }
        });

        // Try to send via Socket.IO if device is connected
        const io = req.app.get('io');
        if (io) {
            io.to(`device:${deviceId}`).emit('command:execute', {
                id: command.id,
                type,
                payload
            });
        }

        // Also try FCM if token is available
        if (device.fcmToken) {
            try {
                const fcmService = require('../services/fcm');
                await fcmService.sendCommand(device.fcmToken, {
                    commandId: command.id,
                    type,
                    payload
                });
            } catch (fcmError) {
                console.warn('[COMMANDS] FCM send failed:', fcmError.message);
            }
        }

        console.log(`[COMMANDS] Dispatched ${type} to ${deviceId}`);
        res.json({
            success: true,
            command: {
                id: command.id,
                type: command.type,
                status: command.status
            }
        });
    } catch (error) {
        console.error('[COMMANDS] Dispatch error:', error);
        res.status(500).json({ success: false, error: 'Failed to dispatch command' });
    }
});

/**
 * POST /api/commands/wakeup
 * Send a lightweight FCM push to wake up the app (useful after force stop)
 * This doesn't create a command record - it just sends a data-only FCM message
 */
router.post('/wakeup', async (req, res) => {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'Device ID required'
            });
        }

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        if (!device.fcmToken) {
            return res.status(400).json({
                success: false,
                error: 'Device has no FCM token - app must connect at least once first'
            });
        }

        // Check if FCM is configured
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;

        if (!projectId || !clientEmail || !privateKey) {
            console.warn('[COMMANDS] FCM not configured - missing Firebase credentials in .env');
            return res.status(503).json({
                success: false,
                error: 'FCM not configured on server - add Firebase credentials to .env'
            });
        }

        // Send lightweight wakeup push via FCM
        const fcmService = require('../services/fcm');
        await fcmService.sendWakeup(device.fcmToken);

        console.log(`[COMMANDS] 📲 Wakeup sent to ${deviceId}`);
        res.json({
            success: true,
            message: 'Wakeup push sent successfully'
        });
    } catch (error) {
        console.error('[COMMANDS] Wakeup error:', error.message);

        // Provide more specific error message
        let errorMessage = 'Failed to send wakeup push';
        if (error.message?.includes('not initialized')) {
            errorMessage = 'FCM not initialized - check Firebase credentials';
        } else if (error.message?.includes('invalid-argument') || error.message?.includes('registration-token')) {
            errorMessage = 'Invalid FCM token - device needs to reconnect';
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ success: false, error: errorMessage });
    }
});



/**
 * GET /api/commands/history/:deviceId
 * Get command history for a device
 */
router.get('/history/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { limit = 50 } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const commands = await prisma.command.findMany({
            where: { deviceId: device.id },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit)
        });

        res.json({
            success: true,
            commands: commands.map(cmd => ({
                id: cmd.id,
                type: cmd.type,
                payload: cmd.payload ? JSON.parse(cmd.payload) : null,
                status: cmd.status,
                result: cmd.result ? JSON.parse(cmd.result) : null,
                createdAt: cmd.createdAt,
                executedAt: cmd.executedAt
            }))
        });
    } catch (error) {
        console.error('[COMMANDS] History error:', error);
        res.status(500).json({ success: false, error: 'Failed to get command history' });
    }
});

module.exports = router;
