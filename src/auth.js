const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set — copy .env.example to .env and fill it in.');
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Reads the token from an httpOnly cookie (set at login/signup) rather than
// localStorage — safer against XSS, since client-side JS can't read it.
function requireAuth(req, res, next) {
  const token = req.cookies?.loopline_token;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

module.exports = { signToken, requireAuth };
