import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { login } from '../services/authService';
import './AuthScreens.css';

export default function LoginScreen({ onForgotPassword }) {
    const { login: setAuthToken } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const data = await login(email, password);
            setAuthToken(data.token, data.user);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card glass">
                <img src="/logo.png" alt="NesterApp Logo" className="auth-logo" style={{ width: '150px', height: '150px', margin: '0 auto 20px', display: 'block', borderRadius: '36px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }} />
                <h2>NesterApp Login</h2>
                <p className="auth-subtitle">Bitte melden Sie sich an, um fortzufahren.</p>

                {error && <div className="auth-error">{error}</div>}

                <form onSubmit={handleSubmit} className="auth-form">
                    <div className="form-group">
                        <label>E-Mail-Adresse</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Passwort</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    <button type="submit" className="auth-submit-btn" disabled={loading}>
                        {loading ? 'Lädt...' : 'Anmelden'}
                    </button>
                </form>

                <button className="auth-text-btn mt-4" onClick={onForgotPassword}>
                    Passwort vergessen?
                </button>
            </div>
        </div>
    );
}
