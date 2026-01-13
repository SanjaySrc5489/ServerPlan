'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { getLocations } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { format } from 'date-fns';
import {
    MapPin,
    ArrowLeft,
    Navigation,
    Clock,
    Target,
    Zap,
    ZapOff,
    Loader2,
} from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { connectSocket } from '@/lib/socket';

// Dynamic import for Leaflet (SSR issue)
const Map = dynamic(() => import('@/components/maps/LocationMap'), {
    ssr: false,
    loading: () => (
        <div className="h-full w-full bg-slate-50 rounded-3xl animate-pulse flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-lg border border-slate-100">
                <MapPin className="w-6 h-6 text-[var(--muted)]" />
            </div>
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">Initializing Map Grid...</p>
        </div>
    ),
});

export default function LocationPage() {
    return (
        <Suspense fallback={null}>
            <LocationContent />
        </Suspense>
    );
}

function LocationContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [locations, setLocations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLocation, setSelectedLocation] = useState<any>(null);
    const [isLive, setIsLive] = useState(false);
    const [isToggling, setIsToggling] = useState(false);

    // Socket for live updates
    const [socket, setSocket] = useState<any>(null);

    useEffect(() => {
        if (isAuthenticated) {
            const s = connectSocket();
            setSocket(s);
            // Ensure we are in the admin room to receive location:update
            s.emit('admin:join');
            console.log('[Socket] Location page joined admin room');

            // Cleanup: Stop live tracking when leaving the page
            return () => {
                if (isLive) {
                    console.log('[Socket] Leaving page - stopping live location');
                    s.emit('admin:sendCommand', {
                        deviceId,
                        type: 'stop_live_location',
                        payload: {}
                    });
                }
            };
        }
    }, [isAuthenticated, deviceId, isLive]);

    useEffect(() => {
        if (isHydrated && !isAuthenticated) {
            router.push('/login');
        }
    }, [isHydrated, isAuthenticated, router]);

    const fetchLocations = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getLocations(deviceId, 200);
            if (data.success) {
                setLocations(data.data);
                if (data.data.length > 0) {
                    setSelectedLocation(data.data[0]);
                }
            }
        } catch (error) {
            console.error('Failed to fetch locations:', error);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        if (isAuthenticated && deviceId) {
            fetchLocations();
        }
    }, [isAuthenticated, deviceId, fetchLocations]);

    // Live Socket Listener
    useEffect(() => {
        if (!socket || !isLive) return;

        const handleLiveUpdate = (data: any) => {
            console.log('[Socket] Live location update received:', data);

            // Check if deviceId matches (case-insensitive fallback)
            const incomingId = data.deviceId || data.id;
            if (incomingId && deviceId && incomingId.toString().toLowerCase() !== deviceId.toString().toLowerCase()) {
                return;
            }

            const newLocation = {
                id: `live-${Date.now()}`,
                ...data,
                // Ensure timestamp is in string format for the UI
                timestamp: new Date().toISOString()
            };

            setLocations(prev => {
                // Keep history, but add new at top
                return [newLocation, ...prev].slice(0, 300);
            });
            setSelectedLocation(newLocation);
        };

        socket.on('location:update', handleLiveUpdate);
        return () => {
            socket.off('location:update', handleLiveUpdate);
        };
    }, [socket, isLive, deviceId]);

    const toggleLiveMode = async () => {
        if (!socket) return;

        setIsToggling(true);
        const commandType = isLive ? 'stop_live_location' : 'start_live_location';

        try {
            console.log(`[Socket] Sending ${commandType} to ${deviceId}`);
            socket.emit('admin:sendCommand', {
                deviceId,
                type: commandType,
                payload: {}
            });

            // If starting, clear potential stale selection to focus on new live data
            if (!isLive) {
                // Wait slightly for command to reach device before switching UI state
            }

            setTimeout(() => {
                setIsLive(!isLive);
                setIsToggling(false);
            }, 800);
        } catch (error) {
            console.error('Failed to toggle live mode:', error);
            setIsToggling(false);
        }
    };

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header
                    title="Location Tracking"
                    subtitle={`${locations.length} coordinates archived`}
                    onRefresh={fetchLocations}
                />

                <div className="p-4 lg:p-8 max-w-7xl mx-auto animate-fade-in space-y-6">
                    {/* Header Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <Link
                            href={`/devices/view/?id=${deviceId}`}
                            className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm font-medium w-fit"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Device
                        </Link>

                        <button
                            onClick={toggleLiveMode}
                            disabled={isToggling}
                            className={`btn flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shadow-lg ${isLive
                                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-200 border-none'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 border-none'
                                }`}
                        >
                            {isToggling ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : isLive ? (
                                <ZapOff className="w-4 h-4" />
                            ) : (
                                <Zap className="w-4 h-4" />
                            )}
                            {isLive ? 'Stop Live Trace' : 'Go Live Tracking'}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                        {/* Map Container */}
                        <div className="lg:col-span-2">
                            <div className="card bg-white p-0 rounded-[2.5rem] border border-[var(--border)] overflow-hidden shadow-2xl relative h-[450px] lg:h-[650px]">
                                {loading ? (
                                    <div className="absolute inset-0 flex items-center justify-center bg-slate-50 animate-pulse">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="w-16 h-16 rounded-[2rem] bg-indigo-50 flex items-center justify-center border border-indigo-100 shadow-xl">
                                                <Navigation className="w-8 h-8 text-indigo-500 animate-spin" />
                                            </div>
                                            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-500">Connecting to Satellites...</span>
                                        </div>
                                    </div>
                                ) : locations.length === 0 ? (
                                    <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
                                        <div className="text-center">
                                            <div className="w-20 h-20 rounded-[2rem] bg-white flex items-center justify-center mb-6 border border-[var(--border)] shadow-lg mx-auto">
                                                <MapPin className="w-10 h-10 text-[var(--muted-light)]" />
                                            </div>
                                            <h3 className="text-xl font-bold mb-2 text-[var(--foreground)]">No Coordinates Found</h3>
                                            <p className="text-[var(--muted)] max-w-xs mx-auto">This device hasn't reported any location data yet.</p>
                                        </div>
                                    </div>
                                ) : (
                                    <Map
                                        locations={locations}
                                        selectedLocation={selectedLocation}
                                        onSelectLocation={setSelectedLocation}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Location History Sidebar */}
                        <div className="card bg-white p-0 rounded-[2.5rem] border border-[var(--border)] overflow-hidden flex flex-col h-auto lg:h-[650px] shadow-2xl">
                            <div className="p-6 lg:p-8 bg-slate-50/50 border-b border-[var(--border)] relative">
                                {isLive && (
                                    <div className="absolute top-4 right-4 flex items-center gap-2 px-2 py-1 bg-emerald-50 border border-emerald-100 rounded-full animate-pulse">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                        <span className="text-[8px] font-bold text-emerald-600 uppercase tracking-widest">Live</span>
                                    </div>
                                )}
                                <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--primary)] mb-1 block">Real-time Telemetry</span>
                                <h3 className="text-xl font-bold tracking-tight text-[var(--foreground)]">Movement Logs</h3>
                                <p className="text-[var(--muted)] font-semibold text-[10px] uppercase tracking-widest mt-1">
                                    {isLive ? 'Monitoring dynamic stream...' : `${locations.length} snapshots recorded`}
                                </p>
                            </div>

                            <div className="flex-1 overflow-y-auto no-scrollbar max-h-[500px] lg:max-h-full">
                                {locations.map((location, index) => (
                                    <button
                                        key={location.id}
                                        onClick={() => setSelectedLocation(location)}
                                        className={`w-full p-5 lg:p-6 text-left border-b border-[var(--border)] transition-all outline-none group ${selectedLocation?.id === location.id
                                            ? 'bg-indigo-50/50'
                                            : 'hover:bg-slate-50'
                                            }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`w-11 h-11 lg:w-12 lg:h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border transition-all ${selectedLocation?.id === location.id
                                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-200'
                                                : index === 0
                                                    ? 'bg-emerald-50 border-emerald-100 text-emerald-500'
                                                    : 'bg-white border-[var(--border)] text-[var(--muted)] group-hover:border-indigo-200 group-hover:text-indigo-400'
                                                }`}>
                                                {index === 0 && selectedLocation?.id !== location.id ? (
                                                    <Navigation className="w-5 h-5 animate-pulse" />
                                                ) : (
                                                    <MapPin className="w-5 h-5" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-col mb-2">
                                                    <span className={`text-[9px] font-bold uppercase tracking-widest transition-colors mb-0.5 ${selectedLocation?.id === location.id ? 'text-indigo-600' : index === 0 ? 'text-emerald-600' : 'text-[var(--muted)]'}`}>
                                                        {index === 0 ? 'Current Position' : `Historical Point #${locations.length - index}`}
                                                    </span>
                                                    <p className={`font-bold tracking-tight text-sm flex items-center gap-1 transition-colors ${selectedLocation?.id === location.id ? 'text-[var(--foreground)]' : 'text-slate-600'}`}>
                                                        <span className="font-mono text-xs">{location.latitude?.toFixed(6) || '0.000000'}</span>
                                                        <span className="text-slate-300 font-normal">,</span>
                                                        <span className="font-mono text-xs">{location.longitude?.toFixed(6) || '0.000000'}</span>
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-4 text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
                                                    <span className="flex items-center gap-1.5">
                                                        <Clock className="w-3.5 h-3.5" />
                                                        {format(new Date(location.timestamp), 'HH:mm:ss')}
                                                    </span>
                                                    {location.accuracy && (
                                                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                                                            <Target className="w-3 h-3 text-indigo-400" />
                                                            ±{Math.round(location.accuracy)}m
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
