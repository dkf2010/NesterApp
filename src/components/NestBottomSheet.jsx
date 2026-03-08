import { X, Egg, EggOff, CheckCircle2, Move, Trash2, Pencil, Camera, Image, Trash, Bird } from 'lucide-react';
import { useState, useRef } from 'react';
import './NestBottomSheet.css';
import { uploadNestPhoto, deleteNestPhoto, deleteLogFromNest, API_BASE_URL } from '../services/nestService';
import { useAuth } from '../contexts/AuthContext';

export default function NestBottomSheet({ nest, onClose, onAction, onTitleChange, onDeleteRequest, onMoveRequest, onPhotoUploaded, onLogDeleted }) {
    const { token, user } = useAuth();
    const [isUploading, setIsUploading] = useState(false);
    const [isDeletingPhoto, setIsDeletingPhoto] = useState(false);
    const [fullScreenImage, setFullScreenImage] = useState(null);
    const fileInputRef = useRef(null);

    if (!nest) return null;

    const handlePhotoUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const result = await uploadNestPhoto(nest.id, file, token);
            if (result && result.success) {
                if (onPhotoUploaded) {
                    onPhotoUploaded(nest.id, result.photo_filename);
                } else {
                    onAction('Foto hinzugefügt');
                }
            } else {
                alert('Fehler beim Hochladen des Fotos');
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert('Fehler beim Hochladen des Fotos');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handlePhotoDelete = async (e) => {
        e.stopPropagation();
        if (!window.confirm("Bist du sicher, dass du dieses Foto löschen möchtest?")) return;

        setIsDeletingPhoto(true);
        try {
            const result = await deleteNestPhoto(nest.id, token);
            if (result && result.success) {
                if (onPhotoUploaded) {
                    onPhotoUploaded(nest.id, null); // passing null to indicate deletion
                } else {
                    onAction('Foto gelöscht');
                }
            } else {
                alert('Fehler beim Löschen des Fotos');
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('Fehler beim Löschen des Fotos');
        } finally {
            setIsDeletingPhoto(false);
        }
    };

    const handleLogDelete = async (logId) => {
        if (!window.confirm("Möchtest du diesen Log-Eintrag wirklich unwiderruflich löschen?")) return;

        const success = await deleteLogFromNest(logId, token);
        if (success) {
            if (onLogDeleted) {
                onLogDeleted(nest.id);
            } else {
                // If onLogDeleted callback is missing, trigger a generic action to refresh
                onAction('Log-Eintrag gelöscht');
            }
        } else {
            alert('Fehler beim Löschen des Log-Eintrags.');
        }
    };

    const photoUrl = nest.photo_filename
        ? `${API_BASE_URL.replace('/api', '')}/uploads/nests/${nest.photo_filename}`
        : null;

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const actionOptions = [
        {
            id: "swap_eggs",
            label: "Taubeneier gegen Kunststoffeier getauscht",
            icon: <Egg size={20} />,
            color: "var(--success-color)", // Green
            hasSplit: true
        },
        {
            id: "incubate_plastic",
            label: "Kunststoffeier werden bebrütet",
            icon: <Egg size={20} />,
            color: "#eab308", // Yellow
            hasSplit: true
        },
        {
            id: "remove_plastic",
            label: "Kunststoffeier entfernt",
            icon: <EggOff size={20} />,
            color: "var(--danger-color)", // Red
            hasSplit: true
        },
        {
            id: "eggs_too_far",
            label: "Eier zu weit",
            icon: <EggOff size={20} />,
            color: "#f97316", // Orange
            hasSplit: true
        },
        {
            id: "chicks",
            label: "Küken",
            icon: <Bird size={20} />,
            color: "#14b8a6", // Teal
            hasSplit: true,
            splitLabels: ['1 Küken', '2 Küken']
        },
        {
            id: "abandoned",
            label: "Nest verlassen",
            icon: <X size={20} />,
            color: "#a855f7", // Purple
            hasSplit: false
        }
    ];

    const getActiveActionId = () => {
        if (!nest.logs || nest.logs.length === 0) return null;

        const statusLog = nest.logs.find(log =>
            !log.action.startsWith('Name geändert zu') &&
            !log.action.startsWith('Nest angelegt') &&
            !log.action.startsWith('Foto hinzugefügt') &&
            !log.action.startsWith('Foto gelöscht')
        );

        if (!statusLog) return null;

        if (statusLog.action.startsWith('Taubeneier gegen Kunststoffeier getauscht')) return 'swap_eggs';
        if (statusLog.action.startsWith('Kunststoffeier werden bebrütet')) return 'incubate_plastic';
        if (statusLog.action.startsWith('Kunststoffeier entfernt')) return 'remove_plastic';
        if (statusLog.action.startsWith('Eier zu weit')) return 'eggs_too_far';
        if (statusLog.action.startsWith('Küken')) return 'chicks';
        if (statusLog.action.startsWith('Nest verlassen')) return 'abandoned';

        return null;
    };

    const activeActionId = getActiveActionId();

    return (
        <>
            <div className="bottom-sheet-overlay" onClick={onClose} />
            <div className="bottom-sheet">
                <div className="sheet-header">
                    <div className="sheet-drag-handle" />
                    <div className="sheet-title-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <h3>{nest.name || "Nest Details"}</h3>
                            <button
                                onClick={() => {
                                    const newName = window.prompt("Neuer Titel für das Nest:", nest.name || "");
                                    if (newName !== null && newName !== nest.name) {
                                        onTitleChange(nest.id, newName.trim());
                                    }
                                }}
                                className="action-icon"
                                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', width: 'auto', height: 'auto' }}
                                aria-label="Titel bearbeiten"
                            >
                                <Pencil size={18} />
                            </button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button
                                className="close-btn"
                                onClick={() => onMoveRequest(nest)}
                                aria-label="Nest verschieben"
                            >
                                <Move size={20} />
                            </button>
                            <button className="close-btn" onClick={onClose} aria-label="Schließen">
                                <X size={24} />
                            </button>
                        </div>
                    </div>
                    <p className="sheet-subtitle">
                        Gefunden am {formatDate(nest.createdAt)}
                    </p>

                    {photoUrl ? (
                        <div className="nest-photo-thumbnail-container" onClick={() => setFullScreenImage(photoUrl)} style={{ position: 'relative' }}>
                            <img src={photoUrl} alt="Nest Foto" className="nest-photo-thumbnail" style={{ opacity: isDeletingPhoto ? 0.5 : 1 }} />
                            <button
                                onClick={handlePhotoDelete}
                                disabled={isDeletingPhoto}
                                style={{
                                    position: 'absolute',
                                    top: '8px',
                                    right: '8px',
                                    background: 'rgba(255, 255, 255, 0.8)',
                                    color: 'var(--danger-color)',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '32px',
                                    height: '32px',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                }}
                                aria-label="Foto löschen"
                            >
                                <Trash size={16} />
                            </button>
                        </div>
                    ) : (
                        <div className="nest-photo-upload-container">
                            <input
                                type="file"
                                accept="image/jpeg, image/png, image/webp"
                                style={{ display: 'none' }}
                                ref={fileInputRef}
                                onChange={handlePhotoUpload}
                            />
                            <button
                                className="nav-btn-secondary"
                                style={{ width: '100%', marginBottom: '1rem' }}
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading}
                            >
                                <Camera size={18} />
                                {isUploading ? 'Wird hochgeladen...' : 'Foto hinzufügen'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="sheet-content">
                    <h4 className="section-title">Aktion eintragen</h4>
                    <div className="action-grid">
                        {actionOptions.map(action => {
                            const isActive = action.id === activeActionId;
                            const defaultLabel2 = action.splitLabels ? action.splitLabels[1] : '2 Eier';
                            const headerClickValue = action.hasSplit ? `${action.label} (${defaultLabel2})` : action.label;

                            return (
                                <div key={action.id} className={`action-split-card ${isActive ? 'is-active' : ''}`} style={{ '--action-color': action.color }}>
                                    <div
                                        className="action-split-header"
                                        style={!action.hasSplit ? { borderBottom: 'none' } : {}}
                                        onClick={() => onAction(headerClickValue)}
                                    >
                                        <div className="action-icon" style={{ backgroundColor: `${action.color}20`, color: action.color }}>
                                            {action.icon}
                                        </div>
                                        <span className="action-label">{action.label}</span>
                                    </div>
                                    {action.hasSplit && (
                                        <div className="action-split-buttons">
                                            <button
                                                className="action-half-btn"
                                                onClick={() => onAction(`${action.label} (${action.splitLabels ? action.splitLabels[0] : '1 Ei'})`)}
                                            >
                                                {action.splitLabels ? action.splitLabels[0] : '1 Ei'}
                                            </button>
                                            <div className="action-split-divider"></div>
                                            <button
                                                className="action-half-btn"
                                                onClick={() => onAction(`${action.label} (${defaultLabel2})`)}
                                            >
                                                {defaultLabel2}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {nest.logs && nest.logs.length > 0 && (
                        <>
                            <h4 className="section-title">Letzte Aktivitäten</h4>
                            <div className="log-list">
                                {nest.logs.map(log => (
                                    <div key={log.id} className="log-item">
                                        <CheckCircle2 size={16} className="log-icon" />
                                        <div className="log-details">
                                            <p className="log-action">
                                                {log.action}
                                                {log.user_name && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '0.4rem' }}>({log.user_name})</span>}
                                            </p>
                                            <span className="log-time">{formatDate(log.timestamp)}</span>
                                        </div>
                                        {user?.is_admin && (
                                            <button
                                                className="action-icon"
                                                onClick={() => handleLogDelete(log.id)}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    padding: '0.4rem',
                                                    color: 'var(--danger-color)',
                                                    cursor: 'pointer',
                                                    marginLeft: 'auto'
                                                }}
                                                aria-label="Log-Eintrag löschen"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    <div className="navigate-btn-container" style={{ flexDirection: 'column', gap: '0.75rem' }}>
                        <button
                            className="navigate-btn"
                            style={{ backgroundColor: 'var(--danger-color)' }}
                            onClick={() => onDeleteRequest(nest.id)}
                        >
                            <Trash2 size={18} />
                            Nest löschen
                        </button>
                    </div>

                    <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ID: {nest.id}
                    </div>
                </div>
            </div>

            {fullScreenImage && (
                <div className="fullscreen-photo-overlay" onClick={() => setFullScreenImage(null)}>
                    <button className="fullscreen-close-btn" onClick={() => setFullScreenImage(null)} aria-label="Schließen">
                        <X size={32} />
                    </button>
                    <img src={fullScreenImage} alt="Nest Foto Vollbild" className="fullscreen-photo" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </>
    );
}
