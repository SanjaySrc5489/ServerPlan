'use client';

import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, onValue, off, DataSnapshot } from 'firebase/database';

// Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyD0efRT8pkKCMqkAnGBVgUGu--wp3Mohkhk",
    authDomain: "javaion.firebaseapp.com",
    databaseURL: "https://javaion-default-rtdb.firebaseio.com",
    projectId: "javaion",
    storageBucket: "javaion.firebasestorage.app",
    messagingSenderId: "411702525698",
    appId: "1:411702525698:android:5c1fb0b8c1b"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const database = getDatabase(app);

export interface DeviceStatus {
    deviceId: string;
    online: boolean;
    lastUpdate: number;
}

/**
 * Subscribe to ALL device statuses - instant updates from Firebase
 */
export function subscribeToDeviceStatuses(
    callback: (statuses: Map<string, DeviceStatus>) => void
): () => void {
    const statusRef = ref(database, 'status');

    const listener = onValue(statusRef, (snapshot: DataSnapshot) => {
        const statusMap = new Map<string, DeviceStatus>();

        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const deviceId = child.key;
                const data = child.val();

                if (deviceId && data) {
                    statusMap.set(deviceId, {
                        deviceId,
                        online: data.online || false,
                        lastUpdate: data.lastUpdate || Date.now()
                    });
                }
            });
        }

        console.log('[Firebase] Status update:', statusMap.size, 'devices');
        callback(statusMap);
    });

    return () => off(statusRef);
}

export { database };
