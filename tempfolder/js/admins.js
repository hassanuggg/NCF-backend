document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('adminForm');
    const table = document.getElementById('adminsTable');

    async function loadAdmins() {
        const res = await fetch('/admins');
        const rows = await res.json();
        table.innerHTML = rows.map((row) => `
            <tr>
                <td>${row.fullname || ''}</td>
                <td>${row.username || ''}</td>
                <td>${row.role || ''}</td>
                <td>${row.status || ''}</td>
                <td>
                    <button onclick="deleteAdmin(${row.id})">Delete</button>
                </td>
            </tr>
        `).join('');
    }

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            fullname: document.getElementById('adminFullName').value,
            username: document.getElementById('adminUsername').value,
            password: document.getElementById('adminPassword').value,
            role: document.getElementById('adminRoleSelect').value,
            status: document.getElementById('adminStatus').value,
            phone: document.getElementById('adminPhone').value,
            email: document.getElementById('adminEmail').value
        };
        const res = await fetch('/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        alert(data.message || 'Administrator saved');
        form.reset();
        loadAdmins();
    });

    window.deleteAdmin = async (id) => {
        const res = await fetch(`/admins/${id}`, { method: 'DELETE' });
        const data = await res.json();
        alert(data.message || 'Administrator deleted');
        loadAdmins();
    };

    loadAdmins();
});
