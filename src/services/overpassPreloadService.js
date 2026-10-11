import { isGridCached, saveCachedPOIs } from './db';
import { fetchIndoorGeoJson } from './indoorService';
import { API_BASE_URL } from './nestService';

export const PRELOAD_MIN_ZOOM = 14;
export const GRID_SIZE = 0.005; // ~500m grid cell size
let preloadTimeout = null;
let isPreloading = false;

const overpassEndpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter'
];

/**
 * Calculate standard grid key for a coordinate.
 */
export const getGridKey = (lat, lng) => {
    const gridLat = Math.floor(lat / GRID_SIZE) * GRID_SIZE;
    const gridLng = Math.floor(lng / GRID_SIZE) * GRID_SIZE;
    return `${gridLat.toFixed(3)},${gridLng.toFixed(3)}`;
};

/**
 * Calculate list of grid keys for a given bounding box.
 */
const getGridKeysForBounds = (s, w, n, e) => {
    const minLat = Math.floor(s / GRID_SIZE) * GRID_SIZE;
    const maxLat = Math.floor(n / GRID_SIZE) * GRID_SIZE;
    const minLng = Math.floor(w / GRID_SIZE) * GRID_SIZE;
    const maxLng = Math.floor(e / GRID_SIZE) * GRID_SIZE;

    const keys = [];
    for (let lat = minLat; lat <= maxLat + 0.0001; lat += GRID_SIZE) {
        for (let lng = minLng; lng <= maxLng + 0.0001; lng += GRID_SIZE) {
            keys.push(`${lat.toFixed(3)},${lng.toFixed(3)}`);
        }
    }
    return keys;
};

/**
 * Preload POIs and indoor features for the given bounds.
 */
export const preloadOverpassDataForBounds = async (bounds, zoom) => {
    if (!navigator.onLine) return;
    if (zoom < PRELOAD_MIN_ZOOM) return;
    if (isPreloading) return;

    // Safety clamp: if bounds are large (wide screen or zoom 14), clamp around center (~3.5km x 3.5km)
    const center = bounds.getCenter();
    const maxHalfLat = 0.02; // ~2.2km
    const maxHalfLng = 0.035; // ~2.3km
    const s = Math.max(bounds.getSouth(), center.lat - maxHalfLat);
    const n = Math.min(bounds.getNorth(), center.lat + maxHalfLat);
    const w = Math.max(bounds.getWest(), center.lng - maxHalfLng);
    const e = Math.min(bounds.getEast(), center.lng + maxHalfLng);

    const gridKeys = getGridKeysForBounds(s, w, n, e);

    // Check which grid cells are not cached yet
    const uncachedGridKeys = [];
    for (const gk of gridKeys) {
        const cached = await isGridCached(gk);
        if (!cached) {
            uncachedGridKeys.push(gk);
        }
    }

    if (uncachedGridKeys.length === 0) {
        // Entire area is already cached!
        return;
    }

    isPreloading = true;

    try {
        // 1. Concurrently prefetch indoor features for this area (parking decks, elevators, corridors)
        fetchIndoorGeoJson(bounds).catch(() => {});

        // 2. Fetch POIs for automatic nest naming (amenities, shops, tourism, leisure, etc.)
        const query = `
            [out:json][timeout:15];
            (
                node["amenity"]["name"](${s},${w},${n},${e});
                way["amenity"]["name"](${s},${w},${n},${e});
                node["shop"]["name"](${s},${w},${n},${e});
                way["shop"]["name"](${s},${w},${n},${e});
                node["tourism"]["name"](${s},${w},${n},${e});
                way["tourism"]["name"](${s},${w},${n},${e});
                node["leisure"]["name"](${s},${w},${n},${e});
                way["leisure"]["name"](${s},${w},${n},${e});
                node["historic"]["name"](${s},${w},${n},${e});
                way["historic"]["name"](${s},${w},${n},${e});
                node["railway"]["name"](${s},${w},${n},${e});
                way["railway"]["name"](${s},${w},${n},${e});
                node["public_transport"]["name"](${s},${w},${n},${e});
                way["public_transport"]["name"](${s},${w},${n},${e});
                node["highway"="bus_stop"]["name"](${s},${w},${n},${e});
            );
            out center;
        `;

        let data = null;

        // 1. Try server-side proxy first
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);

            const response = await fetch(`${API_BASE_URL}/overpass.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                data = await response.json();
            }
        } catch {
            // Fallback below
        }

        // 2. Direct fallback
        if (!data || !data.elements) {
            const fallbackEndpoints = [
                'https://overpass-api.de/api/interpreter',
                'https://z.overpass-api.de/api/interpreter',
                'https://lz4.overpass-api.de/api/interpreter'
            ];

            for (const ep of fallbackEndpoints) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);

                    const response = await fetch(`${ep}?data=${encodeURIComponent(query)}`, {
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (response.ok) {
                        data = await response.json();
                        break;
                    }
                } catch {
                    // Try next endpoint silently
                }
            }
        }

        if (data && Array.isArray(data.elements)) {
            const pois = [];
            for (const el of data.elements) {
                const hasExplicitName = !!el.tags?.name;
                const name = el.tags?.name || el.tags?.amenity;

                const lat = el.lat || el.center?.lat;
                const lng = el.lon || el.center?.lon;

                if (name && typeof lat === 'number' && typeof lng === 'number') {
                    pois.push({
                        id: el.id,
                        name,
                        isNamed: hasExplicitName,
                        lat,
                        lng,
                        type: 'poi'
                    });
                }
            }

            // Save POIs and mark grid cells as cached
            await saveCachedPOIs(pois, uncachedGridKeys);
        }
    } catch (e) {
        console.debug('Background Overpass preload skipped:', e);
    } finally {
        isPreloading = false;
    }
};

/**
 * Debounced trigger when the map moves or zooms.
 */
export const scheduleOverpassPreload = (map, immediate = false) => {
    if (!navigator.onLine) return;
    if (!map) return;

    if (preloadTimeout) {
        clearTimeout(preloadTimeout);
    }

    const run = () => {
        try {
            const zoom = map.getZoom();
            if (zoom >= PRELOAD_MIN_ZOOM) {
                preloadOverpassDataForBounds(map.getBounds(), zoom);
            }
        } catch {
            // Map might be unmounted
        }
    };

    if (immediate) {
        run();
    } else {
        preloadTimeout = setTimeout(run, 350);
    }
};
