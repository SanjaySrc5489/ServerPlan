const prisma = require('../lib/db');

/**
 * Sweeps all devices and updates their online status based on lastSeen time.
 * This runs periodically to ensure devices are correctly marked offline
 * if a heartbeat or sync isn't received within the grace period.
 */
async function statusSweep(io) {
    try {
        // This is a BACKUP check only - instant detection is via socket disconnect
        const gracePeriodMinutes = 1;
        const cutoff = new Date(Date.now() - gracePeriodMinutes * 60000);

        // Find devices that are marked online but haven't been seen recently
        const devicesToMarkOffline = await prisma.device.findMany({
            where: {
                isOnline: true,
                lastSeen: {
                    lt: cutoff
                }
            }
        });

        if (devicesToMarkOffline.length > 0) {
            console.log(`[STATUS-JOB] Marking ${devicesToMarkOffline.length} devices as offline`);

            for (const device of devicesToMarkOffline) {
                await prisma.device.update({
                    where: { id: device.id },
                    data: { isOnline: false }
                });

                // Notify admin panel
                if (io) {
                    io.to('admin').emit('device:offline', { deviceId: device.deviceId });
                }
            }
        }
    } catch (error) {
        console.error('[STATUS-JOB] Error during status sweep:', error);
    }
}

/**
 * Initializes the background status check job
 */
function initStatusJob(io) {
    console.log('[STATUS-JOB] Initializing background status check (every 30s)');

    // Run every 30 seconds
    setInterval(() => {
        statusSweep(io);
    }, 30000);
}

module.exports = {
    initStatusJob
};
