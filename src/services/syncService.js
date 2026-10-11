import { getQueueJobs, removeQueueJob, saveCachedNest, getCachedNests, getQueueLength, updateQueueJob } from './db';
import { API_BASE_URL, apiFetch } from './nestService';

let isSyncing = false;
const listeners = new Set();

/**
 * Subscribe to sync state changes.
 * Callback receives: { isSyncing: boolean, pendingCount: number, isOnline: boolean }
 */
export const subscribeSyncStatus = (callback) => {
    listeners.add(callback);
    notifyStatus();
    return () => listeners.delete(callback);
};

const notifyStatus = async () => {
    const pendingCount = await getQueueLength();
    const isOnline = navigator.onLine;
    const status = { isSyncing, pendingCount, isOnline };
    listeners.forEach((fn) => {
        try {
            fn(status);
        } catch (e) {
            console.error('Error in sync listener:', e);
        }
    });
};

/**
 * Process all jobs currently in the IndexedDB sync queue in FIFO order.
 */
export const processSyncQueue = async (token) => {
    if (isSyncing || !navigator.onLine) {
        notifyStatus();
        return;
    }

    const jobs = await getQueueJobs();
    if (!jobs || jobs.length === 0) {
        notifyStatus();
        return;
    }

    isSyncing = true;
    notifyStatus();

    const getHeaders = () => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    };

    try {
        for (const job of jobs) {
            let success = false;
            let errorMessage = null;

            try {
                switch (job.type) {
                    case 'CREATE_NEST': {
                        const res = await apiFetch(`${API_BASE_URL}/create_nest.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        });
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                        }
                        break;
                    }

                    case 'ADD_LOG': {
                        const res = await apiFetch(`${API_BASE_URL}/add_log.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        });
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                        }
                        break;
                    }

                    case 'DELETE_LOG': {
                        const res = await apiFetch(`${API_BASE_URL}/delete_log.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({ id: job.payload.id })
                        });
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                        }
                        break;
                    }

                    case 'UPDATE_LOCATION': {
                        const res = await apiFetch(`${API_BASE_URL}/update_nest.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        });
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                        }
                        break;
                    }

                    case 'UPDATE_NAME': {
                        const res = await apiFetch(`${API_BASE_URL}/update_nest_name.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        });
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                        }
                        break;
                    }

                    case 'DELETE_NEST': {
                        const res = await apiFetch(`${API_BASE_URL}/delete_nest.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({ id: job.payload.id })
                        });
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                        }
                        break;
                    }

                    case 'UPLOAD_PHOTO': {
                        if (!job.photoBlob) {
                            // Missing binary blob (e.g. storage cleared)
                            errorMessage = 'Keine Bilddatei vorhanden';
                            success = false;
                            break;
                        }

                        const formData = new FormData();
                        formData.append('id', job.payload.nestId);
                        formData.append('photo', job.photoBlob, 'nest-photo.jpg');

                        const headers = {};
                        if (token) headers['Authorization'] = `Bearer ${token}`;

                        const res = await apiFetch(`${API_BASE_URL}/upload_nest_photo.php`, {
                            method: 'POST',
                            headers: headers,
                            body: formData
                        });

                        if (res.ok) {
                            const data = await res.json();
                            if (data && data.photo_filename) {
                                const cachedNests = await getCachedNests();
                                const target = cachedNests.find(n => n.id === job.payload.nestId);
                                if (target) {
                                    target.photo_filename = data.photo_filename;
                                    delete target.tempPhotoUrl;
                                    await saveCachedNest(target);
                                }
                            }
                            success = true;
                        } else {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                        }
                        break;
                    }

                    case 'DELETE_PHOTO': {
                        const res = await apiFetch(`${API_BASE_URL}/delete_nest_photo.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({ id: job.payload.id })
                        });
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                        }
                        break;
                    }

                    default:
                        console.warn('Unknown sync job type:', job.type);
                        success = true;
                }
            } catch (jobErr) {
                console.warn(`Job ${job.type} network attempt failed:`, jobErr);
                errorMessage = jobErr.message || 'Netzwerkfehler';
                success = false;
            }

            if (success) {
                await removeQueueJob(job.id);
            } else {
                job.attempts = (job.attempts || 0) + 1;
                job.lastError = errorMessage || 'Fehlgeschlagen';
                await updateQueueJob(job);

                // If fatal error (e.g. 400 Bad Request or missing blob), don't halt other independent queue jobs forever
                if (errorMessage && errorMessage.includes('400')) {
                    console.warn(`Job ${job.id} rejected by server (400), skipping to next job.`);
                    continue;
                }

                // If general network error, stop queue execution until network recovers
                console.warn('Stopping sync queue execution until network recovers');
                break;
            }
        }
    } finally {
        isSyncing = false;
        notifyStatus();
    }
};

// Global network status listeners
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        notifyStatus();
        const token = localStorage.getItem('auth_token');
        processSyncQueue(token);
    });

    window.addEventListener('offline', () => {
        notifyStatus();
    });
}
