function safeJson(res){
    return res.text().then(text => {
        try { return JSON.parse(text); } catch (e) { return { message: text || 'Invalid server response' }; }
    });
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

function bindLoginForm(){
    const form = document.getElementById('loginForm');
    if (!form) return;
    form.addEventListener('submit', function(e){
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        if (!username || !password) { showToast('Username and password are required', 'error'); return; }
        fetch('/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password })
        })
        .then(async res => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Login failed', 'error');
            window.location.href = '/dashboard';
        })
        .catch(err => { console.error(err); showToast('Login failed', 'error'); });
    });
}

function bindSignupForm(){
    const form = document.getElementById('signupForm');
    if (!form) return;
    form.addEventListener('submit', function(e){
        e.preventDefault();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        if (!email || !password) { showToast('Email and password are required', 'error'); return; }
        fetch('/auth/signup', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password })
        })
        .then(async res => {
            const data = await safeJson(res);
            if (!res.ok) return showToast(data.message || 'Signup failed', 'error');
            window.location.href = '/dashboard';
        })
        .catch(err => { console.error(err); showToast('Signup failed', 'error'); });
    });
}

window.addEventListener('load', () => {
    bindLoginForm();
    bindSignupForm();
});
