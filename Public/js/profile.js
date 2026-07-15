document.addEventListener('DOMContentLoaded', () => {
    const profileForm = document.getElementById('profileForm');
    const passwordForm = document.getElementById('passwordForm');

    const populate = (admin) => {
        if (!admin) return;
        document.getElementById('profileFullName').value = admin.fullname || '';
        document.getElementById('profileUsername').value = admin.username || '';
        document.getElementById('profileRole').value = admin.role || '';
        document.getElementById('profilePhone').value = admin.phone || '';
        document.getElementById('profileEmail').value = admin.email || '';
        document.getElementById('profileImage').value = admin.image || '';
    };

    fetch('/auth/me')
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Unable to load profile');
            populate(data);
        })
        .catch(err => console.error(err));

    profileForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = document.getElementById('profilePhone').value.trim();
        const email = document.getElementById('profileEmail').value.trim();
        const image = document.getElementById('profileImage').value.trim();

        const res = await fetch('/auth/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, email, image })
        });
        const data = await res.json();
        alert(data.message || 'Profile updated');
    });

    passwordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const res = await fetch('/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        alert(data.message || 'Password updated');
        passwordForm.reset();
    });
});
