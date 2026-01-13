'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { format } from 'date-fns';
import 'leaflet/dist/leaflet.css';

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

const ActiveIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

// Arrow Icon for live movement
const createArrowIcon = (bearing: number) => L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="transform: rotate(${bearing}deg); width: 40px; height: 40px; display: flex; items-center; justify-center; background: #3b82f6; border: 3px solid white; border-radius: 12px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7"/>
            </svg>
           </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
});

L.Marker.prototype.options.icon = DefaultIcon;

interface Location {
    id: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    bearing?: number;
    speed?: number;
    timestamp: string;
}

interface LocationMapProps {
    locations: Location[];
    selectedLocation?: Location | null;
    onSelectLocation?: (location: Location) => void;
}

// Component to recenter map when selection changes
function MapController({ location }: { location: Location | null }) {
    const map = useMap();

    useEffect(() => {
        if (location) {
            map.flyTo([location.latitude, location.longitude], 15, {
                duration: 0.5
            });
        }
    }, [location, map]);

    return null;
}

export default function LocationMap({ locations: rawLocations, selectedLocation, onSelectLocation }: LocationMapProps) {
    // Filter out potential undefined coordinates to prevent Leaflet "Invalid LatLng" errors
    const locations = useMemo(() => {
        return rawLocations.filter(l =>
            l &&
            typeof l.latitude === 'number' &&
            typeof l.longitude === 'number'
        );
    }, [rawLocations]);

    // Calculate center and bounds
    const center = useMemo(() => {
        if (selectedLocation && typeof selectedLocation.latitude === 'number' && typeof selectedLocation.longitude === 'number') {
            return [selectedLocation.latitude, selectedLocation.longitude] as [number, number];
        }
        if (locations.length === 0) {
            return [0, 0] as [number, number];
        }
        const lats = locations.map(l => l.latitude);
        const lngs = locations.map(l => l.longitude);
        return [
            (Math.min(...lats) + Math.max(...lats)) / 2,
            (Math.min(...lngs) + Math.max(...lngs)) / 2
        ] as [number, number];
    }, [locations, selectedLocation]);

    // Create path for polyline
    const path = useMemo(() => {
        return locations.map(l => [l.latitude, l.longitude] as [number, number]);
    }, [locations]);

    if (locations.length === 0) {
        return (
            <div className="h-full w-full flex items-center justify-center bg-slate-50">
                <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">Awaiting valid GPS fix...</p>
            </div>
        );
    }

    return (
        <MapContainer
            center={center}
            zoom={14}
            className="h-[500px] rounded-xl"
            style={{ background: '#1e293b' }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />

            <MapController location={selectedLocation && typeof selectedLocation.latitude === 'number' ? selectedLocation : null} />

            {/* Path line */}
            {path.length > 1 && (
                <Polyline
                    positions={path}
                    pathOptions={{
                        color: '#3b82f6',
                        weight: 3,
                        opacity: 0.7,
                        dashArray: '10, 10'
                    }}
                />
            )}

            {/* Location markers */}
            {locations.map((location, index) => {
                const isLatest = index === 0;
                const isSelected = selectedLocation?.id === location.id;

                return (
                    <Marker
                        key={location.id}
                        position={[location.latitude, location.longitude]}
                        icon={isLatest ? createArrowIcon(location.bearing || 0) : isSelected ? ActiveIcon : DefaultIcon}
                        eventHandlers={{
                            click: () => onSelectLocation?.(location)
                        }}
                    >
                        <Popup>
                            <div className="text-sm">
                                <p className="font-semibold mb-1">
                                    {index === 0 ? 'Latest Location' : `Location #${locations.length - index}`}
                                </p>
                                <p className="text-gray-600">
                                    {location.latitude?.toFixed(6) || '0.000000'}, {location.longitude?.toFixed(6) || '0.000000'}
                                </p>
                                <p className="text-gray-500 text-xs mt-1">
                                    {format(new Date(location.timestamp), 'MMM d, yyyy HH:mm:ss')}
                                </p>
                                {location.accuracy && (
                                    <p className="text-gray-500 text-xs">
                                        Accuracy: ±{Math.round(location.accuracy)}m
                                    </p>
                                )}
                            </div>
                        </Popup>
                    </Marker>
                );
            })}
        </MapContainer>
    );
}
