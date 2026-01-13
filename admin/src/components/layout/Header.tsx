'use client';

import { useEffect, useState } from 'react';
import { Bell, Search, RefreshCw, Battery, BatteryCharging, Wifi, Signal, Smartphone } from 'lucide-react';
import { connectSocket } from '@/lib/socket';

interface DeviceInfo {
    batteryLevel?: number;
    isCharging?: boolean;
    networkType?: string;
    androidVersion?: string;
    model?: string;
}

interface HeaderProps {
    title: string;
    subtitle?: string;
    onRefresh?: () => void;
    deviceInfo?: DeviceInfo;
    deviceId?: string;
}

export default function Header({ title, subtitle, onRefresh, deviceInfo, deviceId }: HeaderProps) {
    const [connected, setConnected] = useState(false);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [showNotifications, setShowNotifications] = useState(false);
    const [deviceStatus, setDeviceStatus] = useState<DeviceInfo>(deviceInfo || {});

    useEffect(() => {
        if (deviceInfo) {
            setDeviceStatus(prev => ({ ...prev, ...deviceInfo }));
        }
    }, [deviceInfo]);

    useEffect(() => {
        const socket = connectSocket();

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        socket.on('device:online', (data) => {
            setNotifications((prev) => [
                { type: 'online', ...data, time: new Date() },
                ...prev.slice(0, 9),
            ]);
        });

        socket.on('device:offline', (data) => {
            setNotifications((prev) => [
                { type: 'offline', ...data, time: new Date() },
                ...prev.slice(0, 9),
            ]);
        });

        socket.on('screenshot:new', (data) => {
            setNotifications((prev) => [
                { type: 'screenshot', ...data, time: new Date() },
                ...prev.slice(0, 9),
            ]);
        });

        // Listen for device status updates
        socket.on('device:status', (data: { deviceId: string; batteryLevel?: number; networkType?: string; isCharging?: boolean }) => {
            if (deviceId && data.deviceId === deviceId) {
                setDeviceStatus(prev => ({
                    ...prev,
                    batteryLevel: data.batteryLevel,
                    networkType: data.networkType,
                    isCharging: data.isCharging,
                }));
            }
        });

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('device:online');
            socket.off('device:offline');
            socket.off('screenshot:new');
            socket.off('device:status');
        };
    }, [deviceId]);

    return (
        <header className="h-16 lg:h-20 bg-white/80 backdrop-blur-xl border-b border-[var(--border)] flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30 shadow-sm">
            {/* Left Section - Title (with mobile padding for hamburger) */}
            <div className="animate-fade-in pl-14 lg:pl-0">
                <h1 className="text-lg lg:text-2xl font-bold text-[var(--foreground)] tracking-tight">
                    {title}
                </h1>
                {subtitle && (
                    <p className="text-xs text-[var(--muted)] font-medium hidden sm:block">
                        {subtitle}
                    </p>
                )}
            </div>

            {/* Right Section */}
            <div className="flex items-center gap-2 lg:gap-4">
                {/* Search - Hidden on mobile */}
                <div className="relative group hidden md:block">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)] group-focus-within:text-[var(--primary)] transition-colors" />
                    <input
                        type="text"
                        placeholder="Search..."
                        className="input pl-11 pr-4 py-2.5 w-48 lg:w-64 text-sm bg-[var(--background)] border-[var(--border)]"
                    />
                </div>

                {/* Refresh */}
                {onRefresh && (
                    <button
                        onClick={onRefresh}
                        className="p-2.5 rounded-xl hover:bg-[var(--background)] text-[var(--muted)] hover:text-[var(--primary)] transition-all duration-200 border border-transparent hover:border-[var(--border)]"
                        title="Refresh"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                )}

                {/* Device Status - Only show when deviceId is provided */}
                {deviceId && (deviceStatus.batteryLevel !== undefined || deviceStatus.networkType || deviceStatus.androidVersion) && (
                    <div className="hidden sm:flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-2xl border border-slate-100">
                        {/* Battery */}
                        {deviceStatus.batteryLevel !== undefined && (
                            <div className="flex items-center gap-1.5" title={`Battery: ${deviceStatus.batteryLevel}%${deviceStatus.isCharging ? ' (Charging)' : ''}`}>
                                {deviceStatus.isCharging ? (
                                    <BatteryCharging className={`w-4 h-4 ${deviceStatus.batteryLevel > 20 ? 'text-emerald-500' : 'text-amber-500'}`} />
                                ) : (
                                    <Battery className={`w-4 h-4 ${deviceStatus.batteryLevel > 50 ? 'text-emerald-500' : deviceStatus.batteryLevel > 20 ? 'text-amber-500' : 'text-red-500'}`} />
                                )}
                                <span className={`text-xs font-bold ${deviceStatus.batteryLevel > 50 ? 'text-emerald-600' : deviceStatus.batteryLevel > 20 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {deviceStatus.batteryLevel}%
                                </span>
                            </div>
                        )}

                        {/* Network */}
                        {deviceStatus.networkType && (
                            <div className="flex items-center gap-1.5" title={`Network: ${deviceStatus.networkType}`}>
                                {deviceStatus.networkType === 'WiFi' ? (
                                    <Wifi className="w-4 h-4 text-blue-500" />
                                ) : (
                                    <Signal className="w-4 h-4 text-indigo-500" />
                                )}
                                <span className="text-xs font-semibold text-slate-600">{deviceStatus.networkType}</span>
                            </div>
                        )}

                        {/* Android Version */}
                        {deviceStatus.androidVersion && (
                            <div className="flex items-center gap-1.5" title={`Android ${deviceStatus.androidVersion}`}>
                                <Smartphone className="w-4 h-4 text-slate-400" />
                                <span className="text-xs font-semibold text-slate-500">A{deviceStatus.androidVersion}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Connection Status */}
                <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${connected
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                    : 'bg-red-50 text-red-600 border-red-200'
                    }`}>
                    <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="hidden lg:inline">{connected ? 'Live' : 'Offline'}</span>
                </div>

                {/* Notifications */}
                <div className="relative">
                    <button
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="p-2.5 rounded-xl hover:bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)] transition-all duration-200 border border-transparent hover:border-[var(--border)] relative"
                    >
                        <Bell className="w-5 h-5" />
                        {notifications.length > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-[var(--primary)] rounded-full text-[10px] font-bold flex items-center justify-center text-white shadow-lg shadow-[var(--primary-glow)]">
                                {notifications.length}
                            </span>
                        )}
                    </button>

                    {/* Notifications Dropdown */}
                    {showNotifications && notifications.length > 0 && (
                        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-[var(--border)] overflow-hidden z-50 animate-fade-in">
                            <div className="p-3 border-b border-[var(--border)] bg-[var(--background)]">
                                <h3 className="font-semibold text-sm text-[var(--foreground)]">Notifications</h3>
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                                {notifications.map((notif, i) => (
                                    <div key={i} className="p-3 border-b border-[var(--border)] last:border-0 hover:bg-[var(--background)] transition-colors">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${notif.type === 'online' ? 'bg-emerald-500' : notif.type === 'offline' ? 'bg-slate-400' : 'bg-blue-500'}`} />
                                            <span className="text-sm font-medium text-[var(--foreground)] capitalize">{notif.type}</span>
                                        </div>
                                        <p className="text-xs text-[var(--muted)] mt-0.5">{notif.deviceId?.slice(0, 12)}...</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
