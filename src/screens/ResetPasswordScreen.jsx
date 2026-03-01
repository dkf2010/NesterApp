import { useState } from 'react';
import { resetPassword } from '../services/authService';
import './AuthScreens.css';

export default function ResetPasswordScreen({ token, onBackToLogin }) {
    const [newPassword, setNewPassword] = useState('');
    const [status, setStatus] = useState(''); // 'idle', 'loading', 'success', 'error'
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setErrorMessage('');

        try {
            await resetPassword(token, newPassword);
            setStatus('success');
        } catch (err) {
            setErrorMessage(err.message);
            setStatus('error');
        }
    };

    if (status === 'success') {
        return (
            <div className="auth-container">
                <div className="auth-card glass">
                    <h2>Passwort geändert</h2>
                    <div className="auth-success">
                        Ihr neues Passwort wurde erfolgreich gespeichert.
                        <button className="auth-submit-btn mt-4" onClick={onBackToLogin}>
                            Jetzt anmelden
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-container">
            <div className="auth-card glass">
                <h2>Neues Passwort vergeben</h2>

                {status === 'error' && <div className="auth-error">{errorMessage}</div>}

                <form onSubmit={handleSubmit} className="auth-form">
                    <div className="form-group">
                        <label>Neues Passwort</label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            required
                            minLength="6"
                        />
                    </div>

                    <button type="submit" className="auth-submit-btn" disabled={status === 'loading'}>
                        {status === 'loading' ? 'Speichern...' : 'Passwort speichern'}
                    </button>
                </form>

                <button className="auth-text-btn mt-4" onClick={onBackToLogin}>
                    Abbrechen
                </button>
            </div>
        </div>
    );
}
