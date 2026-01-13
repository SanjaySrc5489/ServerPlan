import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
    token: string | null;
    user: { username: string; role: string } | null;
    isAuthenticated: boolean;
    isHydrated: boolean;
    login: (token: string, user: { username: string; role: string }) => void;
    logout: () => void;
    setHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            token: null,
            user: null,
            isAuthenticated: false,
            isHydrated: false,
            login: (token, user) => {
                localStorage.setItem('admin_token', token);
                set({ token, user, isAuthenticated: true });
            },
            logout: () => {
                localStorage.removeItem('admin_token');
                set({ token: null, user: null, isAuthenticated: false });
            },
            setHydrated: (state) => set({ isHydrated: state }),
        }),
        {
            name: 'auth-storage',
            onRehydrateStorage: () => (state) => {
                state?.setHydrated(true);
            },
        }
    )
);

interface Device {
    id: string;
    deviceId: string;
    model?: string;
    manufacturer?: string;
    androidVersion?: string;
    isOnline: boolean;
    lastSeen: string;
    stats?: {
        sms: number;
        calls: number;
        screenshots: number;
        photos: number;
    };
}

interface DevicesState {
    devices: Device[];
    selectedDevice: Device | null;
    setDevices: (devices: Device[]) => void;
    updateDevice: (deviceId: string, updates: Partial<Device>) => void;
    selectDevice: (device: Device | null) => void;
}

export const useDevicesStore = create<DevicesState>((set) => ({
    devices: [],
    selectedDevice: null,
    setDevices: (devices) => set({ devices }),
    updateDevice: (deviceId, updates) =>
        set((state) => ({
            devices: state.devices.map((d) =>
                d.deviceId === deviceId ? { ...d, ...updates } : d
            ),
        })),
    selectDevice: (device) => set({ selectedDevice: device }),
}));
