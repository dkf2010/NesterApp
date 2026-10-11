import { getQueueJobs, removeQueueJob, saveCachedNest, getCachedNests, getQueueLength } from './db';
import { API_BASE_URL, apiFetch } from './nestService';

let isSyncing = false;
const listeners = new Set();

/**
 * Subscribe to sync state changes.
 * Callback receives: { isSyncing: boolean, pendingCount: number, isOnline: boolean }
 */
export const subscribeSyncStatus = (callback) => {
    listeners.add(callback);
    // Emit initial status
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

            try {
                switch (job.type) {
                    case 'CREATE_NEST': {
                        const res = await apiFetch(`${API_BASE_URL}/create_nest.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        });
                        success = res.ok;
                        break;
                    }

                    case 'ADD_LOG': {
                        const res = await apiFetch(`${API_BASE_URL}/add_log.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        });
                        success = res.ok;
                        break;
                    }

                    case 'DELETE_LOG': {
                        const res = await apiFetch(`${API_BASE_URL}/delete_log.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({ id: job.payload.id })
                        });
                        success = res.ok;
                        break;
                    }

                    case 'UPDATE_LOCATION': {
                        const res = await apiFetch(`${API_BASE_URL}/update_nest.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        });
                        success = res.ok;
                        break;
                    }

                    case 'UPDATE_NAME': {
                        const res = await apiFetch(`${API_BASE_URL}/update_nest_name.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify(job.payload)
                        });
                        success = res.ok;
                        break;
                    }

                    case 'DELETE_NEST': {
                        const res = await apiFetch(`${API_BASE_URL}/delete_nest.php`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({ id: job.payload.id })
                        });
                        success = res.ok;
                        break;
                    }

                    case 'UPLOAD_PHOTO': {
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
                                // Update local cached nest with official filename
                                const cachedNests = await getCachedNests();
                                const target = cachedNests.find(n => n.id === job.payload.nestId);
                                if (target) {
                                    target.photo_filename = data.photo_filename;
                                    delete target.tempPhotoUrl;
                                    await saveCachedNest(target);
                                }
                            }
                            success = true;
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
                        break;
                    }

                    default:
                        console.warn('Unknown sync job type:', job.type);
                        success = true; // remove invalid job
                }
            } catch (jobErr) {
                console.warn(`Job ${job.type} network attempt failed:`, jobErr);
                success = false;
            }

            if (success) {
                await removeQueueJob(job.id);
            } else {
                // If a job fails due to network, stop processing queue to maintain FIFO order
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
