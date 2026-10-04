'use strict';

const jwt               = require('jsonwebtoken');
const { stmt, resolveUserStatus } = require('../db/database');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'israelbangeni38@gmail.com').toLowerCase().trim();

// ─────────────────────────────────────────────────────────────────────────────
// requireAuth — verifies access JWT, resolves user, checks account status
// ─────────────────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = stmt.getUserById.get(payload.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  const resolved = resolveUserStatus(user);

  if (resolved.status === 'banned') {
    return res.status(403).json({ error: 'Your account has been permanently banned.' });
  }

  if (resolved.status === 'suspended') {
    const remaining = resolved.suspended_until - Date.now();
    const days      = Math.ceil(remaining / 86_400_000);
    return res.status(403).json({
      error: `Your account is suspended. ${days} day${days !== 1 ? 's' : ''} remaining.`
    });
  }

  req.user = resolved;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// requireAdmin — only israelbangeni38@gmail.com gets through
// ─────────────────────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

  const email = (req.user.email || '').toLowerCase().trim();
  if (email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

function isAdmin(email) {
  return (email || '').toLowerCase().trim() === ADMIN_EMAIL;
}

module.exports = { requireAuth, requireAdmin, isAdmin };
