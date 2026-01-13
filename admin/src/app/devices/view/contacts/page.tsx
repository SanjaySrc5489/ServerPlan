'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { getContacts } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Users, Search, Phone, Mail, User, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function ContactsPage() {
    return (
        <Suspense fallback={null}>
            <ContactsContent />
        </Suspense>
    );
}

function ContactsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [contacts, setContacts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (isHydrated && !isAuthenticated) router.push('/login');
    }, [isHydrated, isAuthenticated, router]);

    const fetchContacts = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getContacts(deviceId);
            if (data.success) setContacts(data.data);
        } catch (error) {
            console.error('Failed to fetch contacts:', error);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        if (isAuthenticated && deviceId) fetchContacts();
    }, [isAuthenticated, deviceId, fetchContacts]);

    const filteredContacts = contacts.filter(contact =>
        search === '' ||
        contact.name.toLowerCase().includes(search.toLowerCase()) ||
        (contact.phone && contact.phone.includes(search)) ||
        (contact.email && contact.email.toLowerCase().includes(search.toLowerCase()))
    );

    const groupedContacts = filteredContacts.reduce((acc, contact) => {
        const letter = contact.name.charAt(0).toUpperCase();
        if (!acc[letter]) acc[letter] = [];
        acc[letter].push(contact);
        return acc;
    }, {} as Record<string, any[]>);

    const sortedLetters = Object.keys(groupedContacts).sort();

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header title="Contacts" subtitle={`${contacts.length} contacts synced`} onRefresh={fetchContacts} />

                <div className="p-4 lg:p-8 max-w-5xl mx-auto animate-fade-in">
                    <div className="flex flex-col gap-4 mb-6">
                        <Link href={`/devices/view/?id=${deviceId}`} className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm font-medium w-fit">
                            <ArrowLeft className="w-4 h-4" />
                            Back to Device
                        </Link>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
                            <input type="text" placeholder="Search contacts..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11 w-full" />
                        </div>
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="card h-24 skeleton" />)}
                        </div>
                    ) : filteredContacts.length === 0 ? (
                        <div className="card bg-white p-12 text-center">
                            <User className="w-12 h-12 mx-auto mb-4 text-[var(--muted-light)]" />
                            <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">No Contacts Found</h3>
                            <p className="text-[var(--muted)] text-sm">No contacts match your search criteria.</p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {sortedLetters.map(letter => (
                                <div key={letter}>
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center font-bold text-lg shadow-md shadow-[var(--primary-glow)]">
                                            {letter}
                                        </div>
                                        <div className="h-px flex-1 bg-[var(--border)]" />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {groupedContacts[letter].map((contact: any) => (
                                            <div key={contact.id} className="card bg-white p-4 group hover:shadow-lg">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] flex items-center justify-center text-white font-bold text-lg shadow-md">
                                                        {contact.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-semibold text-[var(--foreground)] truncate group-hover:text-[var(--primary)] transition-colors">{contact.name}</h4>
                                                        {contact.phone && (
                                                            <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] mt-0.5">
                                                                <Phone className="w-3 h-3" />
                                                                {contact.phone}
                                                            </div>
                                                        )}
                                                        {contact.email && (
                                                            <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] truncate mt-0.5">
                                                                <Mail className="w-3 h-3 flex-shrink-0" />
                                                                {contact.email}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
