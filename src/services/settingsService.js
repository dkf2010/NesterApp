// src/services/settingsService.js

const SETTINGS_KEY = 'nester_settings';

const DEFAULT_SETTINGS = {
    enableOverpass: false // Default: Overpass queries are deactivated
};

/**
 * Load user settings from localStorage merged with defaults.
 */
export const getSettings = () => {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) {
            return { ...DEFAULT_SETTINGS };
        }
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_SETTINGS,
            ...parsed
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
};

/**
 * Save partial settings to localStorage and notify listeners.
 */
export const updateSettings = (partialSettings) => {
    try {
        const current = getSettings();
        const updated = {
            ...current,
            ...partialSettings
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('nester_settings_changed', { detail: updated }));
        return updated;
    } catch (e) {
        console.error('Failed to update settings:', e);
        return { ...DEFAULT_SETTINGS, ...partialSettings };
    }
};

/**
 * Fast helper to check whether Overpass API queries are allowed.
 */
export const isOverpassEnabled = () => {
    return getSettings().enableOverpass === true;
};

/**
 * Subscribe to settings changes.
 */
export const subscribeSettings = (callback) => {
    const handler = (event) => {
        if (event.detail) {
            callback(event.detail);
        } else {
            callback(getSettings());
        }
    };

    window.addEventListener('nester_settings_changed', handler);
    window.addEventListener('storage', handler);

    return () => {
        window.removeEventListener('nester_settings_changed', handler);
        window.removeEventListener('storage', handler);
    };
};
