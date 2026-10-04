'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './israelai.db';
const db = new Database(path.resolve(DB_PATH));

// WAL mode — better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    email            TEXT UNIQUE NOT NULL,
    username         TEXT UNIQUE,
    password_hash    TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'user'  CHECK(role IN ('user','owner')),
    status           TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','banned')),
    suspended_until  INTEGER,          -- Unix ms timestamp or NULL
    email_verified   INTEGER NOT NULL DEFAULT 0,
    verify_token     TEXT,
    verify_token_exp INTEGER,          -- Unix ms
    created_at       INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    custom_prompt    TEXT NOT NULL DEFAULT '',
    theme            TEXT NOT NULL DEFAULT 'blue'
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,       -- Unix ms
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS chats (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'New Chat',
    tier       TEXT NOT NULL DEFAULT 'FLASH' CHECK(tier IN ('QUICK','FLASH','PRO')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content    TEXT NOT NULL,
    tier       TEXT NOT NULL DEFAULT 'FLASH',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_username       ON users(username);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user  ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_chats_user           ON chats(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_chat        ON messages(chat_id);
`);

// ─────────────────────────────────────────────────────────────────────────────
// Prepared statements
// ─────────────────────────────────────────────────────────────────────────────

const stmt = {
  // Users
  createUser: db.prepare(`
    INSERT INTO users (id, email, password_hash, role, verify_token, verify_token_exp)
    VALUES (@id, @email, @password_hash, @role, @verify_token, @verify_token_exp)
  `),
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  getUserById:    db.prepare(`SELECT * FROM users WHERE id = ?`),
  getUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  getAllUsers: db.prepare(`
    SELECT id, email, username, role, status, suspended_until, created_at
    FROM users ORDER BY created_at DESC
  `),
  setEmailVerified: db.prepare(`
    UPDATE users SET email_verified = 1, verify_token = NULL, verify_token_exp = NULL WHERE id = ?
  `),
  setUsername: db.prepare(`UPDATE users SET username = ? WHERE id = ?`),
  updateSettings: db.prepare(`UPDATE users SET custom_prompt = @custom_prompt, theme = @theme WHERE id = @id`),
  updateStatus: db.prepare(`UPDATE users SET status = @status, suspended_until = @suspended_until WHERE id = @id`),
  updateTheme:  db.prepare(`UPDATE users SET theme = ? WHERE id = ?`),
  updatePrompt: db.prepare(`UPDATE users SET custom_prompt = ? WHERE id = ?`),

  // Refresh tokens
  saveRefreshToken: db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (@id, @user_id, @token_hash, @expires_at)
  `),
  getRefreshToken: db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`),
  deleteRefreshToken: db.prepare(`DELETE FROM refresh_tokens WHERE token_hash = ?`),
  deleteAllUserTokens: db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`),
  cleanExpiredTokens: db.prepare(`DELETE FROM refresh_tokens WHERE expires_at < ?`),

  // Chats
  createChat: db.prepare(`
    INSERT INTO chats (id, user_id, title, tier) VALUES (@id, @user_id, @title, @tier)
  `),
  getUserChats: db.prepare(`
    SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC
  `),
  getChatById: db.prepare(`SELECT * FROM chats WHERE id = ?`),
  updateChatTitle: db.prepare(`UPDATE chats SET title = ?, updated_at = ? WHERE id = ?`),
  updateChatTimestamp: db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`),
  deleteChat: db.prepare(`DELETE FROM chats WHERE id = ?`),
  deleteAllUserChats: db.prepare(`DELETE FROM chats WHERE user_id = ?`),

  // Messages
  addMessage: db.prepare(`
    INSERT INTO messages (id, chat_id, role, content, tier) VALUES (@id, @chat_id, @role, @content, @tier)
  `),
  getChatMessages: db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC
  `),
  getFirstMessage: db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1
  `),
  countChatMessages: db.prepare(`SELECT COUNT(*) as count FROM messages WHERE chat_id = ?`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Account status helper — checks if a suspension has expired and auto-lifts it
// ─────────────────────────────────────────────────────────────────────────────

function resolveUserStatus(user) {
  if (user.status === 'suspended' && user.suspended_until !== null) {
    if (Date.now() >= user.suspended_until) {
      // Auto-reinstate
      stmt.updateStatus.run({ status: 'active', suspended_until: null, id: user.id });
      return { ...user, status: 'active', suspended_until: null };
    }
  }
  return user;
}

module.exports = { db, stmt, resolveUserStatus };
