import { createContext, useState, useEffect, useContext } from 'react';

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

    const logout = () => {
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ token, isAuthenticated, user, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
