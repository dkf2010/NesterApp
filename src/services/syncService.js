import { getQueueJobs, removeQueueJob, saveCachedNest, getCachedNests, getQueueLength, updateQueueJob } from './db';
import { API_BASE_URL, apiFetch } from './nestService';

let isSyncing = false;
let retryTimeout = null;
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

const scheduleQueueRetry = (delayMs = 6000) => {
    if (retryTimeout) clearTimeout(retryTimeout);
    retryTimeout = setTimeout(() => {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
        processSyncQueue(token);
    }, delayMs);
};

/**
 * Process all jobs currently in the IndexedDB sync queue in FIFO order.
 * Safe against network drops, slow connections, and timeouts.
 */
export const processSyncQueue = async (token = (typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null)) => {
    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }

    if (isSyncing || !navigator.onLine) {
        notifyStatus();
        return;
    }

    const initialJobs = await getQueueJobs();
    if (!initialJobs || initialJobs.length === 0) {
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
        // Sequentially process items in FIFO order
        while (navigator.onLine) {
            const currentJobs = await getQueueJobs();
            if (!currentJobs || currentJobs.length === 0) {
                break;
            }

            const job = currentJobs[0];
            let success = false;
            let errorMessage = null;

            try {
                switch (job.type) {
                    case 'CREATE_NEST': {
                        const res = await apiFetch(`${API_BASE_URL}/create_nest.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        }, 12000);
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                            // If nest was already inserted on server during a dropped network response, treat as success
                            if (errorMessage && (errorMessage.includes('Duplicate entry') || errorMessage.includes('Integrity constraint'))) {
                                success = true;
                            }
                        }
                        break;
                    }

                    case 'ADD_LOG': {
                        const res = await apiFetch(`${API_BASE_URL}/add_log.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        }, 12000);
                        success = res.ok;
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            errorMessage = err.error || `HTTP ${res.status}`;
                            // If log was already inserted on server during a dropped network response, treat as success
                            if (errorMessage && (errorMessage.includes('Duplicate entry') || errorMessage.includes('Integrity constraint'))) {
                                success = true;
                            }
                        }
                        break;
                    }

                    case 'DELETE_LOG': {
                        const res = await apiFetch(`${API_BASE_URL}/delete_log.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({ id: job.payload.id })
                        }, 12000);
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
                        }, 12000);
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
                        }, 12000);
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
                        }, 12000);
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

                        // Generous 25s timeout for mobile image uploads
                        const res = await apiFetch(`${API_BASE_URL}/upload_nest_photo.php`, {
                            method: 'POST',
                            headers: headers,
                            body: formData
                        }, 25000);

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
                        }, 12000);
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

                // If permanent client error (e.g. 400 Bad Request or missing blob), don't halt other queue jobs
                if (errorMessage && (errorMessage.includes('400') || errorMessage.includes('Keine Bilddatei'))) {
                    console.warn(`Job ${job.id} rejected by server (400), skipping to next job.`);
                    await removeQueueJob(job.id);
                    continue;
                }

                // If general network error / timeout, pause queue execution and schedule automatic retry
                console.warn('Pausing sync queue execution due to network/timeout. Scheduled auto-retry.');
                scheduleQueueRetry(job.attempts <= 3 ? 5000 : 15000);
                break;
            }
        }
    } finally {
        isSyncing = false;
        notifyStatus();

        // Dispatch sync:completed event if queue is now empty
        const remainingCount = await getQueueLength();
        if (remainingCount === 0 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('sync:completed'));
        }
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
