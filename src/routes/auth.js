const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { findUserByEmail, findUserById, createUser } = require('../db');
const { signToken, requireAuth } = require('../auth');

const router = express.Router();

// Slow down brute-force attempts on login specifically.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are all required.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'That email address doesn\'t look valid.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = createUser({
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
  });

  const token = signToken(user);
  res.cookie('loopline_token', token, COOKIE_OPTS);
  res.status(201).json({ id: user.id, name: user.name, email: user.email, isPro: user.isPro });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = findUserByEmail(email);
  // Same error for "no such user" and "wrong password" — don't reveal which one.
  const genericError = { error: 'Incorrect email or password.' };
  if (!user) return res.status(401).json(genericError);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json(genericError);

  const token = signToken(user);
  res.cookie('loopline_token', token, COOKIE_OPTS);
  res.json({ id: user.id, name: user.name, email: user.email, isPro: user.isPro });
});

router.post('/logout', (req, res) => {
  res.clearCookie('loopline_token', COOKIE_OPTS);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    isPro: user.isPro,
    proExpiresAt: user.proExpiresAt,
  });
});

module.exports = router;
