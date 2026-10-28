const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Andmebaasi ühendus
const { requireAuth } = require('./authRoutes');

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
router.post('/shelf', requireAuth, (req, res) => {
    const { book_id, status } = req.body;

    if (!Number.isInteger(book_id) || book_id < 1 || !['want_to_read', 'reading', 'read'].includes(status)) {
        return res.status(400).json({ error: "A valid book and shelf status are required." });
    }

    const checkSql = "SELECT * FROM user_books WHERE user_id = ? AND book_id = ?";
    db.get(checkSql, [req.userId, book_id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (row) {
            // Kui raamat on juba riiulil, uuendame staatust
            const updateSql = "UPDATE user_books SET status = ? WHERE user_id = ? AND book_id = ?";
            db.run(updateSql, [status, req.userId, book_id], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: "Staatuse uuendamine edukas", status });
            });
        } else {
            // Kui raamatut pole riiulil, lisame uue kirje
            const insertSql = "INSERT INTO user_books (user_id, book_id, status) VALUES (?, ?, ?)";
            db.run(insertSql, [req.userId, book_id, status], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: "Raamat lisatud riiulile", id: this.lastID });
            });
        }
    });
});

// 4. GET /api/books/shelf/:user_id - Laeb konkreetse kasutaja riiuli sisu
router.get('/shelf/:user_id', requireAuth, (req, res) => {
    const userId = Number(req.params.user_id);
    if (!Number.isSafeInteger(userId) || userId !== req.userId) {
        return res.status(403).json({ error: "You can only view your own shelf." });
    }
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

module.exports = router;
