import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../services/nestService';
import './AuthScreens.css';

export default function UserManagementScreen({ onClose }) {
    const { token } = useAuth();
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState(''); // 'idle', 'loading', 'success', 'error'
    const [errorMessage, setErrorMessage] = useState('');
    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(true);

    const fetchUsers = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/get_users.php`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok) {
                setUsers(data);
            }
        } catch (error) {
            console.error("Failed to fetch users", error);
        } finally {
            setLoadingUsers(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setErrorMessage('');

        try {
            const response = await fetch(`${API_BASE_URL}/auth/create_user.php`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ username, email })
            });
            const data = await response.json();

            if (!response.ok) throw new Error(data.error || 'Failed to create user');

            setStatus('success');
            setUsername('');
            setEmail('');

            setTimeout(() => setStatus('idle'), 3000);
            fetchUsers(); // Refresh the list after adding
        } catch (err) {
            setErrorMessage(err.message);
            setStatus('error');
        }
    };

    return (
        <div className="auth-card glass" style={{ padding: '1.5rem', marginTop: '1rem', boxShadow: 'none', border: '1px solid var(--border-color)' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-main)' }}>Neuen Benutzer anlegen</h3>

            {status === 'success' && (
                <div className="auth-success" style={{ marginBottom: '1rem' }}>
                    Benutzer erfolgreich angelegt! Es wurde eine Willkommens-E-Mail versendet.
                </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form" style={{ gap: '1rem' }}>
                {status === 'error' && <div className="auth-error" style={{ marginBottom: 0, padding: '0.5rem' }}>{errorMessage}</div>}

                <div className="form-group">
                    <label style={{ fontSize: '0.8rem' }}>Benutzername</label>
                    <input
                        type="text"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        required
                        style={{ padding: '0.5rem' }}
                    />
                </div>

                <div className="form-group">
                    <label style={{ fontSize: '0.8rem' }}>E-Mail-Adresse</label>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        style={{ padding: '0.5rem' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button type="submit" className="auth-submit-btn" disabled={status === 'loading'} style={{ flex: 1, padding: '0.6rem', marginTop: 0 }}>
                        {status === 'loading' ? '...' : 'Anlegen'}
                    </button>
                    <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1, padding: '0.6rem' }}>
                        Schließen
                    </button>
                </div>
            </form>

            <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                <h4 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-main)' }}>Registrierte Benutzer</h4>
                {loadingUsers ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Lade Benutzer...</div>
                ) : users.length === 0 ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Keine Benutzer gefunden.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                        {users.map(user => (
                            <div key={user.id} style={{ padding: '0.75rem', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                                <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-main)' }}>{user.username}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user.email}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Erstellt: {new Date(user.created_at).toLocaleDateString('de-DE')}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
