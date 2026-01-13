'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { getCallLogs } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { format, formatDuration, intervalToDuration } from 'date-fns';
import {
    Phone,
    PhoneIncoming,
    PhoneOutgoing,
    PhoneMissed,
    Search,
    ChevronLeft,
    ChevronRight,
    Clock,
    ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';

export default function CallLogsPage() {
    return (
        <Suspense fallback={null}>
            <CallLogsContent />
        </Suspense>
    );
}

function CallLogsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [callLogs, setCallLogs] = useState<any[]>([]);
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing' | 'missed'>('all');

    useEffect(() => {
        if (isHydrated && !isAuthenticated) {
            router.push('/login');
        }
    }, [isHydrated, isAuthenticated, router]);

    const fetchCalls = useCallback(async (page = 1) => {
        try {
            setLoading(true);
            const data = await getCallLogs(deviceId, page, 50);
            if (data.success) {
                setCallLogs(data.data);
                setPagination(data.pagination);
            }
        } catch (error) {
            console.error('Failed to fetch calls:', error);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        if (isAuthenticated && deviceId) {
            fetchCalls();
        }
    }, [isAuthenticated, deviceId, fetchCalls]);

    const filteredCalls = callLogs.filter(call => {
        const matchesFilter = filter === 'all' || call.type === filter;
        const matchesSearch = search === '' ||
            call.number.toLowerCase().includes(search.toLowerCase()) ||
            (call.name && call.name.toLowerCase().includes(search.toLowerCase()));
        return matchesFilter && matchesSearch;
    });

    const formatCallDuration = (seconds: number) => {
        if (seconds === 0) return '0s';
        const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
        return formatDuration(duration, { format: ['hours', 'minutes', 'seconds'], delimiter: ' ' });
    };

    const getCallIcon = (type: string) => {
        switch (type) {
            case 'incoming':
                return <PhoneIncoming className="w-5 h-5 text-emerald-500" />;
            case 'outgoing':
                return <PhoneOutgoing className="w-5 h-5 text-blue-500" />;
            case 'missed':
                return <PhoneMissed className="w-5 h-5 text-red-500" />;
            default:
                return <Phone className="w-5 h-5 text-[var(--muted)]" />;
        }
    };

    const getCallColor = (type: string) => {
        switch (type) {
            case 'incoming': return { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600' };
            case 'outgoing': return { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-600' };
            case 'missed': return { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-600' };
            default: return { bg: 'bg-slate-50', border: 'border-slate-100', text: 'text-slate-600' };
        }
    };

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header
                    title="Call Logs"
                    subtitle={`${pagination.total} calls recorded`}
                    onRefresh={() => fetchCalls(pagination.page)}
                />

                <div className="p-4 lg:p-8 max-w-5xl mx-auto animate-fade-in">
                    {/* Back & Filters */}
                    <div className="flex flex-col gap-4 mb-6">
                        <Link
                            href={`/devices/view/?id=${deviceId}`}
                            className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm font-medium w-fit"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Device
                        </Link>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="relative flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
                                <input
                                    type="text"
                                    placeholder="Search by name or number..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="input pl-11 w-full"
                                />
                            </div>

                            <div className="flex p-1 bg-white rounded-xl border border-[var(--border)] shadow-sm overflow-x-auto no-scrollbar">
                                {(['all', 'incoming', 'outgoing', 'missed'] as const).map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => setFilter(type)}
                                        className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all whitespace-nowrap ${filter === type
                                            ? 'bg-[var(--primary)] text-white shadow-md'
                                            : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                                            }`}
                                    >
                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Call List */}
                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="card h-20 skeleton" />
                            ))}
                        </div>
                    ) : filteredCalls.length === 0 ? (
                        <div className="card bg-white p-12 text-center">
                            <Phone className="w-12 h-12 mx-auto mb-4 text-[var(--muted-light)]" />
                            <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">No Calls Found</h3>
                            <p className="text-[var(--muted)] text-sm">No call logs match your search criteria.</p>
                        </div>
                    ) : (
                        <div className="card bg-white p-0 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="table w-full">
                                    <thead>
                                        <tr>
                                            <th>Type</th>
                                            <th>Contact</th>
                                            <th>Duration</th>
                                            <th>Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredCalls.map((call) => {
                                            const colors = getCallColor(call.type);
                                            return (
                                                <tr key={call.id}>
                                                    <td>
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colors.bg} border ${colors.border}`}>
                                                            {getCallIcon(call.type)}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div>
                                                            <span className="font-semibold text-[var(--foreground)] block">{call.name || 'Unknown'}</span>
                                                            <span className="text-xs text-[var(--muted)]">{call.number}</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                                                            <Clock className="w-4 h-4 text-[var(--muted)]" />
                                                            {formatCallDuration(call.duration)}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span className="text-sm text-[var(--muted)]">
                                                            {format(new Date(call.timestamp), 'MMM d, HH:mm')}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Pagination */}
                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-center gap-4 mt-8">
                            <button
                                onClick={() => fetchCalls(pagination.page - 1)}
                                disabled={pagination.page <= 1}
                                className="btn btn-secondary disabled:opacity-30"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-medium text-[var(--foreground)]">
                                Page {pagination.page} of {pagination.pages}
                            </span>
                            <button
                                onClick={() => fetchCalls(pagination.page + 1)}
                                disabled={pagination.page >= pagination.pages}
                                className="btn btn-secondary disabled:opacity-30"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
