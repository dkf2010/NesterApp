import {
    getCachedNests,
    saveCachedNests,
    saveCachedNest,
    deleteCachedNest,
    getQueueJobs,
    addQueueJob,
    getCachedAmenity,
    setCachedAmenity,
    findNearestCachedAmenity,
    saveCachedPOIs,
    calculateDistanceMeters
} from './db';
import { getGridKey } from './overpassPreloadService';
import { processSyncQueue } from './syncService';
import { compressImageFile } from '../utils/imageUtils';
import { isOverpassEnabled } from './settingsService';

// Dynamically resolve the API base URL from the current server's origin.
export const API_BASE_URL = (() => {
    if (import.meta.env.VITE_API_BASE_URL) {
        return import.meta.env.VITE_API_BASE_URL;
    }
    const { protocol, host } = window.location;
    return `${protocol}//${host}/backend/api`;
})();

// Wrapper around fetch to handle 401 Unauthorized globally and enforce timeout
export const apiFetch = async (url, options = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = options.signal || controller.signal;

    try {
        const response = await fetch(url, { ...options, signal });
        clearTimeout(timeoutId);
        if (response.status === 401) {
            try {
                const clone = response.clone();
                const data = await clone.json();
                if (data.error !== 'Incorrect current password' && data.error !== 'Invalid credentials') {
                    window.dispatchEvent(new Event('auth:unauthorized'));
                }
            } catch {
                window.dispatchEvent(new Event('auth:unauthorized'));
            }
        }
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error(`Timeout nach ${Math.round(timeoutMs / 1000)}s`);
        }
        throw err;
    }
};

/**
 * Merges server nests with local cached changes and pending outbox queue jobs.
 * This guarantees that locally created/modified nests and logs are never overwritten
 * before the sync queue finishes uploading them to the server.
 */
export const mergeServerNestsWithQueue = (serverNests = [], cachedNests = [], queueJobs = []) => {
    const nestMap = new Map();

    // 1. Populate map with server nests
    for (const sn of serverNests) {
        nestMap.set(sn.id, { ...sn, logs: Array.isArray(sn.logs) ? [...sn.logs] : [] });
    }

    // 2. Preserve any local optimistic tempPhotoUrls
    for (const cn of cachedNests) {
        if (cn.tempPhotoUrl && nestMap.has(cn.id)) {
            const nest = nestMap.get(cn.id);
            if (!nest.photo_filename) {
                nest.tempPhotoUrl = cn.tempPhotoUrl;
            }
        }
    }

    // 3. Replay pending queue jobs in FIFO order
    for (const job of queueJobs) {
        if (!job || !job.payload) continue;

        switch (job.type) {
            case 'CREATE_NEST': {
                const newNest = job.payload;
                if (newNest.id && !nestMap.has(newNest.id)) {
                    nestMap.set(newNest.id, {
                        ...newNest,
                        logs: Array.isArray(newNest.logs) ? [...newNest.logs] : []
                    });
                }
                break;
            }

            case 'DELETE_NEST': {
                if (job.payload.id) {
                    nestMap.delete(job.payload.id);
                }
                break;
            }

            case 'UPDATE_LOCATION': {
                const { id, lat, lng } = job.payload;
                if (id && nestMap.has(id)) {
                    const nest = nestMap.get(id);
                    nest.lat = lat;
                    nest.lng = lng;
                }
                break;
            }

            case 'UPDATE_NAME': {
                const { id, name } = job.payload;
                if (id && nestMap.has(id)) {
                    const nest = nestMap.get(id);
                    nest.name = name;
                }
                break;
            }

            case 'ADD_LOG': {
                const log = job.payload;
                if (log.nest_id && nestMap.has(log.nest_id)) {
                    const nest = nestMap.get(log.nest_id);
                    if (!nest.logs) nest.logs = [];
                    if (!nest.logs.some(l => l.id === log.id)) {
                        nest.logs.unshift(log);
                    }
                }
                break;
            }

            case 'DELETE_LOG': {
                const logId = job.payload.id;
                if (logId) {
                    for (const nest of nestMap.values()) {
                        if (nest.logs) {
                            nest.logs = nest.logs.filter(l => l.id !== logId);
                        }
                    }
                }
                break;
            }

            case 'UPLOAD_PHOTO': {
                const { nestId } = job.payload;
                if (nestId && nestMap.has(nestId)) {
                    const localCached = cachedNests.find(c => c.id === nestId);
                    if (localCached?.tempPhotoUrl) {
                        nestMap.get(nestId).tempPhotoUrl = localCached.tempPhotoUrl;
                    }
                }
                break;
            }

            case 'DELETE_PHOTO': {
                const { id } = job.payload;
                if (id && nestMap.has(id)) {
                    const nest = nestMap.get(id);
                    nest.photo_filename = null;
                    delete nest.tempPhotoUrl;
                }
                break;
            }
        }
    }

    return Array.from(nestMap.values());
};

export const loadNests = async (token) => {
    // 1. Retrieve local cached nests from IndexedDB
    const cached = await getCachedNests();
    const queueJobs = await getQueueJobs();

    // If offline, return cached nests immediately
    if (!navigator.onLine) {
        return cached;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/get_nests.php`, {}, 7000);
        if (!response.ok) throw new Error('Network response was not ok');
        const serverNests = await response.json();

        // Merge server nests with any local temp photo URLs and pending queue jobs
        const mergedNests = mergeServerNestsWithQueue(serverNests, cached, queueJobs);

        // Save fresh merged data into IndexedDB
        await saveCachedNests(mergedNests);

        // Process pending outbox queue items in background
        processSyncQueue(token);

        return mergedNests;
    } catch (e) {
        console.warn('Could not load nests from API, returning local IndexedDB cache', e);
        processSyncQueue(token);
        return cached;
    }
};

export const addNest = async (latlng, name, token) => {
    const newNest = {
        id: crypto.randomUUID(),
        name: name || `Nest ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`,
        lat: latlng.lat,
        lng: latlng.lng,
        createdAt: new Date().toISOString(),
        logs: []
    };

    // 1. Optimistically save to local IndexedDB
    await saveCachedNest(newNest);

    // 2. Always put into sync queue
    await addQueueJob({
        type: 'CREATE_NEST',
        payload: newNest
    });

    // 3. Process queue sequentially in background
    processSyncQueue(token);

    return newNest;
};

export const addLogToNest = async (nestId, actionText, token) => {
    const newLog = {
        id: crypto.randomUUID(),
        nest_id: nestId,
        action: actionText,
        timestamp: new Date().toISOString()
    };

    // 1. Optimistically update nest in local IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        if (!targetNest.logs) targetNest.logs = [];
        targetNest.logs.unshift(newLog);
        await saveCachedNest(targetNest);
    }

    // 2. Always put into sync queue
    await addQueueJob({
        type: 'ADD_LOG',
        payload: newLog
    });

    // 3. Process queue sequentially in background
    processSyncQueue(token);

    return newLog;
};

export const deleteLogFromNest = async (logId, token) => {
    // 1. Optimistically remove from local IndexedDB
    const cachedNests = await getCachedNests();
    for (const nest of cachedNests) {
        if (nest.logs && nest.logs.some(l => l.id === logId)) {
            nest.logs = nest.logs.filter(l => l.id !== logId);
            await saveCachedNest(nest);
            break;
        }
    }

    // 2. Always put into sync queue
    await addQueueJob({
        type: 'DELETE_LOG',
        payload: { id: logId }
    });

    // 3. Process queue sequentially in background
    processSyncQueue(token);

    return true;
};

export const uploadNestPhoto = async (nestId, photoFile, token) => {
    // Compress and normalize to standard JPEG (max 1280px) to prevent iPhone/mobile camera upload failures
    const imageBlob = await compressImageFile(photoFile, 1280, 1280, 0.82);
    const tempUrl = URL.createObjectURL(imageBlob);

    // 1. Optimistically store temp photo URL in local IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        targetNest.tempPhotoUrl = tempUrl;
        await saveCachedNest(targetNest);
    }

    // 2. Always queue the job with compressed binary blob
    await addQueueJob({
        type: 'UPLOAD_PHOTO',
        payload: { nestId },
        photoBlob: imageBlob
    });

    // 3. Process queue sequentially in background
    processSyncQueue(token);

    return {
        success: true,
        tempPhotoUrl: tempUrl,
        photo_filename: null
    };
};

export const deleteNest = async (nestId, token) => {
    // 1. Optimistically delete from IndexedDB
    await deleteCachedNest(nestId);

    // 2. Always put into sync queue
    await addQueueJob({
        type: 'DELETE_NEST',
        payload: { id: nestId }
    });

    // 3. Process queue sequentially in background
    processSyncQueue(token);

    return true;
};

export const deleteNestPhoto = async (nestId, token) => {
    // 1. Optimistically remove photo from IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        targetNest.photo_filename = null;
        delete targetNest.tempPhotoUrl;
        await saveCachedNest(targetNest);
    }

    // 2. Always put into sync queue
    await addQueueJob({
        type: 'DELETE_PHOTO',
        payload: { id: nestId }
    });

    // 3. Process queue sequentially in background
    processSyncQueue(token);

    return { success: true };
};

export const updateNestLocation = async (nestId, latlng, token) => {
    // 1. Optimistically update in local IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        targetNest.lat = latlng.lat;
        targetNest.lng = latlng.lng;
        await saveCachedNest(targetNest);
    }

    // 2. Always put into sync queue
    await addQueueJob({
        type: 'UPDATE_LOCATION',
        payload: { id: nestId, lat: latlng.lat, lng: latlng.lng }
    });

    // 3. Process queue sequentially in background
    processSyncQueue(token);

    return true;
};

export const updateNestName = async (nestId, name, token) => {
    // 1. Optimistically update in local IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        targetNest.name = name;
        await saveCachedNest(targetNest);
    }

    // 2. Always put into sync queue
    await addQueueJob({
        type: 'UPDATE_NAME',
        payload: { id: nestId, name }
    });

    // 3. Process queue sequentially in background
    processSyncQueue(token);

    return true;
};

/**
 * Spatial Overpass query with IndexedDB cache and offline fallback
 */
export const fetchNearestAmenityName = async (lat, lng) => {
    const gridKey = getGridKey(lat, lng);

    // 1. Check local spatial cache in IndexedDB (nearest POI within 30m, address within 50m)
    const cachedPOI = await findNearestCachedAmenity(lat, lng, 30, 50);
    if (cachedPOI) {
        return cachedPOI;
    }

    // 2. If Overpass is disabled or offline, check fallback cache or return clean coordinates fallback immediately
    if (!isOverpassEnabled() || !navigator.onLine) {
        const cachedFallback = await getCachedAmenity(gridKey);
        return cachedFallback || `Nest ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    const radius = 50; // Overpass query bounding radius (meters)
    const query = `
        [out:json][timeout:10];
        (
            node["amenity"]["name"](around:${radius},${lat},${lng});
            way["amenity"]["name"](around:${radius},${lat},${lng});
            relation["amenity"]["name"](around:${radius},${lat},${lng});
            
            node["shop"]["name"](around:${radius},${lat},${lng});
            way["shop"]["name"](around:${radius},${lat},${lng});
            relation["shop"]["name"](around:${radius},${lat},${lng});

            node["tourism"]["name"](around:${radius},${lat},${lng});
            way["tourism"]["name"](around:${radius},${lat},${lng});
            relation["tourism"]["name"](around:${radius},${lat},${lng});

            node["leisure"]["name"](around:${radius},${lat},${lng});
            way["leisure"]["name"](around:${radius},${lat},${lng});
            relation["leisure"]["name"](around:${radius},${lat},${lng});

            node["historic"]["name"](around:${radius},${lat},${lng});
            way["historic"]["name"](around:${radius},${lat},${lng});
            relation["historic"]["name"](around:${radius},${lat},${lng});

            node["railway"]["name"](around:${radius},${lat},${lng});
            way["railway"]["name"](around:${radius},${lat},${lng});
            node["public_transport"]["name"](around:${radius},${lat},${lng});
            way["public_transport"]["name"](around:${radius},${lat},${lng});
            node["highway"="bus_stop"]["name"](around:${radius},${lat},${lng});
            
            node["addr:housenumber"]["addr:street"](around:${radius},${lat},${lng});
            way["addr:housenumber"]["addr:street"](around:${radius},${lat},${lng});
        );
        out center;
    `;

    let data = null;

    // 1. Try our server-side proxy first (prevents CORS, 406 blocks, and mirror failures)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

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
        // Fallback to direct mirrors below
    }

    // 2. Direct mirror fallback if backend proxy was unreachable
    if (!data || !data.elements || data.elements.length === 0) {
        const fallbackEndpoints = [
            'https://overpass-api.de/api/interpreter',
            'https://lz4.overpass-api.de/api/interpreter',
            'https://z.overpass-api.de/api/interpreter'
        ];

        for (const endpoint of fallbackEndpoints) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
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
                // try next endpoint
            }
        }
    }

    if (!data || !data.elements) {
        return `Nest ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    try {
        if (data?.elements && data.elements.length > 0) {
            let closestNamedNode = null;
            let minNamedDist = Infinity;
            let closestAddressNode = null;
            let minAddressDist = Infinity;

            const NAMED_RADIUS_METERS = 30; // Max 30m for named POIs
            const ADDRESS_RADIUS_METERS = 50;

            data.elements.forEach(element => {
                const elLat = element.lat || element.center?.lat;
                const elLng = element.lon || element.center?.lon;

                if (elLat && elLng) {
                    const distMeters = calculateDistanceMeters(lat, lng, elLat, elLng);

                    if (element.tags?.name) {
                        if (distMeters <= NAMED_RADIUS_METERS && distMeters < minNamedDist) {
                            minNamedDist = distMeters;
                            closestNamedNode = element;
                        }
                    } else if (element.tags?.['addr:street'] && element.tags?.['addr:housenumber']) {
                        if (distMeters <= ADDRESS_RADIUS_METERS && distMeters < minAddressDist) {
                            minAddressDist = distMeters;
                            closestAddressNode = element;
                        }
                    }
                }
            });

            // Priority 1: Eigennamen von Geschäften/Einrichtungen (bis 30m)
            // Priority 2: Reine Straßenadresse als Fallback (bis 50m)
            const chosenNode = closestNamedNode || closestAddressNode;

            if (chosenNode?.tags) {
                let resolvedName = null;
                if (chosenNode.tags.name) {
                    resolvedName = chosenNode.tags.name;
                } else if (chosenNode.tags['addr:street'] && chosenNode.tags['addr:housenumber']) {
                    resolvedName = `${chosenNode.tags['addr:street']} ${chosenNode.tags['addr:housenumber']}`;
                }

                if (resolvedName) {
                    // Save in local spatial cache and POI cache
                    await setCachedAmenity(gridKey, resolvedName);
                    const elLat = chosenNode.lat || chosenNode.center?.lat || lat;
                    const elLng = chosenNode.lon || chosenNode.center?.lon || lng;
                    await saveCachedPOIs([{
                        id: chosenNode.id,
                        name: resolvedName,
                        isNamed: !!chosenNode.tags?.name,
                        lat: elLat,
                        lng: elLng,
                        type: 'poi'
                    }], [gridKey]);

                    return resolvedName;
                }
            }
        }
        return `Nest ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
        return `Nest ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
};
