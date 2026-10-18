import { isGridCached, saveCachedPOIs } from './db';
import { API_BASE_URL } from './nestService';
import { isOverpassEnabled } from './settingsService';

export const PRELOAD_MIN_ZOOM = 14;
export const GRID_SIZE = 0.005; // ~500m grid cell size
const MIN_NETWORK_INTERVAL_MS = 2500; // Fair-use: Minimum cooldown between network requests to Overpass
const DEBOUNCE_DELAY_MS = 800; // Debounce after user stops moving/zooming map

let preloadTimeout = null;
let isPreloading = false;
let pendingPreload = null;
let lastNetworkRequestTime = 0;

const overpassEndpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter'
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
 * Preload POIs for the given bounds respecting Overpass API rate limits and local cache.
 */
export const preloadOverpassDataForBounds = async (bounds, zoom) => {
    if (!isOverpassEnabled()) return;
    if (!navigator.onLine) return;
    if (zoom < PRELOAD_MIN_ZOOM) return;

    // If an Overpass request is already active, queue this latest viewport so it isn't dropped
    if (isPreloading) {
        pendingPreload = { bounds, zoom };
        return;
    }

    // Safety clamp: keep queries compact (~3km x 3km box centered on viewport) to minimize Overpass server load
    const center = bounds.getCenter();
    const maxHalfLat = 0.015; // ~1.6km
    const maxHalfLng = 0.025; // ~1.6km
    const s = Math.max(bounds.getSouth(), center.lat - maxHalfLat);
    const n = Math.min(bounds.getNorth(), center.lat + maxHalfLat);
    const w = Math.max(bounds.getWest(), center.lng - maxHalfLng);
    const e = Math.min(bounds.getEast(), center.lng + maxHalfLng);

    const gridKeys = getGridKeysForBounds(s, w, n, e);

    // Check which grid cells are already cached in IndexedDB
    const uncachedGridKeys = [];
    for (const gk of gridKeys) {
        const cached = await isGridCached(gk);
        if (!cached) {
            uncachedGridKeys.push(gk);
        }
    }

    // 100% of visible area is already in local cache -> no network request needed!
    if (uncachedGridKeys.length === 0) {
        return;
    }

    // Micro-pan protection: if center cell is already cached and <25% of visible cells are uncached, skip
    const centerKey = getGridKey(center.lat, center.lng);
    const isCenterCached = await isGridCached(centerKey);
    if (isCenterCached && (uncachedGridKeys.length / gridKeys.length < 0.25)) {
        return;
    }

    // Rate-limiting: enforce minimum delay between successive Overpass API calls
    const now = Date.now();
    const elapsed = now - lastNetworkRequestTime;
    if (elapsed < MIN_NETWORK_INTERVAL_MS) {
        const remainingDelay = MIN_NETWORK_INTERVAL_MS - elapsed;
        if (preloadTimeout) clearTimeout(preloadTimeout);
        preloadTimeout = setTimeout(() => {
            preloadOverpassDataForBounds(bounds, zoom);
        }, remainingDelay);
        return;
    }

    isPreloading = true;
    lastNetworkRequestTime = Date.now();

    try {
        // Fetch POIs for automatic nest naming (amenities, shops, tourism, leisure, etc.)
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

        // 1. Try server-side proxy first (same-origin, handles CORS, file-caches for 15m)
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
        if (!data || !data.elements || data.elements.length === 0) {
            for (const ep of overpassEndpoints) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 8000);

                    const response = await fetch(`${ep}?data=${encodeURIComponent(query)}`, {
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (response.ok) {
                        const parsed = await response.json();
                        if (parsed && Array.isArray(parsed.elements) && parsed.elements.length > 0) {
                            data = parsed;
                            break;
                        }
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

            // Save POIs and mark grid cells as cached in IndexedDB
            await saveCachedPOIs(pois, uncachedGridKeys);
        }
    } catch (e) {
        console.debug('Background Overpass preload skipped:', e);
    } finally {
        isPreloading = false;

        // If user changed viewport while query was in-flight, process the latest view with cooldown
        if (pendingPreload) {
            const next = pendingPreload;
            pendingPreload = null;
            const remainingDelay = Math.max(200, MIN_NETWORK_INTERVAL_MS - (Date.now() - lastNetworkRequestTime));
            if (preloadTimeout) clearTimeout(preloadTimeout);
            preloadTimeout = setTimeout(() => {
                preloadOverpassDataForBounds(next.bounds, next.zoom);
            }, remainingDelay);
        }
    }
};

/**
 * Debounced trigger when the map moves or zooms.
 */
export const scheduleOverpassPreload = (map, immediate = false) => {
    if (!isOverpassEnabled()) return;
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
        preloadTimeout = setTimeout(run, 150);
    } else {
        preloadTimeout = setTimeout(run, DEBOUNCE_DELAY_MS);
    }
};
