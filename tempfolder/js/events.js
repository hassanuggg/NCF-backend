let editId = null;
let selectedImageData = null;

load();

function load(){
    fetch('/events')
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load events', 'error');
            renderEvents(data);
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to load events', 'error');
            renderEvents([]);
        });
}

function renderEvents(data){
    const tbody = document.getElementById('table');
    const countEl = document.getElementById('count');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No events yet.</td></tr>';
        countEl.textContent = '0';
        return;
    }
    countEl.textContent = `${data.length} ${data.length === 1 ? 'event' : 'events'}`;
    tbody.innerHTML = data.map(e => {
        const dateText = e.date ? e.date : 'TBD';
        const descriptionText = e.description ? e.description : '';
        const imageSrc = e.image && e.image !== 'null' ? e.image : '';
        return `<tr><td>${e.id}</td><td>${escapeHtml(e.title)}</td><td>${escapeHtml(dateText)}</td><td>${escapeHtml(descriptionText)}</td><td>${imageSrc ? `<img class="news-thumb" src="${imageSrc}" alt="Event image" onerror="this.style.display='none'"/>` : '<span class="no-image">No image</span>'}</td><td><div class="action-btns"><button class="edit-btn" type="Button" onclick="edit(${e.id})">Edit</button><button class="delete-btn" type="button" onclick="del(${e.id})">Delete</button></div></td></tr>`;
    }).join('');
}

function reset(){
    document.getElementById('eventsForm').reset();
    editId = null;
    document.getElementById('submitBtn').textContent = 'Save Event';
    document.getElementById('cancelBtn').hidden = true;
    const heading = document.querySelector('.panel-header h3');
    if (heading) heading.textContent = 'Add Event';
}

function handleSaveResponse(res) {
    return safeJson(res).then(data => {
        if (!res.ok) {
            showToast(data.message || 'Failed to save event', 'error');
            throw new Error(data.message || 'Failed to save event');
        }
        showToast(data.message || (editId ? 'Event updated' : 'Event added'), 'success');
        reset();
        load();
    });
}

function handleSaveError(err) {
    console.error(err);
    showToast('Unable to save event', 'error');
}

document.getElementById('eventsForm').addEventListener('submit', function(e){
    e.preventDefault();
    const title = document.getElementById('title').value.trim();
    const payload = {
        title,
        date: document.getElementById('date').value,
        description: document.getElementById('description').value.trim()
    };

    if (!title) {
        showToast('Title is required', 'error');
        return;
    }

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `/events/${editId}` : '/events';
    const imageInput = document.getElementById('imageInput');

    const sendRequest = () => {
        fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) })
            .then(handleSaveResponse)
            .catch(handleSaveError);
    };

    if (imageInput && imageInput.files && imageInput.files[0]){
        const file = imageInput.files[0];
        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg'];
        if (!allowedTypes.includes(file.type)){
            showToast('Please select a PNG or JPG image', 'error');
            return;
        }
        const maxSize = 2 * 1024 * 1024;
        if (file.size > maxSize){
            showToast('Image must be under 2MB', 'error');
            return;
        }

        const sendImage = (imageData) => {
            payload.imageData = imageData;
            sendRequest();
        };

        const sendOriginalFile = () => {
            readFileAsDataURL(file)
                .then(sendImage)
                .catch(err => {
                    console.error(err);
                    showToast('Failed to process image', 'error');
                });
        };

        if (selectedImageData) {
            sendImage(selectedImageData);
        } else {
            resizeImageFile(file, 1200, 1200)
                .then(sendImage)
                .catch(err => {
                    console.warn('Resize failed, sending original image data instead', err);
                    sendOriginalFile();
                });
        }
        return;
    }

    sendRequest();
});

document.getElementById('cancelBtn').addEventListener('click', reset);

function edit(id){
    fetch('/events')
        .then(async res => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load event', 'error');
            const item = data.find(x => x.id === id);
            if (!item) return showToast('Event not found', 'error');
            editId = item.id;
            document.getElementById('title').value = item.title;
            document.getElementById('date').value = item.date || '';
            document.getElementById('description').value = item.description || '';
            document.getElementById('submitBtn').textContent = 'Update Event';
            document.getElementById('cancelBtn').hidden = false;
            const heading = document.querySelector('.panel-header h3');
            if (heading) heading.textContent = 'Edit Event';
            const preview = document.getElementById('imagePreview');
            const imageInput = document.getElementById('imageInput');
            selectedImageData = null;
            if (imageInput) imageInput.value = '';
            if (preview){
                if (item.image){
                    preview.src = item.image;
                    preview.style.display = 'block';
                } else {
                    preview.src = '';
                    preview.style.display = 'none';
                }
            }
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to load event for edit', 'error');
        });
}

function del(id){
    showConfirm('Delete this event?')
        .then(ok => {
            if (!ok) return;
            return fetch(`/events/${id}`, { method: 'DELETE' });
        })
        .then(async res => {
            if (!res) return;
            const data = await safeJson(res);
            if (!res.ok) {
                showToast(data.message || 'Failed to delete event', 'error');
                return;
            }
            showToast(data.message || 'Event deleted', 'success');
            if (editId === id) reset();
            load();
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to delete event', 'error');
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

function resizeImageFile(file, maxWidth, maxHeight){
    return new Promise((resolve, reject) => {
        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg'];
        if (!allowedTypes.includes(file.type)){
            return reject(new Error('Unsupported image type'));
        }

        const reader = new FileReader();
        reader.onload = function(){
            const img = new Image();
            img.onload = function(){
                const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
                const width = Math.round(img.width * ratio);
                const height = Math.round(img.height * ratio);
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                const quality = mime === 'image/jpeg' ? 0.85 : undefined;
                try {
                    const resizedDataUrl = canvas.toDataURL(mime, quality);
                    resolve(resizedDataUrl);
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error('Unable to read image'));
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function readFileAsDataURL(file){
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

const imageInput = document.getElementById('imageInput');
if (imageInput){
    imageInput.addEventListener('change', function(){
        const file = this.files && this.files[0];
        const preview = document.getElementById('imagePreview');
        selectedImageData = null;
        if (!file){ if (preview){ preview.src=''; preview.style.display='none'; } return; }

        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg'];
        if (!allowedTypes.includes(file.type)){
            showToast('Please select a PNG or JPG image', 'error');
            this.value = '';
            if (preview){ preview.src=''; preview.style.display='none'; }
            return;
        }

        const maxSize = 2 * 1024 * 1024;
        if (file.size > maxSize){
            showToast('Image must be under 2MB', 'error');
            this.value = '';
            if (preview){ preview.src=''; preview.style.display='none'; }
            return;
        }

        resizeImageFile(file, 1200, 1200)
            .then(resizedDataUrl => {
                selectedImageData = resizedDataUrl;
                if (preview){ preview.src = resizedDataUrl; preview.style.display = 'block'; }
                showToast('Image resized automatically', 'success');
            })
            .catch(err => {
                console.error(err);
                showToast('Failed to process image', 'error');
                this.value = '';
                if (preview){ preview.src=''; preview.style.display='none'; }
            });
    });
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
