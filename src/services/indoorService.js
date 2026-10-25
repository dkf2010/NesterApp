import { getDB } from './db';
import { API_BASE_URL } from './nestService';
import { isOverpassEnabled } from './settingsService';

export const INDOOR_MIN_ZOOM = 16;
const GRID_SNAP = 0.005; // ~500m fixed grid for reliable cache hits

/**
 * Convert Overpass 'out geom;' elements into a GeoJSON FeatureCollection.
 */
export const osmGeomToGeoJson = (elements) => {
    const features = [];

    for (const el of elements) {
        if (!el.tags) continue;

        const level = el.tags.level !== undefined ? String(el.tags.level) : '0';
        const properties = {
            id: el.id,
            level: String(level),
            ...el.tags
        };

        if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
            const lon = Number(el.lon.toFixed(6));
            const lat = Number(el.lat.toFixed(6));
            features.push({
                type: 'Feature',
                properties,
                geometry: {
                    type: 'Point',
                    coordinates: [lon, lat]
                },
                bbox: [lon, lat, lon, lat]
            });
        } else if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
            const coords = el.geometry.map(pt => [Number(pt.lon.toFixed(6)), Number(pt.lat.toFixed(6))]);
            const isClosed = coords.length > 3 &&
                coords[0][0] === coords[coords.length - 1][0] &&
                coords[0][1] === coords[coords.length - 1][1];

            let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
            for (const [lon, lat] of coords) {
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            }

            const isRoom = el.tags.indoor === 'room' || el.tags.indoor === 'area';
            const isParking = el.tags.amenity === 'parking_space' || !!el.tags.parking;

            if (isClosed || isRoom || isParking) {
                const ring = isClosed ? coords : [...coords, coords[0]];
                features.push({
                    type: 'Feature',
                    properties,
                    geometry: {
                        type: 'Polygon',
                        coordinates: [ring]
                    },
                    bbox: [minLon, minLat, maxLon, maxLat]
                });
            } else {
                features.push({
                    type: 'Feature',
                    properties,
                    geometry: {
                        type: 'LineString',
                        coordinates: coords
                    },
                    bbox: [minLon, minLat, maxLon, maxLat]
                });
            }
        }
    }

    return {
        type: 'FeatureCollection',
        features
    };
};

/**
 * Filter features from a full GeoJSON collection by bounding box.
 */
const filterGeoJsonByBounds = (geoJson, s, w, n, e) => {
    if (!geoJson || !Array.isArray(geoJson.features)) return { type: 'FeatureCollection', features: [] };
    const pad = 0.0005;
    const bs = s - pad;
    const bw = w - pad;
    const bn = n + pad;
    const be = e + pad;

    const matched = geoJson.features.filter(f => {
        if (f.bbox) {
            const [minLon, minLat, maxLon, maxLat] = f.bbox;
            return !(minLat > bn || maxLat < bs || minLon > be || maxLon < bw);
        }
        if (f.geometry?.type === 'Point') {
            const [lon, lat] = f.geometry.coordinates;
            return lat >= bs && lat <= bn && lon >= bw && lon <= be;
        }
        return true;
    });

    return {
        type: 'FeatureCollection',
        features: matched
    };
};

/**
 * Fetch and cache OSM indoor features for a given bounding box.
 * Automatically checks:
 * 1. Zoom level (minimum zoom 16 required to prevent massive Overpass queries)
 * 2. Local complete Hamburg offline dataset in IndexedDB
 * 3. Grid-snapped IndexedDB cache
 * 4. High-speed backend/api/indoor.php endpoint (~15ms)
 * 5. Direct multi-mirror Overpass fallback (FR, DE, LZ4, Z)
 */
export const fetchIndoorGeoJson = async (bounds, zoom = 16) => {
    if (zoom < INDOOR_MIN_ZOOM) {
        return { type: 'FeatureCollection', features: [], zoomTooLow: true };
    }

    const s = bounds.getSouth();
    const w = bounds.getWest();
    const n = bounds.getNorth();
    const e = bounds.getEast();

    // Snap to grid multiples so panning by a few meters hits the same cache
    const gridS = Math.floor(s / GRID_SNAP) * GRID_SNAP;
    const gridW = Math.floor(w / GRID_SNAP) * GRID_SNAP;
    const gridN = Math.ceil(n / GRID_SNAP) * GRID_SNAP;
    const gridE = Math.ceil(e / GRID_SNAP) * GRID_SNAP;

    const cacheKey = `indoor_${gridS.toFixed(3)}_${gridW.toFixed(3)}_${gridN.toFixed(3)}_${gridE.toFixed(3)}`;

    // 1. Check IndexedDB for complete Hamburg offline dataset
    try {
        const db = await getDB();
        if (db.objectStoreNames.contains('overpass_cache')) {
            const completeHamburg = await db.get('overpass_cache', 'indoor_hamburg_complete');
            if (completeHamburg && completeHamburg.geoJson) {
                const filtered = filterGeoJsonByBounds(completeHamburg.geoJson, s, w, n, e);
                if (filtered.features.length > 0) {
                    return filtered;
                }
            }

            // 2. Check grid-snapped IndexedDB cache
            const cached = await db.get('overpass_cache', cacheKey);
            if (cached && cached.geoJson && Array.isArray(cached.geoJson.features) && cached.geoJson.features.length > 0) {
                return cached.geoJson;
            }
        }
    } catch {
        // proceed
    }

    // If Overpass is explicitly disabled and no cache hit, return empty
    if (!isOverpassEnabled()) {
        return { type: 'FeatureCollection', features: [] };
    }

    // If offline and no cache hit, return empty
    if (!navigator.onLine) {
        return { type: 'FeatureCollection', features: [], isOffline: true };
    }

    let geoJson = null;

    // 3. Try high-performance backend endpoint first (serves pre-cached Hamburg data or server grid cache)
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(`${API_BASE_URL}/indoor.php?bbox=${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`, {
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.features)) {
                geoJson = data;
            }
        }
    } catch {
        // Fallback below
    }

    // 4. Fallback: Query via server-side Overpass proxy (overpass.php)
    if (!geoJson) {
        const query = `
            [out:json][timeout:15];
            (
                way["indoor"](${gridS.toFixed(4)},${gridW.toFixed(4)},${gridN.toFixed(4)},${gridE.toFixed(4)});
                way["amenity"="parking_space"](${gridS.toFixed(4)},${gridW.toFixed(4)},${gridN.toFixed(4)},${gridE.toFixed(4)});
                way["parking"](${gridS.toFixed(4)},${gridW.toFixed(4)},${gridN.toFixed(4)},${gridE.toFixed(4)});
                node["indoor"](${gridS.toFixed(4)},${gridW.toFixed(4)},${gridN.toFixed(4)},${gridE.toFixed(4)});
                node["highway"="elevator"](${gridS.toFixed(4)},${gridW.toFixed(4)},${gridN.toFixed(4)},${gridE.toFixed(4)});
                node["highway"="steps"](${gridS.toFixed(4)},${gridW.toFixed(4)},${gridN.toFixed(4)},${gridE.toFixed(4)});
            );
            out geom;
        `;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);

            const res = await fetch(`${API_BASE_URL}/overpass.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (res.ok) {
                const parsed = await res.json();
                if (parsed && Array.isArray(parsed.elements)) {
                    geoJson = osmGeomToGeoJson(parsed.elements);
                }
            }
        } catch {
            // Fallback below
        }

        // 5. Final fallback: Direct mirror queries (FR, DE, LZ4, Z)
        if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
            const endpoints = [
                'https://overpass.openstreetmap.fr/api/interpreter',
                'https://overpass-api.de/api/interpreter',
                'https://lz4.overpass-api.de/api/interpreter',
                'https://z.overpass-api.de/api/interpreter'
            ];

            for (const ep of endpoints) {
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);

                    const res = await fetch(`${ep}?data=${encodeURIComponent(query)}`, {
                        signal: controller.signal
                    });
                    clearTimeout(timeout);

                    if (res.ok) {
                        const parsed = await res.json();
                        if (parsed && Array.isArray(parsed.elements) && parsed.elements.length > 0) {
                            geoJson = osmGeomToGeoJson(parsed.elements);
                            break;
                        }
                    }
                } catch {
                    // try next endpoint
                }
            }
        }
    }

    if (geoJson && Array.isArray(geoJson.features)) {
        // Cache in IndexedDB if features were found
        if (geoJson.features.length > 0) {
            try {
                const db = await getDB();
                if (db.objectStoreNames.contains('overpass_cache')) {
                    await db.put('overpass_cache', {
                        key: cacheKey,
                        geoJson,
                        timestamp: Date.now()
                    });
                }
            } catch {
                // ignore cache write error
            }
        }
        return geoJson;
    }

    return { type: 'FeatureCollection', features: [] };
};

let lastVersionCheck = 0;
let lastServerVersion = null;

/**
 * Fetch indoor data version info from backend.
 * @param {boolean} force - Force network check even if recently checked
 * @returns {Promise<{ version: string, generated_at?: string, etag?: string, mtime?: number } | null>}
 */
export const fetchServerIndoorVersion = async (force = false) => {
    if (!navigator.onLine) return null;

    const now = Date.now();
    // Cache version check result for 60 seconds unless forced
    if (!force && lastServerVersion && now - lastVersionCheck < 60000) {
        return lastServerVersion;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${API_BASE_URL}/indoor.php?action=version`, {
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            if (data && (data.version || data.etag || data.generated_at)) {
                lastVersionCheck = now;
                lastServerVersion = data;
                return data;
            }
        }
    } catch (e) {
        console.debug('Failed to check server indoor version:', e);
    }
    return null;
};

/**
 * Retrieve cached complete Hamburg indoor dataset and its metadata from IndexedDB.
 */
export const getLocalIndoorData = async () => {
    try {
        const db = await getDB();
        if (db.objectStoreNames.contains('overpass_cache')) {
            const entry = await db.get('overpass_cache', 'indoor_hamburg_complete');
            if (entry && entry.geoJson && Array.isArray(entry.geoJson.features) && entry.geoJson.features.length > 0) {
                const generatedAt = entry.generatedAt || entry.geoJson.generated_at || null;
                const version = entry.version || generatedAt || entry.etag || null;
                return {
                    loaded: true,
                    version,
                    generatedAt,
                    etag: entry.etag || null,
                    timestamp: entry.timestamp || null,
                    featureCount: entry.geoJson.features.length,
                    geoJson: entry.geoJson
                };
            }
        }
    } catch (e) {
        console.warn('Error reading local indoor data:', e);
    }
    return {
        loaded: false,
        version: null,
        generatedAt: null,
        etag: null,
        timestamp: null,
        featureCount: 0,
        geoJson: null
    };
};

/**
 * Check if the indoor offline data is missing or outdated compared to the server.
 * Returns { needsUpdate: boolean, reason: string, local: object, server: object | null }
 */
export const checkIndoorDataStatus = async (force = false) => {
    const local = await getLocalIndoorData();

    // 1. Not loaded yet
    if (!local.loaded) {
        return {
            needsUpdate: true,
            reason: 'missing',
            local,
            server: null
        };
    }

    // 2. Offline -> cannot check server, keep using local data
    if (!navigator.onLine) {
        return {
            needsUpdate: false,
            reason: 'offline_using_cached',
            local,
            server: null
        };
    }

    // 3. Check server version
    const server = await fetchServerIndoorVersion(force);
    if (!server) {
        // Server unreachable or timed out -> keep using local data
        return {
            needsUpdate: false,
            reason: 'server_unreachable_using_cached',
            local,
            server: null
        };
    }

    // 4. Compare version
    let isOutdated = false;
    if (server.generated_at && local.generatedAt) {
        isOutdated = server.generated_at !== local.generatedAt;
    } else if (server.etag && local.etag) {
        isOutdated = server.etag !== local.etag;
    } else if (server.version && local.version) {
        isOutdated = server.version !== local.version;
    } else if (server.version && !local.version) {
        // Local has no version metadata at all
        isOutdated = true;
    }

    if (isOutdated) {
        return {
            needsUpdate: true,
            reason: 'outdated',
            local,
            server
        };
    }

    return {
        needsUpdate: false,
        reason: 'up_to_date',
        local,
        server
    };
};

/**
 * Preload and cache complete Hamburg indoor dataset into IndexedDB for offline use.
 */
export const preloadHamburgIndoorData = async () => {
    try {
        const res = await fetch(`${API_BASE_URL}/indoor.php?action=hamburg`);
        if (res.ok) {
            const geoJson = await res.json();
            if (geoJson && Array.isArray(geoJson.features) && geoJson.features.length > 0) {
                const rawEtag = res.headers.get('ETag') || res.headers.get('X-Indoor-Version');
                const etag = rawEtag ? rawEtag.replace(/^"|"$/g, '') : null;
                const generatedAt = geoJson.generated_at || null;
                const version = generatedAt || etag || String(Date.now());

                const db = await getDB();
                if (db.objectStoreNames.contains('overpass_cache')) {
                    await db.put('overpass_cache', {
                        key: 'indoor_hamburg_complete',
                        geoJson,
                        version,
                        generatedAt,
                        etag,
                        timestamp: Date.now()
                    });
                }

                // Update server version cache
                lastServerVersion = {
                    version,
                    generated_at: generatedAt,
                    etag
                };
                lastVersionCheck = Date.now();

                return geoJson;
            }
        }
    } catch (e) {
        console.warn('Could not preload Hamburg indoor data:', e);
    }
    return null;
};

/**
 * Ensures offline indoor data is loaded and up-to-date.
 * If data is missing or outdated compared to the server version,
 * automatically downloads and caches the latest dataset into IndexedDB.
 */
export const ensureHamburgIndoorDataLoaded = async ({ onProgress, force = false } = {}) => {
    const status = await checkIndoorDataStatus(force);

    if (!status.needsUpdate) {
        return {
            success: true,
            updated: false,
            reason: status.reason,
            geoJson: status.local?.geoJson || null
        };
    }

    // Missing and offline -> cannot download
    if (!navigator.onLine && status.reason === 'missing') {
        return {
            success: false,
            updated: false,
            reason: 'offline_and_missing',
            geoJson: null
        };
    }

    if (onProgress) onProgress({ status: 'loading', reason: status.reason });

    const downloaded = await preloadHamburgIndoorData();
    if (downloaded) {
        return {
            success: true,
            updated: true,
            reason: status.reason,
            geoJson: downloaded
        };
    }

    // If download failed but we have local data, use local
    if (status.local?.geoJson) {
        return {
            success: true,
            updated: false,
            reason: 'download_failed_fallback_local',
            geoJson: status.local.geoJson
        };
    }

    return {
        success: false,
        updated: false,
        reason: 'download_failed',
        geoJson: null
    };
};
