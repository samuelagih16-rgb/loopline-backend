// Real SQLite database using Node's built-in `node:sqlite` module
// (available since Node 22.5, no native compilation, no extra dependency —
// check your version with `node --version` if this errors on require).
//
// This replaces the earlier JSON-file version. Same function names as
// before, so nothing in the routes had to change — that's the point of
// keeping storage behind a small module: swapping the engine again later
// (Postgres, MySQL) means rewriting this file only.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'loopline.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_pro INTEGER NOT NULL DEFAULT 0,
    pro_expires_at TEXT,
    created_at TEXT NOT NULL
  );
`);

// Every payment reference we've successfully verified, so a reference can
// never be replayed to grant Pro access a second time or on another account.
db.exec(`
  CREATE TABLE IF NOT EXISTS processed_payments (
    reference TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL,
    verified_at TEXT NOT NULL,
    source TEXT NOT NULL
  );
`);

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    isPro: !!row.is_pro,
    proExpiresAt: row.pro_expires_at,
    createdAt: row.created_at,
  };
}

function findUserByEmail(email) {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  return rowToUser(row);
}

function findUserById(id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return rowToUser(row);
}

function createUser({ id, name, email, passwordHash }) {
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, is_pro, pro_expires_at, created_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?)`
  ).run(id, name, email, passwordHash, createdAt);
  return findUserById(id);
}

function setUserPro(id, isPro, expiresAt) {
  db.prepare('UPDATE users SET is_pro = ?, pro_expires_at = ? WHERE id = ?')
    .run(isPro ? 1 : 0, expiresAt, id);
  return findUserById(id);
}

// Returns true only the first time a given payment reference is seen.
// Call this right before granting Pro access and proceed only if it
// returns true — this is what stops a reference being replayed to
// re-trigger access, whether from a retried request or a webhook firing
// alongside the callback-based verify call.
function markPaymentProcessed({ reference, userId, amountKobo, source }) {
  try {
    db.prepare(
      `INSERT INTO processed_payments (reference, user_id, amount_kobo, verified_at, source)
       VALUES (?, ?, ?, ?, ?)`
    ).run(reference, userId, amountKobo, new Date().toISOString(), source);
    return true;
  } catch (err) {
    // UNIQUE constraint failure = this reference was already processed.
    return false;
  }
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  setUserPro,
  markPaymentProcessed,
};
