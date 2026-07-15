document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('settingsForm');

    async function loadSettings() {
        const res = await fetch('/settings');
        const data = await res.json();
        document.getElementById('organizationName').value = data.organization_name || '';
        document.getElementById('logo').value = data.logo || '';
        document.getElementById('phone').value = data.phone || '';
        document.getElementById('email').value = data.email || '';
        document.getElementById('address').value = data.address || '';
        document.getElementById('website').value = data.website || '';
        document.getElementById('theme').value = data.theme || '';
        document.getElementById('sessionTimeout').value = data.session_timeout || 60;
    }

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            organization_name: document.getElementById('organizationName').value,
            logo: document.getElementById('logo').value,
            phone: document.getElementById('phone').value,
            email: document.getElementById('email').value,
            address: document.getElementById('address').value,
            website: document.getElementById('website').value,
            theme: document.getElementById('theme').value,
            session_timeout: document.getElementById('sessionTimeout').value
        };
        const res = await fetch('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        alert(data.message || 'Settings saved');
    });

    await loadSettings();
});
