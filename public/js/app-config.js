(function () {
    function normalizeBase(value) {
        if (!value) return '';
        return String(value).replace(/\/$/, '');
    }

    function getApiBase() {
        const configured = normalizeBase(window.__NCF_API_BASE__ || '');
        if (configured) return configured;
        return `${window.location.protocol}//${window.location.host}`;
    }

    const apiBase = getApiBase();

    window.ncfApiBase = apiBase;
    window.ncfApiUrl = function (path) {
        const normalizedPath = path && path.startsWith('/') ? path : `/${path || ''}`;
        return `${apiBase}${normalizedPath}`;
    };
    window.ncfStoreAdmin = function (admin) {
        try {
            localStorage.setItem('ncfAdmin', JSON.stringify(admin || {}));
        } catch (err) {
            console.warn('Unable to persist admin', err);
        }
    };
    window.ncfGetStoredAdmin = function () {
        try {
            return JSON.parse(localStorage.getItem('ncfAdmin') || 'null');
        } catch (err) {
            return null;
        }
    };
    window.ncfClearAdmin = function () {
        try {
            localStorage.removeItem('ncfAdmin');
        } catch (err) {
            console.warn('Unable to clear admin', err);
        }
    };
})();
