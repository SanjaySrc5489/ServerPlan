'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { useAuthStore } from '@/lib/store';
import {
    connectSocket,
    getSocket,
    watchDeviceStream,
    unwatchDeviceStream,
    sendCommand,
    sendWebRTCAnswer,
    sendWebRTCIceCandidate,
    stopWebRTCStream
} from '@/lib/socket';
import {
    Video,
    VideoOff,
    Camera,
    RefreshCw,
    AlertCircle,
    Wifi,
    Mic,
    ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';

// Stream modes - must match Android WebRTCManager constants
const STREAM_MODE = {
    VIDEO_ONLY: 0,
    AUDIO_ONLY: 1,
    VIDEO_AUDIO: 2,
};

export default function LiveStreamPage() {
    return (
        <Suspense fallback={null}>
            <LiveStreamContent />
        </Suspense>
    );
}

function LiveStreamContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const deviceId = searchParams.get('id') as string;
    const { isAuthenticated, isHydrated } = useAuthStore();

    const [isStreaming, setIsStreaming] = useState(false);
    const [connectionState, setConnectionState] = useState<string>('disconnected');
    const [error, setError] = useState<string | null>(null);
    const [useFrontCamera, setUseFrontCamera] = useState(false);
    const [streamMode, setStreamMode] = useState(STREAM_MODE.VIDEO_ONLY);

    const videoRef = useRef<HTMLVideoElement>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    // Ref to track streaming state for cleanup (avoids dependency issues)
    const isStreamingRef = useRef(false);

    // Auth check
    useEffect(() => {
        if (isHydrated && !isAuthenticated) {
            router.push('/login');
        }
    }, [isHydrated, isAuthenticated, router]);

    // ICE servers for NAT traversal
    const ICE_SERVERS: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
        ],
    };

    // Handle incoming WebRTC offer from device
    const handleOffer = useCallback(async (data: { deviceId: string; sdp: string }) => {
        if (data.deviceId !== deviceId) return;

        console.log('[WebRTC] Received offer from device');
        setError(null);

        try {
            const sdp = JSON.parse(data.sdp);

            // Create peer connection if not exists
            if (!peerConnectionRef.current) {
                peerConnectionRef.current = new RTCPeerConnection(ICE_SERVERS);

                // Handle incoming tracks (video and/or audio)
                peerConnectionRef.current.ontrack = (event) => {
                    console.log('[WebRTC] Got remote track:', event.track.kind, event.streams);

                    // Attach stream to video element
                    if (videoRef.current && event.streams[0]) {
                        console.log('[WebRTC] Setting srcObject for:', event.track.kind);
                        if (videoRef.current.srcObject !== event.streams[0]) {
                            videoRef.current.srcObject = event.streams[0];
                        }

                        // Set streaming state
                        setIsStreaming(true);
                        isStreamingRef.current = true;
                        setConnectionState('connected');

                        // Play the video
                        videoRef.current.play().catch(err => {
                            if (err.name !== 'AbortError') {
                                console.error('[WebRTC] Play error:', err);
                            }
                        });
                    }
                };

                // Handle ICE candidates
                peerConnectionRef.current.onicecandidate = (event) => {
                    if (event.candidate) {
                        console.log('[WebRTC] Sending ICE candidate to device');
                        sendWebRTCIceCandidate(deviceId, event.candidate);
                    }
                };

                // Connection state changes
                peerConnectionRef.current.onconnectionstatechange = () => {
                    const state = peerConnectionRef.current?.connectionState || 'unknown';
                    console.log('[WebRTC] PC State:', state);
                    setConnectionState(state);

                    if (state === 'connected') {
                        setIsStreaming(true);
                        isStreamingRef.current = true;
                    } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                        setIsStreaming(false);
                        isStreamingRef.current = false;
                    }
                };

                // ICE connection state changes
                peerConnectionRef.current.oniceconnectionstatechange = () => {
                    console.log('[WebRTC] ICE State:', peerConnectionRef.current?.iceConnectionState);
                };
            }

            // Set remote description (offer)
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));

            // Create and send answer
            const answer = await peerConnectionRef.current.createAnswer();
            await peerConnectionRef.current.setLocalDescription(answer);

            console.log('[WebRTC] Sending answer to device');
            sendWebRTCAnswer(deviceId, answer);

        } catch (err: any) {
            console.error('[WebRTC] Error handling offer:', err);
            setError('Failed to establish connection: ' + err.message);
        }
    }, [deviceId]);

    // Handle incoming ICE candidate
    const handleIceCandidate = useCallback(async (data: { deviceId: string; candidate: any }) => {
        if (data.deviceId && data.deviceId !== deviceId) return;

        try {
            const candidateData = typeof data.candidate === 'string' ? JSON.parse(data.candidate) : data.candidate;
            if (peerConnectionRef.current) {
                await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidateData));
                console.log('[WebRTC] Added remote ICE candidate');
            }
        } catch (err: any) {
            console.error('[WebRTC] Error adding remote ICE:', err);
        }
    }, [deviceId]);

    const cleanupConnection = useCallback(() => {
        if (peerConnectionRef.current) { peerConnectionRef.current.close(); peerConnectionRef.current = null; }
        if (videoRef.current) videoRef.current.srcObject = null;
        setIsStreaming(false);
        setConnectionState('disconnected');
    }, []);

    // Handle stream stopped from device
    const handleStreamStopped = useCallback((data: { deviceId: string }) => {
        if (data.deviceId !== deviceId) return;
        console.log('[WebRTC] Stream stopped notification received');
        cleanupConnection();
    }, [deviceId, cleanupConnection]);

    // Setup socket listeners
    useEffect(() => {
        if (!isAuthenticated || !deviceId) return;

        console.log('[Stream] Registering listeners for:', deviceId);
        const socket = getSocket();

        // Ensure connected
        if (!socket.connected) socket.connect();

        // Join rooms
        socket.emit('admin:join');
        socket.emit('stream:join', { deviceId });

        socket.on('webrtc:offer', handleOffer);
        socket.on('webrtc:ice-candidate', handleIceCandidate);
        socket.on('webrtc:stopped', handleStreamStopped);
        socket.on('camera:stopped', handleStreamStopped);
        socket.on('camera:error', (data: { error: string }) => {
            console.error('[Camera] Device reported error:', data.error);
            setError(data.error);
            cleanupConnection();
        });

        return () => {
            console.log('[Stream] Cleaning up listeners');
            socket.off('webrtc:offer', handleOffer);
            socket.off('webrtc:ice-candidate', handleIceCandidate);
            socket.off('webrtc:stopped', handleStreamStopped);
            socket.off('camera:stopped', handleStreamStopped);
            socket.off('camera:error');
            // Don't leave admin room, just the stream
            socket.emit('stream:leave', { deviceId });

            // Stop the stream on the device side when leaving the page (use ref to avoid dependency issues)
            if (isStreamingRef.current) {
                console.log('[Stream] Stopping stream on device - page leave cleanup');
                stopWebRTCStream(deviceId);
            }

            cleanupConnection();
        };
    }, [isAuthenticated, deviceId, handleOffer, handleIceCandidate, handleStreamStopped, cleanupConnection]);

    const startStream = () => {
        setError(null);
        setConnectionState('connecting');
        sendCommand(deviceId, 'start_camera_stream', {
            camera: useFrontCamera ? 'front' : 'back',
            mode: streamMode
        });
    };

    const stopStream = () => { stopWebRTCStream(deviceId); cleanupConnection(); };

    const toggleCamera = () => {
        setUseFrontCamera(!useFrontCamera);
        if (isStreaming) {
            stopStream();
            setTimeout(() => {
                sendCommand(deviceId, 'start_camera_stream', { camera: !useFrontCamera ? 'front' : 'back', mode: streamMode });
            }, 500);
        }
    };

    if (!isHydrated || !isAuthenticated) return null;

    return (
        <div className="flex min-h-screen bg-[var(--background)]">
            <Sidebar />
            <main className="flex-1 lg:ml-72">
                <Header title="Live Stream" subtitle="Encrypted P2P Media Relay" />

                <div className="p-4 lg:p-8 max-w-7xl mx-auto animate-fade-in space-y-6">
                    {/* Header Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <Link href={`/devices/view/?id=${deviceId}`} className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm font-medium w-fit">
                            <ArrowLeft className="w-4 h-4" />
                            Back to Device
                        </Link>

                        <div className="flex items-center gap-3 px-4 py-2 bg-white rounded-xl border border-[var(--border)] shadow-sm">
                            <div className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Status:</span>
                            <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${connectionState === 'connected' ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {connectionState}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-8">
                        {/* Video Feed */}
                        <div className="lg:col-span-3">
                            <div className="card bg-white p-0 rounded-[2.5rem] border border-[var(--border)] overflow-hidden shadow-2xl relative aspect-video bg-black flex items-center justify-center">
                                {/* Video element - ALWAYS visible for testing */}
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted={false}
                                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                />

                                {/* Status indicator overlay - only when not connected */}
                                {connectionState !== 'connected' && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                                        <div className="text-center text-white">
                                            <RefreshCw className={`w-12 h-12 mx-auto mb-4 ${connectionState === 'connecting' ? 'animate-spin' : ''}`} />
                                            <p className="text-sm">{connectionState === 'connecting' ? 'Connecting...' : connectionState}</p>
                                        </div>
                                    </div>
                                )}

                                {/* Overlay Badge */}
                                <div className="absolute top-6 left-6 flex items-center gap-3">
                                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border backdrop-blur-md transition-all ${connectionState === 'connected' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' : 'bg-white/80 border-[var(--border)] text-[var(--muted)]'}`}>
                                        <div className={`w-1.5 h-1.5 rounded-full ${connectionState === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-current opacity-30'}`} />
                                        <span className="text-[9px] font-bold uppercase tracking-widest">{connectionState}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="lg:col-span-1 space-y-6">
                            <div className="card bg-white p-6 lg:p-8 rounded-[2.5rem] border border-[var(--border)] shadow-2xl space-y-8">
                                <div>
                                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--primary)] mb-6 block">Command Center</span>
                                    <div className="space-y-2">
                                        {[
                                            { id: STREAM_MODE.VIDEO_ONLY, label: 'Video Only', icon: Video },
                                            { id: STREAM_MODE.AUDIO_ONLY, label: 'Audio Only', icon: Mic },
                                            { id: STREAM_MODE.VIDEO_AUDIO, label: 'Full Media', icon: Wifi }
                                        ].map((mode) => (
                                            <button
                                                key={mode.id}
                                                onClick={() => !isStreaming && setStreamMode(mode.id)}
                                                disabled={isStreaming}
                                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${streamMode === mode.id ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100'} ${isStreaming ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                <mode.icon className="w-4 h-4" />
                                                <span className="text-[10px] font-bold uppercase tracking-widest">{mode.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-3 pt-6 border-t border-[var(--border)]">
                                    {!isStreaming ? (
                                        <button onClick={startStream} disabled={connectionState === 'connecting'} className="btn btn-primary w-full py-4 text-xs font-bold uppercase tracking-[0.1em] flex items-center justify-center gap-3">
                                            <Wifi className="w-4 h-4" /> Start Feed
                                        </button>
                                    ) : (
                                        <button onClick={stopStream} className="btn bg-red-50 text-red-600 border-red-100 hover:bg-red-600 hover:text-white w-full py-4 text-xs font-bold uppercase tracking-[0.1em] flex items-center justify-center gap-3">
                                            <VideoOff className="w-4 h-4" /> Stop Feed
                                        </button>
                                    )}

                                    {streamMode !== STREAM_MODE.AUDIO_ONLY && (
                                        <button onClick={toggleCamera} className="w-full py-3 rounded-xl bg-slate-50 border border-slate-100 text-slate-600 font-bold text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-all flex items-center justify-center gap-2">
                                            <Camera className="w-3.5 h-3.5" />
                                            {useFrontCamera ? 'Front Lens' : 'Rear Lens'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Signal Info */}
                            <div className="card bg-indigo-50/30 border-indigo-100 p-6 rounded-[2rem]">
                                <h4 className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                    Relay Protocol
                                </h4>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                        <span>Encryption</span>
                                        <span className="text-emerald-600">AES-256</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                        <span>Protocol</span>
                                        <span className="text-indigo-600">WebRTC P2P</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="card bg-red-50 border-red-100 p-5 rounded-[2rem] flex items-start gap-4">
                            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center border border-red-100 shadow-sm shrink-0">
                                <AlertCircle className="w-5 h-5 text-red-500" />
                            </div>
                            <div>
                                <span className="text-[10px] font-bold text-red-600 uppercase tracking-widest mb-1 block">Relay Interruption</span>
                                <p className="text-slate-600 text-sm font-medium">{error}</p>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
