function apiUrl(path){
    return window.ncfApiUrl ? window.ncfApiUrl(path) : path;
}

function fetchJson(path, options){
    const requestOptions = options ? { ...options, credentials: options.credentials || 'include' } : { credentials: 'include' };
    return fetch(apiUrl(path), requestOptions).then(async res => {
        const data = await res.text();
        try { return { res, data: JSON.parse(data) }; } catch (e) { return { res, data: { message: data || 'Invalid response' } }; }
    });
}

function ensureToastContainer(){
    let container = document.getElementById('toast-container');
    if (container) {
        container.className = 'toast-container';
        return container;
    }
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
    return container;
}

function showAppToast(message, type = 'success', timeout = 4000){
    const container = ensureToastContainer();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-msg">${message}</div>`;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(8px)';
        setTimeout(() => el.remove(), 300);
    }, timeout);
}

window.showAppToast = showAppToast;

let notificationSocket = null;

function connectNotificationSocket(){
    if (notificationSocket || !window.io) return notificationSocket;
    notificationSocket = window.io();
    window.__ncfNotificationSocket = notificationSocket;
    notificationSocket.on('connect', () => {
        const adminId = document.body.dataset.adminId || '';
        if (adminId) {
            notificationSocket.emit('register-admin', adminId);
        }
    });
    notificationSocket.on('new-notification', (payload) => {
        if (!payload) return;
        const title = payload.title || 'New notification';
        const text = payload.message ? `${title}: ${payload.message}` : title;
        showAppToast(text, payload.type || 'info');
    });
    notificationSocket.on('receive-message', (payload) => {
        if (!payload) return;
        const isCurrentUser = Number(payload.sender_id) === Number(document.body.dataset.adminId);
        if (!isCurrentUser) {
            const senderName = payload.sender || 'Someone';
            showAppToast(`New message from ${senderName}`, 'info');
        }
    });
    return notificationSocket;
}

function fetchCount(path){
    return fetch(path)
        .then(async res => {
            if (!res.ok) {
                const error = await res.text();
                throw new Error(error || 'Failed to load count');
            }
            const data = await res.json();
            return Array.isArray(data) ? data.length : 0;
        });
}

function resolveAvatarUrl(image){
    if (!image) return '/images/Logo%201.png';
    const value = String(image).trim();
    if (!value) return '/images/Logo%201.png';
    if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
    if (value.startsWith('/')) return window.ncfApiUrl ? window.ncfApiUrl(value) : value;
    return value;
}

function renderAdminProfile(admin){
    if (!admin) return;
    const nameEl = document.getElementById('adminName');
    const roleEl = document.getElementById('adminRole');
    const imageEl = document.getElementById('adminImage');
    const sidebarNameEl = document.getElementById('sidebarAdminName');
    const sidebarRoleEl = document.getElementById('sidebarAdminRole');
    const sidebarImageEl = document.getElementById('sidebarAdminImage');
    const fullName = admin.fullname || admin.name || admin.username || 'Admin';
    const roleName = admin.role || admin.position || 'Administrator';
    const avatar = resolveAvatarUrl(admin.image || '/images/Logo%201.png');
    if (nameEl) nameEl.textContent = fullName;
    if (roleEl) roleEl.textContent = roleName;
    if (imageEl) imageEl.src = avatar;
    if (sidebarNameEl) sidebarNameEl.textContent = fullName;
    if (sidebarRoleEl) sidebarRoleEl.textContent = roleName;
    if (sidebarImageEl) sidebarImageEl.src = avatar;
    document.body.dataset.adminId = admin.id;
    document.body.dataset.adminName = fullName;
}

function bindProfileMenu(){
    const wrapper = document.getElementById('profileMenuWrapper');
    if (!wrapper) return;
    wrapper.addEventListener('click', () => wrapper.classList.toggle('open'));

    document.getElementById('logoutLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        fetchJson('/auth/logout', { method: 'POST' }).then(({ res }) => {
            if (res.ok) window.location.href = '/login';
        });
    });

    document.getElementById('changePasswordLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('passwordModal').classList.remove('hidden');
    });

    document.getElementById('cancelPasswordBtn')?.addEventListener('click', () => {
        document.getElementById('passwordModal').classList.add('hidden');
    });

    document.getElementById('changePasswordForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        fetchJson('/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        }).then(({ res, data }) => {
            if (!res.ok) {
                alert(data.message || 'Password change failed');
                return;
            }
            alert(data.message || 'Password updated successfully');
            document.getElementById('passwordModal').classList.add('hidden');
            document.getElementById('changePasswordForm').reset();
        });
    });
}

function loadAdminProfile(){
    const storedAdmin = window.ncfGetStoredAdmin ? window.ncfGetStoredAdmin() : null;
    if (storedAdmin) {
        renderAdminProfile(storedAdmin);
        connectNotificationSocket();
    }

    fetchJson('/auth/me').then(({ res, data }) => {
        if (!res.ok) {
            if (!storedAdmin) {
                window.location.href = '/login';
            }
            return;
        }
        const admin = data && typeof data === 'object' ? data : null;
        if (window.ncfStoreAdmin && admin) window.ncfStoreAdmin(admin);
        renderAdminProfile(admin || storedAdmin);
        connectNotificationSocket();
    });
}

function updateDashboardCounts(){
    Promise.all([
        fetchCount('/news'),
        fetchCount('/events'),
        fetchCount('/gallery'),
        fetchCount('/volunteers')
    ]).then(([newsCount, eventsCount, galleryCount, volunteersCount]) => {
        const newsCountEl = document.getElementById('newsCount');
        const eventsCountEl = document.getElementById('eventsCount');
        const galleryCountEl = document.getElementById('galleryCount');
        const volunteersCountEl = document.getElementById('volunteersCount');
        if (newsCountEl) newsCountEl.textContent = newsCount;
        if (eventsCountEl) eventsCountEl.textContent = eventsCount;
        if (galleryCountEl) galleryCountEl.textContent = galleryCount;
        if (volunteersCountEl) volunteersCountEl.textContent = volunteersCount;
    }).catch(err => {
        console.error('Failed to update dashboard counts', err);
    });
}

window.addEventListener('load', () => {
    bindProfileMenu();
    loadAdminProfile();
    updateDashboardCounts();
});
