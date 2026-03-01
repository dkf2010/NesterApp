import { useState } from 'react';
import { changePassword } from '../services/authService';
import { useAuth } from '../contexts/AuthContext';
import './AuthScreens.css';

export default function ChangePasswordScreen({ onClose }) {
    const { token } = useAuth();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [status, setStatus] = useState(''); // 'idle', 'loading', 'success', 'error'
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setErrorMessage('');

        try {
            await changePassword(token, currentPassword, newPassword);
            setStatus('success');
            setTimeout(onClose, 2000); // Close after 2 seconds
        } catch (err) {
            setErrorMessage(err.message);
            setStatus('error');
        }
    };

    return (
        <div className="auth-card glass" style={{ padding: '1.5rem', marginTop: '1rem', boxShadow: 'none', border: '1px solid var(--border-color)' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-main)' }}>Passwort ändern</h3>

            {status === 'success' ? (
                <div className="auth-success" style={{ marginBottom: 0 }}>
                    Passwort erfolgreich geändert!
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="auth-form" style={{ gap: '1rem' }}>
                    {status === 'error' && <div className="auth-error" style={{ marginBottom: 0, padding: '0.5rem' }}>{errorMessage}</div>}

                    <div className="form-group">
                        <label style={{ fontSize: '0.8rem' }}>Aktuelles Passwort</label>
                        <input
                            type="password"
                            value={currentPassword}
                            onChange={e => setCurrentPassword(e.target.value)}
                            required
                            style={{ padding: '0.5rem' }}
                        />
                    </div>

                    <div className="form-group">
                        <label style={{ fontSize: '0.8rem' }}>Neues Passwort</label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            required
                            minLength="6"
                            style={{ padding: '0.5rem' }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button type="submit" className="auth-submit-btn" disabled={status === 'loading'} style={{ flex: 1, padding: '0.6rem', marginTop: 0 }}>
                            {status === 'loading' ? '...' : 'Speichern'}
                        </button>
                        <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1, padding: '0.6rem' }}>
                            Abbrechen
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
