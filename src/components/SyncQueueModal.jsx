import { useState, useEffect } from 'react';
import { X, RefreshCw, Trash2, CloudUpload, AlertCircle, CheckCircle, Database, Map as MapIcon, Compass } from 'lucide-react';
import {
    getQueueJobs,
    removeQueueJob,
    getCachedNests,
    getStorageStats,
    clearTileCache,
    clearOverpassCache,
    clearNestsCache,
    clearAllLocalCaches
} from '../services/db';
import { processSyncQueue, subscribeSyncStatus } from '../services/syncService';
import { useAuth } from '../contexts/AuthContext';

export default function SyncQueueModal({ onClose }) {
    const { token } = useAuth();
    const [activeTab, setActiveTab] = useState('queue'); // 'queue' | 'cache'
    const [jobs, setJobs] = useState([]);
    const [nestsMap, setNestsMap] = useState({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [stats, setStats] = useState(null);
    const [statsLoading, setStatsLoading] = useState(false);

    const loadJobs = async () => {
        const queueJobs = await getQueueJobs();
        const cached = await getCachedNests();
        const map = {};
        cached.forEach(n => { map[n.id] = n.name; });

        setJobs(queueJobs);
        setNestsMap(map);
    };

    const loadStats = async () => {
        setStatsLoading(true);
        try {
            const s = await getStorageStats();
            setStats(s);
        } finally {
            setStatsLoading(false);
        }
    };

    useEffect(() => {
        let isMounted = true;

        Promise.all([getQueueJobs(), getCachedNests()]).then(([queueJobs, cached]) => {
            if (!isMounted) return;
            const map = {};
            cached.forEach(n => { map[n.id] = n.name; });
            setJobs(queueJobs);
            setNestsMap(map);
        });

        loadStats();

        const unsubscribe = subscribeSyncStatus((status) => {
            if (!isMounted) return;
            setIsProcessing(status.isSyncing);
            loadJobs();
            loadStats();
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, []);

    const handleSyncNow = async () => {
        setIsProcessing(true);
        await processSyncQueue(token);
        await loadJobs();
        await loadStats();
        setIsProcessing(false);
    };

    const handleRemoveJob = async (jobId) => {
        if (!window.confirm('Möchtest du diesen Eintrag wirklich aus der Warteschlange löschen?')) return;
        await removeQueueJob(jobId);
        await loadJobs();
        await loadStats();
    };

    const handleClearAllJobs = async () => {
        if (!window.confirm('Möchtest du alle ausstehenden Einträge der Warteschlange verwerfen?')) return;
        for (const job of jobs) {
            await removeQueueJob(job.id);
        }
        await loadJobs();
        await loadStats();
    };

    // Cache clearing actions
    const handleClearTiles = async () => {
        if (!window.confirm('Karten-Kacheln aus dem lokalen Speicher löschen? Beim nächsten Laden werden Kacheln online nachgeladen.')) return;
        await clearTileCache();
        await loadStats();
    };

    const handleClearOverpass = async () => {
        if (!window.confirm('Gecachte Adressen, POIs und Indoor-Daten löschen?')) return;
        await clearOverpassCache();
        await loadStats();
    };

    const handleClearNests = async () => {
        if (!window.confirm('Lokale Nester-Kopie löschen? Die Nester werden bei bestehender Internetverbindung neu vom Server geladen.')) return;
        await clearNestsCache();
        await loadStats();
    };

    const handleClearAllCache = async () => {
        if (!window.confirm('Möchtest du den gesamten Offline-Cache (Karten, Adressen, Nester) leeren?')) return;
        await clearAllLocalCaches();
        await loadStats();
    };

    const formatBytes = (bytes) => {
        if (!bytes || bytes === 0) return '0 KB';
        const k = 1024;
        const dm = 1;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };

    const getJobTitle = (job) => {
        switch (job.type) {
            case 'UPLOAD_PHOTO':
                return 'Foto hochladen';
            case 'CREATE_NEST':
                return 'Neues Nest anlegen';
            case 'ADD_LOG':
                return `Aktivität eintragen: ${job.payload?.action || ''}`;
            case 'UPDATE_LOCATION':
                return 'Nest verschieben';
            case 'UPDATE_NAME':
                return `Name ändern zu: "${job.payload?.name || ''}"`;
            case 'DELETE_NEST':
                return 'Nest löschen';
            case 'DELETE_PHOTO':
                return 'Foto löschen';
            case 'DELETE_LOG':
                return 'Log-Eintrag löschen';
            default:
                return job.type;
        }
    };

    const getNestInfo = (job) => {
        const nestId = job.payload?.nestId || job.payload?.id;
        if (!nestId) return '';
        const name = nestsMap[nestId] || job.payload?.name;
        return name ? `Nest: ${name}` : `Nest ID: ${nestId.slice(0, 8)}...`;
    };

    return (
        <div
            className="bottom-sheet-overlay"
            onClick={onClose}
            style={{
                zIndex: 2000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem'
            }}
        >
            <div
                className="glass"
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%',
                    maxWidth: '480px',
                    maxHeight: '85vh',
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-lg)',
                    backgroundColor: 'var(--surface-color)'
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '0.85rem 1.25rem',
                        borderBottom: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}
                >
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={() => setActiveTab('queue')}
                            style={{
                                padding: '0.35rem 0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: 'none',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                backgroundColor: activeTab === 'queue' ? 'var(--primary-color)' : 'transparent',
                                color: activeTab === 'queue' ? '#ffffff' : 'var(--text-muted)'
                            }}
                        >
                            <CloudUpload size={16} />
                            Warteschlange ({jobs.length})
                        </button>
                        <button
                            onClick={() => {
                                setActiveTab('cache');
                                loadStats();
                            }}
                            style={{
                                padding: '0.35rem 0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: 'none',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                backgroundColor: activeTab === 'cache' ? 'var(--primary-color)' : 'transparent',
                                color: activeTab === 'cache' ? '#ffffff' : 'var(--text-muted)'
                            }}
                        >
                            <Database size={16} />
                            Offline-Cache
                        </button>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px'
                        }}
                        aria-label="Schließen"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Tab 1: Queue Content */}
                {activeTab === 'queue' && (
                    <>
                        <div style={{ padding: '1rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {jobs.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                                    <CheckCircle size={40} color="var(--success-color)" style={{ margin: '0 auto 0.75rem auto' }} />
                                    <p style={{ margin: 0, fontWeight: 500 }}>Alles synchronisiert!</p>
                                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>Keine ausstehenden Änderungen in der Warteschlange.</p>
                                </div>
                            ) : (
                                jobs.map((job) => {
                                    const nestInfo = getNestInfo(job);
                                    const hasError = !!job.lastError;

                                    return (
                                        <div
                                            key={job.id}
                                            style={{
                                                backgroundColor: hasError ? '#fff1f2' : 'var(--bg-color)',
                                                border: `1px solid ${hasError ? '#fecdd3' : 'var(--border-color)'}`,
                                                borderRadius: 'var(--radius-md)',
                                                padding: '0.75rem',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '0.35rem'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: hasError ? '#be123c' : 'var(--text-main)' }}>
                                                    {getJobTitle(job)}
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveJob(job.id)}
                                                    style={{
                                                        background: 'none',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        color: 'var(--danger-color)',
                                                        padding: '2px',
                                                        display: 'flex',
                                                        alignItems: 'center'
                                                    }}
                                                    title="Eintrag verwerfen"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>

                                            {nestInfo && (
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                    {nestInfo}
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                <span>
                                                    {new Date(job.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                </span>
                                                {job.attempts > 0 && (
                                                    <span>Versuche: {job.attempts}</span>
                                                )}
                                            </div>

                                            {hasError && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#e11d48', fontSize: '0.75rem', marginTop: '4px' }}>
                                                    <AlertCircle size={14} style={{ flexShrink: 0 }} />
                                                    <span>Fehler: {job.lastError}</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {jobs.length > 0 && (
                            <div
                                style={{
                                    padding: '0.75rem 1rem',
                                    borderTop: '1px solid var(--border-color)',
                                    display: 'flex',
                                    gap: '0.5rem',
                                    justifyContent: 'space-between'
                                }}
                            >
                                <button
                                    onClick={handleClearAllJobs}
                                    style={{
                                        padding: '0.5rem 0.75rem',
                                        border: '1px solid var(--danger-color)',
                                        backgroundColor: 'transparent',
                                        color: 'var(--danger-color)',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: '0.85rem',
                                        fontWeight: 500,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Alle verwerfen
                                </button>
                                <button
                                    onClick={handleSyncNow}
                                    disabled={isProcessing}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        border: 'none',
                                        backgroundColor: 'var(--primary-color)',
                                        color: '#ffffff',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: '0.85rem',
                                        fontWeight: 600,
                                        cursor: isProcessing ? 'default' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        opacity: isProcessing ? 0.7 : 1
                                    }}
                                >
                                    <RefreshCw size={15} className={isProcessing ? 'spin-icon' : ''} />
                                    {isProcessing ? 'Synchronisiere...' : 'Jetzt synchronisieren'}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* Tab 2: Cache Management Content */}
                {activeTab === 'cache' && (
                    <div style={{ padding: '1rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {/* Overall Storage Card */}
                        <div
                            style={{
                                backgroundColor: 'var(--bg-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: '1rem',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.5rem'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Gesamter App-Speicher</span>
                                <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--primary-color)' }}>
                                    {stats ? formatBytes(stats.totalUsageBytes) : 'Wird geladen...'}
                                </span>
                            </div>
                            {stats && stats.totalQuotaBytes > 0 && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    von {formatBytes(stats.totalQuotaBytes)} verfügbar
                                </span>
                            )}
                        </div>

                        {/* Cache Category Items */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {/* 1. Map Tiles Cache */}
                            <div
                                style={{
                                    backgroundColor: 'var(--surface-color)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <MapIcon size={20} color="var(--primary-color)" />
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>OSM Vektorkacheln</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {stats ? `${stats.tileCacheCount} Kacheln gecacht` : '...'}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={handleClearTiles}
                                    style={{
                                        padding: '0.35rem 0.65rem',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'var(--bg-color)',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        color: 'var(--danger-color)'
                                    }}
                                >
                                    Leeren
                                </button>
                            </div>

                            {/* 2. Overpass & Indoor Cache */}
                            <div
                                style={{
                                    backgroundColor: 'var(--surface-color)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <Compass size={20} color="#059669" />
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Overpass & Indoor-Daten</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {stats ? `${stats.overpassCount} POIs & Parkdecks` : '...'} • Aktiv ab Zoom 16
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={handleClearOverpass}
                                    style={{
                                        padding: '0.35rem 0.65rem',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'var(--bg-color)',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        color: 'var(--danger-color)'
                                    }}
                                >
                                    Leeren
                                </button>
                            </div>

                            {/* 3. Nests Offline Copy */}
                            <div
                                style={{
                                    backgroundColor: 'var(--surface-color)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <Database size={20} color="#d97706" />
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Lokale Nester-Kopie</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {stats ? `${stats.nestsCount} Nester gespeichert` : '...'}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={handleClearNests}
                                    style={{
                                        padding: '0.35rem 0.65rem',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'var(--bg-color)',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        color: 'var(--danger-color)'
                                    }}
                                >
                                    Leeren
                                </button>
                            </div>
                        </div>

                        {/* Clear All Button */}
                        <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
                            <button
                                onClick={handleClearAllCache}
                                style={{
                                    width: '100%',
                                    padding: '0.65rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--danger-color)',
                                    backgroundColor: '#fff1f2',
                                    color: 'var(--danger-color)',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.4rem'
                                }}
                            >
                                <Trash2 size={16} />
                                Gesamten Offline-Cache leeren
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
