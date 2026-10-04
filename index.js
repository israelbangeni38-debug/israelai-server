'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const { stmt }   = require('./db/database');

const authRoutes  = require('./routes/auth');
const userRoutes  = require('./routes/users');
const chatRoutes  = require('./routes/chats');
const adminRoutes = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

app.use(cors({
  origin: '*', // Lock this down to your app's domain in production
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api/auth',  authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup expired refresh tokens every 6 hours
// ─────────────────────────────────────────────────────────────────────────────

setInterval(() => {
  stmt.cleanExpiredTokens.run(Date.now());
}, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`IsraelAi server running on port ${PORT}`);
  console.log(`Admin email: ${process.env.ADMIN_EMAIL}`);
});
