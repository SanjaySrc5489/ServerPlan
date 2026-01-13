'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { getScreenshots, getPhotos } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { format } from 'date-fns';
import {
    Image as ImageIcon,
    Camera,
    Monitor,
    X,
    ChevronLeft,
    ChevronRight,
    Download,
    Maximize2,
    ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';

export default function GalleryPage() {
    return (
        <Suspense fallback={null}>
            <GalleryContent />
        </Suspense>
    );
}

function GalleryContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [screenshots, setScreenshots] = useState<any[]>([]);
    const [photos, setPhotos] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'screenshots' | 'photos'>('screenshots');
    const [selectedImage, setSelectedImage] = useState<any>(null);

    useEffect(() => {
        if (isHydrated && !isAuthenticated) {
            router.push('/login');
        }
    }, [isHydrated, isAuthenticated, router]);

    const fetchGallery = useCallback(async () => {
        try {
            setLoading(true);
            const [screenshotsData, photosData] = await Promise.all([
                getScreenshots(deviceId, 1, 100),
                getPhotos(deviceId, 1, 100),
            ]);

            if (screenshotsData.success) {
                setScreenshots(screenshotsData.data);
            }
            if (photosData.success) {
                setPhotos(photosData.data);
            }
        } catch (error) {
            console.error('Failed to fetch gallery:', error);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    useEffect(() => {
        if (isAuthenticated && deviceId) {
            fetchGallery();
        }
    }, [isAuthenticated, deviceId, fetchGallery]);

    const currentImages = activeTab === 'screenshots' ? screenshots : photos;

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header
                    title="Gallery"
                    subtitle={`${screenshots.length + photos.length} visuals captured`}
                    onRefresh={fetchGallery}
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

                        <div className="flex p-1 bg-white rounded-xl border border-[var(--border)] shadow-sm overflow-x-auto no-scrollbar">
                            <button
                                onClick={() => setActiveTab('screenshots')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all whitespace-nowrap ${activeTab === 'screenshots'
                                    ? 'bg-[var(--primary)] text-white shadow-md'
                                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                                    }`}
                            >
                                <Monitor className="w-4 h-4" />
                                Screenshots ({screenshots.length})
                            </button>
                            <button
                                onClick={() => setActiveTab('photos')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all whitespace-nowrap ${activeTab === 'photos'
                                    ? 'bg-[var(--primary)] text-white shadow-md'
                                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                                    }`}
                            >
                                <Camera className="w-4 h-4" />
                                Photos ({photos.length})
                            </button>
                        </div>
                    </div>

                    {/* Gallery Grid */}
                    {loading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                                <div key={i} className="aspect-square card skeleton rounded-2xl" />
                            ))}
                        </div>
                    ) : currentImages.length === 0 ? (
                        <div className="card bg-white p-16 text-center">
                            <ImageIcon className="w-16 h-16 mx-auto mb-4 text-[var(--muted-light)]" />
                            <h3 className="text-xl font-bold text-[var(--foreground)] mb-2">No Visuals Found</h3>
                            <p className="text-[var(--muted)]">The {activeTab} gallery is currently empty for this device.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 lg:gap-6">
                            {currentImages.map((image) => (
                                <div
                                    key={image.id}
                                    className="group relative aspect-square card bg-white p-0 overflow-hidden cursor-pointer hover:shadow-2xl hover:-translate-y-1 transition-all duration-300"
                                    onClick={() => setSelectedImage(image)}
                                >
                                    <img
                                        src={image.url}
                                        alt="Gallery Capture"
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                                        <p className="text-white text-[10px] font-bold uppercase tracking-wider">
                                            {format(new Date(image.timestamp), 'MMM d, HH:mm')}
                                        </p>
                                    </div>
                                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                        <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30">
                                            <Maximize2 className="w-4 h-4 text-white" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Lightbox Modal */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 lg:p-12 animate-in fade-in duration-300"
                    onClick={() => setSelectedImage(null)}
                >
                    <div className="absolute top-4 right-4 lg:top-8 lg:right-8 flex gap-3">
                        <a
                            href={selectedImage.url}
                            download
                            className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-all"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Download className="w-5 h-5 lg:w-6 lg:h-6" />
                        </a>
                        <button
                            className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-all"
                            onClick={() => setSelectedImage(null)}
                        >
                            <X className="w-5 h-5 lg:w-6 lg:h-6" />
                        </button>
                    </div>

                    <div className="max-w-5xl w-full h-full flex flex-col items-center justify-center gap-6" onClick={(e) => e.stopPropagation()}>
                        <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-slate-900 group">
                            <img
                                src={selectedImage.url}
                                alt="Gallery Preview"
                                className="max-w-full max-h-[70vh] object-contain mx-auto"
                            />
                        </div>

                        <div className="bg-white rounded-2xl p-4 lg:px-8 lg:py-4 shadow-2xl flex flex-col items-center">
                            <span className="text-[10px] font-bold text-[var(--primary)] uppercase tracking-widest mb-1">Capture Metadata</span>
                            <div className="text-lg font-bold text-[var(--foreground)]">
                                {format(new Date(selectedImage.timestamp), 'MMMM d, yyyy • HH:mm:ss')}
                            </div>
                            {selectedImage.camera && (
                                <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                                    <Camera className="w-4 h-4" />
                                    {selectedImage.camera} Camera
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
