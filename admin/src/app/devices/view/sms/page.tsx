'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { getSmsLogs } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { format } from 'date-fns';
import {
    MessageSquare,
    ArrowDownLeft,
    ArrowUpRight,
    Search,
    ChevronLeft,
    ChevronRight,
    ArrowLeft,
    Inbox,
} from 'lucide-react';
import Link from 'next/link';

export default function SmsLogsPage() {
    return (
        <Suspense fallback={null}>
            <SmsLogsContent />
        </Suspense>
    );
}

function SmsLogsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [smsLogs, setSmsLogs] = useState<any[]>([]);
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing'>('all');

    useEffect(() => {
        if (isHydrated && !isAuthenticated) {
            router.push('/login');
        }
    }, [isHydrated, isAuthenticated, router]);

    const fetchSms = useCallback(async (page = 1) => {
        try {
            setLoading(true);
            const data = await getSmsLogs(deviceId, page, 50);
            if (data.success) {
                setSmsLogs(data.data);
                setPagination(data.pagination);
            }
        } catch (error) {
            console.error('Failed to fetch SMS:', error);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        if (isAuthenticated && deviceId) {
            fetchSms();
        }
    }, [isAuthenticated, deviceId, fetchSms]);

    const filteredSms = smsLogs.filter(sms => {
        const matchesFilter = filter === 'all' || sms.type === filter;
        const matchesSearch = search === '' ||
            sms.address.toLowerCase().includes(search.toLowerCase()) ||
            sms.body.toLowerCase().includes(search.toLowerCase());
        return matchesFilter && matchesSearch;
    });

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header
                    title="SMS Messages"
                    subtitle={`${pagination.total} messages captured`}
                    onRefresh={() => fetchSms(pagination.page)}
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
                            {/* Search */}
                            <div className="relative flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
                                <input
                                    type="text"
                                    placeholder="Search messages..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="input pl-11 w-full"
                                />
                            </div>

                            {/* Filter Tabs */}
                            <div className="flex p-1 bg-white rounded-xl border border-[var(--border)] shadow-sm">
                                {(['all', 'incoming', 'outgoing'] as const).map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => setFilter(type)}
                                        className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${filter === type
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

                    {/* SMS List */}
                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="card h-24 skeleton" />
                            ))}
                        </div>
                    ) : filteredSms.length === 0 ? (
                        <div className="card bg-white p-12 text-center">
                            <Inbox className="w-12 h-12 mx-auto mb-4 text-[var(--muted-light)]" />
                            <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">No Messages Found</h3>
                            <p className="text-[var(--muted)] text-sm">No SMS messages match your search criteria.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredSms.map((sms) => (
                                <div key={sms.id} className="card bg-white p-4 lg:p-5 hover:shadow-lg group">
                                    <div className="flex gap-4">
                                        {/* Icon */}
                                        <div className={`w-10 h-10 lg:w-12 lg:h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${sms.type === 'incoming'
                                            ? 'bg-emerald-50 border border-emerald-100'
                                            : 'bg-blue-50 border border-blue-100'
                                            }`}>
                                            {sms.type === 'incoming' ? (
                                                <ArrowDownLeft className="w-5 h-5 text-emerald-500" />
                                            ) : (
                                                <ArrowUpRight className="w-5 h-5 text-blue-500" />
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-[var(--foreground)]">{sms.address}</span>
                                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${sms.type === 'incoming'
                                                        ? 'text-emerald-600 bg-emerald-50'
                                                        : 'text-blue-600 bg-blue-50'
                                                        }`}>
                                                        {sms.type}
                                                    </span>
                                                </div>
                                                <span className="text-xs font-medium text-[var(--muted)] bg-[var(--background)] px-2 py-1 rounded-lg">
                                                    {format(new Date(sms.timestamp), 'MMM d, HH:mm')}
                                                </span>
                                            </div>
                                            <div className="bg-[var(--background)] p-3 rounded-xl border border-[var(--border)]">
                                                <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">{sms.body}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Pagination */}
                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-center gap-4 mt-8">
                            <button
                                onClick={() => fetchSms(pagination.page - 1)}
                                disabled={pagination.page <= 1}
                                className="btn btn-secondary disabled:opacity-30"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-medium text-[var(--foreground)]">
                                Page {pagination.page} of {pagination.pages}
                            </span>
                            <button
                                onClick={() => fetchSms(pagination.page + 1)}
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
