'use strict';

const crypto = require('node:crypto');
const { db, hashPassword } = require('./db');
const { parseCookies } = require('./utils');

// In-memory session store: sessionId -> { userId, email, name, csrfToken, expiresAt }
const sessions = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

function createSession(user) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(16).toString('hex');
  sessions.set(sessionId, {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    csrfToken,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return sessionId;
}

function destroySession(sessionId) {
  sessions.delete(sessionId);
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.golden_session;
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { sessionId, ...session };
}

function verifyPassword(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND ativo = 1').get(email);
  if (!user) return null;
  const hash = hashPassword(password, user.password_salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.password_hash, 'hex');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return user;
}

function setSessionCookie(res, sessionId) {
  res.setHeader('Set-Cookie', `golden_session=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'golden_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

module.exports = {
  createSession,
  destroySession,
  getSession,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
};
