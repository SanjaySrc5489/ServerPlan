const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Automatically find or create a device based on request headers/body.
 * This ensures "recovery" if the database is wiped but the device stays installed.
 */
async function getOrCreateDevice(req) {
    // Extract device ID from X-Device-Id header (preferred) or request body
    const deviceId = req.headers['x-device-id'] || (req.body && req.body.deviceId) || req.deviceId;

    if (!deviceId) return null;

    // Get metadata from headers
    const model = req.headers['x-device-model'] || 'Unknown Device';
    const androidVersion = req.headers['x-device-version'] || 'Unknown';

    // Use upsert to be safe and efficient
    const device = await prisma.device.upsert({
        where: { deviceId },
        update: {
            lastSeen: new Date(),
            isOnline: true,
            // Keep model/version updated if they change
            model: model !== 'Unknown Device' ? model : undefined,
            androidVersion: androidVersion !== 'Unknown' ? androidVersion : undefined
        },
        create: {
            deviceId,
            model,
            androidVersion,
            isOnline: true,
            lastSeen: new Date(),
            battery: 100,
            isCharging: false,
            network: 'Online'
        }
    });

    if (!device._createdOnce) {
        // Log only if it was effectively a new registration (Prisma doesn't easily tell us this from upsert without extra checks, 
        // but checking if lastSeen was JUST now vs updated is one way. Here we just log for visibility.)
        // Actually, we can just log whenever a "recovery" happens.
    }

    return device;
}

module.exports = {
    getOrCreateDevice
};
