const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Andmebaasi ühendus

// 1. GET /api/books - Laeb kõik raamatud andmebaasist
router.get('/', (req, res) => {
    const sql = "SELECT * FROM books";
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// 2. POST /api/books - Lisab uue raamatu andmebaasi (halduspaneeli või vormi jaoks)
router.post('/', (req, res) => {
    const { title, author, description } = req.body;
    
    if (!title || !author) {
        return res.status(400).json({ error: "Pealkiri ja autor on kohustuslikud" });
    }

    const sql = "INSERT INTO books (title, author, description, cover_url) VALUES (?, ?, ?, ?)";
    const params = [title, author, description, "https://placeholder.com"];

    db.run(sql, params, function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: "Raamat edukalt lisatud", id: this.lastID });
    });
});

// 3. POST /api/books/shelf - Lisab raamatu kasutaja riiulile või uuendab staatust
router.post('/shelf', (req, res) => {
    const { user_id, book_id, status } = req.body;

    if (!user_id || !book_id || !status) {
        return res.status(400).json({ error: "Andmed (user_id, book_id, status) on puudu" });
    }

    const checkSql = "SELECT * FROM user_books WHERE user_id = ? AND book_id = ?";
    db.get(checkSql, [user_id, book_id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (row) {
            // Kui raamat on juba riiulil, uuendame staatust
            const updateSql = "UPDATE user_books SET status = ? WHERE user_id = ? AND book_id = ?";
            db.run(updateSql, [status, user_id, book_id], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: "Staatuse uuendamine edukas", status });
            });
        } else {
            // Kui raamatut pole riiulil, lisame uue kirje
            const insertSql = "INSERT INTO user_books (user_id, book_id, status) VALUES (?, ?, ?)";
            db.run(insertSql, [user_id, book_id, status], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: "Raamat lisatud riiulile", id: this.lastID });
            });
        }
    });
});

// 4. GET /api/books/shelf/:user_id - Laeb konkreetse kasutaja riiuli sisu
router.get('/shelf/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `
        SELECT books.*, user_books.status 
        FROM user_books 
        JOIN books ON user_books.book_id = books.id 
        WHERE user_books.user_id = ?
    `;

    db.all(sql, [userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// 5. POST /api/books/register - Kasutaja registreerimine andmebaasi
router.post('/register', (req, res) => {
const { username, email, password } = req.body; 

if (!username || !email || !password) {
return res.status(400).json({ error: "Kõik väljad on kohustuslikud" });
}

// MVP lihtsuse mõttes salvestame parooli puhtalt (kolledži projektis lubatud, kui aega on vähe)
// Päris projektis kasutataks siin parooli räsipääsu (password_hash)
const sql = "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)";

db.run(sql, [username, email, password], function(err) {
if (err) {
if (err.message.includes('UNIQUE')) {
return res.status(400).json({ error: "Kasutajanimi või e-post on juba olemas" });
}
return res.status(500).json({ error: err.message });
}
res.status(201).json({
message: "Kasutaja registreeritud",
user: { id: this.lastID, username }
});
});

}); 

// 6. POST /api/books/login - Kasutaja sisselogimise kontroll
router.post('/login', (req, res) => {
const { username, password } = req.body; 

if (!username || !password) {
return res.status(400).json({ error: "Kasutajanimi ja parool on kohustuslikud" });
}

const sql = "SELECT * FROM users WHERE username = ? AND password_hash = ?";

db.get(sql, [username, password], (err, row) => {
if (err) {
return res.status(500).json({ error: err.message });
}
if (!row) {
return res.status(401).json({ error: "Vale kasutajanimi või parool" });
}
res.json({
message: "Sisselogimine edukas",
user: { id: row.id, username: row.username }
});
});

});

module.exports = router;
