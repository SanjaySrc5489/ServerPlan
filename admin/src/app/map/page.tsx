'use client';

import { useEffect, useState, Suspense } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { getDevices } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamically import map to avoid SSR issues with Leaflet
const MultiDeviceMap = dynamic(() => import('@/components/maps/MultiDeviceMap'), {
    ssr: false,
    loading: () => <div className="card h-[600px] animate-pulse bg-[var(--card-hover)] flex items-center justify-center">Loading Map...</div>
});

export default function LiveMapPage() {
    return (
        <Suspense fallback={null}>
            <LiveMapContent />
        </Suspense>
    );
}

function LiveMapContent() {
    const router = useRouter();
    const { isAuthenticated } = useAuthStore();
    const [devices, setDevices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthenticated) {
            router.push('/login');
        }
    }, [isAuthenticated, router]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const data = await getDevices();
            if (data.success) {
                // Filter devices that have location data
                const devicesWithLocation = data.devices
                    .filter((d: any) => d.lastLocation)
                    .map((d: any) => ({
                        id: d.id,
                        model: d.model,
                        isOnline: d.isOnline,
                        latitude: d.lastLocation.latitude,
                        longitude: d.lastLocation.longitude,
                        timestamp: d.lastLocation.timestamp
                    }));
                setDevices(devicesWithLocation);
            }
        } catch (error) {
            console.error('Failed to fetch devices for map:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAuthenticated) {
            fetchData();
            // Refresh every 30 seconds
            const interval = setInterval(fetchData, 30000);
            return () => clearInterval(interval);
        }
    }, [isAuthenticated]);

    if (!isAuthenticated) return null;

    return (
        <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 ml-64">
                <Header
                    title="Live Map"
                    subtitle={`${devices.length} devices with active location`}
                    onRefresh={fetchData}
                />

                <div className="p-6">
                    <div className="card p-0 overflow-hidden border-0 shadow-2xl">
                        <MultiDeviceMap devices={devices} />
                    </div>

                    <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="card bg-green-500/10 border-green-500/20">
                            <p className="text-sm font-medium text-green-500 mb-1">Online Devices</p>
                            <h3 className="text-2xl font-bold">{devices.filter(d => d.isOnline).length}</h3>
                        </div>
                        <div className="card bg-gray-500/10 border-gray-500/20">
                            <p className="text-sm font-medium text-gray-400 mb-1">Offline Devices</p>
                            <h3 className="text-2xl font-bold">{devices.filter(d => !d.isOnline).length}</h3>
                        </div>
                        <div className="card bg-blue-500/10 border-blue-500/20">
                            <p className="text-sm font-medium text-blue-500 mb-1">Total Tracked</p>
                            <h3 className="text-2xl font-bold">{devices.length}</h3>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
