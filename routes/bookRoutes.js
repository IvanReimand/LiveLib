const express = require('express');
const router = express.Router();

// Временные фейковые данные для теста (вместо БД)
const mockBooks = [
    { id: 1, title: "1984", author: "Джордж Оруэлл" },
    { id: 2, title: "Мастер и Маргарита", author: "Михаил Булгаков" }
];

// Маршрут для получения всех книг
router.get('/', (req, res) => {
    res.json(mockBooks);
});

module.exports = router;
