import { API_BASE_URL } from './nestService';

// We need to export API_BASE_URL from nestService, so we'll do that shortly as well.

export const login = async (email, password) => {
    const response = await fetch(`${API_BASE_URL}/auth/login.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');
    return data;
};

export const forgotPassword = async (email) => {
    const response = await fetch(`${API_BASE_URL}/auth/forgot_password.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to request password reset');
    return data;
};

export const resetPassword = async (token, newPassword) => {
    const response = await fetch(`${API_BASE_URL}/auth/reset_password.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to reset password');
    return data;
};

export const changePassword = async (token, currentPassword, newPassword) => {
    const response = await fetch(`${API_BASE_URL}/auth/change_password.php`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to change password');
    return data;
};
