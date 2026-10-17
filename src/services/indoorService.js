import { getDB } from './db';
import { API_BASE_URL } from './nestService';

/**
 * Convert Overpass 'out geom;' elements into a GeoJSON FeatureCollection.
 */
export const osmGeomToGeoJson = (elements) => {
    const features = [];

    for (const el of elements) {
        if (!el.tags) continue;

        const level = el.tags.level || '0';
        const properties = {
            id: el.id,
            level: String(level),
            ...el.tags
        };

        if (el.type === 'node' && el.lat && el.lon) {
            features.push({
                type: 'Feature',
                properties,
                geometry: {
                    type: 'Point',
                    coordinates: [el.lon, el.lat]
                }
            });
        } else if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
            const coords = el.geometry.map(pt => [pt.lon, pt.lat]);
            const isClosed = coords.length > 3 &&
                coords[0][0] === coords[coords.length - 1][0] &&
                coords[0][1] === coords[coords.length - 1][1];

            // If closed polygon (room, parking space, corridor)
            if (isClosed || el.tags.indoor === 'room' || el.tags.indoor === 'area' || el.tags.amenity === 'parking_space') {
                const ring = isClosed ? coords : [...coords, coords[0]];
                features.push({
                    type: 'Feature',
                    properties,
                    geometry: {
                        type: 'Polygon',
                        coordinates: [ring]
                    }
                });
            } else {
                features.push({
                    type: 'Feature',
                    properties,
                    geometry: {
                        type: 'LineString',
                        coordinates: coords
                    }
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
 * Fetch and cache OSM indoor features for a given bounding box.
 */
export const fetchIndoorGeoJson = async (bounds) => {
    // bounds: { getSouth(), getWest(), getNorth(), getEast() }
    const s = bounds.getSouth();
    const w = bounds.getWest();
    const n = bounds.getNorth();
    const e = bounds.getEast();

    const cacheKey = `indoor_${s.toFixed(3)}_${w.toFixed(3)}_${n.toFixed(3)}_${e.toFixed(3)}`;

    // 1. Check IndexedDB cache
    try {
        const db = await getDB();
        if (db.objectStoreNames.contains('overpass_cache')) {
            const cached = await db.get('overpass_cache', cacheKey);
            if (cached && cached.geoJson) {
                return cached.geoJson;
            }
        }
    } catch {
        // continue
    }

    // If offline and no cache, return empty
    if (!navigator.onLine) {
        return { type: 'FeatureCollection', features: [] };
    }

    const query = `
        [out:json][timeout:10];
        (
            way["indoor"](${s},${w},${n},${e});
            way["amenity"="parking_space"](${s},${w},${n},${e});
            way["parking"](${s},${w},${n},${e});
            node["indoor"](${s},${w},${n},${e});
            node["highway"="elevator"](${s},${w},${n},${e});
            node["highway"="steps"](${s},${w},${n},${e});
        );
        out geom;
    `;

    let data = null;

    // 1. Try server-side proxy first
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${API_BASE_URL}/overpass.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
            data = await res.json();
        }
    } catch {
        // Fallback below
    }

    // 2. Direct mirror fallback
    if (!data || !data.elements) {
        const endpoints = [
            'https://overpass.osm.ch/api/interpreter',
            'https://overpass.private.coffee/api/interpreter',
            'https://lz4.overpass-api.de/api/interpreter',
            'https://overpass-api.de/api/interpreter'
        ];

        for (const ep of endpoints) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);

                const res = await fetch(`${ep}?data=${encodeURIComponent(query)}`, {
                    signal: controller.signal
                });
                clearTimeout(timeout);

                if (res.ok) {
                    data = await res.json();
                    break;
                }
            } catch {
                // try next endpoint
            }
        }
    }

    if (data && data.elements) {
        const geoJson = osmGeomToGeoJson(data.elements);

        // Cache in IndexedDB
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

        return geoJson;
    }

    return { type: 'FeatureCollection', features: [] };
};
