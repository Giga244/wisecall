const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config');

const COOKIE_NAME = 'wisecall_token';

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'not_authenticated' });
  try {
    req.userToken = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function optionalAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try { req.userToken = jwt.verify(token, JWT_SECRET); } catch (e) { /* ignore */ }
  }
  next();
}

module.exports = { signToken, setAuthCookie, clearAuthCookie, requireAuth, optionalAuth, COOKIE_NAME };
