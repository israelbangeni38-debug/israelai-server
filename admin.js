'use strict';

const express = require('express');
const { stmt } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require auth + admin email check
router.use(requireAuth, requireAdmin);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users
// Returns every user in the DB for the admin dashboard
// ─────────────────────────────────────────────────────────────────────────────

router.get('/users', (req, res) => {
  const users = stmt.getAllUsers.all();
  return res.json({ users });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/ban/:userId
// ─────────────────────────────────────────────────────────────────────────────

router.post('/ban/:userId', (req, res) => {
  const { userId } = req.params;

  // Can't ban yourself
  if (userId === req.user.id) {
    return res.status(400).json({ error: "You can't ban yourself." });
  }

  const target = stmt.getUserById.get(userId);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  stmt.updateStatus.run({ status: 'banned', suspended_until: null, id: userId });
  return res.json({ message: `${target.email} has been permanently banned.` });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/suspend/:userId
// Body: { days: 3 | 7 | 30 }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/suspend/:userId', (req, res) => {
  const { userId } = req.params;
  const { days } = req.body;

  if (userId === req.user.id) {
    return res.status(400).json({ error: "You can't suspend yourself." });
  }

  const validDays = [3, 7, 30];
  if (!validDays.includes(Number(days))) {
    return res.status(400).json({ error: 'Days must be 3, 7, or 30.' });
  }

  const target = stmt.getUserById.get(userId);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const suspendedUntil = Date.now() + Number(days) * 86_400_000;
  stmt.updateStatus.run({ status: 'suspended', suspended_until: suspendedUntil, id: userId });

  return res.json({
    message: `${target.email} suspended for ${days} days.`,
    suspendedUntil
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/reinstate/:userId
// ─────────────────────────────────────────────────────────────────────────────

router.post('/reinstate/:userId', (req, res) => {
  const { userId } = req.params;

  const target = stmt.getUserById.get(userId);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  stmt.updateStatus.run({ status: 'active', suspended_until: null, id: userId });
  return res.json({ message: `${target.email} has been reinstated.` });
});

module.exports = router;
