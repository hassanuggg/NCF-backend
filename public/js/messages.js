let currentMessageId = null;
let allMessages = [];

load();

function load(){
    fetch('/messages')
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load messages', 'error');
            allMessages = Array.isArray(data) ? data : [];
            renderMessages(allMessages);
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to load messages', 'error');
            allMessages = [];
            renderMessages([]);
        });
}

function renderMessages(data){
    const listEl = document.getElementById('chatList');
    const countEl = document.getElementById('count');
    const panelBody = document.getElementById('chatPanelBody');
    const panelHeader = document.getElementById('chatPanelHeader');

    if (!data || !data.length) {
        listEl.innerHTML = '<div class="chat-empty">No messages yet.</div>';
        panelBody.innerHTML = '<div class="chat-empty">Select a conversation to view details.</div>';
        panelHeader.innerHTML = '';
        countEl.textContent = '0';
        return;
    }

    countEl.textContent = `${data.length} ${data.length === 1 ? 'message' : 'messages'}`;

    const sorted = [...data].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    listEl.innerHTML = sorted.map((msg) => {
        const preview = msg.subject || msg.body || '(no content)';
        const previewText = preview.length > 40 ? preview.substring(0, 40) + '...' : preview;
        const senderName = msg.sender || 'Unknown Sender';
        const senderImage = getSenderImage(senderName);
        const activeClass = currentMessageId === msg.id ? 'active' : '';

        return `
            <div class="chat-item ${activeClass}" onclick="viewMessage(${msg.id})">
                <img class="chat-avatar" src="${senderImage}" alt="${escapeHtml(senderName)}">
                <div class="chat-meta">
                    <strong>${escapeHtml(senderName)}</strong>
                    <small>${escapeHtml(previewText)}</small>
                </div>
            </div>`;
    }).join('');

    const selectedExists = sorted.some((msg) => msg.id === currentMessageId);
    if (!selectedExists) {
        currentMessageId = sorted[0].id;
    }

    const activeMessage = sorted.find((msg) => msg.id === currentMessageId);
    if (activeMessage) {
        renderPanel(activeMessage);
    }
}

function getSenderImage(senderName){
    const normalized = (senderName || '').toLowerCase();
    if (normalized.includes('ed') || normalized.includes('odongo')) return '/images/ID/Ed odongo JohnsonExecutive Director.png';
    if (normalized.includes('apio')) return '/images/ID/Apio Mary Rayantah DR of partnership.png';
    if (normalized.includes('akello')) return '/images/ID/Akello Helena Administration and Finance.png';
    if (normalized.includes('ngolobe')) return '/images/ID/Ngolobe Evans DR of communication and public relations.png';
    if (normalized.includes('wejuli')) return '/images/ID/Wejuli Christopher DR operations and programs.png';
    return '/images/Logo%201.png';
}

function renderPanel(msg){
    const senderName = msg.sender || 'Unknown Sender';
    const senderImage = getSenderImage(senderName);
    const panelHeader = document.getElementById('chatPanelHeader');
    const panelBody = document.getElementById('chatPanelBody');

    panelHeader.innerHTML = `
        <img src="${senderImage}" alt="${escapeHtml(senderName)}">
        <div>
            <h4>${escapeHtml(senderName)}</h4>
            <small>${msg.is_read ? 'Seen' : 'New message'}</small>
        </div>`;

    const bubbleClass = msg.sender && msg.sender.toLowerCase().includes('admin') ? 'outgoing' : 'incoming';
    panelBody.innerHTML = `
        <div class="chat-bubble ${bubbleClass}">
            <div class="bubble-title">${escapeHtml(msg.subject || 'No subject')}</div>
            <div>${escapeHtml(msg.body || '(no content)')}</div>
            <div class="bubble-time">${formatMessageDate(msg.created_at)}</div>
        </div>`;

    if (!msg.is_read) {
        markAsRead(msg.id);
    }
}

function viewMessage(id){
    const msg = allMessages.find((item) => item.id === id);
    if (!msg) return showToast('Message not found', 'error');

    currentMessageId = msg.id;
    renderMessages(allMessages);
}

function markAsRead(id){
    const target = allMessages.find((item) => item.id === id);
    if (!target || target.is_read) return;

    fetch(`/messages/${id}/read`, { method: 'PUT' })
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) {
                showToast(data.message || 'Failed to mark message as read', 'error');
                return;
            }
            target.is_read = true;
            renderMessages(allMessages);
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to update message', 'error');
        });
}

function deleteMessage(id){
    showConfirm('Delete this message?')
        .then((ok) => {
            if (!ok) return;
            return fetch(`/messages/${id}`, { method: 'DELETE' });
        })
        .then(async (res) => {
            if (!res) return;
            const data = await safeJson(res);
            if (!res.ok) {
                showToast(data.message || 'Failed to delete message', 'error');
                return;
            }
            allMessages = allMessages.filter((item) => item.id !== id);
            if (currentMessageId === id) {
                currentMessageId = null;
            }
            renderMessages(allMessages);
            showToast('Message deleted', 'success');
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to delete message', 'error');
        });
}

function formatMessageDate(dateStr){
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleString();
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
    return String(value).replace(/[&<>"']/g, (chr) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[chr]));
}

function showToast(msg, type='success'){
    const container = document.getElementById('toast-container');
    if (!container) { alert(msg); return; }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-msg">${msg}</div>`;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(8px)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
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
