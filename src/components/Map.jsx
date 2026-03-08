import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from 'lucide-react';

// Fix for default Leaflet icon paths in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// A custom map event handler for capturing clicks and map bounds
function MapInteraction({ onMapClick, nests, onVisibleNestsChange }) {
    const map = useMap();

    const updateVisibleNests = () => {
        if (!onVisibleNestsChange || !nests) return;
        const bounds = map.getBounds();
        const visible = nests.filter(nest => bounds.contains([nest.lat, nest.lng]));
        // Make sure we only update if the count or IDs actually changed to prevent infinite loops (simplified check)
        // Just calling it every move/zoom is usually fine, React batches it
        onVisibleNestsChange(visible);
    };

    useMapEvents({
        click: (e) => {
            onMapClick(e.latlng);
        },
        moveend: updateVisibleNests,
        zoomend: updateVisibleNests
    });

    useEffect(() => {
        // Slight delay to ensure map has its final size after mounting
        const timeoutId = setTimeout(updateVisibleNests, 300);
        return () => clearTimeout(timeoutId);
    }, [nests, map]);

    return null;
}

// Map colors to actions
const getMarkerColor = (nest) => {
    if (!nest.logs || nest.logs.length === 0) return '#3b82f6'; // Blue for new nest

    // Find the latest action that actually changes the nest status
    const statusLog = nest.logs.find(log =>
        !log.action.startsWith('Name geändert zu') &&
        !log.action.startsWith('Nest angelegt') &&
        !log.action.startsWith('Foto hinzugefügt') &&
        !log.action.startsWith('Foto gelöscht')
    );

    const latestAction = statusLog ? statusLog.action : 'Neues Nest';

    if (latestAction.startsWith('Taubeneier gegen Kunststoffeier getauscht')) return '#22c55e'; // Green
    if (latestAction.startsWith('Kunststoffeier werden bebrütet')) return '#eab308'; // Yellow
    if (latestAction.startsWith('Kunststoffeier entfernt')) return '#ef4444'; // Red
    if (latestAction.startsWith('Küken')) return '#14b8a6'; // Teal
    if (latestAction.startsWith('Eier zu weit')) return '#f97316'; // Orange
    if (latestAction.startsWith('Nest verlassen')) return '#a855f7'; // Purple

    return '#3b82f6'; // Fallback to Blue
};

const createCustomIcon = (color, isLoading = false) => {
    const loadingClass = isLoading ? 'marker-loading' : '';
    const svgHTML = `
        <svg class="${loadingClass}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="42" fill="${color}" stroke="white" stroke-width="2" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.3));">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
    `;

    return new L.divIcon({
        className: 'custom-leaflet-marker',
        html: svgHTML,
        iconSize: [32, 42],
        iconAnchor: [16, 42],
        popupAnchor: [0, -42]
    });
};

// Control for localizing user
function LocateUserControl() {
    const map = useMap();
    const [locating, setLocating] = useState(false);
    const [position, setPosition] = useState(null);

    useEffect(() => {
        let hasSetInitialView = false;

        const handleLocationFound = (e) => {
            setLocating(false);
            setPosition(e.latlng);

            // On the very first location fix after load, center the map
            if (!hasSetInitialView) {
                map.flyTo(e.latlng, 15, { animate: false });
                hasSetInitialView = true;
            }
        };
        const handleLocationError = (e) => {
            setLocating(false);
        };

        map.on('locationfound', handleLocationFound);
        map.on('locationerror', handleLocationError);

        // Track user continuously (does not forcefully re-center after the first time)
        map.locate({ watch: true, enableHighAccuracy: true });

        return () => {
            map.off('locationfound', handleLocationFound);
            map.off('locationerror', handleLocationError);
            map.stopLocate();
        };
    }, [map]);

    const locate = () => {
        setLocating(true);
        if (position) {
            // Zoom in extremely close (level 19) when requested
            map.flyTo(position, 19, { animate: true });
            setLocating(false);
        } else {
            // Force re-check if unknown
            map.locate({ watch: true, enableHighAccuracy: true });
        }
    };

    const userIcon = new L.divIcon({
        className: 'user-location-marker',
        html: `<div style="background-color: #3b82f6; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });

    return (
        <>
            <div className="leaflet-top leaflet-right" style={{ top: 'calc(env(safe-area-inset-top, 20px) + 60px)', right: '10px' }}>
                <div className="leaflet-control leaflet-bar" style={{ border: 'none', boxShadow: 'var(--shadow-md)', borderRadius: 'var(--radius-md)' }}>
                    <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); locate(); }}
                        style={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            width: '34px',
                            height: '34px',
                            backgroundColor: locating ? '#e2e8f0' : 'var(--surface-color)',
                            color: 'var(--primary-color)',
                            textDecoration: 'none',
                            borderRadius: 'var(--radius-md)'
                        }}
                        title="Meinen Standort finden"
                    >
                        <LocateFixed size={20} />
                    </a>
                </div>
            </div>

            {position && (
                <Marker position={position} icon={userIcon} interactive={false} zIndexOffset={1000} />
            )}
        </>
    );
}

export default function Map({ nests, onNestSelect, onMapClick, onVisibleNestsChange }) {
    // Center of Hamburg as default if location is unavailable
    const defaultCenter = [53.5511, 9.9937];

    return (
        <MapContainer
            center={defaultCenter}
            zoom={12}
            zoomControl={false} // We can position it manually or leave it out for mobile
            style={{ height: '100%', width: '100%' }}
            maxZoom={24}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={24}
                maxNativeZoom={19}
            />

            <LocateUserControl />
            <MapInteraction onMapClick={onMapClick} nests={nests} onVisibleNestsChange={onVisibleNestsChange} />

            {/* Render existing Nests */}
            {nests.map((nest) => (
                <Marker
                    key={nest.id}
                    position={[nest.lat, nest.lng]}
                    icon={createCustomIcon(getMarkerColor(nest), nest.isLoading)}
                    eventHandlers={{
                        click: (e) => {
                            L.DomEvent.stopPropagation(e); // Prevent map click event
                            onNestSelect(nest);
                        },
                    }}
                />
            ))}
        </MapContainer>
    );
}
