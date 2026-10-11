import { isGridCached, saveCachedPOIs } from './db';
import { fetchIndoorGeoJson } from './indoorService';

export const PRELOAD_MIN_ZOOM = 16;
const GRID_SIZE = 0.005; // ~500m grid cell size
let preloadTimeout = null;
let isPreloading = false;

const overpassEndpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter'
];

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

    const s = bounds.getSouth();
    const w = bounds.getWest();
    const n = bounds.getNorth();
    const e = bounds.getEast();

    // Check if bounds are unusually large (safety guard)
    if (n - s > 0.05 || e - w > 0.05) return;

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

        // 2. Fetch POIs & Address points for automatic nest naming
        const query = `
            [out:json][timeout:12];
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
                node["addr:housenumber"]["addr:street"](${s},${w},${n},${e});
                way["addr:housenumber"]["addr:street"](${s},${w},${n},${e});
            );
            out center;
        `;

        const shuffledEndpoints = [...overpassEndpoints].sort(() => Math.random() - 0.5);
        let data = null;

        for (const ep of shuffledEndpoints) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 7000);

                const response = await fetch(ep, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' },
                    body: query,
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

        if (data && data.elements) {
            const pois = [];
            for (const el of data.elements) {
                const hasExplicitName = !!el.tags?.name;
                let name = el.tags?.name || el.tags?.amenity;
                if (!name && el.tags?.['addr:street']) {
                    name = `${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}`.trim();
                }

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
        } else {
            // Even if empty or no elements, mark grids so we don't spam Overpass in empty areas
            await saveCachedPOIs([], uncachedGridKeys);
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
export const scheduleOverpassPreload = (map) => {
    if (!navigator.onLine) return;
    if (!map) return;

    if (preloadTimeout) {
        clearTimeout(preloadTimeout);
    }

    preloadTimeout = setTimeout(() => {
        try {
            const zoom = map.getZoom();
            if (zoom >= PRELOAD_MIN_ZOOM) {
                preloadOverpassDataForBounds(map.getBounds(), zoom);
            }
        } catch {
            // Map might be unmounted
        }
    }, 1500);
};
