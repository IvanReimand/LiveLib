const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bookRoutes = require('./routes/bookRoutes');
const authRoutes = require('./routes/authRoutes').router;

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware seadistamine
app.use(cors());
app.use(express.json()); // Võimaldab lugeda JSON andmeid päringu kehast (req.body)
app.use(express.static('public')); // Serveerib frontend faile 'public' kaustast

// API marsruudid (Routes)
app.use('/api/auth', authRoutes);
app.use('/api/books', bookRoutes);

// Serveri käivitamine
app.listen(PORT, () => {
    console.log(`Server töötab pordil ${PORT}`);
});
