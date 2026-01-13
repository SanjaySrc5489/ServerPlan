'use client';

import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
    if (!socket) {
        socket = io(API_URL, {
            autoConnect: false,
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
        });

        // Join admin room on every connect/reconnect
        socket.on('connect', () => {
            console.log('[Socket] Connected, joining admin room');
            socket?.emit('admin:join');
        });
    }
    return socket;
};

export const connectSocket = (): Socket => {
    const s = getSocket();
    if (!s.connected) {
        s.connect();
    }
    return s;
};

export const disconnectSocket = () => {
    if (socket?.connected) {
        socket.disconnect();
    }
};

export const watchDeviceStream = (deviceId: string) => {
    const s = getSocket();
    s.emit('stream:watch', { deviceId });
};

export const unwatchDeviceStream = (deviceId: string) => {
    const s = getSocket();
    s.emit('stream:unwatch', { deviceId });
};

export const sendCommand = (deviceId: string, type: string, payload?: any) => {
    const s = getSocket();
    s.emit('command:send', { deviceId, type, payload });
};

// WebRTC Signaling helpers
export const sendWebRTCAnswer = (deviceId: string, sdp: RTCSessionDescriptionInit) => {
    const s = getSocket();
    s.emit('webrtc:answer', { deviceId, sdp });
};

export const sendWebRTCIceCandidate = (deviceId: string, candidate: RTCIceCandidate) => {
    const s = getSocket();
    s.emit('webrtc:ice-candidate', { deviceId, candidate: candidate.toJSON(), from: 'admin' });
};

export const stopWebRTCStream = (deviceId: string) => {
    const s = getSocket();
    s.emit('webrtc:stop', { deviceId });
};

// Ping device to check status instantly
export const pingDevice = (deviceId: string): Promise<{ online: boolean; timedOut?: boolean }> => {
    return new Promise((resolve) => {
        const s = getSocket();
        const requestId = `ping_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const handler = (data: { deviceId: string; requestId: string; online: boolean; timedOut?: boolean }) => {
            if (data.requestId === requestId) {
                s.off('device:pong', handler);
                resolve({ online: data.online, timedOut: data.timedOut });
            }
        };

        s.on('device:pong', handler);
        s.emit('device:ping', { deviceId, requestId });

        // Safety timeout (10s) in case server doesn't respond
        setTimeout(() => {
            s.off('device:pong', handler);
            resolve({ online: false, timedOut: true });
        }, 10000);
    });
};

export default socket;
