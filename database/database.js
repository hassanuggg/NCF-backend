const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "ncf.db");
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.log(err.message);
    } else {
        console.log("Database Connected Successfully");
    }
});

function normalizeAdminName(value) {
    return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resolveAdminImage(fullname) {
    const imageDir = path.join(__dirname, "..", "public", "images", "ID");
    if (!fs.existsSync(imageDir)) return null;

    const files = fs.readdirSync(imageDir).filter((file) => /\.(png|jpe?g|gif|webp)$/i.test(file));
    if (!files.length) return null;

    const target = normalizeAdminName(fullname);
    const ranked = files
        .map((file) => {
            const fileName = normalizeAdminName(path.basename(file, path.extname(file)));
            let score = 0;
            target.split(/\s+/).filter(Boolean).forEach((word) => {
                if (fileName.includes(word)) score += 2;
            });
            if (fileName === target) score += 10;
            return { file, score };
        })
        .sort((a, b) => b.score - a.score);

    const bestMatch = ranked.find((entry) => entry.score > 0);
    return bestMatch ? `/images/ID/${bestMatch.file}` : `/images/ID/${files[0]}`;
}

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            image TEXT
        )
    `);

    db.get("SELECT COUNT(*) AS count FROM news", [], (err, row) => {
        if (err) {
            console.log(err.message);
            return;
        }
        if (row.count === 0) {
            db.run(
                `INSERT INTO news (title, description)
                 VALUES (?, ?)`,
                [
                    "Food Donation",
                    "We donated food to 200 families in Kampala."
                ],
                function (err) {
                    if (err) {
                        console.log(err.message);
                    } else {
                        console.log("First news added successfully!");
                    }
                }
            );
        } else {
            db.run(`
                DELETE FROM news
                WHERE id NOT IN (
                    SELECT MIN(id) FROM news GROUP BY title, description, COALESCE(image, '')
                )
            `, (err) => {
                if (err) console.log('Failed to remove duplicate news rows:', err.message);
            });
        }
    });

    // Ensure older DBs get the image column if missing
    db.run(`ALTER TABLE news ADD COLUMN image TEXT`, (err) => {
        // ignore error if column exists
    });

        // Additional resource tables
        db.run(`
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                date TEXT,
                description TEXT,
                image TEXT
            )
        `);

        db.run(`ALTER TABLE events ADD COLUMN image TEXT`, (err) => {
            // ignore error if column exists
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS gallery (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image TEXT NOT NULL,
                caption TEXT
            )
        `);

        // Migrate from url to image column if needed
        db.run(`ALTER TABLE gallery ADD COLUMN image TEXT`, (err) => {
            // ignore error if column exists
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS donations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                donor TEXT NOT NULL,
                amount REAL NOT NULL,
                note TEXT
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS volunteers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fullname TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                address TEXT,
                skills TEXT,
                status TEXT DEFAULT 'active'
            )
        `);

        // Migrate columns if needed for existing databases
        db.run(`ALTER TABLE volunteers ADD COLUMN phone TEXT`, (err) => { /* ignore error if exists */ });
        db.run(`ALTER TABLE volunteers ADD COLUMN email TEXT`, (err) => { /* ignore error if exists */ });
        db.run(`ALTER TABLE volunteers ADD COLUMN address TEXT`, (err) => { /* ignore error if exists */ });
        db.run(`ALTER TABLE volunteers ADD COLUMN skills TEXT`, (err) => { /* ignore error if exists */ });
        db.run(`ALTER TABLE volunteers ADD COLUMN status TEXT DEFAULT 'active'`, (err) => { /* ignore error if exists */ });
        
        // Migrate data from old 'name' column to 'fullname' if needed
        db.run(`UPDATE volunteers SET fullname = name WHERE fullname IS NULL OR fullname = ''`, (err) => { /* ignore error */ });

        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                subject TEXT,
                body TEXT,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migrate columns if needed
        db.run(`ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE messages ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => { /* ignore */ });

        db.run(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER NOT NULL,
                message TEXT,
                attachment TEXT,
                attachment_type TEXT,
                voice_file TEXT,
                reply_to INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                edited_at DATETIME,
                is_deleted INTEGER DEFAULT 0,
                is_read INTEGER DEFAULT 0,
                is_edited INTEGER DEFAULT 0
            )
        `);

        db.run(`ALTER TABLE chat_messages ADD COLUMN attachment TEXT`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE chat_messages ADD COLUMN attachment_type TEXT`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE chat_messages ADD COLUMN voice_file TEXT`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE chat_messages ADD COLUMN reply_to INTEGER`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE chat_messages ADD COLUMN edited_at DATETIME`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE chat_messages ADD COLUMN is_deleted INTEGER DEFAULT 0`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE chat_messages ADD COLUMN is_read INTEGER DEFAULT 0`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE chat_messages ADD COLUMN is_edited INTEGER DEFAULT 0`, (err) => { /* ignore */ });

        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin'
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fullname TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                role TEXT NOT NULL,
                image TEXT,
                status TEXT DEFAULT 'Active',
                phone TEXT,
                email TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`ALTER TABLE admins ADD COLUMN phone TEXT`, (err) => { /* ignore */ });
        db.run(`ALTER TABLE admins ADD COLUMN email TEXT`, (err) => { /* ignore */ });

        db.run(`
            CREATE TABLE IF NOT EXISTS organization_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_name TEXT DEFAULT 'Nanyoni Charity Foundation',
                logo TEXT,
                phone TEXT,
                email TEXT,
                address TEXT,
                website TEXT,
                theme TEXT DEFAULT 'blue',
                session_timeout INTEGER DEFAULT 60,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT DEFAULT 'info',
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER,
                admin_name TEXT,
                action TEXT NOT NULL,
                details TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`INSERT OR IGNORE INTO organization_settings (id, organization_name, phone, email, address, website) VALUES (1, 'Nanyoni Charity Foundation', '+256 772 000 000', 'info@nanyonicharity.org', 'Kampala, Uganda', 'https://nanyonicharity.org')`, (err) => { if (err) console.log(err.message); });

        const seedAdmins = [
            {
                fullname: "Ed Odongo Johnson",
                username: "Ed Odongo Johnson",
                role: "Executive Director",
                password: "2FCQ",
                status: "Active"
            },
            {
                fullname: "Apio Mary Rayantah",
                username: "Apio Mary Rayantah",
                role: "Director of Partnership",
                password: "9ZB3",
                status: "Active"
            },
            {
                fullname: "Akello Helena",
                username: "Akello Helena",
                role: "Administration and Finance",
                password: "QIP1V",
                status: "Active"
            },
            {
                fullname: "Ngolobe Evans",
                username: "Ngolobe Evans",
                role: "Director of Communication and Public Relations",
                password: "4JSW",
                status: "Active"
            },
            {
                fullname: "Wejuli Christopher",
                username: "Wejuli Christopher",
                role: "Director of Operations and Programs",
                password: "3GB9",
                status: "Active"
            }
        ];

        seedAdmins.forEach((admin) => {
            db.get("SELECT id FROM admins WHERE username = ?", [admin.username], (err, row) => {
                if (err) {
                    console.log(err.message);
                    return;
                }
                if (row) return;

                const image = resolveAdminImage(admin.fullname);
                const passwordHash = bcrypt.hashSync(admin.password, 10);
                db.run(
                    "INSERT INTO admins (fullname, username, password, role, image, status) VALUES (?, ?, ?, ?, ?, ?)",
                    [admin.fullname, admin.username, passwordHash, admin.role, image, admin.status],
                    (insertErr) => {
                        if (insertErr) {
                            console.log(insertErr.message);
                        } else {
                            console.log(`Seeded admin account: ${admin.username}`);
                        }
                    }
                );
            });
        });

});

module.exports = db;