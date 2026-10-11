import {
    getCachedNests,
    saveCachedNests,
    saveCachedNest,
    deleteCachedNest,
    addQueueJob,
    getCachedAmenity,
    setCachedAmenity
} from './db';
import { processSyncQueue } from './syncService';

// Dynamically resolve the API base URL from the current server's origin.
export const API_BASE_URL = (() => {
    if (import.meta.env.VITE_API_BASE_URL) {
        return import.meta.env.VITE_API_BASE_URL;
    }
    const { protocol, host } = window.location;
    return `${protocol}//${host}/backend/api`;
})();

// Helper to build headers with token
const getHeaders = (token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

// Wrapper around fetch to handle 401 Unauthorized globally
export const apiFetch = async (url, options = {}) => {
    const response = await fetch(url, options);
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
};

export const loadNests = async (token) => {
    // 1. First retrieve local cached nests from IndexedDB
    const cached = await getCachedNests();

    // If offline, immediately return cached nests
    if (!navigator.onLine) {
        return cached;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/get_nests.php`);
        if (!response.ok) throw new Error('Network response was not ok');
        const serverNests = await response.json();

        // Merge server nests with any local temp photo URLs
        const mergedNests = serverNests.map(sn => {
            const localMatch = cached.find(cn => cn.id === sn.id);
            if (localMatch?.tempPhotoUrl && !sn.photo_filename) {
                return { ...sn, tempPhotoUrl: localMatch.tempPhotoUrl };
            }
            return sn;
        });

        // Save fresh data into IndexedDB
        await saveCachedNests(mergedNests);

        // Process any pending outbox queue items in background
        processSyncQueue(token);

        return mergedNests;
    } catch (e) {
        console.warn('Could not load nests from API, returning local IndexedDB cache', e);
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

    // Optimistically save to local IndexedDB
    await saveCachedNest(newNest);

    if (!navigator.onLine) {
        // Queue for background sync
        await addQueueJob({
            type: 'CREATE_NEST',
            payload: newNest
        });
        return newNest;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/create_nest.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify(newNest)
        });
        if (!response.ok) throw new Error('Failed to create nest');
        return newNest;
    } catch (e) {
        console.warn('Network failed while saving nest, queued for background sync:', e);
        await addQueueJob({
            type: 'CREATE_NEST',
            payload: newNest
        });
        return newNest;
    }
};

export const addLogToNest = async (nestId, actionText, token) => {
    const newLog = {
        id: crypto.randomUUID(),
        nest_id: nestId,
        action: actionText,
        timestamp: new Date().toISOString()
    };

    // Optimistically update nest in local IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        if (!targetNest.logs) targetNest.logs = [];
        targetNest.logs.unshift(newLog);
        await saveCachedNest(targetNest);
    }

    if (!navigator.onLine) {
        await addQueueJob({
            type: 'ADD_LOG',
            payload: newLog
        });
        return newLog;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/add_log.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify(newLog)
        });
        if (!response.ok) throw new Error('Failed to add log');
        return newLog;
    } catch (e) {
        console.warn('Network failed while saving log, queued for background sync:', e);
        await addQueueJob({
            type: 'ADD_LOG',
            payload: newLog
        });
        return newLog;
    }
};

export const deleteLogFromNest = async (logId, token) => {
    // Optimistically remove from local IndexedDB
    const cachedNests = await getCachedNests();
    for (const nest of cachedNests) {
        if (nest.logs && nest.logs.some(l => l.id === logId)) {
            nest.logs = nest.logs.filter(l => l.id !== logId);
            await saveCachedNest(nest);
            break;
        }
    }

    if (!navigator.onLine) {
        await addQueueJob({
            type: 'DELETE_LOG',
            payload: { id: logId }
        });
        return true;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/delete_log.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: logId })
        });
        if (!response.ok) throw new Error('Failed to delete log');
        return true;
    } catch (e) {
        console.warn('Network failed while deleting log, queued for background sync:', e);
        await addQueueJob({
            type: 'DELETE_LOG',
            payload: { id: logId }
        });
        return true;
    }
};

export const uploadNestPhoto = async (nestId, photoFile, token) => {
    const tempUrl = URL.createObjectURL(photoFile);

    // Optimistically store temp photo URL in local IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        targetNest.tempPhotoUrl = tempUrl;
        await saveCachedNest(targetNest);
    }

    // Always queue the job with binary blob
    await addQueueJob({
        type: 'UPLOAD_PHOTO',
        payload: { nestId },
        photoBlob: photoFile
    });

    if (navigator.onLine) {
        processSyncQueue(token);
    }

    return {
        success: true,
        tempPhotoUrl: tempUrl,
        photo_filename: null
    };
};

export const deleteNest = async (nestId, token) => {
    // Optimistically delete from IndexedDB
    await deleteCachedNest(nestId);

    if (!navigator.onLine) {
        await addQueueJob({
            type: 'DELETE_NEST',
            payload: { id: nestId }
        });
        return;
    }

    try {
        await apiFetch(`${API_BASE_URL}/delete_nest.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: nestId })
        });
    } catch (e) {
        console.warn('Network failed while deleting nest, queued for background sync:', e);
        await addQueueJob({
            type: 'DELETE_NEST',
            payload: { id: nestId }
        });
    }
};

export const deleteNestPhoto = async (nestId, token) => {
    // Optimistically remove photo from IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        targetNest.photo_filename = null;
        delete targetNest.tempPhotoUrl;
        await saveCachedNest(targetNest);
    }

    if (!navigator.onLine) {
        await addQueueJob({
            type: 'DELETE_PHOTO',
            payload: { id: nestId }
        });
        return { success: true };
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/delete_nest_photo.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: nestId })
        });
        if (!response.ok) throw new Error('Failed to delete photo');
        return await response.json();
    } catch (e) {
        console.warn('Network failed while deleting photo, queued for background sync:', e);
        await addQueueJob({
            type: 'DELETE_PHOTO',
            payload: { id: nestId }
        });
        return { success: true };
    }
};

export const updateNestLocation = async (nestId, latlng, token) => {
    // Optimistically update in local IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        targetNest.lat = latlng.lat;
        targetNest.lng = latlng.lng;
        await saveCachedNest(targetNest);
    }

    if (!navigator.onLine) {
        await addQueueJob({
            type: 'UPDATE_LOCATION',
            payload: { id: nestId, lat: latlng.lat, lng: latlng.lng }
        });
        return true;
    }

    try {
        await apiFetch(`${API_BASE_URL}/update_nest.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: nestId, lat: latlng.lat, lng: latlng.lng })
        });
        return true;
    } catch (e) {
        console.warn('Network failed while updating nest location, queued for background sync:', e);
        await addQueueJob({
            type: 'UPDATE_LOCATION',
            payload: { id: nestId, lat: latlng.lat, lng: latlng.lng }
        });
        return true;
    }
};

export const updateNestName = async (nestId, name, token) => {
    // Optimistically update in local IndexedDB
    const cachedNests = await getCachedNests();
    const targetNest = cachedNests.find(n => n.id === nestId);
    if (targetNest) {
        targetNest.name = name;
        await saveCachedNest(targetNest);
    }

    if (!navigator.onLine) {
        await addQueueJob({
            type: 'UPDATE_NAME',
            payload: { id: nestId, name }
        });
        return true;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/update_nest_name.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: nestId, name })
        });
        if (!response.ok) throw new Error('Failed to update nest name');
        return true;
    } catch (e) {
        console.warn('Network failed while updating nest name, queued for background sync:', e);
        await addQueueJob({
            type: 'UPDATE_NAME',
            payload: { id: nestId, name }
        });
        return true;
    }
};

/**
 * Spatial Overpass query with IndexedDB cache and offline fallback
 */
export const fetchNearestAmenityName = async (lat, lng) => {
    const gridKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;

    // 1. Check local spatial cache in IndexedDB
    const cachedName = await getCachedAmenity(gridKey);
    if (cachedName) {
        return cachedName;
    }

    // 2. If offline, return clean fallback name immediately without stalling
    if (!navigator.onLine) {
        return `Nest ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    const radius = 50; // Search within 50 meters
    const query = `
        [out:json][timeout:10];
        (
            node["amenity"]["name"](around:${radius},${lat},${lng});
            way["amenity"]["name"](around:${radius},${lat},${lng});
            relation["amenity"]["name"](around:${radius},${lat},${lng});
            
            node["shop"]["name"](around:${radius},${lat},${lng});
            way["shop"]["name"](around:${radius},${lat},${lng});
            relation["shop"]["name"](around:${radius},${lat},${lng});
            
            node["addr:housenumber"]["addr:street"](around:${radius},${lat},${lng});
            way["addr:housenumber"]["addr:street"](around:${radius},${lat},${lng});
        );
        out center;
    `;

    const overpassEndpoints = [
        'https://overpass-api.de/api/interpreter',
        'https://lz4.overpass-api.de/api/interpreter',
        'https://z.overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.openstreetmap.fr/api/interpreter'
    ].sort(() => Math.random() - 0.5);

    let data = null;
    let fallbackSuccess = false;

    for (const endpoint of overpassEndpoints) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                body: query,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                data = await response.json();
                fallbackSuccess = true;
                break;
            }
        } catch {
            // try next endpoint
        }
    }

    if (!fallbackSuccess || !data) {
        return `Nest ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    try {
        if (data?.elements && data.elements.length > 0) {
            let closestNode = null;
            let minDistance = Infinity;

            data.elements.forEach(element => {
                const elLat = element.lat || element.center?.lat;
                const elLng = element.lon || element.center?.lon;

                if (elLat && elLng) {
                    const dist = Math.sqrt(Math.pow(elLat - lat, 2) + Math.pow(elLng - lng, 2));
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestNode = element;
                    }
                }
            });

            if (closestNode?.tags) {
                let resolvedName = null;
                if (closestNode.tags.name) {
                    resolvedName = closestNode.tags.name;
                } else if (closestNode.tags['addr:street'] && closestNode.tags['addr:housenumber']) {
                    resolvedName = `${closestNode.tags['addr:street']} ${closestNode.tags['addr:housenumber']}`;
                }

                if (resolvedName) {
                    // Save in local spatial cache
                    await setCachedAmenity(gridKey, resolvedName);
                    return resolvedName;
                }
            }
        }
        return `Nest ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
        return `Nest ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
};
