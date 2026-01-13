/**
 * Firebase Realtime Database - Simple status updates
 */

const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set } = require('firebase/database');

const firebaseConfig = {
    apiKey: "AIzaSyD0efRT8pkKCMqkAnGBVgUGu--wp3Mohkhk",
    authDomain: "javaion.firebaseapp.com",
    databaseURL: "https://javaion-default-rtdb.firebaseio.com",
    projectId: "javaion",
    storageBucket: "javaion.firebasestorage.app",
    messagingSenderId: "411702525698",
    appId: "1:411702525698:android:5c1fb0b8c1b"
};

let db = null;

try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    console.log('[FIREBASE] Ready');
} catch (e) {
    console.error('[FIREBASE] Init failed:', e.message);
}

/**
 * Set device online/offline in Firebase
 */
async function setDeviceStatus(deviceId, online, extraInfo = {}) {
    if (!db) return;

    try {
        await set(ref(db, `status/${deviceId}`), {
            online,
            lastUpdate: Date.now(),
            ...extraInfo
        });
        console.log(`[FIREBASE] ${deviceId} -> ${online ? 'ONLINE' : 'OFFLINE'}`);
    } catch (e) {
        console.error('[FIREBASE] Error:', e.message);
    }
}

module.exports = { setDeviceStatus };
