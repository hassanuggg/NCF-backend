let editId = null;

load();

function load(){
    fetch('/volunteers')
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load volunteers', 'error');
            renderVolunteers(data);
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to load volunteers', 'error');
            renderVolunteers([]);
        });
}

function renderVolunteers(data){
    const tbody = document.getElementById('table');
    const countEl = document.getElementById('count');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No volunteers yet.</td></tr>';
        countEl.textContent = '0';
        return;
    }
    countEl.textContent = `${data.length} ${data.length === 1 ? 'volunteer' : 'volunteers'}`;
    tbody.innerHTML = data.map(v => {
        const statusClass = v.status ? v.status.toLowerCase() : 'active';
        return `<tr>
            <td>${v.id}</td>
            <td>${escapeHtml(v.fullname || '')}</td>
            <td>${escapeHtml(v.phone || '')}</td>
            <td>${escapeHtml(v.email || '')}</td>
            <td>${escapeHtml(v.skills ? v.skills.substring(0, 30) + (v.skills.length > 30 ? '...' : '') : '')}</td>
            <td><span class="status-badge status-${statusClass}">${v.status || 'active'}</span></td>
            <td><div class="action-btns"><button class="edit-btn" type="button" onclick="edit(${v.id})">Edit</button><button class="delete-btn" type="button" onclick="del(${v.id})">Delete</button></div></td>
        </tr>`;
    }).join('');
}

function reset(){
    document.getElementById('volForm').reset();
    editId = null;
    document.getElementById('submitBtn').textContent = 'Save Volunteer';
    document.getElementById('cancelBtn').hidden = true;
}

document.getElementById('volForm').addEventListener('submit', function(e){
    e.preventDefault();
    const fullname = document.getElementById('fullname').value.trim();
    if (!fullname) {
        showToast('Full name is required', 'error');
        return;
    }

    const payload = {
        fullname,
        phone: document.getElementById('phone').value.trim(),
        email: document.getElementById('email').value.trim(),
        address: document.getElementById('address').value.trim(),
        skills: document.getElementById('skills').value.trim(),
        status: document.getElementById('status').value
    };

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `/volunteers/${editId}` : '/volunteers';

    fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) })
        .then(async res => {
            const data = await safeJson(res);
            if (!res.ok) {
                showToast(data.message || 'Failed to save volunteer', 'error');
                return;
            }
            showToast(data.message || (editId ? 'Volunteer updated' : 'Volunteer added'), 'success');
            reset();
            load();
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to save volunteer', 'error');
        });
});

document.getElementById('cancelBtn').addEventListener('click', reset);

function edit(id){
    fetch('/volunteers')
        .then(async res => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load volunteer', 'error');
            const item = data.find(x => x.id === id);
            if (!item) return showToast('Volunteer not found', 'error');
            editId = item.id;
            document.getElementById('fullname').value = item.fullname || '';
            document.getElementById('phone').value = item.phone || '';
            document.getElementById('email').value = item.email || '';
            document.getElementById('address').value = item.address || '';
            document.getElementById('skills').value = item.skills || '';
            document.getElementById('status').value = item.status || 'active';
            document.getElementById('submitBtn').textContent = 'Update Volunteer';
            document.getElementById('cancelBtn').hidden = false;
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to load volunteer for edit', 'error');
        });
}

function del(id){
    showConfirm('Delete this volunteer?')
        .then(ok => {
            if (!ok) return;
            return fetch(`/volunteers/${id}`, { method: 'DELETE' });
        })
        .then(async res => {
            if (!res) return;
            const data = await safeJson(res);
            if (!res.ok) {
                showToast(data.message || 'Failed to delete volunteer', 'error');
                return;
            }
            showToast(data.message || 'Volunteer deleted', 'success');
            if (editId === id) reset();
            load();
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to delete volunteer', 'error');
        });
}

async function safeJson(res){
    try {
        return await res.json();
    } catch (err) {
        const text = await res.text();
        return { message: text || 'Invalid server response' };
    }
}

function escapeHtml(value){
    if (!value) return '';
    return value.replace(/[&<>"']/g, chr => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[chr]));
}

function showToast(msg, type='success'){
    const container = document.getElementById('toast-container');
    if (!container) { alert(msg); return; }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-msg">${msg}</div>`;
    container.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(8px)'; setTimeout(()=>el.remove(), 300); }, 3000);
}

function showConfirm(msg){
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const message = document.getElementById('confirm-message');
        const yes = document.getElementById('confirm-yes');
        const cancel = document.getElementById('confirm-cancel');
        if (!modal || !message || !yes || !cancel) return resolve(confirm(msg));

        let resolved = false;
        function cleanup(result){
            if (resolved) return;
            resolved = true;
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
            yes.removeEventListener('click', onYes);
            cancel.removeEventListener('click', onCancel);
            resolve(result);
        }
        function onYes(){ cleanup(true); }
        function onCancel(){ cleanup(false); }

        message.textContent = msg;
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('open');
        yes.addEventListener('click', onYes);
        cancel.addEventListener('click', onCancel);
    });
}
