'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { getNotifications } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { format } from 'date-fns';
import { Bell, Search, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function NotificationsPage() {
    return (
        <Suspense fallback={null}>
            <NotificationsContent />
        </Suspense>
    );
}

function NotificationsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [notifications, setNotifications] = useState<any[]>([]);
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (isHydrated && !isAuthenticated) router.push('/login');
    }, [isHydrated, isAuthenticated, router]);

    const fetchNotifications = useCallback(async (page = 1) => {
        try {
            setLoading(true);
            const data = await getNotifications(deviceId, page, 50);
            if (data.success) {
                setNotifications(data.data);
                setPagination(data.pagination);
            }
        } catch (error) {
            console.error('Failed to fetch notifications:', error);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        if (isAuthenticated && deviceId) fetchNotifications();
    }, [isAuthenticated, deviceId, fetchNotifications]);

    const filteredNotifications = notifications.filter(notif =>
        search === '' ||
        (notif.title && notif.title.toLowerCase().includes(search.toLowerCase())) ||
        (notif.text && notif.text.toLowerCase().includes(search.toLowerCase())) ||
        (notif.appName && notif.appName.toLowerCase().includes(search.toLowerCase()))
    );

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header title="Notifications" subtitle={`${pagination.total} notifications captured`} onRefresh={() => fetchNotifications(pagination.page)} />

                <div className="p-4 lg:p-8 max-w-5xl mx-auto animate-fade-in">
                    <div className="flex flex-col gap-4 mb-6">
                        <Link href={`/devices/view/?id=${deviceId}`} className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm font-medium w-fit">
                            <ArrowLeft className="w-4 h-4" />
                            Back to Device
                        </Link>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
                            <input type="text" placeholder="Search notifications..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11 w-full" />
                        </div>
                    </div>

                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="card h-28 skeleton" />)}
                        </div>
                    ) : filteredNotifications.length === 0 ? (
                        <div className="card bg-white p-12 text-center">
                            <Bell className="w-12 h-12 mx-auto mb-4 text-[var(--muted-light)]" />
                            <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">No Notifications</h3>
                            <p className="text-[var(--muted)] text-sm">No notifications have been captured yet.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredNotifications.map((notif) => (
                                <div key={notif.id} className="card bg-white p-4 group hover:shadow-lg">
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center flex-shrink-0">
                                            <Bell className="w-5 h-5 text-pink-500" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                <span className="font-semibold text-[var(--primary)] text-sm">{notif.appName || notif.app}</span>
                                                <span className="text-xs font-medium text-[var(--muted)] bg-[var(--background)] px-2 py-1 rounded-lg">
                                                    {format(new Date(notif.timestamp), 'MMM d, HH:mm')}
                                                </span>
                                            </div>
                                            <div className="bg-[var(--background)] p-3 rounded-xl border border-[var(--border)]">
                                                {notif.title && <p className="font-semibold text-[var(--foreground)] text-sm mb-1">{notif.title}</p>}
                                                {notif.text && <p className="text-sm text-[var(--muted)] break-words">{notif.text}</p>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-center gap-4 mt-8">
                            <button onClick={() => fetchNotifications(pagination.page - 1)} disabled={pagination.page <= 1} className="btn btn-secondary disabled:opacity-30">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-medium text-[var(--foreground)]">Page {pagination.page} of {pagination.pages}</span>
                            <button onClick={() => fetchNotifications(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="btn btn-secondary disabled:opacity-30">
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
