let editingId = null;
let selectedImageData = null;

// Load all news when page opens
loadNews();

function loadNews(){
    fetch("/news")
        .then(response => response.json())
        .then(data => {
            let output = "";

            if (!data.length) {
                output = `<tr><td colspan="5" class="empty-state">No news found yet.</td></tr>`;
            } else {
                data.forEach(news => {
                    const imageSrc = news.image && news.image !== 'null' ? news.image : '';
                    output += `
                    <tr>
                        <td>${news.id}</td>
                        <td>${news.title}</td>
                        <td>${news.description}</td>
                        <td>${imageSrc ? `<img class="news-thumb" src="${imageSrc}" alt="News image" onerror="this.style.display='none'"/>` : '<span class="no-image">No image</span>'}</td>
                        <td>
                            <div class="action-btns">
                                <button class="edit-btn" onclick="editNews(${news.id})">Edit</button>
                                <button class="delete-btn" onclick="deleteNews(${news.id})">Delete</button>
                            </div>
                        </td>
                    </tr>
                    `;
                });
            }

            document.getElementById("newsTable").innerHTML = output;
            document.getElementById("newsCount").textContent = `${data.length} post${data.length === 1 ? "" : "s"}`;
        });
}

function resetForm(){
    document.getElementById("newsForm").reset();
    editingId = null;
    selectedImageData = null;
    document.getElementById("submitBtn").textContent = "Save News";
    document.getElementById("cancelBtn").hidden = true;
    document.querySelector(".panel-header h3").textContent = "Add New News";
    const preview = document.getElementById('imagePreview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
}

// Toast helper
function showToast(message, type = 'success', timeout = 3000){
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-msg">${message}</div>`;
    container.appendChild(el);

    setTimeout(()=>{
        el.style.transition = 'opacity .25s, transform .25s';
        el.style.opacity = '0';
        el.style.transform = 'translateY(8px)';
        setTimeout(()=> el.remove(), 300);
    }, timeout);
}

// Confirmation modal helper (returns Promise<boolean>)
function showConfirm(message){
    return new Promise((resolve)=>{
        const modal = document.getElementById('confirm-modal');
        const msgEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('confirm-yes');
        const cancelBtn = document.getElementById('confirm-cancel');

        if (!modal || !yesBtn || !cancelBtn || !msgEl) return resolve(false);

        let resolved = false;
        function cleanup(result){
            if (resolved) return;
            resolved = true;
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden','true');
            yesBtn.removeEventListener('click', onYes);
            cancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        }

        function onYes(){ cleanup(true); }
        function onCancel(){ cleanup(false); }
        function onKey(e){ if (e.key === 'Escape') cleanup(false); }

        msgEl.textContent = message;
        modal.setAttribute('aria-hidden','false');
        modal.classList.add('open');
        // focus cancel for safe default
        cancelBtn.focus();

        yesBtn.addEventListener('click', onYes);
        cancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey);

        // backdrop click closes
        const backdrop = modal.querySelector('.confirm-backdrop');
        if (backdrop) backdrop.addEventListener('click', onCancel, { once: true });
    });
}

// Save / Update News
document.getElementById("newsForm").addEventListener("submit", function(e){
    e.preventDefault();
    const title = document.getElementById("title").value;
    const description = document.getElementById("description").value;
    const fileInput = document.getElementById('imageInput');

    function send(payload){
        const method = editingId ? "PUT" : "POST";
        const endpoint = editingId ? `/news/${editingId}` : "/news";
        fetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
        .then(async res => {
            let data;
            try {
                data = await res.json();
            } catch(e){
                const text = await res.text();
                console.error('Invalid JSON response:', text);
                data = { message: text || 'Invalid server response' };
            }
            if (!res.ok) {
                showToast(data.message || 'Failed to save news', 'error');
                console.error('Save error', res.status, data);
                return;
            }
            showToast(data.message || 'Saved', 'success');
            resetForm();
            loadNews();
        })
        .catch(err => {
            showToast('Failed to save news', 'error');
            console.error(err);
        });
    }

    if (fileInput && fileInput.files && fileInput.files[0]){
        const file = fileInput.files[0];
        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg'];
        if (!allowedTypes.includes(file.type)){
            showToast('Please select a PNG or JPG image', 'error');
            return;
        }
        const maxSize = 2 * 1024 * 1024; // 2MB
        if (file.size > maxSize){ showToast('Image must be under 2MB', 'error'); return; }

        const sendImage = (imageData) => send({ title, description, imageData });
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
    } else {
        send({ title, description });
    }
});

document.getElementById("cancelBtn").addEventListener("click", resetForm);

function editNews(id){
    fetch(`/news`)
        .then(res => res.json())
        .then(data => {
            const news = data.find(item => item.id === id);
            if (!news) return;

            editingId = news.id;
            document.getElementById("title").value = news.title;
            document.getElementById("description").value = news.description;
            document.getElementById("submitBtn").textContent = "Update News";
            document.getElementById("cancelBtn").hidden = false;
            document.querySelector(".panel-header h3").textContent = "Edit News";
            const preview = document.getElementById('imagePreview');
            if (news.image){ preview.src = news.image; preview.style.display = 'block'; } else { preview.src=''; preview.style.display='none'; }
            document.getElementById("title").focus();
        });
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
        if (!file){ if (preview) { preview.src=''; preview.style.display='none'; } return; }

        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg'];
        if (!allowedTypes.includes(file.type)){
            showToast('Please select a PNG or JPG image', 'error');
            this.value = '';
            if (preview) { preview.src=''; preview.style.display='none'; }
            return;
        }

        const maxSize = 2 * 1024 * 1024;
        if (file.size > maxSize){
            showToast('Image must be under 2MB', 'error');
            this.value = '';
            if (preview) { preview.src=''; preview.style.display='none'; }
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

function deleteNews(id){
    showConfirm('Delete this news item?')
    .then(confirmed => {
        if (!confirmed) return;

        fetch(`/news/${id}`, { method: "DELETE" })
            .then(async res => {
                let data;
                try { data = await res.json(); } catch(e){ data = { message: 'Invalid server response' }; }
                if (!res.ok){ showToast(data.message || 'Failed to delete news', 'error'); console.error('Delete error', res.status, data); return; }
                showToast(data.message || 'Deleted', 'success');
                if (editingId === id) resetForm();
                loadNews();
            })
            .catch(err => { showToast('Failed to delete news', 'error'); console.error(err); });
    });
}