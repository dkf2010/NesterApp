import { useState } from 'react';
import { forgotPassword } from '../services/authService';
import './AuthScreens.css';

export default function ForgotPasswordScreen({ onBackToLogin }) {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState(''); // 'idle', 'loading', 'success', 'error'
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setErrorMessage('');

        try {
            await forgotPassword(email);
            setStatus('success');
        } catch (err) {
            setErrorMessage(err.message);
            setStatus('error');
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card glass">
                <h2>Passwort vergessen</h2>

                {status === 'success' ? (
                    <div className="auth-success">
                        Wenn die E-Mail-Adresse existiert, haben wir Ihnen einen Link zum Zurücksetzen gesendet.
                        Bitte prüfen Sie Ihr Postfach.
                        <button className="auth-submit-btn mt-4" onClick={onBackToLogin}>
                            Zurück zum Login
                        </button>
                    </div>
                ) : (
                    <>
                        <p className="auth-subtitle">Geben Sie Ihre E-Mail-Adresse ein, um einen Reset-Link zu erhalten.</p>

                        {status === 'error' && <div className="auth-error">{errorMessage}</div>}

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

                            <button type="submit" className="auth-submit-btn" disabled={status === 'loading'}>
                                {status === 'loading' ? 'Wird gesendet...' : 'Link senden'}
                            </button>
                        </form>

                        <button className="auth-text-btn mt-4" onClick={onBackToLogin}>
                            Abbrechen
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
