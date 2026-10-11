import { useState, useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreglWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { LocateFixed } from 'lucide-react';

// Configure Web Worker URL for Vite
maplibregl.setWorkerUrl(maplibreglWorkerUrl);

// Default vector style: VersaTiles Colorful (Free OSM vector tiles hosted by OSM/FOSSGIS community)
// Can be customized via VITE_MAP_STYLE_URL in .env
const DEFAULT_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.versatiles.org/assets/styles/colorful/style.json';

// Center of Hamburg as default [lng, lat]
const DEFAULT_CENTER = [9.9937, 53.5511];

// Map colors to nest actions
const getMarkerColor = (nest) => {
    if (!nest.logs || nest.logs.length === 0) return '#3b82f6'; // Blue for new nest

    // Find latest action changing nest status
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
    if (latestAction.startsWith('Küken')) return '#f9a8d4'; // Pastel Pink
    if (latestAction.startsWith('Eier zu weit')) return '#f97316'; // Orange
    if (latestAction.startsWith('Nest verlassen')) return '#a855f7'; // Purple

    return '#3b82f6'; // Fallback to Blue
};

const getMarkerSvgHtml = (color, isLoading = false) => {
    const loadingClass = isLoading ? 'marker-loading' : '';
    return `
        <svg class="${loadingClass}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="42" fill="${color}" stroke="white" stroke-width="2" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.3)); display: block; pointer-events: none;">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
    `;
};

const createMarkerElement = (color, isLoading = false) => {
    const el = document.createElement('div');
    el.className = 'custom-maplibre-marker';
    el.style.width = '32px';
    el.style.height = '42px';
    el.style.cursor = 'pointer';
    el.innerHTML = getMarkerSvgHtml(color, isLoading);
    return el;
};

export default function MapView({ nests = [], onNestSelect, onMapClick, onVisibleNestsChange }) {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const markersRef = useRef(new Map());
    const nestsMapRef = useRef(new Map());
    const userMarkerRef = useRef(null);
    const hasInitialCenteredRef = useRef(false);

    const [userPos, setUserPos] = useState(null);
    const [locating, setLocating] = useState(false);

    const onMapClickRef = useRef(onMapClick);
    const onNestSelectRef = useRef(onNestSelect);
    const onVisibleNestsChangeRef = useRef(onVisibleNestsChange);
    const nestsRef = useRef(nests);

    // Keep callbacks and nests ref updated
    useEffect(() => {
        onMapClickRef.current = onMapClick;
        onNestSelectRef.current = onNestSelect;
        onVisibleNestsChangeRef.current = onVisibleNestsChange;
        nestsRef.current = nests;
    });

    // Helper to calculate & notify visible nests
    const updateVisibleNests = (currentList) => {
        if (!mapRef.current || !onVisibleNestsChangeRef.current) return;
        const map = mapRef.current;
        const bounds = map.getBounds();
        const list = currentList || nestsRef.current || [];
        const visible = list.filter(nest => bounds.contains([nest.lng, nest.lat]));
        onVisibleNestsChangeRef.current(visible);
    };

    // 1. Initialize MapLibre GL
    useEffect(() => {
        if (!mapContainerRef.current) return;

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: DEFAULT_STYLE_URL,
            center: DEFAULT_CENTER,
            zoom: 12,
            maxZoom: 22,
            attributionControl: false
        });

        // Add attribution control in bottom right
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

        // Capture map clicks (e.g. for adding/moving nests)
        // IMPORTANT: Ignore if click originated on a marker
        map.on('click', (e) => {
            const originalTarget = e.originalEvent?.target;
            if (
                originalTarget &&
                (originalTarget.closest('.custom-maplibre-marker') ||
                 originalTarget.closest('.maplibregl-marker') ||
                 originalTarget.closest('.user-location-marker'))
            ) {
                return; // User clicked on a marker; do not deselect nest or trigger map click
            }

            if (onMapClickRef.current) {
                onMapClickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
            }
        });

        // Trigger visible nests change on pan/zoom
        const handleBoundsChange = () => updateVisibleNests();
        map.on('moveend', handleBoundsChange);
        map.on('zoomend', handleBoundsChange);

        // Add 3D building extrusion layer once style is loaded (if vector source supports it)
        map.on('load', () => {
            updateVisibleNests();

            const layers = map.getStyle().layers || [];
            const labelLayerId = layers.find(
                (l) => l.type === 'symbol' && l.layout && l.layout['text-field']
            )?.id;

            // Optional 3D buildings when zooming in (pitch/tilt enabled)
            if (map.getSource('openmaptiles') && !map.getLayer('3d-buildings')) {
                map.addLayer(
                    {
                        id: '3d-buildings',
                        source: 'openmaptiles',
                        'source-layer': 'building',
                        type: 'fill-extrusion',
                        minzoom: 15,
                        paint: {
                            'fill-extrusion-color': '#d1d5db',
                            'fill-extrusion-height': [
                                'interpolate', ['linear'], ['zoom'],
                                15, 0,
                                16, ['get', 'render_height']
                            ],
                            'fill-extrusion-base': [
                                'interpolate', ['linear'], ['zoom'],
                                15, 0,
                                16, ['get', 'render_min_height']
                            ],
                            'fill-extrusion-opacity': 0.6
                        }
                    },
                    labelLayerId
                );
            }
        });

        mapRef.current = map;
        const markers = markersRef.current;

        return () => {
            markers.forEach(marker => marker.remove());
            markers.clear();
            if (userMarkerRef.current) {
                userMarkerRef.current.remove();
                userMarkerRef.current = null;
            }
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // 2. Geolocation tracking
    useEffect(() => {
        if (!('geolocation' in navigator)) return;

        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { longitude, latitude } = pos.coords;
                setUserPos({ lng: longitude, lat: latitude });

                if (!mapRef.current) return;

                if (!userMarkerRef.current) {
                    const el = document.createElement('div');
                    el.className = 'user-location-marker';
                    el.style.backgroundColor = '#3b82f6';
                    el.style.width = '16px';
                    el.style.height = '16px';
                    el.style.borderRadius = '50%';
                    el.style.border = '3px solid white';
                    el.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';
                    el.style.pointerEvents = 'none';

                    userMarkerRef.current = new maplibregl.Marker({ element: el })
                        .setLngLat([longitude, latitude])
                        .addTo(mapRef.current);
                } else {
                    userMarkerRef.current.setLngLat([longitude, latitude]);
                }

                if (!hasInitialCenteredRef.current) {
                    mapRef.current.setCenter([longitude, latitude]);
                    mapRef.current.setZoom(15);
                    hasInitialCenteredRef.current = true;
                }
            },
            (err) => {
                console.warn('Geolocation watch error:', err);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
        );

        return () => {
            navigator.geolocation.clearWatch(watchId);
        };
    }, []);

    // 3. Sync Nest Markers & Data
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Keep fresh nest lookup map for click callbacks
        nestsMapRef.current = new Map(nests.map(n => [n.id, n]));

        const currentMarkerIds = new Set();

        nests.forEach((nest) => {
            currentMarkerIds.add(nest.id);
            const color = getMarkerColor(nest);
            const existingMarker = markersRef.current.get(nest.id);

            if (existingMarker) {
                // Update position in case it changed (e.g. moved nest)
                existingMarker.setLngLat([nest.lng, nest.lat]);
                // Re-render SVG to reflect updated logs, egg swap status, or loading state
                const el = existingMarker.getElement();
                el.innerHTML = getMarkerSvgHtml(color, nest.isLoading);
            } else {
                // Create new marker DOM element
                const el = createMarkerElement(color, nest.isLoading);

                // Stop interaction events from propagating to map container
                ['pointerdown', 'mousedown', 'touchstart'].forEach(evt => {
                    el.addEventListener(evt, (e) => e.stopPropagation());
                });

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Always retrieve freshest nest data from map ref
                    const freshNest = nestsMapRef.current.get(nest.id) || nest;
                    if (onNestSelectRef.current) {
                        onNestSelectRef.current(freshNest);
                    }
                });

                const marker = new maplibregl.Marker({
                    element: el,
                    anchor: 'bottom'
                })
                    .setLngLat([nest.lng, nest.lat])
                    .addTo(map);

                markersRef.current.set(nest.id, marker);
            }
        });

        // Remove obsolete markers
        markersRef.current.forEach((marker, id) => {
            if (!currentMarkerIds.has(id)) {
                marker.remove();
                markersRef.current.delete(id);
            }
        });

        // Re-calculate visible nests with updated list
        updateVisibleNests(nests);
    }, [nests]);

    // Handle Locate Button Click
    const handleLocateClick = (e) => {
        e.preventDefault();
        setLocating(true);

        if (userPos && mapRef.current) {
            mapRef.current.flyTo({
                center: [userPos.lng, userPos.lat],
                zoom: 19,
                essential: true
            });
            setLocating(false);
        } else if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { longitude, latitude } = pos.coords;
                    setUserPos({ lng: longitude, lat: latitude });
                    mapRef.current?.flyTo({
                        center: [longitude, latitude],
                        zoom: 19,
                        essential: true
                    });
                    setLocating(false);
                },
                (err) => {
                    console.error('Locate error:', err);
                    setLocating(false);
                    alert('Standort konnte nicht ermittelt werden.');
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        } else {
            setLocating(false);
        }
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

            {/* Locate User Control button */}
            <div
                style={{
                    position: 'absolute',
                    top: 'calc(env(safe-area-inset-top, 20px) + 60px)',
                    right: '10px',
                    zIndex: 10
                }}
            >
                <div
                    style={{
                        border: 'none',
                        boxShadow: 'var(--shadow-md)',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden'
                    }}
                >
                    <a
                        href="#"
                        onClick={handleLocateClick}
                        style={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            width: '34px',
                            height: '34px',
                            backgroundColor: locating ? '#e2e8f0' : 'var(--surface-color)',
                            color: 'var(--primary-color)',
                            textDecoration: 'none'
                        }}
                        title="Meinen Standort finden"
                    >
                        <LocateFixed size={20} />
                    </a>
                </div>
            </div>
        </div>
    );
}
