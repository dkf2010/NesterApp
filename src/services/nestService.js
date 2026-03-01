// We will default to a common path structure, e.g. http://localhost/Taubennester/backend/api
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost/Taubennester/backend/api';

// Helper to build headers with token
const getHeaders = (token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

export const loadNests = async (token) => {
    try {
        const response = await fetch(`${API_BASE_URL}/get_nests.php`);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.json();
    } catch (e) {
        console.error("Could not load nests from API", e);
        return [];
    }
};

export const addNest = async (latlng, name, token) => {
    const newNest = {
        id: crypto.randomUUID(),
        name: name,
        lat: latlng.lat,
        lng: latlng.lng,
        createdAt: new Date().toISOString()
    };

    try {
        const response = await fetch(`${API_BASE_URL}/create_nest.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify(newNest)
        });
        if (!response.ok) throw new Error('Failed to create nest');
        // The backend doesn't return the full nest, just success, so we return our local copy
        newNest.logs = []; // initialize empty logs array for the UI
        return newNest;
    } catch (e) {
        console.error("Could not save nest to API", e);
        return null;
    }
};

export const addLogToNest = async (nestId, actionText, token) => {
    const newLog = {
        id: crypto.randomUUID(),
        nest_id: nestId,
        action: actionText,
        timestamp: new Date().toISOString()
    };

    try {
        const response = await fetch(`${API_BASE_URL}/add_log.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify(newLog)
        });
        if (!response.ok) throw new Error('Failed to add log');
        return newLog;
    } catch (e) {
        console.error("Could not save log to API", e);
        return null;
    }
};

export const uploadNestPhoto = async (nestId, photoFile, token) => {
    const formData = new FormData();
    formData.append('id', nestId);
    formData.append('photo', photoFile);

    const headers = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    // Do not set Content-Type to application/json or multipart/form-data here.
    // fetch will automatically set it to multipart/form-data with the correct boundary when body is FormData.

    try {
        const response = await fetch(`${API_BASE_URL}/upload_nest_photo.php`, {
            method: 'POST',
            headers: headers,
            body: formData
        });
        if (!response.ok) throw new Error('Failed to upload photo');
        return await response.json();
    } catch (e) {
        console.error("Could not upload nest photo via API", e);
        return null;
    }
};

export const deleteNest = async (nestId, token) => {
    try {
        await fetch(`${API_BASE_URL}/delete_nest.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: nestId })
        });
    } catch (e) {
        console.error("Could not delete nest via API", e);
    }
};

export const deleteNestPhoto = async (nestId, token) => {
    try {
        const response = await fetch(`${API_BASE_URL}/delete_nest_photo.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: nestId })
        });
        if (!response.ok) throw new Error('Failed to delete photo');
        return await response.json();
    } catch (e) {
        console.error("Could not delete nest photo via API", e);
        return null;
    }
};

export const updateNestLocation = async (nestId, latlng, token) => {
    try {
        await fetch(`${API_BASE_URL}/update_nest.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: nestId, lat: latlng.lat, lng: latlng.lng })
        });
        return true;
    } catch (e) {
        console.error("Could not update nest location via API", e);
        return false;
    }
};

export const updateNestName = async (nestId, name, token) => {
    try {
        const response = await fetch(`${API_BASE_URL}/update_nest_name.php`, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ id: nestId, name })
        });
        if (!response.ok) throw new Error('Failed to update nest name');
        return true;
    } catch (e) {
        console.error("Could not update nest name via API", e);
        return false;
    }
};

export const fetchNearestAmenityName = async (lat, lng) => {
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
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json'
                },
                body: query
            });

            if (response.ok) {
                data = await response.json();
                fallbackSuccess = true;
                break; // Break the loop on success
            } else if (response.status === 429) {
                console.warn(`Overpass API ${endpoint} rate limited (429). Trying next instance...`);
            } else {
                console.warn(`Overpass API ${endpoint} returned ${response.status}. Trying next instance...`);
            }
        } catch (error) {
            console.warn(`Overpass API ${endpoint} failed. Trying next instance...`, error);
        }
    }

    if (!fallbackSuccess || !data) {
        console.error("All Overpass Overpass endpoints failed or returned no data.");
        return null;
    }

    try {

        if (data && data.elements && data.elements.length > 0) {
            let closestNode = null;
            let minDistance = Infinity;

            data.elements.forEach(element => {
                const elLat = element.lat || element.center?.lat;
                const elLng = element.lon || element.center?.lon;

                if (elLat && elLng) {
                    // Simple Euclidean distance for local comparison (accurate enough for short distances)
                    const dist = Math.sqrt(Math.pow(elLat - lat, 2) + Math.pow(elLng - lng, 2));
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestNode = element;
                    }
                }
            });

            if (closestNode?.tags) {
                // Priority 1: Named amenity or shop
                if (closestNode.tags.name) {
                    return closestNode.tags.name;
                }
                // Priority 2: Address (Street + Housenumber)
                if (closestNode.tags['addr:street'] && closestNode.tags['addr:housenumber']) {
                    return `${closestNode.tags['addr:street']} ${closestNode.tags['addr:housenumber']}`;
                }
            }
        }
        return null;
    } catch (error) {
        console.error("OSM Overpass query failed:", error);
        return null;
    }
};
