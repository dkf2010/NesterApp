import { createContext, useState, useEffect, useContext, useCallback } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [token, setToken] = useState(localStorage.getItem('auth_token'));
    const [user, setUser] = useState(() => {
        const savedUser = localStorage.getItem('auth_user');
        return savedUser ? JSON.parse(savedUser) : null;
    });
    const [isAuthenticated, setIsAuthenticated] = useState(!!token);

    useEffect(() => {
        if (token) {
            localStorage.setItem('auth_token', token);
            if (user) localStorage.setItem('auth_user', JSON.stringify(user));
            setIsAuthenticated(true);
        } else {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            setIsAuthenticated(false);
            setUser(null);
        }
    }, [token, user]);

    const login = (newToken, newUserProfile) => {
        setToken(newToken);
        if (newUserProfile) setUser(newUserProfile);
    };

    const logout = useCallback(() => {
        setToken(null);
        setUser(null);
    }, []);

    // Wrapper around fetch that automatically logs the user out on 401 responses.
    // Use this for all authenticated API calls instead of raw fetch().
    const fetchWithAuth = useCallback(async (url, options = {}) => {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...(options.headers || {}),
                Authorization: `Bearer ${token}`,
            },
        });

        if (response.status === 401) {
            logout();
            return response; // caller can check response.ok if needed
        }

        return response;
    }, [token, logout]);

    return (
        <AuthContext.Provider value={{ token, isAuthenticated, user, login, logout, fetchWithAuth }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
