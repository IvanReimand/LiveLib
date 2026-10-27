const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bookRoutes = require('./routes/bookRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // lubab expressil töödelda JSON-kehasid
app.use(express.static('public'));


app.use(express.static('public'));

// ühendame raamatute marsruudid
app.use('/api/books', bookRoutes);

// testimiseks lihtne marsruut
app.get('/', (req, res) => {
    res.send('LiveLib Clone API работает!');
});

// serveri käivitamine
app.listen(PORT, () => {
    console.log(`Server successfully started on port ${PORT}`);
});
