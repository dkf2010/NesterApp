import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../services/nestService';
import { RefreshCw, X, AlertTriangle, Info, AlertCircle, Filter } from 'lucide-react';
import './AdminLogsScreen.css';

const LEVEL_CONFIG = {
    error: { label: 'Error', icon: AlertCircle, className: 'log-level-error' },
    warning: { label: 'Warning', icon: AlertTriangle, className: 'log-level-warning' },
    info: { label: 'Info', icon: Info, className: 'log-level-info' },
};

export default function AdminLogsScreen({ onClose }) {
    const { fetchWithAuth } = useAuth();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [levelFilter, setLevelFilter] = useState('');
    const [contextFilter, setContextFilter] = useState('');
    const [expandedId, setExpandedId] = useState(null);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (levelFilter) params.set('level', levelFilter);
            if (contextFilter) params.set('context', contextFilter);

            const response = await fetchWithAuth(`${API_BASE_URL}/get_app_logs.php?${params}`);
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            setLogs(await response.json());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [fetchWithAuth, levelFilter, contextFilter]);

    // Initial load + filter changes
    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    // Auto-refresh every 30 s
    useEffect(() => {
        const interval = setInterval(fetchLogs, 30_000);
        return () => clearInterval(interval);
    }, [fetchLogs]);

    const formatTime = (ts) => {
        const d = new Date(ts);
        return d.toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    };

    // Unique contexts for the filter dropdown
    const contexts = [...new Set(logs.map(l => l.context).filter(Boolean))].sort();

    return (
        <div className="admin-logs-overlay">
            <div className="admin-logs-panel glass">
                <div className="admin-logs-header">
                    <h3>App-Logs</h3>
                    <div className="admin-logs-actions">
                        <button
                            className="logs-icon-btn"
                            onClick={fetchLogs}
                            title="Aktualisieren"
                            disabled={loading}
                        >
                            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
                        </button>
                        <button className="logs-icon-btn" onClick={onClose} title="Schließen">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="admin-logs-filters">
                    <div className="filter-group">
                        <Filter size={13} />
                        <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
                            <option value="">Alle Level</option>
                            <option value="error">Error</option>
                            <option value="warning">Warning</option>
                            <option value="info">Info</option>
                        </select>
                    </div>
                    <div className="filter-group">
                        <select value={contextFilter} onChange={e => setContextFilter(e.target.value)}>
                            <option value="">Alle Kontexte</option>
                            {contexts.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                {/* Content */}
                <div className="admin-logs-body">
                    {error && (
                        <div className="logs-error-banner">
                            <AlertCircle size={14} /> {error}
                        </div>
                    )}

                    {!loading && logs.length === 0 && !error && (
                        <div className="logs-empty">Keine Einträge gefunden.</div>
                    )}

                    {logs.map(log => {
                        const cfg = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.info;
                        const Icon = cfg.icon;
                        const isExpanded = expandedId === log.id;

                        return (
                            <div
                                key={log.id}
                                className={`log-entry ${cfg.className} ${isExpanded ? 'expanded' : ''}`}
                                onClick={() => setExpandedId(isExpanded ? null : log.id)}
                            >
                                <div className="log-entry-main">
                                    <Icon size={13} className="log-entry-icon" />
                                    <span className="log-entry-time">{formatTime(log.created_at)}</span>
                                    <span className="log-entry-context">{log.context}</span>
                                    <span className="log-entry-message">{log.message}</span>
                                </div>

                                {isExpanded && (
                                    <div className="log-entry-details">
                                        <div className="log-detail-row">
                                            <span className="log-detail-label">Benutzer</span>
                                            <span>{log.username ?? <em>anonym</em>}</span>
                                        </div>
                                        <div className="log-detail-row">
                                            <span className="log-detail-label">IP</span>
                                            <span>{log.ip_address ?? '—'}</span>
                                        </div>
                                        {log.details && (
                                            <div className="log-detail-row log-detail-json">
                                                <span className="log-detail-label">Details</span>
                                                <pre>{JSON.stringify(log.details, null, 2)}</pre>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="admin-logs-footer">
                    {logs.length} Einträge · Auto-Refresh alle 30s
                </div>
            </div>
        </div>
    );
}
