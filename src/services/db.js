import { openDB } from 'idb';

const DB_NAME = 'nester_offline_db';
const DB_VERSION = 1;

/**
 * Open or upgrade the IndexedDB database.
 */
export const getDB = async () => {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            // 1. Nests store: stores all nests locally
            if (!db.objectStoreNames.contains('nests')) {
                db.createObjectStore('nests', { keyPath: 'id' });
            }

            // 2. Sync queue: stores offline mutation jobs
            if (!db.objectStoreNames.contains('sync_queue')) {
                const queueStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
                queueStore.createIndex('createdAt', 'createdAt');
            }

            // 3. Overpass cache: stores reverse geocoding & amenities by grid key
            if (!db.objectStoreNames.contains('overpass_cache')) {
                db.createObjectStore('overpass_cache', { keyPath: 'key' });
            }
        }
    });
};

/* ==========================================================================
   Nests Local Cache Operations
   ========================================================================== */

export const getCachedNests = async () => {
    try {
        const db = await getDB();
        return await db.getAll('nests');
    } catch (e) {
        console.error('Error getting cached nests from IndexedDB:', e);
        return [];
    }
};

export const saveCachedNests = async (nests) => {
    try {
        const db = await getDB();
        const tx = db.transaction('nests', 'readwrite');
        for (const nest of nests) {
            await tx.store.put(nest);
        }
        await tx.done;
    } catch (e) {
        console.error('Error saving cached nests to IndexedDB:', e);
    }
};

export const saveCachedNest = async (nest) => {
    try {
        const db = await getDB();
        await db.put('nests', nest);
    } catch (e) {
        console.error('Error saving single nest to IndexedDB:', e);
    }
};

export const deleteCachedNest = async (nestId) => {
    try {
        const db = await getDB();
        await db.delete('nests', nestId);
    } catch (e) {
        console.error('Error deleting nest from IndexedDB:', e);
    }
};

/* ==========================================================================
   Sync Queue (Outbox) Operations
   ========================================================================== */

export const getQueueJobs = async () => {
    try {
        const db = await getDB();
        const jobs = await db.getAllFromIndex('sync_queue', 'createdAt');
        return jobs;
    } catch (e) {
        console.error('Error getting queue jobs from IndexedDB:', e);
        return [];
    }
};

export const addQueueJob = async (job) => {
    try {
        const db = await getDB();
        await db.put('sync_queue', {
            ...job,
            id: job.id || crypto.randomUUID(),
            createdAt: job.createdAt || new Date().toISOString(),
            attempts: job.attempts || 0
        });
    } catch (e) {
        console.error('Error adding job to sync queue:', e);
    }
};

export const updateQueueJob = async (job) => {
    try {
        const db = await getDB();
        await db.put('sync_queue', job);
    } catch (e) {
        console.error('Error updating queue job in IndexedDB:', e);
    }
};

export const removeQueueJob = async (jobId) => {
    try {
        const db = await getDB();
        await db.delete('sync_queue', jobId);
    } catch (e) {
        console.error('Error removing job from sync queue:', e);
    }
};

export const getQueueLength = async () => {
    try {
        const db = await getDB();
        return await db.count('sync_queue');
    } catch {
        return 0;
    }
};

/* ==========================================================================
   Overpass Spatial Cache Operations
   ========================================================================== */

export const calculateDistanceMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

export const isGridCached = async (gridKey) => {
    try {
        const db = await getDB();
        const entry = await db.get('overpass_cache', `grid_${gridKey}`);
        if (!entry) return false;
        const maxAge = 14 * 24 * 60 * 60 * 1000;
        return (Date.now() - entry.timestamp) < maxAge;
    } catch {
        return false;
    }
};

export const saveCachedPOIs = async (pois = [], gridKeys = []) => {
    try {
        const db = await getDB();
        const tx = db.transaction('overpass_cache', 'readwrite');
        const store = tx.objectStore('overpass_cache');

        const now = Date.now();
        for (const poi of pois) {
            await store.put({
                key: `poi_${poi.id || `${poi.lat.toFixed(5)}_${poi.lng.toFixed(5)}`}`,
                name: poi.name,
                lat: poi.lat,
                lng: poi.lng,
                type: 'poi',
                timestamp: now
            });
        }

        for (const gk of gridKeys) {
            await store.put({
                key: `grid_${gk}`,
                timestamp: now,
                poiCount: pois.length
            });
        }

        await tx.done;
    } catch (e) {
        console.warn('Failed to save cached POIs in IndexedDB:', e);
    }
};

export const findNearestCachedAmenity = async (lat, lng, maxRadiusMeters = 80) => {
    try {
        const db = await getDB();
        if (!db.objectStoreNames.contains('overpass_cache')) return null;

        const all = await db.getAll('overpass_cache');
        let closest = null;
        let minDistance = Infinity;

        for (const item of all) {
            if (!item || !item.name || typeof item.lat !== 'number' || typeof item.lng !== 'number') {
                continue;
            }
            const dist = calculateDistanceMeters(lat, lng, item.lat, item.lng);
            if (dist < minDistance && dist <= maxRadiusMeters) {
                minDistance = dist;
                closest = item.name;
            }
        }
        return closest;
    } catch {
        return null;
    }
};

export const getCachedAmenity = async (key) => {
    try {
        const db = await getDB();
        const entry = await db.get('overpass_cache', key);
        if (!entry) return null;

        // Check if cache entry is still valid (14 days)
        const maxAge = 14 * 24 * 60 * 60 * 1000;
        if (Date.now() - entry.timestamp > maxAge) {
            await db.delete('overpass_cache', key);
            return null;
        }
        return entry.name;
    } catch {
        return null;
    }
};

export const setCachedAmenity = async (key, name) => {
    try {
        const db = await getDB();
        await db.put('overpass_cache', {
            key,
            name,
            timestamp: Date.now()
        });
    } catch (e) {
        console.warn('Could not cache amenity in IndexedDB:', e);
    }
};

/* ==========================================================================
   Cache Statistics & Clearing Operations
   ========================================================================== */

export const getStorageStats = async () => {
    let totalUsageBytes = 0;
    let totalQuotaBytes = 0;

    if (typeof navigator !== 'undefined' && 'storage' in navigator && 'estimate' in navigator.storage) {
        try {
            const estimate = await navigator.storage.estimate();
            totalUsageBytes = estimate.usage || 0;
            totalQuotaBytes = estimate.quota || 0;
        } catch {
            // ignore
        }
    }

    let nestsCount = 0;
    let queueCount = 0;
    let overpassCount = 0;

    try {
        const db = await getDB();
        nestsCount = await db.count('nests').catch(() => 0);
        queueCount = await db.count('sync_queue').catch(() => 0);
        overpassCount = await db.count('overpass_cache').catch(() => 0);
    } catch {
        // ignore
    }

    let tileCacheCount = 0;
    if (typeof window !== 'undefined' && 'caches' in window) {
        try {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                if (name.includes('tile') || name.includes('versatiles') || name.includes('osm')) {
                    const cache = await caches.open(name);
                    const keys = await cache.keys();
                    tileCacheCount += keys.length;
                }
            }
        } catch {
            // ignore
        }
    }

    return {
        totalUsageBytes,
        totalQuotaBytes,
        nestsCount,
        queueCount,
        overpassCount,
        tileCacheCount
    };
};

export const clearTileCache = async () => {
    if (typeof window !== 'undefined' && 'caches' in window) {
        try {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                if (name.includes('tile') || name.includes('versatiles') || name.includes('osm')) {
                    await caches.delete(name);
                }
            }
            return true;
        } catch {
            return false;
        }
    }
    return false;
};

export const clearOverpassCache = async () => {
    try {
        const db = await getDB();
        await db.clear('overpass_cache');
        return true;
    } catch {
        return false;
    }
};

export const clearNestsCache = async () => {
    try {
        const db = await getDB();
        await db.clear('nests');
        return true;
    } catch {
        return false;
    }
};

export const clearAllLocalCaches = async () => {
    await clearTileCache();
    await clearOverpassCache();
    await clearNestsCache();
    return true;
};
