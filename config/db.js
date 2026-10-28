const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// teen faili base andmebaasist
const dbPath = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.message);
    } else {
        console.log('Успешное подключение к базе данных SQLite.');
    }
});

// teen tabelid
db.serialize(() => {
    // 1. Таблица пользователей
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0
    )`);

    db.all('PRAGMA table_info(users)', [], (err, columns) => {
        if (err) {
            console.error('Could not inspect the users table:', err.message);
            return;
        }
        if (!columns.some((column) => column.name === 'email_verified')) {
            db.run('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1', (migrationError) => {
                if (migrationError) {
                    console.error('Could not add email verification status to existing users:', migrationError.message);
                }
            });
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS email_verification_codes (
        email TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_sent_at INTEGER NOT NULL
    )`);

    // 2. raamatute tabel
    db.run(`CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT,
        cover_url TEXT
    )`);

    // 3. raamatude riiulite tabel
    db.run(`CREATE TABLE IF NOT EXISTS user_books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        book_id INTEGER,
        status TEXT NOT NULL, -- 'want_to_read', 'reading', 'read'
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(book_id) REFERENCES books(id)
    )`);

    // täidame raamatutega testandmetega, kui tabel on tühi
    db.get("SELECT COUNT(*) as count FROM books", [], (err, row) => {
        if (row.count === 0) {
            const insertStmt = db.prepare("INSERT INTO books (title, author, description, cover_url) VALUES (?, ?, ?, ?)");
            insertStmt.run("1984", "Джордж Оруэлл", "Культовая антиутопия.", "https://placeholder.com");
            insertStmt.run("Мастер и Маргарита", "Михаил Булгаков", "Бессмертный роман.", "https://placeholder.com");
            insertStmt.run("Властелин Колец", "Дж. Р. Р. Толкин", "Великое фэнтези.", "https://placeholder.com");
            insertStmt.finalize();
            console.log("База данных заполнена тестовыми книгами.");
        }
    });
});

module.exports = db;
