const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bookRoutes = require('./routes/bookRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // Позволяет Express читать JSON в теле запросов (req.body)

// Подключение маршрутов
app.use('/api/books', bookRoutes);

// Базовый тестовый маршрут
app.get('/', (req, res) => {
    res.send('LiveLib Clone API работает!');
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер успешно запущен на порту ${PORT}`);
});
