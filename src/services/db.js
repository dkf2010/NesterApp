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
