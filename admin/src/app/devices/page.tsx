'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import DeviceCard from '@/components/devices/DeviceCard';
import { getDevices } from '@/lib/api';
import { useDevicesStore, useAuthStore } from '@/lib/store';
import { connectSocket } from '@/lib/socket';
import { Smartphone, Wifi, WifiOff, Zap } from 'lucide-react';

export default function DevicesPage() {
    return (
        <Suspense fallback={null}>
            <DevicesContent />
        </Suspense>
    );
}

function DevicesContent() {
    const router = useRouter();
    const { isAuthenticated } = useAuthStore();
    const { devices, setDevices, updateDevice } = useDevicesStore();
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');

    useEffect(() => {
        if (!isAuthenticated) {
            router.push('/login');
        }
    }, [isAuthenticated, router]);

    const fetchDevices = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getDevices();
            if (data.success) {
                setDevices(data.devices);
            }
        } catch (error) {
            console.error('Failed to fetch devices:', error);
        } finally {
            setLoading(false);
        }
    }, [setDevices]);

    useEffect(() => {
        if (isAuthenticated) {
            fetchDevices();

            const socket = connectSocket();

            socket.on('device:online', (data) => {
                updateDevice(data.deviceId, { isOnline: true });
            });

            socket.on('device:offline', (data) => {
                updateDevice(data.deviceId, { isOnline: false });
            });

            return () => {
                socket.off('device:online');
                socket.off('device:offline');
            };
        }
    }, [isAuthenticated, fetchDevices, updateDevice]);

    if (!isAuthenticated) return null;

    const onlineDevices = devices.filter(d => d.isOnline);
    const offlineDevices = devices.filter(d => !d.isOnline);

    const filteredDevices = filter === 'all' ? devices :
        filter === 'online' ? onlineDevices : offlineDevices;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header
                    title="Devices"
                    subtitle={`Managing ${devices.length} devices`}
                    onRefresh={fetchDevices}
                />

                <div className="p-4 lg:p-8 max-w-7xl mx-auto">
                    {/* Filter Tabs */}
                    <div className="flex flex-wrap items-center gap-3 mb-6 lg:mb-8">
                        {[
                            { key: 'all', label: 'All Devices', count: devices.length, icon: Smartphone },
                            { key: 'online', label: 'Online', count: onlineDevices.length, icon: Wifi },
                            { key: 'offline', label: 'Offline', count: offlineDevices.length, icon: WifiOff },
                        ].map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => setFilter(tab.key as any)}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${filter === tab.key
                                        ? 'bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary-glow)]'
                                        : 'bg-white text-[var(--muted)] border border-[var(--border)] hover:border-[var(--primary)]/30 hover:text-[var(--foreground)]'
                                        }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span className="hidden sm:inline">{tab.label}</span>
                                    <span className={`ml-1 px-1.5 py-0.5 rounded-md text-xs font-bold ${filter === tab.key
                                        ? 'bg-white/20 text-white'
                                        : 'bg-[var(--background)] text-[var(--muted)]'
                                        }`}>
                                        {tab.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6">
                            {[1, 2, 3, 4, 5, 6].map((i) => (
                                <div key={i} className="card h-48 lg:h-64 skeleton" />
                            ))}
                        </div>
                    ) : filteredDevices.length === 0 ? (
                        <div className="card bg-white rounded-2xl lg:rounded-3xl p-12 lg:p-16 text-center flex flex-col items-center justify-center animate-fade-in">
                            <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-3xl bg-[var(--primary-glow)] flex items-center justify-center mb-6 lg:mb-8 border border-[var(--primary)]/20">
                                <Smartphone className="w-10 h-10 lg:w-12 lg:h-12 text-[var(--primary)]" />
                            </div>
                            <h3 className="text-xl lg:text-2xl font-bold text-[var(--foreground)] mb-2 lg:mb-4">
                                {filter === 'all' ? 'No Devices Found' : filter === 'online' ? 'No Online Devices' : 'No Offline Devices'}
                            </h3>
                            <p className="text-[var(--muted)] mb-6 lg:mb-10 max-w-md text-sm lg:text-base leading-relaxed font-medium">
                                {filter === 'all'
                                    ? 'Your monitoring list is empty. Connect a new device to get started.'
                                    : filter === 'online'
                                        ? 'All devices are currently offline.'
                                        : 'All devices are currently online.'}
                            </p>
                            {filter === 'all' && (
                                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--primary)] bg-[var(--primary-glow)] px-4 py-2 rounded-full border border-[var(--primary)]/20">
                                    <Zap className="w-3.5 h-3.5 animate-pulse" />
                                    Listening for new connections...
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6 animate-fade-in">
                            {filteredDevices.map((device) => (
                                <DeviceCard key={device.id} device={device} />
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
