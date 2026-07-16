let editId = null;
let selectedImageData = null;

load();

function load(){
    fetch('/gallery')
        .then(async (res) => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load gallery', 'error');
            renderGallery(data);
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to load gallery', 'error');
            renderGallery([]);
        });
}

function renderGallery(data){
    const tbody = document.getElementById('table');
    const countEl = document.getElementById('count');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No images yet.</td></tr>';
        countEl.textContent = '0';
        return;
    }
    countEl.textContent = `${data.length} ${data.length === 1 ? 'image' : 'images'}`;
    tbody.innerHTML = data.map(img => {
        const imageSrc = img.image && img.image !== 'null' ? img.image : '';
        return `<tr><td>${img.id}</td><td>${imageSrc ? `<img src="${imageSrc}" alt="Gallery image" style="max-width:80px;max-height:60px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'"/>` : '<span class="no-image">No image</span>'}</td><td>${escapeHtml(img.caption || '')}</td><td><div class="action-btns"><button class="edit-btn" type="button" onclick="edit(${img.id})">Edit</button><button class="delete-btn" type="button" onclick="del(${img.id})">Delete</button></div></td></tr>`;
    }).join('');
}

function reset(){
    document.getElementById('galleryForm').reset();
    editId = null;
    document.getElementById('submitBtn').textContent = 'Add Image';
    document.getElementById('cancelBtn').hidden = true;
    const preview = document.getElementById('imagePreview');
    if (preview) {
        preview.src = '';
        preview.style.display = 'none';
    }
    selectedImageData = null;
}

function handleSaveResponse(res) {
    return safeJson(res).then(data => {
        if (!res.ok) {
            showToast(data.message || 'Failed to save image', 'error');
            throw new Error(data.message || 'Failed to save image');
        }
        showToast(data.message || (editId ? 'Image updated' : 'Image added'), 'success');
        reset();
        load();
    });
}

function handleSaveError(err) {
    console.error(err);
    showToast('Unable to save image', 'error');
}

document.getElementById('galleryForm').addEventListener('submit', function(e){
    e.preventDefault();
    const caption = document.getElementById('caption').value.trim();
    const payload = {
        caption
    };

    const imageInput = document.getElementById('imageInput');
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `/gallery/${editId}` : '/gallery';

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

    // If editing and no new image selected, allow caption-only update
    if (editId) {
        sendRequest();
    } else {
        showToast('Image is required for new gallery items', 'error');
    }
});

document.getElementById('cancelBtn').addEventListener('click', reset);

function edit(id){
    fetch('/gallery')
        .then(async res => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Failed to load image', 'error');
            const item = data.find(x => x.id === id);
            if (!item) return showToast('Image not found', 'error');
            editId = item.id;
            document.getElementById('caption').value = item.caption || '';
            document.getElementById('submitBtn').textContent = 'Update Image';
            document.getElementById('cancelBtn').hidden = false;
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
            showToast('Unable to load image for edit', 'error');
        });
}

function del(id){
    showConfirm('Delete this image?')
        .then(ok => {
            if (!ok) return;
            return fetch(`/gallery/${id}`, { method: 'DELETE' });
        })
        .then(async res => {
            if (!res) return;
            const data = await safeJson(res);
            if (!res.ok) {
                showToast(data.message || 'Failed to delete image', 'error');
                return;
            }
            showToast(data.message || 'Image deleted', 'success');
            if (editId === id) reset();
            load();
        })
        .catch(err => {
            console.error(err);
            showToast('Unable to delete image', 'error');
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
