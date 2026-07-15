const express = require("express");
const session = require("express-session");
const db = require("./database/database");
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');

// optional image processing library (sharp). If not installed, code will fall back to plain write.
let sharp = null;
try { sharp = require('sharp'); } catch (e) { console.warn('sharp not available, image resizing disabled'); }

// ensure directory for news images exists
const newsImagesDir = path.join(__dirname, 'public', 'images', 'news');
const eventImagesDir = path.join(__dirname, 'public', 'images', 'events');
try { fs.mkdirSync(newsImagesDir, { recursive: true }); } catch (e) {}
try { fs.mkdirSync(eventImagesDir, { recursive: true }); } catch (e) {}
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_CHAT_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const SESSION_COOKIE_NAME = 'ncfSessionId';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 1 day
const CHAT_UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'messages');
const CHAT_AUDIO_DIR = path.join(__dirname, 'public', 'uploads', 'messages', 'audio');
try { fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true }); } catch (e) {}
try { fs.mkdirSync(CHAT_AUDIO_DIR, { recursive: true }); } catch (e) {}

const chatUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/') ? CHAT_AUDIO_DIR : CHAT_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const ext = path.extname(safeName) || '';
        cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    }
});

const chatUpload = multer({
    storage: chatUploadStorage,
    limits: { fileSize: MAX_CHAT_UPLOAD_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed', 'application/octet-stream',
            'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'
        ];
        if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type'));
        }
    }
});

app.use(session({
    name: SESSION_COOKIE_NAME,
    secret: process.env.SESSION_SECRET || 'ncf-admin-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: SESSION_MAX_AGE }
}));

function allowPublicPath(path){
    const allowed = [
        '/',
        '/login',
        '/login.html',
        '/signup',
        '/signup.html',
        '/auth/login',
        '/auth/signup',
        '/auth/logout',
        '/auth/me'
    ];
    const allowedPrefixes = ['/css/', '/js/', '/images/'];
    return allowed.includes(path) || allowedPrefixes.some(prefix => path.startsWith(prefix));
}

function requireAuth(req, res, next){
    if (allowPublicPath(req.path)) return next();
    if (req.session && req.session.adminId) return next();
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(401).json({ message: 'Authentication required' });
    }
    return res.redirect('/login');
}

function requireSuperAdmin(req, res, next) {
    if (!req.session || !req.session.adminId) return res.status(401).json({ message: 'Authentication required' });
    const role = (req.session.admin && req.session.admin.role ? req.session.admin.role : '').toLowerCase();
    if (role.includes('super') || role.includes('executive director')) return next();
    return res.status(403).json({ message: 'Super Administrator access required' });
}

function logActivity(adminId, adminName, action, details) {
    db.run('INSERT INTO activity_log (admin_id, admin_name, action, details) VALUES (?, ?, ?, ?)', [adminId || null, adminName || null, action, details || null]);
}

function addNotification(adminId, title, message, type = 'info') {
    db.run('INSERT INTO notifications (admin_id, title, message, type) VALUES (?, ?, ?, ?)', [adminId || null, title, message, type], (err) => {
        if (err) {
            console.error('Failed to save notification', err);
            return;
        }
        io.emit('new-notification', { adminId: adminId || null, title, message, type });
    });
}

const IMAGE_DATA_URI_REGEX = /^data:(image\/(?:png|jpe?g));base64,([A-Za-z0-9+/=]+)$/i;
const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'];

function parseImageDataUri(imageData){
    if (typeof imageData !== 'string') return null;
    const sanitized = imageData.trim();
    const match = sanitized.match(IMAGE_DATA_URI_REGEX);
    if (!match) return null;
    const mime = match[1].toLowerCase();
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const base64 = match[2].replace(/\s+/g, '');
    const buffer = Buffer.from(base64, 'base64');
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(mime) || buffer.length > MAX_IMAGE_SIZE_BYTES) return null;
    return { mime, ext, buffer };
}

app.use((req, res, next) => {
    console.log(new Date().toISOString(), req.method, req.url, { contentType: req.headers['content-type'], body: req.body });
    next();
});

app.use(requireAuth);
app.use(express.static("public"));

app.get("/", (req, res) => {
    if (req.session && req.session.adminId) return res.redirect('/dashboard');
    res.sendFile(__dirname + "/public/login.html");
});
app.get("/login", (req, res) => {
    if (req.session && req.session.adminId) return res.redirect('/dashboard');
    res.sendFile(__dirname + "/public/login.html");
});
app.get("/signup", (req, res) => {
    if (req.session && req.session.adminId) return res.redirect('/dashboard');
    res.sendFile(__dirname + "/public/signup.html");
});
app.get("/dashboard", (req, res) => {
    res.sendFile(__dirname + "/public/dashboard.html");
});
app.get("/news-page", (req, res) => {
    res.sendFile(__dirname + "/public/news.html");
});
app.get("/news", (req, res) => {

    db.all("SELECT * FROM news ORDER BY id DESC", [], (err, rows) => {

        if (err) {
            console.log(err);
            return res.status(500).json({ message: "Failed to load news" });
        }

        res.json(rows);

    });

});

app.all('/news', (req, res, next) => {
    console.log('ALL /news middleware:', req.method);
    next();
});

// ----- Admin authentication -----
app.post('/auth/signup', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = bcrypt.hashSync(password, 10);
    db.run(
        "INSERT INTO users (email, password_hash, salt, role) VALUES (?, ?, ?, ?)",
        [normalizedEmail, passwordHash, '', 'admin'],
        function (err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    return res.status(400).json({ message: 'Username is already registered' });
                }
                console.error(err);
                return res.status(500).json({ message: 'Failed to create account' });
            }
            res.json({ message: 'Account created successfully' });
        }
    );
});

app.post('/auth/login', (req, res) => {
    const username = (req.body.username || req.body.email || '').trim();
    const password = req.body.password;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    db.get("SELECT * FROM admins WHERE username = ?", [username], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Login failed' });
        }
        if (!row) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
        if (row.status && row.status.toLowerCase() !== 'active') {
            return res.status(403).json({ message: 'This account is not active' });
        }
        const passwordMatch = bcrypt.compareSync(password, row.password);
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        req.session.adminId = row.id;
        req.session.admin = {
            id: row.id,
            fullname: row.fullname,
            username: row.username,
            role: row.role,
            image: row.image,
            status: row.status
        };

        logActivity(row.id, row.fullname, 'Logged in', 'Administrator signed in');
        addNotification(row.id, 'Welcome back', 'You are now signed in to the admin workspace', 'success');
        res.json({ message: 'Login successful', admin: req.session.admin });
    });
});

app.get('/auth/me', (req, res) => {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({ message: 'Authentication required' });
    }
    res.json(req.session.admin || { id: req.session.adminId });
});

app.put('/auth/profile', (req, res) => {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    const { phone, email, image } = req.body;
    const updates = [];
    const values = [];

    if (typeof phone === 'string' && phone.trim()) { updates.push('phone = ?'); values.push(phone.trim()); }
    if (typeof email === 'string' && email.trim()) { updates.push('email = ?'); values.push(email.trim()); }
    if (typeof image === 'string' && image.trim()) { updates.push('image = ?'); values.push(image.trim()); }

    if (!updates.length) {
        return res.status(400).json({ message: 'No profile changes provided' });
    }

    values.push(req.session.adminId);
    db.run(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`, values, function (err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to update profile' });
        }
        db.get('SELECT * FROM admins WHERE id = ?', [req.session.adminId], (selectErr, row) => {
            if (selectErr || !row) return res.status(500).json({ message: 'Profile updated but could not be reloaded' });
            req.session.admin = { ...req.session.admin, fullname: row.fullname, username: row.username, role: row.role, image: row.image, status: row.status, phone: row.phone, email: row.email };
            res.json({ message: 'Profile updated successfully', admin: req.session.admin });
        });
    });
});

app.post('/auth/change-password', (req, res) => {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current and new passwords are required' });
    }

    db.get("SELECT * FROM admins WHERE id = ?", [req.session.adminId], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to update password' });
        }
        if (!row) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        const currentPasswordMatch = bcrypt.compareSync(currentPassword, row.password);
        if (!currentPasswordMatch) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }

        const passwordHash = bcrypt.hashSync(newPassword, 10);
        db.run("UPDATE admins SET password = ? WHERE id = ?", [passwordHash, req.session.adminId], function (updateErr) {
            if (updateErr) {
                console.error(updateErr);
                return res.status(500).json({ message: 'Failed to update password' });
            }
            res.json({ message: 'Password updated successfully' });
        });
    });
});

app.post('/auth/logout', (req, res) => {
    const adminName = req.session && req.session.admin ? req.session.admin.fullname : null;
    const adminId = req.session && req.session.adminId ? req.session.adminId : null;
    req.session.destroy(() => {
        if (adminId) logActivity(adminId, adminName, 'Logged out', 'Administrator signed out');
        res.clearCookie(SESSION_COOKIE_NAME);
        res.json({ message: 'Logged out successfully' });
    });
});

app.get('/dashboard/stats', requireAuth, (req, res) => {
    const queries = [
        'SELECT COUNT(*) AS count FROM news',
        'SELECT COUNT(*) AS count FROM events',
        'SELECT COUNT(*) AS count FROM gallery',
        'SELECT COUNT(*) AS count FROM volunteers',
        'SELECT COUNT(*) AS count FROM messages',
        'SELECT COUNT(*) AS count FROM chat_messages WHERE receiver_id = ? AND is_read = 0'
    ];
    db.serialize(() => {
        db.get(queries[0], [], (err, newsRow) => {
            if (err) return res.status(500).json({ message: 'Failed to load dashboard stats' });
            db.get(queries[1], [], (err2, eventsRow) => {
                if (err2) return res.status(500).json({ message: 'Failed to load dashboard stats' });
                db.get(queries[2], [], (err3, galleryRow) => {
                    if (err3) return res.status(500).json({ message: 'Failed to load dashboard stats' });
                    db.get(queries[3], [], (err4, volunteerRow) => {
                        if (err4) return res.status(500).json({ message: 'Failed to load dashboard stats' });
                        db.get(queries[4], [], (err5, messageRow) => {
                            if (err5) return res.status(500).json({ message: 'Failed to load dashboard stats' });
                            db.get(queries[5], [req.session.adminId], (err6, unreadRow) => {
                                if (err6) return res.status(500).json({ message: 'Failed to load dashboard stats' });
                                res.json({
                                    news: Number(newsRow.count || 0),
                                    events: Number(eventsRow.count || 0),
                                    gallery: Number(galleryRow.count || 0),
                                    volunteers: Number(volunteerRow.count || 0),
                                    messages: Number(messageRow.count || 0),
                                    unreadMessages: Number(unreadRow.count || 0)
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/settings', requireSuperAdmin, (req, res) => {
    db.get('SELECT * FROM organization_settings WHERE id = 1', [], (err, row) => {
        if (err) return res.status(500).json({ message: 'Failed to load settings' });
        res.json(row || {});
    });
});

app.put('/settings', requireSuperAdmin, (req, res) => {
    const { organization_name, logo, phone, email, address, website, theme, session_timeout } = req.body;
    db.run(`UPDATE organization_settings SET organization_name = ?, logo = ?, phone = ?, email = ?, address = ?, website = ?, theme = ?, session_timeout = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`, [organization_name || 'Nanyoni Charity Foundation', logo || '', phone || '', email || '', address || '', website || '', theme || 'blue', session_timeout || 60], (err) => {
        if (err) return res.status(500).json({ message: 'Failed to save settings' });
        logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Updated settings', 'Organization settings updated');
        res.json({ message: 'Settings updated successfully' });
    });
});

app.get('/notifications', requireAuth, (req, res) => {
    db.all('SELECT * FROM notifications WHERE admin_id IS NULL OR admin_id = ? ORDER BY id DESC LIMIT 20', [req.session.adminId], (err, rows) => {
        if (err) return res.status(500).json({ message: 'Failed to load notifications' });
        res.json(rows || []);
    });
});

app.put('/notifications/:id/read', requireAuth, (req, res) => {
    db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND (admin_id IS NULL OR admin_id = ?)', [req.params.id, req.session.adminId], (err) => {
        if (err) return res.status(500).json({ message: 'Failed to mark notification as read' });
        res.json({ message: 'Notification marked as read' });
    });
});

app.get('/activity-log', requireSuperAdmin, (req, res) => {
    db.all('SELECT * FROM activity_log ORDER BY id DESC LIMIT 100', [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'Failed to load activity log' });
        res.json(rows || []);
    });
});

app.get('/admins', requireSuperAdmin, (req, res) => {
    db.all('SELECT id, fullname, username, role, image, status, phone, email, created_at FROM admins ORDER BY fullname', [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'Failed to load administrators' });
        res.json(rows || []);
    });
});

app.post('/admins', requireSuperAdmin, (req, res) => {
    const { fullname, username, password, role, status, phone, email } = req.body;
    if (!fullname || !username || !password || !role) return res.status(400).json({ message: 'Full name, username, password and role are required' });
    const passwordHash = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO admins (fullname, username, password, role, status, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)', [fullname, username, passwordHash, role, status || 'Active', phone || '', email || ''], function (err) {
        if (err) return res.status(500).json({ message: 'Failed to create administrator' });
        logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Created administrator', `${fullname} (${role})`);
        addNotification(null, 'Administrator created', `${fullname} was added to the system`, 'success');
        res.json({ id: this.lastID, message: 'Administrator created successfully' });
    });
});

app.put('/admins/:id', requireSuperAdmin, (req, res) => {
    const { fullname, username, role, status, phone, email } = req.body;
    db.run('UPDATE admins SET fullname = ?, username = ?, role = ?, status = ?, phone = ?, email = ? WHERE id = ?', [fullname, username, role, status, phone || '', email || '', req.params.id], (err) => {
        if (err) return res.status(500).json({ message: 'Failed to update administrator' });
        logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Updated administrator', `${fullname} (${role})`);
        res.json({ message: 'Administrator updated successfully' });
    });
});

app.delete('/admins/:id', requireSuperAdmin, (req, res) => {
    db.run('DELETE FROM admins WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: 'Failed to delete administrator' });
        logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Deleted administrator', `Administrator ${req.params.id}`);
        res.json({ message: 'Administrator deleted successfully' });
    });
});

app.post('/admins/:id/reset-password', requireSuperAdmin, (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'Password is required' });
    const passwordHash = bcrypt.hashSync(password, 10);
    db.run('UPDATE admins SET password = ? WHERE id = ?', [passwordHash, req.params.id], (err) => {
        if (err) return res.status(500).json({ message: 'Failed to reset password' });
        res.json({ message: 'Password reset successfully' });
    });
});

app.post("/news", (req, res) => {
    const { title, description } = req.body;
    console.log('POST /news body sizes:', { titleLen: title ? title.length : 0, descLen: description ? description.length : 0, hasImage: !!req.body.imageData });

    if (!title || !description) {
        return res.status(400).json({ message: "Title and description are required" });
    }

    // handle optional base64 image data
    const imageData = req.body.imageData;
    function insertNews(imageUrl) {
        db.run(
            "INSERT INTO news (title, description, image) VALUES (?, ?, ?)",
            [title, description, imageUrl || null],
            function (err) {
                if (err) {
                    console.log(err);
                    return res.status(500).json({ message: "Failed to save news" });
                }

                console.log('Inserted news id', this.lastID);
                logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Added news', title);
                addNotification(req.session.adminId, 'News added', `${title} was created successfully`, 'success');
                res.json({ message: "News added successfully", id: this.lastID });
            }
        );
    }

    if (imageData) {
        const imageInfo = parseImageDataUri(imageData);
        if (!imageInfo) return res.status(400).json({ message: 'Invalid image data. Use a PNG or JPG image under 2MB.' });
        const { ext, buffer } = imageInfo;
        const filename = `news_${Date.now()}.${ext}`;
        const filepath = path.join(newsImagesDir, filename);

        function saveImageAndInsert(){
            const insertCallback = (err) => {
                if (err) { console.error(err); return insertNews(null); }
                const publicUrl = `/images/news/${filename}`;
                insertNews(publicUrl);
            };

            if (sharp){
                sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).toFile(filepath)
                    .then(() => insertCallback(null))
                    .catch(err => {
                        console.warn('sharp error, falling back to raw write', err);
                        fs.writeFile(filepath, buffer, insertCallback);
                    });
            } else {
                fs.writeFile(filepath, buffer, insertCallback);
            }
        }
        saveImageAndInsert();
    } else {
        insertNews(null);
    }
});

app.put("/news/:id", (req, res) => {
    const { title, description } = req.body;
    const id = req.params.id;

    if (!title || !description) {
        return res.status(400).json({ message: "Title and description are required" });
    }

    const imageData = req.body.imageData;
    console.log('PUT /news for id', id, 'hasImage', !!imageData);

    // helper to remove a stored image file given its public url
    function removeImageFile(publicUrl){
        try {
            if (!publicUrl) return;
            const prefix = '/images/news/';
            if (!publicUrl.startsWith(prefix)) return;
            const filename = publicUrl.substring(prefix.length);
            const filepath = path.join(newsImagesDir, filename);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        } catch (e){ console.warn('Failed to remove old image', e); }
    }

    function updateNews(imageUrl){
        const sql = imageUrl ? "UPDATE news SET title = ?, description = ?, image = ? WHERE id = ?" : "UPDATE news SET title = ?, description = ? WHERE id = ?";
        const params = imageUrl ? [title, description, imageUrl, id] : [title, description, id];
        db.run(sql, params, function (err) {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Failed to update news" });
            }

            if (this.changes === 0) {
                return res.status(404).json({ message: "News not found" });
            }

            console.log('Updated news id', id, 'changes', this.changes);
            logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Updated news', title);
            addNotification(req.session.adminId, 'News updated', `${title} was updated`, 'info');
            res.json({ message: "News updated successfully" });
        });
    }

    if (imageData) {
        const imageInfo = parseImageDataUri(imageData);
        if (!imageInfo) return res.status(400).json({ message: 'Invalid image data. Use a PNG or JPG image under 2MB.' });
        const { ext, buffer } = imageInfo;
        const filename = `news_${Date.now()}.${ext}`;
        const filepath = path.join(newsImagesDir, filename);
        // before writing new file, fetch existing record to remove its file after new one is saved
        db.get("SELECT image FROM news WHERE id = ?", [id], (err, row) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Failed to update news' });
            }
            if (!row) {
                return res.status(404).json({ message: 'News not found' });
            }
            function afterSave(err){
                if (err){ console.error(err); return updateNews(null); }
                const publicUrl = `/images/news/${filename}`;
                // remove old image if present
                try { if (row && row.image) removeImageFile(row.image); } catch(e){}
                updateNews(publicUrl);
            }

            if (sharp){
                sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).toFile(filepath)
                    .then(() => afterSave(null))
                    .catch(err => {
                        console.warn('sharp error on update, falling back to raw write', err);
                        fs.writeFile(filepath, buffer, afterSave);
                    });
            } else {
                fs.writeFile(filepath, buffer, afterSave);
            }
        });
    } else {
        // no new image; just update text fields
        updateNews(null);
    }
});

// sweep orphaned image files not referenced in DB
function sweepOrphanNewsImages(){
    try {
        db.all("SELECT image FROM news", [], (err, rows) => {
            if (err) return console.warn('Failed to read news images from DB', err);
            const referenced = new Set();
            rows.forEach(r => { if (r.image && r.image.startsWith('/images/news/')) referenced.add(r.image.substring('/images/news/'.length)); });
            fs.readdir(newsImagesDir, (err, files) => {
                if (err) return;
                files.forEach(f => {
                    if (!referenced.has(f)){
                        const fp = path.join(newsImagesDir, f);
                        fs.unlink(fp, (e)=>{ if (e) console.warn('Failed to remove orphan image', fp, e); else console.log('Removed orphan image', f); });
                    }
                });
            });
        });
    } catch(e){ console.warn('sweepOrphanNewsImages error', e); }
}

app.delete("/news/:id", (req, res) => {
    const id = req.params.id;

    // fetch record to remove image file if exists
    db.get("SELECT image FROM news WHERE id = ?", [id], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Failed to delete news" });
        }

        db.run("DELETE FROM news WHERE id = ?", [id], function (err) {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: "Failed to delete news" });
            }

            if (this.changes === 0) {
                return res.status(404).json({ message: "News not found" });
            }

            console.log('Deleted news id', id, 'changes', this.changes);
            logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Deleted news', `News ID ${id}`);
            addNotification(req.session.adminId, 'News deleted', 'A news item was removed', 'warning');
            try { if (row && row.image) {
                const prefix = '/images/news/';
                if (row.image.startsWith(prefix)){
                    const filename = row.image.substring(prefix.length);
                    const filepath = path.join(newsImagesDir, filename);
                    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                }
            }} catch(e){ console.warn('Failed to remove image on delete', e); }

            res.json({ message: "News deleted successfully" });
        });
    });
});

// Serve additional pages
app.get("/events-page", (req, res) => {
    res.sendFile(__dirname + "/public/events.html");
});

app.get("/gallery-page", (req, res) => {
    res.sendFile(__dirname + "/public/gallery.html");
});

app.get("/donations-page", (req, res) => {
    res.sendFile(__dirname + "/public/donations.html");
});

app.get("/volunteers-page", (req, res) => {
    res.sendFile(__dirname + "/public/volunteers.html");
});

app.get("/messages-page", (req, res) => {
    res.sendFile(__dirname + "/public/messages.html");
});

function requireAdminSession(req, res, next) {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({ message: 'Authentication required' });
    }
    next();
}

function getAdminSummary(adminRow) {
    return {
        id: adminRow.id,
        fullname: adminRow.fullname,
        username: adminRow.username,
        role: adminRow.role,
        image: adminRow.image,
        status: adminRow.status || 'Active'
    };
}

function normalizeMessageRow(row, currentAdminId) {
    const isIncoming = row.receiver_id === currentAdminId;
    return {
        id: row.id,
        sender_id: row.sender_id,
        receiver_id: row.receiver_id,
        sender: row.sender_name || row.sender_fullname || 'Unknown',
        sender_image: row.sender_image || null,
        receiver: row.receiver_name || row.receiver_fullname || 'Unknown',
        message: row.message || '',
        attachment: row.attachment || null,
        attachment_type: row.attachment_type || null,
        voice_file: row.voice_file || null,
        created_at: row.created_at,
        edited_at: row.edited_at,
        is_deleted: row.is_deleted,
        is_read: row.is_read,
        is_edited: row.is_edited,
        direction: isIncoming ? 'incoming' : 'outgoing'
    };
}

app.get('/chat/admins', requireAdminSession, (req, res) => {
    db.all(
        'SELECT id, fullname, username, role, image, status FROM admins WHERE id != ? ORDER BY fullname ASC',
        [req.session.adminId],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Failed to load admins' });
            const online = new Set();
            const onlineMap = global.__ncfChatOnline || {};
            Object.keys(onlineMap).forEach((adminId) => {
                if (onlineMap[adminId] && onlineMap[adminId].size) online.add(String(adminId));
            });
            res.json(rows.map((row) => ({ ...getAdminSummary(row), is_online: online.has(String(row.id)) })));
        }
    );
});

app.get('/chat/conversations', requireAdminSession, (req, res) => {
    const currentAdminId = req.session.adminId;
    db.all(
        `SELECT cm.*, a.fullname AS sender_name, a.image AS sender_image, b.fullname AS receiver_name
         FROM chat_messages cm
         LEFT JOIN admins a ON a.id = cm.sender_id
         LEFT JOIN admins b ON b.id = cm.receiver_id
         WHERE (cm.sender_id = ? OR cm.receiver_id = ?) AND cm.is_deleted = 0
         ORDER BY cm.created_at DESC`,
        [currentAdminId, currentAdminId],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Failed to load conversations' });
            const conversations = [];
            const map = new Map();
            rows.forEach((row) => {
                const otherId = row.sender_id === currentAdminId ? row.receiver_id : row.sender_id;
                if (!otherId) return;
                if (!map.has(otherId)) {
                    map.set(otherId, []);
                }
                map.get(otherId).push(row);
            });
            map.forEach((messages, otherId) => {
                const sorted = messages.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
                const last = sorted[0];
                const unread = sorted.filter((item) => item.receiver_id === currentAdminId && item.is_read === 0 && item.is_deleted === 0).length;
                conversations.push({
                    other_admin_id: otherId,
                    last_message: last ? last.message || 'Attachment' : '',
                    last_message_time: last ? last.created_at : null,
                    unread_count: unread,
                    last_message_is_edited: !!last?.is_edited,
                    last_message_sender: last?.sender_name || ''
                });
            });
            res.json(conversations.sort((a, b) => new Date(b.last_message_time || 0) - new Date(a.last_message_time || 0)));
        }
    );
});

app.get('/chat/messages/:adminId', requireAdminSession, (req, res) => {
    const currentAdminId = req.session.adminId;
    const receiverId = Number(req.params.adminId);
    db.all(
        `SELECT cm.*, a.fullname AS sender_name, a.image AS sender_image, b.fullname AS receiver_name, b.image AS receiver_image
         FROM chat_messages cm
         LEFT JOIN admins a ON a.id = cm.sender_id
         LEFT JOIN admins b ON b.id = cm.receiver_id
         WHERE ((cm.sender_id = ? AND cm.receiver_id = ?) OR (cm.sender_id = ? AND cm.receiver_id = ?)) AND cm.is_deleted = 0
         ORDER BY cm.created_at ASC`,
        [currentAdminId, receiverId, receiverId, currentAdminId],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Failed to load messages' });
            db.run('UPDATE chat_messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0', [currentAdminId, receiverId], (updateErr) => {
                if (updateErr) console.warn('Failed to mark messages as read', updateErr);
            });
            res.json(rows.map((row) => normalizeMessageRow(row, currentAdminId)));
        }
    );
});

app.post('/chat/messages', requireAdminSession, (req, res) => {
    const senderId = req.session.adminId;
    const { receiver_id, message, attachment, attachment_type, voice_file, reply_to } = req.body;
    if (!receiver_id) return res.status(400).json({ message: 'A conversation recipient is required' });
    if (!message && !attachment && !voice_file) return res.status(400).json({ message: 'Message content is required' });

    db.run(
        `INSERT INTO chat_messages (sender_id, receiver_id, message, attachment, attachment_type, voice_file, reply_to, created_at, is_read, is_deleted, is_edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0, 0, 0)`,
        [senderId, receiver_id, message || '', attachment || null, attachment_type || null, voice_file || null, reply_to || null],
        function (err) {
            if (err) return res.status(500).json({ message: 'Failed to send message' });
            const messageId = this.lastID;
            db.get('SELECT id, fullname, image, role FROM admins WHERE id = ?', [senderId], (senderErr, senderRow) => {
                if (senderErr) return res.status(500).json({ message: 'Failed to load sender data' });
                const payload = {
                    id: messageId,
                    sender_id: senderId,
                    receiver_id: Number(receiver_id),
                    sender: senderRow ? senderRow.fullname : 'Unknown',
                    sender_image: senderRow ? senderRow.image : null,
                    message: message || '',
                    attachment: attachment || null,
                    attachment_type: attachment_type || null,
                    voice_file: voice_file || null,
                    created_at: new Date().toISOString(),
                    is_read: 0,
                    is_edited: 0,
                    direction: 'outgoing'
                };
                io.to(String(receiver_id)).emit('receive-message', payload);
                io.to(String(senderId)).emit('receive-message', payload);
                io.to(String(receiver_id)).emit('new-notification', {
                    adminId: receiver_id,
                    title: 'New message',
                    message: `${senderRow ? senderRow.fullname : 'Someone'} sent you a message`,
                    type: 'info'
                });
                res.json(payload);
            });
        }
    );
});

app.put('/chat/messages/:id', requireAdminSession, (req, res) => {
    const adminId = req.session.adminId;
    const messageId = Number(req.params.id);
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: 'Message content is required' });
    db.get('SELECT sender_id FROM chat_messages WHERE id = ? AND is_deleted = 0', [messageId], (err, row) => {
        if (err) return res.status(500).json({ message: 'Failed to update message' });
        if (!row) return res.status(404).json({ message: 'Message not found' });
        if (row.sender_id !== adminId) return res.status(403).json({ message: 'You can only edit your own messages' });
        db.run('UPDATE chat_messages SET message = ?, is_edited = 1, edited_at = CURRENT_TIMESTAMP WHERE id = ?', [message, messageId], function (updateErr) {
            if (updateErr) return res.status(500).json({ message: 'Failed to update message' });
            res.json({ message: 'Message updated successfully' });
        });
    });
});

app.delete('/chat/messages/:id', requireAdminSession, (req, res) => {
    const adminId = req.session.adminId;
    const messageId = Number(req.params.id);
    db.get('SELECT sender_id FROM chat_messages WHERE id = ? AND is_deleted = 0', [messageId], (err, row) => {
        if (err) return res.status(500).json({ message: 'Failed to delete message' });
        if (!row) return res.status(404).json({ message: 'Message not found' });
        if (row.sender_id !== adminId) return res.status(403).json({ message: 'You can only delete your own messages' });
        db.run('UPDATE chat_messages SET is_deleted = 1 WHERE id = ?', [messageId], function (updateErr) {
            if (updateErr) return res.status(500).json({ message: 'Failed to delete message' });
            res.json({ message: 'Message deleted successfully' });
        });
    });
});

app.put('/chat/messages/:id/read', requireAdminSession, (req, res) => {
    const adminId = req.session.adminId;
    const messageId = Number(req.params.id);
    db.run('UPDATE chat_messages SET is_read = 1 WHERE id = ? AND receiver_id = ?', [messageId, adminId], function (err) {
        if (err) return res.status(500).json({ message: 'Failed to mark as read' });
        res.json({ message: 'Message marked as read' });
    });
});

app.get('/chat/search', requireAdminSession, (req, res) => {
    const currentAdminId = req.session.adminId;
    const term = (req.query.q || '').trim();
    if (!term) return res.json([]);
    db.all(
        `SELECT cm.*, a.fullname AS sender_name, a.image AS sender_image, b.fullname AS receiver_name
         FROM chat_messages cm
         LEFT JOIN admins a ON a.id = cm.sender_id
         LEFT JOIN admins b ON b.id = cm.receiver_id
         WHERE (cm.sender_id = ? OR cm.receiver_id = ?) AND cm.is_deleted = 0 AND LOWER(cm.message) LIKE ?
         ORDER BY cm.created_at DESC`,
        [currentAdminId, currentAdminId, `%${term.toLowerCase()}%`],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Failed to search messages' });
            res.json(rows.map((row) => normalizeMessageRow(row, currentAdminId)));
        }
    );
});

app.post('/chat/upload', requireAdminSession, (req, res) => {
    chatUpload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
        const relativePath = `/uploads/messages/${path.basename(req.file.path).includes('audio') ? 'audio/' : ''}${path.basename(req.file.path)}`;
        const attachmentType = req.file.mimetype.startsWith('image/') ? 'image' : req.file.mimetype.startsWith('audio/') || req.file.mimetype.startsWith('video/') ? req.file.mimetype.split('/')[0] : 'file';
        res.json({ attachment: relativePath.replace('/audio/', '/audio/'), attachment_type: attachmentType, filename: req.file.originalname, size: req.file.size });
    });
});

app.post('/chat/voice', requireAdminSession, (req, res) => {
    chatUpload.single('voice')(req, res, (err) => {
        if (err) return res.status(400).json({ message: err.message || 'Voice upload failed' });
        if (!req.file) return res.status(400).json({ message: 'No voice recording uploaded' });
        const relativePath = `/uploads/messages/audio/${path.basename(req.file.path)}`;
        res.json({ voice_file: relativePath, attachment_type: 'voice' });
    });
});

app.get('/messages', requireAdminSession, (req, res) => {
    const currentAdminId = req.session.adminId;
    db.all(
        `SELECT cm.*, a.fullname AS sender_name, a.image AS sender_image, b.fullname AS receiver_name
         FROM chat_messages cm
         LEFT JOIN admins a ON a.id = cm.sender_id
         LEFT JOIN admins b ON b.id = cm.receiver_id
         WHERE (cm.sender_id = ? OR cm.receiver_id = ?) AND cm.is_deleted = 0
         ORDER BY cm.created_at DESC`,
        [currentAdminId, currentAdminId],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Failed to load messages' });
            res.json(rows.map((row) => ({
                id: row.id,
                sender: row.sender_name || 'Unknown',
                subject: row.message ? row.message.substring(0, 60) : 'Attachment',
                body: row.message || 'Attachment',
                is_read: row.is_read === 1,
                created_at: row.created_at,
                attachment: row.attachment,
                attachment_type: row.attachment_type,
                voice_file: row.voice_file,
                sender_id: row.sender_id,
                receiver_id: row.receiver_id
            })));
        }
    );
});

// Events CRUD
app.get("/events", (req, res) => {
    db.all("SELECT * FROM events ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ message: "Failed to load events" });
        res.json(rows);
    });
});

app.post("/events", (req, res) => {
    const { title, date, description } = req.body;
    if (!title) return res.status(400).json({ message: "Title is required" });
    const imageData = req.body.imageData;

    function insertEvent(imageUrl){
        db.run(
            "INSERT INTO events (title, date, description, image) VALUES (?, ?, ?, ?)",
            [title, date || '', description || '', imageUrl || null],
            function(err){
                if (err) {
                    console.error(err);
                    return res.status(500).json({ message: "Failed to save event" });
                }
                logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Added event', title);
                addNotification(req.session.adminId, 'Event added', `${title} was created successfully`, 'success');
                res.json({ message: "Event added successfully", id: this.lastID });
            }
        );
    }

    if (imageData){
        const imageInfo = parseImageDataUri(imageData);
        if (!imageInfo) return res.status(400).json({ message: 'Invalid image data. Use a PNG or JPG image under 2MB.' });
        const { ext, buffer } = imageInfo;
        const filename = `event_${Date.now()}.${ext}`;
        const filepath = path.join(eventImagesDir, filename);

        function saveImageAndInsert(){
            const insertCallback = (err) => {
                if (err) { console.error(err); return insertEvent(null); }
                const publicUrl = `/images/events/${filename}`;
                insertEvent(publicUrl);
            };

            if (sharp){
                sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).toFile(filepath)
                    .then(() => insertCallback(null))
                    .catch(err => {
                        console.warn('sharp error, falling back to raw write', err);
                        fs.writeFile(filepath, buffer, insertCallback);
                    });
            } else {
                fs.writeFile(filepath, buffer, insertCallback);
            }
        }
        saveImageAndInsert();
    } else {
        insertEvent(null);
    }
});

app.put("/events/:id", (req, res) => {
    const { title, date, description } = req.body;
    const id = req.params.id;
    if (!title) return res.status(400).json({ message: "Title is required" });
    const imageData = req.body.imageData;

    function removeEventImage(publicUrl){
        try {
            if (!publicUrl) return;
            const prefix = '/images/events/';
            if (!publicUrl.startsWith(prefix)) return;
            const filename = publicUrl.substring(prefix.length);
            const filepath = path.join(eventImagesDir, filename);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        } catch (e){ console.warn('Failed to remove old event image', e); }
    }

    function updateEvent(imageUrl){
        const sql = imageUrl ? "UPDATE events SET title = ?, date = ?, description = ?, image = ? WHERE id = ?" : "UPDATE events SET title = ?, date = ?, description = ? WHERE id = ?";
        const params = imageUrl ? [title, date || '', description || '', imageUrl, id] : [title, date || '', description || '', id];
        db.run(sql, params, function(err){
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Failed to update event" });
            }
            if (this.changes === 0) return res.status(404).json({ message: "Event not found" });
            res.json({ message: "Event updated successfully" });
        });
    }

    if (imageData){
        const imageInfo = parseImageDataUri(imageData);
        if (!imageInfo) return res.status(400).json({ message: 'Invalid image data. Use a PNG or JPG image under 2MB.' });
        const { ext, buffer } = imageInfo;
        const filename = `event_${Date.now()}.${ext}`;
        const filepath = path.join(eventImagesDir, filename);

        db.get("SELECT image FROM events WHERE id = ?", [id], (err, row) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Failed to update event' });
            }
            if (!row) return res.status(404).json({ message: 'Event not found' });

            function afterSave(err){
                if (err) { console.error(err); return updateEvent(null); }
                const publicUrl = `/images/events/${filename}`;
                try { if (row && row.image) removeEventImage(row.image); } catch(e){}
                updateEvent(publicUrl);
            }

            if (sharp){
                sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).toFile(filepath)
                    .then(() => afterSave(null))
                    .catch(err => {
                        console.warn('sharp error on update, falling back to raw write', err);
                        fs.writeFile(filepath, buffer, afterSave);
                    });
            } else {
                fs.writeFile(filepath, buffer, afterSave);
            }
        });
    } else {
        // preserve existing image when no new image is provided
        const sql = "UPDATE events SET title = ?, date = ?, description = ? WHERE id = ?";
        db.run(sql, [title, date || '', description || '', id], function(err){
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Failed to update event" });
            }
            if (this.changes === 0) return res.status(404).json({ message: "Event not found" });
            res.json({ message: "Event updated successfully" });
        });
    }
});

app.delete("/events/:id", (req, res) => {
    const id = req.params.id;
    db.get("SELECT image FROM events WHERE id = ?", [id], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Failed to delete event" });
        }
        db.run("DELETE FROM events WHERE id = ?", [id], function(err){
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Failed to delete event" });
            }
            if (this.changes === 0) return res.status(404).json({ message: "Event not found" });
            logActivity(req.session.adminId, req.session.admin?.fullname || req.session.admin?.username, 'Deleted event', `Event ID ${id}`);
            addNotification(req.session.adminId, 'Event deleted', `An event was removed`, 'warning');
            try {
                if (row && row.image && row.image.startsWith('/images/events/')){
                    const filename = row.image.substring('/images/events/'.length);
                    const filepath = path.join(eventImagesDir, filename);
                    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                }
            } catch(e){ console.warn('Failed to remove event image on delete', e); }
            res.json({ message: "Event deleted successfully" });
        });
    });
});

const registeredRoutes = app.router && app.router.stack
    ? app.router.stack
        .filter(layer => layer.route)
        .map(layer => `${Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(',')} ${layer.route.path}`)
    : [];
console.log('Registered routes:', registeredRoutes);

global.__ncfChatOnline = {};
global.__ncfSocketAdminMap = {};
io.on('connection', (socket) => {
    socket.on('register-admin', (adminId) => {
        if (!adminId) return;
        const safeAdminId = String(adminId);
        socket.join(safeAdminId);
        if (!global.__ncfChatOnline[safeAdminId]) {
            global.__ncfChatOnline[safeAdminId] = new Set();
        }
        global.__ncfChatOnline[safeAdminId].add(socket.id);
        global.__ncfSocketAdminMap[socket.id] = safeAdminId;
        io.emit('admin-online', { adminId: safeAdminId });
    });

    socket.on('typing', ({ receiverId, senderName }) => {
        if (!receiverId) return;
        io.to(String(receiverId)).emit('typing', { senderName });
    });

    socket.on('disconnect', () => {
        const adminId = global.__ncfSocketAdminMap[socket.id];
        if (adminId) {
            const sockets = global.__ncfChatOnline[adminId];
            if (sockets) {
                sockets.delete(socket.id);
                if (!sockets.size) {
                    delete global.__ncfChatOnline[adminId];
                    io.emit('admin-offline', { adminId });
                }
            }
            delete global.__ncfSocketAdminMap[socket.id];
        }
    });
});

server.listen(3000, () => {
    console.log("Server Started");
    // remove orphaned images on startup
    try { sweepOrphanNewsImages(); } catch(e){ console.warn('sweep error', e); }
});

// Gallery CRUD with image upload
const galleryImagesDir = path.join(__dirname, 'public', 'images', 'gallery');
try { fs.mkdirSync(galleryImagesDir, { recursive: true }); } catch (e) {}

app.get("/gallery", (req, res) => {
    db.all("SELECT * FROM gallery ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ message: "Failed to load gallery" });
        res.json(rows);
    });
});

app.post("/gallery", (req, res) => {
    const { caption } = req.body;
    const imageData = req.body.imageData;

    function insertImage(imageUrl){
        db.run(
            "INSERT INTO gallery (image, caption) VALUES (?, ?)",
            [imageUrl || null, caption || ''],
            function(err){
                if (err) {
                    console.error(err);
                    return res.status(500).json({ message: "Failed to save image" });
                }
                res.json({ message: "Image added successfully", id: this.lastID });
            }
        );
    }

    if (imageData){
        const imageInfo = parseImageDataUri(imageData);
        if (!imageInfo) return res.status(400).json({ message: 'Invalid image data. Use a PNG or JPG image under 2MB.' });
        const { ext, buffer } = imageInfo;
        const filename = `gallery_${Date.now()}.${ext}`;
        const filepath = path.join(galleryImagesDir, filename);

        function saveImageAndInsert(){
            const insertCallback = (err) => {
                if (err) { console.error(err); return insertImage(null); }
                const publicUrl = `/images/gallery/${filename}`;
                insertImage(publicUrl);
            };

            if (sharp){
                sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).toFile(filepath)
                    .then(() => insertCallback(null))
                    .catch(err => {
                        console.warn('sharp error, falling back to raw write', err);
                        fs.writeFile(filepath, buffer, insertCallback);
                    });
            } else {
                fs.writeFile(filepath, buffer, insertCallback);
            }
        }
        saveImageAndInsert();
    } else {
        return res.status(400).json({ message: 'Image is required' });
    }
});

app.put("/gallery/:id", (req, res) => {
    const { caption } = req.body;
    const id = req.params.id;
    const imageData = req.body.imageData;

    function removeGalleryImage(publicUrl){
        try {
            if (!publicUrl) return;
            const prefix = '/images/gallery/';
            if (!publicUrl.startsWith(prefix)) return;
            const filename = publicUrl.substring(prefix.length);
            const filepath = path.join(galleryImagesDir, filename);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        } catch (e){ console.warn('Failed to remove old gallery image', e); }
    }

    function updateImage(imageUrl){
        const sql = imageUrl ? "UPDATE gallery SET image = ?, caption = ? WHERE id = ?" : "UPDATE gallery SET caption = ? WHERE id = ?";
        const params = imageUrl ? [imageUrl, caption || '', id] : [caption || '', id];
        db.run(sql, params, function(err){
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Failed to update image" });
            }
            if (this.changes === 0) return res.status(404).json({ message: "Image not found" });
            res.json({ message: "Image updated successfully" });
        });
    }

    if (imageData){
        const imageInfo = parseImageDataUri(imageData);
        if (!imageInfo) return res.status(400).json({ message: 'Invalid image data. Use a PNG or JPG image under 2MB.' });
        const { ext, buffer } = imageInfo;
        const filename = `gallery_${Date.now()}.${ext}`;
        const filepath = path.join(galleryImagesDir, filename);

        db.get("SELECT image FROM gallery WHERE id = ?", [id], (err, row) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Failed to update image' });
            }
            if (!row) return res.status(404).json({ message: 'Image not found' });

            function afterSave(err){
                if (err) { console.error(err); return updateImage(null); }
                const publicUrl = `/images/gallery/${filename}`;
                try { if (row && row.image) removeGalleryImage(row.image); } catch(e){}
                updateImage(publicUrl);
            }

            if (sharp){
                sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).toFile(filepath)
                    .then(() => afterSave(null))
                    .catch(err => {
                        console.warn('sharp error on update, falling back to raw write', err);
                        fs.writeFile(filepath, buffer, afterSave);
                    });
            } else {
                fs.writeFile(filepath, buffer, afterSave);
            }
        });
    } else {
        // preserve existing image when no new image provided, just update caption
        const sql = "UPDATE gallery SET caption = ? WHERE id = ?";
        db.run(sql, [caption || '', id], function(err){
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Failed to update image" });
            }
            if (this.changes === 0) return res.status(404).json({ message: "Image not found" });
            res.json({ message: "Image updated successfully" });
        });
    }
});

app.delete("/gallery/:id", (req, res) => {
    const id = req.params.id;
    db.get("SELECT image FROM gallery WHERE id = ?", [id], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Failed to delete image" });
        }
        db.run("DELETE FROM gallery WHERE id = ?", [id], function(err){
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Failed to delete image" });
            }
            if (this.changes === 0) return res.status(404).json({ message: "Image not found" });
            try {
                if (row && row.image && row.image.startsWith('/images/gallery/')){
                    const filename = row.image.substring('/images/gallery/'.length);
                    const filepath = path.join(galleryImagesDir, filename);
                    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                }
            } catch(e){ console.warn('Failed to remove gallery image on delete', e); }
            res.json({ message: "Image deleted successfully" });
        });
    });
});

// Donations CRUD
app.get("/donations", (req, res) => {
    db.all("SELECT * FROM donations ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ message: "Failed to load donations" });
        res.json(rows);
    });
});

app.post("/donations", (req, res) => {
    const { donor, amount, note } = req.body;
    if (!donor || typeof amount === 'undefined') return res.status(400).json({ message: "Donor and amount are required" });
    db.run("INSERT INTO donations (donor, amount, note) VALUES (?, ?, ?)", [donor, amount, note || ''], function(err){
        if (err) return res.status(500).json({ message: "Failed to save donation" });
        res.json({ message: "Donation added successfully", id: this.lastID });
    });
});

app.put("/donations/:id", (req, res) => {
    const { donor, amount, note } = req.body;
    const id = req.params.id;
    if (!donor || typeof amount === 'undefined') return res.status(400).json({ message: "Donor and amount are required" });
    db.run("UPDATE donations SET donor = ?, amount = ?, note = ? WHERE id = ?", [donor, amount, note || '', id], function(err){
        if (err) return res.status(500).json({ message: "Failed to update donation" });
        if (this.changes === 0) return res.status(404).json({ message: "Donation not found" });
        res.json({ message: "Donation updated successfully" });
    });
});

app.delete("/donations/:id", (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM donations WHERE id = ?", [id], function(err){
        if (err) return res.status(500).json({ message: "Failed to delete donation" });
        if (this.changes === 0) return res.status(404).json({ message: "Donation not found" });
        res.json({ message: "Donation deleted successfully" });
    });
});

// Volunteers CRUD
app.get("/volunteers", (req, res) => {
    db.all("SELECT * FROM volunteers ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ message: "Failed to load volunteers" });
        res.json(rows);
    });
});

app.post("/volunteers", (req, res) => {
    const { fullname, phone, email, address, skills, status } = req.body;
    if (!fullname) return res.status(400).json({ message: "Full name is required" });
    db.run(
        "INSERT INTO volunteers (fullname, phone, email, address, skills, status) VALUES (?, ?, ?, ?, ?, ?)",
        [fullname, phone || '', email || '', address || '', skills || '', status || 'active'],
        function(err){
            if (err) return res.status(500).json({ message: "Failed to save volunteer" });
            res.json({ message: "Volunteer added successfully", id: this.lastID });
        }
    );
});

app.put("/volunteers/:id", (req, res) => {
    const { fullname, phone, email, address, skills, status } = req.body;
    const id = req.params.id;
    if (!fullname) return res.status(400).json({ message: "Full name is required" });
    db.run(
        "UPDATE volunteers SET fullname = ?, phone = ?, email = ?, address = ?, skills = ?, status = ? WHERE id = ?",
        [fullname, phone || '', email || '', address || '', skills || '', status || 'active', id],
        function(err){
            if (err) return res.status(500).json({ message: "Failed to update volunteer" });
            if (this.changes === 0) return res.status(404).json({ message: "Volunteer not found" });
            res.json({ message: "Volunteer updated successfully" });
        }
    );
});

app.delete("/volunteers/:id", (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM volunteers WHERE id = ?", [id], function(err){
        if (err) return res.status(500).json({ message: "Failed to delete volunteer" });
        if (this.changes === 0) return res.status(404).json({ message: "Volunteer not found" });
        res.json({ message: "Volunteer deleted successfully" });
    });
});

// Messages CRUD (Inbox Management)
app.get("/messages", (req, res) => {
    db.all("SELECT * FROM messages ORDER BY is_read ASC, created_at DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ message: "Failed to load messages" });
        res.json(rows);
    });
});

// Mark message as read
app.put("/messages/:id/read", (req, res) => {
    const id = req.params.id;
    db.run("UPDATE messages SET is_read = 1 WHERE id = ?", [id], function(err){
        if (err) return res.status(500).json({ message: "Failed to update message" });
        if (this.changes === 0) return res.status(404).json({ message: "Message not found" });
        res.json({ message: "Message marked as read" });
    });
});

app.delete("/messages/:id", (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM messages WHERE id = ?", [id], function(err){
        if (err) return res.status(500).json({ message: "Failed to delete message" });
        if (this.changes === 0) return res.status(404).json({ message: "Message not found" });
        res.json({ message: "Message deleted successfully" });
    });
});

// temporary echo endpoint for debugging POST handling
app.post('/echo', (req, res) => {
    res.json({ received: true, method: req.method, url: req.url, body: req.body });
});