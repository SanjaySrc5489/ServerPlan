'use client';

import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { format } from 'date-fns';
import 'leaflet/dist/leaflet.css';
import Link from 'next/link';

// Fix for default markers
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const OnlineIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const OfflineIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

interface DeviceLocation {
    id: string;
    model: string;
    isOnline: boolean;
    latitude: number;
    longitude: number;
    timestamp: string;
}

interface MultiDeviceMapProps {
    devices: DeviceLocation[];
}

export default function MultiDeviceMap({ devices }: MultiDeviceMapProps) {
    const center = useMemo(() => {
        if (devices.length === 0) {
            return [0, 0] as [number, number];
        }
        const lats = devices.map(d => d.latitude);
        const lngs = devices.map(d => d.longitude);
        return [
            (Math.min(...lats) + Math.max(...lats)) / 2,
            (Math.min(...lngs) + Math.max(...lngs)) / 2
        ] as [number, number];
    }, [devices]);

    if (devices.length === 0) {
        return (
            <div className="card h-[600px] flex items-center justify-center text-[var(--muted)]">
                No location data available for any device.
            </div>
        );
    }

    return (
        <MapContainer
            center={center}
            zoom={4}
            className="h-[600px] rounded-xl z-0"
            style={{ background: '#0f172a' }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />

            {devices.map((device) => (
                <Marker
                    key={device.id}
                    position={[device.latitude, device.longitude]}
                    icon={device.isOnline ? OnlineIcon : OfflineIcon}
                >
                    <Popup>
                        <div className="text-sm min-w-[150px]">
                            <p className="font-bold text-base mb-1">{device.model}</p>
                            <div className="flex items-center gap-2 mb-2">
                                <span className={`w-2 h-2 rounded-full ${device.isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                                <span className="text-xs uppercase font-semibold">
                                    {device.isOnline ? 'Online' : 'Offline'}
                                </span>
                            </div>
                            <p className="text-gray-500 text-xs mb-2">
                                Last updated: {format(new Date(device.timestamp), 'MMM d, HH:mm')}
                            </p>
                            <Link
                                href={`/devices/${device.id}`}
                                className="block w-full text-center py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors no-underline"
                            >
                                View Device
                            </Link>
                        </div>
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
}
