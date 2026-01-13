/**
 * Firebase Cloud Messaging Service
 * Sends push notifications to devices for command execution
 */

let admin = null;
let initialized = false;

/**
 * Initialize Firebase Admin SDK
 */
function initialize() {
    if (initialized) return;

    try {
        const firebaseAdmin = require('firebase-admin');

        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;

        if (!projectId || !clientEmail || !privateKey) {
            console.warn('[FCM] Firebase credentials not configured. FCM disabled.');
            return;
        }

        admin = firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert({
                projectId,
                clientEmail,
                privateKey: privateKey.replace(/\\n/g, '\n')
            })
        });

        initialized = true;
        console.log('[FCM] Firebase Admin SDK initialized');
    } catch (error) {
        console.error('[FCM] Initialization error:', error.message);
    }
}

/**
 * Send command to device via FCM
 */
async function sendCommand(fcmToken, commandData) {
    initialize();

    if (!initialized || !admin) {
        throw new Error('FCM not initialized');
    }

    const { commandId, type, payload } = commandData;

    const message = {
        token: fcmToken,
        data: {
            type: 'command',
            commandId: commandId || '',
            commandType: type,
            payload: payload ? JSON.stringify(payload) : ''
        },
        android: {
            priority: 'high',
            ttl: 3600000 // 1 hour
        }
    };

    try {
        const response = await admin.messaging().send(message);
        console.log(`[FCM] Command sent: ${type} -> ${response}`);
        return response;
    } catch (error) {
        console.error(`[FCM] Send error:`, error.message);
        throw error;
    }
}

/**
 * Send notification to device
 */
async function sendNotification(fcmToken, title, body, data = {}) {
    initialize();

    if (!initialized || !admin) {
        throw new Error('FCM not initialized');
    }

    const message = {
        token: fcmToken,
        notification: {
            title,
            body
        },
        data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        android: {
            priority: 'high'
        }
    };

    try {
        const response = await admin.messaging().send(message);
        console.log(`[FCM] Notification sent: ${response}`);
        return response;
    } catch (error) {
        console.error(`[FCM] Notification error:`, error.message);
        throw error;
    }
}

/**
 * Send to multiple devices
 */
async function sendToMultiple(fcmTokens, data) {
    initialize();

    if (!initialized || !admin) {
        throw new Error('FCM not initialized');
    }

    const message = {
        tokens: fcmTokens,
        data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        android: {
            priority: 'high'
        }
    };

    try {
        const response = await admin.messaging().sendMulticast(message);
        console.log(`[FCM] Multicast sent: ${response.successCount}/${fcmTokens.length} successful`);
        return response;
    } catch (error) {
        console.error(`[FCM] Multicast error:`, error.message);
        throw error;
    }
}

module.exports = {
    initialize,
    sendCommand,
    sendNotification,
    sendToMultiple
};
