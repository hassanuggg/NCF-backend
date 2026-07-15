// Simple internal admin chat client for the messages page.
let currentChatAdminId = null;
let chatAdmins = [];
let chatMessages = [];
let chatSearchTerm = '';
let socket = null;

function initChat(){
    const searchInput = document.getElementById('chatSearch');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const attachmentInput = document.getElementById('attachmentInput');

    const storedAdmin = window.ncfGetStoredAdmin ? window.ncfGetStoredAdmin() : null;
    if (storedAdmin) {
        const fullName = storedAdmin.fullname || storedAdmin.name || storedAdmin.username || 'Admin';
        const roleName = storedAdmin.role || storedAdmin.position || 'Administrator';
        const avatar = storedAdmin.image || 'images/Logo 1.png';
        const topName = document.getElementById('adminName');
        const topRole = document.getElementById('adminRole');
        const topImage = document.getElementById('adminImage');
        const sidebarName = document.getElementById('sidebarAdminName');
        const sidebarRole = document.getElementById('sidebarAdminRole');
        const sidebarImage = document.getElementById('sidebarAdminImage');
        if (topName) topName.textContent = fullName;
        if (topRole) topRole.textContent = roleName;
        if (topImage) topImage.src = avatar;
        if (sidebarName) sidebarName.textContent = fullName;
        if (sidebarRole) sidebarRole.textContent = roleName;
        if (sidebarImage) sidebarImage.src = avatar;
    }

    if (!searchInput || !messageInput || !sendBtn || !attachmentInput) return;

    searchInput.addEventListener('input', (event) => {
        chatSearchTerm = event.target.value.trim().toLowerCase();
        renderConversationList();
    });

    sendBtn.addEventListener('click', sendChatMessage);

    messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
        }
    });

    messageInput.addEventListener('input', () => autoResizeMessageInput(messageInput));
    attachmentInput.addEventListener('change', handleAttachmentUpload);
    autoResizeMessageInput(messageInput);

    connectSocket();
    loadChatData();
}

function connectSocket(){
    if (socket) return;
    socket = window.__ncfNotificationSocket || (window.io ? window.io() : null);
    if (!socket) return;
    window.__ncfNotificationSocket = socket;
    if (!socket) return;
    socket.on('connect', () => {
        const adminId = document.body.dataset.adminId || '';
        if (adminId) {
            socket.emit('register-admin', adminId);
        }
    });

    socket.on('new-notification', (payload) => {
        if (!payload) return;
        const title = payload.title || 'New notification';
        const text = payload.message ? `${title}: ${payload.message}` : title;
        if (window.showAppToast) {
            window.showAppToast(text, payload.type || 'info');
        }
    });

    socket.on('receive-message', (payload) => {
        if (!payload) return;
        const exists = chatMessages.some((message) => message.id === payload.id);
        if (!exists) {
            chatMessages.push(payload);
        }
        if (currentChatAdminId && Number(payload.sender_id) === Number(currentChatAdminId)) {
            renderMessages();
        }
        if (window.showAppToast && Number(payload.sender_id) !== Number(document.body.dataset.adminId)) {
            window.showAppToast(`New message from ${payload.sender || 'Someone'}`, 'info');
        }
        renderConversationList();
    });

}

function loadChatData(){
    fetch(window.ncfApiUrl ? window.ncfApiUrl('/chat/admins') : '/chat/admins', { credentials: 'include' })
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) throw new Error(data.message || 'Failed to load admins');
            chatAdmins = Array.isArray(data) ? data : [];
            renderConversationList();
            const firstAdmin = chatAdmins[0];
            if (firstAdmin) {
                openConversation(firstAdmin.id);
            }
        })
        .catch((err) => {
            console.error(err);
            showToast('Unable to load chat data', 'error');
        });
}

function renderConversationList(){
    const container = document.getElementById('conversationList');
    if (!container) return;

    const filtered = chatAdmins.filter((admin) => {
        const term = chatSearchTerm;
        if (!term) return true;
        return `${admin.fullname} ${admin.role}`.toLowerCase().includes(term);
    });

    if (!filtered.length) {
        container.innerHTML = '<div class="chat-empty">No administrators found.</div>';
        return;
    }

    container.innerHTML = filtered.map((admin) => {
        const activeClass = Number(currentChatAdminId) === Number(admin.id) ? 'active' : '';
        const onlineClass = admin.is_online ? 'online' : '';
        const unread = chatMessages.filter((msg) => { return Number(msg.sender_id) === Number(admin.id) && Number(msg.receiver_id) === Number(document.body.dataset.adminId) && msg.is_read === 0; }).length;
        const preview = chatMessages.filter((msg) => Number(msg.sender_id) === Number(admin.id) || Number(msg.receiver_id) === Number(admin.id)).slice(-1)[0];
        const previewText = preview ? (preview.message || 'Shared a file') : 'Tap to start chatting';
        const previewTime = preview ? formatChatTime(preview.created_at) : '';
        return `
            <div class="conversation-item ${activeClass}" data-admin-id="${admin.id}" onclick="openConversation(${admin.id})">
                <img class="conversation-avatar" src="${admin.image || '/images/logo 1.png'}" alt="${escapeHtml(admin.fullname)}" />
                <div class="conversation-body">
                    <div class="conversation-head">
                        <strong>${escapeHtml(admin.fullname)}</strong>
                        <small>${previewTime}</small>
                    </div>
                    <div class="conversation-foot">
                        <span>${escapeHtml(previewText)}</span>
                        ${unread ? `<span class="conversation-badge">${unread}</span>` : `<div class="online-dot ${onlineClass}"></div>`}
                    </div>
                </div>
            </div>`;
    }).join('');
}

function openConversation(adminId){
    currentChatAdminId = Number(adminId);
    renderConversationList();
    fetch(window.ncfApiUrl ? window.ncfApiUrl(`/chat/messages/${currentChatAdminId}`) : `/chat/messages/${currentChatAdminId}`, { credentials: 'include' })
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) throw new Error(data.message || 'Failed to load messages');
            chatMessages = Array.isArray(data) ? data : [];
            renderHeader();
            renderMessages();
        })
        .catch((err) => {
            console.error(err);
            showToast('Unable to load conversation', 'error');
        });
}

function resolveChatRecipient(){
    if (currentChatAdminId) return Number(currentChatAdminId);

    const fallbackAdmin = chatAdmins[0];
    if (fallbackAdmin) {
        currentChatAdminId = Number(fallbackAdmin.id);
        renderConversationList();
        renderHeader();
        return currentChatAdminId;
    }

    return null;
}

function renderHeader(){
    const header = document.getElementById('chatMainHeader');
    const admin = chatAdmins.find((item) => Number(item.id) === Number(currentChatAdminId));
    if (!header) return;
    if (!admin) {
        header.innerHTML = '<div class="chat-empty">Select a conversation</div>';
        return;
    }
    header.innerHTML = `
        <div class="header-main">
            <img src="${admin.image || '/images/logo 1.png'}" alt="${escapeHtml(admin.fullname)}" />
            <div>
                <h4>${escapeHtml(admin.fullname)}</h4>
                <p>${escapeHtml(admin.role)} • ${admin.is_online ? 'Online' : 'Offline'}</p>
            </div>
        </div>`;
}

function renderMessages(){
    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (!chatMessages.length) {
        container.innerHTML = '<div class="chat-empty">Start the conversation.</div>';
        return;
    }

    container.innerHTML = chatMessages.map((message) => {
        const isOutgoing = message.direction === 'outgoing';
        const senderName = escapeHtml(message.sender || 'Unknown');
        const senderImage = message.sender_image || '/images/logo 1.png';
        const body = escapeHtml(message.message || '');
        let attachments = '';
        if (message.attachment) {
            if (message.attachment_type === 'image') {
                attachments += `<img class="message-attachment-image" src="${message.attachment}" alt="attachment" />`;
            } else {
                attachments += `<a class="message-file-link" href="${message.attachment}" target="_blank" rel="noreferrer">Download attachment</a>`;
            }
        }
        return `
            <div class="message-row ${isOutgoing ? 'outgoing' : 'incoming'}">
                ${!isOutgoing ? `<img class="message-avatar" src="${senderImage}" alt="${senderName}" />` : ''}
                <div class="message-bubble">
                    ${body ? `<div class="message-body">${body}</div>` : ''}
                    ${attachments}
                    <div class="message-meta">
                        <span>${senderName}</span>
                        <span>${formatChatTime(message.created_at)}</span>
                    </div>
                </div>
                ${isOutgoing ? `<img class="message-avatar" src="${senderImage}" alt="${senderName}" />` : ''}
            </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

// Auto-expand the composer as the user types so the message bar stays clear and comfortable.
function autoResizeMessageInput(input){
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

function sendChatMessage(){
    const recipientId = resolveChatRecipient();
    if (!recipientId) return showToast('No admin available to message right now', 'error');

    const input = document.getElementById('messageInput');
    const messageText = input ? input.value.trim() : '';
    if (!messageText) return;

    fetch(window.ncfApiUrl ? window.ncfApiUrl('/chat/messages') : '/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ receiver_id: recipientId, message: messageText })
    })
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) throw new Error(data.message || 'Failed to send message');
            if (input) {
                input.value = '';
                autoResizeMessageInput(input);
            }
            chatMessages.push(data);
            renderMessages();
            renderConversationList();
        })
        .catch((err) => {
            console.error(err);
            showToast('Unable to send message', 'error');
        });
}

function handleAttachmentUpload(event){
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    fetch('/chat/upload', { method: 'POST', body: formData })
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) throw new Error(data.message || 'Upload failed');
            sendChatAttachment(data);
        })
        .catch((err) => {
            console.error(err);
            showToast('Upload failed', 'error');
        });
}

function sendChatAttachment(payload){
    const recipientId = resolveChatRecipient();
    if (!recipientId) return showToast('No admin available to message right now', 'error');

    fetch(window.ncfApiUrl ? window.ncfApiUrl('/chat/messages') : '/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ receiver_id: recipientId, attachment: payload.attachment, attachment_type: payload.attachment_type, message: payload.filename || '' })
    })
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) throw new Error(data.message || 'Failed to send attachment');
            chatMessages.push(data);
            renderMessages();
        })
        .catch((err) => {
            console.error(err);
            showToast('Unable to send attachment', 'error');
        });
}

function formatChatTime(dateValue){
    if (!dateValue) return '';
    return new Date(dateValue).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
    return String(value).replace(/[&<>"']/g, (chr) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[chr]));
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

document.addEventListener('DOMContentLoaded', initChat);
