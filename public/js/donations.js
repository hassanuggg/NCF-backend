let editId = null;

load();

function load(){
    fetch('/donations')
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load donations', 'error');
            renderDonations(data);
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to load donations', 'error');
            renderDonations([]);
        });
}

function renderDonations(data){
    const tbody = document.getElementById('table');
    const countEl = document.getElementById('count');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No donations yet.</td></tr>';
        countEl.textContent = '0';
        return;
    }
    countEl.textContent = `${data.length} ${data.length === 1 ? 'donation' : 'donations'}`;
    tbody.innerHTML = data.map(d => {
        const amount = typeof d.amount === 'number' ? d.amount.toLocaleString('en-US', {style: 'currency', currency: 'USD'}) : d.amount;
        return `<tr>
            <td>${d.id}</td>
            <td>${escapeHtml(d.donor || '')}</td>
            <td><strong>${amount}</strong></td>
            <td>${escapeHtml(d.note || '')}</td>
            <td><div class="action-btns"><button class="edit-btn" type="button" onclick="edit(${d.id})">Edit</button><button class="delete-btn" type="button" onclick="del(${d.id})">Delete</button></div></td>
        </tr>`;
    }).join('');
}

function reset(){
    document.getElementById('donationsForm').reset();
    editId = null;
    document.getElementById('submitBtn').textContent = 'Save Donation';
    document.getElementById('cancelBtn').hidden = true;
}

document.getElementById('donationsForm').addEventListener('submit', function(e){
    e.preventDefault();
    const donor = document.getElementById('donor').value.trim();
    const amount = parseFloat(document.getElementById('amount').value) || 0;
    
    if (!donor) {
        showToast('Donor name is required', 'error');
        return;
    }
    if (amount <= 0) {
        showToast('Amount must be greater than zero', 'error');
        return;
    }

    const payload = {
        donor,
        amount,
        note: document.getElementById('note').value.trim()
    };

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `/donations/${editId}` : '/donations';

    fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) })
        .then(async res => {
            const data = await safeJson(res);
            if (!res.ok) {
                showToast(data.message || 'Failed to save donation', 'error');
                return;
            }
            showToast(data.message || (editId ? 'Donation updated' : 'Donation added'), 'success');
            reset();
            load();
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to save donation', 'error');
        });
});

document.getElementById('cancelBtn').addEventListener('click', reset);

function edit(id){
    fetch('/donations')
        .then(async res => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load donation', 'error');
            const item = data.find(x => x.id === id);
            if (!item) return showToast('Donation not found', 'error');
            editId = item.id;
            document.getElementById('donor').value = item.donor || '';
            document.getElementById('amount').value = item.amount || '';
            document.getElementById('note').value = item.note || '';
            document.getElementById('submitBtn').textContent = 'Update Donation';
            document.getElementById('cancelBtn').hidden = false;
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to load donation for edit', 'error');
        });
}

function del(id){
    showConfirm('Delete this donation record?')
        .then(ok => {
            if (!ok) return;
            return fetch(`/donations/${id}`, { method: 'DELETE' });
        })
        .then(async res => {
            if (!res) return;
            const data = await safeJson(res);
            if (!res.ok) {
                showToast(data.message || 'Failed to delete donation', 'error');
                return;
            }
            showToast(data.message || 'Donation deleted', 'success');
            if (editId === id) reset();
            load();
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to delete donation', 'error');
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
