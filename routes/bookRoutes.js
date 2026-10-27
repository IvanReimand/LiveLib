const express = require('express');
const router = express.Router();
const db = require('../config/db'); // ühendame andmebaasi

// Hankida kõik raamatud andmebaasist
router.get('/', (req, res) => {
    const sql = "SELECT * FROM books";
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

module.exports = router;
